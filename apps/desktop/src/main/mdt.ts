/**
 * Enemy forces, read from the user's own Mythic Dungeon Tools install.
 *
 * Read rather than bundled, and that is a licence decision, not a convenience
 * one. MDT is GPL-2.0, so shipping its tables — or a JSON file generated from
 * them — inside this app would make the whole app a GPL-2.0 derivative work.
 * The obligations attach to *distribution*, so reading the copy already on the
 * user's disk incurs none of them: nothing of MDT's leaves this machine, and a
 * user without MDT simply gets a build with no forces data rather than a build
 * that is illegal to hand to them.
 *
 * It also happens to be the better engineering answer. MDT updates within days
 * of a patch; a table baked into a release would be stale by the second week
 * of a season, and the app would need a release of its own to catch up.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { EMPTY_TABLE, parseMdtDungeon, type DungeonForces, type ForcesTable } from '@mplus/data';

/** Addon folder names to try, newest fork first; MDT has been forked twice. */
const ADDON_NAMES = ['MythicDungeonTools', 'DungeonTools'];

/**
 * Subdirectories that cannot hold dungeon data.
 *
 * The scan is depth-1 and parses whatever it finds, so this list is only about
 * cost: `libs` is a few thousand files of Ace3 and reading them all to learn
 * they are not dungeons takes longer than opening the log did.
 */
const SKIP = new Set([
  'libs',
  'Locales',
  'Textures',
  'Core',
  'Modules',
  'Developer',
  'AceGUIWidgets',
  'scripts',
  '.git',
  '.github',
]);

/** A dungeon file is tens of kilobytes; anything far larger is not one. */
const MAX_FILE_BYTES = 8 << 20;

/**
 * Candidate MDT directories, best guess first.
 *
 * The log path is the strongest signal there is: a combat log lives at
 * `<install>/_retail_/Logs/WoWCombatLog-*.txt`, so the addons beside it are the
 * ones belonging to the client that wrote that log. Someone with a live and a
 * PTR install has two MDTs at different versions, and the right one is the one
 * next to the log being read — not whichever the filesystem walk reached first.
 */
export function mdtCandidates(logPath: string | null): string[] {
  if (logPath === null) return [];
  const logs = dirname(logPath);
  const retail = dirname(logs);
  return ADDON_NAMES.map((name) => join(retail, 'Interface', 'AddOns', name));
}

interface Scanned {
  dungeons: DungeonForces[];
  version: string;
}

/** The addon's own version string, for attributing the numbers in the UI. */
async function tocVersion(directory: string): Promise<string> {
  for (const name of ADDON_NAMES) {
    try {
      const toc = await readFile(join(directory, `${name}.toc`), 'utf8');
      const version = /^##\s*Version:\s*(.+)$/m.exec(toc)?.[1]?.trim();
      if (version !== undefined && version !== '') return version;
    } catch {
      continue;
    }
  }
  return '';
}

/** Every `.lua` in `directory` and in its immediate subdirectories. */
async function luaFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (path: string, descend: boolean): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        if (descend && !SKIP.has(entry.name)) await walk(full, false);
      } else if (entry.name.endsWith('.lua')) {
        found.push(full);
      }
    }
  };
  await walk(directory, true);
  return found;
}

async function scan(directory: string): Promise<Scanned | null> {
  const files = await luaFiles(directory);
  if (files.length === 0) return null;

  const dungeons: DungeonForces[] = [];
  const byChallengeMode = new Map<number, DungeonForces>();

  for (const file of files.sort()) {
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }
    if (info.size > MAX_FILE_BYTES) continue;

    let dungeon;
    try {
      dungeon = parseMdtDungeon(await readFile(file, 'utf8'));
    } catch {
      continue; // an unreadable file is one fewer dungeon, not a failed load
    }
    if (dungeon === null) continue;
    // A dungeon reused across expansions ships twice. Files are scanned in
    // sorted order, so this is deterministic rather than whichever won the
    // race, and the richer table wins — a stub left from an earlier season has
    // the same map id and fewer creatures in it.
    const existing = byChallengeMode.get(dungeon.challengeModeId);
    if (existing !== undefined && existing.enemies.length >= dungeon.enemies.length) continue;
    byChallengeMode.set(dungeon.challengeModeId, dungeon);
  }

  if (byChallengeMode.size === 0) return null;
  dungeons.push(...byChallengeMode.values());
  dungeons.sort((a, b) => a.challengeModeId - b.challengeModeId);

  return { dungeons, version: await tocVersion(directory) };
}

export interface ForcesLoad {
  table: ForcesTable;
  /** The directory the values came from, or null when none was found. */
  directory: string | null;
}

/**
 * Enemy forces for the client that wrote `logPath`, or an empty table.
 *
 * Never throws. No MDT, a half-installed MDT and an MDT whose format changed
 * all have to degrade to the same thing — a UI that shows spawns and kills and
 * says the forces values are unavailable — because none of them is a reason to
 * fail to open a log.
 */
export async function loadForces(logPath: string | null): Promise<ForcesLoad> {
  for (const directory of mdtCandidates(logPath)) {
    const scanned = await scan(directory).catch(() => null);
    if (scanned === null) continue;
    return {
      directory,
      table: {
        source: scanned.version === ''
          ? 'Mythic Dungeon Tools'
          : `Mythic Dungeon Tools ${scanned.version}`,
        dungeons: scanned.dungeons,
      },
    };
  }
  return { table: EMPTY_TABLE, directory: null };
}

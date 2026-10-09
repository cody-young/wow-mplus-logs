/**
 * Enemy forces, from Blizzard's own scenario criteria.
 *
 * The numbers are compiled in, generated from `CriteriaTree` and `Criteria` by
 * `scripts/enemy-forces.mjs`. That is a licence decision as much as an
 * accuracy one. The community source for these values is Mythic Dungeon Tools,
 * which is GPL-2.0, so shipping its tables — or a JSON file generated from
 * them — inside this app would make the whole app a GPL-2.0 derivative work.
 * Blizzard's data carries no such obligation, and it is also the better table:
 * checked against MDT 6.2.20 it agreed on every total and every per-kill value
 * across six dungeons, and credited ten creatures MDT omits.
 *
 * One field still comes from the user's own MDT install, when they have one:
 * `teleportSpellId`, whose spell icon is the dungeon's art. Nothing in
 * Blizzard's data links a dungeon to a spell. It is read from disk rather than
 * bundled for the same licence reason as before, and it is purely cosmetic —
 * without MDT a dungeon shows its initials instead of its icon, and every
 * count on the page is identical either way.
 *
 * The same scan reads each dungeon's spawns and map art, which is what puts a
 * run on MDT's map. That is optional in the same way: without MDT the map tab
 * draws the log's own coordinates.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DB2_BUILD, db2Dungeons, parseMdtDungeon, parseMdtTeleport, type ForcesTable, type MdtDungeon } from '@mplus/data';

/** Addon folder names to try, newest fork first; MDT has been forked twice. */
const ADDON_NAMES = ['MythicDungeonTools', 'DungeonTools'];

/**
 * Subdirectories that cannot hold dungeon data.
 *
 * The scan is depth-1 and reads whatever it finds, so this list is only about
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

/** How far above the log's folder to look for `Interface`; `Logs/Archive/<log>` needs two. */
const MAX_LEVELS_UP = 4;

/**
 * Candidate MDT directories, best guess first.
 *
 * The log path is the strongest signal there is: a combat log lives at
 * `<install>/_retail_/Logs/WoWCombatLog-*.txt`, so the addons beside it are the
 * ones belonging to the client that wrote that log. Someone with a live and a
 * PTR install has two MDTs at different versions, and the right one is the one
 * next to the log being read — not whichever the filesystem walk reached first.
 *
 * The log is not always directly in `Logs`: Warcraft Logs' uploader archives
 * logs to `Logs/Archive`, and people sort theirs into folders of their own. So
 * every folder above the log is tried, nearest first, for a few levels.
 */
export function mdtCandidates(logPath: string | null): string[] {
  if (logPath === null) return [];
  const candidates: string[] = [];
  let directory = dirname(logPath);
  for (let level = 0; level < MAX_LEVELS_UP; level++) {
    const parent = dirname(directory);
    if (parent === directory) break; // the filesystem root
    directory = parent;
    for (const name of ADDON_NAMES) candidates.push(join(directory, 'Interface', 'AddOns', name));
  }
  return candidates;
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

interface MdtScan {
  /** Teleport spells by challenge-mode id. */
  teleports: Map<number, number>;
  /** Spawns and map art, by challenge-mode id. */
  dungeons: Map<number, MdtDungeon>;
}

/**
 * Everything read from one MDT directory.
 *
 * Null when the directory holds no MDT dungeon files at all, which is how a
 * missing or half-installed addon is told from one that simply has no teleport
 * for a dungeon.
 */
async function scan(directory: string): Promise<MdtScan | null> {
  const files = await luaFiles(directory);
  if (files.length === 0) return null;

  const found: MdtScan = { teleports: new Map(), dungeons: new Map() };
  for (const file of files.sort()) {
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }
    if (info.size > MAX_FILE_BYTES) continue;

    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue; // an unreadable file is one fewer icon, not a failed load
    }
    // A dungeon reused across expansions ships twice. Files are scanned in
    // sorted order, so the first wins deterministically rather than whichever
    // won the race.
    const teleport = parseMdtTeleport(source);
    if (teleport !== null && !found.teleports.has(teleport.challengeModeId)) {
      found.teleports.set(teleport.challengeModeId, teleport.teleportSpellId);
    }
    const dungeon = parseMdtDungeon(source);
    if (dungeon !== null && !found.dungeons.has(dungeon.challengeModeId)) {
      found.dungeons.set(dungeon.challengeModeId, dungeon);
    }
  }
  return found.teleports.size === 0 && found.dungeons.size === 0 ? null : found;
}

export interface ForcesLoad {
  table: ForcesTable;
  /** The MDT directory the dungeon icons came from, or null when none was found. */
  iconsFrom: string | null;
  /** Every dungeon MDT has a map of; empty without MDT. */
  mdt: MdtDungeon[];
  /** The folders MDT was looked for in when it was not found; empty when it was. */
  searched: string[];
}

/**
 * The forces table, with dungeon icons filled in when MDT is installed.
 *
 * Never throws, and never returns an empty table: the criteria data is
 * compiled in, so a missing MDT costs icons and nothing else. That is the
 * whole point of the change — before, no MDT meant no counts at all.
 */
export async function loadForces(logPath: string | null): Promise<ForcesLoad> {
  const dungeons = db2Dungeons();
  const table: ForcesTable = {
    source: `Blizzard scenario criteria (build ${DB2_BUILD})`,
    dungeons,
  };

  for (const directory of mdtCandidates(logPath)) {
    const found = await scan(directory).catch(() => null);
    if (found === null) continue;
    for (const dungeon of dungeons) {
      dungeon.teleportSpellId = found.teleports.get(dungeon.challengeModeId) ?? 0;
    }
    return { table, iconsFrom: directory, mdt: [...found.dungeons.values()], searched: [] };
  }
  return { table, iconsFrom: null, mdt: [], searched: mdtCandidates(logPath) };
}

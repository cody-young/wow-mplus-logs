/**
 * Finding the WoW log directory.
 *
 * On Windows there is a default worth trying first: Blizzard's installer puts
 * the client in `Program Files (x86)\World of Warcraft` — the 32-bit one, even
 * for the 64-bit client — and most installs are still there. On Linux there is
 * no single location at all: the game runs under Wine or Proton and every
 * launcher puts its prefix somewhere different. Either way the search is the
 * same shape — look for a `_retail_/Logs` directory under a few likely roots,
 * bounded in depth so a stray symlink cannot turn this into a scan of the whole
 * home directory — and either way it can come up empty, which is what the file
 * picker in the main process is for.
 */
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Linux roots, relative to the home directory. */
const LINUX_ROOTS = [
  'Games',
  '.wine/drive_c/Program Files (x86)',
  '.local/share/Steam/steamapps/compatdata',
  '.var/app/com.usebottles.bottles/data/bottles/bottles',
  'Documents',
];

/**
 * Where an install might be, best guess first.
 *
 * The Windows list reads `ProgramFiles` from the environment as well as
 * hardcoding `C:\`, because the two disagree on a machine that moved Program
 * Files to another drive and the literal path is still the one Blizzard's
 * installer offers. The second drive letter is not worth guessing: an install
 * somewhere else entirely is what the picker handles.
 */
function candidateRoots(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    const bases = [
      process.env['ProgramFiles(x86)'],
      process.env['ProgramFiles'],
      'C:\\Program Files (x86)',
      'C:\\Program Files',
    ];
    const roots = bases
      .filter((base): base is string => base !== undefined && base !== '')
      .map((base) => join(base, 'World of Warcraft'));
    // Battle.net can be pointed anywhere, but it offers the drive root as the
    // other option often enough to be worth the one readdir it costs.
    roots.push('C:\\World of Warcraft', join(home, 'Documents'));
    return [...new Set(roots)];
  }
  return LINUX_ROOTS.map((relative) => join(home, relative));
}

const MAX_DEPTH = 7;
const MAX_VISITS = 4000;

/** Directories that are never on the way to a WoW install. */
const SKIP = new Set(['node_modules', '.git', 'Cache', 'cache', 'Interface', 'Data', 'proc', 'sys']);

async function* findLogDirs(root: string): AsyncGenerator<string> {
  let visits = 0;
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    if (depth > MAX_DEPTH || visits++ > MAX_VISITS) continue;

    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      continue; // unreadable or vanished; not worth reporting
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
      const full = join(path, entry.name);
      if (entry.name === 'Logs' && path.endsWith('_retail_')) {
        yield full;
        continue; // no need to descend into Logs
      }
      queue.push({ path: full, depth: depth + 1 });
    }
  }
}

export interface LogFile {
  path: string;
  sizeBytes: number;
  modifiedMs: number;
}

/** Combat logs in a directory, newest first. */
export async function listLogs(directory: string): Promise<LogFile[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: LogFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('WoWCombatLog')) continue;
    try {
      const info = await stat(join(directory, entry.name));
      files.push({ path: join(directory, entry.name), sizeBytes: info.size, modifiedMs: info.mtimeMs });
    } catch {
      continue;
    }
  }
  return files.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/**
 * The most recently written combat log found anywhere in the candidate roots,
 * or null. Returns the newest across all installs, which is what someone with
 * both a live and a PTR install actually wants.
 */
export async function findLatestLog(): Promise<string | null> {
  let best: LogFile | null = null;

  for (const root of candidateRoots()) {
    for await (const directory of findLogDirs(root)) {
      for (const file of await listLogs(directory)) {
        if (best === null || file.modifiedMs > best.modifiedMs) best = file;
        break; // listLogs is sorted, so the first is this directory's newest
      }
    }
  }
  return best?.path ?? null;
}

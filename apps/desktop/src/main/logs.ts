/**
 * Finding the WoW log directory on Linux.
 *
 * There is no single location: the game runs under Wine or Proton and every
 * launcher puts its prefix somewhere different. Rather than hardcode one path,
 * search a few likely roots for a `_retail_/Logs` directory, bounded in depth so
 * a stray symlink cannot turn this into a scan of the whole home directory.
 */
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CANDIDATE_ROOTS = [
  'Games',
  '.wine/drive_c/Program Files (x86)',
  '.local/share/Steam/steamapps/compatdata',
  '.var/app/com.usebottles.bottles/data/bottles/bottles',
  'Documents',
];

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
  const home = homedir();
  let best: LogFile | null = null;

  for (const relative of CANDIDATE_ROOTS) {
    const root = join(home, relative);
    for await (const directory of findLogDirs(root)) {
      for (const file of await listLogs(directory)) {
        if (best === null || file.modifiedMs > best.modifiedMs) best = file;
        break; // listLogs is sorted, so the first is this directory's newest
      }
    }
  }
  return best?.path ?? null;
}

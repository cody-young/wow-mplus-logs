/**
 * The handful of things worth remembering between launches.
 *
 * One small JSON file in userData, beside the icon cache. It is read once and
 * merged on every write, which matters as soon as there is more than one
 * setting: a caller that serialises only what it knows about silently drops
 * everyone else's keys. A missing or hand-edited-into-invalid file means the
 * defaults, never a failed start.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

export interface Settings {
  /** Whether the startup update check runs. */
  automaticUpdates: boolean;
  /**
   * The WoW Logs directory the reader pointed us at, when the install search
   * could not find one. Null until they are asked.
   */
  logDirectory: string | null;
  /**
   * Where the window was when last moved or resized: its normal (unmaximized)
   * bounds plus whether it was maximized over them. Null until it first moves.
   */
  window: WindowPlacement | null;
}

export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULTS: Settings = { automaticUpdates: true, logDirectory: null, window: null };

function isPlacement(value: unknown): value is WindowPlacement {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(record[key])) &&
    typeof record['maximized'] === 'boolean'
  );
}

let current: Settings = { ...DEFAULTS };
let loaded: Promise<Settings> | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

async function read(): Promise<Settings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath(), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record['automaticUpdates'] === 'boolean') {
        current.automaticUpdates = record['automaticUpdates'];
      }
      if (typeof record['logDirectory'] === 'string' && record['logDirectory'] !== '') {
        current.logDirectory = record['logDirectory'];
      }
      if (isPlacement(record['window'])) {
        current.window = record['window'];
      }
    }
  } catch {
    // No settings yet, or an unreadable file. The defaults stand.
  }
  return current;
}

/** The stored settings, read from disk the first time and cached after. */
export async function load(): Promise<Settings> {
  loaded ??= read();
  return loaded;
}

/** Merge a change in and write the whole file back. */
export async function save(change: Partial<Settings>): Promise<void> {
  // Through load() rather than straight onto `current`, so a write that lands
  // before the first read cannot overwrite the file with defaults.
  await load();
  current = { ...current, ...change };
  try {
    await writeFile(settingsPath(), JSON.stringify(current, null, 2), 'utf8');
  } catch {
    // The choice holds for this session; it just will not be remembered.
  }
}

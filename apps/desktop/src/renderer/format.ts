import type { DeathReport, RunMeta } from '../shared.js';

/** Compact number, the way damage meters write them. */
export function short(value: number): string {
  const n = Math.abs(value);
  if (n >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toString();
}

/** mm:ss from a run-relative millisecond offset. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function integer(value: number): string {
  return value.toLocaleString('en-US');
}

/** Byte counts, for download sizes and rates. */
export function megabytes(value: number): string {
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

/** Raid difficulty ids as the game names them; legacy ids carry their size. */
const DIFFICULTIES: Record<number, string> = {
  3: '10 Normal',
  4: '25 Normal',
  5: '10 Heroic',
  6: '25 Heroic',
  7: 'LFR',
  9: '40 Player',
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  33: 'Timewalking',
  151: 'Timewalking LFR',
  220: 'Story',
};

export function difficultyName(difficultyId: number): string {
  return DIFFICULTIES[difficultyId] ?? `Difficulty ${difficultyId}`;
}

/**
 * A run as one line: "+12 Ara-Kara, City of Echoes", or "Ulgrax the Devourer
 * (Mythic, pull 12)" for a raid pull.
 */
export function runTitle(meta: RunMeta): string {
  return meta.kind === 'key'
    ? `+${meta.keystoneLevel} ${meta.zoneName}`
    : `${meta.encounterName} (${difficultyName(meta.difficultyId)}, pull ${meta.pull})`;
}

/**
 * How long a run took, as the game would put it: the keystone timer for a key,
 * death penalty included, and the fight's length for a raid pull.
 */
export function runClock(meta: RunMeta): string {
  return clock((meta.kind === 'key' ? meta.totalTimeMs : meta.elapsedMs) ?? 0);
}

/**
 * On a raid wipe, how many deaths count before the rest are the raid going
 * down; null when every death counts.
 *
 * A wipe ends with most of the raid dying in a few seconds, after the call
 * was made or the enrage hit, and none of those deaths explains anything —
 * but newest-first, they are the whole top of the list. The cut is the death
 * that left a quarter of the roster dead at once, five of twenty, which is
 * where a raid stops recovering; it is kept, and everything after it folded.
 * At once, not in total: battle res and soulstones bring people back, and
 * counted in total the cut lands minutes before the wipe did.
 *
 * A kill keeps every death, since each one was survivable, and so does a key.
 */
export function wipeCutoff(meta: RunMeta, deaths: readonly DeathReport[]): number | null {
  if (meta.kind !== 'raid' || meta.success !== false) return null;
  const quarter = Math.max(1, Math.ceil(meta.party.length / 4));
  const crossing = deaths.findIndex((death) => death.deadAtOnce >= quarter);
  return crossing === -1 ? null : crossing + 1;
}

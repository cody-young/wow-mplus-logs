import { Ev, EvFlag, type MapBounds } from '@mplus/parser';

import { actorName, type AnalysisContext } from './context.js';
import type { SegmentIndex } from './segments.js';

/**
 * Position tracks: where every party member and every engaged enemy was, and
 * when.
 *
 * The combat log has no movement events. A unit's position reaches it only as
 * a side effect, in the advanced block of a row about that unit — a hit it
 * took, a heal it cast. So a track is as dense as the unit was busy: a tank
 * mid-pull has one every few milliseconds, a healer drinking has none, and an
 * enemy has nothing at all before it is engaged. That is enough to draw a pull
 * and to replay a fight, and it is not a movement trace; a gap is a stretch in
 * which the unit did nothing, not one in which it stood still.
 *
 * Tracks are columns rather than an array of points, for the same reason the
 * store is: a key holds tens of thousands of samples, and typed arrays cross to
 * the renderer as a copy of their bytes.
 */

export const enum TrackKind {
  PARTY = 0,
  ENEMY = 1,
}

export interface PositionTrack {
  actor: number;
  kind: TrackKind;
  name: string;
  /** Creature id for an enemy, -1 for a player. */
  npcId: number;
  /** The segment an enemy was engaged in, -1 for a player. */
  segmentId: number;
  /** Store-relative ms of each UNIT_DIED. A player can die several times. */
  deaths: number[];
  /** Store-relative ms, non-decreasing. */
  ts: Int32Array;
  x: Float32Array;
  y: Float32Array;
  uiMapId: Uint16Array;
  /**
   * Health as a whole percentage, or 255 when the row carried none.
   *
   * A byte rather than the two health columns: a replay draws a bar, which
   * needs no more than this, and it is a ninth of the size.
   */
  hpPct: Uint8Array;
  /**
   * Where an enemy stood before it was moved: its first position at full
   * health, or its first position at all when it was never seen untouched.
   *
   * The first sample is not good enough on its own. It is the first row about
   * the enemy, and on a pull the tank gathers for, the enemy has often been
   * walking towards the tank for seconds by then. Full health means nothing
   * has hit it yet, which is the nearest the log comes to "where it spawned".
   * That is the point to place on a route planner's map. Null for players.
   */
  home: TrackPoint | null;
}

export interface TrackPoint {
  ts: number;
  x: number;
  y: number;
  uiMapId: number;
}

export interface PositionReport {
  /** The run's maps and their world bounds, from `RunMeta.maps`. */
  maps: readonly MapBounds[];
  /** Party first, in party order, then enemies in the order first engaged. */
  tracks: PositionTrack[];
}

export interface PositionOptions {
  /**
   * Shortest gap kept between two samples of one unit, in ms. Rows closer than
   * this are dropped, except one that moves the unit onto another map.
   *
   * A pull logs hundreds of rows a second about the tank, all within a step of
   * each other. Four a second is smooth at any replay speed worth watching.
   */
  minIntervalMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 250;
const NO_HP = 255;

/** Growable columns for one unit while the store is scanned. */
interface Builder {
  actor: number;
  ts: number[];
  x: number[];
  y: number[];
  uiMapId: number[];
  hpPct: number[];
  deaths: number[];
  /** First sample of any kind, and first at full health before any hurt one. */
  first: TrackPoint | null;
  untouched: TrackPoint | null;
  hurt: boolean;
}

export function positionTracks(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: PositionOptions = {},
): PositionReport {
  const { run } = context;
  const { store, actors } = run;
  const minInterval = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  const builders = new Map<number, Builder>();
  const order: Builder[] = [];
  const builderOf = (actor: number): Builder => {
    let builder = builders.get(actor);
    if (builder === undefined) {
      builder = { actor, ts: [], x: [], y: [], uiMapId: [], hpPct: [], deaths: [], first: null, untouched: null, hurt: false };
      builders.set(actor, builder);
      order.push(builder);
    }
    return builder;
  };
  // Players only, not their pets: `party` holds the players themselves, and
  // a pet's position is its owner's give or take a few yards.
  const tracked = (actor: number): boolean =>
    actor >= 0 && (segments.party.has(actor) || (actor < segments.enemySegment.length && segments.enemySegment[actor]! >= 0));

  for (const actor of run.meta.party) builderOf(actor);

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    if (code === Ev.UNIT_DIED || code === Ev.UNIT_DESTROYED) {
      const victim = store.dstActor[row]!;
      // A Feign Death is not a death to mark on the map.
      if (tracked(victim) && (store.flags[row]! & EvFlag.FEIGNED) === 0) builderOf(victim).deaths.push(store.ts[row]!);
      continue;
    }

    const flags = store.flags[row]!;
    if ((flags & EvFlag.ADVANCED) === 0) continue;
    const subject = flags & EvFlag.INFO_IS_SOURCE ? store.srcActor[row]! : store.dstActor[row]!;
    if (!tracked(subject)) continue;
    const x = store.posX[row]!;
    const y = store.posY[row]!;
    const map = store.uiMapId[row]!;
    // 0,0 is a block with no position, not a unit at the world origin.
    if ((x === 0 && y === 0) || map === 0) continue;

    const ts = store.ts[row]!;
    const hp = store.hpCurrent[row]!;
    const hpMax = store.hpMax[row]!;
    const builder = builderOf(subject);

    if (builder.first === null) builder.first = { ts, x, y, uiMapId: map };
    // Only until it is first seen hurt: back at full after that is a heal or
    // an evade, and neither puts it back where it spawned.
    if (builder.untouched === null && !builder.hurt && hpMax > 0) {
      if (hp >= hpMax) builder.untouched = { ts, x, y, uiMapId: map };
      else if (hp >= 0) builder.hurt = true;
    }

    const n = builder.ts.length;
    if (n > 0 && ts - builder.ts[n - 1]! < minInterval && builder.uiMapId[n - 1] === map) continue;
    builder.ts.push(ts);
    builder.x.push(x);
    builder.y.push(y);
    builder.uiMapId.push(map);
    builder.hpPct.push(hp >= 0 && hpMax > 0 ? Math.min(100, Math.round((hp / hpMax) * 100)) : NO_HP);
  }

  const tracks: PositionTrack[] = [];
  for (const builder of order) {
    const actor = actors.at(builder.actor);
    const isParty = segments.party.has(builder.actor);
    tracks.push({
      actor: builder.actor,
      kind: isParty ? TrackKind.PARTY : TrackKind.ENEMY,
      name: actorName(context, builder.actor),
      npcId: isParty ? -1 : (actor?.npcId ?? -1),
      segmentId: isParty ? -1 : segments.enemySegment[builder.actor]!,
      deaths: builder.deaths,
      ts: Int32Array.from(builder.ts),
      x: Float32Array.from(builder.x),
      y: Float32Array.from(builder.y),
      uiMapId: Uint16Array.from(builder.uiMapId),
      hpPct: Uint8Array.from(builder.hpPct),
      home: isParty ? null : (builder.untouched ?? builder.first),
    });
  }

  return { maps: run.meta.maps, tracks };
}

/**
 * Where a unit was at `ts`, for a replay's playhead.
 *
 * Linear between the samples either side when both are on one map and close
 * together, and otherwise the last sample held. Interpolating across a long
 * gap would glide a unit along a line it never walked — through a wall, as
 * often as not — when all the log says is that it was quiet in between.
 * Null before the first sample: the unit had not been seen yet.
 */
export function positionAt(track: PositionTrack, ts: number, maxGapMs = 2000): TrackPoint | null {
  const n = track.ts.length;
  if (n === 0 || ts < track.ts[0]!) return null;
  // Last sample at or before ts.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (track.ts[mid]! <= ts) lo = mid;
    else hi = mid - 1;
  }
  const a = lo;
  const b = a + 1;
  const point = { ts, x: track.x[a]!, y: track.y[a]!, uiMapId: track.uiMapId[a]! };
  if (b >= n || track.uiMapId[b] !== point.uiMapId) return point;
  const span = track.ts[b]! - track.ts[a]!;
  if (span <= 0 || span > maxGapMs) return point;
  const t = (ts - track.ts[a]!) / span;
  point.x += (track.x[b]! - point.x) * t;
  point.y += (track.y[b]! - point.y) * t;
  return point;
}

/**
 * A step longer than this, at faster than `TELEPORT_YARDS_PER_SECOND`, is a
 * teleport rather than travel: a release to the graveyard, a dungeon's portal.
 *
 * Across three keys, steps faster than 30 yards a second were 121 within 50
 * yards — blinks, leaps, gateways, which are travel the player chose — and 9
 * from 50 to 400 yards, every one a teleport.
 */
const TELEPORT_YARDS = 50;
const TELEPORT_YARDS_PER_SECOND = 30;

/**
 * How far a unit went over its track, in yards: the straight line between
 * each sample and the next on one map, less teleports.
 *
 * A floor for the true figure. A quiet stretch counts as the line from where
 * it began to where it ended, so a path round a corner in it is cut short.
 */
export function distanceTravelled(track: PositionTrack): number {
  let yards = 0;
  for (let i = 1; i < track.ts.length; i++) {
    if (track.uiMapId[i] !== track.uiMapId[i - 1]) continue;
    const step = Math.hypot(track.x[i]! - track.x[i - 1]!, track.y[i]! - track.y[i - 1]!);
    const seconds = (track.ts[i]! - track.ts[i - 1]!) / 1000;
    if (step > TELEPORT_YARDS && step > TELEPORT_YARDS_PER_SECOND * seconds) continue;
    yards += step;
  }
  return yards;
}

/**
 * A world position as a fraction of its map's image: u across from the left
 * edge, v down from the top, both 0..1 inside the map.
 *
 * World X runs north and world Y runs west, so the image's horizontal axis is
 * Y reversed and its vertical axis is X reversed. That quarter turn is the
 * +90 degrees the MDT calibration found between log and planner coordinates.
 */
export function mapPoint(bounds: MapBounds, x: number, y: number): { u: number; v: number } {
  const width = bounds.maxY - bounds.minY;
  const height = bounds.maxX - bounds.minX;
  return {
    u: width > 0 ? (bounds.maxY - y) / width : 0,
    v: height > 0 ? (bounds.maxX - x) / height : 0,
  };
}

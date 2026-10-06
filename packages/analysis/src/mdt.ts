import type { MdtClone, MdtDungeon } from '@mplus/data';

import { TrackKind, type PositionReport } from './positions.js';

/**
 * Placing a run on Mythic Dungeon Tools' map.
 *
 * MDT draws a dungeon on its own 840 by 555 canvas, with every floor scaled
 * and placed on it by hand, so there is no one transform from the log's world
 * coordinates to MDT's. There is one per floor, though, and its shape is
 * known: calibration against a season of keys found every floor rotated by a
 * quarter turn with no mirroring, so a floor's transform is
 *
 *   mdt = s · i · world + b        (complex numbers, world = x + iy)
 *
 * — one scale and one offset. They are fitted from the run itself, by matching
 * each kill's starting point to the MDT spawns of the same creature: RANSAC
 * over pairs of kills, then least squares over the kills that agree.
 *
 * Fitting per run rather than shipping a table keeps every number MDT owns on
 * the user's disk, and follows MDT when it redraws a map. The cost is that a
 * floor with few kills, or with most of them dragged from where they stood,
 * fits badly or fits two ways at once. Such a floor is marked `good: false`
 * rather than trusted, and the map draws it in the log's own coordinates
 * instead. Pooling a floor's kills across many runs would settle most of
 * those; one run is all this sees.
 */

export interface MdtFloorFit {
  uiMapId: number;
  /** The MDT sublevel this floor is drawn on. */
  sublevel: number;
  /** The transform: MDT x = offsetX − scale·y, MDT y = offsetY + scale·x. */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Kills on this floor of creatures MDT has spawns for: what the fit had to go on. */
  observed: number;
  /** How many of them landed within `MDT_MATCH_UNITS` of a spawn of their own creature. */
  matched: number;
  /** Median distance of the matched kills from their spawns, in MDT units. */
  error: number;
  /**
   * Kills matched by the best transform that places them somewhere else
   * entirely: more than two match radii away for at least one kill.
   */
  rival: number;
  /**
   * Whether the fit is worth drawing with: at least six kills matched, at
   * least three in ten, and clearly more than any rival matched.
   *
   * The rival is the test that matters. A floor whose kills are few, or are
   * mostly creatures with many spawns, can fit two ways nearly equally well,
   * and the run alone cannot say which is right: across three keys of one
   * floor, two picked a wrong scale by a single kill. A wrong fit looks
   * exactly as confident as a right one, so a close rival means drawing the
   * floor from the log instead.
   */
  good: boolean;
}

/** One kill placed on the MDT spawn it most likely was. */
export interface MdtMatch {
  actor: number;
  /** MDT's enemy and clone numbers, as a route refers to them. */
  enemyIndex: number;
  cloneIndex: number;
  /** In MDT units. */
  distance: number;
}

export interface MdtPlacement {
  dungeon: MdtDungeon;
  /** One per floor that had enough kills to fit, in uiMap order. */
  floors: MdtFloorFit[];
  /**
   * Kills matched to a spawn on a good floor, at most one kill per spawn.
   *
   * A kill dragged further than `MDT_MATCH_UNITS` from where MDT puts it is
   * left out rather than given the nearest free spawn, which on a dense floor
   * is as likely another pack's.
   */
  matches: MdtMatch[];
}

/** How close a kill must land to a spawn to count as that spawn, in MDT units. */
export const MDT_MATCH_UNITS = 12;

const MIN_OBSERVED = 6;
/** A fit is trusted only when its rival matched at most this share of its kills… */
const MAX_RIVAL_SHARE = 0.85;
/** …and at least this many fewer. */
const MIN_RIVAL_MARGIN = 3;
const ITERATIONS = 6000;
/** Closer than this, in yards, two kills say nothing about scale. */
const MIN_PAIR_YARDS = 15;
/** The widest scales a season of floors needed were 0.74 and 4.0. */
const MIN_SCALE = 0.2;
const MAX_SCALE = 6;

interface Spawn {
  enemyIndex: number;
  clone: MdtClone;
}

interface Observation {
  actor: number;
  x: number;
  y: number;
  candidates: Spawn[];
}

interface Transform {
  s: number;
  bx: number;
  by: number;
}

/** A world position on MDT's canvas under a floor's fit. */
export function toMdt(fit: Pick<MdtFloorFit, 'scale' | 'offsetX' | 'offsetY'>, x: number, y: number): [number, number] {
  return [fit.offsetX - fit.scale * y, fit.offsetY + fit.scale * x];
}

/**
 * Fits each floor of a run to MDT's map of the dungeon.
 *
 * Only kills are used: a route is made of them, and what lives is mostly
 * summons and scripted adds. A creature killed more often than MDT has spawns
 * for is a summon too, whatever MDT calls it, and is left out. Each kill is
 * placed by its track's `home`, its first position before it was hurt.
 */
export function placeOnMdt(report: PositionReport, dungeon: MdtDungeon): MdtPlacement {
  const spawnsByNpc = new Map<number, Spawn[]>();
  for (const enemy of dungeon.enemies) {
    const list = spawnsByNpc.get(enemy.npcId) ?? [];
    for (const clone of enemy.clones) list.push({ enemyIndex: enemy.index, clone });
    spawnsByNpc.set(enemy.npcId, list);
  }

  const kills = report.tracks.filter(
    (track) => track.kind === TrackKind.ENEMY && track.deaths.length > 0 && track.home !== null,
  );
  const killsByNpc = new Map<number, number>();
  for (const track of kills) killsByNpc.set(track.npcId, (killsByNpc.get(track.npcId) ?? 0) + 1);

  const byMap = new Map<number, typeof kills>();
  for (const track of kills) {
    const spawns = spawnsByNpc.get(track.npcId);
    if (spawns === undefined || killsByNpc.get(track.npcId)! > spawns.length) continue;
    const uiMapId = track.home!.uiMapId;
    const list = byMap.get(uiMapId);
    if (list === undefined) byMap.set(uiMapId, [track]);
    else list.push(track);
  }

  const floors: MdtFloorFit[] = [];
  const matches: MdtMatch[] = [];
  for (const [uiMapId, tracks] of [...byMap].sort((a, b) => a[0] - b[0])) {
    let best: { fit: MdtFloorFit; pairs: Pair[] } | null = null;
    for (const { index: sublevel } of dungeon.sublevels) {
      const observations: Observation[] = [];
      for (const track of tracks) {
        const candidates = spawnsByNpc.get(track.npcId)!.filter((spawn) => spawn.clone.sublevel === sublevel);
        if (candidates.length > 0) {
          observations.push({ actor: track.actor, x: track.home!.x, y: track.home!.y, candidates });
        }
      }
      // Seeded from the floor, so a run always draws the same way.
      const result = fit(observations, uiMapId * 31 + sublevel);
      if (result === null) continue;
      const { t, pairs, rival } = result;
      const distances = pairs.map((pair) => pair.d).sort((a, b) => a - b);
      const candidate: MdtFloorFit = {
        uiMapId,
        sublevel,
        scale: t.s,
        offsetX: t.bx,
        offsetY: t.by,
        observed: observations.length,
        matched: pairs.length,
        error: distances[distances.length >> 1] ?? Infinity,
        rival,
        good:
          pairs.length >= Math.max(MIN_OBSERVED, observations.length * 0.3) &&
          rival <= pairs.length * MAX_RIVAL_SHARE &&
          pairs.length - rival >= MIN_RIVAL_MARGIN,
      };
      if (best === null || candidate.matched > best.fit.matched) best = { fit: candidate, pairs };
    }
    if (best === null) continue;
    floors.push(best.fit);
    if (!best.fit.good) continue;
    for (const pair of best.pairs) {
      matches.push({
        actor: pair.o.actor,
        enemyIndex: pair.c.enemyIndex,
        cloneIndex: pair.c.clone.index,
        distance: pair.d,
      });
    }
  }
  return { dungeon, floors, matches };
}

interface Pair {
  o: Observation;
  c: Spawn;
  d: number;
}

/** Mulberry32, so a fit is the same every time it is drawn. */
function rng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The transform that lands the most kills on spawns of their own creature, or
 * null under six kills: two define a fit, and a handful more are the least
 * that can outvote a bad pair.
 */
function fit(observations: Observation[], seed: number): { t: Transform; pairs: Pair[]; rival: number } | null {
  if (observations.length < MIN_OBSERVED) return null;
  const random = rng(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  let best: Transform | null = null;
  let bestScore = -1;
  const tried: Array<{ t: Transform; score: number }> = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const a = pick(observations);
    const b = pick(observations);
    const dwx = b.x - a.x;
    const dwy = b.y - a.y;
    if (Math.hypot(dwx, dwy) < MIN_PAIR_YARDS) continue;
    const ca = pick(a.candidates).clone;
    const cb = pick(b.candidates).clone;
    // (zb − za) / (i·(wb − wa)) is the scale, and must come out a positive real.
    const ix = -dwy;
    const iy = dwx;
    const dzx = cb.x - ca.x;
    const dzy = cb.y - ca.y;
    const den = ix * ix + iy * iy;
    const re = (dzx * ix + dzy * iy) / den;
    const im = (dzy * ix - dzx * iy) / den;
    if (!(re > MIN_SCALE && re < MAX_SCALE) || Math.abs(im) > re * 0.15) continue;
    const t = { s: re, bx: ca.x + re * a.y, by: ca.y - re * a.x };
    const score = assign(t, observations).length;
    if (score >= 3) tried.push({ t, score });
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best === null) return null;
  let t = best;
  let pairs = assign(t, observations);
  for (let round = 0; round < 3 && pairs.length >= 3; round++) {
    t = solve(pairs);
    pairs = assign(t, observations);
  }
  // The best of the transforms that put the kills somewhere else entirely.
  let rival = 0;
  for (const candidate of tried) {
    if (candidate.score <= rival || !distinct(t, candidate.t, observations)) continue;
    let r = candidate.t;
    let rivalPairs = assign(r, observations);
    for (let round = 0; round < 3 && rivalPairs.length >= 3; round++) {
      r = solve(rivalPairs);
      rivalPairs = assign(r, observations);
    }
    if (distinct(t, r, observations)) rival = Math.max(rival, rivalPairs.length);
  }
  return { t, pairs, rival };
}

/** Whether two transforms disagree by more than two match radii about where some kill stood. */
function distinct(a: Transform, b: Transform, observations: Observation[]): boolean {
  for (const o of observations) {
    const du = a.bx - a.s * o.y - (b.bx - b.s * o.y);
    const dv = a.by + a.s * o.x - (b.by + b.s * o.x);
    if (Math.hypot(du, dv) > MDT_MATCH_UNITS * 2) return true;
  }
  return false;
}

/**
 * Kills matched to spawns one to one, closest pairs first, within
 * `MDT_MATCH_UNITS`.
 *
 * Nearest-spawn scoring lets a too-small scale pile every kill of a creature
 * onto one spawn and call them all matched; letting a spawn be claimed once
 * is what makes that collapse score badly.
 */
function assign(t: Transform, observations: Observation[]): Pair[] {
  const edges: Pair[] = [];
  for (const o of observations) {
    const u = t.bx - t.s * o.y;
    const v = t.by + t.s * o.x;
    for (const c of o.candidates) {
      const d = Math.hypot(c.clone.x - u, c.clone.y - v);
      if (d < MDT_MATCH_UNITS) edges.push({ o, c, d });
    }
  }
  edges.sort((a, b) => a.d - b.d);
  const usedObservations = new Set<Observation>();
  const usedSpawns = new Set<Spawn>();
  const pairs: Pair[] = [];
  for (const edge of edges) {
    if (usedObservations.has(edge.o) || usedSpawns.has(edge.c)) continue;
    usedObservations.add(edge.o);
    usedSpawns.add(edge.c);
    pairs.push(edge);
  }
  return pairs;
}

/** Least squares for scale and offset over matched pairs, the quarter turn held fixed. */
function solve(pairs: Pair[]): Transform {
  let ux = 0;
  let uy = 0;
  let zx = 0;
  let zy = 0;
  for (const { o, c } of pairs) {
    ux += -o.y;
    uy += o.x;
    zx += c.clone.x;
    zy += c.clone.y;
  }
  const n = pairs.length;
  ux /= n;
  uy /= n;
  zx /= n;
  zy /= n;
  let num = 0;
  let den = 0;
  for (const { o, c } of pairs) {
    const du = -o.y - ux;
    const dv = o.x - uy;
    num += du * (c.clone.x - zx) + dv * (c.clone.y - zy);
    den += du * du + dv * dv;
  }
  const s = den > 0 ? num / den : 1;
  return { s, bx: zx - s * ux, by: zy - s * uy };
}

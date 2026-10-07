import { mdtFloorsFor, type MdtClone, type MdtDungeon, type MdtFloorTransform } from '@mplus/data';

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
 * Fitting per run follows MDT when it redraws a map. The cost is that a floor
 * with few kills, or with most of them dragged from where they stood, fits
 * badly or fits two ways at once: a floor whose kills are three packs has
 * only three distances to set a scale from. A fit the run does not trust gets
 * two more chances, in turn:
 *
 * - `mdtFloorsFor`, the same fit pooled over many keys and shipped in
 *   `@mplus/data`, provided the run's kills agree with it.
 * - The same fit again, counting near misses that the pull backs up. A kill
 *   first seen within a few seconds of another, both landing on spawns of the
 *   same MDT pack, was pulled with it, and is that pack's even if it had
 *   wandered a little before the log saw it. A wrong scale puts one pull's
 *   kills on different packs and gets no such credit. This is what places a
 *   floor the table has nothing for, such as a new season's.
 *
 * A floor with none of these is marked `good: false`, and the map draws it in
 * the log's own coordinates instead.
 *
 * Once a floor is placed, its kills are matched pack by pack, since a pack
 * pulls whole: see `byPull`. That only decides which spawn each kill was; the
 * fit is made, and scored, from the kills that landed on their own.
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
  /**
   * How many of them landed within `MDT_MATCH_UNITS` of a spawn of their own
   * creature, or for a fit `byPacks`, within `PACK_MATCH_UNITS` of one with a
   * pack-mate to back it.
   */
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
   * exactly as confident as a right one, so a close rival means the shipped
   * fit for the floor if the run agrees with it, then another look with the
   * pulls to go on, and the log if neither settles it.
   */
  good: boolean;
  /**
   * Whether the transform is the shipped one from `mdtFloorsFor` rather than
   * the run's own. `matched` and `error` are then the shipped fit's score on
   * this run, and `rival` is still the run's own fit's.
   */
  fromTable: boolean;
  /** Whether `matched` and `rival` count the near misses a pull backs up. */
  byPacks: boolean;
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
   * Kills matched to a spawn on a good floor, at most one kill per spawn, and
   * every MDT pack's kills from a single pull.
   *
   * A kill dragged further than `MDT_MATCH_UNITS` from where MDT puts it, or
   * on a floor fitted `byPacks` further than `PACK_MATCH_UNITS` or with no
   * pack-mate beside it, is left out rather than given the nearest free spawn,
   * which on a dense floor is as likely another pack's. The exception is a
   * pack its pull matched some of: a pack pulls whole, so the pull's other
   * kills of its creatures fill it out to `PULL_FILL_UNITS`. A pack that is
   * still not whole after that is left out too.
   */
  matches: MdtMatch[];
}

/** How close a kill must land to a spawn to count as that spawn, in MDT units. */
export const MDT_MATCH_UNITS = 12;
/** How close a kill with a pack-mate to back it must land, in MDT units. */
export const PACK_MATCH_UNITS = 25;
/**
 * Kills first seen this close together, in ms, were pulled together. A pack
 * pulls all at once, but the log first sees each mob when it first acts or is
 * hit, which for the back of a pack can be a moment later.
 */
const PACK_WINDOW_MS = 3000;
/** How far a kill may land from a spawn of a pack its pull took, in MDT units. */
export const PULL_FILL_UNITS = 40;

const MIN_OBSERVED = 6;
/**
 * A shipped fit is checked against the run, not fitted to it, so fewer kills
 * will do: three on a spawn of their own creature is no coincidence.
 */
const MIN_TABLE_MATCHED = 3;
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
  /** When the log first saw it, for telling which kills were pulled together. */
  ts: number;
  /** The pull it died in, or -1 if it was never engaged. */
  segment: number;
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
 *
 * `known` is the shipped table, a parameter so a test can supply its own.
 */
export function placeOnMdt(
  report: PositionReport,
  dungeon: MdtDungeon,
  known: readonly MdtFloorTransform[] = mdtFloorsFor(dungeon.challengeModeId),
): MdtPlacement {
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
    const observe = (sublevel: number): Observation[] => {
      const observations: Observation[] = [];
      for (const track of tracks) {
        const candidates = spawnsByNpc.get(track.npcId)!.filter((spawn) => spawn.clone.sublevel === sublevel);
        if (candidates.length > 0) {
          observations.push({ actor: track.actor, x: track.home!.x, y: track.home!.y, ts: track.home!.ts, segment: track.segmentId, candidates });
        }
      }
      return observations;
    };
    /** The best of the floor's sublevels under one way of scoring. */
    const fitFloor = (score: Score): Fitted | null => {
      let best: Fitted | null = null;
      for (const { index: sublevel } of dungeon.sublevels) {
        const observations = observe(sublevel);
        // Seeded from the floor, so a run always draws the same way.
        const result = fit(observations, uiMapId * 31 + sublevel, score);
        if (result === null) continue;
        const { t, pairs, rival } = result;
        const candidate: MdtFloorFit = {
          uiMapId,
          sublevel,
          scale: t.s,
          offsetX: t.bx,
          offsetY: t.by,
          observed: observations.length,
          matched: pairs.length,
          error: medianDistance(pairs),
          rival,
          good:
            pairs.length >= Math.max(MIN_OBSERVED, observations.length * 0.3) &&
            rival <= pairs.length * MAX_RIVAL_SHARE &&
            pairs.length - rival >= MIN_RIVAL_MARGIN,
          fromTable: false,
          byPacks: score === assignByPack,
        };
        if (best === null || candidate.matched > best.fit.matched) best = { fit: candidate, pairs };
      }
      return best;
    };

    const shipped = known.find(
      (floor) => floor.uiMapId === uiMapId && dungeon.sublevels.some((level) => level.index === floor.sublevel),
    );
    /** The shipped fit, if the run agrees with it when scored as `own` was. */
    const fromTable = (score: Score, own: Fitted | null): Fitted | null => {
      if (shipped === undefined) return null;
      const observations = observe(shipped.sublevel);
      const pairs = score({ s: shipped.scale, bx: shipped.offsetX, by: shipped.offsetY }, observations);
      // The run agrees with the shipped fit when enough of its kills land on
      // spawns under it, and its own best fit does not clearly beat it. One
      // that does is what a redrawn map looks like.
      if (
        pairs.length < Math.max(MIN_TABLE_MATCHED, observations.length * 0.3) ||
        (own !== null && own.fit.matched - pairs.length >= MIN_RIVAL_MARGIN)
      ) {
        return null;
      }
      return {
        fit: {
          uiMapId,
          sublevel: shipped.sublevel,
          scale: shipped.scale,
          offsetX: shipped.offsetX,
          offsetY: shipped.offsetY,
          observed: observations.length,
          matched: pairs.length,
          error: medianDistance(pairs),
          rival: own?.fit.rival ?? 0,
          good: true,
          fromTable: true,
          byPacks: score === assignByPack,
        },
        pairs,
      };
    };

    // The shipped fit, where the run agrees with it, goes ahead of one backed
    // by packs: the near misses that settle which fit is right also pull it a
    // few units toward themselves. A floor nothing settles is reported by its
    // plain fit, whose numbers say why.
    let best = fitFloor(assign);
    if (best === null || !best.fit.good) {
      const plain = best;
      best = fromTable(assign, plain);
      if (best === null) {
        const byPack = fitFloor(assignByPack);
        best = (byPack?.fit.good ? byPack : null) ?? fromTable(assignByPack, byPack) ?? plain;
      }
    }
    if (best === null) continue;
    floors.push(best.fit);
    if (!best.fit.good) continue;
    const { scale, offsetX, offsetY, sublevel } = best.fit;
    const packSizes = new Map<number, number>();
    for (const enemy of dungeon.enemies) {
      for (const { sublevel: level, group } of enemy.clones) {
        if (level === sublevel && group !== null) packSizes.set(group, (packSizes.get(group) ?? 0) + 1);
      }
    }
    for (const pair of byPull({ s: scale, bx: offsetX, by: offsetY }, observe(sublevel), best.pairs, packSizes)) {
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

/** A floor's fit and the kills it matched. */
interface Fitted {
  fit: MdtFloorFit;
  pairs: Pair[];
}

/** Kills matched to spawns under a transform, one way or another. */
type Score = (t: Transform, observations: Observation[]) => Pair[];

function medianDistance(pairs: Pair[]): number {
  const distances = pairs.map((pair) => pair.d).sort((a, b) => a - b);
  return distances[distances.length >> 1] ?? Infinity;
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
function fit(observations: Observation[], seed: number, score: Score): { t: Transform; pairs: Pair[]; rival: number } | null {
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
    const matched = score(t, observations).length;
    if (matched >= 3) tried.push({ t, score: matched });
    if (matched > bestScore) {
      bestScore = matched;
      best = t;
    }
  }
  if (best === null) return null;
  let t = best;
  let pairs = score(t, observations);
  for (let round = 0; round < 3 && pairs.length >= 3; round++) {
    t = solve(pairs);
    pairs = score(t, observations);
  }
  // The best of the transforms that put the kills somewhere else entirely.
  let rival = 0;
  for (const candidate of tried) {
    if (candidate.score <= rival || !distinct(t, candidate.t, observations)) continue;
    let r = candidate.t;
    let rivalPairs = score(r, observations);
    for (let round = 0; round < 3 && rivalPairs.length >= 3; round++) {
      r = solve(rivalPairs);
      rivalPairs = score(r, observations);
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
 * Kills matched to spawns one to one, closest pairs first, within `radius`.
 *
 * Nearest-spawn scoring lets a too-small scale pile every kill of a creature
 * onto one spawn and call them all matched; letting a spawn be claimed once
 * is what makes that collapse score badly.
 */
function assign(t: Transform, observations: Observation[], radius = MDT_MATCH_UNITS): Pair[] {
  const edges: Pair[] = [];
  for (const o of observations) {
    const u = t.bx - t.s * o.y;
    const v = t.by + t.s * o.x;
    for (const c of o.candidates) {
      const d = Math.hypot(c.clone.x - u, c.clone.y - v);
      if (d < radius) edges.push({ o, c, d });
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

/**
 * `assign` out to `PACK_MATCH_UNITS`, keeping a match past `MDT_MATCH_UNITS`
 * only when a kill first seen within `PACK_WINDOW_MS` of it is matched to the
 * same MDT pack.
 *
 * Loosening the radius alone fits fewer floors, not more: it lets a wrong
 * scale match as much as the right one. The pull is what tells them apart.
 */
function assignByPack(t: Transform, observations: Observation[]): Pair[] {
  const pairs = assign(t, observations, PACK_MATCH_UNITS);
  const byGroup = new Map<number, Pair[]>();
  for (const pair of pairs) {
    const group = pair.c.clone.group;
    if (group === null) continue;
    const list = byGroup.get(group);
    if (list === undefined) byGroup.set(group, [pair]);
    else list.push(pair);
  }
  return pairs.filter(
    (pair) =>
      pair.d < MDT_MATCH_UNITS ||
      (pair.c.clone.group !== null &&
        byGroup
          .get(pair.c.clone.group)!
          .some((other) => other !== pair && Math.abs(other.o.ts - pair.o.ts) <= PACK_WINDOW_MS)),
  );
}

/**
 * A fit's matches made whole pack by pack, as the game pulls them.
 *
 * A pack pulls all at once, so its mobs die in one pull. Each pack goes to the
 * pull that matched the most of it, and a match from any other pull is
 * dropped. Then every mob of the pack is that pull's: its other kills of the
 * same creatures fill the pack's other spawns, out to `PULL_FILL_UNITS`. A
 * tank gathers a pack before the log sees most of it, so these are usually
 * just past `MDT_MATCH_UNITS`, and the pull is what says which spawn they are.
 *
 * A pack that is still not whole is dropped: a pull cannot take part of a
 * pack, so its matches there were some other spawn's, or the log missed the
 * rest of it, and either way a half-pulled pack is not what happened.
 * `packSizes` counts each pack's spawns on the floor's sublevel.
 */
function byPull(t: Transform, observations: Observation[], pairs: Pair[], packSizes: ReadonlyMap<number, number>): Pair[] {
  const byPack = new Map<number, Map<number, { count: number; distance: number }>>();
  for (const { o, c, d } of pairs) {
    const group = c.clone.group;
    if (group === null || o.segment < 0) continue;
    let tally = byPack.get(group);
    if (tally === undefined) byPack.set(group, (tally = new Map()));
    const entry = tally.get(o.segment) ?? { count: 0, distance: 0 };
    entry.count++;
    entry.distance += d;
    tally.set(o.segment, entry);
  }
  const owner = new Map<number, number>();
  for (const [group, tally] of byPack) {
    let best = -1;
    let most = { count: 0, distance: Infinity };
    for (const [segment, entry] of tally) {
      if (entry.count > most.count || (entry.count === most.count && entry.distance < most.distance)) {
        best = segment;
        most = entry;
      }
    }
    owner.set(group, best);
  }
  const ownedBy = (c: Spawn): number | undefined => (c.clone.group === null ? undefined : owner.get(c.clone.group));
  const kept = pairs.filter((pair) => pair.c.clone.group === null || pair.o.segment < 0 || ownedBy(pair.c) === pair.o.segment);

  const usedObservations = new Set(kept.map((pair) => pair.o));
  const usedSpawns = new Set(kept.map((pair) => pair.c));
  const edges: Pair[] = [];
  for (const o of observations) {
    if (usedObservations.has(o) || o.segment < 0) continue;
    const u = t.bx - t.s * o.y;
    const v = t.by + t.s * o.x;
    for (const c of o.candidates) {
      if (usedSpawns.has(c) || ownedBy(c) !== o.segment) continue;
      const d = Math.hypot(c.clone.x - u, c.clone.y - v);
      if (d < PULL_FILL_UNITS) edges.push({ o, c, d });
    }
  }
  edges.sort((a, b) => a.d - b.d);
  for (const edge of edges) {
    if (usedObservations.has(edge.o) || usedSpawns.has(edge.c)) continue;
    usedObservations.add(edge.o);
    usedSpawns.add(edge.c);
    kept.push(edge);
  }

  const filled = new Map<number, number>();
  for (const { c } of kept) {
    if (c.clone.group !== null) filled.set(c.clone.group, (filled.get(c.clone.group) ?? 0) + 1);
  }
  return kept.filter(({ c }) => c.clone.group === null || filled.get(c.clone.group)! >= packSizes.get(c.clone.group)!);
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

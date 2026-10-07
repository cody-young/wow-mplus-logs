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
 * Once the floors are placed, their kills are matched pack by pack, since a
 * pack pulls whole and every kill was some spawn: see `byPull`. That only
 * decides which spawn each kill was; the fit is made, and scored, from the
 * kills that landed on their own.
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
   * Kills matched to a spawn on a good floor, one kill per spawn and one spawn
   * per kill, and every MDT pack's kills from a single pull.
   *
   * Each pull's kills are explained by whole packs where they can be, dragged
   * up to `PULL_DRAG_YARDS` from their spawns, or `ANCHORED_DRAG_YARDS` for a
   * pack the pull has a kill on a spawn of. What a pull has on a pack's spawns
   * is placed even when the pack cannot be made whole. A kill none of that
   * explains is left out rather than given the nearest free spawn, which on a
   * dense floor is as likely another pack's.
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
/**
 * How far a tank may drag a pack before the log first sees its mobs, in
 * yards: a pull's kill may stand this far from the spawn of a pack it took.
 * Gathering two or three packs onto a fourth drags them sixty yards or more.
 */
export const PULL_DRAG_YARDS = 60;
/**
 * The same for a pack the pull has a kill on the spawn of, which ties the
 * pack to the pull: the rest of it died there, wherever the log first saw it.
 */
export const ANCHORED_DRAG_YARDS = 120;

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
  npcId: number;
  clone: MdtClone;
}

interface Observation {
  actor: number;
  npcId: number;
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
    for (const clone of enemy.clones) list.push({ enemyIndex: enemy.index, npcId: enemy.npcId, clone });
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
  const placed: Placed[] = [];
  for (const [uiMapId, tracks] of [...byMap].sort((a, b) => a[0] - b[0])) {
    const observe = (sublevel: number): Observation[] => {
      const observations: Observation[] = [];
      for (const track of tracks) {
        const candidates = spawnsByNpc.get(track.npcId)!.filter((spawn) => spawn.clone.sublevel === sublevel);
        if (candidates.length > 0) {
          observations.push({ actor: track.actor, npcId: track.npcId, x: track.home!.x, y: track.home!.y, ts: track.home!.ts, segment: track.segmentId, candidates });
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
    if (best.fit.good) placed.push({ fit: best.fit, observations: observe(best.fit.sublevel), pairs: best.pairs });
  }
  const matches = byPull(placed, [...spawnsByNpc.values()].flat()).map(({ o, c, d }) => ({
    actor: o.actor,
    enemyIndex: c.enemyIndex,
    cloneIndex: c.clone.index,
    distance: d,
  }));
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

/** A good floor, with its kills and the ones its fit matched. */
interface Placed {
  fit: MdtFloorFit;
  observations: Observation[];
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
 * Kills placed on spawns pack by pack, as the game pulls them.
 *
 * A pack pulls all at once, so its mobs die in one pull, and every kill was
 * some spawn: a pull's kills are explained by whole packs, each claimed by one
 * pull with one kill per spawn. Within a pull it does not matter which kill
 * stands for which spawn of a creature, since a route lists only the spawns.
 *
 * Whole packs are claimed one at a time, the one whose furthest kill is
 * nearest first. A pack one of the fit's matches ties to a pull, the pull that matched the most
 * of it, is claimed only by that pull, and those matches are kept for it, so a
 * gathered pull cannot hand them to a neighbour. Any other pack is claimed by
 * whichever pull's leftover kills fill it.
 *
 * A tank gathers packs before the log sees most of them, so a pack's kills
 * may stand up to `PULL_DRAG_YARDS` from its spawns, or `ANCHORED_DRAG_YARDS`
 * for a pack tied to the pull. A spawn MDT puts in no pack has no pack-mates
 * to say which pull took it, and still needs a kill within `MDT_MATCH_UNITS`.
 *
 * A pack is whole when each of its spawns has a kill, counting only creatures
 * that died somewhere in the run: some never die, such as a boss's adds that
 * leave with it, and a pack waiting on them would never be placed. A pack its
 * own pull cannot make whole still gets what that pull has on its spawns,
 * once every whole pack is placed: those kills can be no other pack's. Any
 * other pack no pull can make whole is left out.
 *
 * All good floors are matched at once, since floors drawn on one sublevel
 * share its spawns.
 */
function byPull(placed: readonly Placed[], spawns: readonly Spawn[]): Pair[] {
  interface Kill {
    o: Observation;
    u: number;
    v: number;
    sublevel: number;
    /** `PULL_DRAG_YARDS` in MDT units, under its floor's fit. */
    reach: number;
  }
  interface Unit {
    key: string;
    grouped: boolean;
    /** Its spawns of creatures that died somewhere in the run, by creature. */
    required: Map<number, Spawn[]>;
  }

  const kills: Kill[] = [];
  const killed = new Set<number>();
  for (const { fit, observations } of placed) {
    for (const o of observations) {
      const [u, v] = toMdt(fit, o.x, o.y);
      kills.push({ o, u, v, sublevel: fit.sublevel, reach: PULL_DRAG_YARDS * fit.scale });
      killed.add(o.npcId);
    }
  }
  const bySegment = new Map<number, Kill[]>();
  for (const kill of kills) {
    const list = bySegment.get(kill.o.segment);
    if (list === undefined) bySegment.set(kill.o.segment, [kill]);
    else list.push(kill);
  }

  const sublevels = new Set(placed.map(({ fit }) => fit.sublevel));
  const units = new Map<string, Unit>();
  const unitOf = new Map<Spawn, Unit>();
  for (const spawn of spawns) {
    const { sublevel, group } = spawn.clone;
    if (!sublevels.has(sublevel)) continue;
    const key = group === null ? `${sublevel}:${spawn.enemyIndex}:${spawn.clone.index}` : `${sublevel}/${group}`;
    let unit = units.get(key);
    if (unit === undefined) units.set(key, (unit = { key, grouped: group !== null, required: new Map() }));
    unitOf.set(spawn, unit);
    if (!killed.has(spawn.npcId)) continue;
    const list = unit.required.get(spawn.npcId);
    if (list === undefined) unit.required.set(spawn.npcId, [spawn]);
    else list.push(spawn);
  }

  // Each pack's pull: the one its fit's matches mostly came from.
  const tallies = new Map<Unit, Map<number, { count: number; distance: number }>>();
  const anchors: Array<{ actor: number; unit: Unit; segment: number }> = [];
  for (const { pairs } of placed) {
    for (const { o, c, d } of pairs) {
      const unit = unitOf.get(c)!;
      anchors.push({ actor: o.actor, unit, segment: o.segment });
      let tally = tallies.get(unit);
      if (tally === undefined) tallies.set(unit, (tally = new Map()));
      const entry = tally.get(o.segment) ?? { count: 0, distance: 0 };
      entry.count++;
      entry.distance += d;
      tally.set(o.segment, entry);
    }
  }
  const owner = new Map<Unit, number>();
  for (const [unit, tally] of tallies) {
    let best = { segment: 0, count: 0, distance: Infinity };
    for (const [segment, { count, distance }] of tally) {
      if (count > best.count || (count === best.count && distance < best.distance)) best = { segment, count, distance };
    }
    owner.set(unit, best.segment);
  }
  /** A kill a pack's own pull matched to it, kept for that pack while it is unplaced. */
  const reserved = new Map<number, Unit>();
  for (const { actor, unit, segment } of anchors) if (owner.get(unit) === segment) reserved.set(actor, unit);
  const release = (unit: Unit): void => {
    for (const [actor, holder] of reserved) if (holder === unit) reserved.delete(actor);
  };

  const used = new Set<number>();
  /**
   * As many of the unit's spawns as can be, each given a different free kill
   * of the pull no further than `reach` times a kill's `reach`.
   */
  const fill = (unit: Unit, segment: number, reach: number): Pair[] => {
    const pool = bySegment.get(segment);
    if (pool === undefined) return [];
    const pairs: Pair[] = [];
    for (const [npcId, wanted] of unit.required) {
      const options = wanted.map((c) => {
        const list: Pair[] = [];
        for (const kill of pool) {
          if (kill.o.npcId !== npcId || kill.sublevel !== c.clone.sublevel || used.has(kill.o.actor)) continue;
          const holder = reserved.get(kill.o.actor);
          if (holder !== undefined && holder !== unit) continue;
          const d = Math.hypot(c.clone.x - kill.u, c.clone.y - kill.v);
          if (d < (unit.grouped ? kill.reach * reach : MDT_MATCH_UNITS)) list.push({ o: kill.o, c, d });
        }
        return list.sort((a, b) => a.d - b.d);
      });
      pairs.push(...matchMost(options));
    }
    return pairs;
  };
  const size = (unit: Unit): number => [...unit.required.values()].reduce((sum, list) => sum + list.length, 0);
  const worst = (pairs: Pair[]): number => pairs.reduce((most, pair) => Math.max(most, pair.d), 0);
  const claim = (unit: Unit, pairs: Pair[]): void => {
    pending.delete(unit);
    release(unit);
    for (const pair of pairs) used.add(pair.o.actor);
    out.push(...pairs);
  };

  const pending = new Set([...units.values()].filter((unit) => unit.required.size > 0));
  const out: Pair[] = [];
  const anchoredReach = ANCHORED_DRAG_YARDS / PULL_DRAG_YARDS;
  const home = new Map(owner);
  // Whole packs, the one whose furthest kill is nearest first: a claim that
  // has to reach far for one of its mobs goes after every claim that need not.
  for (;;) {
    let best: { unit: Unit; pairs: Pair[]; cost: number } | null = null;
    for (const unit of pending) {
      const own = owner.get(unit);
      let segments: Iterable<number> = own === undefined ? bySegment.keys() : [own];
      if (own !== undefined && fill(unit, own, anchoredReach).length < size(unit)) {
        // Its own pull cannot make it whole, and only loses kills from here
        // on. Its kills there stay its own: standing on its spawns, they are
        // no other pack's either.
        owner.delete(unit);
        segments = bySegment.keys();
      }
      for (const segment of segments) {
        const pairs = fill(unit, segment, owner.get(unit) === segment ? anchoredReach : 1);
        if (pairs.length < size(unit)) continue;
        const cost = worst(pairs);
        if (best === null || cost < best.cost) best = { unit, pairs, cost };
      }
    }
    if (best === null) break;
    claim(best.unit, best.pairs);
  }
  // Then what is left of the packs a pull has kills on the spawns of. The rest
  // of such a pack died somewhere the log did not place it, or MDT draws the
  // pack bigger than the game spawns it; either way the kills on its spawns
  // are that pack's, and leaving them out loses them from the route.
  for (;;) {
    let best: { unit: Unit; pairs: Pair[]; cost: number } | null = null;
    for (const unit of pending) {
      const own = home.get(unit);
      if (own === undefined) continue;
      const pairs = fill(unit, own, 1);
      if (!pairs.some((pair) => reserved.get(pair.o.actor) === unit)) continue;
      const cost = worst(pairs);
      if (best === null || cost < best.cost) best = { unit, pairs, cost };
    }
    if (best === null) break;
    claim(best.unit, best.pairs);
  }
  return out;
}

/**
 * As many spawns as can be given a different kill, from each spawn's options
 * nearest first. Augmenting paths, so a kill two spawns both want goes to the
 * one with no other choice.
 */
function matchMost(options: Pair[][]): Pair[] {
  const holder = new Map<number, number>();
  const chosen: Array<Pair | undefined> = [];
  const place = (spawn: number, seen: Set<number>): boolean => {
    for (const pair of options[spawn]!) {
      const actor = pair.o.actor;
      if (seen.has(actor)) continue;
      seen.add(actor);
      const other = holder.get(actor);
      if (other === undefined || place(other, seen)) {
        holder.set(actor, spawn);
        chosen[spawn] = pair;
        return true;
      }
    }
    return false;
  };
  for (let spawn = 0; spawn < options.length; spawn++) place(spawn, new Set());
  return chosen.filter((pair) => pair !== undefined);
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

import { forcesFraction, type ForcesLookup } from '@mplus/data';
import { ActorKind, Ev, EvFlag, UnitFlag, type ActorTable, type Run } from '@mplus/parser';

import type { AnalysisContext } from './context.js';
import { DAMAGE_CODES } from './events.js';

/**
 * Segmentation: splitting a key into boss fights and trash pulls.
 *
 * Boss windows come free from ENCOUNTER_START/END. Trash pulls have no marker
 * and must be inferred from combat activity.
 *
 * The hard part is that pulls and bosses overlap — dragging a trash pack into
 * a boss is routine, and sometimes deliberate. Segments are therefore NOT a
 * partition of the timeline, and attributing damage by timestamp would count
 * those packs against both the boss and their own pull.
 *
 * So attribution is keyed on the ENEMY, not the clock. Every hostile unit is
 * assigned to the segment it was first engaged in, and a damage event belongs
 * to whichever segment its enemy side belongs to. Boss adds land on the boss
 * because they are first engaged inside its window; a pack pulled beforehand
 * keeps its own pull even while the boss is up. Both stay live at once, and
 * the sum over segments equals the run total with nothing double-counted.
 */

export const enum SegmentKind {
  PULL = 0,
  BOSS = 1,
}

/**
 * One kind of enemy in a segment, pooled by npc id.
 *
 * Pooling is by creature id rather than by name because the same name can
 * cover units with different health (a caster and its elite variant), and
 * because the id is what an enemy-forces table would be keyed on.
 */
export interface EnemyGroup {
  /** Creature id parsed from the GUID; -1 when the GUID carried none. */
  npcId: number;
  name: string;
  /** Distinct spawns of this creature engaged in the segment. */
  spawns: number;
  /**
   * How many of those spawns died.
   *
   * Tracked apart from `spawns` because enemy forces are awarded on death, not
   * on engagement: a pack tagged and walked past moves the bar by nothing.
   */
  killed: number;
  /**
   * Enemy forces this creature awards per kill, or null when no forces table
   * covered it.
   *
   * Null and 0 are different answers and must not collapse: 0 is a boss or a
   * summon that is genuinely worth nothing, null is a creature the table has
   * never heard of, and showing the second as the first would quietly
   * understate a pull.
   */
  forcesEach: number | null;
  /** `forcesEach * killed`, or 0 when unknown. */
  forces: number;
  /**
   * Largest max health seen on any of them, or 0 when never observed.
   *
   * Health only reaches the log inside an advanced block, so this reads 0 for
   * every enemy when advanced combat logging was off.
   */
  maxHp: number;
  /**
   * True when these units were summoned by another unit rather than placed in
   * the dungeon — totems, adds spawned mid-fight, enemy pets.
   */
  summon: boolean;
}

export interface Segment {
  id: number;
  kind: SegmentKind;
  /** Display name: the boss, or the dominant enemy in the pack. */
  label: string;
  /** 1-based ordinal among pulls; 0 for bosses. */
  pullNumber: number;
  /** Store-relative ms. */
  startTs: number;
  endTs: number;
  /** Hostile actor indices attributed to this segment. */
  enemies: number[];
  /** `enemies` pooled by creature and ordered most important first. */
  roster: EnemyGroup[];
  /** Enemy forces earned in this segment: the sum of its roster's `forces`. */
  forces: number;
  /** Encounter id for bosses, 0 otherwise. */
  encounterId: number;
  /** Whether the boss fight was a kill. Null for pulls and unfinished fights. */
  success: boolean | null;
  /** Ids of segments whose time window overlaps this one. */
  overlaps: number[];
  /** Mean position of damage in this segment, for a route map. */
  centroidX: number;
  centroidY: number;
}

/** Enemy forces over a whole run. */
export interface RunForces {
  /** True when a forces table covered this dungeon. Everything else is 0 if not. */
  known: boolean;
  /** The dungeon's name as the forces table spells it. */
  dungeon: string;
  /** Where the values came from, for the UI to attribute them. */
  source: string;
  /** Forces the dungeon requires. */
  total: number;
  /**
   * The dungeon's teleport spell, whose icon is the dungeon's art. 0 when the
   * table has no teleport for it, which the UI renders as no icon.
   */
  teleportSpellId: number;
  /** Forces earned, summed over every segment. */
  counted: number;
  /** `counted / total`, clamped at 0 when there is no requirement to divide by. */
  fraction: number;
  /**
   * Creatures that were killed but had no entry in the table, by npc id.
   *
   * Non-empty means `counted` is a lower bound rather than the answer — a
   * dungeon reworked since MDT last shipped, most likely — and the UI says so
   * rather than presenting a short total as exact.
   */
  unknown: number[];
}

export interface SegmentIndex {
  segments: readonly Segment[];
  /** Enemy forces for the run as a whole. */
  readonly forces: RunForces;
  /** Hostile actor index -> segment id, or -1 if never engaged. */
  readonly enemySegment: Int32Array;
  /** Party actor indices, for reuse by the report functions. */
  readonly party: ReadonlySet<number>;
  get(id: number): Segment | undefined;
  /** Segment a damage row belongs to, or -1 when neither side is hostile. */
  segmentOf(row: number): number;
}

export interface SegmentOptions {
  /**
   * Milliseconds without trash combat that closes a pull. Chain pulls below
   * this threshold read as one engagement, which matches how players describe
   * them.
   */
  pullGapMs?: number;
  /**
   * How far before ENCOUNTER_START a boss may already have been damaged and
   * still be claimed by its own fight. ENCOUNTER_START lags the first hit — on
   * a real log a boss was hit 4s before its window opened — which otherwise
   * files the entire boss under the preceding trash pull.
   */
  bossGraceMs?: number;
  /**
   * Fraction of the largest health in a boss window that a unit must have to
   * count as part of the fight rather than as trash.
   *
   * A grace period alone cannot separate the two: in the same log the boss was
   * engaged 4s early while a trash pack dragged in was engaged 11s early, so
   * any window wide enough to catch the boss also catches the pack. Health
   * separates them cleanly — the boss had 92.5M against the pack's 12.7M.
   */
  bossHealthRatio?: number;
  /**
   * Enemy-forces values for this dungeon, or null when none were available.
   *
   * Optional because the combat log never carries them: forces come from an
   * external table, so every consumer has to work without one. Absent, the
   * roster still reports spawns and kills and the forces columns read as
   * unknown.
   */
  forces?: ForcesLookup | null;
}

const DEFAULT_PULL_GAP_MS = 5000;
const DEFAULT_BOSS_GRACE_MS = 30_000;
const DEFAULT_BOSS_HEALTH_RATIO = 0.5;

/** Units that can be an enemy. Excludes the environment and world objects. */
function canBeHostile(kind: ActorKind): boolean {
  return kind === ActorKind.CREATURE || kind === ActorKind.VEHICLE || kind === ActorKind.PET;
}

export function buildSegments(context: AnalysisContext, options: SegmentOptions = {}): SegmentIndex {
  const { run } = context;
  const { store, actors } = run;
  const gap = options.pullGapMs ?? DEFAULT_PULL_GAP_MS;
  const bossGrace = options.bossGraceMs ?? DEFAULT_BOSS_GRACE_MS;
  const bossRatio = options.bossHealthRatio ?? DEFAULT_BOSS_HEALTH_RATIO;
  const forces = options.forces ?? null;

  const party = new Set(meta_party(run));
  const friendly = (index: number): boolean => index >= 0 && party.has(actors.attribute(index));

  const actorCount = Math.max(actors.size, 1);
  const segments: Segment[] = [];
  const enemySegment = new Int32Array(actorCount).fill(-1);
  /** First damage involving this enemy. Not its first appearance in any event. */
  const firstEngaged = new Int32Array(actorCount).fill(-1);
  /** Largest health seen while this enemy was the advanced block's subject. */
  const peakHealth = new Int32Array(actorCount);
  /** 1 once this actor has been seen as the target of a SPELL_SUMMON. */
  const summoned = new Uint8Array(actorCount);
  /**
   * 1 once this actor has died. Forces are awarded on death, not on damage.
   *
   * Collected for every actor, but only consulted for enemies that are in a
   * segment — which is to say ones the party actually damaged. That
   * intersection is load-bearing, not incidental. A real +12 Voidscar Arena
   * had fourteen enemies die without ever being hit: six Voidminders at the
   * same instant at 09:34, and pairs of Enthralled Shamans and Dominated
   * Brawlers at 07:14 and 08:15, each pair sharing a timestamp to the
   * millisecond. Those are waves despawning when their event ends, and the
   * game credits none of them. Counting them took the run from 742/738
   * (100.5%, which is what a timed key looks like) to 784 (106.2%, which is
   * not a number the game can produce).
   */
  const died = new Uint8Array(actorCount);

  for (const window of run.meta.encounters) {
    segments.push({
      id: segments.length,
      kind: SegmentKind.BOSS,
      label: window.name,
      pullNumber: 0,
      startTs: window.startTs,
      endTs: window.endTs ?? window.startTs,
      enemies: [],
      roster: [],
      forces: 0,
      encounterId: window.encounterId,
      success: window.success,
      overlaps: [],
      centroidX: 0,
      centroidY: 0,
    });
  }
  const bossCount = segments.length;
  const bossAt = (ts: number): Segment | null => {
    for (let i = 0; i < bossCount; i++) {
      const segment = segments[i]!;
      if (ts >= segment.startTs && ts <= segment.endTs) return segment;
    }
    return null;
  };

  // --- Pass 1: assign each enemy to the segment it was first engaged in -----
  let pullNumber = 0;
  let activePull = -1;
  /**
   * Last trash combat, tracked apart from combat generally. A single global
   * "last combat" stays fresh through a three-minute boss fight, so trash
   * engaged right after the kill would join the stale pull from before it.
   */
  let lastPullTs = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    // The clearest summon signal there is, and free to collect on this scan:
    // the summoner is the source and the spawn is the target.
    if (code === Ev.SPELL_SUMMON) {
      const spawn = store.dstActor[row]!;
      if (spawn >= 0 && spawn < actorCount) summoned[spawn] = 1;
      continue;
    }
    // UNIT_DESTROYED alongside UNIT_DIED: demons and elementals are destroyed
    // rather than killed, and the game credits forces for them just the same.
    if (code === Ev.UNIT_DIED || code === Ev.UNIT_DESTROYED) {
      const victim = store.dstActor[row]!;
      if (victim >= 0 && victim < actorCount) died[victim] = 1;
      continue;
    }
    if (!DAMAGE_CODES.has(code)) continue;

    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
    const srcFriendly = friendly(src);
    // Friendly fire and enemy-on-enemy say nothing about pull boundaries.
    if (srcFriendly === friendly(dst)) continue;

    const enemy = srcFriendly ? dst : src;
    const actor = actors.at(enemy);
    if (actor === undefined || !canBeHostile(actor.kind)) continue;

    const ts = store.ts[row]!;
    if (firstEngaged[enemy] === -1) firstEngaged[enemy] = ts;

    const flags = store.flags[row]!;
    if (flags & EvFlag.ADVANCED) {
      const subjectIsEnemy = flags & EvFlag.INFO_IS_SOURCE ? src === enemy : dst === enemy;
      const hpMax = store.hpMax[row]!;
      if (subjectIsEnemy && hpMax > peakHealth[enemy]!) peakHealth[enemy] = hpMax;
    }

    if (enemySegment[enemy]! < 0) {
      const boss = bossAt(ts);
      let segmentId: number;
      if (boss !== null) {
        segmentId = boss.id;
      } else {
        if (activePull < 0 || ts - lastPullTs > gap) {
          pullNumber++;
          activePull = segments.length;
          segments.push({
            id: activePull,
            kind: SegmentKind.PULL,
            label: `Pull ${pullNumber}`,
            pullNumber,
            startTs: ts,
            endTs: ts,
            enemies: [],
            roster: [],
            forces: 0,
            encounterId: 0,
            success: null,
            overlaps: [],
            centroidX: 0,
            centroidY: 0,
          });
        }
        segmentId = activePull;
      }
      enemySegment[enemy] = segmentId;
      segments[segmentId]!.enemies.push(enemy);
    }

    if (segments[enemySegment[enemy]!]!.kind === SegmentKind.PULL) {
      lastPullTs = ts;
      activePull = enemySegment[enemy]!;
    }
  }

  // --- Reassign boss units that were engaged before their window opened ----
  for (let i = 0; i < bossCount; i++) {
    const boss = segments[i]!;
    const lo = boss.startTs - bossGrace;
    const hi = boss.endTs;

    let peak = 0;
    for (let enemy = 0; enemy < actorCount; enemy++) {
      const engaged = firstEngaged[enemy]!;
      if (engaged < lo || engaged > hi) continue;
      if (peakHealth[enemy]! > peak) peak = peakHealth[enemy]!;
    }
    if (peak <= 0) continue;
    const threshold = peak * bossRatio;

    for (let enemy = 0; enemy < actorCount; enemy++) {
      const engaged = firstEngaged[enemy]!;
      if (engaged < lo || engaged > hi) continue;
      if (peakHealth[enemy]! < threshold) continue;
      const current = enemySegment[enemy]!;
      if (current < 0 || current === boss.id) continue;
      const from = segments[current]!;
      if (from.kind !== SegmentKind.PULL) continue;
      from.enemies = from.enemies.filter((index) => index !== enemy);
      boss.enemies.push(enemy);
      enemySegment[enemy] = boss.id;
    }
  }

  // --- Pass 2: recompute bounds and centroids from the final assignment ----
  // Cheaper than patching them incrementally through a reassignment, and exact.
  const sumX = new Float64Array(segments.length);
  const sumY = new Float64Array(segments.length);
  const sumN = new Float64Array(segments.length);
  const seen = new Uint8Array(segments.length);

  for (let i = 0; i < bossCount; i++) {
    // A boss fight is defined by its encounter window; damage can extend it but
    // never shrink it below the window the game reported.
    seen[i] = 1;
  }
  for (let i = bossCount; i < segments.length; i++) {
    segments[i]!.startTs = Number.POSITIVE_INFINITY;
    segments[i]!.endTs = Number.NEGATIVE_INFINITY;
  }

  for (let row = 0; row < store.count; row++) {
    if (!DAMAGE_CODES.has(store.code[row]!)) continue;
    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
    const srcFriendly = friendly(src);
    if (srcFriendly === friendly(dst)) continue;
    const enemy = srcFriendly ? dst : src;
    if (enemy < 0 || enemy >= actorCount) continue;
    const segmentId = enemySegment[enemy]!;
    if (segmentId < 0) continue;

    const segment = segments[segmentId]!;
    const ts = store.ts[row]!;
    if (!seen[segmentId]) {
      segment.startTs = ts;
      segment.endTs = ts;
      seen[segmentId] = 1;
    } else {
      if (ts < segment.startTs) segment.startTs = ts;
      if (ts > segment.endTs) segment.endTs = ts;
    }

    if (store.flags[row]! & EvFlag.ADVANCED) {
      const x = store.posX[row]!;
      const y = store.posY[row]!;
      if (x !== 0 || y !== 0) {
        sumX[segmentId] = sumX[segmentId]! + x;
        sumY[segmentId] = sumY[segmentId]! + y;
        sumN[segmentId] = sumN[segmentId]! + 1;
      }
    }
  }

  for (const segment of segments) {
    if (!Number.isFinite(segment.startTs)) segment.startTs = 0;
    if (!Number.isFinite(segment.endTs)) segment.endTs = segment.startTs;
    const n = sumN[segment.id]!;
    if (n > 0) {
      segment.centroidX = sumX[segment.id]! / n;
      segment.centroidY = sumY[segment.id]! / n;
    }
    segment.roster = buildRoster(context, segment, peakHealth, summoned, died, forces);
    segment.forces = segment.roster.reduce((sum, group) => sum + group.forces, 0);
    if (segment.kind === SegmentKind.PULL) segment.label = labelPull(context, segment);
  }

  for (const a of segments) {
    a.overlaps = [];
    for (const b of segments) {
      if (a.id === b.id) continue;
      if (a.startTs <= b.endTs && b.startTs <= a.endTs) a.overlaps.push(b.id);
    }
  }

  // Drop pulls left empty by reassignment.
  const live = segments.filter((segment) => segment.kind === SegmentKind.BOSS || segment.enemies.length > 0);
  live.sort((a, b) => a.startTs - b.startTs || a.id - b.id);

  const counted = live.reduce((sum, segment) => sum + segment.forces, 0);
  const unknown = new Set<number>();
  for (const segment of live) {
    for (const group of segment.roster) {
      if (group.forcesEach === null && group.killed > 0 && group.npcId >= 0) unknown.add(group.npcId);
    }
  }

  return {
    segments: live,
    forces: {
      known: forces !== null,
      dungeon: forces?.name ?? '',
      source: forces?.source ?? '',
      total: forces?.total ?? 0,
      teleportSpellId: forces?.teleportSpellId ?? 0,
      counted,
      fraction: forcesFraction(counted, forces?.total ?? 0),
      unknown: [...unknown].sort((a, b) => a - b),
    },
    enemySegment,
    party,
    get: (id) => segments.find((segment) => segment.id === id),
    segmentOf: (row) => {
      const src = store.srcActor[row]!;
      const dst = store.dstActor[row]!;
      const srcFriendly = friendly(src);
      if (srcFriendly === friendly(dst)) return -1;
      const enemy = srcFriendly ? dst : src;
      return enemy >= 0 && enemy < enemySegment.length ? enemySegment[enemy]! : -1;
    },
  };
}

function meta_party(run: Run): readonly number[] {
  return run.meta.party;
}

/**
 * Whether a hostile unit was summoned rather than placed in the dungeon.
 *
 * Four signals, because no single one is reliable. SPELL_SUMMON is the
 * clearest but a spawn can appear without one (scripted waves). The pet and
 * guardian unit flags cover totems and most adds, but the flags on a row are
 * whatever was last observed. The owner link only gets filled when the unit
 * happened to be an advanced block's subject on a line that named an owner.
 * Any one of them is enough, so they are OR-ed rather than voted on.
 */
function isSummon(actors: ActorTable, index: number, summoned: Uint8Array): boolean {
  if (summoned[index] === 1) return true;
  const actor = actors.at(index);
  if (actor === undefined) return false;
  if (actor.kind === ActorKind.PET) return true;
  if ((actor.flags & (UnitFlag.TYPE_PET | UnitFlag.TYPE_GUARDIAN)) !== 0) return true;
  return actor.ownerIndex >= 0;
}

/**
 * How much a group of enemies defines the pull it is in.
 *
 * Total health pool, which beats either spawn count or size alone: three
 * casters at 2M apiece outweigh one 2M caster, and one 40M miniboss outweighs
 * the three. maxHp floors at 1 so that a log without advanced logging — where
 * no health is recorded at all — degrades to ranking by spawn count.
 *
 * Not enemy forces, even though a forces table is usually available now. The
 * roster's order answers "what was this pull", and a 40M miniboss worth 5
 * count still defines the pull it is in.
 */
function weight(group: EnemyGroup): number {
  return group.spawns * Math.max(group.maxHp, 1);
}

/** Pools a segment's enemies by creature, most important first. */
function buildRoster(
  context: AnalysisContext,
  segment: Segment,
  peakHealth: Int32Array,
  summoned: Uint8Array,
  died: Uint8Array,
  forces: ForcesLookup | null,
): EnemyGroup[] {
  const { actors } = context.run;
  const groups = new Map<string, EnemyGroup>();

  for (const enemy of segment.enemies) {
    const actor = actors.at(enemy);
    if (actor === undefined) continue;
    const name = context.interner.resolve(actor.nameId) || 'Unknown';
    // Fall back to the name for units whose GUID carried no creature id, so
    // they still pool with each other instead of all collapsing onto id -1.
    const key = actor.npcId >= 0 ? `#${actor.npcId}` : `@${name}`;

    let group = groups.get(key);
    if (group === undefined) {
      // A GUID with no creature id can never be looked up, so it stays unknown
      // rather than being resolved by name — two dungeons share plenty of names.
      const each = forces === null || actor.npcId < 0 ? null : forces.of(actor.npcId);
      group = {
        npcId: actor.npcId,
        name,
        spawns: 0,
        killed: 0,
        forcesEach: each,
        forces: 0,
        maxHp: 0,
        summon: false,
      };
      groups.set(key, group);
    }
    group.spawns++;
    if (died[enemy] === 1) group.killed++;
    if (peakHealth[enemy]! > group.maxHp) group.maxHp = peakHealth[enemy]!;
    // One spawn is enough to mark the whole creature: the signals are sparse,
    // and a totem whose owner link never got filled is still a totem.
    if (isSummon(actors, enemy, summoned)) group.summon = true;
  }

  for (const group of groups.values()) {
    group.forces = group.forcesEach === null ? 0 : group.forcesEach * group.killed;
  }

  // Summons sort last whatever their health. A boss's adds can out-mass the
  // boss, and the question the roster answers is what was pulled, not what
  // ended up on the floor.
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.summon) - Number(b.summon) ||
      weight(b) - weight(a) ||
      b.spawns - a.spawns ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Names a pull after the enemy that defines it.
 *
 * Summoned units are skipped: a pack whose caster drops four totems reads as
 * "Magma Totem x4 +8", which names the thing the pull produced rather than the
 * thing that was pulled. The +N still counts every remaining enemy, summons
 * included, so it reconciles with the roster total.
 */
function labelPull(context: AnalysisContext, segment: Segment): string {
  const primary = segment.roster.find((group) => !group.summon) ?? segment.roster[0];
  if (primary === undefined || primary.name === '') return `Pull ${segment.pullNumber}`;
  const extra = segment.enemies.length - primary.spawns;
  const suffix = primary.spawns > 1 ? ` ×${primary.spawns}` : '';
  return extra > 0 ? `${primary.name}${suffix} +${extra}` : `${primary.name}${suffix}`;
}

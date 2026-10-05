/**
 * Enemy forces — the "count" a key needs before the last boss unlocks.
 *
 * The combat log does not carry it. Every event says who hit whom for how
 * much; none of them says that killing a Ritual Chieftain moved the bar by 25
 * of the 817 the dungeon asks for. That mapping lives in the game's scenario
 * criteria, which is exactly where this table comes from: see
 * `enemy-forces.ts`, generated from Blizzard's own `CriteriaTree` and
 * `Criteria` by `scripts/enemy-forces.mjs`.
 *
 * Deliberately plain objects and arrays rather than Maps: a table crosses the
 * worker boundary by structured clone and is cached to disk as JSON, and
 * rebuilding a Map at both ends costs more than the indexed lookup saves on a
 * table of a few thousand creatures.
 */

/** One creature's contribution, keyed on the npc id a GUID carries. */
export interface EnemyForces {
  npcId: number;
  /** Forces awarded per kill. Always positive — a creature worth nothing has no row. */
  count: number;
}

export interface DungeonForces {
  /**
   * The challenge-mode map id, which is what `CHALLENGE_MODE_START` reports
   * and what `MapChallengeMode` is keyed on. Not the instance id — those
   * differ (Ruby Life Pools is challenge-mode 399, instance 2521) and only
   * this one appears in both the log and the criteria data.
   */
  challengeModeId: number;
  name: string;
  /** Forces required to complete the dungeon. */
  total: number;
  /**
   * Forces this dungeon awards for something that is not a kill.
   *
   * King's Rest is the one that matters: a scenario objective there is worth
   * 30 of its 608. A party that killed every creature the log records can
   * therefore show 96% and have genuinely finished the key, because nothing in
   * the combat log reports an objective being completed.
   *
   * So this is a tolerance, not an addend. It is never added to `counted` —
   * there is no evidence the objective happened — but a shortfall no larger
   * than this is fully explained and is not worth warning about.
   */
  nonKillForces: number;
  /**
   * The dungeon's teleport spell, or 0 when none is known.
   *
   * Carried for its icon, not to cast it: the teleport's spell icon *is* the
   * dungeon's art (`inv_achievement_dungeon_altaroffangs` and the like). This
   * is the one field the criteria data cannot supply — nothing in it links a
   * dungeon to a spell — so it is filled in from Mythic Dungeon Tools when
   * that is installed, and left 0 otherwise. A dungeon with no teleport simply
   * has no art; every number on the page is unaffected.
   */
  teleportSpellId: number;
  enemies: EnemyForces[];
}

export interface ForcesTable {
  /** Where this came from, for the UI to attribute and for cache busting. */
  source: string;
  dungeons: DungeonForces[];
}

/** A dungeon's forces resolved for one npc id at a time. */
export interface ForcesLookup {
  challengeModeId: number;
  name: string;
  total: number;
  /** Forces the dungeon awards for non-kills; see `DungeonForces.nonKillForces`. */
  nonKillForces: number;
  /** The dungeon's teleport spell, for its icon. 0 when none is known. */
  teleportSpellId: number;
  /** The table's provenance, for the UI to attribute the numbers. */
  source: string;
  /**
   * Forces per kill for this creature. 0 for anything the table has no row for.
   *
   * Absent and zero are the same answer here, deliberately. The criteria data
   * only lists creatures that award something, so a boss, a totem and a
   * summoned add have no row at all — and neither would a creature added by a
   * hotfix newer than the generated table. Those are not worth distinguishing
   * per creature, because nothing can tell them apart from the log, and the
   * run-level arithmetic catches the case that matters: a key the game
   * completed whose kills do not add up to its requirement.
   */
  of(npcId: number): number;
}

export const EMPTY_TABLE: ForcesTable = { source: '', dungeons: [] };

/**
 * The dungeon matching a run, or null.
 *
 * Null is the normal case for a log from a dungeon the table has not caught up
 * with, and for the pre-Legion challenge modes that had no forces requirement
 * at all, so every caller treats it as "no forces data" rather than an error.
 */
export function forcesFor(table: ForcesTable, challengeModeId: number): ForcesLookup | null {
  if (challengeModeId <= 0) return null;
  const dungeon = table.dungeons.find((entry) => entry.challengeModeId === challengeModeId);
  if (dungeon === undefined) return null;

  // Built once per run rather than per roster group: a dungeon has a couple
  // hundred creatures and a long key has a couple hundred groups, so the scan
  // would otherwise be quadratic for no reason.
  const byId = new Map<number, number>();
  for (const enemy of dungeon.enemies) byId.set(enemy.npcId, enemy.count);

  return {
    challengeModeId: dungeon.challengeModeId,
    name: dungeon.name,
    total: dungeon.total,
    nonKillForces: dungeon.nonKillForces,
    teleportSpellId: dungeon.teleportSpellId,
    source: table.source,
    of: (npcId) => byId.get(npcId) ?? 0,
  };
}

/**
 * Forces as a fraction of the dungeon requirement.
 *
 * Guarded because `total` is 0 for a dungeon with no requirement, and a NaN
 * would propagate into the UI as "NaN%" rather than as a blank.
 */
export function forcesFraction(forces: number, total: number): number {
  return total > 0 ? forces / total : 0;
}

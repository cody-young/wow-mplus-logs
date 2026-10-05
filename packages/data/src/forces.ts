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
  /**
   * Forces required to complete the dungeon, as the game states it.
   *
   * Kills have to supply all of it. Nothing is taken off for the scenario
   * objectives a few dungeons carry — see the note on `Criteria.Type 92` in
   * `scripts/enemy-forces.mjs` for why that was the wrong reading of them.
   */
  total: number;
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
  /**
   * The count the dungeon demands, which kills have to supply in full.
   *
   * The denominator for every percentage in the app, and the same number the
   * game, Mythic Dungeon Tools and the route planners all quote. A party that
   * killed everything on its route reads a little over 100% against it — the
   * overpull, which is information rather than an error.
   */
  required: number;
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
    required: dungeon.total,
    teleportSpellId: dungeon.teleportSpellId,
    source: table.source,
    of: (npcId) => byId.get(npcId) ?? 0,
  };
}

/**
 * Forces as a fraction of the dungeon's requirement.
 *
 * Guarded because the requirement is 0 for a dungeon with no forces at all,
 * and a NaN would propagate into the UI as "NaN%" rather than as a blank.
 */
export function forcesFraction(forces: number, required: number): number {
  return required > 0 ? forces / required : 0;
}

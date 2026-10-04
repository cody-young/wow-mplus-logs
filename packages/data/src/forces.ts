/**
 * Enemy forces — the "count" a key needs before the last boss unlocks.
 *
 * The combat log does not carry it. Every event says who hit whom for how
 * much; none of them says that killing a Ritual Chieftain moved the bar by 25
 * of the 817 the dungeon asks for. That mapping lives in the game's scenario
 * criteria, and the only practical community source for it is Mythic Dungeon
 * Tools, so this module is the shape the MDT reader fills and the lookup the
 * analysis asks.
 *
 * Deliberately plain objects and arrays rather than Maps: a table crosses the
 * worker boundary by structured clone and is cached to disk as JSON, and
 * rebuilding a Map at both ends costs more than the indexed lookup saves on a
 * table of a few thousand creatures.
 */

/** One creature's contribution, keyed on the npc id a GUID carries. */
export interface EnemyForces {
  npcId: number;
  name: string;
  /** Forces awarded per kill. 0 for bosses and for anything that gives none. */
  count: number;
  isBoss: boolean;
}

export interface DungeonForces {
  /**
   * The challenge-mode map id, which is what `CHALLENGE_MODE_START` reports
   * and what MDT keys its `mapInfo` on. Not the instance id — those differ
   * (Ruby Life Pools is challenge-mode 399, instance 2521) and only this one
   * appears in both sources.
   */
  challengeModeId: number;
  name: string;
  /** Forces required to complete the dungeon. */
  total: number;
  /**
   * The dungeon's teleport spell, or 0 when MDT lists none.
   *
   * Carried for its icon, not to cast it: the teleport's spell icon *is* the
   * dungeon's art (`inv_achievement_dungeon_altaroffangs` and the like), and
   * MDT's own dungeon picker draws itself from exactly this field. That makes
   * a dungeon icon one more id through the spell-icon path the UI already has,
   * instead of a second table mapping dungeons to texture names by hand.
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
  /** The dungeon's teleport spell, for its icon. 0 when MDT lists none. */
  teleportSpellId: number;
  /** The table's provenance, for the UI to attribute the numbers. */
  source: string;
  /** Forces per kill for this creature, or null when the table has no entry. */
  of(npcId: number): number | null;
  isBoss(npcId: number): boolean;
}

export const EMPTY_TABLE: ForcesTable = { source: '', dungeons: [] };

/**
 * The dungeon matching a run, or null.
 *
 * Null is the normal case for a log from a dungeon MDT has not shipped yet, so
 * every caller treats it as "no forces data" rather than as an error.
 */
export function forcesFor(table: ForcesTable, challengeModeId: number): ForcesLookup | null {
  if (challengeModeId <= 0) return null;
  const dungeon = table.dungeons.find((entry) => entry.challengeModeId === challengeModeId);
  if (dungeon === undefined) return null;

  // Built once per run rather than per roster group: a dungeon has a couple
  // hundred creatures and a long key has a couple hundred groups, so the scan
  // would otherwise be quadratic for no reason.
  const byId = new Map<number, EnemyForces>();
  for (const enemy of dungeon.enemies) byId.set(enemy.npcId, enemy);

  return {
    challengeModeId: dungeon.challengeModeId,
    name: dungeon.name,
    total: dungeon.total,
    teleportSpellId: dungeon.teleportSpellId,
    source: table.source,
    of: (npcId) => byId.get(npcId)?.count ?? null,
    isBoss: (npcId) => byId.get(npcId)?.isBoss ?? false,
  };
}

/**
 * Forces as a fraction of the dungeon requirement.
 *
 * Guarded because `total` is 0 for a dungeon MDT lists without a requirement,
 * and a NaN would propagate into the UI as "NaN%" rather than as a blank.
 */
export function forcesFraction(forces: number, total: number): number {
  return total > 0 ? forces / total : 0;
}

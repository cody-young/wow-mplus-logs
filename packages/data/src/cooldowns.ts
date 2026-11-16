/**
 * How long the things a player could have pressed to live take to come back.
 *
 * GENERATED — do not edit. Rebuild with `node scripts/spell-cooldowns.mjs`.
 * Built from SpellCooldowns.db2, SpellCategories.db2, SpellCategory.db2 and
 * ItemEffect.db2, retail build 12.1.5.70783, via wago.tools.
 *
 * Base clocks, before talents. Talents only shorten them, so a clock that has
 * run out is a cooldown that was certainly back; the reverse is not certain,
 * and nothing should be read into it.
 *
 * Only ids and milliseconds are stored: no names, no descriptions, no art.
 */

/**
 * Big defensives, by the aura the log shows: [aura, ms, charges]. 61 of the
 * 79 in `isBigDefensive`; the rest are not a player's (a dungeon's
 * buff, a boss's shield) or carry no clock in the data at all.
 */
const DEFENSIVES: readonly (readonly [number, number, number])[] = [
  [498, 60000, 1],
  [642, 300000, 1],
  [871, 180000, 1],
  [1022, 300000, 1],
  [1966, 15000, 1],
  [5277, 120000, 1],
  [6940, 120000, 1],
  [12975, 180000, 1],
  [19236, 90000, 1],
  [22812, 60000, 1],
  [31224, 120000, 1],
  [31821, 180000, 1],
  [31850, 90000, 1],
  [33206, 180000, 1],
  [45438, 240000, 1],
  [47585, 120000, 1],
  [47788, 180000, 1],
  [48707, 60000, 1],
  [48743, 120000, 1],
  [48792, 120000, 1],
  [49039, 120000, 1],
  [53480, 120000, 1],
  [55233, 90000, 1],
  [55342, 120000, 1],
  [61336, 180000, 1],
  [81782, 180000, 1],
  [86659, 180000, 1],
  [97463, 180000, 1],
  [102342, 90000, 1],
  [104773, 180000, 1],
  [108271, 120000, 1],
  [108416, 60000, 1],
  [110960, 120000, 1],
  [115203, 360000, 1],
  [116849, 120000, 1],
  [118038, 120000, 1],
  [120954, 360000, 1],
  [125174, 90000, 1],
  [145629, 240000, 1],
  [184364, 120000, 1],
  [186265, 180000, 1],
  [199448, 120000, 1],
  [204018, 300000, 1],
  [209426, 300000, 1],
  [212641, 180000, 1],
  [212800, 60000, 1],
  [243435, 420000, 1],
  [264735, 90000, 1],
  [325174, 180000, 1],
  [342246, 60000, 1],
  [357170, 60000, 1],
  [363916, 90000, 1],
  [374227, 120000, 1],
  [393108, 180000, 1],
  [403876, 60000, 1],
  [410358, 60000, 1],
  [414658, 240000, 1],
  [444741, 60000, 1],
  [1297686, 60000, 1],
  [1309441, 180000, 1],
  [1309794, 300000, 1],
];

/** Every health potion: the spells sharing Silvermoon Health Potion's cooldown category. */
const HEALTH_POTIONS = new Set([
  439, 440, 441, 2024, 4042, 9252, 9253, 16666, 17534, 17712,
  18385, 18956, 18957, 21393, 21394, 28495, 29276, 29312, 33373, 40408,
  41237, 41306, 41619, 41620, 43185, 53144, 53670, 58862, 67486, 67489,
  67490, 78778, 78989, 82184, 89078, 105708, 134998, 139493, 156438, 170221,
  170403, 176114, 185490, 185491, 188016, 200452, 212198, 216431, 216802, 216810,
  223595, 230038, 230039, 234564, 237875, 242538, 250870, 251645, 265476, 290367,
  293795, 294622, 301308, 307192, 331974, 333940, 359867, 370511, 371039, 405351,
  415569, 423414, 431416, 439571, 450794, 452767, 452891, 452900, 460074, 1234768,
  1235568, 1238009, 1255411, 1262857, 1263074, 1295247,
]);

/** Healthstones, the warlock's own included. */
const HEALTHSTONES = new Set([6262, 452930, 1218128]);

/** The cooldown every health potion shares. */
export const HEALTH_POTION_MS = 300000;
/** A healthstone's cooldown. */
export const HEALTHSTONE_MS = 60000;
/** Uses in one healthstone, which is gone after the last. */
export const HEALTHSTONE_CHARGES = 3;

export interface Clock {
  ms: number;
  charges: number;
}

let clocks: Map<number, Clock> | null = null;

/** A big defensive's clock, by the aura it puts up; null when it has none. */
export function defensiveClock(spellId: number): Clock | null {
  clocks ??= new Map(DEFENSIVES.map(([id, ms, charges]) => [id, { ms, charges }]));
  return clocks.get(spellId) ?? null;
}

export function isHealthPotion(spellId: number): boolean {
  return HEALTH_POTIONS.has(spellId);
}

export function isHealthstone(spellId: number): boolean {
  return HEALTHSTONES.has(spellId);
}

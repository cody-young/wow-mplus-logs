/**
 * Where Mythic Dungeon Tools draws each dungeon floor, fitted from real keys.
 *
 * GENERATED — do not edit. Rebuild with
 * `node scripts/mdt-calibrate.mjs --write packages/data/src/mdt-floors.ts <logs>`.
 * Fitted against MDT 6.2.21 from 99 keys.
 *
 * One transform per floor, in the form `placeOnMdt` fits for itself:
 *
 *   MDT x = offsetX − scale·y,   MDT y = offsetY + scale·x
 *
 * A run fits each floor on its own, and that is usually right, but a floor
 * whose kills are a few packs can fit two ways almost equally well, and one
 * run cannot say which. These are the same fit pooled over many keys, which
 * can. The analysis uses one only when the run's own fit is not trusted, and
 * only when the run's kills agree with it, so a floor MDT has since redrawn
 * goes back to being drawn from the log rather than drawn wrong.
 *
 * Three numbers per floor, derived from combat logs: no MDT spawns, names or
 * art. Those are still read from the user's own install. Floors seen in fewer
 * than 3 keys, or whose pooled fit put under 40% of kills on a spawn,
 * are left out.
 */

export interface MdtFloorTransform {
  challengeModeId: number;
  uiMapId: number;
  /** The MDT sublevel the floor is drawn on. */
  sublevel: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

const FLOORS: readonly MdtFloorTransform[] = [
  { challengeModeId: 249, uiMapId: 1004, sublevel: 1, scale: 1.1268, offsetX: 3642.9, offsetY: 778.5 }, // King's Rest, 11 keys, 340/837 kills on a spawn
  { challengeModeId: 250, uiMapId: 1038, sublevel: 1, scale: 0.8032, offsetX: 3235.4, offsetY: -3118.3 }, // Temple of Sethraliss, 11 keys, 330/660 kills on a spawn
  { challengeModeId: 250, uiMapId: 1043, sublevel: 1, scale: 0.7809, offsetX: 2961.5, offsetY: -3370.4 }, // Temple of Sethraliss, 11 keys, 99/148 kills on a spawn
  { challengeModeId: 399, uiMapId: 2094, sublevel: 1, scale: 1.2441, offsetX: 312.7, offsetY: -2279.6 }, // Ruby Life Pools, 10 keys, 162/390 kills on a spawn
  { challengeModeId: 584, uiMapId: 2500, sublevel: 1, scale: 1.0276, offsetX: 2186.9, offsetY: -1624.7 }, // The Blinding Vale, 8 keys, 427/1018 kills on a spawn
  { challengeModeId: 585, uiMapId: 2572, sublevel: 1, scale: 0.9626, offsetX: -232.4, offsetY: -4550.5 }, // Voidscar Arena, 12 keys, 222/520 kills on a spawn
  { challengeModeId: 585, uiMapId: 2574, sublevel: 1, scale: 0.9312, offsetX: -220.3, offsetY: -4643.9 }, // Voidscar Arena, 12 keys, 93/133 kills on a spawn
  { challengeModeId: 586, uiMapId: 2513, sublevel: 1, scale: 0.4174, offsetX: -1359.9, offsetY: -2182.1 }, // Den of Nalorakk, 10 keys, 194/217 kills on a spawn
  { challengeModeId: 586, uiMapId: 2514, sublevel: 1, scale: 0.7486, offsetX: -3667.0, offsetY: -3573.4 }, // Den of Nalorakk, 10 keys, 572/906 kills on a spawn
  { challengeModeId: 587, uiMapId: 2433, sublevel: 1, scale: 1.3607, offsetX: -5947.5, offsetY: -12321.3 }, // Murder Row, 18 keys, 421/871 kills on a spawn
  { challengeModeId: 587, uiMapId: 2434, sublevel: 1, scale: 1.0574, offsetX: -5043.1, offsetY: -9675.3 }, // Murder Row, 17 keys, 925/1559 kills on a spawn
  { challengeModeId: 587, uiMapId: 2435, sublevel: 1, scale: 3.2872, offsetX: -15155.2, offsetY: -29554.4 }, // Murder Row, 17 keys, 83/153 kills on a spawn
  { challengeModeId: 588, uiMapId: 2588, sublevel: 1, scale: 0.9511, offsetX: 2146.9, offsetY: -1900.7 }, // Altar of Fangs, 17 keys, 547/985 kills on a spawn
  { challengeModeId: 588, uiMapId: 2589, sublevel: 1, scale: 0.8930, offsetX: 2215.5, offsetY: -1493.6 }, // Altar of Fangs, 17 keys, 193/342 kills on a spawn
  { challengeModeId: 588, uiMapId: 2590, sublevel: 1, scale: 0.8283, offsetX: 2393.9, offsetY: -1336.5 }, // Altar of Fangs, 17 keys, 424/623 kills on a spawn
];

/** The shipped fits for one dungeon's floors; empty for a dungeon not in the table. */
export function mdtFloorsFor(challengeModeId: number): MdtFloorTransform[] {
  return FLOORS.filter((floor) => floor.challengeModeId === challengeModeId);
}

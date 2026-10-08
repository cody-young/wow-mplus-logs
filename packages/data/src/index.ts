/**
 * @mplus/data — the tables the combat log does not carry.
 *
 * Portable like the parser and the analysis: no Node builtins. The MDT reader
 * takes a string, so the caller decides whether that came from `readFile`, a
 * dropped file or a cached blob.
 *
 * The enemy-forces table is generated from Blizzard's own scenario criteria
 * (`scripts/enemy-forces.mjs`), which is why it can be shipped in a build at
 * all: the community source for these numbers, Mythic Dungeon Tools, is
 * GPL-2.0. MDT is still read from the user's own install for the teleport
 * spell whose icon is the dungeon's art, because nothing in Blizzard's data
 * links a dungeon to a spell, and for the map tab's spawns and floor art. The
 * one table derived from MDT, `mdt-floors.ts`, holds only fitted transforms
 * that place a floor on MDT's canvas. See the licensing note in the README.
 *
 * Every generated table here holds ids and numbers and nothing else: no names
 * beyond the dungeons' own, no descriptions, no art. The one hand-kept table,
 * avoidable damage, also names its spells, because people edit it.
 */
export {
  EMPTY_TABLE,
  forcesFor,
  forcesFraction,
  type DungeonForces,
  type EnemyForces,
  type ForcesLookup,
  type ForcesTable,
} from './forces.js';
export { DB2_BUILD, db2DungeonCount, db2Dungeons } from './enemy-forces.js';
export { mdtFloorsFor, type MdtFloorTransform } from './mdt-floors.js';
export {
  MDT_CANVAS,
  MDT_TILES,
  mdtTileName,
  parseMdtDungeon,
  parseMdtTeleport,
  type MdtClone,
  type MdtDungeon,
  type MdtEnemy,
  type MdtSublevel,
  type MdtTeleport,
} from './mdt.js';
export { Defense, defenseKinds, defensiveCount, isDefensive, type DefenseKind } from './defensives.js';
export {
  afterCasts,
  avoidable,
  avoidableDungeons,
  avoidableEntries,
  ownAuras,
  type AvoidableSpell,
} from './avoidable.js';
export { buttonCount, isButton } from './buttons.js';
export {
  Control,
  controlCount,
  controlKinds,
  isCrowdControl,
  type ControlKind,
} from './crowd-control.js';
export { dispelCount, enrageCount, isDispel, isEnrage } from './dispels.js';
export { inertCount, isInertMarker } from './markers.js';
export { interruptCount, isInterrupt } from './interrupts.js';

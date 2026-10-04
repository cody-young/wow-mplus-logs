/**
 * @mplus/data — the tables the combat log does not carry.
 *
 * Portable like the parser and the analysis: no Node builtins. The MDT reader
 * takes a string, so the caller decides whether that came from `readFile`, a
 * dropped file or a cached blob.
 *
 * The MDT tables are not vendored: MDT is GPL-2.0, so they are read from the
 * user's own install at runtime. See the licensing note in the README. The two
 * generated spell tables are the one exception, and they hold spell ids and
 * nothing else — no names, no descriptions, no art.
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
export { parseMdtDungeon } from './mdt.js';
export { Defense, defenseKinds, defensiveCount, isDefensive, type DefenseKind } from './defensives.js';
export { inertCount, isInertMarker } from './markers.js';

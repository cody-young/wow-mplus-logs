/**
 * @mplus/data — the tables the combat log does not carry.
 *
 * Portable like the parser and the analysis: no Node builtins. The MDT reader
 * takes a string, so the caller decides whether that came from `readFile`, a
 * dropped file or a cached blob.
 *
 * Nothing here ships with data in it. See the licensing note in the README:
 * MDT is GPL-2.0, so its tables are read from the user's own install at
 * runtime rather than vendored into this repo.
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

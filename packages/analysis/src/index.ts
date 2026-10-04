/**
 * @mplus/analysis — metrics over a parsed run.
 *
 * Portable like the parser: no Node builtins, so the same reports run in the
 * desktop app's utility process and in a browser worker.
 */
export { actorName, contextFor, spellName, type AnalysisContext } from './context.js';
export {
  damageReport,
  healingReport,
  type ActorBreakdown,
  type BreakdownOptions,
  type BreakdownReport,
  type Direction,
  type SpellBreakdown,
} from './damage.js';
export {
  deathReports,
  type AbilityTotal,
  type AbsorbReceived,
  type CastRecord,
  type DeathOptions,
  type DeathReport,
  type HealReceived,
  type HpSample,
  type IncomingHit,
} from './deaths.js';
export {
  DAMAGE_CODES,
  HEAL_CODES,
  SELF_DAMAGE_CODES,
  VICTIM_MELEE_CODES,
  effective,
  wasted,
} from './events.js';
export {
  SegmentKind,
  buildSegments,
  type EnemyGroup,
  type RunForces,
  type Segment,
  type SegmentIndex,
  type SegmentOptions,
} from './segments.js';

/**
 * @mplus/analysis — metrics over a parsed run.
 *
 * Portable like the parser: no Node builtins, so the same reports run in the
 * desktop app's utility process and in a browser worker.
 */
export {
  abilityName,
  actorName,
  contextFor,
  elapsedMs,
  spellName,
  type AnalysisContext,
} from './context.js';
export {
  controlKindNames,
  crowdControlReport,
  summarizeCrowdControl,
  type ControlAbility,
  type ControlActor,
  type ControlApplication,
  type ControlEnd,
  type ControlOptions,
  type ControlReport,
  type ControlSpell,
  type ControlSummary,
} from './crowd-control.js';
export {
  avoidableReport,
  summarizeAvoidable,
  type AvoidableAbility,
  type AvoidableActor,
  type AvoidableHit,
  type AvoidableReport,
  type AvoidableSummary,
} from './avoidable.js';
export {
  DISPEL_KINDS,
  dispelReport,
  summarizeDispels,
  type DispelAbility,
  type DispelActor,
  type DispelKind,
  type DispelOptions,
  type DispelRecord,
  type DispelReport,
  type DispelSummary,
  type DispelledAura,
} from './dispels.js';
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
  type AuraWindow,
  type CastRecord,
  type DeathOptions,
  type DeathReport,
  type HealReceived,
  type HpSample,
  type IncomingHit,
} from './deaths.js';
export {
  interruptReport,
  summarizeInterrupts,
  type InterruptAbility,
  type InterruptActor,
  type InterruptAttempt,
  type InterruptOptions,
  type InterruptOutcome,
  type InterruptReport,
  type InterruptStop,
  type InterruptSummary,
  type StoppedCast,
} from './interrupts.js';
export {
  ABSORBED_CODES,
  AURA_DOWN_CODES,
  AURA_UP_CODES,
  DAMAGE_CODES,
  HEAL_CODES,
  MISS_CODES,
  SELF_DAMAGE_CODES,
  VICTIM_MELEE_CODES,
  effective,
  wasted,
} from './events.js';
export {
  MDT_MATCH_UNITS,
  PACK_MATCH_UNITS,
  PULL_DRAG_YARDS,
  ANCHORED_DRAG_YARDS,
  placeOnMdt,
  toMdt,
  type MdtFloorFit,
  type MdtMatch,
  type MdtPlacement,
} from './mdt.js';
export { encodeCbor, mdtExportString, mdtRoute, routeUid, type MdtRoute } from './mdt-route.js';
export {
  TrackKind,
  mapPoint,
  positionAt,
  positionTracks,
  type PositionOptions,
  type PositionReport,
  type PositionTrack,
  type TrackPoint,
} from './positions.js';
export {
  SegmentKind,
  buildSegments,
  segmentAt,
  type EnemyGroup,
  type RunForces,
  type Segment,
  type SegmentIndex,
  type SegmentOptions,
} from './segments.js';
export {
  PULL_CLOSE_MS,
  whoPulled,
  type PullContact,
  type PullContactKind,
  type PullNearest,
  type PullSummon,
  type PullRedirect,
  type PullReport,
} from './pull.js';
export { statsReport, type BigHit, type Fall, type StatsReport, type TotemKill } from './stats.js';

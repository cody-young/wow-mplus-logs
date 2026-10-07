/**
 * @mplus/parser — portable combat log engine.
 *
 * Nothing here imports a Node builtin: the engine takes bytes and the caller
 * decides where they came from. `npm run check:pure` enforces that, because
 * the web build depends on it.
 */
export { ActorKind, ActorTable, UnitFlag, type Actor } from './actors.js';
export {
  ADVANCED_FIELD_COUNT,
  BASE_FIELD_COUNT,
  Ev,
  EvFlag,
  MIN_ADVANCED_FIELD_COUNT,
  hasBaseBlock,
  identifyEvent,
  isAvoidMissType,
  looksLikeGuid,
  prefixFieldCount,
  type EventIdentity,
} from './events.js';
export { StringInterner, createInterner } from './interner.js';
export { LineAssembler } from './lines.js';
export {
  CombatLogParser,
  parseIntArray,
  type ChallengeEndInfo,
  type ChallengeStartInfo,
  type CombatantInfo,
  type EncounterInfo,
  type LogVersionInfo,
  type MapChangeInfo,
  type ParserHooks,
  type ParserOptions,
} from './parser.js';
export {
  LogSession,
  isRaidDifficulty,
  type EncounterWindow,
  type KeyRunMeta,
  type MapBounds,
  type RaidPullMeta,
  type Run,
  type RunMeta,
  type SessionHooks,
  type SessionOptions,
} from './session.js';
export { EventStore } from './store.js';
export { TimestampReader, daysFromCivil, type TimestampReaderOptions } from './timestamp.js';
export {
  MAX_FIELDS,
  fieldBool,
  fieldFloat,
  fieldHasDot,
  fieldHex,
  fieldInt,
  fieldIsArray,
  fieldIsNil,
  fieldRaw,
  fieldStr,
  parseIntAt,
  splitFields,
} from './tokenizer.js';

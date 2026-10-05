/**
 * Event identity and line layout.
 *
 * The combat log is compositional: most event names are PREFIX + SUFFIX, and
 * the parameter list is
 *
 *   [8 base] [prefix params] [17 advanced params?] [suffix params]
 *
 * Parsing that structure rather than a per-event table of hardcoded indices
 * means the parser handles events it has never seen, and survives Blizzard
 * adding an event in a patch. Two things are still determined empirically
 * rather than assumed:
 *
 *   - whether the advanced block is present, decided by testing whether the
 *     field at its offset looks like a GUID (see looksLikeGuid)
 *   - the suffix width, derived by subtraction from the observed field count
 *
 * So the only format constant that can rot is ADVANCED_FIELD_COUNT. If a
 * patch changes it, `npm run inspect -- <log>` reports the drift and this one
 * number is the fix.
 */

/**
 * Default width of the advanced-logging parameter block.
 *
 * 19 as of build 12.1.0 (COMBAT_LOG_VERSION 22); it was 17 before two stat
 * fields were inserted between spellPower and absorb. The parser does not
 * trust this number: it calibrates the real width at runtime by locating the
 * position fields, and this is only the value used until the first advanced
 * event arrives. See CombatLogParser.calibrateAdvanced.
 */
export const ADVANCED_FIELD_COUNT = 19;

/**
 * Smallest block width the parser will believe. Used to decide whether an
 * event is long enough to carry an advanced block at all, before the real
 * width is known, so it must stay below every real width.
 */
export const MIN_ADVANCED_FIELD_COUNT = 12;

/** Base parameters present on every source/dest event. */
export const BASE_FIELD_COUNT = 8;

export const enum Ev {
  UNKNOWN = 0,
  SWING_DAMAGE,
  SWING_DAMAGE_LANDED,
  SWING_MISSED,
  RANGE_DAMAGE,
  RANGE_MISSED,
  SPELL_DAMAGE,
  SPELL_PERIODIC_DAMAGE,
  SPELL_BUILDING_DAMAGE,
  SPELL_MISSED,
  SPELL_PERIODIC_MISSED,
  SPELL_HEAL,
  SPELL_PERIODIC_HEAL,
  SPELL_ABSORBED,
  SPELL_CAST_START,
  SPELL_CAST_SUCCESS,
  SPELL_CAST_FAILED,
  SPELL_AURA_APPLIED,
  SPELL_AURA_REMOVED,
  SPELL_AURA_REFRESH,
  SPELL_AURA_APPLIED_DOSE,
  SPELL_AURA_REMOVED_DOSE,
  SPELL_AURA_BROKEN,
  SPELL_AURA_BROKEN_SPELL,
  SPELL_INTERRUPT,
  SPELL_DISPEL,
  SPELL_DISPEL_FAILED,
  SPELL_STOLEN,
  SPELL_SUMMON,
  SPELL_CREATE,
  SPELL_INSTAKILL,
  SPELL_RESURRECT,
  SPELL_ENERGIZE,
  SPELL_PERIODIC_ENERGIZE,
  SPELL_DRAIN,
  SPELL_LEECH,
  SPELL_EMPOWER_START,
  SPELL_EMPOWER_END,
  SPELL_EMPOWER_INTERRUPT,
  DAMAGE_SHIELD,
  DAMAGE_SHIELD_MISSED,
  DAMAGE_SPLIT,
  ENVIRONMENTAL_DAMAGE,
  UNIT_DIED,
  UNIT_DESTROYED,
  UNIT_DISSIPATES,
  PARTY_KILL,
  COMBATANT_INFO,
  ENCOUNTER_START,
  ENCOUNTER_END,
  CHALLENGE_MODE_START,
  CHALLENGE_MODE_END,
  ZONE_CHANGE,
  MAP_CHANGE,
  COMBAT_LOG_VERSION,
  EMOTE,
  SPELL_EXTRA_ATTACKS,
  SPELL_HEAL_ABSORBED,
  ENCHANT_APPLIED,
  ENCHANT_REMOVED,
}

/**
 * Augmentation Evoker attributes its contribution with _SUPPORT variants that
 * carry a trailing support-actor GUID. They are folded onto the base event
 * with the SUPPORT flag set, so damage tables can choose to credit either the
 * caster or the buffed player without a second code path.
 */
const NAME_TO_EVENT = new Map<string, Ev>();
{
  const names: Array<[string, Ev]> = [
    ['SWING_DAMAGE', Ev.SWING_DAMAGE],
    ['SWING_DAMAGE_LANDED', Ev.SWING_DAMAGE_LANDED],
    ['SWING_MISSED', Ev.SWING_MISSED],
    ['RANGE_DAMAGE', Ev.RANGE_DAMAGE],
    ['RANGE_MISSED', Ev.RANGE_MISSED],
    ['SPELL_DAMAGE', Ev.SPELL_DAMAGE],
    ['SPELL_PERIODIC_DAMAGE', Ev.SPELL_PERIODIC_DAMAGE],
    ['SPELL_BUILDING_DAMAGE', Ev.SPELL_BUILDING_DAMAGE],
    ['SPELL_MISSED', Ev.SPELL_MISSED],
    ['SPELL_PERIODIC_MISSED', Ev.SPELL_PERIODIC_MISSED],
    ['SPELL_HEAL', Ev.SPELL_HEAL],
    ['SPELL_PERIODIC_HEAL', Ev.SPELL_PERIODIC_HEAL],
    ['SPELL_ABSORBED', Ev.SPELL_ABSORBED],
    ['SPELL_CAST_START', Ev.SPELL_CAST_START],
    ['SPELL_CAST_SUCCESS', Ev.SPELL_CAST_SUCCESS],
    ['SPELL_CAST_FAILED', Ev.SPELL_CAST_FAILED],
    ['SPELL_AURA_APPLIED', Ev.SPELL_AURA_APPLIED],
    ['SPELL_AURA_REMOVED', Ev.SPELL_AURA_REMOVED],
    ['SPELL_AURA_REFRESH', Ev.SPELL_AURA_REFRESH],
    ['SPELL_AURA_APPLIED_DOSE', Ev.SPELL_AURA_APPLIED_DOSE],
    ['SPELL_AURA_REMOVED_DOSE', Ev.SPELL_AURA_REMOVED_DOSE],
    ['SPELL_AURA_BROKEN', Ev.SPELL_AURA_BROKEN],
    ['SPELL_AURA_BROKEN_SPELL', Ev.SPELL_AURA_BROKEN_SPELL],
    ['SPELL_INTERRUPT', Ev.SPELL_INTERRUPT],
    ['SPELL_DISPEL', Ev.SPELL_DISPEL],
    ['SPELL_DISPEL_FAILED', Ev.SPELL_DISPEL_FAILED],
    ['SPELL_STOLEN', Ev.SPELL_STOLEN],
    ['SPELL_SUMMON', Ev.SPELL_SUMMON],
    ['SPELL_CREATE', Ev.SPELL_CREATE],
    ['SPELL_INSTAKILL', Ev.SPELL_INSTAKILL],
    ['SPELL_RESURRECT', Ev.SPELL_RESURRECT],
    ['SPELL_ENERGIZE', Ev.SPELL_ENERGIZE],
    ['SPELL_PERIODIC_ENERGIZE', Ev.SPELL_PERIODIC_ENERGIZE],
    ['SPELL_DRAIN', Ev.SPELL_DRAIN],
    ['SPELL_LEECH', Ev.SPELL_LEECH],
    ['SPELL_EMPOWER_START', Ev.SPELL_EMPOWER_START],
    ['SPELL_EMPOWER_END', Ev.SPELL_EMPOWER_END],
    ['SPELL_EMPOWER_INTERRUPT', Ev.SPELL_EMPOWER_INTERRUPT],
    ['DAMAGE_SHIELD', Ev.DAMAGE_SHIELD],
    ['DAMAGE_SHIELD_MISSED', Ev.DAMAGE_SHIELD_MISSED],
    ['DAMAGE_SPLIT', Ev.DAMAGE_SPLIT],
    ['ENVIRONMENTAL_DAMAGE', Ev.ENVIRONMENTAL_DAMAGE],
    ['UNIT_DIED', Ev.UNIT_DIED],
    ['UNIT_DESTROYED', Ev.UNIT_DESTROYED],
    ['UNIT_DISSIPATES', Ev.UNIT_DISSIPATES],
    ['PARTY_KILL', Ev.PARTY_KILL],
    ['COMBATANT_INFO', Ev.COMBATANT_INFO],
    ['ENCOUNTER_START', Ev.ENCOUNTER_START],
    ['ENCOUNTER_END', Ev.ENCOUNTER_END],
    ['CHALLENGE_MODE_START', Ev.CHALLENGE_MODE_START],
    ['CHALLENGE_MODE_END', Ev.CHALLENGE_MODE_END],
    ['ZONE_CHANGE', Ev.ZONE_CHANGE],
    ['MAP_CHANGE', Ev.MAP_CHANGE],
    ['COMBAT_LOG_VERSION', Ev.COMBAT_LOG_VERSION],
    ['EMOTE', Ev.EMOTE],
    ['SPELL_EXTRA_ATTACKS', Ev.SPELL_EXTRA_ATTACKS],
    ['SPELL_HEAL_ABSORBED', Ev.SPELL_HEAL_ABSORBED],
    ['ENCHANT_APPLIED', Ev.ENCHANT_APPLIED],
    ['ENCHANT_REMOVED', Ev.ENCHANT_REMOVED],
  ];
  for (const [name, code] of names) NAME_TO_EVENT.set(name, code);
}

export const SUPPORT_SUFFIX = '_SUPPORT';

export interface EventIdentity {
  code: Ev;
  /** True when the name carried the _SUPPORT suffix (Augmentation Evoker). */
  support: boolean;
}

/** Resolves an event name, folding _SUPPORT variants onto their base code. */
export function identifyEvent(name: string): EventIdentity {
  const direct = NAME_TO_EVENT.get(name);
  if (direct !== undefined) return { code: direct, support: false };
  if (name.endsWith(SUPPORT_SUFFIX)) {
    const base = NAME_TO_EVENT.get(name.slice(0, -SUPPORT_SUFFIX.length));
    if (base !== undefined) return { code: base, support: true };
  }
  return { code: Ev.UNKNOWN, support: false };
}

/** Prefix parameter width, derived from the event name's prefix. */
export function prefixFieldCount(name: string): number {
  if (name.startsWith('SWING_')) {
    // A swing names no spell, with one exception: its `_SUPPORT` copy carries
    // the supporter's own spell triple where the plain row has nothing at all.
    // Reading that copy as prefix-less shifts every field after it by three —
    // the advanced block is not recognised, so the amount is read out of the
    // spell id, and all 99,028 SWING_DAMAGE_LANDED_SUPPORT rows of one real
    // raid log reported Ebon Might's id as an amount: 39.1 billion damage.
    return name.endsWith(SUPPORT_SUFFIX) ? 3 : 0;
  }
  // ENVIRONMENTAL_DAMAGE writes environmentalType AFTER the advanced block,
  // not before it, so it has no prefix at all. Treating it as a one-field
  // prefix shifts the advanced block by one and corrupts the whole event.
  if (name.startsWith('ENVIRONMENTAL_')) return 0;
  // SPELL_, SPELL_PERIODIC_, SPELL_BUILDING_, RANGE_, DAMAGE_SHIELD,
  // DAMAGE_SPLIT: spellId, spellName, spellSchool.
  return 3;
}

/** Events that carry no source/dest base block at all. */
export function hasBaseBlock(code: Ev): boolean {
  switch (code) {
    case Ev.COMBAT_LOG_VERSION:
    case Ev.ZONE_CHANGE:
    case Ev.MAP_CHANGE:
    case Ev.ENCOUNTER_START:
    case Ev.ENCOUNTER_END:
    case Ev.CHALLENGE_MODE_START:
    case Ev.CHALLENGE_MODE_END:
      return false;
    default:
      return true;
  }
}

const GUID_PREFIXES = [
  'Player-',
  'Creature-',
  'Pet-',
  'Vehicle-',
  'GameObject-',
  'BattlePet-',
  'Vignette-',
  'Item-',
];

/**
 * Discriminates the advanced block by shape rather than by a table of which
 * events carry it. The block's first field is the info GUID, which is either
 * a typed GUID or the all-zero null GUID; a suffix parameter in that position
 * would be a number or a quoted string instead.
 */
export function looksLikeGuid(text: string): boolean {
  if (text.length === 0) return false;
  if (text.charCodeAt(0) === 48 /* 0 */) {
    // Null GUID: a run of zeros, written as 0000000000000000.
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) !== 48) return false;
    }
    return true;
  }
  for (const prefix of GUID_PREFIXES) {
    if (text.startsWith(prefix)) return true;
  }
  return false;
}

/** Bit flags packed into the store's `flags` column. */
export const enum EvFlag {
  CRITICAL = 1 << 0,
  PERIODIC = 1 << 1,
  OFF_HAND = 1 << 2,
  SUPPORT = 1 << 3,
  ADVANCED = 1 << 4,
  MISSED = 1 << 5,
  /**
   * The advanced block describes the event's SOURCE rather than its
   * destination. Both occur: SWING_DAMAGE reports the attacker, while
   * SWING_DAMAGE_LANDED and the spell events report the victim. Without this
   * flag the health and position columns cannot be attributed to a unit, which
   * would make every death post-mortem read the wrong actor's health.
   */
  INFO_IS_SOURCE = 1 << 6,
  /**
   * A *_MISSED whose type produced nothing at all.
   *
   * Kept apart from MISSED because ABSORB, BLOCK and RESIST are logged as
   * misses too, and on those the blow connected: a fully absorbed hit is
   * already counted as damage by the shield that ate it (see the note on
   * ABSORBED_CODES in the analysis package). Folding those into a miss rate
   * would both overstate it and contradict the damage table beside it.
   */
  AVOIDED = 1 << 7,
  /**
   * An aura event whose auraType was BUFF rather than DEBUFF.
   *
   * Only meaningful on the SPELL_AURA_* codes. Source alone cannot stand in
   * for it: a party member's aura on a party member is usually a buff but not
   * always, and a death recap that files Power Word: Shield under "what was on
   * them" beside the boss's stacking debuff answers neither question.
   */
  BUFF = 1 << 8,
  /**
   * This row and the one beside it are a single hit written twice: a plain
   * event and the `_SUPPORT` copy on the line after it.
   *
   * Two unrelated things arrive as `_SUPPORT`, and the duplicate is what tells
   * them apart. Augmentation's Ebon Might appears only in `_SUPPORT` form,
   * under the evoker's own spell id, for the slice of an ally's hit the buff
   * added — there is no plain row carrying that id, and the amount is already
   * inside the ally's own damage, so it must never be added to a total. A
   * Scalecommander's Bombardments is the reverse: the evoker's bomb, logged as
   * an ordinary SPELL_DAMAGE credited to whichever party member set it off,
   * with a `_SUPPORT` copy beside it naming the evoker. That damage is the
   * evoker's, and nobody else in the group brought the talent.
   *
   * Set on both rows of a pair. On the plain one, `support` then names the
   * actor the amount belongs to.
   *
   * Measured on two real logs: all 4,376 plain Bombardments rows had their
   * copy on the very next line, and on the +17 among them 12.8M of the
   * ability's 17.0M was logged against the four players who were not the
   * evoker. Breath of Eons, Fate Mirror and Inferno's Blessing pair the same
   * way, while 426,499 Ebon Might rows paired with nothing at all.
   */
  SUPPORT_TWIN = 1 << 9,
}

/**
 * Miss types that mean the attempt landed on nothing.
 *
 * The complement — ABSORB, BLOCK, RESIST — is deliberate rather than absent:
 * those are mitigation of a hit that happened, not a failure to hit.
 */
const AVOID_MISS_TYPES: ReadonlySet<string> = new Set<string>([
  'MISS',
  'DODGE',
  'PARRY',
  'EVADE',
  'IMMUNE',
  'DEFLECT',
  'REFLECT',
]);

export function isAvoidMissType(missType: string): boolean {
  return AVOID_MISS_TYPES.has(missType);
}

/** In-place variant of looksLikeGuid, so the hot path allocates nothing. */
export function fieldLooksLikeGuid(line: string, out: Int32Array, index: number): boolean {
  const start = out[index << 1]!;
  const end = out[(index << 1) | 1]!;
  if (end <= start) return false;
  if (line.charCodeAt(start) === 48 /* 0 */) {
    for (let i = start; i < end; i++) {
      if (line.charCodeAt(i) !== 48) return false;
    }
    return true;
  }
  for (const prefix of GUID_PREFIXES) {
    if (start + prefix.length <= end && line.startsWith(prefix, start)) return true;
  }
  return false;
}

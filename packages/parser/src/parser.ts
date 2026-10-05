import { ActorTable, UnitFlag, type Actor } from './actors.js';
import {
  ADVANCED_FIELD_COUNT,
  BASE_FIELD_COUNT,
  Ev,
  MIN_ADVANCED_FIELD_COUNT,
  EvFlag,
  fieldLooksLikeGuid,
  hasBaseBlock,
  identifyEvent,
  isAvoidMissType,
  prefixFieldCount,
  type EventIdentity,
} from './events.js';
import { createInterner, type StringInterner } from './interner.js';
import { LineAssembler } from './lines.js';
import { EventStore } from './store.js';
import { TimestampReader, type TimestampReaderOptions } from './timestamp.js';
import {
  MAX_FIELDS,
  fieldBool,
  fieldFloat,
  fieldHasDot,
  fieldHex,
  fieldInt,
  fieldIsArray,
  fieldRaw,
  fieldStr,
  splitFields,
} from './tokenizer.js';

/**
 * Offsets within the advanced-logging parameter block.
 *
 * The block grew from 17 to 19 fields in build 12.1.0, and the new fields
 * landed in the middle — between spellPower and absorb. So the leading fields
 * are addressed from the block start and the trailing ones from its end, which
 * leaves both groups correct at either width. Only the stat fields in between
 * shift, and none of them is read here.
 */
const enum AdvHead {
  INFO_GUID = 0,
  OWNER_GUID = 1,
  HP = 2,
  HP_MAX = 3,
  ATTACK_POWER = 4,
  SPELL_POWER = 5,
}

/** Offsets back from the end of the block: `advancedStart + width - N`. */
const enum AdvTail {
  ABSORB = 10,
  POWER_TYPE = 9,
  POWER = 8,
  POWER_MAX = 7,
  POWER_COST = 6,
  POS_X = 5,
  POS_Y = 4,
  UI_MAP_ID = 3,
  FACING = 2,
  LEVEL = 1,
}

export interface ChallengeStartInfo {
  ts: number;
  zoneName: string;
  instanceId: number;
  challengeModeId: number;
  keystoneLevel: number;
  affixes: number[];
}

export interface ChallengeEndInfo {
  ts: number;
  instanceId: number;
  success: boolean;
  keystoneLevel: number;
  totalTimeMs: number;
}

export interface EncounterInfo {
  ts: number;
  encounterId: number;
  name: string;
  difficultyId: number;
  groupSize: number;
  success: boolean;
}

export interface CombatantInfo {
  ts: number;
  actor: Actor;
  specId: number;
  /** The whole line, so the desktop app can mine talents/gear without a reparse. */
  raw: string;
}

export interface LogVersionInfo {
  version: number;
  advancedLogging: boolean;
  buildVersion: string;
}

export interface ParserHooks {
  onChallengeStart?(info: ChallengeStartInfo): void;
  onChallengeEnd?(info: ChallengeEndInfo): void;
  onEncounterStart?(info: EncounterInfo): void;
  onEncounterEnd?(info: EncounterInfo): void;
  onCombatantInfo?(info: CombatantInfo): void;
  onZoneChange?(ts: number, instanceId: number, zoneName: string): void;
  onVersion?(info: LogVersionInfo): void;
  /** Fired once per distinct event name the parser does not recognize. */
  onUnknownEvent?(name: string, line: string): void;
}

export interface ParserOptions extends TimestampReaderOptions {
  hooks?: ParserHooks;
}

/** Keeps the identity cache from growing without bound on a corrupt file. */
const IDENTITY_CACHE_LIMIT = 512;

/**
 * Incremental combat log parser.
 *
 * Feed it bytes with `push`; it writes decoded events into whatever store
 * `target` points at and calls hooks for the structural events that mark run
 * boundaries. The store is swappable so a session can start a fresh store per
 * M+ run without the parser knowing what a run is, and can set it to null to
 * skip the cost of recording events outside a key entirely.
 */
/**
 * Events that name whoever swung, and so can rescue an absorb that did not.
 * See `claimOrphanAbsorb`.
 */
const ATTACKER_NAMING: ReadonlySet<number> = new Set<number>([
  Ev.SWING_DAMAGE,
  Ev.SWING_DAMAGE_LANDED,
  Ev.RANGE_DAMAGE,
  Ev.SPELL_DAMAGE,
  Ev.SPELL_PERIODIC_DAMAGE,
  Ev.SPELL_BUILDING_DAMAGE,
  Ev.DAMAGE_SHIELD,
  Ev.DAMAGE_SPLIT,
  Ev.SWING_MISSED,
  Ev.RANGE_MISSED,
  Ev.SPELL_MISSED,
  Ev.SPELL_PERIODIC_MISSED,
  Ev.DAMAGE_SHIELD_MISSED,
]);

/** How long an unattributed absorb waits for the event that names its source. */
const ORPHAN_ABSORB_WINDOW_MS = 100;

/** How far apart a plain event and its `_SUPPORT` copy may be timestamped. */
const SUPPORT_TWIN_WINDOW_MS = 2;

/**
 * How many rows back the ability a `_SUPPORT` slice rode in on may sit.
 *
 * One hit can be followed by several support rows — Ebon Might and Shifting
 * Sands on the same swing — and the longest run measured on a real raid log
 * was five, so eight leaves room for a sixth buff without reaching into the
 * previous hit.
 */
const SUPPORT_CARRIER_REACH = 8;

/**
 * Whether `twin` is the plain row that `row`'s `_SUPPORT` copy duplicates.
 *
 * Same actors, same spell, written together. What the amount has to match
 * depends on whether the hit landed — see `claimSupportTwin`.
 */
function isSupportTwin(
  store: EventStore,
  row: number,
  twin: number,
  code: Ev,
  amount: number,
): boolean {
  // Not already a support row, and not already claimed by an earlier twin.
  if ((store.flags[twin]! & (EvFlag.SUPPORT | EvFlag.SUPPORT_TWIN)) !== 0) return false;
  if (store.srcActor[twin] !== store.srcActor[row]) return false;
  if (store.dstActor[twin] !== store.dstActor[row]) return false;
  if (store.spellId[twin] !== store.spellId[row]) return false;
  // Written together: every pair measured was 0 or 1 ms apart. The guard is
  // what stops a lone _SUPPORT row from adopting an identical hit that happened
  // to be the previous event minutes earlier.
  if (store.ts[row]! - store.ts[twin]! > SUPPORT_TWIN_WINDOW_MS) return false;
  // A hit that landed: the same event, reporting the same amount.
  if (amount !== 0) return store.code[twin] === code && store.amount[twin] === amount;
  // A hit a shield ate whole, where the absorb is the only row that carries
  // what it would have done and the copy has no amount to compare against.
  return store.code[twin] === Ev.SPELL_ABSORBED;
}

export class CombatLogParser {
  readonly interner: StringInterner;
  readonly actors: ActorTable;

  /** Where decoded events land. Null discards them but still runs hooks. */
  get target(): EventStore | null {
    return this.targetStore;
  }

  set target(store: EventStore | null) {
    // Pending absorbs hold row indices, which mean nothing in another store.
    if (store !== this.targetStore) this.orphanAbsorbs.length = 0;
    this.targetStore = store;
  }

  private targetStore: EventStore | null = null;

  /** Version metadata, once COMBAT_LOG_VERSION has been seen. */
  version: LogVersionInfo | null = null;

  /**
   * spellId -> interned spell name. The store keeps only ids, so this is what
   * lets a breakdown be labelled without a second pass or a spell database.
   * Learned on first sight of each id, which is a few thousand entries per run.
   */
  readonly spellNames = new Map<number, number>();

  /** Lines seen, and lines whose timestamp failed to parse. */
  linesSeen = 0;
  linesRejected = 0;
  /** Events whose name is not in the table; they are counted, not stored. */
  unknownEvents = 0;

  private readonly assembler = new LineAssembler();
  private readonly ts: TimestampReader;
  private readonly offsets = new Int32Array(MAX_FIELDS * 2);
  private readonly identityCache = new Map<string, EventIdentity>();
  private readonly reportedUnknown = new Set<string>();
  private readonly hooks: ParserHooks;
  private readonly onLine = (line: string): void => this.handleLine(line);

  /**
   * Position of `overkill` within the damage suffix block, which is 1 in
   * pre-Dragonflight logs and 2 once `baseAmount` was inserted ahead of it.
   * Calibrated from the first damage events rather than assumed, then locked.
   */
  private overkillOffset = -1;
  private overkillLocked = false;

  /**
   * Observed width of the advanced block. Calibrated from the first advanced
   * event rather than assumed, then locked for the rest of the file.
   */
  /**
   * SPELL_ABSORBED rows that did not say who swung, still waiting for an event
   * that does. Holds a handful of entries at a time; see `claimOrphanAbsorb`.
   */
  private readonly orphanAbsorbs: { row: number; dst: number; spellId: number; ts: number }[] = [];

  private advancedWidth = ADVANCED_FIELD_COUNT;
  private advancedWidthLocked = false;

  constructor(options: ParserOptions = {}) {
    this.interner = createInterner();
    this.actors = new ActorTable(this.interner);
    this.ts = new TimestampReader(options);
    this.hooks = options.hooks ?? {};
  }

  /** Feeds raw bytes. Safe to call with chunks split anywhere. */
  push(chunk: Uint8Array): void {
    this.assembler.push(chunk, this.onLine);
  }

  /** Feeds decoded text. Used by tests and by the browser's File.text(). */
  pushText(text: string): void {
    this.assembler.pushText(text, this.onLine);
  }

  /** Flushes a final line lacking a trailing newline. Not for use while tailing. */
  end(): void {
    this.assembler.end(this.onLine);
  }

  private handleLine(line: string): void {
    this.linesSeen++;
    if (!this.ts.read(line)) {
      this.linesRejected++;
      return;
    }
    const bodyStart = this.ts.bodyStart;
    const nameEnd = line.indexOf(',', bodyStart);
    const name = nameEnd === -1 ? line.slice(bodyStart) : line.slice(bodyStart, nameEnd);

    const identity = this.identify(name);
    if (identity.code === Ev.UNKNOWN) {
      this.unknownEvents++;
      if (this.hooks.onUnknownEvent && !this.reportedUnknown.has(name)) {
        this.reportedUnknown.add(name);
        this.hooks.onUnknownEvent(name, line);
      }
      return;
    }

    const offsets = this.offsets;
    const count = nameEnd === -1 ? 0 : splitFields(line, nameEnd + 1, offsets);

    if (!hasBaseBlock(identity.code)) {
      this.handleControl(identity.code, line, count);
      return;
    }
    this.handleActorEvent(identity, name, line, count);
  }

  private identify(name: string): EventIdentity {
    let identity = this.identityCache.get(name);
    if (identity === undefined) {
      identity = identifyEvent(name);
      if (this.identityCache.size < IDENTITY_CACHE_LIMIT) this.identityCache.set(name, identity);
    }
    return identity;
  }

  /** Structural events with no source/dest block. */
  private handleControl(code: Ev, line: string, count: number): void {
    const offsets = this.offsets;
    const ts = this.ts.ms;
    switch (code) {
      case Ev.COMBAT_LOG_VERSION: {
        // version, "ADVANCED_LOG_ENABLED", enabled, "BUILD_VERSION", build, ...
        const info: LogVersionInfo = {
          version: count > 0 ? fieldInt(line, offsets, 0) : 0,
          advancedLogging: count > 2 ? fieldBool(line, offsets, 2) : false,
          buildVersion: count > 4 ? fieldStr(line, offsets, 4) : '',
        };
        this.version = info;
        this.hooks.onVersion?.(info);
        return;
      }
      case Ev.CHALLENGE_MODE_START: {
        // zoneName, instanceId, challengeModeId, keystoneLevel, [affixes]
        if (count < 4) return;
        this.hooks.onChallengeStart?.({
          ts,
          zoneName: fieldStr(line, offsets, 0),
          instanceId: fieldInt(line, offsets, 1),
          challengeModeId: fieldInt(line, offsets, 2),
          keystoneLevel: fieldInt(line, offsets, 3),
          affixes: count > 4 ? parseIntArray(fieldRaw(line, offsets, 4)) : [],
        });
        return;
      }
      case Ev.CHALLENGE_MODE_END: {
        // instanceId, success, keystoneLevel, totalTimeMs
        if (count < 2) return;
        this.hooks.onChallengeEnd?.({
          ts,
          instanceId: fieldInt(line, offsets, 0),
          success: fieldBool(line, offsets, 1),
          keystoneLevel: count > 2 ? fieldInt(line, offsets, 2) : 0,
          totalTimeMs: count > 3 ? fieldInt(line, offsets, 3) : 0,
        });
        return;
      }
      case Ev.ENCOUNTER_START:
      case Ev.ENCOUNTER_END: {
        if (count < 4) return;
        const info: EncounterInfo = {
          ts,
          encounterId: fieldInt(line, offsets, 0),
          name: fieldStr(line, offsets, 1),
          difficultyId: fieldInt(line, offsets, 2),
          groupSize: fieldInt(line, offsets, 3),
          success: code === Ev.ENCOUNTER_END && count > 4 ? fieldBool(line, offsets, 4) : false,
        };
        if (code === Ev.ENCOUNTER_START) this.hooks.onEncounterStart?.(info);
        else this.hooks.onEncounterEnd?.(info);
        return;
      }
      case Ev.ZONE_CHANGE:
      case Ev.MAP_CHANGE: {
        if (count < 2) return;
        this.hooks.onZoneChange?.(ts, fieldInt(line, offsets, 0), fieldStr(line, offsets, 1));
        return;
      }
      default:
        return;
    }
  }

  private handleActorEvent(
    identity: EventIdentity,
    name: string,
    line: string,
    count: number,
  ): void {
    if (count < BASE_FIELD_COUNT) return;
    const offsets = this.offsets;
    const code = identity.code;

    // COMBATANT_INFO leads with a GUID but has no base block behind it: field
    // 1 is a faction id and field 5 is a stat. Reading it as source/dest would
    // intern a stat as the player's name and invent an actor out of another,
    // so it must branch out before the base block is touched.
    if (code === Ev.COMBATANT_INFO) {
      const combatant = this.actors.touch(fieldStr(line, offsets, 0), '', 0);
      this.handleCombatantInfo(line, count, combatant);
      return;
    }

    const sourceGuid = fieldStr(line, offsets, 0);
    const destGuid = fieldStr(line, offsets, 4);
    const source = this.actors.touch(sourceGuid, fieldStr(line, offsets, 1), fieldHex(line, offsets, 2));
    const dest = this.actors.touch(destGuid, fieldStr(line, offsets, 5), fieldHex(line, offsets, 6));

    const prefixWidth = prefixFieldCount(name);
    const prefixStart = BASE_FIELD_COUNT;
    const advancedStart = prefixStart + prefixWidth;

    const advanced =
      count > advancedStart + MIN_ADVANCED_FIELD_COUNT &&
      fieldLooksLikeGuid(line, offsets, advancedStart);
    const advancedWidth = advanced ? this.calibrateAdvanced(line, advancedStart, count) : 0;
    let suffixStart = advancedStart + advancedWidth;

    // ENVIRONMENTAL_DAMAGE puts environmentalType after the advanced block,
    // ahead of an otherwise ordinary damage suffix.
    if (code === Ev.ENVIRONMENTAL_DAMAGE) suffixStart += 1;

    // A _SUPPORT row carries the supporter's GUID in the place of the ST/AOE
    // category, and where the event has no such field it is appended instead:
    // a heal's suffix grows from 5 fields to 6 and SPELL_ABSORBED's from 3 to
    // 4, while a spell hit's stays at 11. Only reads anchored to the tail are
    // affected, and they have to step over it — without that, an absorb reads
    // the shield's whole remaining pool as the amount this hit consumed.
    const supportTail = identity.support ? 1 : 0;

    let flags = identity.support ? EvFlag.SUPPORT : 0;
    if (advanced) flags |= EvFlag.ADVANCED;

    // The advanced block describes one unit, and which one depends on the
    // event: SWING_DAMAGE reports the attacker, SWING_DAMAGE_LANDED and the
    // spell events report the victim. Its infoGUID says which, so compare
    // before trusting anything in it.
    //
    // Getting this wrong is not a small error. The block's ownerGUID is the
    // pet/guardian link, and applying it to the source regardless meant that a
    // healer topping up someone's pet adopted that pet's owner as their own.
    // attribute() then rerouted the healer's entire output onto an unrelated
    // actor, and every per-player total silently read zero.
    let infoIsSource = false;
    if (advanced) {
      const infoGuid = fieldStr(line, offsets, advancedStart + AdvHead.INFO_GUID);
      infoIsSource = infoGuid === sourceGuid;
      const subject = infoIsSource ? source : infoGuid === destGuid ? dest : null;
      if (subject !== null) {
        const ownerGuid = fieldStr(line, offsets, advancedStart + AdvHead.OWNER_GUID);
        if (ownerGuid.length > 0 && ownerGuid.charCodeAt(0) !== 48) {
          const owner = this.actors.get(ownerGuid);
          if (owner !== undefined && owner.index !== subject.index) subject.ownerIndex = owner.index;
        }
      }
    }

    // Guardians are the other half of pet attribution, and the advanced block
    // cannot supply it. A Wild Imp is a Pet- GUID whose own swings carry
    // ownerGUID, so it links on its first hit; a Demonic Tyrant or an Antoran
    // Inquisitor is a Creature- GUID that only ever appears as the *source* of
    // spell damage, where the advanced block describes the victim and its
    // ownerGUID is zero. Measured on a real +12: 63.7M of guardian damage, a
    // fifth of a demonology warlock's output, was dropped for want of a link.
    //
    // SPELL_SUMMON names the summoner outright. Recorded as a summon rather
    // than as ownership, because a player's SPELL_SUMMON also raises things
    // that are not theirs; `attribute` decides. Enemies summoning their own
    // adds are dropped here, where adopting a boss as the owner of its adds
    // would reroute their damage and fold them into the wrong pull.
    if (
      (code === Ev.SPELL_SUMMON || code === Ev.SPELL_CREATE) &&
      source.index !== dest.index &&
      (source.flags & UnitFlag.CONTROL_PLAYER) !== 0
    ) {
      dest.summonerIndex = source.index;
    }

    const store = this.target;
    if (store === null) return;

    const row = store.reserve();
    store.clear(row);
    store.ts[row] = this.ts.ms - store.baseMs;
    store.code[row] = code;
    store.srcActor[row] = source.index;
    store.dstActor[row] = dest.index;

    if (prefixWidth === 3) {
      const spellId = fieldInt(line, offsets, prefixStart);
      store.spellId[row] = spellId;
      // Guard with has() so the name is only materialized once per spell
      // rather than sliced out of every one of a million lines.
      if (spellId !== 0 && !this.spellNames.has(spellId)) {
        this.spellNames.set(spellId, this.interner.intern(fieldStr(line, offsets, prefixStart + 1)));
      }
    }

    if (advanced) {
      if (infoIsSource) flags |= EvFlag.INFO_IS_SOURCE;
      const tail = advancedStart + advancedWidth;
      store.hpCurrent[row] = fieldInt(line, offsets, advancedStart + AdvHead.HP, -1);
      store.hpMax[row] = fieldInt(line, offsets, advancedStart + AdvHead.HP_MAX, -1);
      store.posX[row] = fieldFloat(line, offsets, tail - AdvTail.POS_X);
      store.posY[row] = fieldFloat(line, offsets, tail - AdvTail.POS_Y);
    }

    switch (code) {
      case Ev.SPELL_PERIODIC_DAMAGE:
      case Ev.SPELL_PERIODIC_HEAL:
        flags |= EvFlag.PERIODIC;
        break;
      default:
        break;
    }

    switch (code) {
      case Ev.SWING_DAMAGE:
      case Ev.SWING_DAMAGE_LANDED:
      case Ev.RANGE_DAMAGE:
      case Ev.SPELL_DAMAGE:
      case Ev.SPELL_PERIODIC_DAMAGE:
      case Ev.SPELL_BUILDING_DAMAGE:
      case Ev.DAMAGE_SHIELD:
      case Ev.DAMAGE_SPLIT:
      case Ev.ENVIRONMENTAL_DAMAGE: {
        const offset = this.resolveOverkillOffset(line, suffixStart, count);
        store.amount[row] = fieldFloat(line, offsets, suffixStart);
        store.waste[row] = fieldInt(line, offsets, suffixStart + offset, 0);
        if (suffixStart + offset + 4 < count) {
          store.absorbed[row] = fieldInt(line, offsets, suffixStart + offset + 4, 0);
        }
        if (suffixStart + offset + 5 < count && fieldBool(line, offsets, suffixStart + offset + 5)) {
          flags |= EvFlag.CRITICAL;
        }
        break;
      }
      case Ev.SPELL_HEAL:
      case Ev.SPELL_PERIODIC_HEAL: {
        // amount[, baseAmount], overhealing, absorbed, critical
        const width = count - suffixStart;
        const offset = width >= 5 ? 2 : 1;
        store.amount[row] = fieldFloat(line, offsets, suffixStart);
        store.waste[row] = fieldInt(line, offsets, suffixStart + offset, 0);
        if (suffixStart + offset + 1 < count) {
          store.absorbed[row] = fieldInt(line, offsets, suffixStart + offset + 1, 0);
        }
        if (suffixStart + offset + 2 < count && fieldBool(line, offsets, suffixStart + offset + 2)) {
          flags |= EvFlag.CRITICAL;
        }
        break;
      }
      case Ev.SPELL_ENERGIZE:
      case Ev.SPELL_PERIODIC_ENERGIZE:
      case Ev.SPELL_DRAIN:
      case Ev.SPELL_LEECH: {
        store.amount[row] = fieldFloat(line, offsets, suffixStart);
        break;
      }
      case Ev.SPELL_INTERRUPT:
      case Ev.SPELL_DISPEL:
      case Ev.SPELL_DISPEL_FAILED:
      case Ev.SPELL_STOLEN:
      case Ev.SPELL_AURA_BROKEN_SPELL: {
        // extraSpellId, extraSpellName, extraSchool[, auraType]
        // SPELL_AURA_BROKEN_SPELL is the one of these that carries an
        // auraType, and it trails the extra triple rather than leading it.
        if (isBuffField(line, offsets, suffixStart + 3, count)) flags |= EvFlag.BUFF;
        if (suffixStart < count) {
          const extra = fieldInt(line, offsets, suffixStart);
          store.extraSpellId[row] = extra;
          // The interrupted or dispelled spell is the one worth naming in a
          // breakdown — "interrupted Horrific Scream", not "cast Disrupt".
          if (extra !== 0 && suffixStart + 1 < count && !this.spellNames.has(extra)) {
            this.spellNames.set(extra, this.interner.intern(fieldStr(line, offsets, suffixStart + 1)));
          }
        }
        break;
      }
      case Ev.SWING_MISSED:
      case Ev.RANGE_MISSED:
      case Ev.SPELL_MISSED:
      case Ev.SPELL_PERIODIC_MISSED:
      case Ev.DAMAGE_SHIELD_MISSED: {
        flags |= EvFlag.MISSED;
        // missType, isOffHand, amountMissed, critical
        if (suffixStart < count && isAvoidMissType(fieldStr(line, offsets, suffixStart))) {
          flags |= EvFlag.AVOIDED;
        }
        if (suffixStart + 2 < count) {
          store.amount[row] = fieldFloat(line, offsets, suffixStart + 2);
        }
        break;
      }
      case Ev.SPELL_EXTRA_ATTACKS: {
        if (suffixStart < count) store.amount[row] = fieldFloat(line, offsets, suffixStart);
        break;
      }
      case Ev.SPELL_ABSORBED: {
        // Two shapes: a melee hit omits the attacker's spell triple, a spell
        // hit includes it. Both end the same way, so read from the tail:
        //   ..., shieldSpellId, shieldSpellName, shieldSchool,
        //        absorbedAmount, totalShieldAmount, critical
        // The last numeric field is the shield's whole pool, not what this hit
        // consumed, so the amount is three from the end rather than two — four
        // on a _SUPPORT row, which appends the supporter's GUID behind it.
        const tail = count - supportTail;
        if (tail >= 3) store.amount[row] = fieldFloat(line, offsets, tail - 3);
        if (tail >= 6) {
          const shield = fieldInt(line, offsets, tail - 6);
          store.extraSpellId[row] = shield;
          // "Absorbed 424K" is not an answer; "Power Word: Shield, from your
          // healer" is. Naming it costs one intern per distinct shield.
          if (shield !== 0 && !this.spellNames.has(shield)) {
            this.spellNames.set(shield, this.interner.intern(fieldStr(line, offsets, tail - 5)));
          }
        }
        // The caster triple sits ahead of the shield's, in both the melee and
        // the spell shape — only the attacker's own prefix differs between
        // them, and that is ahead of everything read here.
        if (tail >= 10) {
          const casterGuid = fieldStr(line, offsets, tail - 10);
          if (casterGuid.length > 0 && casterGuid.charCodeAt(0) !== 48) {
            const caster = this.actors.get(casterGuid);
            if (caster !== undefined) store.extraActor.set(row, caster.index);
          }
        }
        break;
      }
      case Ev.SPELL_HEAL_ABSORBED: {
        // Same tail minus the critical flag:
        //   ..., healSpellId, healSpellName, healSchool, absorbed, total
        const tail = count - supportTail;
        if (tail >= 2) store.amount[row] = fieldFloat(line, offsets, tail - 2);
        if (tail >= 5) store.extraSpellId[row] = fieldInt(line, offsets, tail - 5);
        break;
      }
      case Ev.SPELL_AURA_APPLIED:
      case Ev.SPELL_AURA_REFRESH:
      case Ev.SPELL_AURA_APPLIED_DOSE:
      case Ev.SPELL_AURA_REMOVED_DOSE: {
        // auraType, amount
        if (suffixStart + 1 < count) store.amount[row] = fieldFloat(line, offsets, suffixStart + 1);
        if (isBuffField(line, offsets, suffixStart, count)) flags |= EvFlag.BUFF;
        break;
      }
      case Ev.SPELL_AURA_REMOVED:
      case Ev.SPELL_AURA_BROKEN: {
        // The same auraType field, with nothing after it worth reading. Set on
        // the removal as well as the application because a recap's window can
        // open on an aura that was already up: the line taking it away is then
        // the only one that says what it was.
        if (isBuffField(line, offsets, suffixStart, count)) flags |= EvFlag.BUFF;
        break;
      }
      default:
        break;
    }

    // An Augmentation Evoker's contribution arrives as a _SUPPORT variant whose
    // final field is the supporter's GUID, taking the place of the ST/AOE
    // category rather than being appended after it. Recording it is what lets
    // a damage table either credit the evoker or avoid double-counting the
    // buffed player, instead of having to pick one at parse time.
    if (identity.support && count > 0) {
      const supporterGuid = fieldStr(line, offsets, count - 1);
      if (supporterGuid.length > 0 && supporterGuid.charCodeAt(0) !== 48) {
        const supporter = this.actors.get(supporterGuid);
        if (supporter !== undefined) {
          store.support.set(row, supporter.index);
          if (this.claimSupportTwin(store, row, code, supporter.index)) {
            flags |= EvFlag.SUPPORT_TWIN;
          } else if (store.extraSpellId[row] === 0) {
            // Not twinned, so a slice of somebody else's hit. Only where the
            // column is free: an absorb's _SUPPORT row has already filled it
            // with the shield, and that is a figure worth more than this one.
            this.recordSupportCarrier(store, row);
          }
        }
      }
    }

    // A SPELL_ABSORBED that named no attacker is parked here for the next
    // event that names one; anything else gets a chance to be that event.
    if (code === Ev.SPELL_ABSORBED) {
      if (sourceGuid.length === 0 || sourceGuid.charCodeAt(0) === 48) {
        this.expireOrphanAbsorbs(store.ts[row]!);
        this.orphanAbsorbs.push({
          row,
          dst: dest.index,
          spellId: store.spellId[row]!,
          ts: store.ts[row]!,
        });
      }
    } else if (this.orphanAbsorbs.length > 0 && ATTACKER_NAMING.has(code)) {
      this.claimOrphanAbsorb(store, source, dest.index, store.spellId[row]!, store.ts[row]!);
    }

    store.flags[row] = flags;
  }

  /**
   * Links a `_SUPPORT` row to the plain row it duplicates, if it has one.
   *
   * Which `_SUPPORT` rows have a twin is the whole question, because the suffix
   * covers two opposite things. An Augmentation Evoker's Ebon Might arrives
   * only as `_SUPPORT`, under the evoker's own spell id, for the part of an
   * ally's hit the buff added: there is no plain row carrying that id and the
   * amount is already inside the ally's own damage. A Scalecommander's
   * Bombardments arrives as both — the evoker's bomb, logged as an ordinary
   * SPELL_DAMAGE credited to whichever party member triggered it, with the
   * `_SUPPORT` copy beside it naming the evoker. Only the second kind is
   * misattributed, and the duplicate is the only thing in the log that says
   * which kind a row is.
   *
   * The twin is the row just before, rather than anything found by searching:
   * on two real logs every one of 4,376 Bombardments pairs, 679 Breath of Eons
   * pairs, 13,647 Fate Mirror pairs and 1,202 Inferno's Blessing pairs sat on
   * consecutive lines, and 426,499 Ebon Might rows had no plain row to sit
   * beside. The one hit that reaches further is the one a shield ate whole,
   * which the log writes as three lines rather than two — see `reach`.
   *
   * See EvFlag.SUPPORT_TWIN for what the flag then means to a damage table.
   */
  private claimSupportTwin(store: EventStore, row: number, code: Ev, supporter: number): boolean {
    // SPELL_ABSORBED's own _SUPPORT row is the exception that proves the rule:
    // it repeats the attack's spell, source and destination but carries the
    // supporter's share of the same shield rather than the whole of it — 1,325
    // of 13,008 on a real pair, and all 2,822 in that log shaped the same way.
    // Pairing it would hand an ally's absorbed damage to the evoker on nothing
    // more than two amounts coinciding.
    if (code === Ev.SPELL_ABSORBED) return false;

    const amount = store.amount[row]!;
    // How far back to look. A hit that landed is the row before. A hit a
    // shield swallowed whole has no damage row to copy: the log writes
    // SPELL_ABSORBED, then the *_MISSED naming the absorb, then a zero-amount
    // _SUPPORT row — so its twin is the absorb, two rows back. Leaving those
    // out left 0.43M of a real key's 29.5M of Bombardments, and a phantom row
    // of it in four players' tables.
    const reach = amount === 0 ? 2 : 1;
    for (let twin = row - 1; twin >= 0 && twin > row - 1 - reach; twin--) {
      if (!isSupportTwin(store, row, twin, code, amount)) continue;
      store.support.set(twin, supporter);
      store.flags[twin] = store.flags[twin]! | EvFlag.SUPPORT_TWIN;
      return true;
    }
    return false;
  }

  /**
   * Records the ability an Augmentation Evoker's slice rode in on.
   *
   * Ebon Might, Shifting Sands and Prescience have no row of their own. The
   * amount is part of an ally's hit, and the `_SUPPORT` row reports only how
   * much of that hit the evoker is owed — under the evoker's spell id, which
   * says nothing about what the ally pressed. The log puts the ability on the
   * line before: of 580,708 support damage and heal rows in a real raid log,
   * 580,639 sat directly behind a plain row with the same source and target,
   * and the 69 that did not sat behind a *_MISSED of the same pair, a tick a
   * shield had eaten. Rows already marked SUPPORT are stepped over, because
   * two buffs on one hit write two copies of it.
   *
   * Kept in `extraSpellId`, a column these rows leave empty, rather than in a
   * second sparse map the size of `support`. Without it, crediting the evoker
   * could only move a lump sum: their own table would show a total with no
   * abilities under it, and the ally's Kill Command would still read the
   * figure the evoker had just been paid for.
   */
  private recordSupportCarrier(store: EventStore, row: number): void {
    const floor = Math.max(0, row - SUPPORT_CARRIER_REACH);
    for (let origin = row - 1; origin >= floor; origin--) {
      if ((store.flags[origin]! & EvFlag.SUPPORT) !== 0) continue;
      // The first plain row back is the only candidate: if it is not the same
      // blow, nothing further back is either.
      if (store.srcActor[origin] !== store.srcActor[row]) return;
      if (store.dstActor[origin] !== store.dstActor[row]) return;
      if (store.ts[row]! - store.ts[origin]! > SUPPORT_TWIN_WINDOW_MS) return;
      store.extraSpellId[row] = store.spellId[origin]!;
      return;
    }
  }

  /**
   * Gives an absorb back the attacker the log left out.
   *
   * Blizzard writes the attacker as 0000000000000000 on a minority of
   * SPELL_ABSORBED lines — 121 of 6,444 on a +12 Den of Nalorakk — and that
   * damage is then credited to nobody at all. The log does say who it was,
   * within a line or two: the same blow appears again as a *_MISSED of type
   * ABSORB when the shield swallowed it whole, or as the damage event for the
   * remainder when it swallowed only part, and both name the attacker. Same
   * target, same spell, same instant.
   *
   * That was the last 0.15% between our damage tables and Warcraft Logs':
   * 497K belonging to a demonology warlock's imps and Overlord, 103K to a
   * death knight's Blood Plague, 70K to an elemental shaman. Small, but it
   * only ever subtracts, and it had made three of five players short.
   *
   * Matching is by target and spell, not by amount, because the absorb and its
   * partner are the same hit seen twice and a crit reports two amounts. The
   * window is a tenth of a second: a repeating DoT on the same target can land
   * again a second later, and inheriting that tick's source would be a guess.
   */
  private claimOrphanAbsorb(
    store: EventStore,
    source: Actor,
    dst: number,
    spellId: number,
    ts: number,
  ): void {
    this.expireOrphanAbsorbs(ts);
    for (let i = 0; i < this.orphanAbsorbs.length; i++) {
      const pending = this.orphanAbsorbs[i]!;
      if (pending.dst !== dst || pending.spellId !== spellId) continue;
      store.srcActor[pending.row] = source.index;
      this.orphanAbsorbs.splice(i, 1);
      return;
    }
  }

  /** Drops absorbs whose partner never arrived, so the list cannot grow. */
  private expireOrphanAbsorbs(ts: number): void {
    while (
      this.orphanAbsorbs.length > 0 &&
      ts - this.orphanAbsorbs[0]!.ts > ORPHAN_ABSORB_WINDOW_MS
    ) {
      this.orphanAbsorbs.shift();
    }
  }

  /**
   * Measures the advanced block instead of assuming its width.
   *
   * Every field in the block is an integer except the two position
   * coordinates and the facing angle, so the first field carrying a decimal
   * point is positionX. Its distance from the block start gives the width,
   * since positionX is always the fifth field from the end.
   *
   * This is what lets the parser survive Blizzard inserting stat fields in
   * the middle of the block, which is exactly what happened between
   * COMBAT_LOG_VERSION 21 and 22.
   */
  private calibrateAdvanced(line: string, advancedStart: number, count: number): number {
    if (this.advancedWidthLocked) return this.advancedWidth;
    const offsets = this.offsets;
    // Start past the GUIDs and health, which are never fractional, so a
    // creature at an integral coordinate cannot be mistaken for positionX.
    for (let i = advancedStart + AdvHead.SPELL_POWER; i < count; i++) {
      if (!fieldHasDot(line, offsets, i)) continue;
      const width = i - advancedStart + AdvTail.POS_X;
      if (width >= MIN_ADVANCED_FIELD_COUNT && width <= 48) {
        this.advancedWidth = width;
        this.advancedWidthLocked = true;
      }
      return this.advancedWidth;
    }
    // No fractional field: a unit with no known position. Try again next time.
    return this.advancedWidth;
  }

  /**
   * Resolves where `overkill` sits in a damage suffix block.
   *
   * Width alone is decisive at the extremes. In the ambiguous middle, overkill
   * is -1 on any hit that did not kill — which is the overwhelming majority —
   * so the sentinel identifies the slot. The answer is cached once a width
   * gives a definite reading, because it cannot change within one log file.
   */
  private resolveOverkillOffset(line: string, suffixStart: number, count: number): number {
    if (this.overkillLocked) return this.overkillOffset;
    const width = count - suffixStart;
    if (width >= 11) {
      this.overkillOffset = 2;
      this.overkillLocked = true;
      return 2;
    }
    if (width > 0 && width <= 9) {
      this.overkillOffset = 1;
      this.overkillLocked = true;
      return 1;
    }
    const offsets = this.offsets;
    if (suffixStart + 1 < count && fieldInt(line, offsets, suffixStart + 1, 0) === -1) {
      this.overkillOffset = 1;
      this.overkillLocked = true;
      return 1;
    }
    if (suffixStart + 2 < count && fieldInt(line, offsets, suffixStart + 2, 0) === -1) {
      this.overkillOffset = 2;
      this.overkillLocked = true;
      return 2;
    }
    // Undetermined so far: assume the current layout without locking, so a
    // later killing blow can still settle it.
    return this.overkillOffset > 0 ? this.overkillOffset : 2;
  }

  /**
   * COMBATANT_INFO marks party membership and carries spec, talents and gear.
   * Only the GUID and spec are read here; the raw line goes to the hook so the
   * desktop app can mine the rest without a second parse.
   *
   * The spec id is found structurally rather than by index: the line is
   * `GUID, faction, <stats...>, currentSpecID, [talents], [pvpTalents], ...`,
   * so the spec is the field immediately before the first bracketed array.
   * Indexing it at a fixed position broke when 12.1.0 added stat fields, and
   * the stats are all plain numbers, so the first `[` is unambiguous.
   */
  private handleCombatantInfo(line: string, count: number, actor: Actor): void {
    actor.inParty = true;
    const offsets = this.offsets;
    let specId = -1;
    for (let i = 2; i < count; i++) {
      if (!fieldIsArray(line, offsets, i)) continue;
      specId = fieldInt(line, offsets, i - 1, -1);
      break;
    }
    if (specId > 0) actor.specId = specId;
    this.hooks.onCombatantInfo?.({ ts: this.ts.ms, actor, specId, raw: line });
  }
}

/** Parses "[10,11,12]" or "[]" into numbers. Used for the affix list. */
export function parseIntArray(raw: string): number[] {
  const result: number[] = [];
  let value = 0;
  let digits = 0;
  let negative = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      value = value * 10 + (c - 48);
      digits++;
    } else if (c === 45 /* - */ && digits === 0) {
      negative = true;
    } else {
      if (digits > 0) result.push(negative ? -value : value);
      value = 0;
      digits = 0;
      negative = false;
    }
  }
  if (digits > 0) result.push(negative ? -value : value);
  return result;
}

/**
 * Whether the field at `index` is the literal BUFF.
 *
 * Compared in place rather than through fieldStr, because every aura line in a
 * run asks the question and a run has a lot of them: slicing the field out
 * would allocate a string per aura event to throw it away a character later.
 */
function isBuffField(line: string, out: Int32Array, index: number, count: number): boolean {
  if (index >= count) return false;
  const start = out[index << 1]!;
  if (out[(index << 1) | 1]! - start !== 4) return false;
  return (
    line.charCodeAt(start) === 66 /* B */ &&
    line.charCodeAt(start + 1) === 85 /* U */ &&
    line.charCodeAt(start + 2) === 70 /* F */ &&
    line.charCodeAt(start + 3) === 70 /* F */
  );
}

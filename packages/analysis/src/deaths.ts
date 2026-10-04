import { Ev, EvFlag } from '@mplus/parser';

import { actorName, spellName, type AnalysisContext } from './context.js';
import { DAMAGE_CODES, HEAL_CODES, SELF_DAMAGE_CODES, VICTIM_MELEE_CODES, effective } from './events.js';
import { SegmentKind, type SegmentIndex } from './segments.js';

/**
 * Death post-mortems.
 *
 * The question a key leader actually asks is never "who died" — the deaths tab
 * already says that — but "what was survivable here". So each death carries the
 * seconds leading up to it: the health trace, every hit that landed, what the
 * healer got off, and what the dying player themselves pressed.
 *
 * The health trace depends on a detail that is easy to get wrong. The advanced
 * block describes one unit, and which one varies by event: SWING_DAMAGE reports
 * the attacker while SWING_DAMAGE_LANDED and the spell events report the
 * victim. Reading health off the wrong rows yields a trace of the *attacker's*
 * health, which looks plausible and is entirely wrong. The parser records which
 * unit the block described, so the trace keeps only rows where the dying player
 * is the subject.
 */

export interface HpSample {
  ts: number;
  hp: number;
  hpMax: number;
  /** Fraction 0..1, or -1 when max health is unknown. */
  fraction: number;
}

export interface IncomingHit {
  ts: number;
  sourceIndex: number;
  sourceName: string;
  spellId: number;
  spellName: string;
  /** Effective damage, net of overkill. */
  amount: number;
  overkill: number;
  absorbed: number;
  critical: boolean;
  /** True when nothing hostile dealt it — a fall, or standing in fire. */
  environmental: boolean;
}

export interface HealReceived {
  ts: number;
  sourceName: string;
  spellId: number;
  spellName: string;
  /** Effective healing, net of overhealing. */
  amount: number;
  overhealing: number;
}

/**
 * One absorb that ate part of an incoming hit.
 *
 * Kept separate from `healsReceived` because an absorb is not a heal — it never
 * shows up in healing numbers — but it answers the same question, and "absorbed
 * 424K" on its own answers nothing: whether that was a Power Word: Shield, a
 * tank's own cooldown or a trinket is the whole point.
 */
export interface AbsorbReceived {
  ts: number;
  /** The shield's spell, not the attack it stopped. */
  spellId: number;
  spellName: string;
  /** Who put the shield up — often the dying player themselves. */
  sourceName: string;
  /** Whether that was the dying player, which reads as "their own". */
  selfApplied: boolean;
  amount: number;
}

export interface AbilityTotal {
  spellId: number;
  name: string;
  sourceName: string;
  total: number;
  hits: number;
}

export interface CastRecord {
  ts: number;
  spellId: number;
  name: string;
}

export interface DeathReport {
  actorIndex: number;
  name: string;
  specId: number;
  /** Store-relative ms of the death. */
  ts: number;
  segmentId: number;
  segmentLabel: string;
  segmentKind: SegmentKind | null;
  windowMs: number;
  /** Health over the window, oldest first. */
  trace: HpSample[];
  /** Every hit that landed in the window, oldest first. */
  incoming: IncomingHit[];
  /** The same damage grouped by ability, largest first. */
  byAbility: AbilityTotal[];
  /** The blow that finished them, if one can be identified. */
  killingBlow: IncomingHit | null;
  healsReceived: HealReceived[];
  /** Every absorb that fired in the window, oldest first. */
  absorbsReceived: AbsorbReceived[];
  damageTaken: number;
  healingReceived: number;
  absorbed: number;
  /** What the dying player cast in the window — did they press anything? */
  ownCasts: CastRecord[];
  /** Debuffs on them at the moment of death. */
  debuffsAtDeath: CastRecord[];
  /** Where they died, for a route map. */
  x: number;
  y: number;
  /** Gap since the previous party death, or null for the first. */
  sincePreviousDeathMs: number | null;
}

export interface DeathOptions {
  /** How far back to look. Ten seconds covers a full defensive window. */
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 10_000;

export function deathReports(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: DeathOptions = {},
): DeathReport[] {
  const { run } = context;
  const { store, actors } = run;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  const reports: DeathReport[] = [];
  let previousDeathTs: number | null = null;

  for (let row = 0; row < store.count; row++) {
    if (store.code[row] !== Ev.UNIT_DIED) continue;
    const victim = store.dstActor[row]!;
    const actor = actors.at(victim);
    // Party deaths only, and the victim itself must be a party member. Testing
    // attribute(victim) instead would count every pet and guardian death as a
    // player death — a Blood DK's Blood Beasts alone turned 9 real deaths into
    // 27 on a real log.
    if (actor === undefined || !segments.party.has(victim)) continue;

    const deathTs = store.ts[row]!;
    const report = buildReport(context, segments, victim, deathTs, row, windowMs);
    report.sincePreviousDeathMs = previousDeathTs === null ? null : deathTs - previousDeathTs;
    previousDeathTs = deathTs;
    reports.push(report);
  }

  return reports;
}

function buildReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  victim: number,
  deathTs: number,
  deathRow: number,
  windowMs: number,
): DeathReport {
  const { run } = context;
  const { store, actors } = run;
  const from = store.seek(deathTs - windowMs);

  const trace: HpSample[] = [];
  const incoming: IncomingHit[] = [];
  const healsReceived: HealReceived[] = [];
  const absorbsReceived: AbsorbReceived[] = [];
  const ownCasts: CastRecord[] = [];
  const debuffs = new Map<number, CastRecord>();
  const abilities = new Map<number, { total: number; hits: number; sources: Map<number, number> }>();

  let damageTaken = 0;
  let healingReceived = 0;
  let absorbed = 0;
  let x = 0;
  let y = 0;

  for (let row = from; row <= deathRow; row++) {
    const ts = store.ts[row]!;
    if (ts < deathTs - windowMs) continue;
    const code = store.code[row]!;
    const flags = store.flags[row]!;
    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;

    // Health trace. The advanced block describes exactly one unit; keep only
    // the rows where that unit is the dying player, whichever side they are on.
    if (flags & EvFlag.ADVANCED) {
      const subjectIsVictim =
        flags & EvFlag.INFO_IS_SOURCE ? src === victim : dst === victim;
      if (subjectIsVictim) {
        const hp = store.hpCurrent[row]!;
        const hpMax = store.hpMax[row]!;
        if (hp >= 0) {
          trace.push({ ts, hp, hpMax, fraction: hpMax > 0 ? hp / hpMax : -1 });
          const px = store.posX[row]!;
          const py = store.posY[row]!;
          if (px !== 0 || py !== 0) {
            x = px;
            y = py;
          }
        }
      }
    }

    if (dst !== victim) {
      // Casts by the dying player: what they did, or failed to do, in the window.
      if (src === victim && code === Ev.SPELL_CAST_SUCCESS) {
        const spellId = store.spellId[row]!;
        ownCasts.push({ ts, spellId, name: spellName(context, spellId) });
      }
      continue;
    }

    const amount = store.amount[row]!;
    const waste = store.waste[row]!;

    // Incoming damage. SWING_DAMAGE_LANDED is excluded from totals because it
    // duplicates SWING_DAMAGE; it has already served its purpose above by
    // carrying the victim's health.
    const isSelfDamage = SELF_DAMAGE_CODES.has(code);
    if (DAMAGE_CODES.has(code) || isSelfDamage) {
      if (flags & EvFlag.SUPPORT) continue; // a duplicate row
      if (VICTIM_MELEE_CODES.has(code)) continue;
      const net = effective(amount, waste);
      const spellId = store.spellId[row]!;
      const sourceOwner = actors.attribute(src);
      const hit: IncomingHit = {
        ts,
        sourceIndex: sourceOwner,
        sourceName: isSelfDamage ? 'Environment' : actorName(context, sourceOwner),
        spellId,
        spellName: spellName(context, spellId),
        amount: net,
        overkill: waste > 0 ? waste : 0,
        absorbed: store.absorbed[row]!,
        critical: (flags & EvFlag.CRITICAL) !== 0,
        environmental: isSelfDamage,
      };
      incoming.push(hit);
      damageTaken += net;

      let ability = abilities.get(spellId);
      if (ability === undefined) {
        ability = { total: 0, hits: 0, sources: new Map() };
        abilities.set(spellId, ability);
      }
      ability.total += net;
      ability.hits++;
      ability.sources.set(sourceOwner, (ability.sources.get(sourceOwner) ?? 0) + net);
      continue;
    }

    if (HEAL_CODES.has(code)) {
      const net = effective(amount, waste);
      healingReceived += net;
      healsReceived.push({
        ts,
        sourceName: actorName(context, actors.attribute(src)),
        spellId: store.spellId[row]!,
        spellName: spellName(context, store.spellId[row]!),
        amount: net,
        overhealing: waste > 0 ? waste : 0,
      });
      continue;
    }

    if (code === Ev.SPELL_ABSORBED) {
      absorbed += amount;
      // The shield is in extraSpellId, not spellId: spellId is the attack it
      // stopped, which is already in `incoming`.
      const shieldId = store.extraSpellId[row]!;
      const caster = store.extraActor.get(row);
      const casterIndex = caster === undefined ? -1 : actors.attribute(caster);
      absorbsReceived.push({
        ts,
        spellId: shieldId,
        spellName: shieldId === 0 ? 'Absorb' : spellName(context, shieldId),
        sourceName: casterIndex < 0 ? '' : actorName(context, casterIndex),
        selfApplied: casterIndex === victim,
        amount,
      });
      continue;
    }

    // Track debuffs so the report can say what was on them when they died.
    if (code === Ev.SPELL_AURA_APPLIED || code === Ev.SPELL_AURA_REFRESH) {
      const spellId = store.spellId[row]!;
      debuffs.set(spellId, { ts, spellId, name: spellName(context, spellId) });
    } else if (code === Ev.SPELL_AURA_REMOVED) {
      debuffs.delete(store.spellId[row]!);
    }
  }

  // The finishing blow is the hit that overkilled; failing that, the last one.
  let killingBlow: IncomingHit | null = null;
  for (let i = incoming.length - 1; i >= 0; i--) {
    const hit = incoming[i]!;
    if (hit.overkill > 0) {
      killingBlow = hit;
      break;
    }
  }
  if (killingBlow === null && incoming.length > 0) killingBlow = incoming[incoming.length - 1]!;

  const segmentId = segments.segmentOf(deathRow) >= 0 ? segments.segmentOf(deathRow) : segmentAt(segments, deathTs);
  const segment = segments.get(segmentId);
  const actor = actors.at(victim);

  return {
    actorIndex: victim,
    name: actorName(context, victim),
    specId: actor?.specId ?? -1,
    ts: deathTs,
    segmentId,
    segmentLabel: segment?.label ?? 'Out of combat',
    segmentKind: segment?.kind ?? null,
    windowMs,
    trace,
    incoming,
    byAbility: [...abilities.entries()]
      .map(([spellId, value]) => ({
        spellId,
        name: spellName(context, spellId),
        sourceName: dominant(context, value.sources),
        total: value.total,
        hits: value.hits,
      }))
      .sort((a, b) => b.total - a.total),
    killingBlow,
    healsReceived,
    absorbsReceived,
    damageTaken,
    healingReceived,
    absorbed,
    ownCasts,
    debuffsAtDeath: [...debuffs.values()].sort((a, b) => a.ts - b.ts),
    x,
    y,
    sincePreviousDeathMs: null,
  };
}

/**
 * UNIT_DIED has no hostile side, so it cannot be segmented by enemy. Fall back
 * to the narrowest segment whose window contains it, preferring a boss, since a
 * death during a boss fight belongs to that fight even if a dragged-in pack is
 * also live.
 */
function segmentAt(segments: SegmentIndex, ts: number): number {
  let best = -1;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const segment of segments.segments) {
    if (ts < segment.startTs || ts > segment.endTs) continue;
    const span = segment.endTs - segment.startTs;
    const better =
      best < 0 ||
      (segment.kind === SegmentKind.BOSS && segments.get(best)?.kind !== SegmentKind.BOSS) ||
      span < bestSpan;
    if (better) {
      best = segment.id;
      bestSpan = span;
    }
  }
  return best;
}

function dominant(context: AnalysisContext, sources: Map<number, number>): string {
  let best = -1;
  let bestTotal = -1;
  for (const [index, total] of sources) {
    if (total > bestTotal) {
      best = index;
      bestTotal = total;
    }
  }
  return best < 0 ? '' : actorName(context, best);
}

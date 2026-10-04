import { Ev, EvFlag } from '@mplus/parser';

import { actorName, spellName, type AnalysisContext } from './context.js';
import { DAMAGE_CODES, HEAL_CODES, SELF_DAMAGE_CODES, effective, wasted } from './events.js';
import { SegmentKind, type SegmentIndex } from './segments.js';

/**
 * Damage and healing breakdowns, overall or for one segment.
 *
 * Two attribution rules do the real work here.
 *
 * Pets roll up to their owner, so a Wild Imp's damage lands on the warlock.
 *
 * _SUPPORT events are excluded from totals. They are not extra damage: on a
 * real log the _SUPPORT copies of Bombardments matched the plain events hit for
 * hit — same timestamps, same amounts, 38.0M on both sides — so they are the
 * same damage reported a second time to say who enabled it. Summing both would
 * inflate every total. Instead the amount is tracked as credit, and
 * `creditSupport` moves it from the player who dealt it to the player who
 * enabled it, leaving the run total unchanged.
 */

export type Direction = 'done' | 'taken';

export interface SpellBreakdown {
  spellId: number;
  name: string;
  /** Effective amount, net of overkill or overhealing. */
  total: number;
  /** Gross amount as logged. */
  raw: number;
  wasted: number;
  hits: number;
  crits: number;
  /** Effective amount the crits among those hits accounted for. */
  critTotal: number;
  /** Periodic ticks, counted within `hits`. */
  ticks: number;
  /**
   * Times the ability was cast successfully, which hits cannot stand in for:
   * one cast of a DoT is a dozen ticks and one cleave is five hits. Zero for
   * damage taken, where the casts belong to the enemy, not to the victim.
   */
  casts: number;
  max: number;
  /** Largest single contributor, for damage taken. */
  topSourceName: string;
}

export interface ActorBreakdown {
  actorIndex: number;
  name: string;
  specId: number;
  total: number;
  raw: number;
  wasted: number;
  /** Damage this actor enabled for others; already inside their totals. */
  supportGiven: number;
  /** How much of this actor's total a supporter is credited for. */
  supportReceived: number;
  perSecond: number;
  /** Fraction of the report total, 0..1. */
  share: number;
  spells: SpellBreakdown[];
}

export interface BreakdownReport {
  label: string;
  actors: ActorBreakdown[];
  total: number;
  wasted: number;
  durationMs: number;
  /** Amount whose hostile side could not be identified (environment, etc). */
  unattributed: number;
}

export interface BreakdownOptions {
  /** Restrict to one segment. Omit for the whole run. */
  segmentId?: number;
  direction?: Direction;
  /** Move _SUPPORT credit from the dealer to the supporter. */
  creditSupport?: boolean;
}

interface SpellAcc {
  spellId: number;
  total: number;
  raw: number;
  wasted: number;
  hits: number;
  crits: number;
  critTotal: number;
  ticks: number;
  max: number;
  sources: Map<number, number>;
}

interface ActorAcc {
  actorIndex: number;
  total: number;
  raw: number;
  wasted: number;
  supportGiven: number;
  supportReceived: number;
  spells: Map<number, SpellAcc>;
  /** Spell id -> successful casts. Kept apart from `spells`, which is amounts. */
  casts: Map<number, number>;
}

export function damageReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: BreakdownOptions = {},
): BreakdownReport {
  return build(context, segments, options, 'damage');
}

export function healingReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: BreakdownOptions = {},
): BreakdownReport {
  return build(context, segments, options, 'healing');
}

function build(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: BreakdownOptions,
  mode: 'damage' | 'healing',
): BreakdownReport {
  const { run } = context;
  const { store, actors } = run;
  const direction = options.direction ?? 'done';
  const creditSupport = options.creditSupport ?? false;
  const segmentId = options.segmentId;
  const segment = segmentId === undefined ? undefined : segments.get(segmentId);

  const codes = mode === 'healing' ? HEAL_CODES : DAMAGE_CODES;
  const accs = new Map<number, ActorAcc>();
  let unattributed = 0;

  const accFor = (index: number): ActorAcc => {
    let acc = accs.get(index);
    if (acc === undefined) {
      acc = {
        actorIndex: index,
        total: 0,
        raw: 0,
        wasted: 0,
        supportGiven: 0,
        supportReceived: 0,
        spells: new Map(),
        casts: new Map(),
      };
      accs.set(index, acc);
    }
    return acc;
  };

  /**
   * One successful cast by a party member.
   *
   * Filed by time rather than by enemy, like healing: a cast names no target
   * in the log at all, so `segmentOf` has nothing to go on. Only the caster's
   * own casts are counted — a pet's are its own presses, not the owner's — and
   * only for `done`, because on `taken` the casts belong to the enemy.
   */
  const tallyCast = (row: number): void => {
    const caster = store.srcActor[row]!;
    if (!segments.party.has(caster)) return;
    if (segment !== undefined) {
      const ts = store.ts[row]!;
      if (ts < segment.startTs || ts > segment.endTs) return;
    }
    const casts = accFor(caster).casts;
    const spellId = store.spellId[row]!;
    casts.set(spellId, (casts.get(spellId) ?? 0) + 1);
  };

  // Scanning only the segment's time range still requires the per-enemy check
  // below, because a segment's window can contain another segment's events.
  const from = segment === undefined ? 0 : store.seek(segment.startTs);
  const to = segment === undefined ? store.count : store.seek(segment.endTs + 1);

  for (let row = from; row < to; row++) {
    const code = store.code[row]!;
    const isSelfDamage = mode === 'damage' && SELF_DAMAGE_CODES.has(code);
    if (code === Ev.SPELL_CAST_SUCCESS) {
      if (direction === 'done') tallyCast(row);
      continue;
    }
    if (!codes.has(code) && !isSelfDamage) continue;

    const flags = store.flags[row]!;
    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
    const srcOwner = actors.attribute(src);
    const dstOwner = actors.attribute(dst);
    const srcFriendly = segments.party.has(srcOwner);
    const dstFriendly = segments.party.has(dstOwner);

    // Healing is friendly-to-friendly, so it has no hostile side to segment by.
    // Attribute it by timestamp instead, which is correct because a heal cannot
    // belong to two segments the way a trash pack dragged into a boss can.
    let rowSegment: number;
    if (mode === 'healing') {
      rowSegment = segment === undefined ? -2 : segment.id;
    } else {
      rowSegment = segments.segmentOf(row);
    }
    if (segment !== undefined && rowSegment !== segment.id) {
      if (!isSelfDamage) continue;
      // Self damage has no enemy; fall back to the time window.
      const ts = store.ts[row]!;
      if (ts < segment.startTs || ts > segment.endTs) continue;
    }

    const subject = direction === 'done' ? srcOwner : dstOwner;
    const subjectFriendly = direction === 'done' ? srcFriendly : dstFriendly;
    if (mode === 'healing') {
      if (!subjectFriendly) continue;
    } else if (direction === 'done') {
      if (!srcFriendly || dstFriendly) continue;
    } else {
      if (!dstFriendly || (srcFriendly && !isSelfDamage)) continue;
    }

    const amount = store.amount[row]!;
    const waste = store.waste[row]!;
    const net = effective(amount, waste);

    if (flags & EvFlag.SUPPORT) {
      // A duplicate of a plain event. Record the credit; never add to a total.
      const supporter = store.support.get(row);
      if (supporter !== undefined) accFor(actors.attribute(supporter)).supportGiven += net;
      if (subjectFriendly) accFor(subject).supportReceived += net;
      if (creditSupport && supporter !== undefined) {
        const to = actors.attribute(supporter);
        if (to !== subject) {
          accFor(subject).total -= net;
          accFor(to).total += net;
        }
      }
      continue;
    }

    if (!subjectFriendly && mode === 'damage' && direction === 'taken' && !isSelfDamage) {
      unattributed += net;
      continue;
    }

    const acc = accFor(subject);
    acc.total += net;
    acc.raw += amount;
    acc.wasted += wasted(waste);

    const spellId = store.spellId[row]!;
    let spell = acc.spells.get(spellId);
    if (spell === undefined) {
      spell = {
        spellId,
        total: 0,
        raw: 0,
        wasted: 0,
        hits: 0,
        crits: 0,
        critTotal: 0,
        ticks: 0,
        max: 0,
        sources: new Map(),
      };
      acc.spells.set(spellId, spell);
    }
    spell.total += net;
    spell.raw += amount;
    spell.wasted += wasted(waste);
    spell.hits++;
    if (flags & EvFlag.CRITICAL) {
      spell.crits++;
      spell.critTotal += net;
    }
    if (flags & EvFlag.PERIODIC) spell.ticks++;
    if (net > spell.max) spell.max = net;
    if (direction === 'taken') {
      spell.sources.set(srcOwner, (spell.sources.get(srcOwner) ?? 0) + net);
    }
  }

  const durationMs =
    segment !== undefined
      ? Math.max(segment.endTs - segment.startTs, 1)
      : Math.max(run.meta.totalTimeMs ?? 1, 1);

  const total = [...accs.values()].reduce((sum, acc) => sum + Math.max(acc.total, 0), 0);
  const seconds = durationMs / 1000;

  const result: ActorBreakdown[] = [...accs.values()]
    .filter((acc) => acc.total !== 0 || acc.supportGiven !== 0)
    .map((acc) => {
      const actor = actors.at(acc.actorIndex);
      return {
        actorIndex: acc.actorIndex,
        name: actorName(context, acc.actorIndex),
        specId: actor?.specId ?? -1,
        total: acc.total,
        raw: acc.raw,
        wasted: acc.wasted,
        supportGiven: acc.supportGiven,
        supportReceived: acc.supportReceived,
        perSecond: acc.total / seconds,
        share: total > 0 ? acc.total / total : 0,
        spells: [...acc.spells.values()]
          .map((spell) => ({
            spellId: spell.spellId,
            name: spellName(context, spell.spellId),
            total: spell.total,
            raw: spell.raw,
            wasted: spell.wasted,
            hits: spell.hits,
            crits: spell.crits,
            critTotal: spell.critTotal,
            ticks: spell.ticks,
            casts: acc.casts.get(spell.spellId) ?? 0,
            max: spell.max,
            topSourceName: topSource(context, spell.sources),
          }))
          .sort((a, b) => b.total - a.total),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    label:
      segment === undefined
        ? mode === 'healing'
          ? 'Healing — whole key'
          : 'Damage — whole key'
        : `${segment.kind === SegmentKind.BOSS ? 'Boss' : 'Pull'}: ${segment.label}`,
    actors: result,
    total,
    wasted: [...accs.values()].reduce((sum, acc) => sum + acc.wasted, 0),
    durationMs,
    unattributed,
  };
}

function topSource(context: AnalysisContext, sources: Map<number, number>): string {
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

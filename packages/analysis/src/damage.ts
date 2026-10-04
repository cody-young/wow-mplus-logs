import { Ev, EvFlag } from '@mplus/parser';

import { abilityName, actorName, elapsedMs, spellName, type AnalysisContext } from './context.js';
import {
  ABSORBED_CODES,
  AURA_DOWN_CODES,
  AURA_UP_CODES,
  DAMAGE_CODES,
  HEAL_CODES,
  MISS_CODES,
  SELF_DAMAGE_CODES,
  effective,
  wasted,
} from './events.js';
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
  /**
   * Attempts that landed on nothing — missed, dodged, parried, immune. Absorbs
   * and blocks are excluded: the log reports those as misses too, but the blow
   * connected and its damage is counted elsewhere.
   */
  misses: number;
  /**
   * Milliseconds the ability's aura was up on at least one target, within the
   * report's window.
   *
   * A union rather than a sum, so a DoT on five targets reads as uptime and
   * not as 500%. Two limits worth knowing: an aura already up when the window
   * opened is only counted from the next time the log mentions it, because
   * nothing in the window says when it went on; and a merged row takes the
   * largest of its parts rather than their total, since the ids of one button
   * are variants of the same aura and adding them would exceed the fight.
   */
  uptimeMs: number;
  max: number;
  /** Largest single contributor, for damage taken. */
  topSourceName: string;
  /**
   * The individual spell ids this row merged, biggest first — absent unless
   * it merged more than one. See `abilityName` for what counts as the same
   * ability, and expect a row to have parts whenever a talent gave the button
   * a second id.
   */
  parts?: SpellBreakdown[];
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

/**
 * One ability's aura, mid-scan.
 *
 * `on` is the set of targets currently carrying it and `since` the instant the
 * set last became non-empty, which together give the union of its intervals in
 * one pass: a DoT ticking on five enemies is up once, not five times.
 */
interface AuraAcc {
  on: Set<number>;
  since: number;
  ms: number;
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
  /**
   * Spell id -> avoided attempts, and spell id -> aura uptime.
   *
   * Kept out of `spells` for the same reason as `casts`: a row is created by
   * damage, and these events are not damage. An ability that only ever missed
   * is worth a row, but a taunt, a slow or a crowd control is not, and every
   * one of those applies an aura. Merged in at build time, where ids with no
   * amount behind them are simply dropped.
   */
  misses: Map<number, number>;
  auras: Map<number, AuraAcc>;
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
  /** Party member -> spell id -> damage it did to the party. See the loop. */
  const friendlyFire = new Map<number, Map<number, number>>();
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
        misses: new Map(),
        auras: new Map(),
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

  /**
   * The report's window, hoisted above the scan because uptime needs it there:
   * an aura still up when the window closes has to be charged to its end, and
   * only the scan knows which auras those are.
   */
  const windowStart = segment === undefined ? 0 : segment.startTs;
  const windowEnd = segment === undefined ? Math.max(elapsedMs(run), 1) : segment.endTs;
  const durationMs = Math.max(windowEnd - windowStart, 1);

  // Scanning only the segment's time range still requires the per-enemy check
  // below, because a segment's window can contain another segment's events.
  const from = segment === undefined ? 0 : store.seek(segment.startTs);
  const to = segment === undefined ? store.count : store.seek(segment.endTs + 1);

  for (let row = from; row < to; row++) {
    const code = store.code[row]!;
    const isSelfDamage = mode === 'damage' && SELF_DAMAGE_CODES.has(code);
    // Absorbed hits are output, not damage received, so they join `done` only.
    const isAbsorbed = mode === 'damage' && direction === 'done' && ABSORBED_CODES.has(code);
    // The same rows, read the other way round: damage a shield stopped is
    // healing by whoever cast the shield. See `shielder` below.
    const isShielded = mode === 'healing' && direction === 'done' && ABSORBED_CODES.has(code);
    // Damage a party member did to the party, which healing has to weigh
    // against the ability that did it. See `friendlyFire` below.
    const isFriendlyFire = mode === 'healing' && direction === 'done' && DAMAGE_CODES.has(code);
    // An attempt that landed on nothing, for a miss rate. Damage only: a heal
    // cannot be dodged.
    const isMiss = mode === 'damage' && MISS_CODES.has(code);
    const auraUp = AURA_UP_CODES.has(code);
    const isAura = auraUp || AURA_DOWN_CODES.has(code);
    if (code === Ev.SPELL_CAST_SUCCESS) {
      if (direction === 'done') tallyCast(row);
      continue;
    }
    if (
      !codes.has(code) &&
      !isSelfDamage &&
      !isAbsorbed &&
      !isShielded &&
      !isFriendlyFire &&
      !isMiss &&
      !isAura
    ) {
      continue;
    }

    const flags = store.flags[row]!;
    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
    const srcOwner = actors.attribute(src);
    const dstOwner = actors.attribute(dst);
    const srcFriendly = segments.party.has(srcOwner);
    const dstFriendly = segments.party.has(dstOwner);

    /**
     * Whose shield stopped the hit, for the absorb rows healing counts.
     *
     * A SPELL_ABSORBED row's own source is whoever swung — the healer is in
     * the extra slot, where the parser puts the shield's caster. Without this
     * a blood death knight's Blood Shield and a warlock's Soul Leech are not
     * healing at all: on a real +12 that was 44.7M of the tank's 125.5M and
     * 12.2M of the warlock's 19.9M, and it is the whole reason a tank can
     * out-heal the healer on some pulls and show nothing for it.
     */
    const shielder = isShielded ? store.extraActor.get(row) : undefined;
    const shieldOwner = shielder === undefined ? -1 : actors.attribute(shielder);

    /**
     * Damage a party member dealt to the party, held aside until the end.
     *
     * Spirit Link Totem levels the group's health, which means healing
     * whoever is lowest by hurting whoever is highest — both under spell id
     * 98021. Count only the healing half and the shaman is credited with
     * 4.09M for an ability whose net effect that key was -0.47M.
     *
     * It is deliberately not subtracted here. Only abilities that also
     * healed are netted, which is resolved after the scan, because "did this
     * spell heal anyone" is not knowable at the row that damaged them.
     * Subtracting every friendly hit instead would charge a warlock for
     * Burning Rush and a shaman for Harsh Winds — self-harm that heals no
     * one, that Warcraft Logs does not deduct either, and that on this log
     * would have cost two players a figure that currently matches exactly.
     */
    if (isFriendlyFire) {
      if (srcFriendly && dstFriendly && (flags & EvFlag.SUPPORT) === 0) {
        let bySpell = friendlyFire.get(srcOwner);
        if (bySpell === undefined) {
          bySpell = new Map();
          friendlyFire.set(srcOwner, bySpell);
        }
        const spellId = store.spellId[row]!;
        const dealt = effective(store.amount[row]!, store.waste[row]!);
        bySpell.set(spellId, (bySpell.get(spellId) ?? 0) + dealt);
      }
      continue;
    }

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

    const subject = isShielded ? shieldOwner : direction === 'done' ? srcOwner : dstOwner;
    const subjectFriendly = isShielded
      ? shieldOwner >= 0 && segments.party.has(shieldOwner)
      : direction === 'done'
        ? srcFriendly
        : dstFriendly;
    if (mode === 'healing') {
      if (!subjectFriendly) continue;
      // A shield on an enemy stopped damage we dealt. That is the enemy's
      // mitigation, not our healing, and it is already counted as damage done.
      if (isShielded && !dstFriendly) continue;
    } else if (direction === 'done') {
      if (!srcFriendly || dstFriendly) continue;
    } else {
      if (!dstFriendly || (srcFriendly && !isSelfDamage)) continue;
    }

    /**
     * Misses and auras, which refine a row rather than fill one.
     *
     * Filed against the subject the damage rules already picked, so that the
     * two columns describe the same side of the fight as the amount beside
     * them: on `done` a debuff a player put on an enemy and a swing an enemy
     * avoided, on `taken` a debuff the player is carrying and a blow they
     * dodged. The friendly-side checks above have already dropped the rest —
     * party buffs on `done`, the player's own buffs on `taken`.
     */
    if (isMiss || isAura) {
      if (subjectFriendly && (flags & EvFlag.SUPPORT) === 0) {
        const subjectAcc = accFor(subject);
        const spellId = store.spellId[row]!;
        if (isMiss) {
          // Only a real avoid. An absorbed or blocked hit is logged as a miss
          // too, and its damage is already in the table — see EvFlag.AVOIDED.
          if (flags & EvFlag.AVOIDED) {
            subjectAcc.misses.set(spellId, (subjectAcc.misses.get(spellId) ?? 0) + 1);
          }
        } else {
          // Keyed on `dst` rather than its owner: the aura is on the unit the
          // event names, and two pets of one warlock are two targets.
          trackAura(subjectAcc.auras, spellId, dst, store.ts[row]!, auraUp);
        }
      }
      continue;
    }

    const amount = store.amount[row]!;
    // SPELL_ABSORBED puts the shielded amount in `amount` and leaves `waste`
    // for the shield's remaining pool, which is neither overkill nor
    // overhealing. A shield that expires unspent is waste that the log never
    // states, so absorbs contribute to a total and never to its overheal.
    const waste = isAbsorbed || isShielded ? 0 : store.waste[row]!;
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

    // The shield, not the blow it stopped: "Blood Shield", not "Melee".
    const spellId = isShielded ? store.extraSpellId[row]! : store.spellId[row]!;
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

  // An ability that healed the party and hurt it is one ability, and what it
  // did is the difference. Abilities that only ever hurt are not here: they
  // have no healing row to net against, so the lookup misses and they are
  // left alone. Overheal is untouched — it is a fact about healing, and a
  // Spirit Link that hurt someone did not overheal them.
  for (const [subject, bySpell] of friendlyFire) {
    const acc = accs.get(subject);
    if (acc === undefined) continue;
    for (const [spellId, dealt] of bySpell) {
      const spell = acc.spells.get(spellId);
      if (spell === undefined) continue;
      spell.total -= dealt;
      acc.total -= dealt;
    }
  }

  // Auras still up when the window closed. Without this a debuff applied once
  // and never removed — what anything lasting to the end of a pull looks like —
  // reads as no uptime at all rather than as all of it.
  for (const acc of accs.values()) {
    for (const aura of acc.auras.values()) {
      if (aura.on.size > 0 && aura.since >= 0) {
        aura.ms += Math.max(0, windowEnd - aura.since);
        aura.on.clear();
        aura.since = -1;
      }
    }
  }

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
        spells: buildSpells(context, acc, durationMs),
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

/**
 * One row per ability rather than one per spell id.
 *
 * Spell ids are how the log reports damage and abilities are how a player
 * thinks about it, and the two stopped lining up some expansions ago. An
 * enhancement shaman's Crash Lightning arrives under three ids — the cast,
 * the cleave it procs, and the hero talent's version — and listed separately
 * they are 16.9M, 9.8M and 19.1M, three unremarkable rows, when the ability
 * is 45.7M and the largest thing the player did.
 *
 * Nothing is lost: a merged row keeps its pieces in `parts`, so the table can
 * open it, and every total is the same sum it was before.
 */
function buildSpells(
  context: AnalysisContext,
  acc: ActorAcc,
  durationMs: number,
): SpellBreakdown[] {
  const one = (spell: SpellAcc): SpellBreakdown => ({
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
    misses: acc.misses.get(spell.spellId) ?? 0,
    // Clamped, so a column reading "101%" can never come out of a run whose
    // last event outran its own CHALLENGE_MODE_END.
    uptimeMs: Math.min(durationMs, acc.auras.get(spell.spellId)?.ms ?? 0),
    max: spell.max,
    topSourceName: topSource(context, spell.sources),
  });

  const groups = new Map<string, SpellAcc[]>();
  for (const spell of acc.spells.values()) {
    const key = abilityName(spellName(context, spell.spellId));
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [spell]);
    else members.push(spell);
  }

  const rows: SpellBreakdown[] = [];
  for (const [key, members] of groups) {
    const first = members[0]!;
    if (members.length === 1) {
      rows.push(one(first));
      continue;
    }
    const parts = members.map(one).sort((a, b) => b.total - a.total);
    // Sources are unioned rather than taken from the biggest part, so "who
    // hit me hardest with this" stays true of the ability and not of one of
    // its ids. Cheap: a merged row has two or three parts.
    const sources = new Map<number, number>();
    for (const spell of members) {
      for (const [source, amount] of spell.sources) {
        sources.set(source, (sources.get(source) ?? 0) + amount);
      }
    }
    rows.push({
      // The plain-named part, which is the ability's own spell and so the one
      // whose icon and tooltip a reader expects. Its variants are the
      // derivatives.
      spellId: (parts.find((part) => part.name === key) ?? parts[0]!).spellId,
      name: key,
      total: sum(parts, (part) => part.total),
      raw: sum(parts, (part) => part.raw),
      wasted: sum(parts, (part) => part.wasted),
      hits: sum(parts, (part) => part.hits),
      crits: sum(parts, (part) => part.crits),
      critTotal: sum(parts, (part) => part.critTotal),
      ticks: sum(parts, (part) => part.ticks),
      casts: sum(parts, (part) => part.casts),
      misses: sum(parts, (part) => part.misses),
      // The largest part, not their sum. The ids of one button are variants of
      // the same aura and are rarely up together, so adding them would report
      // an ability as up longer than the fight lasted.
      uptimeMs: parts.reduce((best, part) => Math.max(best, part.uptimeMs), 0),
      max: parts.reduce((best, part) => Math.max(best, part.max), 0),
      topSourceName: topSource(context, sources),
      parts,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

/**
 * One aura event folded into an ability's uptime.
 *
 * The targets carrying the aura are kept as a set rather than a count so the
 * intervals union in a single pass: a DoT ticking on five enemies is up once,
 * not five times, and uptime only advances when the last of them loses it.
 */
function trackAura(
  auras: Map<number, AuraAcc>,
  spellId: number,
  target: number,
  ts: number,
  up: boolean,
): void {
  let aura = auras.get(spellId);
  if (aura === undefined) {
    aura = { on: new Set(), since: -1, ms: 0 };
    auras.set(spellId, aura);
  }
  if (up) {
    if (aura.on.size === 0) aura.since = ts;
    aura.on.add(target);
    return;
  }
  // A removal for a target never seen gaining it belongs to an aura that went
  // up before the window opened, and nothing in the window says when. Dropped
  // rather than guessed: that understates such an aura and never invents one.
  if (!aura.on.delete(target)) return;
  if (aura.on.size === 0 && aura.since >= 0) {
    aura.ms += Math.max(0, ts - aura.since);
    aura.since = -1;
  }
}

function sum(parts: readonly SpellBreakdown[], of: (part: SpellBreakdown) => number): number {
  let total = 0;
  for (const part of parts) total += of(part);
  return total;
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

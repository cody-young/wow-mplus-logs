import { isButton, isDefensive, isInertMarker } from '@mplus/data';
import { Ev, EvFlag, environmentName } from '@mplus/parser';

import { actorName, spellName, type AnalysisContext } from './context.js';
import {
  AURA_DOWN_CODES,
  AURA_UP_CODES,
  DAMAGE_CODES,
  DEFERRED_ABSORBS,
  HEAL_CODES,
  SELF_DAMAGE_CODES,
  VICTIM_MELEE_CODES,
  creditedActor,
  effective,
} from './events.js';
import { SegmentKind, segmentAt, type SegmentIndex } from './segments.js';

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

/**
 * One aura's run on the dying player, as a span rather than two events.
 *
 * This is what turns "they had a defensive" into "the defensive was up for the
 * first four seconds and had fallen off before the hit that killed them",
 * which is a different conversation. The log states whether each aura was a
 * BUFF or a DEBUFF and the parser keeps it, so a shield and a stacking curse
 * are never filed in the same column.
 *
 * Spans are clamped to the capture window at both ends, and say which end was
 * clamped: an aura already up when the window opened and one applied inside it
 * look identical otherwise, and only the second one was a reaction.
 */
export interface AuraWindow {
  spellId: number;
  spellName: string;
  /** Who put it there. Empty when the log named no source. */
  sourceName: string;
  /** Whether that was the dying player, which reads as "their own". */
  selfApplied: boolean;
  /** auraType was BUFF. Debuffs are the complement, not a separate list. */
  buff: boolean;
  /**
   * The spell does something about damage — absorbs it, reduces it, avoids it,
   * or raises the health it has to get through.
   *
   * Read out of Blizzard's own effect data rather than a list somebody keeps
   * (see `@mplus/data/defensives`), so a spell reworked next patch reclassifies
   * itself. It is a fact about the spell and not about this aura: the same flag
   * is on a debuff version, which is why the recap pairs it with `buff` rather
   * than trusting it alone.
   */
  defensive: boolean;
  /**
   * The aura is the game talking to itself, and belongs in no list.
   *
   * Sated is the example: a debuff the player applies to themselves that exists
   * so the game remembers they have had Bloodlust. It has no effect — the
   * refusal to give them another lives in Bloodlust — and nothing about a death
   * is explained by it. The same shape covers Hypothermia, Cauterized, Cheated
   * Death and a used Demonic Gateway: a cooldown written down where the player
   * can see it.
   *
   * Two facts have to agree before it is safe to say so. The game's data gives
   * the spell no effect at all (see `@mplus/data/markers`, which is explicit
   * that plenty of boss mechanics look the same way, being scripted), and the
   * dying player applied it to themselves. Neither alone is enough; together
   * they only ever describe a note.
   *
   * Buffs are never marked, having their own narrowing to go through.
   */
  bookkeeping: boolean;
  /** Store-relative ms, clamped to the start of the capture window. */
  startTs: number;
  /** Store-relative ms, clamped to the death. */
  endTs: number;
  /** It was already up when the window opened, so `startTs` is the clamp. */
  openStart: boolean;
  /** It never came off, so `endTs` is the death. */
  openEnd: boolean;
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
  /**
   * The window every total below describes: damage taken, healing received,
   * absorbed, the ability breakdown and what they pressed.
   */
  windowMs: number;
  /**
   * The wider span the event lists cover — the trace, the hits, the heals, the
   * absorbs and the auras.
   *
   * Larger than `windowMs` because the recap can be scrolled back through it.
   * Ten seconds is the right answer to "what killed them" and the wrong one to
   * "when did this go wrong": a tank who spent twenty seconds without a
   * defensive did not start dying in the last ten.
   */
  scrollbackMs: number;
  /** Health over the capture window, oldest first. */
  trace: HpSample[];
  /** Every hit that landed in the capture window, oldest first. */
  incoming: IncomingHit[];
  /** Damage inside `windowMs` grouped by ability, largest first. */
  byAbility: AbilityTotal[];
  /** The blow that finished them, if one can be identified. */
  killingBlow: IncomingHit | null;
  healsReceived: HealReceived[];
  /** Every absorb that fired in the capture window, oldest first. */
  absorbsReceived: AbsorbReceived[];
  /** Auras that ran on them during the capture window, by start time. */
  auras: AuraWindow[];
  damageTaken: number;
  healingReceived: number;
  absorbed: number;
  /**
   * What the dying player pressed in the window — did they press anything?
   *
   * Presses only: the log reports a proc as a cast under the player's name too,
   * and those are dropped. See `pressed`.
   */
  ownCasts: CastRecord[];
  /** Debuffs on them at the moment of death. */
  debuffsAtDeath: CastRecord[];
  /** Where they died, for a route map. */
  x: number;
  y: number;
  /** Gap since the previous party death, or null for the first. */
  sincePreviousDeathMs: number | null;
  /**
   * How many of the group were dead at that moment, this death included.
   *
   * Not the death's place in the list. A raid brings people back — a battle
   * res, a soulstone, a shaman's Reincarnation — and a wipe on a real Mythic
   * pull had 23 deaths among 20 players. Counted by place, the fifth death
   * read as a quarter of the raid down while three of the five were already
   * back up and the raid was minutes from wiping.
   */
  deadAtOnce: number;
}

export interface DeathOptions {
  /** How far back the totals reach. Ten seconds covers a defensive window. */
  windowMs?: number;
  /** How far back the event lists reach. Never less than `windowMs`. */
  scrollbackMs?: number;
}

const DEFAULT_WINDOW_MS = 10_000;

/** The spell a shaman casts to come back from Reincarnation. */
const REINCARNATION = 21169;
/**
 * Thirty seconds of capture behind a ten-second verdict.
 *
 * The recap shows ten seconds at a time and slides that view back through
 * this, so the number is a budget rather than a reading: three screenfuls is
 * enough to reach the pull that went wrong without holding a minute of every
 * death in memory on a key with twenty of them.
 */
const DEFAULT_SCROLLBACK_MS = 30_000;

/**
 * Whether a cast under the player's name was something the player did.
 *
 * The log does not distinguish the two. A retribution paladin with Crusading
 * Strikes writes a SPELL_CAST_SUCCESS on every auto-attack, an evoker's
 * Charged Blast does it for a stacking buff, and a rogue flips a Fatebound
 * Coin — hundreds of casts apiece in one arena, none of them a keypress. Taken
 * at face value the recap reports a player hammering buttons as they died,
 * which is worse than reporting nothing: the one Shield Wall that is the actual
 * answer is buried in it.
 *
 * Two tables are asked, and either one is enough:
 *
 * - The game puts a clock on everything a player can press — a global
 *   cooldown, a cooldown of its own, or a charge — and gives a triggered spell
 *   none, because the thing that triggers it owns the rate. See
 *   `@mplus/data/buttons`.
 * - It is a defensive. A few of those carry no clock in the data at all
 *   (Renewing Blaze, Shield of Vengeance), and a defensive missing from the
 *   recap of the death it was pressed in is the one error worth ruling out at
 *   the cost of letting a defensive-shaped proc through.
 */
function pressed(spellId: number): boolean {
  return isButton(spellId) || isDefensive(spellId);
}

export function deathReports(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: DeathOptions = {},
): DeathReport[] {
  const { run } = context;
  const { store, actors } = run;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const scrollbackMs = Math.max(windowMs, options.scrollbackMs ?? DEFAULT_SCROLLBACK_MS);

  const reports: DeathReport[] = [];
  let previousDeathTs: number | null = null;
  /** Party members dead right now: in at a death, out at a sign they are back. */
  const dead = new Set<number>();

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    if (code === Ev.SPELL_RESURRECT) {
      dead.delete(store.dstActor[row]!);
      continue;
    }
    // Reincarnation is a shaman bringing themselves back, and logs no
    // SPELL_RESURRECT: the cast is the only sign. Any other cast is not proof
    // of life — a Demon Hunter's Shattered Souls is logged just after they die.
    if (code === Ev.SPELL_CAST_SUCCESS && store.spellId[row] === REINCARNATION) {
      dead.delete(store.srcActor[row]!);
      continue;
    }
    if (code !== Ev.UNIT_DIED) continue;
    // Feign Death, which the game logs as a death.
    if ((store.flags[row]! & EvFlag.FEIGNED) !== 0) continue;
    const victim = store.dstActor[row]!;
    const actor = actors.at(victim);
    // Party deaths only, and the victim itself must be a party member. Testing
    // attribute(victim) instead would count every pet and guardian death as a
    // player death — a Blood DK's Blood Beasts alone turned 9 real deaths into
    // 27 on a real log.
    if (actor === undefined || !segments.party.has(victim)) continue;
    dead.add(victim);

    const deathTs = store.ts[row]!;
    const report = buildReport(context, segments, victim, deathTs, row, windowMs, scrollbackMs);
    report.sincePreviousDeathMs = previousDeathTs === null ? null : deathTs - previousDeathTs;
    report.deadAtOnce = dead.size;
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
  scrollbackMs: number,
): DeathReport {
  const { run } = context;
  const { store, actors } = run;
  // The lists are gathered over the whole scrollback; the totals below count
  // only what landed inside `windowMs`, which is the window they are labelled
  // with everywhere they are shown.
  const captureStart = deathTs - scrollbackMs;
  const summaryStart = deathTs - windowMs;
  const from = store.seek(captureStart);

  const trace: HpSample[] = [];
  const incoming: IncomingHit[] = [];
  const healsReceived: HealReceived[] = [];
  const absorbsReceived: AbsorbReceived[] = [];
  const ownCasts: CastRecord[] = [];
  const auras: AuraWindow[] = [];
  /** Auras currently up, keyed by spell and caster: two healers' HoTs are two. */
  const openAuras = new Map<string, AuraWindow>();
  const abilities = new Map<number, { total: number; hits: number; sources: Map<number, number> }>();

  let damageTaken = 0;
  let healingReceived = 0;
  let absorbed = 0;
  let x = 0;
  let y = 0;

  for (let row = from; row <= deathRow; row++) {
    const ts = store.ts[row]!;
    if (ts < captureStart) continue;
    const inSummary = ts >= summaryStart;
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

    // Casts by the dying player: what they did, or failed to do, in the window.
    // Ahead of the victim/other split rather than inside it, because a cast
    // aimed at themselves names them as the destination too — a shield or a
    // heal on their own health bar, 3% of the casts in a real log.
    if (inSummary && src === victim && code === Ev.SPELL_CAST_SUCCESS) {
      const spellId = store.spellId[row]!;
      if (pressed(spellId)) ownCasts.push({ ts, spellId, name: spellName(context, spellId) });
    }

    if (dst !== victim) continue;

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
      const sourceOwner = creditedActor(run, row);
      const hit: IncomingHit = {
        ts,
        sourceIndex: sourceOwner,
        sourceName: isSelfDamage ? 'Environment' : actorName(context, sourceOwner),
        spellId,
        // An environmental row has no spell, so its name is what hurt: a fall
        // reads "Falling" rather than "Melee".
        spellName: isSelfDamage ? environmentName(store.extraSpellId[row]!) : spellName(context, spellId),
        amount: net,
        overkill: waste > 0 ? waste : 0,
        absorbed: store.absorbed[row]!,
        critical: (flags & EvFlag.CRITICAL) !== 0,
        environmental: isSelfDamage,
      };
      incoming.push(hit);
      if (!inSummary) continue;
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
      if (flags & EvFlag.SUPPORT) continue; // a duplicate row, as above
      const net = effective(amount, waste);
      if (inSummary) healingReceived += net;
      healsReceived.push({
        ts,
        sourceName: actorName(context, creditedActor(run, row)),
        spellId: store.spellId[row]!,
        spellName: spellName(context, store.spellId[row]!),
        amount: net,
        overhealing: waste > 0 ? waste : 0,
      });
      continue;
    }

    if (code === Ev.SPELL_ABSORBED) {
      // The shield is in extraSpellId, not spellId: spellId is the attack it
      // stopped, which is already in `incoming`.
      const shieldId = store.extraSpellId[row]!;
      // Stagger only moved the hit later, where its ticks are in `incoming`.
      if (DEFERRED_ABSORBS.has(shieldId)) continue;
      if (inSummary) absorbed += amount;
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

    // Auras, as spans. A refresh does not restart one: the question a recap
    // asks is whether the defensive was up for the hit, not how many times it
    // ticked over while it was.
    const auraUp = AURA_UP_CODES.has(code);
    if (auraUp || AURA_DOWN_CODES.has(code)) {
      const spellId = store.spellId[row]!;
      const caster = actors.attribute(src);
      const key = `${spellId}:${caster}`;
      const open = openAuras.get(key);
      if (auraUp) {
        if (open === undefined) {
          openAuras.set(key, {
            spellId,
            spellName: spellName(context, spellId),
            sourceName: caster < 0 ? '' : actorName(context, caster),
            selfApplied: caster === victim,
            buff: (flags & EvFlag.BUFF) !== 0,
            defensive: isDefensive(spellId),
            bookkeeping:
              (flags & EvFlag.BUFF) === 0 && caster === victim && isInertMarker(spellId),
            startTs: ts,
            endTs: deathTs,
            openStart: false,
            openEnd: true,
          });
        }
        continue;
      }
      if (open === undefined) {
        // Removed without ever being applied, so it was already up when the
        // window opened — the only line in the window that names it at all,
        // and the reason the removal carries an auraType too.
        auras.push({
          spellId,
          spellName: spellName(context, spellId),
          sourceName: caster < 0 ? '' : actorName(context, caster),
          selfApplied: caster === victim,
          buff: (flags & EvFlag.BUFF) !== 0,
          defensive: isDefensive(spellId),
          bookkeeping:
            (flags & EvFlag.BUFF) === 0 && caster === victim && isInertMarker(spellId),
          startTs: captureStart,
          endTs: ts,
          openStart: true,
          openEnd: false,
        });
        continue;
      }
      open.endTs = ts;
      open.openEnd = false;
      auras.push(open);
      openAuras.delete(key);
    }
  }

  // Whatever is still up ran to the death, which is exactly the set of auras
  // that were on them when they died.
  for (const open of openAuras.values()) auras.push(open);
  auras.sort((a, b) => a.startTs - b.startTs);

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
    scrollbackMs,
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
    auras,
    damageTaken,
    healingReceived,
    absorbed,
    ownCasts,
    // Debuffs rather than every aura: the log says which were buffs, and a
    // list headed "debuffs at death" that opens with Power Word: Shield is
    // worse than no list. Nor Sated, for the same reason one step further on.
    debuffsAtDeath: [...openAuras.values()]
      .filter((aura) => !aura.buff && !aura.bookkeeping)
      .map((aura) => ({ ts: aura.startTs, spellId: aura.spellId, name: aura.spellName }))
      .sort((a, b) => a.ts - b.ts),
    x,
    y,
    sincePreviousDeathMs: null,
    deadAtOnce: 0,
  };
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

import { isInterrupt } from '@mplus/data';
import { Ev } from '@mplus/parser';

import { actorName, spellName, type AnalysisContext } from './context.js';
import { MISS_CODES } from './events.js';
import type { SegmentIndex } from './segments.js';

/**
 * Interrupts: what was pressed, what it stopped, and what it stopped nothing.
 *
 * The two halves of this come from opposite ends of the log. Interrupts that
 * landed are stated outright — SPELL_INTERRUPT names the interrupt and the
 * cast it ended — and need no table and no inference. Interrupts that landed
 * on nothing are not reported at all: the press is an ordinary
 * SPELL_CAST_SUCCESS, indistinguishable from a Frostbolt until you know that
 * the spell's only job is to stop casts. That is what `@mplus/data/interrupts`
 * is for, and why a missing entry there costs whiffs and never stops.
 *
 * Pairing the two is easier than it looks. On five real logs the interrupt
 * followed its own cast by a median of 1ms and never by more than 84ms, so a
 * one-second window matches them with room to spare — and it matches on the
 * actor and the clock rather than on the spell, which it has to: a druid's
 * press is Skull Bash (106839) and the interrupt arrives as Skull Bash
 * (93985), and Solar Beam changes id the same way.
 *
 * The interesting part is the whiffs, because "pressed 15, interrupted 10" is
 * an accusation and usually a wrong one. Over sixteen real keys — 1,033
 * presses, 802 casts stopped — 122 of the 231 whiffs were somebody else
 * interrupting the same cast milliseconds earlier. Two cooldowns into one
 * cast is a different conversation from being asleep, and only 77 of the 231
 * were a press at a target that was not casting at all. So every whiff is put
 * to the target's own casts and reported with what became of the one it was
 * about. See InterruptOutcome.
 */

/**
 * What became of one press of an interrupt.
 *
 * Everything but `interrupted` is a whiff, and the distinctions are the point:
 * four of these are coordination or timing and one is a mechanic nobody can do
 * anything about.
 */
export type InterruptOutcome =
  /** A cast was stopped. More than one, for an area interrupt. */
  | 'interrupted'
  /**
   * Another party member's interrupt stopped that cast first.
   *
   * By far the commonest whiff — 122 of 231 over sixteen real keys — and the
   * only one that says something about the party rather than about the player:
   * two cooldowns went into one cast, and the next one is now uncovered.
   */
  | 'doubled'
  /**
   * The target was mid-cast and the cast carried on regardless.
   *
   * The log never says why, and the usual reason is that the cast could not be
   * interrupted. Stated as what was observed rather than as that conclusion,
   * because an immunity the log reports as nothing looks identical. Rare: 10
   * of 1,033 presses over sixteen keys.
   */
  | 'ignored'
  /** The cast it was aimed at had already finished. A beat too slow. */
  | 'late'
  /** The target began casting just after the press. A beat too soon. */
  | 'early'
  /** The log reports the interrupt itself as avoided: immune, or dodged. */
  | 'missed'
  /**
   * Nothing the press could have stopped.
   *
   * The target was not casting within a second either way — or the cast it
   * landed in ended without the log saying how, which is what a unit dying
   * mid-cast looks like.
   */
  | 'nothing';

/** One press of an interrupt by the party. */
export interface InterruptAttempt {
  /** Store-relative ms. */
  ts: number;
  /** The player it counts for: a pet's press is its owner's. */
  actorIndex: number;
  name: string;
  specId: number;
  /** The pet that cast it, when one did. Empty when the player pressed it. */
  petName: string;
  /** The button, which is not always the id the interrupt is logged under. */
  spellId: number;
  spellName: string;
  /** -1 when the press named no target. */
  targetIndex: number;
  targetName: string;
  outcome: InterruptOutcome;
  /** Casts this press stopped: 0 on a whiff, above 1 for an area interrupt. */
  stops: number;
  /** The enemy cast this press turned out to be about; 0 when none was found. */
  castSpellId: number;
  castSpellName: string;
  /** Who stopped that cast instead. Only set on `doubled`. */
  beatenBy: string;
  /**
   * The pull or boss the target belongs to, like a damage event's — and -1
   * when the target belongs to none, which is an enemy the party interrupted
   * without ever damaging. Three of 799 presses on a real evening.
   */
  segmentId: number;
}

/** One cast the party stopped. */
export interface InterruptStop {
  ts: number;
  actorIndex: number;
  name: string;
  specId: number;
  /** The interrupt as the log names it, which is not always the button. */
  spellId: number;
  spellName: string;
  targetIndex: number;
  targetName: string;
  /** The cast that was stopped, which is what anyone actually asks about. */
  castSpellId: number;
  castSpellName: string;
  /** The target's segment, or -1 when it belongs to none. See the attempt. */
  segmentId: number;
}

export interface InterruptReport {
  /** Every press, in order. */
  attempts: InterruptAttempt[];
  /** Every cast stopped, in order. Longer than `attempts` when an area
   *  interrupt caught two, shorter whenever anything whiffed. */
  stops: InterruptStop[];
}

export interface InterruptOptions {
  /** How long after a press its own interrupt may arrive. */
  pairMs?: number;
  /** How far from a press a target's cast may be to be the one it was about. */
  aimMs?: number;
}

/**
 * A press is never logged after the interrupt it caused — but both carry the
 * same millisecond often enough that the two lines can arrive in either order,
 * so the pairing window opens slightly before the press.
 */
const SLACK_MS = 100;
const DEFAULT_PAIR_MS = 1000;
const DEFAULT_AIM_MS = 1000;
/**
 * How close two of a player's presses have to be to be one press.
 *
 * One button, two cast lines: a druid's Skull Bash is logged as a
 * SPELL_CAST_SUCCESS for 93985 and another for 106839, same millisecond, same
 * target, every single time. Counted as written, a druid presses 46 interrupts
 * a key and lands 17 of them — the hit rate halves and the second line of each
 * pair is reported as a whiff, since the first has already claimed the
 * interrupt. The same shape as the damage tables' merged ability rows (see
 * `abilityName`), and the same answer: one press.
 *
 * Nothing legitimate is lost to this. Interrupts are on cooldowns of ten
 * seconds and up, and no player presses two of them at one target in the same
 * millisecond.
 */
const DUPLICATE_MS = 50;
/**
 * How long a cast nothing ever ended is assumed to run.
 *
 * A unit that despawns stops being reported mid-cast, and without a cap its
 * last cast would still be "in progress" minutes later and would answer for
 * every later press on it. A cast that nothing ends is rare — a handful per
 * evening — so the cap decides very little; it only has to be shorter than
 * the key.
 */
const UNENDED_CAST_MS = 10_000;

/** How a cast ended, which is the whole of what a whiff can be explained by. */
type CastEnd = 'completed' | 'interrupted' | 'failed' | 'gone' | 'open';

interface CastWindow {
  spellId: number;
  startTs: number;
  /** Where it ended; meaningless while `how` is 'open'. */
  endTs: number;
  how: CastEnd;
  /** On 'interrupted', who stopped it. */
  byActor: number;
}

interface Press {
  row: number;
  ts: number;
  /** The player credited: the owner, when a pet pressed it. */
  actor: number;
  /** The unit that actually cast it. */
  caster: number;
  spellId: number;
  target: number;
}

interface Stop {
  row: number;
  ts: number;
  actor: number;
  spellId: number;
  castSpellId: number;
  target: number;
}

export function interruptReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: InterruptOptions = {},
): InterruptReport {
  const { run } = context;
  const { store, actors } = run;
  const pairMs = options.pairMs ?? DEFAULT_PAIR_MS;
  const aimMs = options.aimMs ?? DEFAULT_AIM_MS;
  const ours = (index: number): boolean => index >= 0 && segments.party.has(actors.attribute(index));

  const presses: Press[] = [];
  /** Each player's last press, to recognise the second line of one press. */
  const lastPress = new Map<number, Press>();
  const stops: Stop[] = [];
  /** Avoided presses, so an immune target is not read as an empty room. */
  const misses: Press[] = [];
  /** Enemy casts with a cast time, by unit. Instant casts cannot be stopped. */
  const windows = new Map<number, CastWindow[]>();
  const open = new Map<number, CastWindow>();

  const close = (unit: number, ts: number, how: CastEnd, byActor = -1): void => {
    const window = open.get(unit);
    if (window === undefined) return;
    window.endTs = ts;
    window.how = how;
    window.byActor = byActor;
    open.delete(unit);
  };

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    const ts = store.ts[row]!;
    const src = store.srcActor[row]!;
    const spellId = store.spellId[row]!;

    switch (code) {
      case Ev.SPELL_CAST_START: {
        // Only the enemy side: a press is matched against what the target was
        // casting, and the party's own cast bars answer nothing here.
        if (src < 0 || ours(src)) break;
        // A new cast with the old one still open means the old one was
        // cancelled — the game logs nothing at all for that.
        close(src, ts, 'gone');
        const window: CastWindow = { spellId, startTs: ts, endTs: ts, how: 'open', byActor: -1 };
        open.set(src, window);
        let list = windows.get(src);
        if (list === undefined) {
          list = [];
          windows.set(src, list);
        }
        // Pushed while still open and finished in place by `close`.
        list.push(window);
        break;
      }

      case Ev.SPELL_CAST_SUCCESS: {
        if (ours(src) && isInterrupt(spellId)) {
          const actor = actors.attribute(src);
          const target = store.dstActor[row]!;
          const previous = lastPress.get(actor);
          if (
            previous !== undefined &&
            previous.target === target &&
            ts - previous.ts <= DUPLICATE_MS
          ) {
            // The same press under its other id. See DUPLICATE_MS.
            break;
          }
          const press: Press = { row, ts, actor, caster: src, spellId, target };
          presses.push(press);
          lastPress.set(actor, press);
          break;
        }
        const window = open.get(src);
        if (window !== undefined && window.spellId === spellId) close(src, ts, 'completed');
        break;
      }

      case Ev.SPELL_CAST_FAILED: {
        const window = open.get(src);
        if (window !== undefined && window.spellId === spellId) close(src, ts, 'failed');
        break;
      }

      case Ev.SPELL_INTERRUPT: {
        const target = store.dstActor[row]!;
        if (ours(src)) {
          stops.push({
            row,
            ts,
            actor: actors.attribute(src),
            spellId,
            // The interrupted spell is the suffix one. The prefix is the
            // interrupt itself, which is already known from the press.
            castSpellId: store.extraSpellId[row]!,
            target,
          });
        }
        // Closed whoever did it, so a cast an enemy interrupted — mobs
        // interrupt each other's casters, and players — is not left open.
        const window = open.get(target);
        if (window !== undefined && window.spellId === store.extraSpellId[row]!) {
          close(target, ts, 'interrupted', actors.attribute(src));
        }
        break;
      }

      case Ev.UNIT_DIED:
      case Ev.UNIT_DESTROYED:
      case Ev.UNIT_DISSIPATES:
        close(store.dstActor[row]!, ts, 'gone');
        break;

      default:
        // Any miss at all, without the AVOIDED narrowing the miss rate needs:
        // an interrupt carries no damage, so there is no absorbed-or-blocked
        // row here for that flag to tell apart from a real failure to land.
        if (MISS_CODES.has(code) && isInterrupt(spellId) && ours(src)) {
          misses.push({
            row,
            ts,
            actor: actors.attribute(src),
            caster: src,
            spellId,
            target: store.dstActor[row]!,
          });
        }
    }
  }

  const endOf = (window: CastWindow): number =>
    window.how === 'open' ? window.startTs + UNENDED_CAST_MS : window.endTs;

  // Stops by the player they count for, as indices, so a press can claim the
  // ones that followed it without scanning every interrupt in the key.
  const byActor = new Map<number, number[]>();
  for (let at = 0; at < stops.length; at++) {
    const actor = stops[at]!.actor;
    let list = byActor.get(actor);
    if (list === undefined) {
      list = [];
      byActor.set(actor, list);
    }
    list.push(at);
  }
  const claimed = new Uint8Array(stops.length);

  const attempts: InterruptAttempt[] = [];
  for (const press of presses) {
    const mine: Stop[] = [];
    for (const at of byActor.get(press.actor) ?? []) {
      if (claimed[at] === 1) continue;
      const stop = stops[at]!;
      if (stop.ts < press.ts - SLACK_MS) continue;
      if (stop.ts > press.ts + pairMs) break;
      claimed[at] = 1;
      mine.push(stop);
    }
    attempts.push(describe(context, segments, press, mine, windows, endOf, aimMs, misses));
  }

  /*
   * An interrupt whose press the log never recorded.
   *
   * None of the 802 interrupts across sixteen real keys arrived this way, so
   * this is defence rather than a known case — a proc, a trinket, a pet
   * ability logged without its cast. Giving it an attempt of its own keeps the one
   * invariant the panel depends on: nobody can have stopped more casts than
   * they pressed buttons.
   */
  for (let at = 0; at < stops.length; at++) {
    if (claimed[at] === 1) continue;
    const stop = stops[at]!;
    attempts.push(
      describe(
        context,
        segments,
        { row: stop.row, ts: stop.ts, actor: stop.actor, caster: stop.actor, spellId: stop.spellId, target: stop.target },
        [stop],
        windows,
        endOf,
        aimMs,
        misses,
      ),
    );
  }
  attempts.sort((a, b) => a.ts - b.ts);

  return {
    attempts,
    stops: stops.map((stop) => ({
      ts: stop.ts,
      actorIndex: stop.actor,
      name: actorName(context, stop.actor),
      specId: actors.at(stop.actor)?.specId ?? -1,
      spellId: stop.spellId,
      spellName: spellName(context, stop.spellId),
      targetIndex: stop.target,
      targetName: stop.target < 0 ? '' : actorName(context, stop.target),
      castSpellId: stop.castSpellId,
      castSpellName: stop.castSpellId === 0 ? '' : spellName(context, stop.castSpellId),
      segmentId: segments.segmentOf(stop.row),
    })),
  };
}

function describe(
  context: AnalysisContext,
  segments: SegmentIndex,
  press: Press,
  mine: readonly Stop[],
  windows: ReadonlyMap<number, CastWindow[]>,
  endOf: (window: CastWindow) => number,
  aimMs: number,
  misses: readonly Press[],
): InterruptAttempt {
  const { actors } = context.run;
  const attempt: InterruptAttempt = {
    ts: press.ts,
    actorIndex: press.actor,
    name: actorName(context, press.actor),
    specId: actors.at(press.actor)?.specId ?? -1,
    petName: press.caster === press.actor ? '' : actorName(context, press.caster),
    spellId: press.spellId,
    spellName: spellName(context, press.spellId),
    targetIndex: press.target,
    targetName: press.target < 0 ? '' : actorName(context, press.target),
    outcome: 'nothing',
    stops: mine.length,
    castSpellId: 0,
    castSpellName: '',
    beatenBy: '',
    segmentId: segments.segmentOf(press.row),
  };

  if (mine.length > 0) {
    attempt.outcome = 'interrupted';
    // The first cast stopped. An area interrupt catches others, which `stops`
    // counts and the stop list names individually.
    const first = mine[0]!;
    attempt.castSpellId = first.castSpellId;
    attempt.castSpellName = first.castSpellId === 0 ? '' : spellName(context, first.castSpellId);
    return attempt;
  }

  /*
   * Avoided outright. Tested before the target's casts, because what the
   * target was doing explains nothing about a blow that never arrived.
   *
   * Matched on the player and the clock, deliberately not on the spell: one
   * press can be logged under two ids (see DUPLICATE_MS) and there is nothing
   * to say the miss carries the same one of them as the cast. Two interrupts
   * from one player a fifth of a second apart is not a thing that happens, so
   * the looser match costs nothing.
   */
  for (const miss of misses) {
    if (miss.actor !== press.actor) continue;
    if (Math.abs(miss.ts - press.ts) > SLACK_MS * 2) continue;
    attempt.outcome = 'missed';
    return attempt;
  }

  const list = windows.get(press.target) ?? [];
  const name = (window: CastWindow): void => {
    attempt.castSpellId = window.spellId;
    attempt.castSpellName = spellName(context, window.spellId);
  };

  for (const window of list) {
    if (press.ts < window.startTs || press.ts > endOf(window)) continue;
    name(window);
    if (window.how === 'interrupted' && window.byActor !== press.actor) {
      attempt.outcome = 'doubled';
      attempt.beatenBy = window.byActor < 0 ? '' : actorName(context, window.byActor);
    } else if (window.how === 'completed') {
      attempt.outcome = 'ignored';
    } else {
      // Cancelled, or the unit died with it still running. Either way there
      // was nothing left for the press to stop, and the log does not say so.
      attempt.outcome = 'nothing';
    }
    return attempt;
  }

  // Nothing in progress, so the nearest cast on either side decides: one that
  // has just ended is a press a beat too slow, one about to start is a beat
  // too quick, and no cast at all is a press at nobody.
  for (let at = list.length - 1; at >= 0; at--) {
    const window = list[at]!;
    if (window.how === 'open' || window.endTs > press.ts) continue;
    if (press.ts - window.endTs > aimMs) break;
    name(window);
    if (window.how === 'interrupted' && window.byActor !== press.actor) {
      attempt.outcome = 'doubled';
      attempt.beatenBy = window.byActor < 0 ? '' : actorName(context, window.byActor);
    } else {
      attempt.outcome = 'late';
    }
    return attempt;
  }

  for (const window of list) {
    if (window.startTs <= press.ts) continue;
    if (window.startTs - press.ts > aimMs) break;
    name(window);
    attempt.outcome = 'early';
    return attempt;
  }

  return attempt;
}

/** One interrupt button, as one player used it. */
export interface InterruptAbility {
  spellId: number;
  name: string;
  casts: number;
  stops: number;
}

export interface InterruptActor {
  actorIndex: number;
  name: string;
  specId: number;
  /** Presses. */
  casts: number;
  /** Casts stopped, which an area interrupt can push above `casts`. */
  stops: number;
  /** Presses that stopped nothing: `casts` minus the ones that landed. */
  whiffs: number;
  /** Presses by outcome. Sums to `casts`. */
  outcomes: Record<InterruptOutcome, number>;
  abilities: InterruptAbility[];
}

/** One enemy cast, as often as the party stopped it. */
export interface StoppedCast {
  spellId: number;
  name: string;
  count: number;
  /** The enemy that cast it most often. */
  sourceName: string;
}

export interface InterruptSummary {
  /** Most casts stopped first. */
  actors: InterruptActor[];
  /** What was stopped, most often first. */
  stopped: StoppedCast[];
  casts: number;
  stops: number;
  whiffs: number;
}

const OUTCOMES: readonly InterruptOutcome[] = [
  'interrupted',
  'doubled',
  'ignored',
  'late',
  'early',
  'missed',
  'nothing',
];

/**
 * The lists rolled up per player and per enemy cast.
 *
 * Kept out of `interruptReport` and exported, because the view does this
 * twice: once for the key and again for one pull, which is the same question
 * asked of a filtered list rather than a second report to compute and ship.
 */
export function summarizeInterrupts(
  attempts: readonly InterruptAttempt[],
  stops: readonly InterruptStop[],
): InterruptSummary {
  const actors = new Map<number, InterruptActor & { bySpell: Map<number, InterruptAbility> }>();
  let casts = 0;
  let landed = 0;

  for (const attempt of attempts) {
    let actor = actors.get(attempt.actorIndex);
    if (actor === undefined) {
      const outcomes = {} as Record<InterruptOutcome, number>;
      for (const outcome of OUTCOMES) outcomes[outcome] = 0;
      actor = {
        actorIndex: attempt.actorIndex,
        name: attempt.name,
        specId: attempt.specId,
        casts: 0,
        stops: 0,
        whiffs: 0,
        outcomes,
        abilities: [],
        bySpell: new Map(),
      };
      actors.set(attempt.actorIndex, actor);
    }
    actor.casts++;
    actor.stops += attempt.stops;
    if (attempt.stops === 0) actor.whiffs++;
    actor.outcomes[attempt.outcome]++;
    casts++;
    if (attempt.stops > 0) landed++;

    let ability = actor.bySpell.get(attempt.spellId);
    if (ability === undefined) {
      ability = { spellId: attempt.spellId, name: attempt.spellName, casts: 0, stops: 0 };
      actor.bySpell.set(attempt.spellId, ability);
    }
    ability.casts++;
    ability.stops += attempt.stops;
  }

  const stopped = new Map<number, StoppedCast & { sources: Map<string, number> }>();
  for (const stop of stops) {
    if (stop.castSpellId === 0) continue;
    let cast = stopped.get(stop.castSpellId);
    if (cast === undefined) {
      cast = {
        spellId: stop.castSpellId,
        name: stop.castSpellName,
        count: 0,
        sourceName: '',
        sources: new Map(),
      };
      stopped.set(stop.castSpellId, cast);
    }
    cast.count++;
    cast.sources.set(stop.targetName, (cast.sources.get(stop.targetName) ?? 0) + 1);
  }

  return {
    actors: [...actors.values()]
      .map(({ bySpell, ...actor }) => ({
        ...actor,
        abilities: [...bySpell.values()].sort((a, b) => b.casts - a.casts || a.spellId - b.spellId),
      }))
      .sort((a, b) => b.stops - a.stops || b.casts - a.casts),
    stopped: [...stopped.values()]
      .map(({ sources, ...cast }) => ({ ...cast, sourceName: dominant(sources) }))
      .sort((a, b) => b.count - a.count || a.spellId - b.spellId),
    casts,
    stops: stops.length,
    whiffs: casts - landed,
  };
}

function dominant(sources: ReadonlyMap<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [name, count] of sources) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

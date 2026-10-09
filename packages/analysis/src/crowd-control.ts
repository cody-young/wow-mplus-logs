import { Control, controlKinds } from '@mplus/data';
import { Ev, EvFlag } from '@mplus/parser';

import { actorName, spellName, type AnalysisContext } from './context.js';
import type { SegmentIndex } from './segments.js';

/**
 * Crowd control: what was pressed, what it caught, and for how long.
 *
 * This is read from the opposite end of the log to interrupts. An interrupt is
 * an instant the game states outright, so the press is the hard part there and
 * the result is free. Control is the reverse: the press tells you almost
 * nothing — Polymorph is cast as 118 and the sheep lands as 28271, Fists of
 * Fury as 117418 and its stun as 120086 — while the *aura* is reported in full,
 * with a beginning, an end, and the unit it was on. So the aura is the unit of
 * measurement here, and `@mplus/data/crowd-control` exists to say which auras
 * mean a unit is not fighting.
 *
 * Three numbers come out of that, which are the three anybody asks for:
 *
 *   casts    how many times the button was pressed
 *   targets  how many enemies those presses caught
 *   seconds  how long they were held, added up
 *
 * Only the first needs any inference, and the inference is small. One cast of
 * an area control lands as one aura per enemy, all in the same millisecond, so
 * the applications of one spell by one player inside a short window are one
 * press. See CAST_MS.
 *
 * What this cannot see is a press that caught nothing at all. An aura is the
 * only evidence there is, and a Ring of Frost nobody walked into writes no
 * aura, so it is not a cast here and the hit rate an interrupts panel can
 * report has no equivalent. Stated rather than worked around: the alternative
 * is pairing presses to auras across two different spell ids, which is a table
 * of its own and buys one number.
 *
 * Knockbacks are the exception to all of that, because they write no aura:
 * Supernova is a cast and a SPELL_DAMAGE on everything it threw, and nothing
 * else. For those the hit is the application — one per enemy per press, with
 * no seconds, since a knockback is over the moment it lands. They count as
 * casts and targets and never move the bar.
 *
 * The seconds are worth more than they look, because the log says how each one
 * ended. A poly that ran its course and a poly somebody shot two seconds in
 * are the same cast and the same target, and only `ControlEnd` tells them
 * apart — which is usually the whole reason a control chart reads low.
 */

/** How a control aura came off the unit. */
export type ControlEnd =
  /** It ran its course, or was replaced by something that overrode it. */
  | 'expired'
  /**
   * Damage broke it early.
   *
   * The log is explicit about this — SPELL_AURA_BROKEN names the aura and
   * SPELL_AURA_BROKEN_SPELL names what broke it — and it is the one ending
   * worth acting on, because a sheep broken by a stray dot is a press wasted
   * by the party rather than by the player who made it.
   */
  | 'broken'
  /** The unit died while still held. The control did its job. */
  | 'died'
  /** A new application replaced it: the same control pressed again. */
  | 'refreshed'
  /**
   * A knockback, which writes no aura and so has no end: the unit was thrown,
   * and the hit that threw it is the whole trace. Always zero seconds.
   */
  | 'knocked'
  /**
   * The log never took it off.
   *
   * A unit that despawns stops being reported, and the key can also simply end
   * with something still held. Capped rather than trusted — see OPEN_CAP_MS.
   */
  | 'open';

/** One control aura, on one enemy, from one press. */
export interface ControlApplication {
  /** Store-relative ms of the application. */
  ts: number;
  /** The player it counts for: a pet's control is its owner's. */
  actorIndex: number;
  name: string;
  specId: number;
  /** The pet that applied it, when one did. Empty when the player did. */
  petName: string;
  /** The aura as the log names it, which is usually not the button. */
  spellId: number;
  spellName: string;
  /** A mask of `Control` values: what it does to the unit. */
  kinds: number;
  targetIndex: number;
  targetName: string;
  /** How long it was on the unit. */
  durationMs: number;
  end: ControlEnd;
  /**
   * The press this application belongs to.
   *
   * Applications sharing one came from a single cast, which is how an area
   * control counts as one press and several targets. Ids are per report and
   * mean nothing outside it.
   */
  castId: number;
  /** The pull or boss the target belongs to, or -1 when it belongs to none. */
  segmentId: number;
}

export interface ControlReport {
  /** Every aura the party put on an enemy, in order. */
  applications: ControlApplication[];
  /** How many presses those came from. */
  casts: number;
}

export interface ControlOptions {
  /** How close two applications of one spell must be to be one press. */
  castMs?: number;
}

/**
 * How close two applications of one spell by one player are to be one press.
 *
 * Measured rather than guessed, and the gaps turn out to be bimodal. Across
 * two real keys, of the 443 gaps between consecutive applications of one
 * player's one control, 379 were under a tenth of a second — an area control
 * catching everything at once — and 55 were over ten seconds, which is a
 * cooldown having come back. Six fell anywhere in between. There is no value
 * in that gulf that a second does not already separate cleanly, so the window
 * is a second and the measurement is the reason.
 *
 * It is rolling: each application extends its press, rather than every one
 * being measured from the first. That is what a sweeping control needs —
 * Deep Breath stuns a pull as the dragon crosses it, not all at once — and it
 * costs nothing elsewhere, because no control in the game can be pressed
 * twice inside a second.
 *
 * Where it still loses is a zone that keeps catching units long after the
 * cast: a Ring of Frost nobody walks into for four seconds is a second press
 * here. The targets and the seconds stay right either way; the cast count is
 * the one number that reads high, and only for that shape of spell.
 */
const DEFAULT_CAST_MS = 1000;

/**
 * An aura the log never removed is credited with the longest the same aura was
 * seen to last elsewhere in the run — and with nothing, if it was never seen
 * to end at all.
 *
 * A unit that despawns stops being reported mid-aura, so the aura has no end
 * in the log and its real duration is simply unknown. Anything assumed there
 * is invented, and a flat cap invents a great deal: four Blinding Sleets left
 * open by despawning snakes, credited a minute each, added 240s to a key whose
 * every *completed* Blinding Sleet lasted a second or less — a fifth of that
 * key's control, out of nothing.
 *
 * The longest completed one is the bound the log itself supports. It cannot
 * invent a minute on a four-second spell, it needs no table of durations, and
 * on a control that was never once seen to end it credits zero rather than
 * guessing. Rare either way: 4 of 503 applications on a real key.
 */

interface Window {
  application: ControlApplication;
  startTs: number;
}

export function crowdControlReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: ControlOptions = {},
): ControlReport {
  const { run } = context;
  const { store, actors } = run;
  const castMs = options.castMs ?? DEFAULT_CAST_MS;
  const ours = (index: number): boolean => index >= 0 && segments.party.has(actors.attribute(index));

  const applications: ControlApplication[] = [];
  /** Auras currently up, keyed by the unit and the aura on it. */
  const open = new Map<string, Window>();
  /** The last press of each spell by each player, to group an area hit. */
  const presses = new Map<string, { castId: number; ts: number }>();
  /** Every unit an aura is open on, so a death can close all of them at once. */
  const onUnit = new Map<number, Set<string>>();
  let nextCastId = 0;
  let lastTs = 0;

  /** Longest an aura was seen to run, to bound the ones that never ended. */
  const longest = new Map<number, number>();

  const close = (key: string, ts: number, end: ControlEnd): void => {
    const window = open.get(key);
    if (window === undefined) return;
    const durationMs = ts - window.startTs;
    window.application.durationMs = durationMs;
    window.application.end = end;
    open.delete(key);
    onUnit.get(window.application.targetIndex)?.delete(key);
    // 'open' is the bound being applied, not evidence for it.
    if (end !== 'open') {
      const spellId = window.application.spellId;
      if (durationMs > (longest.get(spellId) ?? 0)) longest.set(spellId, durationMs);
    }
  };

  /** One application, grouped into its press. */
  const record = (
    row: number,
    src: number,
    dst: number,
    spellId: number,
    kinds: number,
    ts: number,
    end: ControlEnd,
  ): ControlApplication => {
    const actor = actors.attribute(src);
    const pressKey = `${actor}:${spellId}`;
    const previous = presses.get(pressKey);
    let castId: number;
    if (previous !== undefined && ts - previous.ts <= castMs) {
      castId = previous.castId;
    } else {
      castId = nextCastId++;
    }
    presses.set(pressKey, { castId, ts });

    const application: ControlApplication = {
      ts,
      actorIndex: actor,
      name: actorName(context, actor),
      specId: actors.at(actor)?.specId ?? -1,
      petName: actor === src ? '' : actorName(context, src),
      spellId,
      spellName: spellName(context, spellId),
      kinds,
      targetIndex: dst,
      targetName: actorName(context, dst),
      durationMs: 0,
      end,
      castId,
      segmentId: segments.segmentOf(row),
    };
    applications.push(application);
    return application;
  };

  /**
   * Enemies already credited to a knockback press, as `castId:unit`. One throw
   * can write several rows on one unit — Thunderstorm's damage and its slow —
   * and each enemy is one target however many rows its throw took.
   */
  const thrown = new Set<string>();

  const knock = (row: number, src: number, dst: number, spellId: number, ts: number): void => {
    const pressKey = `${actors.attribute(src)}:${spellId}`;
    const previous = presses.get(pressKey);
    if (previous !== undefined && ts - previous.ts <= castMs) {
      const seen = `${previous.castId}:${dst}`;
      if (thrown.has(seen)) {
        previous.ts = ts;
        return;
      }
    }
    const application = record(row, src, dst, spellId, Control.KNOCKBACK, ts, 'knocked');
    thrown.add(`${application.castId}:${dst}`);
  };

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    const ts = store.ts[row]!;
    lastTs = ts;

    switch (code) {
      case Ev.SPELL_AURA_APPLIED:
      case Ev.SPELL_AURA_REFRESH: {
        const src = store.srcActor[row]!;
        const dst = store.dstActor[row]!;
        const spellId = store.spellId[row]!;
        // The pairing the table's own note asks for, and all three halves of
        // it matter. A buff is not control — the BUFF flag is on the row, so
        // this costs nothing. A control the party put on the party is a
        // Leap of Faith landing someone in a stun, not a press worth
        // crediting. And a mob's stun on another mob is in the table too.
        if ((store.flags[row]! & EvFlag.BUFF) !== 0) break;
        if (!ours(src) || dst < 0 || ours(dst)) break;
        const kinds = controlKinds(spellId);
        if (kinds === 0) break;
        // A knockback's own slow — Thunderstorm, Typhoon — is the hit's
        // business below, not an aura with seconds to measure.
        if (kinds === Control.KNOCKBACK) {
          knock(row, src, dst, spellId, ts);
          break;
        }

        const key = `${dst}:${spellId}`;
        // A refresh is the same control pressed again, so the aura that was up
        // is closed and counted before the new one opens. Left open instead,
        // the second application would be dropped and the press with it.
        close(key, ts, 'refreshed');

        const application = record(row, src, dst, spellId, kinds, ts, 'open');
        open.set(key, { application, startTs: ts });
        let keys = onUnit.get(dst);
        if (keys === undefined) {
          keys = new Set();
          onUnit.set(dst, keys);
        }
        keys.add(key);
        break;
      }

      // A knockback's only trace. A miss is left out: an immune boss was not
      // thrown, and a parry or dodge threw nothing either.
      case Ev.SPELL_DAMAGE: {
        const src = store.srcActor[row]!;
        const dst = store.dstActor[row]!;
        const spellId = store.spellId[row]!;
        if (!ours(src) || dst < 0 || ours(dst)) break;
        if (controlKinds(spellId) !== Control.KNOCKBACK) break;
        knock(row, src, dst, spellId, ts);
        break;
      }

      case Ev.SPELL_AURA_REMOVED:
        close(`${store.dstActor[row]!}:${store.spellId[row]!}`, ts, 'expired');
        break;

      case Ev.SPELL_AURA_BROKEN:
      case Ev.SPELL_AURA_BROKEN_SPELL:
        close(`${store.dstActor[row]!}:${store.spellId[row]!}`, ts, 'broken');
        break;

      case Ev.UNIT_DIED:
      case Ev.UNIT_DESTROYED:
      case Ev.UNIT_DISSIPATES: {
        const dst = store.dstActor[row]!;
        // Everything still on it, not just one aura: a mob dying under a stun
        // and a root ends both, and an aura left open here would be capped at
        // a minute it never had.
        for (const key of [...(onUnit.get(dst) ?? [])]) close(key, ts, 'died');
        break;
      }

      default:
        break;
    }
  }

  // Whatever is still up when the log runs out: the unit despawned, or the key
  // ended holding something. Credited with what the same aura was observed to
  // last, which is why this waits until every other window has closed.
  for (const [key, window] of [...open]) {
    const seen = longest.get(window.application.spellId) ?? 0;
    close(key, Math.min(lastTs, window.startTs + seen), 'open');
  }

  return { applications, casts: nextCastId };
}

/** One control button, as one player used it. */
export interface ControlAbility {
  spellId: number;
  name: string;
  /** A mask of `Control` values. */
  kinds: number;
  casts: number;
  targets: number;
  ms: number;
  broken: number;
}

export interface ControlActor {
  actorIndex: number;
  name: string;
  specId: number;
  /** Presses. */
  casts: number;
  /** Enemies those presses caught, which an area control pushes above `casts`. */
  targets: number;
  /** How long they were held, added up. */
  ms: number;
  /** Of those, the ones damage ended early. */
  broken: number;
  abilities: ControlAbility[];
}

/** One control, as the party as a whole used it. */
export interface ControlSpell {
  spellId: number;
  name: string;
  kinds: number;
  casts: number;
  targets: number;
  ms: number;
  broken: number;
  /** The enemy it was put on most often. */
  targetName: string;
}

export interface ControlSummary {
  /** Most seconds held first. */
  actors: ControlActor[];
  /** What was pressed, most seconds first. */
  spells: ControlSpell[];
  casts: number;
  targets: number;
  ms: number;
  broken: number;
  /** A mask of every `Control` kind that appears, for the view's legend. */
  kinds: number;
}

/**
 * The applications rolled up per player and per control.
 *
 * Kept out of `crowdControlReport` and exported for the same reason as
 * `summarizeInterrupts`: the view asks this twice, once for the key and again
 * for one pull, and a pull is a filter on the same list rather than a second
 * report to compute and ship.
 */
export function summarizeCrowdControl(applications: readonly ControlApplication[]): ControlSummary {
  const actors = new Map<number, ActorTally>();
  const spells = new Map<number, SpellTally>();
  const casts = new Set<number>();
  let targets = 0;
  let ms = 0;
  let broken = 0;
  let kinds = 0;

  for (const application of applications) {
    const { spellId, castId, durationMs } = application;
    const wasBroken = application.end === 'broken';

    let actor = actors.get(application.actorIndex);
    if (actor === undefined) {
      actor = {
        actorIndex: application.actorIndex,
        name: application.name,
        specId: application.specId,
        targets: 0,
        ms: 0,
        broken: 0,
        casts: new Set(),
        bySpell: new Map(),
      };
      actors.set(application.actorIndex, actor);
    }
    actor.targets++;
    actor.ms += durationMs;
    if (wasBroken) actor.broken++;
    // Presses are counted through the cast id rather than by adding up
    // applications, because one press of an area control is one press however
    // many enemies it caught.
    actor.casts.add(castId);

    let ability = actor.bySpell.get(spellId);
    if (ability === undefined) {
      ability = {
        spellId,
        name: application.spellName,
        kinds: application.kinds,
        targets: 0,
        ms: 0,
        broken: 0,
        casts: new Set(),
      };
      actor.bySpell.set(spellId, ability);
    }
    ability.targets++;
    ability.ms += durationMs;
    if (wasBroken) ability.broken++;
    ability.casts.add(castId);

    let spell = spells.get(spellId);
    if (spell === undefined) {
      spell = {
        spellId,
        name: application.spellName,
        kinds: application.kinds,
        targets: 0,
        ms: 0,
        broken: 0,
        casts: new Set(),
        onTarget: new Map(),
      };
      spells.set(spellId, spell);
    }
    spell.targets++;
    spell.ms += durationMs;
    if (wasBroken) spell.broken++;
    spell.casts.add(castId);
    spell.onTarget.set(application.targetName, (spell.onTarget.get(application.targetName) ?? 0) + 1);

    casts.add(castId);
    targets++;
    ms += durationMs;
    if (wasBroken) broken++;
    kinds |= application.kinds;
  }

  return {
    actors: [...actors.values()]
      .map((actor) => ({
        actorIndex: actor.actorIndex,
        name: actor.name,
        specId: actor.specId,
        casts: actor.casts.size,
        targets: actor.targets,
        ms: actor.ms,
        broken: actor.broken,
        abilities: [...actor.bySpell.values()]
          .map((ability) => ({
            spellId: ability.spellId,
            name: ability.name,
            kinds: ability.kinds,
            casts: ability.casts.size,
            targets: ability.targets,
            ms: ability.ms,
            broken: ability.broken,
          }))
          .sort((a, b) => b.ms - a.ms || b.targets - a.targets || a.spellId - b.spellId),
      }))
      .sort((a, b) => b.ms - a.ms || b.targets - a.targets),
    spells: [...spells.values()]
      .map((spell) => ({
        spellId: spell.spellId,
        name: spell.name,
        kinds: spell.kinds,
        casts: spell.casts.size,
        targets: spell.targets,
        ms: spell.ms,
        broken: spell.broken,
        targetName: dominant(spell.onTarget),
      }))
      .sort((a, b) => b.ms - a.ms || b.targets - a.targets || a.spellId - b.spellId),
    casts: casts.size,
    targets,
    ms,
    broken,
    kinds,
  };
}

/**
 * The accumulators, which differ from what is returned in one way: a press is
 * a set of cast ids while it is being counted and a number once it is
 * reported. An area control appears once per enemy it caught, so adding
 * applications up would report one Leg Sweep as five presses.
 */
interface Tally {
  spellId: number;
  name: string;
  kinds: number;
  targets: number;
  ms: number;
  broken: number;
  casts: Set<number>;
}

interface SpellTally extends Tally {
  /** Enemy name -> applications, to name the one it was used on most. */
  onTarget: Map<string, number>;
}

interface ActorTally {
  actorIndex: number;
  name: string;
  specId: number;
  targets: number;
  ms: number;
  broken: number;
  casts: Set<number>;
  bySpell: Map<number, Tally>;
}

function dominant(counts: ReadonlyMap<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/** The `Control` kinds in a mask, in a stable order, for a label. */
export function controlKindNames(kinds: number): string[] {
  const names: string[] = [];
  if ((kinds & Control.STUN) !== 0) names.push('stun');
  if ((kinds & Control.DISORIENT) !== 0) names.push('disorient');
  if ((kinds & Control.FEAR) !== 0) names.push('fear');
  if ((kinds & Control.SILENCE) !== 0) names.push('silence');
  if ((kinds & Control.ROOT) !== 0) names.push('root');
  if ((kinds & Control.KNOCKBACK) !== 0) names.push('knockback');
  return names;
}

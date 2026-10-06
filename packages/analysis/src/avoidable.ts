import { avoidable, avoidableDungeons, isBlizzardAvoidable } from '@mplus/data';

import { actorName, spellName, type AnalysisContext } from './context.js';
import { DAMAGE_CODES, effective } from './events.js';
import { segmentAt, type SegmentIndex } from './segments.js';

/**
 * Avoidable damage: what each player took from things they could have dodged.
 *
 * Elitism Helper did this in game, and Midnight took the in-game combat log
 * away from addons, so the log file is where it lives now. The judgement of
 * what counts is `@mplus/data/avoidable` — a hand-kept list. Blizzard's own
 * flag for the same thing is read alongside it into `blizzard`, for comparing
 * the two while that flag is still a guess. Everything here is
 * mechanical: a damage line, from an enemy, onto a party member, carrying an
 * id on that list.
 *
 * Amounts are the same net figure the Damage Taken tab uses — overkill off,
 * absorbs not counted — so the two tabs agree on what a hit was worth. A hit a
 * shield ate entirely still happened, but it writes no damage line, and the
 * shield's owner earned that one.
 */

/** One avoidable hit on a party member. */
export interface AvoidableHit {
  /** Store-relative ms. */
  ts: number;
  /** The player who took it. */
  actorIndex: number;
  name: string;
  specId: number;
  spellId: number;
  spellName: string;
  /** Whatever dealt it: the boss, the puddle's owner, an add. */
  sourceName: string;
  amount: number;
  /** The killing blow. */
  fatal: boolean;
  /** The pull or boss it happened in, or -1 when none was open. */
  segmentId: number;
}

export interface AvoidableReport {
  /** Every avoidable hit, in order. */
  hits: AvoidableHit[];
  /**
   * Whether this key's dungeon is one the list covers.
   *
   * Without it, a key from a dungeon nobody has curated reads as a perfectly
   * clean run, which is the one thing the tab must never claim falsely.
   */
  covered: boolean;
  /**
   * The same party's hits on spells Blizzard's own data flags as avoidable —
   * `isBlizzardAvoidable`, a bit in SpellMisc. In development: shown beside
   * `hits` so the two can be compared, not instead of it.
   *
   * No dungeon gate, because the flag is on every dungeon's spells, and no
   * tank rule, because the in-game meter is not known to have one.
   */
  blizzard: AvoidableHit[];
}

/**
 * The tank specs: Blood, Vengeance, Guardian, Brewmaster, Protection twice.
 *
 * Only for the list's `tank` entries — a frontal aimed at the tank, which the
 * tank takes by design. The spec is the one COMBATANT_INFO announced, which is
 * what the player was in when the key started.
 */
const TANK_SPECS: ReadonlySet<number> = new Set([250, 581, 104, 268, 66, 73]);

export function avoidableReport(context: AnalysisContext, segments: SegmentIndex): AvoidableReport {
  const { run } = context;
  const { store, actors } = run;
  const hits: AvoidableHit[] = [];
  const blizzard: AvoidableHit[] = [];

  for (let row = 0; row < store.count; row++) {
    if (!DAMAGE_CODES.has(store.code[row]!)) continue;
    const spellId = store.spellId[row]!;
    // Melee is spell 0 and never on either list; skip the lookups for the
    // most common line in the log.
    if (spellId === 0) continue;
    const entry = avoidable(spellId);
    const flagged = isBlizzardAvoidable(spellId);
    if (entry === undefined && !flagged) continue;

    // The player themself, not their pet: a pet standing in fire is the
    // pet's business, and it has no row in the party to file it under.
    const dst = store.dstActor[row]!;
    if (dst < 0 || !segments.party.has(dst)) continue;
    const src = store.srcActor[row]!;
    if (src >= 0 && segments.party.has(actors.attribute(src))) continue;

    const victim = actors.at(dst);
    const specId = victim?.specId ?? -1;
    const listed = entry !== undefined && !(entry.tank === true && TANK_SPECS.has(specId));
    if (!listed && !flagged) continue;

    const ts = store.ts[row]!;
    const segmentId = segments.segmentOf(row);
    const hit: AvoidableHit = {
      ts,
      actorIndex: dst,
      name: actorName(context, dst),
      specId,
      spellId,
      spellName: spellName(context, spellId),
      sourceName: src >= 0 ? actorName(context, src) : '',
      amount: effective(store.amount[row]!, store.waste[row]!),
      fatal: store.waste[row]! > 0,
      segmentId: segmentId >= 0 ? segmentId : segmentAt(segments, ts),
    };
    if (listed) hits.push(hit);
    if (flagged) blizzard.push(hit);
  }

  return { hits, covered: avoidableDungeons().has(run.meta.challengeModeId), blizzard };
}

/**
 * Blizzard's flag with the hand-kept list as a supplement: every flagged hit,
 * plus the list's hits on spells the flag misses. In development, like
 * `blizzard`.
 *
 * A flagged spell's hits are taken from `blizzard` alone, so a tank frontal
 * the flag carries counts against the tank here even though the list exempts
 * it.
 */
export function combinedAvoidable(report: AvoidableReport): AvoidableHit[] {
  return [...report.blizzard, ...report.hits.filter((hit) => !isBlizzardAvoidable(hit.spellId))].sort(
    (a, b) => a.ts - b.ts,
  );
}

/** One avoidable ability, as one player took it. */
export interface AvoidableAbility {
  spellId: number;
  name: string;
  hits: number;
  amount: number;
  /** How many times it was the killing blow. */
  deaths: number;
}

export interface AvoidableActor {
  actorIndex: number;
  name: string;
  specId: number;
  hits: number;
  amount: number;
  deaths: number;
  /** Most damage first. */
  abilities: AvoidableAbility[];
}

export interface AvoidableSummary {
  /** Most avoidable damage first. */
  actors: AvoidableActor[];
  /** The party's worst offenders across everyone, most damage first. */
  abilities: Array<AvoidableAbility & { players: number }>;
  hits: number;
  amount: number;
  deaths: number;
}

/**
 * The hits rolled up per player and per ability.
 *
 * Kept out of the report like `summarizeDispels`, because the view rolls up a
 * different slice for every segment it is shown.
 *
 * Keyed by name rather than id, as the dispel summary is: one mechanic is
 * often two ids — Raging Squall's impact and its tornado, Lingering Storm off
 * two different casts — and a reader asks "what did I stand in", not "which
 * id". The first id seen stands in for the name's icon.
 */
export function summarizeAvoidable(hits: readonly AvoidableHit[]): AvoidableSummary {
  const actors = new Map<number, AvoidableActor & { byName: Map<string, AvoidableAbility> }>();
  const overall = new Map<string, AvoidableAbility & { victims: Set<number> }>();
  let amount = 0;
  let deaths = 0;

  for (const hit of hits) {
    let actor = actors.get(hit.actorIndex);
    if (actor === undefined) {
      actor = {
        actorIndex: hit.actorIndex,
        name: hit.name,
        specId: hit.specId,
        hits: 0,
        amount: 0,
        deaths: 0,
        abilities: [],
        byName: new Map(),
      };
      actors.set(hit.actorIndex, actor);
    }
    const death = hit.fatal ? 1 : 0;
    actor.hits++;
    actor.amount += hit.amount;
    actor.deaths += death;

    let ability = actor.byName.get(hit.spellName);
    if (ability === undefined) {
      ability = { spellId: hit.spellId, name: hit.spellName, hits: 0, amount: 0, deaths: 0 };
      actor.byName.set(hit.spellName, ability);
    }
    ability.hits++;
    ability.amount += hit.amount;
    ability.deaths += death;

    let all = overall.get(hit.spellName);
    if (all === undefined) {
      all = { spellId: hit.spellId, name: hit.spellName, hits: 0, amount: 0, deaths: 0, victims: new Set() };
      overall.set(hit.spellName, all);
    }
    all.hits++;
    all.amount += hit.amount;
    all.deaths += death;
    all.victims.add(hit.actorIndex);

    amount += hit.amount;
    deaths += death;
  }

  const byAmount = (a: { amount: number; hits: number }, b: { amount: number; hits: number }): number =>
    b.amount - a.amount || b.hits - a.hits;

  return {
    actors: [...actors.values()]
      .map(({ byName, ...actor }) => ({ ...actor, abilities: [...byName.values()].sort(byAmount) }))
      .sort(byAmount),
    abilities: [...overall.values()]
      .map(({ victims, ...ability }) => ({ ...ability, players: victims.size }))
      .sort(byAmount),
    hits: hits.length,
    amount,
    deaths,
  };
}

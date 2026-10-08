import {
  summarizeAvoidable,
  summarizeCrowdControl,
  summarizeDispels,
  summarizeInterrupts,
} from '@mplus/analysis';

import { integer, short, wipeCutoff } from './format.js';
import { partyOf, type PartyMember } from './components/RunRow.js';
import { specOf } from './specs.js';
import type { RunAnalysis } from '../shared.js';

/**
 * The post-game awards: badges for the best and the worst of a run, and an MVP.
 *
 * Mario Party's end of game is the model. A handful of bonus stars, some of
 * them for things nobody would brag about, handed out one at a time before
 * the winner. The badges here work the same way, and the joke ones are as
 * much the point as the serious ones.
 *
 * Every badge is for the whole run, whatever pull is selected, because a
 * badge in the header has to mean the same thing on every tab. None is given
 * while a key is still live: a lead at the second boss is not an award.
 *
 * Two rules keep a badge worth having. Nobody earns one for zero — a key with
 * no totems has no Totem Stomper. And nobody earns one most of the party
 * shares: on a key where one player died, four Unkillables say nothing about
 * any of them.
 *
 * A key earns more badges than a ceremony wants to read out, so only a few are
 * handed out: a roast or two, then the glory, spread so as many players as can
 * get one do. Which of the earned ones make it is chance, but the run's own
 * chance, and the same for the whole party: everyone who logged the key sees
 * the same badges, on any machine, every time it is opened.
 */

export interface Badge {
  key: string;
  title: string;
  icon: string;
  /** A joke at the winner's expense, which the ceremony reads out first. */
  roast: boolean;
  /** One line on what it is for. */
  blurb: string;
  /** Actor indices. More than one is a tie, and each holds the badge. */
  winners: number[];
  /** Winner -> what earned it, as "14 kicks". */
  reasons: Record<number, string>;
  /** Everyone who was in the running, best first, with their figure: the hover tip's standings. */
  field: Array<{ actorIndex: number; text: string }>;
  /** The winner left everyone far behind, and the badge wears its sillier name. */
  gapped: boolean;
}

/** A badge's other name, for a lone winner with `times` the runner-up's figure (and at least `min`). */
interface Gap {
  title: string;
  blurb: string;
  times: number;
  min?: number;
}

/** One MVP category, as it scored one player. */
export interface MvpLine {
  category: string;
  points: number;
}

export interface MvpStanding {
  member: PartyMember;
  points: number;
  lines: MvpLine[];
}

export interface Awards {
  /** In the order the ceremony reveals them: the roasts, then the glory. */
  badges: Badge[];
  /** Every party member, most points first. */
  standings: MvpStanding[];
  /** Actor indices with the most points; more than one is a shared MVP. */
  mvp: number[];
}

type Values = ReadonlyMap<number, number>;

/** Everyone holding the best value, or nobody if more than half the party does. */
function leaders(party: readonly PartyMember[], values: Values, best: 'most' | 'fewest'): number[] {
  if (party.length < 2) return [];
  const of = (member: PartyMember): number => values.get(member.actorIndex) ?? 0;
  const scores = party.map(of);
  const top = best === 'most' ? Math.max(...scores) : Math.min(...scores);
  if (best === 'most' && top <= 0) return [];
  const winners = party.filter((member) => of(member) === top).map((member) => member.actorIndex);
  return winners.length * 2 > party.length ? [] : winners;
}

/**
 * Rank points for one category: one for every player you beat, plus one.
 *
 * Ties share the higher rank, so two equal kickers both beat the same people.
 * For a "most" category nothing scores for zero, or a key with no dispels
 * would hand everyone points for one. For a "fewest" category zero is the best
 * there is, and scores.
 */
function rankPoints(party: readonly PartyMember[], values: Values, best: 'most' | 'fewest'): Map<number, number> {
  const of = (index: number): number => values.get(index) ?? 0;
  const points = new Map<number, number>();
  for (const member of party) {
    const mine = of(member.actorIndex);
    if (best === 'most' && mine <= 0) continue;
    const beaten = party.filter((other) =>
      best === 'most' ? of(other.actorIndex) < mine : of(other.actorIndex) > mine,
    ).length;
    points.set(member.actorIndex, beaten + 1);
  }
  return points;
}

function count<T>(list: readonly T[], key: (item: T) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const item of list) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

/** At most this many badges a key, of which at most `MAX_ROASTS` are roasts. */
const MAX_BADGES = 6;
const MAX_ROASTS = 2;

/** FNV-1a, for a seed that is the same in every JavaScript engine. */
function hash(text: string): number {
  let out = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) out = Math.imul(out ^ text.charCodeAt(i), 0x01000193);
  return out >>> 0;
}

/**
 * What the draw is seeded with: only what the server tells every client
 * alike, so every player's log of the run seeds the same.
 *
 * Not the run id, whose timestamp is each machine's own clock, and not any
 * total: each client logs only what happens in its range, so two logs of one
 * key disagree on damage by a fraction. The keystone timer and a raid fight's
 * length come from the server to the millisecond, which also tells apart two
 * runs of one dungeon by one group. The party is its full names, sorted,
 * since each log numbers its actors its own way.
 */
function seedOf(run: RunAnalysis, party: readonly PartyMember[]): string {
  const names = party.map((member) => member.name).sort().join(',');
  const meta = run.meta;
  return meta.kind === 'key'
    ? `key/${meta.challengeModeId}/${meta.keystoneLevel}/${meta.totalTimeMs ?? 0}/${names}`
    : `raid/${meta.encounterId}/${meta.difficultyId}/${meta.fightTimeMs ?? 0}/${names}`;
}

/**
 * The few badges a run hands out, from all it earned, in reveal order.
 *
 * Each badge's place in the shuffle is its own hash with the seed, rather
 * than a draw from one sequence, so a log that earned one badge more or fewer
 * than a party member's still orders the rest the same. Then taken in turn: one roast first if there is
 * one, then whichever comes next that gives a badge to someone still without
 * one, and only once nobody is left out, whichever comes next at all.
 */
function pick(earned: readonly Badge[], seed: string): Badge[] {
  const deck = earned
    .map((badge) => ({ badge, order: hash(`${seed}/${badge.key}`) }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.badge);
  const chosen: Badge[] = [];
  const holders = new Set<number>();
  const take = (badge: Badge): void => {
    chosen.push(badge);
    deck.splice(deck.indexOf(badge), 1);
    for (const index of badge.winners) holders.add(index);
  };
  const firstRoast = deck.find((badge) => badge.roast);
  if (firstRoast !== undefined) take(firstRoast);
  while (chosen.length < MAX_BADGES) {
    const open = deck.filter((badge) => !badge.roast || chosen.filter((other) => other.roast).length < MAX_ROASTS);
    const choice = open.find((badge) => badge.winners.some((index) => !holders.has(index))) ?? open[0];
    if (choice === undefined) break;
    take(choice);
  }
  return earned.filter((badge) => chosen.includes(badge));
}

const plural = (n: number, one: string, many = `${one}s`): string => `${integer(n)} ${n === 1 ? one : many}`;

export function awardsFor(run: RunAnalysis): Awards | null {
  if (run.live) return null;
  const party = partyOf(run);
  if (party.length === 0) return null;

  const damage = new Map(run.damage.actors.map((actor) => [actor.actorIndex, actor.total]));
  const dps = new Map(run.damage.actors.map((actor) => [actor.actorIndex, actor.perSecond]));
  const healing = new Map(run.healing.actors.map((actor) => [actor.actorIndex, actor.total]));
  const hps = new Map(run.healing.actors.map((actor) => [actor.actorIndex, actor.perSecond]));
  const kicks = new Map(
    summarizeInterrupts(run.interrupts.attempts, run.interrupts.stops).actors.map((actor) => [actor.actorIndex, actor.stops]),
  );
  const cc = new Map(summarizeCrowdControl(run.control.applications).actors.map((actor) => [actor.actorIndex, actor.casts]));
  const dispels = new Map(summarizeDispels(run.dispels.dispels).actors.map((actor) => [actor.actorIndex, actor.removed]));
  const avoidable = new Map(summarizeAvoidable(run.avoidable.hits).actors.map((actor) => [actor.actorIndex, actor.amount]));
  // A raid wipe's last deaths are the wipe, not anyone's mistake.
  const cutoff = wipeCutoff(run.meta, run.deaths);
  const deaths = count(cutoff === null ? run.deaths : run.deaths.slice(0, cutoff), (death) => death.actorIndex);
  const totems = count(run.stats.totemKills, (kill) => kill.actorIndex);
  const falls = count(run.stats.falls, (entry) => entry.actorIndex);
  const fallDamage = new Map<number, number>();
  for (const entry of run.stats.falls) fallDamage.set(entry.actorIndex, (fallDamage.get(entry.actorIndex) ?? 0) + entry.amount);
  const bigHit = new Map(run.stats.biggestHits.map((entry) => [entry.actorIndex, entry]));
  const bigHitAmount = new Map(run.stats.biggestHits.map((entry) => [entry.actorIndex, entry.amount]));
  const picks = count(run.stats.picks, (pick) => pick.actorIndex);
  /** Player -> the mechanic that picked them most. */
  const pickedBy = new Map<number, string>();
  for (const member of party) {
    const mine = count(
      run.stats.picks.filter((pick) => pick.actorIndex === member.actorIndex),
      (pick) => pick.spellId,
    );
    const [spellId] = [...mine].sort((a, b) => b[1] - a[1])[0] ?? [];
    const name = run.stats.picks.find((pick) => pick.spellId === spellId)?.spellName;
    if (name !== undefined) pickedBy.set(member.actorIndex, name);
  }

  const candidates: Badge[] = [];
  /**
   * A badge, if anyone earns it. `values` and `best` decide the winners among
   * `field`; `describe` says what a player's value was, for the winners'
   * reasons and for the whole field in the hover tip. `gap` renames it when
   * one player ran away with it.
   */
  const badge = (
    spec: Omit<Badge, 'winners' | 'reasons' | 'field' | 'gapped'>,
    values: Values,
    best: 'most' | 'fewest',
    describe: (index: number) => string,
    { field = party, reason = describe, eligible = () => true, gap }: {
      field?: readonly PartyMember[];
      reason?: (index: number) => string;
      eligible?: (index: number) => boolean;
      gap?: Gap;
    } = {},
  ): void => {
    const winners = leaders(field, values, best).filter(eligible);
    if (winners.length === 0) return;
    const of = (index: number): number => values.get(index) ?? 0;
    const ranked = [...field].sort((a, b) =>
      best === 'most' ? of(b.actorIndex) - of(a.actorIndex) : of(a.actorIndex) - of(b.actorIndex),
    );
    const top = of(ranked[0]!.actorIndex);
    const second = ranked.length > 1 ? of(ranked[1]!.actorIndex) : 0;
    const gapped =
      gap !== undefined && best === 'most' && winners.length === 1 && top >= gap.times * second && top >= (gap.min ?? 0);
    candidates.push({
      ...spec,
      ...(gapped ? { title: gap.title, blurb: gap.blurb } : {}),
      gapped,
      winners,
      reasons: Object.fromEntries(winners.map((index) => [index, reason(index)])),
      field: ranked.map((member) => ({ actorIndex: member.actorIndex, text: describe(member.actorIndex) })),
    });
  };

  // The roasts, read out first.
  // Most falls, and of those the hardest landing, so two falls of 30k lose to
  // two that nearly killed.
  const fallScore = new Map([...falls].map(([index, n]) => [index, n * 1e12 + (fallDamage.get(index) ?? 0)]));
  badge(
    { key: 'gravity', title: 'Gravity Enjoyer', icon: '🪂', roast: true, blurb: 'Took the most fall damage. The ground was right there.' },
    fallScore,
    'most',
    (index) => `${plural(falls.get(index) ?? 0, 'fall')}, ${short(fallDamage.get(index) ?? 0)} damage`,
    // Two falls at the least (a fall scores 1e12): one fall to everyone else's none is a stumble.
    { gap: { title: 'Wile E. Coyote', blurb: 'Fell three times as often as anyone. Beep beep.', times: 3, min: 2e12 } },
  );
  badge(
    { key: 'floor', title: 'Floor Inspector', icon: '💀', roast: true, blurb: 'Died the most. Thorough work.' },
    deaths,
    'most',
    (index) => plural(deaths.get(index) ?? 0, 'death'),
    { gap: { title: "Spirit Healer's Regular", blurb: 'Died twice as often as anyone else. She knows your name.', times: 2, min: 3 } },
  );
  // Only where the avoidable list covers the dungeon: elsewhere everyone
  // would read zero and the badge would be a lie.
  if (run.avoidable.covered) {
    badge(
      { key: 'magnet', title: 'Tunnel Vision', icon: '🙈', roast: true, blurb: 'Took the most avoidable damage.' },
      avoidable,
      'most',
      (index) => `${short(avoidable.get(index) ?? 0)} avoidable`,
      { gap: { title: 'Clueless', blurb: 'Took twice the avoidable damage of anyone else.', times: 2 } },
    );
  }
  // Not their fault, which is the joke: the dungeon just liked them.
  badge(
    { key: 'rng', title: 'Mechanic Magnet', icon: '🧲', roast: true, blurb: 'Picked out by random mechanics the most.' },
    picks,
    'most',
    (index) => {
      const n = picks.get(index) ?? 0;
      const by = pickedBy.get(index);
      return by === undefined ? plural(n, 'pick') : `${plural(n, 'pick')}, mostly ${by}`;
    },
    { gap: { title: 'Main Character', blurb: 'Picked out by random mechanics half again as often as anyone else.', times: 1.5, min: 8 } },
  );

  // The glory, building to the MVP.
  badge(
    { key: 'totems', title: 'Totem Stomper', icon: '🗿', roast: false, blurb: 'Finished off the most enemy totems.' },
    totems,
    'most',
    (index) => plural(totems.get(index) ?? 0, 'totem'),
    { gap: { title: 'Paul Bunyan', blurb: 'Felled twice the totems of anyone else.', times: 2, min: 5 } },
  );
  badge(
    { key: 'janitor', title: 'Janitor', icon: '🧹', roast: false, blurb: 'Dispelled, purged and soothed the most.' },
    dispels,
    'most',
    (index) => plural(dispels.get(index) ?? 0, 'dispel'),
    { gap: { title: 'Mr. Clean', blurb: 'Dispelled twice as much as anyone else.', times: 2, min: 6 } },
  );
  badge(
    { key: 'cc', title: 'Crowd Controller', icon: '✋', roast: false, blurb: 'Pressed the most crowd control.' },
    cc,
    'most',
    (index) => plural(cc.get(index) ?? 0, 'cast'),
    { gap: { title: 'Medusa', blurb: 'Pressed twice the crowd control of anyone else.', times: 2, min: 8 } },
  );
  badge(
    { key: 'kicks', title: 'Kick Machine', icon: '🦵', roast: false, blurb: 'Stopped the most casts.' },
    kicks,
    'most',
    (index) => plural(kicks.get(index) ?? 0, 'kick'),
    { gap: { title: 'Georges St-Pierre', blurb: 'Kicked twice as much as anyone else.', times: 2, min: 10 } },
  );
  if (run.avoidable.covered) {
    badge(
      { key: 'untouchable', title: 'Untouchable', icon: '🛡️', roast: false, blurb: 'Took the least avoidable damage.' },
      avoidable,
      'fewest',
      (index) => ((avoidable.get(index) ?? 0) === 0 ? 'not a scratch' : `${short(avoidable.get(index) ?? 0)} avoidable`),
    );
  }
  badge(
    { key: 'unkillable', title: 'Unkillable', icon: '❤️', roast: false, blurb: 'Never died, while others did.' },
    deaths,
    'fewest',
    (index) => plural(deaths.get(index) ?? 0, 'death'),
    { reason: () => 'no deaths', eligible: (index) => (deaths.get(index) ?? 0) === 0 },
  );
  badge(
    { key: 'oneshot', title: 'One-Shot', icon: '💥', roast: false, blurb: 'Landed the single biggest hit.' },
    bigHitAmount,
    'most',
    (index) => {
      const hit = bigHit.get(index);
      return hit === undefined ? '—' : `${short(hit.amount)} ${hit.spellName} on ${hit.targetName}`;
    },
    { gap: { title: 'Falcon Punch', blurb: 'Hit three times as hard as anyone else, once.', times: 3 } },
  );
  // The healer wins most healing every key, and a tank's self-healing wins
  // the rest, so the badge is among the dps: whoever healed most without it
  // being their job.
  badge(
    { key: 'lifeguard', title: 'Lifeguard', icon: '🛟', roast: false, blurb: 'Did the most healing of the dps.' },
    healing,
    'most',
    (index) => `${short(hps.get(index) ?? 0)} HPS`,
    {
      field: party.filter((member) => specOf(member.specId).role === 'dps'),
      gap: { title: 'David Hasselhoff', blurb: 'Healed twice as much as any other dps.', times: 2 },
    },
  );
  badge(
    { key: 'pumper', title: 'Big Pumper', icon: '🔥', roast: false, blurb: 'Did the most damage.' },
    damage,
    'most',
    (index) => `${short(dps.get(index) ?? 0)} DPS`,
    { gap: { title: 'Hard Carry', blurb: 'Did half again the damage of anyone else.', times: 1.5 } },
  );
  const badges = pick(candidates, seedOf(run, party));

  // The MVP: rank points across everything a player can do for the group.
  // Damage and healing both count, so a healer and a dps each have their
  // category to win, and a tank's lies in kicks, control and staying alive.
  // Falls score nothing either way; they are only funny.
  const categories: Array<[string, Map<number, number>]> = [
    ['Damage', rankPoints(party, damage, 'most')],
    ['Healing', rankPoints(party, healing, 'most')],
    ['Kicks', rankPoints(party, kicks, 'most')],
    ['Crowd control', rankPoints(party, cc, 'most')],
    ['Dispels', rankPoints(party, dispels, 'most')],
    ['Fewest deaths', rankPoints(party, deaths, 'fewest')],
    ['Totems', rankPoints(party, totems, 'most')],
  ];
  if (run.avoidable.covered) categories.push(['Least avoidable', rankPoints(party, avoidable, 'fewest')]);

  const standings = party
    .map((member) => {
      const lines = categories
        .map(([category, points]) => ({ category, points: points.get(member.actorIndex) ?? 0 }))
        .filter((line) => line.points > 0);
      return { member, points: lines.reduce((sum, line) => sum + line.points, 0), lines };
    })
    .sort((a, b) => b.points - a.points);
  const top = standings[0]?.points ?? 0;
  const mvp = top > 0 ? standings.filter((entry) => entry.points === top).map((entry) => entry.member.actorIndex) : [];

  return { badges, standings, mvp };
}

/** The badges one player holds, in reveal order. */
export function badgesOf(awards: Awards | null, actorIndex: number): Badge[] {
  return awards === null ? [] : awards.badges.filter((badge) => badge.winners.includes(actorIndex));
}

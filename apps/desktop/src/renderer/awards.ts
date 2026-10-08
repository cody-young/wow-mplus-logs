import {
  summarizeAvoidable,
  summarizeCrowdControl,
  summarizeDispels,
  summarizeInterrupts,
} from '@mplus/analysis';

import { integer, short, wipeCutoff } from './format.js';
import { partyOf, type PartyMember } from './components/RunRow.js';
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

  const badges: Badge[] = [];
  const badge = (
    spec: Omit<Badge, 'winners' | 'reasons'>,
    winners: number[],
    reason: (index: number) => string,
  ): void => {
    if (winners.length === 0) return;
    badges.push({ ...spec, winners, reasons: Object.fromEntries(winners.map((index) => [index, reason(index)])) });
  };

  // The roasts, read out first.
  // Most falls, and of those the hardest landing, so two falls of 30k lose to
  // two that nearly killed.
  const fallScore = new Map([...falls].map(([index, n]) => [index, n * 1e12 + (fallDamage.get(index) ?? 0)]));
  badge(
    { key: 'gravity', title: 'Gravity Enjoyer', icon: '🪂', roast: true, blurb: 'Took the most fall damage. The ground was right there.' },
    leaders(party, fallScore, 'most'),
    (index) => `${plural(falls.get(index) ?? 0, 'fall')}, ${short(fallDamage.get(index) ?? 0)} damage`,
  );
  badge(
    { key: 'floor', title: 'Floor Inspector', icon: '💀', roast: true, blurb: 'Died the most. Thorough work.' },
    leaders(party, deaths, 'most'),
    (index) => plural(deaths.get(index) ?? 0, 'death'),
  );
  // Only where the avoidable list covers the dungeon: elsewhere everyone
  // would read zero and the badge would be a lie.
  if (run.avoidable.covered) {
    badge(
      { key: 'magnet', title: 'Mechanic Magnet', icon: '🧲', roast: true, blurb: 'Took the most avoidable damage.' },
      leaders(party, avoidable, 'most'),
      (index) => `${short(avoidable.get(index) ?? 0)} avoidable`,
    );
  }

  // The glory, building to the MVP.
  badge(
    { key: 'totems', title: 'Totem Stomper', icon: '🗿', roast: false, blurb: 'Finished off the most enemy totems.' },
    leaders(party, totems, 'most'),
    (index) => plural(totems.get(index) ?? 0, 'totem'),
  );
  badge(
    { key: 'janitor', title: 'Janitor', icon: '🧹', roast: false, blurb: 'Dispelled, purged and soothed the most.' },
    leaders(party, dispels, 'most'),
    (index) => plural(dispels.get(index) ?? 0, 'dispel'),
  );
  badge(
    { key: 'cc', title: 'Crowd Controller', icon: '✋', roast: false, blurb: 'Pressed the most crowd control.' },
    leaders(party, cc, 'most'),
    (index) => plural(cc.get(index) ?? 0, 'cast'),
  );
  badge(
    { key: 'kicks', title: 'Kick Machine', icon: '🦵', roast: false, blurb: 'Stopped the most casts.' },
    leaders(party, kicks, 'most'),
    (index) => plural(kicks.get(index) ?? 0, 'kick'),
  );
  if (run.avoidable.covered) {
    badge(
      { key: 'untouchable', title: 'Untouchable', icon: '🛡️', roast: false, blurb: 'Took the least avoidable damage.' },
      leaders(party, avoidable, 'fewest'),
      (index) => ((avoidable.get(index) ?? 0) === 0 ? 'not a scratch' : `${short(avoidable.get(index) ?? 0)} avoidable`),
    );
  }
  badge(
    { key: 'unkillable', title: 'Unkillable', icon: '❤️', roast: false, blurb: 'Never died, while others did.' },
    leaders(party, deaths, 'fewest').filter((index) => (deaths.get(index) ?? 0) === 0),
    () => 'no deaths',
  );
  badge(
    { key: 'oneshot', title: 'One-Shot', icon: '💥', roast: false, blurb: 'Landed the single biggest hit.' },
    leaders(party, bigHitAmount, 'most'),
    (index) => {
      const hit = bigHit.get(index);
      return hit === undefined ? '' : `${short(hit.amount)} ${hit.spellName} on ${hit.targetName}`;
    },
  );
  badge(
    { key: 'lifeguard', title: 'Lifeguard', icon: '🛟', roast: false, blurb: 'Did the most healing.' },
    leaders(party, healing, 'most'),
    (index) => `${short(hps.get(index) ?? 0)} HPS`,
  );
  badge(
    { key: 'pumper', title: 'Big Pumper', icon: '🔥', roast: false, blurb: 'Did the most damage.' },
    leaders(party, damage, 'most'),
    (index) => `${short(dps.get(index) ?? 0)} DPS`,
  );

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

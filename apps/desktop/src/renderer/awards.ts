import {
  summarizeAvoidable,
  summarizeCrowdControl,
  summarizeDispels,
  summarizeInterrupts,
  type Tally,
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

/**
 * A badge's other name, for a lone winner with `times` the runner-up's figure
 * (and at least `min`) — or, for a "fewest" badge, a runner-up with `times`
 * the winner's.
 */
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
  /** Where the player finished in it: 1 is first, and ties share a place. */
  place: number;
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

/** What tops damage: twice what tops a category scored by rank. */
const DAMAGE_POINTS = 10;

/**
 * What tops healing: the same as topping a category by rank. The healer leads
 * healing every key, so at damage's weight it would be ten points for turning
 * up; it scores by share only so a dps who healed a lot is told apart from one
 * who healed a little.
 */
const HEALING_POINTS = 5;

/**
 * Points for one category by share of the top figure, rounded: the top scores
 * `max`, and half its figure scores half that.
 *
 * Rank points cannot tell a carry from a photo finish: twice the next player's
 * damage scores one point over them, the same as a hair more. Damage is what a
 * key is cleared with, so it scores by how much, and at twice the weight of
 * the rest.
 */
function sharePoints(party: readonly PartyMember[], values: Values, max: number): Map<number, number> {
  const of = (index: number): number => values.get(index) ?? 0;
  const top = Math.max(0, ...party.map((member) => of(member.actorIndex)));
  const points = new Map<number, number>();
  if (top <= 0) return points;
  for (const member of party) {
    const share = Math.round((max * of(member.actorIndex)) / top);
    if (share > 0) points.set(member.actorIndex, share);
  }
  return points;
}

/** Each player's place in a category, 1 for first; ties share the better place. */
function places(party: readonly PartyMember[], values: Values, best: 'most' | 'fewest'): Map<number, number> {
  const of = (index: number): number => values.get(index) ?? 0;
  return new Map(
    party.map((member) => {
      const mine = of(member.actorIndex);
      const ahead = party.filter((other) =>
        best === 'most' ? of(other.actorIndex) > mine : of(other.actorIndex) < mine,
      ).length;
      return [member.actorIndex, ahead + 1];
    }),
  );
}

function count<T>(list: readonly T[], key: (item: T) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const item of list) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

/**
 * Melee swings it takes to be a threat. On a night of keys most of the party
 * took 0 to 10 and the one who pulled aggro took dozens; a stray swing or two
 * is a mob turning round, not a threat.
 */
const THREAT_MIN_SWINGS = 10;

/**
 * Share of their damage on worthless trash it takes to be a padder. Measured
 * at 0 to 8% for everyone in most keys and up to 18% in a key full of adds.
 */
const PADDER_MIN_SHARE = 0.1;

/**
 * Overhealing it takes to be paranoid, as a share of healing on others, and
 * the share of the party's healing on others it takes to count at all. This
 * season's healers ran 18 to 41%; a disc priest, 52 to 60%.
 */
const PARANOID_OVERHEAL = 0.45;
const PARANOID_SHARE = 0.25;

/**
 * Procs it takes to be lucky, against what the rates expected. Measured at
 * 0.66 to 1.25 per player, so 1.15 is a good night, not just the best of five.
 * Below ten expected procs a ratio is a coin flip or two.
 */
const LUCK_MIN_RATIO = 1.15;
const LUCK_MIN_EXPECTED = 10;

/** How long a death has to take, from the first hit in its window, for a heal to have had a chance. */
const SLOW_DEATH_MS = 5000;

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

  const dpsField = party.filter((member) => specOf(member.specId).role === 'dps');
  const nonTanks = party.filter((member) => specOf(member.specId).role !== 'tank');
  const healers = party.filter((member) => specOf(member.specId).role === 'healer');

  const tally = new Map(run.stats.tallies.map((entry) => [entry.actorIndex, entry]));
  const fromTally = (read: (entry: Tally) => number): Map<number, number> =>
    new Map(run.stats.tallies.map((entry) => [entry.actorIndex, read(entry)]));
  const lusts = count(run.stats.lusts, (entry) => entry.actorIndex);
  const cheats = count(run.stats.cheats, (entry) => entry.actorIndex);
  const ankhs = count(run.stats.ankhs, (entry) => entry.actorIndex);
  const lockouts = count(run.stats.lockouts, (entry) => entry.actorIndex);
  const reflects = count(run.stats.reflects, (entry) => entry.actorIndex);
  const swings = fromTally((entry) => entry.swings);
  const debuffs = fromTally((entry) => entry.debuffs);
  const debuffsApplied = fromTally((entry) => entry.debuffsApplied);
  // Padding as a share of the player's damage, so a big pumper is not a
  // padder for hitting everything harder.
  const padding = fromTally((entry) => {
    const total = damage.get(entry.actorIndex) ?? 0;
    return total > 0 ? entry.padding / total : 0;
  });
  // Overhealing only counts for whoever did a real part of the healing on
  // others: a dps whose one stray heal topped off a full tank is not paranoid.
  const healingOnOthers = run.stats.tallies.reduce((sum, entry) => sum + entry.healingOnOthers, 0);
  const overhealing = fromTally((entry) =>
    entry.healingOnOthers >= PARANOID_SHARE * healingOnOthers && entry.healingOnOthers > 0
      ? entry.overhealingOnOthers / entry.healingOnOthers
      : 0,
  );
  // Procs against the odds. Only for whoever was expected enough of them
  // that the ratio is more than a coin flip or two.
  const luck = fromTally((entry) => (entry.procsExpected >= LUCK_MIN_EXPECTED ? entry.procs / entry.procsExpected : 0));
  // Deaths that took their time and had no heal from the healer in them. A
  // one-shot had no time for a heal, so it is not the healer's doing.
  const healerNames = new Set(healers.map((member) => member.name));
  const neglected = count(
    (cutoff === null ? run.deaths : run.deaths.slice(0, cutoff)).filter((death) => {
      if (healerNames.size === 0 || healerNames.has(death.name)) return false;
      const from = death.ts - death.windowMs;
      const first = death.incoming.find((hit) => hit.ts >= from);
      if (first === undefined || death.ts - first.ts < SLOW_DEATH_MS) return false;
      return !death.healsReceived.some((heal) => heal.ts >= from && healerNames.has(heal.sourceName));
    }),
    (death) => death.actorIndex,
  );
  const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

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
      gap !== undefined &&
      winners.length === 1 &&
      (best === 'most' ? top >= gap.times * second && top >= (gap.min ?? 0) : second >= gap.times * top);
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

  // Last of the dps, and well behind the next: a dps a little short of the
  // others is most keys, so it takes the next one doing half again as much.
  // Among the dps only, since the tank and healer are always behind them.
  const dpsDamage = dpsField.map((member) => damage.get(member.actorIndex) ?? 0).sort((a, b) => a - b);
  if (dpsField.length >= 3 && dpsDamage[1]! >= 1.5 * dpsDamage[0]!) {
    badge(
      { key: 'backpack', title: 'Backpack', icon: '🎒', roast: true, blurb: 'Did the least damage of the dps, by a long way. Thanks for the ride.' },
      damage,
      'fewest',
      (index) => `${short(dps.get(index) ?? 0)} DPS`,
      { field: dpsField, gap: { title: 'Anchor', blurb: 'Did half the damage of the next dps. The group dragged you to the end.', times: 2 } },
    );
  }

  badge(
    { key: 'ankh', title: 'Shaman Defensive', icon: '🪦', roast: true, blurb: 'Used Ankh. A defensive, technically.' },
    ankhs,
    'most',
    (index) => plural(ankhs.get(index) ?? 0, 'Ankh'),
  );
  badge(
    { key: 'cheater', title: 'Cheater', icon: '🃏', roast: true, blurb: 'Cheated death the most. Should have been a death.' },
    cheats,
    'most',
    (index) => plural(cheats.get(index) ?? 0, 'save'),
    { gap: { title: 'Nine Lives', blurb: 'Cheated death twice as often as anyone else.', times: 2, min: 3 } },
  );
  badge(
    { key: 'lockout', title: "Don't Interrupt Me", icon: '🤐', roast: true, blurb: 'Had the most casts cut off by an enemy.' },
    lockouts,
    'most',
    (index) => `${plural(lockouts.get(index) ?? 0, 'cast')} cut off`,
  );
  // Among the rest of the party: taking hits is the tank's job.
  badge(
    { key: 'threat', title: "I'm a Threat", icon: '🎯', roast: true, blurb: 'Took the most melee hits of anyone but the tank.' },
    swings,
    'most',
    (index) => plural(swings.get(index) ?? 0, 'swing'),
    {
      field: nonTanks,
      eligible: (index) => (swings.get(index) ?? 0) >= THREAT_MIN_SWINGS,
      gap: { title: 'Off-Tank', blurb: 'Took twice the melee of anyone else but the tank. Queue as one.', times: 2, min: 30 },
    },
  );
  badge(
    { key: 'typhoid', title: 'Typhoid Mary', icon: '🦠', roast: true, blurb: 'Wore the most enemy debuffs, tank aside.' },
    debuffs,
    'most',
    (index) => plural(debuffs.get(index) ?? 0, 'debuff'),
    { field: nonTanks, gap: { title: 'Patient Zero', blurb: 'Wore half again the debuffs of anyone but the tank.', times: 1.5 } },
  );
  badge(
    { key: 'neglected', title: "Healer's Enemy", icon: '🚑', roast: true, blurb: 'Died slowly, and not one heal from the healer on the way down.' },
    neglected,
    'most',
    (index) => plural(neglected.get(index) ?? 0, 'unhealed death'),
    { field: party.filter((member) => !healerNames.has(member.name)) },
  );
  if (run.stats.paddingKnown) {
    badge(
      { key: 'padder', title: 'Padder', icon: '📈', roast: true, blurb: 'Spent the most of their damage on trash worth nothing.' },
      padding,
      'most',
      (index) => `${percent(padding.get(index) ?? 0)} of their damage`,
      {
        eligible: (index) => (padding.get(index) ?? 0) >= PADDER_MIN_SHARE,
        gap: { title: 'Meter Merchant', blurb: 'Padded twice as hard as anyone else.', times: 2 },
      },
    );
  }
  badge(
    { key: 'paranoid', title: 'Paranoid', icon: '😰', roast: true, blurb: 'Overhealed the most, and by nearly half or more.' },
    overhealing,
    'most',
    (index) => {
      const mine = tally.get(index);
      return mine === undefined || mine.healingOnOthers === 0 ? '—' : `${percent(mine.overhealingOnOthers / mine.healingOnOthers)} overhealing`;
    },
    { eligible: (index) => (overhealing.get(index) ?? 0) >= PARANOID_OVERHEAL },
  );

  // The glory, building to the MVP.
  badge(
    { key: 'lust', title: 'Haste for the Haste Gods', icon: '🥁', roast: false, blurb: 'Pressed the most Bloodlust.' },
    lusts,
    'most',
    (index) => plural(lusts.get(index) ?? 0, 'lust'),
  );
  // Typhoid Mary's other half: the one doing the spreading.
  badge(
    { key: 'plague', title: 'Plague Bearer', icon: '🐀', roast: false, blurb: 'Put the most debuffs on enemies.' },
    debuffsApplied,
    'most',
    (index) => plural(debuffsApplied.get(index) ?? 0, 'debuff'),
    { gap: { title: 'Black Death', blurb: 'Spread twice the debuffs of anyone else.', times: 2 } },
  );
  badge(
    { key: 'mirror', title: 'Mirror', icon: '🪞', roast: false, blurb: 'Reflected the most enemy spells back at them.' },
    reflects,
    'most',
    (index) => plural(reflects.get(index) ?? 0, 'reflect'),
  );
  badge(
    { key: 'procs', title: 'Proc Machine', icon: '🎰', roast: false, blurb: 'Procced the most against the odds.' },
    luck,
    'most',
    (index) => {
      const mine = tally.get(index);
      if (mine === undefined || mine.procsExpected < LUCK_MIN_EXPECTED) return '—';
      return `${plural(mine.procs, 'proc')}, ${percent(mine.procs / mine.procsExpected)} of the odds`;
    },
    { eligible: (index) => (luck.get(index) ?? 0) >= LUCK_MIN_RATIO },
  );
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
      field: dpsField,
      gap: { title: 'David Hasselhoff', blurb: 'Healed twice as much as any other dps.', times: 2 },
    },
  );
  badge(
    { key: 'pumper', title: 'Big Pumper', icon: '🔥', roast: false, blurb: 'Did the most damage.' },
    damage,
    'most',
    (index) => `${short(dps.get(index) ?? 0)} DPS`,
    { gap: { title: 'Hard Carry', blurb: 'Did 50% more damage than anyone else.', times: 1.5 } },
  );
  const badges = pick(candidates, seedOf(run, party));

  // The MVP: points across everything a player can do for the group.
  // Damage and healing both count, by share, so a healer and a dps each have
  // their category to win, and a tank's lies in kicks, control and staying
  // alive, by rank. Falls score nothing either way; they are only funny.
  const byShare = (category: string, values: Values, max: number) => ({
    category,
    points: sharePoints(party, values, max),
    places: places(party, values, 'most'),
  });
  const byRank = (category: string, values: Values, best: 'most' | 'fewest') => ({
    category,
    points: rankPoints(party, values, best),
    places: places(party, values, best),
  });
  const categories = [
    byShare('Damage', damage, DAMAGE_POINTS),
    byShare('Healing', healing, HEALING_POINTS),
    byRank('Kicks', kicks, 'most'),
    byRank('Crowd control', cc, 'most'),
    byRank('Dispels', dispels, 'most'),
    byRank('Fewest deaths', deaths, 'fewest'),
    byRank('Totems', totems, 'most'),
  ];
  if (run.avoidable.covered) categories.push(byRank('Least avoidable', avoidable, 'fewest'));

  const standings = party
    .map((member) => {
      const lines = categories
        .map(({ category, points, places }) => ({
          category,
          points: points.get(member.actorIndex) ?? 0,
          place: places.get(member.actorIndex) ?? party.length,
        }))
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

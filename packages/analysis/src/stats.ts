import { avoidable, procsPerMinute } from '@mplus/data';
import { ActorKind, Environment, Ev, EvFlag } from '@mplus/parser';

import { actorName, elapsedMs, spellName, type AnalysisContext } from './context.js';
import { DAMAGE_CODES, HEAL_CODES, effective, wasted } from './events.js';
import { SegmentKind, segmentAt, type SegmentIndex } from './segments.js';

/**
 * The awards tab: the numbers nobody needs and everybody wants to see.
 *
 * Totems, first. A key's casters drop Magma and Volatile Totems
 * that do nothing until someone breaks them, and somebody always does more of
 * the breaking than everyone else. The log says who: PARTY_KILL names the
 * player — or their pet — whose hit finished a unit, a few ms before the
 * UNIT_DIED that names nobody. Across a +12 Den of Nalorakk, 20 of the 23
 * totem deaths carried one; the rest expired or were finished by something
 * that is not the party's, and those are nobody's stomp.
 *
 * What a totem is comes from its name, because the game says nothing else.
 * Every enemy totem in the logs so far ends in " Totem" — Magma, Volatile,
 * Torrent, Thundering — and the one near miss, Ruthless Totemcaller, is the
 * caster that drops them. A shaman's totem broken in a solo shuffle ends the
 * same way, which is why the target must also be an NPC nobody in the party
 * controls.
 *
 * And falls. ENVIRONMENTAL_DAMAGE names its kind, and "Falling" is someone
 * stepping off a ledge they did not need to step off. Only a player's own
 * falls count; a pet that tumbles after its owner is not the owner's fall.
 *
 * And each player's biggest single hit on an enemy, the number they will
 * screenshot. As the game showed it: the whole amount, overkill included,
 * because a hit that ended a mob with room to spare is no smaller for it.
 *
 * And who the dungeon picked on. Plenty of mechanics choose one player at
 * random — a dive, a curse, a barrage — and the log says who, as the debuff
 * an enemy puts on them. Nothing in the game's data marks a mechanic as
 * random, so it is read from how the debuff lands: one player at a time
 * (casts are applications more than 1.5s apart), at least three times, on at
 * least three different players, and mostly not on the tank. That last is
 * what tells a random pick from a tank buster, which picks the tank every
 * time. A debuff from standing in something is on the avoidable list, and is
 * that list's to count. Across six logs of this season it finds Razor Dive,
 * Cutpurse, Arrow Barrage, Curse of Doom, Shadow Barrage and the like.
 *
 * And who had a mob's attention. The log never says what an enemy is
 * targeting, but a melee swing lands on whoever it is, so swings on anyone
 * but the tank are aggro they pulled. Not when the enemy has a debuff of its
 * own on them: a fixate is a mark, and a mob chasing its mark is following a
 * script, not a threat table. On a night of keys the tanks took 600 to 3,500
 * swings each and the rest of the party 0 to 160.
 *
 * And luck. A trinket or an enchant that procs at a set rate a minute
 * (packages/data/src/procs.ts) was meant to fire that often over the key, so
 * procs against that expectation say who the dice liked, fairly across specs.
 * Measured on four keys it ran 0.66 to 1.25 of the expectation per player.
 *
 * And padding: damage to trash the forces table says is worth nothing, which
 * is the summoned adds and the critters that move nobody's bar. Bosses' adds
 * are left out, because killing those is the fight.
 *
 * The rest are counts the log states outright: Bloodlusts given, deaths
 * cheated, Ankhs, casts an enemy interrupted, spells reflected, debuffs taken
 * debuffs put on enemies, and healing on the rest of the party with its
 * overhealing. Taunts, Power Infusions kept for oneself and given, externals, combat
 * rezzes, Leaps of Faith and Rescues, personal defensives, immunities running
 * out, Demonic Gateway hops and dashes: each a spell id read off this season's logs.
 *
 * And mana, as it stood when each pull and boss ended. The advanced block
 * carries its subject's power, so whoever the last row before the end
 * described, that is what they had left.
 *
 * What the log cannot give, however the awards tab might want it, is a jump:
 * nothing in it records one, and its positions carry no height.
 */

/** One enemy totem, and who finished it. */
export interface TotemKill {
  /** Store-relative ms. */
  ts: number;
  /** The player it counts for: a pet's kill is its owner's. */
  actorIndex: number;
  name: string;
  specId: number;
  /** The pet that landed it, when one did. Empty when the player did. */
  petName: string;
  totemIndex: number;
  totemName: string;
  /** The pull or boss it fell in, or -1 when none was open. */
  segmentId: number;
}

/** One fall a party member took damage from. */
export interface Fall {
  /** Store-relative ms. */
  ts: number;
  actorIndex: number;
  name: string;
  specId: number;
  /** Damage the fall did, not counting what was past the player's health. */
  amount: number;
  /** The fall killed them. */
  fatal: boolean;
  /** The pull or boss open at the time, or -1 when none was. */
  segmentId: number;
}

/** A player's biggest single hit on an enemy. */
export interface BigHit {
  /** Store-relative ms. */
  ts: number;
  /** The player it counts for: a pet's hit is its owner's. */
  actorIndex: number;
  name: string;
  specId: number;
  amount: number;
  spellId: number;
  spellName: string;
  targetName: string;
  segmentId: number;
}

/** One thing one player did, or had done to them, with the spell it was. */
export interface Moment {
  /** Store-relative ms. */
  ts: number;
  /** The player it counts for: a pet's press is its owner's. */
  actorIndex: number;
  name: string;
  specId: number;
  spellId: number;
  spellName: string;
  segmentId: number;
}

/** One time an enemy's mechanic picked a player out. */
export type Pick = Moment;

/** One player doing something for another: an external, a combat rez, a lift. */
export interface Assist extends Moment {
  targetIndex: number;
  targetName: string;
}

/** What one player had left in mana when a pull or boss ended. */
export interface Drain {
  /** Store-relative ms: the end of the segment. */
  ts: number;
  actorIndex: number;
  name: string;
  specId: number;
  segmentId: number;
  /** Percent of their maximum. */
  mana: number;
}

/** What one player's whole key adds up to, for the counts that are not a list. */
export interface Tally {
  actorIndex: number;
  name: string;
  specId: number;
  /** Melee swings enemies landed on them, less the ones a fixate sent. */
  swings: number;
  /** Debuffs enemies put on them. */
  debuffs: number;
  /** Debuffs they, or their pets, put on enemies. */
  debuffsApplied: number;
  /** Healing they did to the rest of the party, overhealing included. */
  healingOnOthers: number;
  /** The overhealing part of `healingOnOthers`. */
  overhealingOnOthers: number;
  /** Damage they did to trash worth no enemy forces. 0 when no forces table covered the dungeon. */
  padding: number;
  /** Times a proc with a known rate fired for them. */
  procs: number;
  /** How many times those procs were meant to fire over the key, by their rates. */
  procsExpected: number;
}

export interface StatsReport {
  /** Every enemy totem the party finished, in order. */
  totemKills: TotemKill[];
  /** Every fall the party took damage from, in order. */
  falls: Fall[];
  /** Each player's biggest hit, one per player who hit anything. */
  biggestHits: BigHit[];
  /** Every time a mechanic that picks at random picked one of the party, in order. */
  picks: Pick[];
  /**
   * Every Bloodlust and its kind the party gave itself, in order: a press
   * only counts when its buff landed on someone, so of two pressed together
   * only the first, and a press into a sated party not at all.
   */
  lusts: Moment[];
  /** Every time one of the party cheated death, in order. */
  cheats: Moment[];
  /** Every Reincarnation, in order. */
  ankhs: Moment[];
  /** Every cast of the party's an enemy interrupted, named by the cast it stopped. */
  lockouts: Moment[];
  /** Every enemy spell one of the party reflected, named by the spell. */
  reflects: Moment[];
  /** Every taunt the party pressed, a pet's counting for its owner. */
  taunts: Moment[];
  /** Every Power Infusion a priest put on themselves, not counting Twins of the Sun Priestess's copy. */
  selfInfusions: Moment[];
  /** Every Power Infusion a priest put on someone else in the party, in order. */
  infusions: Assist[];
  /** Every major external one of the party put on another, in order. */
  externals: Assist[];
  /** Every combat rez one of the party landed on another, in order. */
  rezzes: Assist[];
  /** Every Leap of Faith and Rescue that carried one of the party, in order. */
  lifts: Assist[];
  /** Every major personal defensive one of the party put on themselves, in order. */
  defensives: Moment[];
  /** Every time a player's own immunity ran out, at the moment it did. */
  immunities: Moment[];
  /** Every Demonic Gateway one of the party took, in order. */
  gateways: Moment[];
  /** Every movement ability the party pressed, in order. */
  dashes: Moment[];
  /** Mana left at the end of every pull and boss, for everyone whose power is mana. */
  drains: Drain[];
  /** One per party member. */
  tallies: Tally[];
  /** Whether `padding` could be measured: only when a forces table covered the dungeon. */
  paddingKnown: boolean;
}

const TOTEM = / Totem$/;

const TANK_SPECS: ReadonlySet<number> = new Set([250, 581, 104, 268, 66, 73]);

/**
 * The presses that give the party Bloodlust, by the id the caster's
 * SPELL_CAST_SUCCESS carries, each read off this season's logs: Bloodlust,
 * Heroism, Time Warp, a hunter pet's Primal Rage and Fury of the Aspects.
 * Primal Rage is the pet's cast, which is its owner's like every other.
 */
const LUSTS: ReadonlySet<number> = new Set([2825, 32182, 80353, 264667, 390386]);

/**
 * How far apart a Bloodlust press and its buff landing can be and still be
 * the one press. The caster's own copy is logged in the millisecond before
 * the cast, everyone else's within some tens after; a press into a sated
 * party lands nothing at all, and is no Bloodlust.
 */
const LUST_LANDS_MS = 1000;

/**
 * The auras that mean a player should be dead and is not, as they land on
 * that player: Cheated Death (a rogue's Cheat Death), Cauterized (a mage's
 * Cauterize), Shroud of Purgatory (a death knight's Purgatory) and
 * Uncontained Fel (a vengeance demon hunter's Last Resort). Each is the
 * after-effect the save leaves, applied once a save, rather than the passive
 * that is up all key.
 */
const CHEAT_AURAS: ReadonlySet<number> = new Set([45181, 87024, 116888, 209261]);

/**
 * The saves that arrive as a heal instead: Guardian Spirit's, on whoever the
 * priest kept up, and Ardent Defender's, on the paladin.
 */
const CHEAT_HEALS: ReadonlySet<number> = new Set([48153, 66235]);

/** Reincarnation, the shaman's Ankh, as its cast. */
const ANKH = 21169;

/**
 * The taunts, as their casts: Taunt, a druid's Growl, a hunter pet's Growl,
 * Hand of Reckoning, Dark Command, Provoke and Torment. Death Grip taunts too,
 * but a damage dealer presses it to grip, not to taunt.
 */
const TAUNTS: ReadonlySet<number> = new Set([355, 6795, 2649, 62124, 56222, 115546, 185245]);

const POWER_INFUSION = 10060;

/**
 * A Power Infusion on yourself this close to one on someone else is Twins of
 * the Sun Priestess's copy, which the game logs as a second cast: 1 to 30ms
 * behind the real one in this season's logs.
 */
const TWINS_MS = 250;

/**
 * The major externals, as their casts: Pain Suppression, Ironbark, Life
 * Cocoon, Blessing of Sacrifice, Time Dilation, Blessing of Spellwarding,
 * Blessing of Protection, Guardian Spirit, both Lay on Hands and Intervene.
 */
const EXTERNALS: ReadonlySet<number> = new Set([
  33206, 102342, 116849, 6940, 357170, 204018, 1022, 47788, 633, 471195, 3411,
]);

/**
 * The combat rezzes, as SPELL_RESURRECT names them: Rebirth, Raise Ally,
 * Intercession and Soulstone Resurrection, which names the warlock as its
 * source like the others name their caster.
 */
const REZZES: ReadonlySet<number> = new Set([20484, 61999, 391054, 95750]);

/** Leap of Faith and Rescue, both of whose ids the evoker's spell logs. */
const LIFTS: ReadonlySet<number> = new Set([73325, 370665, 420217]);

/**
 * The major personal defensives, as the auras they put on their caster: one
 * cooldown, one aura. Not the generated defensives table, whose top entries
 * this season are Soul Leech, Blood Shield and Elusive Brawler, and not the
 * rotational ones a tank or a rogue presses every pack (Shield Block, Ignore
 * Pain, Feint, Spell Reflection, a mage's barriers).
 *
 * Icebound Fortitude, Anti-Magic Shell, Lichborne, Vampiric Blood, Death Pact;
 * Blur; Barkskin, Survival Instincts; Obsidian Scales; Aspect of the Turtle,
 * Survival of the Fittest; Ice Block, Ice Cold, Alter Time, Mirror Image,
 * Greater Invisibility; Fortifying Brew, Touch of Karma; Divine Shield, both
 * Divine Protections, Shield of Vengeance, Ardent Defender, Guardian of Ancient
 * Kings; Desperate Prayer, Dispersion; Cloak of Shadows, Evasion; Astral
 * Shift; Unending Resolve, Dark Pact; Die by the Sword, Shield Wall, Last
 * Stand. Each read off this season's logs.
 */
const DEFENSIVES: ReadonlySet<number> = new Set([
  48792, 48707, 49039, 55233, 48743, 212800, 22812, 61336, 363916, 186265, 264735, 45438, 414658, 342246, 55342,
  110960, 120954, 122470, 642, 498, 403876, 184662, 31850, 86659, 19236, 47585, 31224, 5277, 108271, 104773, 108416,
  118038, 871, 12975,
]);

/** Divine Shield, Ice Block, Aspect of the Turtle, Cloak of Shadows and Netherwalk, as auras. */
const IMMUNITIES: ReadonlySet<number> = new Set([642, 45438, 186265, 31224, 1255881]);

/** The debuff a Demonic Gateway leaves on whoever went through it. */
const GATEWAY = 113942;

/**
 * Movement abilities, as their casts: Disengage, Fel Rush, Vengeful Retreat,
 * Heroic Leap, Roll, Chi Torpedo, Blink and Shimmer.
 */
const DASHES: ReadonlySet<number> = new Set([781, 195072, 198793, 52174, 109132, 115008, 1953, 212653]);

/** The rows a proc can show up as, firing for whoever it belongs to. */
const PROC_CODES: ReadonlySet<number> = new Set([
  Ev.SPELL_AURA_APPLIED,
  Ev.SPELL_AURA_REFRESH,
  // A proc that stacks, like Sanguine Rancor's fifteen a minute, shows every
  // proc after the first as a dose.
  Ev.SPELL_AURA_APPLIED_DOSE,
  Ev.SPELL_DAMAGE,
  Ev.SPELL_HEAL,
  Ev.SPELL_CAST_SUCCESS,
]);

/**
 * Rows of one proc closer together than this are one proc: the buff and the
 * hit it brings, or one blast landing on five enemies.
 */
const PROC_MS = 500;

/** Applications of one debuff closer together than this are one cast. */
const CAST_MS = 1500;

export function statsReport(context: AnalysisContext, segments: SegmentIndex): StatsReport {
  const { run, interner } = context;
  const { store, actors } = run;
  const ours = (index: number): boolean => index >= 0 && segments.party.has(actors.attribute(index));

  const totemKills: TotemKill[] = [];
  const falls: Fall[] = [];
  /** Player -> their biggest hit's row so far. */
  const biggest = new Map<number, number>();
  /** A unit is finished once; a second line for it would be a second stomp. */
  const finished = new Set<number>();
  /** Enemy debuff id -> the rows that put it on a player. */
  const debuffs = new Map<number, number[]>();

  const enemy = (index: number): boolean => {
    const actor = actors.at(index);
    return (
      actor !== undefined &&
      (actor.kind === ActorKind.CREATURE || actor.kind === ActorKind.VEHICLE) &&
      !actor.everPlayerControlled
    );
  };
  const moment = (row: number, actor: number, spellId: number): Moment => {
    const ts = store.ts[row]!;
    const segmentId = segments.segmentOf(row);
    return {
      ts,
      actorIndex: actor,
      name: actorName(context, actor),
      specId: actors.at(actor)?.specId ?? -1,
      spellId,
      spellName: spellName(context, spellId),
      segmentId: segmentId >= 0 ? segmentId : segmentAt(segments, ts),
    };
  };
  const lusts: Moment[] = [];
  /** Player -> when their Bloodlust last landed on one of the party. */
  const lustLanded = new Map<number, number>();
  /** Player -> their Bloodlust press still waiting for its buff to land. */
  const lustPressed = new Map<number, Moment>();
  const cheats: Moment[] = [];
  const ankhs: Moment[] = [];
  const lockouts: Moment[] = [];
  const reflects: Moment[] = [];
  const taunts: Moment[] = [];
  /** Every Power Infusion cast, with whether it was on the priest themselves. */
  const infusionCasts: Array<{ moment: Moment; self: boolean }> = [];
  const infusions: Assist[] = [];
  const externals: Assist[] = [];
  const rezzes: Assist[] = [];
  const lifts: Assist[] = [];
  const defensives: Moment[] = [];
  const immunities: Moment[] = [];
  const gateways: Moment[] = [];
  const dashes: Moment[] = [];
  const drains: Drain[] = [];
  const assist = (row: number, actor: number, target: number, spellId: number): Assist => ({
    ...moment(row, actor, spellId),
    targetIndex: target,
    targetName: actorName(context, target),
  });

  /** Party member -> their mana percent as last seen. */
  const mana = new Map<number, number>();
  const ends = segments.segments
    .filter((segment) => segment.kind === SegmentKind.PULL || segment.kind === SegmentKind.BOSS)
    .sort((a, b) => a.endTs - b.endTs);
  let nextEnd = 0;
  const closeSegments = (ts: number): void => {
    while (nextEnd < ends.length && ends[nextEnd]!.endTs < ts) {
      const segment = ends[nextEnd++]!;
      for (const [actor, left] of mana) {
        drains.push({
          ts: segment.endTs,
          actorIndex: actor,
          name: actorName(context, actor),
          specId: actors.at(actor)?.specId ?? -1,
          segmentId: segment.id,
          mana: left,
        });
      }
    }
  };

  const tallies = new Map<number, Tally>(
    [...segments.party].map((actorIndex) => [
      actorIndex,
      {
        actorIndex,
        name: actorName(context, actorIndex),
        specId: actors.at(actorIndex)?.specId ?? -1,
        swings: 0,
        debuffs: 0,
        debuffsApplied: 0,
        healingOnOthers: 0,
        overhealingOnOthers: 0,
        padding: 0,
        procs: 0,
        procsExpected: 0,
      },
    ]),
  );
  /**
   * Enemy and player -> how many debuffs that enemy has on them now. An enemy
   * that has marked someone is fixated on them, and its swings say nothing
   * about who has its attention.
   */
  const marks = new Map<number, number>();
  const markKey = (enemyIndex: number, player: number): number => enemyIndex * 1_000_000 + player;
  /** Player and proc spell -> when it last fired and last fell off, and how often it fired. */
  const procs = new Map<number, Map<number, { last: number; removed: number; count: number }>>();
  /**
   * Enemy -> whether it was trash worth no forces. Only asked when a forces
   * table covered the dungeon: without one, every creature would read as worth
   * nothing.
   */
  const paddingKnown = segments.forces.known;
  const worthless = new Map<number, boolean>();
  const isWorthless = (index: number): boolean => {
    let known = worthless.get(index);
    if (known === undefined) {
      const segment = segments.get(segments.enemySegment[index] ?? -1);
      const npcId = actors.at(index)?.npcId ?? -1;
      known =
        segment !== undefined &&
        segment.kind === SegmentKind.PULL &&
        segment.roster.some((group) => group.npcId === npcId && group.forcesEach === 0);
      worthless.set(index, known);
    }
    return known;
  };

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
    const spellId = store.spellId[row]!;

    closeSegments(store.ts[row]!);
    if (store.mana[row]! >= 0) {
      const subject = store.flags[row]! & EvFlag.INFO_IS_SOURCE ? src : dst;
      if (segments.party.has(subject)) mana.set(subject, store.mana[row]!);
    }

    const removal = code === Ev.SPELL_AURA_REMOVED || code === Ev.SPELL_AURA_REMOVED_DOSE;
    if ((PROC_CODES.has(code) || removal) && ours(src)) {
      const actor = actors.attribute(src);
      const owner = actors.at(actor);
      if (owner !== undefined && procsPerMinute(spellId, owner.classId, owner.specId) > 0) {
        let mine = procs.get(actor);
        if (mine === undefined) procs.set(actor, (mine = new Map()));
        const seen = mine.get(spellId);
        const ts = store.ts[row]!;
        if (removal) {
          if (seen !== undefined) seen.removed = ts;
        } else if (seen === undefined) {
          mine.set(spellId, { last: ts, removed: -1, count: 1 });
        } else if (ts !== seen.removed) {
          // Anything in the same millisecond as a removal is a hand-over, not a
          // proc: when one of Focus of Ula'tek's overlapping applications runs
          // out, the game takes the aura (or a dose of it) off and puts the rest
          // straight back as an application or a refresh. Counting those read a
          // Blood death knight 1.6 times lucky in three keys running.
          if (ts - seen.last >= PROC_MS) seen.count++;
          seen.last = ts;
        }
      }
    }

    if (code === Ev.SPELL_CAST_SUCCESS) {
      if (!ours(src)) continue;
      const actor = actors.attribute(src);
      if (LUSTS.has(spellId)) {
        const pressed = moment(row, actor, spellId);
        if (pressed.ts - (lustLanded.get(actor) ?? -Infinity) <= LUST_LANDS_MS) lusts.push(pressed);
        else lustPressed.set(actor, pressed);
      }
      else if (spellId === ANKH) ankhs.push(moment(row, actor, spellId));
      else if (TAUNTS.has(spellId)) taunts.push(moment(row, actor, spellId));
      else if (DASHES.has(spellId)) dashes.push(moment(row, actor, spellId));
      else if (spellId === POWER_INFUSION) {
        infusionCasts.push({ moment: moment(row, actor, spellId), self: dst === src });
        if (dst !== src && segments.party.has(dst)) infusions.push(assist(row, actor, dst, spellId));
      }
      else if (segments.party.has(dst) && dst !== actor) {
        if (EXTERNALS.has(spellId)) externals.push(assist(row, actor, dst, spellId));
        else if (LIFTS.has(spellId)) lifts.push(assist(row, actor, dst, spellId));
      }
      continue;
    }
    if (code === Ev.SPELL_RESURRECT) {
      if (REZZES.has(spellId) && ours(src) && segments.party.has(dst)) rezzes.push(assist(row, actors.attribute(src), dst, spellId));
      continue;
    }
    if (code === Ev.SPELL_INTERRUPT) {
      if (segments.party.has(dst) && enemy(src)) lockouts.push(moment(row, dst, store.extraSpellId[row]!));
      continue;
    }
    if (code === Ev.SPELL_MISSED) {
      if (store.flags[row]! & EvFlag.REFLECTED && segments.party.has(dst) && enemy(src)) {
        reflects.push(moment(row, dst, spellId));
      }
      continue;
    }
    if (code === Ev.SPELL_AURA_REMOVED) {
      if (IMMUNITIES.has(spellId) && src === dst && segments.party.has(dst)) immunities.push(moment(row, dst, spellId));
      if (store.flags[row]! & EvFlag.BUFF || !segments.party.has(dst) || !enemy(src)) continue;
      const key = markKey(src, dst);
      const left = (marks.get(key) ?? 0) - 1;
      if (left > 0) marks.set(key, left);
      else marks.delete(key);
      continue;
    }
    if (code === Ev.SPELL_AURA_APPLIED) {
      if (!(store.flags[row]! & EvFlag.BUFF) && ours(src) && enemy(dst)) tallies.get(actors.attribute(src))!.debuffsApplied++;
      if (!segments.party.has(dst)) continue;
      if (LUSTS.has(spellId) && ours(src)) {
        const actor = actors.attribute(src);
        const ts = store.ts[row]!;
        lustLanded.set(actor, ts);
        const pressed = lustPressed.get(actor);
        if (pressed !== undefined) {
          lustPressed.delete(actor);
          if (ts - pressed.ts <= LUST_LANDS_MS) lusts.push(pressed);
        }
      }
      if (CHEAT_AURAS.has(spellId)) cheats.push(moment(row, dst, spellId));
      if (DEFENSIVES.has(spellId) && src === dst) defensives.push(moment(row, dst, spellId));
      if (spellId === GATEWAY) gateways.push(moment(row, dst, spellId));
      if (store.flags[row]! & EvFlag.BUFF || !enemy(src)) continue;
      const key = markKey(src, dst);
      marks.set(key, (marks.get(key) ?? 0) + 1);
      tallies.get(dst)!.debuffs++;
      // The random-pick reading has always been of creatures only.
      if (actors.at(src)!.kind !== ActorKind.CREATURE) continue;
      const rows = debuffs.get(spellId);
      if (rows === undefined) debuffs.set(spellId, [row]);
      else rows.push(row);
      continue;
    }
    if (code === Ev.SWING_DAMAGE_LANDED) {
      if (segments.party.has(dst) && enemy(src) && !marks.has(markKey(src, dst))) tallies.get(dst)!.swings++;
      continue;
    }
    if (HEAL_CODES.has(code)) {
      if (!ours(src) || !segments.party.has(dst)) continue;
      const actor = actors.attribute(src);
      if (CHEAT_HEALS.has(spellId)) cheats.push(moment(row, dst, spellId));
      if (actor === dst) continue;
      const tally = tallies.get(actor)!;
      tally.healingOnOthers += store.amount[row]!;
      tally.overhealingOnOthers += wasted(store.waste[row]!);
      continue;
    }
    if (code === Ev.ENVIRONMENTAL_DAMAGE) {
      if (store.extraSpellId[row] !== Environment.FALLING || !segments.party.has(dst)) continue;
      const ts = store.ts[row]!;
      const waste = store.waste[row]!;
      falls.push({
        ts,
        actorIndex: dst,
        name: actorName(context, dst),
        specId: actors.at(dst)?.specId ?? -1,
        amount: effective(store.amount[row]!, waste),
        fatal: waste > 0,
        segmentId: segmentAt(segments, ts),
      });
      continue;
    }
    if (DAMAGE_CODES.has(code) && code !== Ev.DAMAGE_SPLIT) {
      // A _SUPPORT row is a share of a hit already counted on its own line.
      if (store.flags[row]! & EvFlag.SUPPORT) continue;
      if (!ours(src) || dst < 0 || ours(dst)) continue;
      const actor = actors.attribute(src);
      const best = biggest.get(actor);
      if (best === undefined || store.amount[row]! > store.amount[best]!) biggest.set(actor, row);
      if (paddingKnown && isWorthless(dst)) tallies.get(actor)!.padding += effective(store.amount[row]!, store.waste[row]!);
      continue;
    }
    if (code !== Ev.PARTY_KILL) continue;
    if (!ours(src) || dst < 0 || ours(dst) || finished.has(dst)) continue;
    const target = actors.at(dst);
    if (target === undefined || target.kind !== ActorKind.CREATURE || target.everPlayerControlled) continue;
    const totemName = interner.resolve(target.nameId);
    if (!TOTEM.test(totemName)) continue;
    finished.add(dst);

    const ts = store.ts[row]!;
    const actor = actors.attribute(src);
    const segmentId = segments.segmentOf(row);
    totemKills.push({
      ts,
      actorIndex: actor,
      name: actorName(context, actor),
      specId: actors.at(actor)?.specId ?? -1,
      petName: actor === src ? '' : actorName(context, src),
      totemIndex: dst,
      totemName,
      segmentId: segmentId >= 0 ? segmentId : segmentAt(segments, ts),
    });
  }

  closeSegments(Infinity);

  // Twins of the Sun Priestess logs its copy as a cast on the priest, right
  // beside the one on whoever they chose. Only a self-cast with no such
  // partner is a priest keeping Power Infusion for themselves.
  const selfInfusions = infusionCasts
    .filter(
      ({ moment: mine, self }) =>
        self &&
        !infusionCasts.some(
          (other) => !other.self && other.moment.actorIndex === mine.actorIndex && Math.abs(other.moment.ts - mine.ts) <= TWINS_MS,
        ),
    )
    .map(({ moment: mine }) => mine);

  const biggestHits: BigHit[] = [...biggest].map(([actor, row]) => {
    const ts = store.ts[row]!;
    const spellId = store.spellId[row]!;
    const segmentId = segments.segmentOf(row);
    return {
      ts,
      actorIndex: actor,
      name: actorName(context, actor),
      specId: actors.at(actor)?.specId ?? -1,
      amount: store.amount[row]!,
      spellId,
      spellName: spellName(context, spellId),
      targetName: actorName(context, store.dstActor[row]!),
      segmentId: segmentId >= 0 ? segmentId : segmentAt(segments, ts),
    };
  });

  const picks: Pick[] = [];
  for (const [spellId, rows] of debuffs) {
    if (avoidable(spellId) !== undefined) continue;
    const casts: number[][] = [];
    for (const row of rows) {
      const last = casts.at(-1);
      if (last !== undefined && store.ts[row]! - store.ts[last.at(-1)!]! < CAST_MS) last.push(row);
      else casts.push([row]);
    }
    const lone = casts.filter((cast) => new Set(cast.map((row) => store.dstActor[row]!)).size === 1);
    const targets = new Set(lone.map((cast) => store.dstActor[cast[0]!]!));
    const onTank = lone.filter((cast) => TANK_SPECS.has(actors.at(store.dstActor[cast[0]!]!)?.specId ?? -1)).length;
    if (casts.length < 3 || lone.length < casts.length * 0.9 || targets.size < 3 || onTank > lone.length * 0.4) continue;
    for (const [row] of lone) picks.push(moment(row!, store.dstActor[row!]!, spellId));
  }
  picks.sort((a, b) => a.ts - b.ts);

  // A proc is expected at its rate for the whole key, for everyone who was
  // seen to have it. Not for anyone who never procced it once: nothing in the
  // log says they carried it.
  const minutes = elapsedMs(run) / 60_000;
  for (const [actor, mine] of procs) {
    const tally = tallies.get(actor)!;
    const owner = actors.at(actor)!;
    for (const [spellId, seen] of mine) {
      tally.procs += seen.count;
      tally.procsExpected += procsPerMinute(spellId, owner.classId, owner.specId) * minutes;
    }
  }

  return {
    totemKills,
    falls,
    biggestHits,
    picks,
    lusts,
    cheats,
    ankhs,
    lockouts,
    reflects,
    taunts,
    selfInfusions,
    infusions,
    externals,
    rezzes,
    lifts,
    defensives,
    immunities,
    gateways,
    dashes,
    drains,
    tallies: [...tallies.values()],
    paddingKnown,
  };
}

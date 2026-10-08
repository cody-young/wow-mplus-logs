import { avoidable } from '@mplus/data';
import { ActorKind, Environment, Ev, EvFlag } from '@mplus/parser';

import { actorName, spellName, type AnalysisContext } from './context.js';
import { DAMAGE_CODES, effective } from './events.js';
import { segmentAt, type SegmentIndex } from './segments.js';

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

/** One time an enemy's mechanic picked a player out. */
export interface Pick {
  /** Store-relative ms. */
  ts: number;
  actorIndex: number;
  name: string;
  specId: number;
  spellId: number;
  spellName: string;
  segmentId: number;
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
}

const TOTEM = / Totem$/;

const TANK_SPECS: ReadonlySet<number> = new Set([250, 581, 104, 268, 66, 73]);

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

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    if (code === Ev.SPELL_AURA_APPLIED) {
      if (store.flags[row]! & EvFlag.BUFF || !segments.party.has(store.dstActor[row]!)) continue;
      const source = actors.at(store.srcActor[row]!);
      if (source === undefined || source.kind !== ActorKind.CREATURE || source.everPlayerControlled) continue;
      const spellId = store.spellId[row]!;
      const rows = debuffs.get(spellId);
      if (rows === undefined) debuffs.set(spellId, [row]);
      else rows.push(row);
      continue;
    }
    if (code === Ev.ENVIRONMENTAL_DAMAGE) {
      const dst = store.dstActor[row]!;
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
      const src = store.srcActor[row]!;
      const dst = store.dstActor[row]!;
      if (!ours(src) || dst < 0 || ours(dst)) continue;
      const actor = actors.attribute(src);
      const best = biggest.get(actor);
      if (best === undefined || store.amount[row]! > store.amount[best]!) biggest.set(actor, row);
      continue;
    }
    if (code !== Ev.PARTY_KILL) continue;
    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
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
    for (const [row] of lone) {
      const ts = store.ts[row!]!;
      const actor = store.dstActor[row!]!;
      const segmentId = segments.segmentOf(row!);
      picks.push({
        ts,
        actorIndex: actor,
        name: actorName(context, actor),
        specId: actors.at(actor)?.specId ?? -1,
        spellId,
        spellName: spellName(context, spellId),
        segmentId: segmentId >= 0 ? segmentId : segmentAt(segments, ts),
      });
    }
  }
  picks.sort((a, b) => a.ts - b.ts);

  return { totemKills, falls, biggestHits, picks };
}

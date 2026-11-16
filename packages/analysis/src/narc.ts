import {
  HEALTH_POTION_MS,
  HEALTHSTONE_CHARGES,
  HEALTHSTONE_MS,
  defensiveClock,
  isHealthPotion,
  isHealthstone,
} from '@mplus/data';
import { Ev } from '@mplus/parser';

import { spellName, type AnalysisContext } from './context.js';
import type { SegmentIndex } from './segments.js';

/**
 * What a player still had when they died: the narc.
 *
 * The recap already says what they pressed. This says what they did not —
 * a healthstone in the bag, a potion off cooldown, a Shield Wall that had
 * been sitting there for three minutes. The log never says "ready"; it says
 * when each was last used, and the game's data says how long each takes to
 * come back (see `@mplus/data/cooldowns`).
 *
 * Every "ready" is meant to be certain, because it is said about a person.
 * So the clocks are base clocks, which talents only shorten; a defensive is
 * only theirs once they have been seen using it somewhere in the run, since
 * the log names no talents; and a healthstone is only on offer when there
 * was a warlock to hand them out. What is uncertain goes unsaid rather than
 * guessed — a cooldown the base clock calls not back yet may well have been.
 */

export type Readiness =
  /** Off cooldown and unused: the narc. */
  | 'ready'
  /** Used in the death window — they did reach for it. */
  | 'pressed'
  /** Used earlier and not back yet, as far as the base clock knows. */
  | 'cooldown'
  /** A healthstone with every charge spent, and no Soulwell since. */
  | 'empty';

export interface ConsumableState {
  state: Readiness;
  /** Store-relative ms of the last use before the death, or null for none. */
  lastUsedTs: number | null;
}

export interface DefensiveState {
  /** The aura's id, the one the log names. */
  spellId: number;
  name: string;
  state: Exclude<Readiness, 'empty'>;
  lastUsedTs: number | null;
}

export interface DeathNarc {
  /** Null when nobody in the group could have handed them one. */
  healthstone: ConsumableState | null;
  potion: ConsumableState;
  /** Their own big defensives, ready ones first. */
  defensives: DefensiveState[];
}

/**
 * Affliction, Demonology, Destruction: the one class that hands out
 * healthstones. By spec, because COMBATANT_INFO carries no class id.
 */
const WARLOCK_SPECS = new Set([265, 266, 267]);
const CREATE_SOULWELL = 29893;
const CREATE_HEALTHSTONE = 6201;

/**
 * Big defensives that cannot be put on yourself.
 *
 * A paladin who died with Blessing of Sacrifice ready had nothing to press:
 * it moves someone else's damage onto them. Listed rather than read from the
 * data's External Defensive flag, which also covers Pain Suppression and
 * Ironbark — both of which a healer can cast on themselves.
 */
const OTHERS_ONLY = new Set([
  6940, // Blessing of Sacrifice
  199448, // Blessing of Sacrifice, the ultimate sacrifice version
  53480, // Roar of Sacrifice
  357170, // Time Dilation
]);

/**
 * Two applications of one defensive this close together are one press.
 * Rallying Cry lands on five people at once; Anti-Magic Shell logs two auras.
 */
const SAME_PRESS_MS = 2_000;

interface PlayerLedger {
  potions: number[];
  stones: number[];
  /** Times their own healthstone stock could have been refilled. */
  refills: number[];
  /** Uses by aura id, oldest first. */
  defensives: Map<number, number[]>;
}

export interface NarcLedger {
  players: Map<number, PlayerLedger>;
  /** A warlock was in the party, so there were healthstones to take. */
  warlock: boolean;
}

/** One pass over the run: every use of anything the narc asks about. */
export function narcLedger(context: AnalysisContext, segments: SegmentIndex): NarcLedger {
  const { store, actors } = context.run;
  const players = new Map<number, PlayerLedger>();
  const ledger = (index: number): PlayerLedger => {
    let entry = players.get(index);
    if (entry === undefined) {
      entry = { potions: [], stones: [], refills: [], defensives: new Map() };
      players.set(index, entry);
    }
    return entry;
  };
  let warlock = false;
  for (const index of segments.party) if (WARLOCK_SPECS.has(actors.at(index)?.specId ?? -1)) warlock = true;
  const soulwells: number[] = [];

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    const cast = code === Ev.SPELL_CAST_SUCCESS;
    if (!cast && code !== Ev.SPELL_AURA_APPLIED) continue;
    const spellId = store.spellId[row]!;
    const ts = store.ts[row]!;
    if (cast) {
      const src = store.srcActor[row]!;
      if (spellId === CREATE_SOULWELL) {
        soulwells.push(ts);
        warlock = true;
        continue;
      }
      if (!segments.party.has(src)) continue;
      if (isHealthPotion(spellId)) ledger(src).potions.push(ts);
      else if (isHealthstone(spellId)) ledger(src).stones.push(ts);
      else if (spellId === CREATE_HEALTHSTONE) ledger(src).refills.push(ts);
      continue;
    }
    // A defensive is read off its aura, which the log writes for every one of
    // them and sometimes ahead of the cast. Whoever put it up spent it, on
    // themselves or not: a Rallying Cry is the warrior's whichever five it lands on.
    const clock = defensiveClock(spellId);
    if (clock === null) continue;
    const owner = actors.attribute(store.srcActor[row]!);
    if (!segments.party.has(owner)) continue;
    const uses = ledger(owner).defensives;
    let list = uses.get(spellId);
    if (list === undefined) {
      list = [];
      uses.set(spellId, list);
    }
    if (list.length > 0 && ts - list[list.length - 1]! < SAME_PRESS_MS) continue;
    list.push(ts);
  }

  // A Soulwell restocks everyone, whoever put it down.
  for (const entry of players.values()) {
    entry.refills.push(...soulwells);
    entry.refills.sort((a, b) => a - b);
  }
  return { players, warlock };
}

/** What `victim` still had when they died at `deathTs`. */
export function narcAt(
  context: AnalysisContext,
  ledger: NarcLedger,
  victim: number,
  deathTs: number,
  windowMs: number,
): DeathNarc {
  const entry = ledger.players.get(victim);
  const since = deathTs - windowMs;

  const potions = (entry?.potions ?? []).filter((ts) => ts <= deathTs);
  const potion = consumable(potions, HEALTH_POTION_MS, deathTs, since);

  const stones = entry?.stones ?? [];
  let healthstone: ConsumableState | null = null;
  if (ledger.warlock || stones.length > 0) {
    const used = stones.filter((ts) => ts <= deathTs);
    healthstone = consumable(used, HEALTHSTONE_MS, deathTs, since);
    if (healthstone.state === 'ready' && chargesLeft(used, entry?.refills ?? [], deathTs) === 0) {
      healthstone = { state: 'empty', lastUsedTs: healthstone.lastUsedTs };
    }
  }

  // One entry a name: Guardian of Ancient Kings and Anti-Magic Shell each log
  // two aura ids for one button. Whichever says most about the button wins:
  // pressed in the window, then on cooldown, and ready only if every id is.
  const byName = new Map<string, DefensiveState>();
  for (const [spellId, uses] of entry?.defensives ?? []) {
    if (OTHERS_ONLY.has(spellId)) continue;
    const clock = defensiveClock(spellId)!;
    const before = uses.filter((ts) => ts <= deathTs);
    const lastUsedTs = before.length > 0 ? before[before.length - 1]! : null;
    let state: DefensiveState['state'];
    if (lastUsedTs !== null && lastUsedTs >= since) state = 'pressed';
    else state = readyAt(before, clock.ms, clock.charges, deathTs) ? 'ready' : 'cooldown';
    const name = spellName(context, spellId);
    const known = byName.get(name);
    if (known === undefined || weight(state) > weight(known.state)) {
      byName.set(name, { spellId, name, state, lastUsedTs });
    }
  }
  const defensives = [...byName.values()].sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name));

  return { healthstone, potion, defensives };
}

function consumable(used: number[], cooldownMs: number, deathTs: number, since: number): ConsumableState {
  const lastUsedTs = used.length > 0 ? used[used.length - 1]! : null;
  if (lastUsedTs === null) return { state: 'ready', lastUsedTs };
  if (lastUsedTs >= since) return { state: 'pressed', lastUsedTs };
  return { state: deathTs - lastUsedTs >= cooldownMs ? 'ready' : 'cooldown', lastUsedTs };
}

/**
 * Charges left in their healthstone at `at`.
 *
 * They start the key holding one — it is the first thing anyone does at the
 * Soulwell — and a healthstone is unique, so a new one can only be taken once
 * the old is used up. A use with nothing left means they took one somewhere
 * the log did not show, which is the only way it could have happened.
 */
function chargesLeft(uses: number[], refills: number[], at: number): number {
  let charges = HEALTHSTONE_CHARGES;
  let next = 0;
  for (const ts of uses) {
    while (next < refills.length && refills[next]! <= ts) {
      if (charges === 0) charges = HEALTHSTONE_CHARGES;
      next++;
    }
    charges = charges === 0 ? HEALTHSTONE_CHARGES - 1 : charges - 1;
  }
  while (next < refills.length && refills[next]! <= at) {
    if (charges === 0) charges = HEALTHSTONE_CHARGES;
    next++;
  }
  return charges;
}

/** Whether a charge of a spell on `ms` with `charges` was back at `at`. */
function readyAt(uses: number[], ms: number, charges: number, at: number): boolean {
  let spent = 0;
  // When the charge currently recovering started; charges recover one at a time.
  let from = 0;
  const recover = (until: number): void => {
    while (spent > 0 && from + ms <= until) {
      spent--;
      from += ms;
    }
  };
  for (const ts of uses) {
    recover(ts);
    if (spent === 0) from = ts;
    spent++;
  }
  recover(at);
  return spent < charges;
}

/** Which of two aura ids for one button says more about it. */
function weight(state: Readiness): number {
  return state === 'pressed' ? 2 : state === 'cooldown' ? 1 : 0;
}

/** Ready first, it being the point; then what they pressed; then the rest. */
function rank(state: Readiness): number {
  return state === 'ready' ? 0 : state === 'pressed' ? 1 : 2;
}

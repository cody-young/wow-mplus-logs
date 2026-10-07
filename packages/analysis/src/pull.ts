import { ActorKind, EvFlag, Ev, type EventStore } from '@mplus/parser';

import { spellName, type AnalysisContext } from './context.js';
import { DAMAGE_CODES, MISS_CODES } from './events.js';

/**
 * Who pulled a raid boss.
 *
 * ENCOUNTER_START is logged the moment the boss takes aggro, and the hit that
 * gave it aggro is logged a few milliseconds after it, in the same instant. So
 * the puller is whoever's hit, miss or debuff lands on an encounter enemy
 * first, give or take a second either side of the START — and that answer
 * needs the run's `prePull` store, because a projectile is cast well before it
 * lands: a tank's Heroic Throw left their hands 0.9s before the START it set
 * off, and on another pull five players had fired before it landed.
 *
 * What lands far ahead of the START is a spell that does not pull. Hunter's
 * Mark goes on the boss half a minute early and the boss does not stir, so
 * only the second before the START is searched.
 *
 * A boss that acts first — a hit or a debuff on a player before any player
 * touched it — was body pulled by whoever it acted on.
 *
 * And some pulls have no contact at all. On a Mythic Twin Fangs pull the START
 * came 3.4s before anyone touched either boss, with the raid still putting up
 * Battle Shout: someone walked into aggro range, which the log does not
 * record. What it does record is what was summoned just before, and where
 * everyone was standing. Those pulls were a Surging Totem: a shaman put it
 * down 1.8s before the START each time, and a totem in aggro range pulls the
 * boss without a line in the log to say so. So a pull nothing touched names
 * what the raid summoned in the seconds before it, then who stood nearest —
 * both guesses, and labelled as such.
 */

/** How long before the START a landing is still taken to be what pulled. */
const LANDED_BEFORE_MS = 1_000;
/**
 * How long after the START a landing can still be what pulled. A pull's own hit
 * is logged within a few dozen ms of its START; a first touch later than this
 * came after something else had already pulled.
 */
const PULLED_BY_MS = 300;
/** How long after the START players' first contacts are still listed. */
const LISTED_UNTIL_MS = 5_000;
/** How long before the START a standing position still counts. */
const STOOD_BEFORE_MS = 5_000;
/** How long before an untouched START a summon is offered as its cause. */
const SUMMONED_BEFORE_MS = 3_000;
/** At most this many players are offered as having walked in. */
const MAX_NEAREST = 3;
/** Enemies the party fights in this much of the pull are the encounter's. */
const ENCOUNTER_ENEMY_MS = 10_000;
/**
 * Two players landing this close are too close to call. Two landings 2ms apart
 * are one server tick, and the log's order within it is not a verdict.
 */
export const PULL_CLOSE_MS = 250;
/** How far back to look for the cast that sent a landing hit. */
const CAST_LOOKBACK_MS = 5_000;
/** At most this many players' first contacts are listed. */
const MAX_CONTACTS = 8;

/** Debuffs that go on the boss before the pull and do not pull it. */
const NO_AGGRO: ReadonlySet<number> = new Set([
  257284, // Hunter's Mark
]);

/**
 * Casts that hand the threat of whoever makes contact to someone else: a pull
 * made through one is the intended pull, whoever's name is on the hit.
 */
const REDIRECTS: ReadonlySet<number> = new Set([
  34477, // Misdirection
  57934, // Tricks of the Trade
]);

const TANK_SPECS: ReadonlySet<number> = new Set([250, 581, 104, 268, 66, 73]);

export type PullContactKind = 'hit' | 'debuff' | 'body';

export interface PullContact {
  /** The player credited: a pet's or guardian's owner. */
  actor: number;
  /** The unit that made the contact, when it was not the player: a pet. Else -1. */
  via: number;
  /** The encounter enemy contacted. */
  enemy: number;
  /** The landing spell, 0 for melee. For a body pull, the boss's own. */
  spellId: number;
  spellName: string;
  /** Ms from ENCOUNTER_START; negative is before it. */
  ts: number;
  /**
   * When the button was pressed, when the log shows it: the cast's start for a
   * cast-time spell, else its success. Null when no matching cast was found —
   * melee, a pet, or a spell whose cast logs under another id.
   */
  castTs: number | null;
  kind: PullContactKind;
}

export interface PullRedirect {
  spellId: number;
  spellName: string;
  /** The player who cast it, who is also the one credited with the pull. */
  caster: number;
  /** Whose threat the pull went to. */
  onto: number;
  /** Ms from ENCOUNTER_START. */
  ts: number;
}

/** A player standing near the boss when a pull started with no contact. */
export interface PullNearest {
  actor: number;
  enemy: number;
  /** Yards from that enemy, at the positions last logged before the START. */
  distance: number;
}

/** Something a player summoned just before a pull nothing touched. */
export interface PullSummon {
  /** The player credited. */
  actor: number;
  /** The summoned unit: a totem, a guardian. */
  unit: number;
  spellId: number;
  spellName: string;
  /** Ms from ENCOUNTER_START, so always negative. */
  ts: number;
  /**
   * A totem, put down where it was aimed rather than at its owner's side.
   * That is what can pull from range: a mage's Mirror Images stand with the
   * mage, so they reach the boss only if the mage would have anyway.
   */
  placed: boolean;
}

export interface PullReport {
  /** The contact that pulled, or null when nothing touched the boss near the START. */
  first: PullContact | null;
  /**
   * Each player's first contact from just before the START to a few seconds
   * after it, earliest first. Listed even when `first` is null, as who got
   * there first once the fight was on.
   */
  contacts: PullContact[];
  /**
   * When `first` is null: who stood nearest the encounter's enemies at the
   * START, nearest first — the likely walk-in. Empty otherwise, and when the
   * log has no positions.
   */
  nearest: PullNearest[];
  /**
   * When `first` is null: what the raid summoned in the seconds before the
   * START, totems first, then latest first. A totem dropped in range pulls
   * with no line logged.
   */
  summons: PullSummon[];
  /** The puller cast Misdirection or Tricks onto someone before pulling. */
  redirect: PullRedirect | null;
  /** The puller plays a tank spec. */
  tank: boolean;
  /**
   * `clear` when nobody else landed within PULL_CLOSE_MS; `close` when someone
   * did; `unclear` when nothing landed near the START, or the log has nothing
   * from before it to say what was already in flight. A walk-in is always
   * `unclear`: `nearest` is where people stood, not proof of who stepped in.
   */
  confidence: 'clear' | 'close' | 'unclear';
}

export function whoPulled(context: AnalysisContext): PullReport | null {
  const { run } = context;
  if (run.meta.kind !== 'raid') return null;
  const { actors } = run;
  const party = new Set(run.meta.party);

  const isEnemy = (index: number): boolean => {
    const actor = actors.at(index);
    return (
      actor !== undefined &&
      !actor.everPlayerControlled &&
      (actor.kind === ActorKind.CREATURE || actor.kind === ActorKind.VEHICLE)
    );
  };
  const playerOf = (index: number): number => {
    const owner = actors.attribute(index);
    return party.has(owner) ? owner : -1;
  };

  // The encounter's enemies: what the party and it trade blows with early on.
  const enemies = new Set<number>();
  const { store } = run;
  for (let row = 0; row < store.count && store.ts[row]! <= ENCOUNTER_ENEMY_MS; row++) {
    const code = store.code[row]!;
    if (!DAMAGE_CODES.has(code)) continue;
    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
    if (playerOf(src) !== -1 && isEnemy(dst)) enemies.add(dst);
    else if (isEnemy(src) && playerOf(dst) !== -1) enemies.add(src);
  }

  const contacts: PullContact[] = [];
  const seen = new Set<number>();
  const scan = (source: EventStore, from: number, to: number): void => {
    for (let row = source.seek(from); row < source.count && source.ts[row]! <= to; row++) {
      const contact = contactAt(source, row);
      if (contact === null || seen.has(contact.actor)) continue;
      seen.add(contact.actor);
      contacts.push(contact);
    }
  };
  const contactAt = (source: EventStore, row: number): PullContact | null => {
    const code = source.code[row]!;
    const flags = source.flags[row]!;
    if ((flags & EvFlag.SUPPORT_TWIN) !== 0) return null;
    const landed = DAMAGE_CODES.has(code) || MISS_CODES.has(code);
    const debuff =
      code === Ev.SPELL_AURA_APPLIED && (flags & EvFlag.BUFF) === 0 && !NO_AGGRO.has(source.spellId[row]!);
    if (!landed && !debuff) return null;
    const src = source.srcActor[row]!;
    const dst = source.dstActor[row]!;
    const ts = source.baseMs + source.ts[row]! - store.baseMs;
    if (enemies.has(dst)) {
      const player = playerOf(src);
      if (player === -1) return null;
      return {
        actor: player,
        via: player === src ? -1 : src,
        enemy: dst,
        spellId: source.spellId[row]!,
        spellName: spellName(context, source.spellId[row]!),
        ts,
        castTs: null,
        kind: landed ? 'hit' : 'debuff',
      };
    }
    if (enemies.has(src)) {
      const player = playerOf(dst);
      // The player's own pet being hit is them being found, too.
      if (player === -1) return null;
      return { actor: player, via: -1, enemy: src, spellId: source.spellId[row]!, spellName: spellName(context, source.spellId[row]!), ts, castTs: null, kind: 'body' };
    }
    return null;
  };

  const prePull = run.prePull;
  if (prePull !== null) scan(prePull, -LANDED_BEFORE_MS, -1);
  scan(store, 0, LISTED_UNTIL_MS);
  contacts.splice(MAX_CONTACTS);

  for (const contact of contacts) {
    if (contact.kind !== 'body' && contact.via === -1 && contact.spellId !== 0) {
      contact.castTs = castTime(run.store, prePull, contact.actor, contact.spellId, contact.ts);
    }
  }

  const earliest = contacts[0];
  const first = earliest !== undefined && earliest.ts <= PULLED_BY_MS ? earliest : null;
  const nearest = first === null ? standingNearest(run.store, prePull, enemies, party) : [];
  const summons: PullSummon[] = [];
  if (first === null && prePull !== null) {
    for (let row = prePull.seek(-SUMMONED_BEFORE_MS); row < prePull.count; row++) {
      if (prePull.code[row] !== Ev.SPELL_SUMMON) continue;
      const player = playerOf(prePull.srcActor[row]!);
      if (player === -1) continue;
      const spellId = prePull.spellId[row]!;
      const unit = actors.at(prePull.dstActor[row]!);
      // One per player and spell: a Mirror Image is three summons at once.
      const again = summons.findIndex((summon) => summon.actor === player && summon.spellId === spellId);
      if (again !== -1) summons.splice(again, 1);
      summons.unshift({
        actor: player,
        unit: prePull.dstActor[row]!,
        spellId,
        spellName: spellName(context, spellId),
        ts: prePull.ts[row]!,
        // By name: the log has no flag for a totem, and every one is called one.
        placed: unit !== undefined && context.interner.resolve(unit.nameId).includes('Totem'),
      });
    }
    summons.sort((a, b) => Number(b.placed) - Number(a.placed));
  }
  const found = first === null || prePull === null ? null : findRedirect(prePull, first);
  const redirect = found === null ? null : { ...found, spellName: spellName(context, found.spellId) };
  const tank = first !== null && TANK_SPECS.has(actors.at(first.actor)?.specId ?? -1);
  const second = first === null ? undefined : contacts[1];
  const confidence =
    first === null || prePull === null
      ? 'unclear'
      : second !== undefined && second.ts - first.ts <= PULL_CLOSE_MS
        ? 'close'
        : 'clear';
  return { first, contacts, nearest, summons, redirect, tank, confidence };
}

/**
 * When the button behind a landing was pressed: the player's latest cast of
 * that spell at or before the landing, and that cast's start if it had one.
 */
function castTime(store: EventStore, prePull: EventStore | null, actor: number, spellId: number, landedTs: number): number | null {
  let success: number | null = null;
  let start: number | null = null;
  const look = (source: EventStore): void => {
    const from = source.seek(landedTs - CAST_LOOKBACK_MS + store.baseMs - source.baseMs);
    for (let row = from; row < source.count; row++) {
      const ts = source.baseMs + source.ts[row]! - store.baseMs;
      if (ts > landedTs) break;
      if (source.srcActor[row] !== actor || source.spellId[row] !== spellId) continue;
      const code = source.code[row]!;
      if (code === Ev.SPELL_CAST_START) start = ts;
      else if (code === Ev.SPELL_CAST_SUCCESS) success = ts;
    }
  };
  if (prePull !== null) look(prePull);
  look(store);
  if (success === null) return null;
  // A start belongs to this success only if it came before it.
  return start !== null && start <= success ? start : success;
}

function findRedirect(prePull: EventStore, first: PullContact): Omit<PullRedirect, 'spellName'> | null {
  let found: Omit<PullRedirect, 'spellName'> | null = null;
  for (let row = 0; row < prePull.count; row++) {
    if (prePull.code[row] !== Ev.SPELL_CAST_SUCCESS || prePull.srcActor[row] !== first.actor) continue;
    const spellId = prePull.spellId[row]!;
    if (!REDIRECTS.has(spellId)) continue;
    found = { spellId, caster: first.actor, onto: prePull.dstActor[row]!, ts: prePull.ts[row]! };
  }
  return found;
}

/**
 * Who stood nearest the encounter's enemies at the START.
 *
 * A player's spot is the last position logged for them in the seconds before
 * it. An enemy's is the one logged nearest the START on either side, because a
 * boss standing idle logs nothing, and its first rows after the START are
 * still close to where it stood — it has only just turned.
 */
function standingNearest(
  store: EventStore,
  prePull: EventStore | null,
  enemies: ReadonlySet<number>,
  party: ReadonlySet<number>,
): PullNearest[] {
  interface Spot { x: number; y: number; map: number; ts: number }
  const players = new Map<number, Spot>();
  const foes = new Map<number, Spot>();
  const visit = (source: EventStore, from: number, to: number): void => {
    for (let row = source.seek(from + store.baseMs - source.baseMs); row < source.count; row++) {
      const ts = source.baseMs + source.ts[row]! - store.baseMs;
      if (ts > to) break;
      const map = source.uiMapId[row]!;
      if (map === 0) continue;
      const subject = (source.flags[row]! & EvFlag.INFO_IS_SOURCE) !== 0 ? source.srcActor[row]! : source.dstActor[row]!;
      const spot = { x: source.posX[row]!, y: source.posY[row]!, map, ts };
      if (party.has(subject) && ts <= 0) players.set(subject, spot);
      else if (enemies.has(subject)) {
        const known = foes.get(subject);
        if (known === undefined || Math.abs(ts) < Math.abs(known.ts)) foes.set(subject, spot);
      }
    }
  };
  if (prePull !== null) visit(prePull, -STOOD_BEFORE_MS, -1);
  visit(store, 0, LISTED_UNTIL_MS);

  const out: PullNearest[] = [];
  for (const [actor, at] of players) {
    let best: PullNearest | null = null;
    for (const [enemy, foe] of foes) {
      if (foe.map !== at.map) continue;
      const distance = Math.hypot(foe.x - at.x, foe.y - at.y);
      if (best === null || distance < best.distance) best = { actor, enemy, distance };
    }
    if (best !== null) out.push(best);
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, MAX_NEAREST);
}

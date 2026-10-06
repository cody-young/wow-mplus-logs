import { isDispel, isEnrage } from '@mplus/data';
import { Ev, EvFlag } from '@mplus/parser';

import { actorName, spellName, type AnalysisContext } from './context.js';
import { segmentAt, type SegmentIndex } from './segments.js';

/**
 * Dispels: what the party took off the enemy, and what it took off itself.
 *
 * The word covers three jobs that players keep apart, and so does this:
 *
 *   purge    a magic buff taken off an enemy — Purge, Spellsteal, Dispel Magic
 *   soothe   an enrage taken off an enemy — Soothe, Shiv, Tranquilizing Shot
 *   cleanse  a debuff taken off the party — Cleanse, Detox, Purify, a totem
 *
 * The log does almost all of the work. SPELL_DISPEL and SPELL_STOLEN name the
 * dispel, the aura that came off, the unit it came off, and whether that aura
 * was a BUFF or a DEBUFF — so unlike interrupts there is no pairing to infer,
 * and unlike control there is no duration to recover. Each line is one aura
 * removed, and the report is those lines, sorted into the three jobs.
 *
 * Two judgements are left, and `@mplus/data/dispels` makes both from the
 * game's own data rather than a list. Whether the line was a dispel at all:
 * the log writes SPELL_DISPEL when Cat Form or Disengage shrugs off a root,
 * and those are not dispels in any sense a player means — see `isDispel`.
 * And whether a buff taken off an enemy was an enrage, which is the line
 * between a purge and a soothe and has to be read off the aura, because
 * Tranquilizing Shot does both.
 *
 * What this cannot see is a dispel that removed nothing. A Purge on a mob
 * with no magic on it writes no line at all, so there is no hit rate here to
 * match the interrupts tab's.
 */

/** Which of the three jobs a removal was. */
export type DispelKind = 'purge' | 'soothe' | 'cleanse';

export const DISPEL_KINDS: readonly DispelKind[] = ['purge', 'soothe', 'cleanse'];

/** One aura removed by the party. */
export interface DispelRecord {
  /** Store-relative ms. */
  ts: number;
  /** The player it counts for: a pet's or a totem's dispel is its owner's. */
  actorIndex: number;
  name: string;
  specId: number;
  /** The pet or totem that did it, when one did. Empty when the player did. */
  petName: string;
  /** The dispel. */
  spellId: number;
  spellName: string;
  /** The aura that came off, which is what anyone actually asks about. */
  auraId: number;
  auraName: string;
  kind: DispelKind;
  /** Taken by Spellsteal rather than removed: the mage has it now. */
  stolen: boolean;
  targetIndex: number;
  targetName: string;
  /**
   * The press this removal belongs to.
   *
   * Removals sharing one came from a single cast, which is how Revival or Mass
   * Dispel counts as one press and several auras. Ids are per report.
   */
  castId: number;
  /**
   * The pull or boss it happened in, or -1 when none was open.
   *
   * A purge is filed under the enemy it was taken off, like a damage row. A
   * cleanse names no enemy at all — it is the party and the party — so it is
   * filed by time instead, the way a death is.
   */
  segmentId: number;
}

export interface DispelReport {
  /** Every aura the party removed, in order. */
  dispels: DispelRecord[];
  /** How many presses those came from. */
  casts: number;
}

export interface DispelOptions {
  /** How close two removals by one dispel must be to be one press. */
  pressMs?: number;
}

/**
 * How close two removals of one player's one dispel are to be one press.
 *
 * Measured, and the gaps split cleanly. Across eight real evenings of logs,
 * of the 1,755 gaps between a player's consecutive removals with one dispel,
 * 455 were under 50ms — Revival, Restoral and Mass Dispel taking several
 * auras at once — and only one fell anywhere between 50ms and a second. The
 * next cluster starts just over a second, and it is Purge and Spellsteal
 * pressed on consecutive globals and a cleansing totem's pulse, which are
 * separate presses.
 *
 * So this is far tighter than crowd control's one second, and has to be:
 * Purge has no cooldown, and a second's window would read a shaman purging
 * three buffs off three globals as one press.
 */
const DEFAULT_PRESS_MS = 100;

export function dispelReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: DispelOptions = {},
): DispelReport {
  const { run } = context;
  const { store, actors } = run;
  const pressMs = options.pressMs ?? DEFAULT_PRESS_MS;
  const ours = (index: number): boolean => index >= 0 && segments.party.has(actors.attribute(index));

  const dispels: DispelRecord[] = [];
  /** The last removal by each player's each dispel, to group one press. */
  const presses = new Map<string, { castId: number; ts: number }>();
  let nextCastId = 0;

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    if (code !== Ev.SPELL_DISPEL && code !== Ev.SPELL_STOLEN) continue;
    const src = store.srcActor[row]!;
    const spellId = store.spellId[row]!;
    if (!ours(src) || !isDispel(spellId)) continue;

    const dst = store.dstActor[row]!;
    if (dst < 0) continue;
    const auraId = store.extraSpellId[row]!;
    const buff = (store.flags[row]! & EvFlag.BUFF) !== 0;

    let kind: DispelKind;
    if (buff) {
      // A buff off the party is not a purge anyone pressed on purpose — it is
      // Mass Dispel catching a friend, or a log of arena rather than a key.
      if (ours(dst)) continue;
      kind = isEnrage(auraId) ? 'soothe' : 'purge';
    } else {
      // A debuff off something the party was fighting would be a strange
      // thing to call a cleanse. A debuff off an ally that is not in the party
      // — an escort, a freed prisoner — is exactly one.
      if (!ours(dst) && (segments.enemySegment[dst] ?? -1) >= 0) continue;
      kind = 'cleanse';
    }

    const ts = store.ts[row]!;
    const actor = actors.attribute(src);
    const pressKey = `${actor}:${spellId}`;
    const previous = presses.get(pressKey);
    const castId =
      previous !== undefined && ts - previous.ts <= pressMs ? previous.castId : nextCastId++;
    presses.set(pressKey, { castId, ts });

    const segmentId = kind === 'cleanse' ? -1 : segments.segmentOf(row);
    dispels.push({
      ts,
      actorIndex: actor,
      name: actorName(context, actor),
      specId: actors.at(actor)?.specId ?? -1,
      petName: actor === src ? '' : actorName(context, src),
      spellId,
      spellName: spellName(context, spellId),
      auraId,
      auraName: auraId === 0 ? '' : spellName(context, auraId),
      kind,
      stolen: code === Ev.SPELL_STOLEN,
      targetIndex: dst,
      targetName: actorName(context, dst),
      castId,
      segmentId: segmentId >= 0 ? segmentId : segmentAt(segments, ts),
    });
  }

  return { dispels, casts: nextCastId };
}

/** One dispel button, as one player used it. */
export interface DispelAbility {
  spellId: number;
  name: string;
  casts: number;
  /** Auras it took, which a mass dispel pushes above `casts`. */
  removed: number;
}

export interface DispelActor {
  actorIndex: number;
  name: string;
  specId: number;
  casts: number;
  removed: number;
  /** Removals by kind. Sums to `removed`. */
  byKind: Record<DispelKind, number>;
  abilities: DispelAbility[];
}

/** One aura, as often as the party took it off. */
export interface DispelledAura {
  /** The first id seen under this name, for its icon. */
  auraId: number;
  name: string;
  kind: DispelKind;
  count: number;
  /** The unit it was taken off most often. */
  targetName: string;
}

export interface DispelSummary {
  /** Most removals first. */
  actors: DispelActor[];
  /** What came off, most often first. */
  auras: DispelledAura[];
  casts: number;
  removed: number;
  byKind: Record<DispelKind, number>;
}

/**
 * The removals rolled up per player and per aura.
 *
 * Kept out of `dispelReport` and exported for the same reason as
 * `summarizeCrowdControl`, and asked more often than either: the view rolls up
 * the whole list for the chart that stacks all three kinds, then each kind's
 * own slice for its section. Every one of those is a filter on one list.
 */
export function summarizeDispels(dispels: readonly DispelRecord[]): DispelSummary {
  const actors = new Map<number, ActorTally>();
  const auras = new Map<string, DispelledAura & { onTarget: Map<string, number> }>();
  const casts = new Set<number>();
  const byKind = emptyKinds();

  for (const dispel of dispels) {
    let actor = actors.get(dispel.actorIndex);
    if (actor === undefined) {
      actor = {
        actorIndex: dispel.actorIndex,
        name: dispel.name,
        specId: dispel.specId,
        removed: 0,
        byKind: emptyKinds(),
        casts: new Set(),
        bySpell: new Map(),
      };
      actors.set(dispel.actorIndex, actor);
    }
    actor.removed++;
    actor.byKind[dispel.kind]++;
    // Through the cast id, so one Revival is one press however many auras it
    // took.
    actor.casts.add(dispel.castId);

    let ability = actor.bySpell.get(dispel.spellId);
    if (ability === undefined) {
      ability = { spellId: dispel.spellId, name: dispel.spellName, removed: 0, casts: new Set() };
      actor.bySpell.set(dispel.spellId, ability);
    }
    ability.removed++;
    ability.casts.add(dispel.castId);

    // Keyed by name rather than id: one mechanic is routinely several auras
    // under one name — a key's Corroding Spittle came off as two ids — and a
    // reader asks what came off, not which id. By kind as well, because one
    // name can be purged off an enemy and cleansed off the party.
    const auraKey = `${dispel.kind}:${dispel.auraName === '' ? dispel.auraId : dispel.auraName}`;
    let aura = auras.get(auraKey);
    if (aura === undefined) {
      aura = {
        auraId: dispel.auraId,
        name: dispel.auraName,
        kind: dispel.kind,
        count: 0,
        targetName: '',
        onTarget: new Map(),
      };
      auras.set(auraKey, aura);
    }
    aura.count++;
    aura.onTarget.set(dispel.targetName, (aura.onTarget.get(dispel.targetName) ?? 0) + 1);

    casts.add(dispel.castId);
    byKind[dispel.kind]++;
  }

  return {
    actors: [...actors.values()]
      .map((actor) => ({
        actorIndex: actor.actorIndex,
        name: actor.name,
        specId: actor.specId,
        casts: actor.casts.size,
        removed: actor.removed,
        byKind: actor.byKind,
        abilities: [...actor.bySpell.values()]
          .map((ability) => ({
            spellId: ability.spellId,
            name: ability.name,
            casts: ability.casts.size,
            removed: ability.removed,
          }))
          .sort((a, b) => b.removed - a.removed || a.spellId - b.spellId),
      }))
      .sort((a, b) => b.removed - a.removed || b.casts - a.casts),
    auras: [...auras.values()]
      .map(({ onTarget, ...aura }) => ({ ...aura, targetName: dominant(onTarget) }))
      .sort((a, b) => b.count - a.count || a.auraId - b.auraId),
    casts: casts.size,
    removed: dispels.length,
    byKind,
  };
}

/**
 * The accumulators. A press is a set of cast ids while it is being counted and
 * a number once it is reported, for the same reason as in crowd control.
 */
interface ActorTally {
  actorIndex: number;
  name: string;
  specId: number;
  removed: number;
  byKind: Record<DispelKind, number>;
  casts: Set<number>;
  bySpell: Map<number, { spellId: number; name: string; removed: number; casts: Set<number> }>;
}

function emptyKinds(): Record<DispelKind, number> {
  return { purge: 0, soothe: 0, cleanse: 0 };
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

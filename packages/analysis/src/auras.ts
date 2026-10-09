import { isInertMarker } from '@mplus/data';
import { ActorKind, Ev, EvFlag } from '@mplus/parser';

import { actorName, elapsedMs, spellName, type AnalysisContext } from './context.js';
import { AURA_DOWN_CODES, AURA_UP_CODES } from './events.js';
import type { SegmentIndex } from './segments.js';

/**
 * Aura uptime: how long each buff and debuff was on each party member.
 *
 * Every aura is a list of spans rather than a total, because a pull is a
 * window onto the key and a total cannot be cut to one. The view clips the
 * spans to whatever is selected, the way the other tabs filter their lists.
 *
 * A span is the union over casters. Two druids' Mark of the Wild on one
 * player is one buff up once, not twice, and it comes off only when the last
 * copy does.
 *
 * Two kinds of aura say nothing while the key runs, and both are recovered.
 * One already up when it started and still up when it ended writes no line at
 * all; the run's COMBATANT_INFO lists those (see `Run.openingAuras`). One
 * already up that comes off partway writes only its removal; that is read as
 * up since the start, which is the only time it can have gone up unseen.
 */

/** One aura on one party member, across the run. */
export interface AuraUptime {
  /** Who was wearing it. */
  actorIndex: number;
  spellId: number;
  /**
   * Empty when the log never named it, which happens to an aura only ever
   * seen on the opening list: that list is ids alone.
   */
  name: string;
  /** auraType was BUFF. An aura only ever seen on the opening list is taken as one. */
  buff: boolean;
  /** Whoever applied it most often. Empty when the log never named anyone. */
  sourceName: string;
  /** That was the wearer, which reads as "their own". */
  selfApplied: boolean;
  /** That was a player, whose name carries a realm to trim. */
  sourcePlayer: boolean;
  /**
   * When it was up, as flat `[start, end, start, end, ...]` store-relative ms:
   * ascending and never overlapping. Flat numbers rather than pairs, since a
   * key's busiest procs run to thousands of spans.
   */
  spans: number[];
}

export interface AuraReport {
  auras: AuraUptime[];
}

interface Track {
  actorIndex: number;
  spellId: number;
  buff: boolean | null;
  /** Casters whose copy is on right now. */
  on: Set<number>;
  since: number;
  spans: number[];
  /** Caster -> applications, for `sourceName`. */
  sources: Map<number, number>;
}

export function auraReport(context: AnalysisContext, segments: SegmentIndex): AuraReport {
  const { run } = context;
  const { store } = run;
  const tracks = new Map<string, Track>();

  const track = (actorIndex: number, spellId: number): { entry: Track; fresh: boolean } => {
    const key = `${actorIndex}:${spellId}`;
    const existing = tracks.get(key);
    if (existing !== undefined) return { entry: existing, fresh: false };
    const entry: Track = {
      actorIndex,
      spellId,
      buff: null,
      on: new Set(),
      since: -1,
      spans: [],
      sources: new Map(),
    };
    tracks.set(key, entry);
    return { entry, fresh: true };
  };
  const goUp = (entry: Track, source: number, ts: number): void => {
    if (entry.on.size === 0) entry.since = ts;
    entry.on.add(source);
  };

  for (const opening of run.openingAuras) {
    if (!segments.party.has(opening.actorIndex)) continue;
    const { entry } = track(opening.actorIndex, opening.spellId);
    goUp(entry, opening.sourceIndex, 0);
    entry.sources.set(opening.sourceIndex, (entry.sources.get(opening.sourceIndex) ?? 0) + 1);
  }

  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    const up = AURA_UP_CODES.has(code);
    if (!up && !AURA_DOWN_CODES.has(code)) continue;
    // The unit itself and not its owner: a buff on a pet is the pet's.
    const dst = store.dstActor[row]!;
    if (!segments.party.has(dst)) continue;

    const ts = store.ts[row]!;
    const src = store.srcActor[row]!;
    const { entry, fresh } = track(dst, store.spellId[row]!);
    entry.buff ??= (store.flags[row]! & EvFlag.BUFF) !== 0;

    if (up) {
      const applied = code === Ev.SPELL_AURA_APPLIED;
      // A refresh or a dose as the first line seen is an aura that went up
      // before the run did.
      goUp(entry, src, fresh && !applied ? 0 : ts);
      if (applied || fresh) entry.sources.set(src, (entry.sources.get(src) ?? 0) + 1);
      continue;
    }

    if (!entry.on.delete(src)) {
      if (fresh) {
        // Its removal is the only line naming it: up since the start.
        entry.spans.push(0, ts);
        entry.sources.set(src, 1);
        continue;
      }
      // Removed by a caster never seen putting it on — the opening list names
      // a caster the log had not met yet, as -1. One copy came off either way.
      if (entry.on.size !== 1) continue;
      entry.on.clear();
    }
    if (entry.on.size === 0 && entry.since >= 0) {
      close(entry, ts);
    }
  }

  // Auras still up when the run ended run to its end.
  const end = elapsedMs(run);
  for (const entry of tracks.values()) {
    if (entry.on.size > 0 && entry.since >= 0) close(entry, Math.max(end, entry.since));
  }

  const auras: AuraUptime[] = [];
  for (const entry of tracks.values()) {
    if (entry.spans.length === 0) continue;
    const buff = entry.buff ?? true;
    const source = dominant(entry.sources);
    // The game's notes to itself — Sated, Exhaustion — are uptime of nothing.
    // The same two facts as a death recap's `bookkeeping`, for the same reason.
    if (!buff && source === entry.actorIndex && isInertMarker(entry.spellId)) continue;
    auras.push({
      actorIndex: entry.actorIndex,
      spellId: entry.spellId,
      name: context.spellNames.has(entry.spellId) ? spellName(context, entry.spellId) : '',
      buff,
      sourceName: source < 0 ? '' : actorName(context, source),
      selfApplied: source === entry.actorIndex,
      sourcePlayer: run.actors.at(source)?.kind === ActorKind.PLAYER,
      spans: entry.spans,
    });
  }
  return { auras };
}

function close(entry: Track, ts: number): void {
  const spans = entry.spans;
  const last = spans.length - 1;
  // Touching the previous span — a buff reapplied in the same millisecond it
  // fell off — extends it rather than starting another.
  if (last > 0 && spans[last]! >= entry.since) spans[last] = Math.max(spans[last]!, ts);
  else spans.push(entry.since, ts);
  entry.since = -1;
}

function dominant(counts: ReadonlyMap<number, number>): number {
  let best = -1;
  let bestCount = 0;
  for (const [index, count] of counts) {
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  }
  return best;
}

/** One row of the tab: an aura on one player, cut to a window. */
export interface AuraRow {
  /** The id with the most uptime under this name, for its icon. */
  spellId: number;
  name: string;
  buff: boolean;
  sourceName: string;
  selfApplied: boolean;
  sourcePlayer: boolean;
  /** Milliseconds up inside the window. */
  upMs: number;
  /** Times it went up inside the window, or was already up when it opened. */
  count: number;
  /** `spans` clipped to the window, in the same flat form. */
  spans: number[];
}

/**
 * One player's auras over `[from, to]`, most uptime first.
 *
 * Pooled by name, as the dispels tab pools what came off: one buff is
 * routinely several ids — a talent's version, a second rank — and a reader
 * asks how long they had Bloodlust, not which Bloodlust. The pooled spans are
 * a union, so two ids up at once still read as one buff up once.
 */
export function aurasIn(
  auras: readonly AuraUptime[],
  actorIndex: number,
  from: number,
  to: number,
): AuraRow[] {
  const groups = new Map<string, { best: AuraUptime; bestMs: number; spans: number[] }>();
  for (const aura of auras) {
    if (aura.actorIndex !== actorIndex) continue;
    const spans = clip(aura.spans, from, to);
    if (spans.length === 0) continue;
    const ms = total(spans);
    const key = `${aura.buff ? 'b' : 'd'}:${aura.name === '' ? `#${aura.spellId}` : aura.name}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { best: aura, bestMs: ms, spans });
      continue;
    }
    group.spans = union(group.spans, spans);
    if (ms > group.bestMs) {
      group.best = aura;
      group.bestMs = ms;
    }
  }
  return [...groups.values()]
    .map(({ best, spans }) => ({
      spellId: best.spellId,
      name: best.name,
      buff: best.buff,
      sourceName: best.sourceName,
      selfApplied: best.selfApplied,
      sourcePlayer: best.sourcePlayer,
      upMs: total(spans),
      count: spans.length / 2,
      spans,
    }))
    .sort((a, b) => b.upMs - a.upMs || a.name.localeCompare(b.name));
}

function clip(spans: readonly number[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < spans.length; i += 2) {
    const start = Math.max(spans[i]!, from);
    const end = Math.min(spans[i + 1]!, to);
    if (end > start) out.push(start, end);
  }
  return out;
}

function total(spans: readonly number[]): number {
  let ms = 0;
  for (let i = 0; i < spans.length; i += 2) ms += spans[i + 1]! - spans[i]!;
  return ms;
}

/** Two sorted span lists as one, overlaps merged. */
function union(a: readonly number[], b: readonly number[]): number[] {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < a.length; i += 2) pairs.push([a[i]!, a[i + 1]!]);
  for (let i = 0; i < b.length; i += 2) pairs.push([b[i]!, b[i + 1]!]);
  pairs.sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  for (const [start, end] of pairs) {
    const last = out.length - 1;
    if (last > 0 && start <= out[last]!) out[last] = Math.max(out[last]!, end);
    else out.push(start, end);
  }
  return out;
}

import { channelMs, gcdMs, isButton } from '@mplus/data';
import { Ev, EvFlag } from '@mplus/parser';

import { actorName, elapsedMs, type AnalysisContext } from './context.js';
import type { SegmentIndex } from './segments.js';

/**
 * What each player cast: how many buttons they pressed, and every cast bar,
 * channel and empower, with how each one ended.
 *
 * Not active time, which is the damage and healing tables' (see
 * `ACTIVE_GAP_MS` there): Warcraft Logs counts that from the rows a table
 * shows, not from casting, and so does this app. This is for what only the
 * casting says — who mashed, who gave up on casts, who died mid-cast.
 *
 * The log has no "casting" state. What it has is the edges: SPELL_CAST_START
 * when a cast bar opens, SPELL_CAST_SUCCESS when a cast lands, the channel's
 * aura coming off when a channel stops, and EMPOWER_START and _END around an
 * empower. A bar is rebuilt from those, and ends finished, abandoned, kicked
 * by an enemy, or cut short by the player's death.
 *
 * Not every SPELL_CAST_SUCCESS is a press. A talent that fires Riptide or Lava
 * Burst writes the same row a press does, often in the same millisecond as the
 * cast that triggered it. Those are not counted as presses, and do not end a
 * cast in progress: anything that would start a global cooldown in under half
 * of the last one is read as a proc, because no player can press that fast.
 */

/** One cast bar, channel or empower: something a player was standing still for. */
export interface CastBar {
  /** Store-relative ms. */
  start: number;
  end: number;
  spellId: number;
  /** Completed, rather than cancelled, kicked, or cut short by a death. */
  finished: boolean;
  /** An enemy interrupted it. */
  kicked: boolean;
  /** The player died with it still going. */
  died: boolean;
  channel: boolean;
}

export interface CastingActor {
  actorIndex: number;
  name: string;
  specId: number;
  /** Buttons pressed: casts that landed, procs left out. */
  presses: number;
  /**
   * Cast bars they abandoned: moved, pressed something else, or
   * let go. Not the ones an enemy interrupted, which were not their choice, and
   * not the ones a death cut short.
   */
  cancelled: number;
  /** Every cast bar, channel and empower, in order. */
  bars: CastBar[];
}

export interface CastingReport {
  /** The whole run, in ms. */
  durationMs: number;
  /** Most presses first. */
  actors: CastingActor[];
}
/**
 * A press closer than this fraction of the last one's GCD is a proc. A shade
 * under half: the game's floor on a hasted GCD is half of 1.5s, and a
 * Bloodlusted player at the floor must still read as pressing.
 */
const PROC_FRACTION = 0.45;
/**
 * The longest any one cast bar runs, however long the log leaves it open.
 * The longest real casts in a key, the dungeons' own interactions, take a few
 * seconds.
 */
const MAX_BAR_MS = 10_000;
/**
 * How long a bar the log never closes ran, when the player never finished
 * that spell for comparison.
 *
 * The log does leave bars open. A cast queued as a pull ends is dropped
 * without a SUCCESS or a FAILED: a Devourer's last Consume of a pack began at
 * 369.4s and nothing more was said of it. A bar like that runs for the
 * longest the player ever took to finish the same spell, which is about how
 * long they can have stood there, or for this when they never finished one.
 */
const UNCLOSED_BAR_MS = 3_000;
/** A channel the data gives no length runs until something stops it, up to this. */
const OPEN_CHANNEL_MS = 8_000;
/** How near a cast's end an enemy's interrupt must be to have been what ended it. */
const KICK_MS = 100;

/** One row of a player's casting, in the order the log wrote them. */
interface CastRow {
  ts: number;
  code: Ev;
  spellId: number;
}

const CAST_CODES: ReadonlySet<number> = new Set([
  Ev.SPELL_CAST_START,
  Ev.SPELL_CAST_SUCCESS,
  Ev.SPELL_CAST_FAILED,
  Ev.SPELL_EMPOWER_START,
  Ev.SPELL_EMPOWER_END,
  Ev.SPELL_EMPOWER_INTERRUPT,
]);

/** Every party member's casting over the whole run. */
export function castingReport(context: AnalysisContext, segments: SegmentIndex): CastingReport {
  const actors = castingOf(context, segments).map(
    (player): CastingActor => ({
      actorIndex: player.actorIndex,
      name: actorName(context, player.actorIndex),
      specId: context.run.actors.at(player.actorIndex)?.specId ?? -1,
      presses: player.presses,
      cancelled: player.bars.filter((bar) => !bar.finished && !bar.kicked && !bar.died).length,
      bars: player.bars,
    }),
  );
  actors.sort((a, b) => b.presses - a.presses);
  return { durationMs: Math.max(elapsedMs(context.run), 1), actors };
}

/** One player's casting, rebuilt over the whole run. */
interface Casting extends Rebuilt {
  actorIndex: number;
}

function castingOf(context: AnalysisContext, segments: SegmentIndex): Casting[] {
  const { store } = context.run;
  // The whole run, whatever the window: a cast that began before a pull opened
  // still ran into it, and an unclosed bar is judged by every cast of that
  // spell the player finished. Only the player's own rows. A pet's casts are its own, and a player
  // waiting on their pet is not casting.
  const rows = new Map<number, CastRow[]>();
  const kicks = new Map<number, number[]>();
  const deaths = new Map<number, number[]>();
  for (const player of segments.party) {
    rows.set(player, []);
    kicks.set(player, []);
    deaths.set(player, []);
  }
  for (let row = 0; row < store.count; row++) {
    const code = store.code[row]!;
    if (CAST_CODES.has(code) || code === Ev.SPELL_AURA_REMOVED) {
      const mine = rows.get(store.srcActor[row]!);
      if (mine === undefined) continue;
      const spellId = store.spellId[row]!;
      // Only a channel's own aura coming off says anything about casting.
      if (code === Ev.SPELL_AURA_REMOVED && channelMs(spellId) < 0) continue;
      mine.push({ ts: store.ts[row]!, code, spellId });
    } else if (code === Ev.SPELL_INTERRUPT) {
      kicks.get(store.dstActor[row]!)?.push(store.ts[row]!);
    } else if (code === Ev.UNIT_DIED && !(store.flags[row]! & EvFlag.FEIGNED)) {
      deaths.get(store.dstActor[row]!)?.push(store.ts[row]!);
    }
  }

  return [...rows].map(([actorIndex, mine]) => ({
    actorIndex,
    ...rebuild(mine, deaths.get(actorIndex)!, kicks.get(actorIndex)!),
  }));
}

interface Rebuilt {
  bars: CastBar[];
  presses: number;
}

/** One player's casting, in one pass over their rows. */
function rebuild(mine: readonly CastRow[], deaths: readonly number[], kicks: readonly number[]): Rebuilt {
  const bars: CastBar[] = [];
  let presses = 0;
  let open: { spellId: number; start: number; empower: boolean } | null = null;
  let channel: { spellId: number; start: number; cap: number } | null = null;
  /** When the last GCD began, and how long it was, for telling a proc from a press. */
  let lastGcd = -Infinity;
  let lastGcdMs = 0;
  let deathAt = 0;
  /** Spell -> the longest this player took to finish casting it. */
  const longest = new Map<number, number>();
  {
    let start: { spellId: number; ts: number } | null = null;
    for (const { ts, code, spellId } of mine) {
      if (code === Ev.SPELL_CAST_START) start = { spellId, ts };
      else if (code === Ev.SPELL_CAST_SUCCESS && start?.spellId === spellId) {
        longest.set(spellId, Math.max(longest.get(spellId) ?? 0, ts - start.ts));
        start = null;
      }
    }
  }

  const kickedAt = (ts: number): boolean => kicks.some((kick) => Math.abs(kick - ts) <= KICK_MS);
  /** The latest a bar of this spell, opened at `start`, can still have been going. */
  const barLimit = (spellId: number, start: number): number =>
    start + Math.min(longest.get(spellId) ?? UNCLOSED_BAR_MS, MAX_BAR_MS);
  const closeBar = (ts: number, finished: boolean, died = false): void => {
    if (open === null) return;
    // Finished casts ran as logged. One that stopped ran no further than it
    // could have: a bar the log left open until the next pull would otherwise
    // fill the walk between.
    const limit = finished ? open.start + MAX_BAR_MS : barLimit(open.spellId, open.start);
    const end = Math.min(Math.max(ts, open.start), limit);
    if (finished) presses++;
    bars.push({
      start: open.start,
      end,
      spellId: open.spellId,
      finished,
      kicked: !finished && kickedAt(ts),
      // Only if it could still have been going: a bar the log left open long
      // before is not the cast they died in.
      died: died && ts <= limit,
      channel: false,
    });
    open = null;
  };
  const closeChannel = (ts: number, died = false): void => {
    if (channel === null) return;
    const end = Math.max(Math.min(ts, channel.cap), channel.start);
    bars.push({
      start: channel.start,
      end,
      spellId: channel.spellId,
      // A channel stopped early is not a cancelled cast: clipping one is often
      // the right play, and the log cannot tell that from giving up.
      finished: true,
      kicked: false,
      died: died && ts <= channel.cap,
      channel: true,
    });
    channel = null;
  };

  // A death ends whatever was being cast, and nothing after it until they are
  // back is theirs to have cancelled.
  const diedBy = (ts: number): void => {
    while (deathAt < deaths.length && deaths[deathAt]! <= ts) {
      const died = deaths[deathAt++]!;
      closeBar(died, false, true);
      closeChannel(died, true);
    }
  };

  for (const { ts, code, spellId } of mine) {
    diedBy(ts);
    // A channel left running past its length ended there, whatever came next.
    if (channel !== null && ts > channel.cap) closeChannel(channel.cap);

    switch (code) {
      case Ev.SPELL_CAST_START:
      case Ev.SPELL_EMPOWER_START:
        closeBar(ts, false);
        closeChannel(ts);
        open = { spellId, start: ts, empower: code === Ev.SPELL_EMPOWER_START };
        if (gcdMs(spellId) > 0) {
          lastGcd = ts;
          lastGcdMs = gcdMs(spellId);
        }
        break;
      case Ev.SPELL_EMPOWER_END:
      case Ev.SPELL_EMPOWER_INTERRUPT:
        if (open?.empower === true && open.spellId === spellId) closeBar(ts, code === Ev.SPELL_EMPOWER_END);
        break;
      case Ev.SPELL_CAST_FAILED:
        // Only a failure of the cast in progress. The rest are the game turning
        // down a press — "Not yet recovered", 6,718 of them in one night's log
        // — and a press that never went off cost the player nothing.
        if (open !== null && !open.empower && open.spellId === spellId) closeBar(ts, false);
        break;
      case Ev.SPELL_AURA_REMOVED:
        if (channel?.spellId === spellId) closeChannel(ts);
        break;
      case Ev.SPELL_CAST_SUCCESS: {
        if (open !== null && open.spellId === spellId) {
          // An empower writes its SUCCESS as it begins; its END closes it.
          if (!open.empower) closeBar(ts, true);
          break;
        }
        const gcd = gcdMs(spellId);
        if (gcd === 0) {
          // Off the GCD: a press, if it is a button at all, and it does not
          // stop a cast in progress.
          if (isButton(spellId)) presses++;
          break;
        }
        if (ts - lastGcd < lastGcdMs * PROC_FRACTION) break;
        // A press on the GCD ends whatever was being cast or channeled: the
        // player let go of it to press this.
        closeBar(ts, false);
        closeChannel(ts);
        lastGcd = ts;
        lastGcdMs = gcd;
        presses++;
        const length = channelMs(spellId);
        if (length >= 0) channel = { spellId, start: ts, cap: ts + (length > 0 ? length : OPEN_CHANNEL_MS) };
        break;
      }
    }
  }
  // A death after the last cast is the one that most needs seeing: the cast
  // they were still standing in.
  diedBy(Infinity);
  // Whatever is still going when the log runs out stopped at its limit.
  const left = open as { spellId: number; start: number } | null;
  if (left !== null) closeBar(barLimit(left.spellId, left.start), false);
  const running = channel as { cap: number } | null;
  if (running !== null) closeChannel(running.cap);
  return { bars, presses };
}

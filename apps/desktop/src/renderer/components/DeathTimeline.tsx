import { useEffect, useRef, useState } from 'react';

import type { AuraWindow, DeathReport, HpSample } from '@mplus/analysis';

import { short } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { Tip, useTip } from './Tip.js';

/**
 * The seconds before last, second by second.
 *
 * A death recap has to answer one question: was the healing there or not. A
 * chronological list of hits cannot answer it, because damage and healing
 * interleave and the eye cannot sum two columns of numbers in flight. So the
 * window is cut into one-second rows with damage growing left from the centre
 * and healing growing right, both on a single shared scale — a healing bar
 * shorter than the damage beside it is a second where they lost ground, and
 * that reads at a glance.
 *
 * Rows run newest first: the top row is the one they died in, and time counts
 * backwards down the chart. The death is the reason anyone opened the recap, so
 * it should not be at the far end of the rows — and at a quarter second per row
 * there are forty of them.
 *
 * Five things flank the bars, and the order they sit in is the order the
 * question is asked in. Innermost is the second and the health it ended on,
 * together in one cell: a time without its health is half a reading, and the
 * pair is what turns two columns of bars into a verdict. Outside that, each
 * side's total for the row, so the comparison can be made as a number when the
 * bars are close. Then the bars. Then, at the outer edges, the auras that were
 * on them — debuffs to the left with the damage that came with them,
 * defensives and externals to the right with the healing — as vertical spans
 * across the rows they covered, because "the defensive had already fallen off"
 * is the answer often enough to deserve a column of its own.
 *
 * Bars are per ability within the second rather than per hit: five ticks of one
 * DoT in the same second are one bar, which keeps the row legible when a pack
 * is channelling. A bar wide enough to hold its own figure carries it, with an
 * asterisk when a crit is in it; the hover tip carries the words either way,
 * because at this size a spell name is either absent or clipped to a fragment.
 *
 * One second is the wrong resolution for the deaths that matter most. A tank
 * dropping from full to zero does it inside one row, and at one second per row
 * a two-hit overlap and a single enormous hit look identical — so the row length
 * is adjustable down to a quarter second, which is where the order of the hits
 * and whether the healer was merely late rather than absent becomes visible.
 * Note that the shared scale is per view, so zooming in makes every bar longer:
 * the lengths compare within a resolution, not across one.
 *
 * The view is ten seconds wide however long the rows are, and slides back
 * through the longer span the analysis captured. Ten seconds answers "what
 * killed them"; it does not answer "when did this go wrong", and a tank who
 * spent twenty seconds without a defensive did not start dying in the last ten.
 */

interface Bar {
  key: string;
  label: string;
  source: string;
  amount: number;
  hits: number;
  /** How many of those hits crit, which the bar marks with an asterisk. */
  crits: number;
  color: string;
  /** The spell whose icon the bar draws. 0 when the log did not name one. */
  spellId: number;
  /** Contains the blow that finished them. */
  killing: boolean;
}

interface Row {
  key: number;
  label: string;
  damage: Bar[];
  healing: Bar[];
  damageTotal: number;
  healingTotal: number;
  /** Health at the end of the row, or null before the trace starts. */
  hp: HpSample | null;
  /** The row the death falls in. */
  isDeathRow: boolean;
}

/** One aura's span, placed in the lane. */
interface Span {
  key: string;
  aura: AuraWindow;
  /** Percentages down the lane, with the death at the top. */
  top: number;
  height: number;
  color: string;
}

/** One reserved colour for every absorb, whichever shield it was. */
const ABSORB_COLOR = '#4a7fd4';

/** Square, and the bar is 14px tall. Must match .dt-ico in the stylesheet. */
const ICON_PX = 14;
/** Lane width assumed until the real one is measured, for the first paint. */
const ASSUMED_LANE_PX = 260;
/** Width of an aura lane and the height of one row. Must match the stylesheet. */
const AURA_LANE_PX = 76;
const ROW_PX = 20;
const ROW_GAP_PX = 2;
/** The gap between packed aura columns, also from the stylesheet. */
const AURA_COL_GAP_PX = 2;
/**
 * Width of one character of the bar's figure, at the stylesheet's 10px tabular
 * font. Over- rather than under-stated: a figure that does not quite fit is
 * clipped to something like "16" and reads as a different number, which is
 * worse than no figure at all.
 */
const DIGIT_PX = 6.4;

/**
 * Row lengths the chart can be read at, longest first.
 *
 * A quarter second is the floor on purpose. Log timestamps are millisecond
 * stamped, but the server does not resolve events that finely — a volley and
 * the tick that came with it share a moment — so finer rows would mostly split
 * hits that landed together and imply an order the log cannot vouch for.
 */
const RESOLUTIONS_MS = [1000, 500, 250] as const;
const DEFAULT_RESOLUTION_MS = 1000;

/** How far the scrubber moves per step, and per arrow key. */
const SCRUB_STEP_MS = 500;

// A spell id spread over a narrow hue band keeps the two sides readable as
// "damage" and "healing" before any label is read, while still giving each
// ability its own stable colour across every death in the run.
function damageColor(spellId: number): string {
  return `hsl(${(spellId * 47) % 54}, 70%, 52%)`;
}

function healColor(spellId: number): string {
  return `hsl(${104 + ((spellId * 47) % 68)}, 54%, 46%)`;
}

/**
 * The health bar's own ramp, green through to red, so the column reads without
 * being read. Saturation climbs as health falls: a full-health row should sit
 * quietly in the margin and a 12% row should be the first thing seen.
 */
function hpColor(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  return `hsl(${Math.round(clamped * 110)}, ${Math.round(38 + (1 - clamped) * 42)}%, 58%)`;
}

function resolutionLabel(ms: number): string {
  return ms >= 1000 ? `${ms / 1000}s` : `${ms / 1000}`.replace(/^0/, '') + 's';
}

/** "−12s", or "0s" for the death itself. */
function offsetLabel(ms: number): string {
  if (ms <= 0) return '0s';
  const seconds = ms / 1000;
  return `−${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

/**
 * An aura's span in words, for the screen reader and the `aria-label`.
 *
 * A clamped end is never written as a duration. "Blessing of Protection, 20.9s"
 * for an aura that was already up when the capture opened reports the length of
 * the window, not of the cooldown, and that is a number someone would quote.
 */
function auraLabel(aura: AuraWindow, death: DeathReport): string {
  const off = `−${((death.ts - aura.endTs) / 1000).toFixed(1)}s`;
  if (aura.openStart && aura.openEnd) return `${aura.spellName}, up throughout`;
  if (aura.openStart) return `${aura.spellName}, already up, off at ${off}`;
  if (aura.openEnd) return `${aura.spellName}, up for the last ${((death.ts - aura.startTs) / 1000).toFixed(1)}s`;
  return `${aura.spellName}, ${((aura.endTs - aura.startTs) / 1000).toFixed(1)}s, off at ${off}`;
}

export function DeathTimeline({
  death,
  defaultResolutionMs = DEFAULT_RESOLUTION_MS,
  defaultOffsetMs = 0,
}: {
  death: DeathReport;
  /** Resolution to open at. Only the smoke test passes it, to reach the zoom. */
  defaultResolutionMs?: number;
  /** How far back to open scrolled. Only the smoke test passes it. */
  defaultOffsetMs?: number;
}): React.JSX.Element {
  // Kept across deaths rather than reset with each one: someone who has zoomed
  // in is comparing deaths at that resolution, and having it snap back to one
  // second on every click in the list would undo the comparison.
  const [bucketMs, setBucketMs] = useState<number>(defaultResolutionMs);

  // The scrubber, unlike the zoom, does snap back. The death is why the recap
  // was opened, and a new one opening on a view scrolled ten seconds past it
  // reads as a chart with no death in it.
  const [offsetMs, setOffsetMs] = useState(defaultOffsetMs);
  useEffect(() => setOffsetMs(defaultOffsetMs), [death.actorIndex, death.ts, defaultOffsetMs]);

  const viewMs = Math.min(death.windowMs, death.scrollbackMs);
  const maxOffsetMs = Math.max(0, death.scrollbackMs - viewMs);
  const offset = Math.min(offsetMs, maxOffsetMs);
  const viewEnd = death.ts - offset;
  const viewStart = viewEnd - viewMs;

  const rows = buildRows(death, bucketMs, viewStart, viewEnd);
  // One scale for both sides, or the comparison the chart exists for is a lie.
  const scale = Math.max(1, ...rows.map((row) => Math.max(row.damageTotal, row.healingTotal)));
  const debuffs = spans(death, viewStart, viewEnd, false);
  const buffs = spans(death, viewStart, viewEnd, true);
  const icons = useSpellIcons([
    ...rows.flatMap((row) => [...row.damage, ...row.healing].map((bar) => bar.spellId)),
    ...[...debuffs, ...buffs].flat().map((span) => span.aura.spellId),
  ]);

  const laneRef = useRef<HTMLDivElement | null>(null);
  const tip = useTip<Bar | AuraWindow>();

  // Whether a label or even an icon fits is a question about pixels, not about
  // share of the scale: the same 4% bar is legible in a maximised window and a
  // sliver in a tiled one. So the lane is measured rather than assumed.
  const [lanePx, setLanePx] = useState(0);
  useEffect(() => {
    const node = laneRef.current;
    if (node === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      setLanePx(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const controls = (
    <div className="dt-controls">
      {maxOffsetMs === 0 ? null : (
        <div className="dt-scrub">
          {/* Right is now, the way every timeline reads, so the value is the
              scrubber's position rather than the offset it stands for. */}
          <input
            type="range"
            min={0}
            max={maxOffsetMs}
            step={SCRUB_STEP_MS}
            value={maxOffsetMs - offset}
            aria-label="Seconds before the death to show"
            onChange={(event) => setOffsetMs(maxOffsetMs - Number(event.target.value))}
          />
          <span className="dt-range">
            {offsetLabel(offset + viewMs)} → {offsetLabel(offset)}
          </span>
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffsetMs(0)}
            title="Back to the death"
          >
            death
          </button>
        </div>
      )}
      <div className="dt-zoom">
        <span>row</span>
        {RESOLUTIONS_MS.map((ms) => (
          <button
            type="button"
            key={ms}
            className={ms === bucketMs ? 'active' : undefined}
            aria-pressed={ms === bucketMs}
            onClick={() => setBucketMs(ms)}
          >
            {resolutionLabel(ms)}
          </button>
        ))}
      </div>
    </div>
  );

  if (
    rows.every((row) => row.damage.length === 0 && row.healing.length === 0) &&
    debuffs.length === 0 &&
    buffs.length === 0
  ) {
    return (
      <div className="dt">
        {controls}
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Nothing was recorded between {offsetLabel(offset + viewMs)} and {offsetLabel(offset)}.
        </p>
      </div>
    );
  }

  const lane = lanePx > 0 ? lanePx : ASSUMED_LANE_PX;
  // The lanes run beside the rows, so the track is as tall as they are.
  const trackPx = rows.length * (ROW_PX + ROW_GAP_PX) - ROW_GAP_PX;

  return (
    <div className="dt" ref={tip.rootRef}>
      {controls}
      <div className="dt-body">
        <AuraLane
          title="Debuffs"
          side="left"
          columns={debuffs}
          trackPx={trackPx}
          icons={icons}
          death={death}
          onEnter={tip.show}
          onLeave={tip.hide}
        />
        <div className="dt-grid">
          <div className="dt-head">
            <span>Damage taken</span>
            <span>sec · hp</span>
            <span>Healing and absorbs</span>
          </div>
          {/* The rows get a box of their own so the two rules separating the
              centre column from the bars can run the height of the chart
              without crossing the heading, which sits inside the same grid. */}
          <div className="dt-stack">
            {rows.map((row, index) => (
              <div className={`dt-row${row.isDeathRow ? ' death' : ''}`} key={row.key}>
                <div className="dt-bars left" ref={index === 0 ? laneRef : undefined}>
                  {row.damage.map((bar) => (
                    <Segment
                      bar={bar}
                      scale={scale}
                      lane={lane}
                      icon={icons.get(bar.spellId)}
                      onEnter={tip.show(bar)}
                      onLeave={tip.hide}
                      key={bar.key}
                    />
                  ))}
                </div>
                <span className="dt-total">{row.damageTotal > 0 ? short(row.damageTotal) : ''}</span>
                <Centre row={row} />
                <span className="dt-total">{row.healingTotal > 0 ? short(row.healingTotal) : ''}</span>
                <div className="dt-bars right">
                  {row.healing.map((bar) => (
                    <Segment
                      bar={bar}
                      scale={scale}
                      lane={lane}
                      icon={icons.get(bar.spellId)}
                      onEnter={tip.show(bar)}
                      onLeave={tip.hide}
                      key={bar.key}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <AuraLane
          title="Defensives"
          side="right"
          columns={buffs}
          trackPx={trackPx}
          icons={icons}
          death={death}
          onEnter={tip.show}
          onLeave={tip.hide}
        />
      </div>
      {tip.data === null ? null : (
        <Tip state={tip} icon={icons.get(tip.data.spellId)}>
          {/* Both lanes and both sides of the chart share one tip, so which
              kind is hovered is read off the payload: only an aura has a
              `buff` to be. */}
          {'buff' in tip.data ? (
            <AuraDetail aura={tip.data} death={death} />
          ) : (
            <BarDetail bar={tip.data} />
          )}
        </Tip>
      )}
    </div>
  );
}

function BarDetail({ bar }: { bar: Bar }): React.JSX.Element {
  return (
    <>
      <strong>{bar.label}</strong>
      {bar.source === '' ? null : <span className="dim"> {bar.source}</span>}
      <span className="tip-nums">
        {short(bar.amount)}
        {bar.hits > 1 ? ` · ${bar.hits} hits` : ''}
        {bar.crits === 0 ? '' : bar.crits === bar.hits ? ' · crit' : ` · ${bar.crits} crit`}
        {bar.killing ? ' · killing blow' : ''}
      </span>
    </>
  );
}

/**
 * An aura's tip, which has to say when it ran rather than how much it did.
 *
 * A clamped end is written as an inequality: an aura already up when the
 * capture opened has no start the log knows, and claiming one is the mistake
 * that makes a thirty-second window look like a thirty-second cooldown.
 */
function AuraDetail({ aura, death }: { aura: AuraWindow; death: DeathReport }): React.JSX.Element {
  const from = (death.ts - aura.startTs) / 1000;
  const to = (death.ts - aura.endTs) / 1000;
  return (
    <>
      <strong>{aura.spellName}</strong>
      {aura.sourceName === '' ? null : (
        <span className="dim"> {aura.selfApplied ? 'their own' : aura.sourceName}</span>
      )}
      <span className="tip-nums">
        {aura.openStart ? 'already up at ' : ''}−{from.toFixed(1)}s
        {' → '}
        {aura.openEnd ? 'the death' : `−${to.toFixed(1)}s`}
        {aura.openStart || aura.openEnd
          ? ''
          : ` · ${((aura.endTs - aura.startTs) / 1000).toFixed(1)}s`}
      </span>
    </>
  );
}

/**
 * One edge of the chart: the auras that were on them, as vertical spans.
 *
 * Overlapping auras are packed into side-by-side columns rather than stacked,
 * so a span's height is always its duration — the one thing the lane is for.
 * The lane keeps its width with nothing in it, because a chart whose bars
 * shift sideways between deaths cannot be compared across them.
 */
function AuraLane({
  title,
  side,
  columns,
  trackPx,
  icons,
  death,
  onEnter,
  onLeave,
}: {
  title: string;
  side: 'left' | 'right';
  columns: Span[][];
  /** Height of the track in pixels, which decides whether an icon fits. */
  trackPx: number;
  icons: ReadonlyMap<number, string>;
  death: DeathReport;
  onEnter: (data: AuraWindow) => (event: React.MouseEvent<HTMLElement>) => void;
  onLeave: () => void;
}): React.JSX.Element {
  // Both dimensions are known without measuring: the lane's width is fixed by
  // the stylesheet and split evenly between however many columns the packing
  // needed, and the track's height is one row per bucket. A cropped icon is
  // unrecognisable, so it is all or nothing on both axes.
  const columnPx =
    (AURA_LANE_PX - AURA_COL_GAP_PX * Math.max(0, columns.length - 1)) / Math.max(1, columns.length);
  const roomForIcons = columnPx >= ICON_PX;

  return (
    <div className={`dt-lane ${side}`}>
      <div className="dt-lane-head">{title}</div>
      <div className="dt-lane-track">
        {columns.map((column, index) => (
          <div className="dt-lane-col" key={index}>
            {column.map((span) => {
              const icon = icons.get(span.aura.spellId);
              const showIcon =
                roomForIcons && icon !== undefined && (span.height / 100) * trackPx >= ICON_PX + 2;
              return (
                <span
                  key={span.key}
                  className={`dt-span${span.aura.openEnd ? ' open' : ''}`}
                  style={{
                    top: `${span.top}%`,
                    height: `${span.height}%`,
                    background: span.color,
                  }}
                  aria-label={auraLabel(span.aura, death)}
                  onMouseEnter={onEnter(span.aura)}
                  onMouseLeave={onLeave}
                >
                  {showIcon ? <img className="dt-ico" src={icon} alt="" /> : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The centre cell: the second and the health it ended on — or, on the row the
 * killing blow landed in, a skull.
 *
 * Those are the two numbers in the whole chart that carry nothing. The second
 * is 0 by construction: it is the row the death defines. The health is 0 for
 * the same reason. A skull says both in one glyph, and says them as a mark the
 * eye finds before it reads — which is what that row is there for.
 *
 * Scrubbed back past the death there is no such row, and every row keeps its
 * numbers.
 */
function Centre({ row }: { row: Row }): React.JSX.Element {
  if (!row.isDeathRow) {
    return (
      <span className="dt-mid">
        <span className="sec">{row.label}</span>
        <Health sample={row.hp} />
      </span>
    );
  }
  return (
    <span className="dt-mid">
      {/* Asking for the text presentation explicitly, or the platform emoji
          font renders it in colour at its own size and it stops belonging to
          the column it sits in. The label is for the screen reader, which gets
          nothing from the glyph. */}
      <span className="dt-skull" role="img" aria-label="died here">
        {'\u2620\uFE0E'}
      </span>
    </span>
  );
}

/**
 * Health at the end of one row.
 *
 * Always rendered, even with nothing to say: the cell holds its place so the
 * rows before the trace starts do not shunt the seconds beside them around.
 * Rounded towards 1% rather than to nearest: an 0.4% survival shown as 0% is
 * the one reading in the column that would mislead, and the row they actually
 * died on carries a skull instead of a number.
 */
function Health({ sample }: { sample: HpSample | null }): React.JSX.Element {
  if (sample === null || sample.fraction < 0) return <span className="dt-hp" />;
  const pct = sample.hp > 0 ? Math.max(1, Math.round(sample.fraction * 100)) : 0;
  return (
    <span
      className="dt-hp"
      style={{ color: hpColor(sample.fraction) }}
      aria-label={`${pct}% health`}
    >
      {pct}%
    </span>
  );
}

function Segment({
  bar,
  scale,
  lane,
  icon,
  onEnter,
  onLeave,
}: {
  bar: Bar;
  scale: number;
  lane: number;
  icon: string | undefined;
  onEnter: (event: React.MouseEvent<HTMLElement>) => void;
  onLeave: () => void;
}): React.JSX.Element {
  const fraction = bar.amount / scale;
  const width = fraction * lane;
  // Whether the icon fits is a question about pixels, not about share of the
  // scale: the same 4% bar is legible in a maximised window and a sliver in a
  // tiled one. A cropped icon is unrecognisable, so it is all or nothing.
  const showIcon = icon !== undefined && width >= ICON_PX + 2;
  // The figure is the thing most often wanted off a bar, and the one the row
  // total cannot give when two abilities share a second. It joins the icon
  // only when both fit whole: a clipped number is a wrong number.
  const figure = `${short(bar.amount)}${bar.crits > 0 ? '*' : ''}`;
  const showFigure = width >= (showIcon ? ICON_PX : 0) + figure.length * DIGIT_PX + 8;

  const detail = [
    bar.label,
    bar.source,
    short(bar.amount),
    bar.hits > 1 ? `${bar.hits} hits` : '',
    bar.crits > 0 ? 'crit' : '',
  ].filter((part) => part !== '');

  return (
    <span
      className={`dt-bar${bar.killing ? ' killing' : ''}`}
      style={{ width: `${fraction * 100}%`, background: bar.color }}
      aria-label={detail.join(' · ')}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {showIcon ? <img className="dt-ico" src={icon} alt="" /> : null}
      {showFigure ? <span className="dt-fig">{figure}</span> : null}
    </span>
  );
}

/**
 * A row's label: how many seconds before the death the row *ends*.
 *
 * Measured from the end rather than the start, so the row the killing blow
 * lands in reads 0 and the one before it reads −1. A row covers a span, not an
 * instant, and either edge could name it — but 0 is the second they died in,
 * and a chart of a death whose rows begin at −1 has nowhere to put the death.
 *
 * Decimals only where the resolution needs them, and the same number of them on
 * every row: a column alternating between −9.5 and −9.75 is harder to scan than
 * one that always carries two places. Zero keeps the decimals and loses the
 * sign, because it is the one row with no direction to point in.
 */
function rowLabel(secondsBefore: number, bucketMs: number): string {
  const places = bucketMs >= 1000 ? 0 : bucketMs >= 500 ? 1 : 2;
  const text = secondsBefore.toFixed(places);
  return secondsBefore <= 0 ? text : `−${text}`;
}

function buildRows(death: DeathReport, bucketMs: number, start: number, end: number): Row[] {
  const count = Math.max(1, Math.round((end - start) / bucketMs));
  /** The bucket a timestamp falls in, or -1 when it is outside the view. */
  const bucketOf = (ts: number): number => {
    if (ts < start || ts > end) return -1;
    return Math.min(count - 1, Math.floor((ts - start) / bucketMs));
  };

  const damage = new Map<string, Bar>();
  const healing = new Map<string, Bar>();
  /** Bucket -> absorbed amount, used only when the shields are not named. */
  const fallbackAbsorbs = new Map<number, number>();
  const add = (into: Map<string, Bar>, key: string, bar: Bar): void => {
    const existing = into.get(key);
    if (existing === undefined) {
      into.set(key, bar);
      return;
    }
    existing.amount += bar.amount;
    existing.hits += bar.hits;
    existing.crits += bar.crits;
    existing.killing = existing.killing || bar.killing;
  };

  for (const hit of death.incoming) {
    const bucket = bucketOf(hit.ts);
    if (bucket < 0) continue;
    const killing =
      death.killingBlow !== null &&
      hit.ts === death.killingBlow.ts &&
      hit.spellId === death.killingBlow.spellId;
    if (hit.amount > 0) {
      add(damage, `${bucket}:${hit.spellId}`, {
        key: `${bucket}:d:${hit.spellId}`,
        label: hit.spellName,
        source: hit.sourceName,
        amount: hit.amount,
        hits: 1,
        crits: hit.critical ? 1 : 0,
        color: damageColor(hit.spellId),
        spellId: hit.spellId,
        killing,
      });
    }
    // Absorbs are added below rather than here. The damage row only carries an
    // amount, and "absorbed 424K" does not say whether that was the healer, a
    // defensive or a trinket — which is the only reason to look.
    if (hit.absorbed > 0) fallbackAbsorbs.set(bucket, (fallbackAbsorbs.get(bucket) ?? 0) + hit.absorbed);
  }

  // An absorb is damage that never landed, so it belongs with the healing: it
  // is the shield doing the healer's job a second early. SPELL_ABSORBED names
  // the shield and its caster, so each one is its own bar.
  for (const absorb of death.absorbsReceived) {
    if (absorb.amount <= 0) continue;
    const bucket = bucketOf(absorb.ts);
    if (bucket < 0) continue;
    add(healing, `${bucket}:a${absorb.spellId}`, {
      key: `${bucket}:h:a${absorb.spellId}`,
      label: absorb.spellName,
      source: absorb.selfApplied ? 'their own' : absorb.sourceName,
      amount: absorb.amount,
      hits: 1,
      crits: 0,
      color: ABSORB_COLOR,
      spellId: absorb.spellId,
      killing: false,
    });
  }
  // A log with no SPELL_ABSORBED lines for these hits still knows how much was
  // absorbed, just not by what. Better an unnamed bar than a missing one.
  if (death.absorbsReceived.length === 0) {
    for (const [bucket, amount] of fallbackAbsorbs) {
      add(healing, `${bucket}:a0`, {
        key: `${bucket}:h:a0`,
        label: 'absorbed',
        source: '',
        amount,
        hits: 1,
        crits: 0,
        color: ABSORB_COLOR,
        spellId: 0,
        killing: false,
      });
    }
  }

  for (const heal of death.healsReceived) {
    if (heal.amount <= 0) continue;
    const bucket = bucketOf(heal.ts);
    if (bucket < 0) continue;
    add(healing, `${bucket}:${heal.spellId}`, {
      key: `${bucket}:h:${heal.spellId}`,
      label: heal.spellName,
      source: heal.sourceName,
      amount: heal.amount,
      hits: 1,
      crits: 0,
      color: healColor(heal.spellId),
      spellId: heal.spellId,
      killing: false,
    });
  }

  // The health shown on a row is where they were left at the end of it, so the
  // row reads as cause then effect: this much damage, this much healing, and
  // this is what it left. A row with no advanced-block event of its own carries
  // the last health known before it rather than a blank, because health does
  // not stop existing in the seconds nothing was logged for. The walk starts at
  // the beginning of the capture rather than of the view, so a view scrolled
  // back still inherits whatever was known before its first row.
  const samples = death.trace.filter((sample) => sample.fraction >= 0);
  let cursor = 0;
  let latest: HpSample | null = null;

  const rows: Row[] = [];
  for (let bucket = 0; bucket < count; bucket++) {
    const bucketEnd = start + (bucket + 1) * bucketMs;
    while (cursor < samples.length && samples[cursor]!.ts <= bucketEnd) latest = samples[cursor++]!;

    const prefix = `${bucket}:`;
    const inBucket = (entries: Map<string, Bar>): Bar[] =>
      [...entries.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, bar]) => bar)
        // Largest nearest the centre line, so the row reads outward.
        .sort((a, b) => b.amount - a.amount);
    const damageBars = inBucket(damage);
    const healingBars = inBucket(healing);
    rows.push({
      key: bucket,
      label: rowLabel((death.ts - bucketEnd) / 1000, bucketMs),
      damage: damageBars,
      healing: healingBars,
      damageTotal: damageBars.reduce((sum, bar) => sum + bar.amount, 0),
      healingTotal: healingBars.reduce((sum, bar) => sum + bar.amount, 0),
      hp: latest,
      isDeathRow: bucket === count - 1 && end >= death.ts,
    });
  }
  // Built oldest first because the health walk has to run forwards, then turned
  // over: the row that killed them is the one being read, and it belongs where
  // the eye lands rather than at the bottom of a list that has to be scrolled
  // past. Reading down the chart therefore runs backwards in time, which the
  // counting-up labels say out loud.
  rows.reverse();
  return rows;
}

/**
 * The auras of one kind that overlap the view, packed into columns.
 *
 * An aura clamped at both ends is dropped. It was up before the capture opened
 * and still up when they died, which in practice means a raid buff, a weapon
 * enchant or a seasonal aura — a full-height bar that says only that the
 * window is a window. What is left is the auras that started, ended, or did
 * both while they were dying, which is the set a recap is asking about.
 *
 * Buffs are narrowed again, to the ones that do something about damage. A real
 * key puts well over a hundred distinct buffs on five players — procs, food,
 * weapon imbues, seasonal trinkets — and a lane carrying all of them answers no
 * question anybody has while reading a death. Whether a spell mitigates is
 * taken from Blizzard's effect data rather than guessed at (see
 * `@mplus/data/defensives`).
 *
 * Debuffs are kept whatever they do — a debuff on someone who then died is
 * worth seeing even if it was only a slow — with one exception. The game writes
 * some of its own bookkeeping on the player as a debuff: Sated, Hypothermia, a
 * spent Demonic Gateway. Those are notes, not events, and the analysis marks
 * them (see `bookkeeping` on `AuraWindow`).
 */
function spans(death: DeathReport, start: number, end: number, buff: boolean): Span[][] {
  const span = Math.max(1, end - start);
  const visible = death.auras
    .filter(
      (aura) =>
        aura.buff === buff &&
        (!buff || aura.defensive) &&
        !aura.bookkeeping &&
        !(aura.openStart && aura.openEnd) &&
        aura.endTs > start &&
        aura.startTs < end,
    )
    .sort((a, b) => a.startTs - b.startTs || a.spellId - b.spellId);

  // Greedy packing: an aura joins the first column it does not overlap, so the
  // common case of a handful of non-overlapping cooldowns stays one column
  // wide and reads as a single track.
  const columns: Span[][] = [];
  const columnEnds: number[] = [];
  for (const aura of visible) {
    const from = Math.max(aura.startTs, start);
    const to = Math.min(aura.endTs, end);
    let index = columnEnds.findIndex((columnEnd) => columnEnd <= aura.startTs);
    if (index < 0) {
      index = columns.length;
      columns.push([]);
    }
    columnEnds[index] = aura.endTs;
    columns[index]!.push({
      key: `${aura.spellId}:${aura.startTs}`,
      aura,
      // The death is at the top of the chart, so later is higher.
      top: ((end - to) / span) * 100,
      height: Math.max(((to - from) / span) * 100, 0),
      color: buff ? healColor(aura.spellId) : damageColor(aura.spellId),
    });
  }
  return columns;
}

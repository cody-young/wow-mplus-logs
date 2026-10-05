import { SegmentKind, type RunForces, type Segment } from '@mplus/analysis';

import { clock, integer, percent } from '../format.js';

interface Props {
  segments: Segment[];
  durationMs: number;
  forces: RunForces;
  selectedId: number | null;
  onSelect(id: number | null): void;
}

/** Block height, and the vertical pitch between stacked rows, in px. */
const BLOCK_H = 20;
const ROW_PITCH = 22;

/**
 * Greedy row packing: first row whose last block has already ended.
 *
 * `slack` is the time a block may need beyond its own length — short segments
 * are drawn at a floor width, so two that merely abut would still collide on
 * screen. Comparing against it keeps the rows honest at any zoom.
 */
function pack(list: Segment[], slack: number): Segment[][] {
  const rows: Segment[][] = [];
  for (const segment of [...list].sort((a, b) => a.startTs - b.startTs || a.id - b.id)) {
    const row = rows.find((candidate) => segment.startTs >= candidate[candidate.length - 1]!.endTs + slack);
    if (row === undefined) rows.push([segment]);
    else row.push(segment);
  }
  return rows;
}

/**
 * What a pull is worth, rather than what was in it.
 *
 * The block is a few dozen pixels of a route, and across a run the mob names
 * are near-identical strings that say nothing about whether a pull was worth
 * taking — the size does. The name is still a hover away in the title.
 */
function mobs(segment: Segment): string {
  const n = segment.enemies.length;
  return `${integer(n)} ${n === 1 ? 'mob' : 'mobs'}`;
}

/**
 * Bosses and pulls on separate lanes, each lane stacked into as many rows as
 * concurrency requires.
 *
 * Segments genuinely run at the same time, and for two different reasons. One
 * is real: a pack dragged into a boss, or a straggler still being killed while
 * the next pack is engaged — both are live at once. The other is an artifact of
 * the window being first-to-last damage on a pack's units: a pack re-engaged
 * after a wipe keeps one window spanning both attempts, death run included, so
 * anything fought in between falls inside it. Either way two blocks want the
 * same pixels, and drawing them on top of each other reads as a glitch rather
 * than as information — so they get their own rows.
 */
export function SegmentTimeline({ segments, durationMs, forces, selectedId, onSelect }: Props): React.JSX.Element {
  const span = Math.max(durationMs, 1);
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const bosses = pack(segments.filter((segment) => segment.kind === SegmentKind.BOSS), span * 0.0035);
  const pulls = pack(segments.filter((segment) => segment.kind === SegmentKind.PULL), span * 0.0035);

  const block = (segment: Segment, row: number): React.JSX.Element => {
    const left = (segment.startTs / span) * 100;
    const width = Math.max(((segment.endTs - segment.startTs) / span) * 100, 0.35);
    const boss = segment.kind === SegmentKind.BOSS;
    // What the pull was worth, when a forces table was found: its share of the
    // count the dungeon's kills have to supply, and the count itself.
    const tallied = !boss && forces.known;
    const share = tallied && forces.required > 0 ? percent(segment.forces / forces.required) : '';
    const count = tallied ? `(${integer(segment.forces)} count)` : '';
    // Dropped pulls keep their ids in `overlaps`; only resolvable ones count.
    const concurrent = segment.overlaps.map((id) => byId.get(id)).filter((other) => other !== undefined);
    const crossKind = concurrent.filter((other) => other.kind !== segment.kind).length;
    const sameKind = concurrent.length - crossKind;
    const notes = [
      crossKind > 0 ? `${crossKind} ${boss ? 'trash pull' : 'boss fight'}${crossKind > 1 ? 's' : ''}` : '',
      sameKind > 0 ? `${sameKind} other ${boss ? 'boss fight' : 'pull'}${sameKind > 1 ? 's' : ''}` : '',
    ].filter((note) => note !== '');
    return (
      <button
        key={segment.id}
        type="button"
        className={`block${boss ? ' boss' : ''}${tallied ? ' tallied' : ''}${selectedId === segment.id ? ' selected' : ''}`}
        style={{ left: `${left}%`, width: `${width}%`, top: 2 + row * ROW_PITCH, height: BLOCK_H }}
        onClick={() => onSelect(selectedId === segment.id ? null : segment.id)}
        title={
          `${boss ? 'Boss' : `Pull ${segment.pullNumber}`}: ${segment.label}\n` +
          `${clock(segment.startTs)}–${clock(segment.endTs)} · ${segment.enemies.length} enemies` +
          // Only when a table was found: "0 count" on a pull of twelve reads as
          // a bug, where no count at all reads as the absence it is.
          (forces.known
            ? ` · ${integer(segment.forces)} count` +
              (forces.required > 0 ? ` (${percent(segment.forces / forces.required)})` : '')
            : '') +
          (notes.length > 0 ? `\noverlaps ${notes.join(' and ')}` : '')
        }
      >
        {/*
          Every part is always written; which of them fit is a question of
          pixels, and the block answers it in CSS as its own query container.
          A share of the run's duration can't: the same 2% is a legible block
          on a long key and a sliver on a short one. What the pull was worth
          outlives how much of it there was, so the tally leads and the mob
          total is the first part to go.
        */}
        {tallied ? (
          <span className="block-tally">
            {share !== '' ? <span className="block-share">{share}</span> : null}
            <span className="block-forces">{count}</span>
          </span>
        ) : null}
        <span className="block-name">{boss ? segment.label : mobs(segment)}</span>
      </button>
    );
  };

  const lane = (label: string, rows: Segment[][]): React.JSX.Element => (
    <div className="lane" style={{ height: 2 + Math.max(rows.length, 1) * ROW_PITCH }}>
      <span className="lane-label">{label}</span>
      {rows.map((row, index) => row.map((segment) => block(segment, index)))}
    </div>
  );

  const pullCount = pulls.reduce((sum, row) => sum + row.length, 0);
  const bossCount = bosses.reduce((sum, row) => sum + row.length, 0);

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h3>Route</h3>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>
          {pullCount} pulls · {bossCount} bosses
          {forces.known
            ? ` · ${integer(forces.counted)}/${integer(forces.required)} count` +
              (forces.required > 0 ? ` (${percent(forces.fraction)})` : '')
            : ''}
          {selectedId !== null ? ' · click again to clear' : ' · click to filter'}
        </span>
      </div>
      <div className="lanes">
        {lane('Bosses', bosses)}
        {lane('Pulls', pulls)}
      </div>
      <div className="axis">
        <span>00:00</span>
        <span>{clock(span / 2)}</span>
        <span>{clock(span)}</span>
      </div>
    </div>
  );
}

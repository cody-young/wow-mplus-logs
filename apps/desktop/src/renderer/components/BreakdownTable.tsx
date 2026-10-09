import { Fragment, useState } from 'react';

import type { ActorBreakdown, BreakdownReport, SpellBreakdown } from '@mplus/analysis';

import type { WclParse } from '../../shared.js';
import { clock, integer, percent, short } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import { Tip, useTip } from './Tip.js';
import { parseColor } from '../wcl.js';

interface Props {
  report: BreakdownReport;
  /** 'taken' names the source of each ability; 'done' names the caster's crit rate. */
  mode: 'done' | 'taken' | 'healing';
  /**
   * Start with every player open. Only the server-rendered smoke test uses it:
   * a string render cannot click, and the ability rows are most of this view.
   */
  defaultExpanded?: boolean;
  /**
   * Warcraft Logs parses by actor index, in a column of their own. Only for the
   * whole key: a parse ranks the run, and beside one pull's numbers it would
   * read as that pull's.
   */
  parses?: Record<number, WclParse>;
}

/** The ability a row describes, and the player whose share it is a share of. */
interface SpellHover {
  spell: SpellBreakdown;
  actor: ActorBreakdown;
}

/** Abilities past this are a long tail of one-hit procs; the row count is noise. */
const SPELL_LIMIT = 25;

/**
 * What the rows measure, stated in the view itself.
 *
 * Without this the three tabs render identically and an expanded row is
 * ambiguous: on `taken` the sub-rows are enemy abilities with enemy sources,
 * which reads as corrupted data if you believe you are looking at `done`.
 * Saying it costs one line and removes the whole class of confusion.
 */
const CAPTION: Record<Props['mode'], string> = {
  done: 'Damage each player dealt. Expand a row for their own abilities, and hover one for the rest of its detail.',
  taken: 'Damage each player took. Expand a row for the enemy abilities that hit them, and hover one for the detail.',
  healing: 'Healing each player did. Expand a row for their own spells, and hover one for the rest of its detail.',
};

/** Where a number would be a lie: no casts to average, no aura to be up. */
const NONE = '—';

/**
 * One column of the expanded ability table.
 *
 * Declared rather than written out three times, because the three tabs want
 * three different column sets out of the same row type and the header and the
 * cells must not be able to disagree about which those are.
 */
interface SpellColumn {
  key: string;
  label: string;
  width: number;
  cell: (row: SpellBreakdown) => string;
  /** Muted, for the columns that are a caveat rather than a measurement. */
  dim?: boolean;
}

/**
 * The columns Warcraft Logs shows for an ability, which is what anyone
 * comparing the two expects to find here.
 *
 * Casts and hits are both there because neither implies the other: one cast of
 * a DoT is a dozen ticks and one cleave is five hits, so an average per cast
 * and an average per hit answer different questions. Damage taken drops the
 * two cast columns outright — those presses were the enemy's and the log does
 * not attribute them to the victim — and keeps the biggest single hit instead,
 * which is the number that explains a death.
 */
function spellColumns(mode: Props['mode'], durationMs: number): SpellColumn[] {
  const seconds = Math.max(durationMs / 1000, 1);
  const amount: SpellColumn = {
    key: 'amount',
    label: 'Amount',
    width: 74,
    cell: (row) => short(row.total),
  };
  const casts: SpellColumn = {
    key: 'casts',
    label: 'Casts',
    width: 56,
    cell: (row) => (row.casts > 0 ? integer(row.casts) : NONE),
  };
  const avgCast: SpellColumn = {
    key: 'avgCast',
    label: 'Avg cast',
    width: 70,
    cell: (row) => (row.casts > 0 ? short(row.total / row.casts) : NONE),
  };
  const hits: SpellColumn = {
    key: 'hits',
    label: 'Hits',
    width: 58,
    cell: (row) => (row.hits > 0 ? integer(row.hits) : NONE),
  };
  const avgHit: SpellColumn = {
    key: 'avgHit',
    label: 'Avg hit',
    width: 70,
    cell: (row) => (row.hits > 0 ? short(row.total / row.hits) : NONE),
  };
  const crit: SpellColumn = {
    key: 'crit',
    label: 'Crit %',
    width: 60,
    cell: (row) => (row.hits > 0 ? percent(row.crits / row.hits) : NONE),
  };
  // A dash rather than 0.0% where there is nothing to report, in this column
  // and the next. Most abilities apply no aura and miss nothing, and a column
  // of twenty-five zeroes buries the two rows where the number means anything.
  const uptime: SpellColumn = {
    key: 'uptime',
    label: 'Uptime %',
    width: 68,
    cell: (row) => (row.uptimeMs > 0 ? percent(row.uptimeMs / durationMs) : NONE),
  };
  const miss: SpellColumn = {
    key: 'miss',
    label: 'Miss %',
    width: 60,
    cell: (row) => (row.misses > 0 ? percent(row.misses / (row.misses + row.hits)) : NONE),
  };
  const biggest: SpellColumn = {
    key: 'biggest',
    label: 'Biggest',
    width: 70,
    cell: (row) => short(row.max),
  };
  const spilled: SpellColumn = {
    key: 'spilled',
    label: mode === 'healing' ? 'Overheal' : 'Overkill',
    width: 76,
    dim: true,
    cell: (row) => (row.wasted > 0 ? short(row.wasted) : NONE),
  };
  const rate: SpellColumn = {
    key: 'rate',
    label: mode === 'healing' ? 'HPS' : mode === 'taken' ? 'DTPS' : 'DPS',
    width: 72,
    cell: (row) => short(row.total / seconds),
  };

  if (mode === 'healing') {
    return [amount, casts, avgCast, hits, avgHit, crit, uptime, spilled, rate];
  }
  if (mode === 'taken') {
    return [amount, hits, avgHit, crit, uptime, biggest, spilled, rate];
  }
  return [amount, casts, avgCast, hits, avgHit, crit, uptime, miss, rate];
}

/**
 * An ability row's identity, which a spell id alone is not: the same ability
 * appears under every player who used it.
 */
const rowKey = (actorIndex: number, spellId: number): string => `${actorIndex}:${spellId}`;

export function BreakdownTable({ report, mode, defaultExpanded = false, parses }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(defaultExpanded ? report.actors.map((actor) => actor.actorIndex) : []),
  );
  // Abilities the game logs under more than one id are shown as one row; this
  // is which of those rows have been opened to show the ids underneath.
  const [openSpells, setOpenSpells] = useState<Set<string>>(() => new Set());
  const tip = useTip<SpellHover>();
  const peak = report.actors[0]?.total ?? 1;
  const rate = mode === 'healing' ? 'HPS' : mode === 'taken' ? 'DTPS' : 'DPS';
  const columns = spellColumns(mode, report.durationMs);
  /**
   * Active %, as Warcraft Logs shows it beside damage and healing. Not on
   * `taken`, where the rows are what was done to them.
   */
  const active = mode !== 'taken';
  /** Span of the player table, which the expanded block sits across. */
  const playerColumns = (mode === 'done' ? 6 : 5) + (parses === undefined ? 0 : 1) + (active ? 1 : 0);

  // Only what is on screen: a run has thousands of spell ids and the expanded
  // rows are a handful of them.
  const icons = useSpellIcons(
    report.actors
      .filter((actor) => expanded.has(actor.actorIndex))
      .flatMap((actor) =>
        actor.spells
          .slice(0, SPELL_LIMIT)
          .flatMap((spell) =>
            openSpells.has(rowKey(actor.actorIndex, spell.spellId))
              ? [spell.spellId, ...(spell.parts ?? []).map((part) => part.spellId)]
              : [spell.spellId],
          ),
      ),
  );

  if (report.actors.length === 0) {
    return <p className="empty">Nothing recorded here.</p>;
  }

  const toggle = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleSpell = (key: string): void => {
    setOpenSpells((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="breakdown-wrap" ref={tip.rootRef}>
      <p className="measure">{CAPTION[mode]}</p>
      {/*
        Fixed layout, because the column widths must not depend on the rows on
        screen: with `auto` every expand re-measures the table from its new
        contents — "1,284 hits" is wider than "284.1K" — and the headers jump
        sideways as rows open and close.
      */}
      <table className="breakdown players">
        <colgroup>
          <col />
          {parses === undefined ? null : <col style={{ width: 56 }} />}
          <col style={{ width: 84 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 68 }} />
          {active ? <col style={{ width: 64 }} /> : null}
          <col style={{ width: 92 }} />
          {mode === 'done' ? <col style={{ width: 132 }} /> : null}
        </colgroup>
        <thead>
          <tr>
            <th className="left">Player</th>
            {parses === undefined ? null : <th>Parse</th>}
            <th>{rate}</th>
            <th>Total</th>
            <th>Share</th>
            {active ? <th>Active</th> : null}
            <th>{mode === 'healing' ? 'Overheal' : 'Overkill'}</th>
            {mode === 'done' ? <th>Support</th> : null}
          </tr>
        </thead>
        <tbody>
          {report.actors.map((actor) => {
            const spec = specOf(actor.specId);
            const open = expanded.has(actor.actorIndex);
            // Scaled to the player's own biggest ability rather than to the
            // party's: expanded, the question is what their damage consisted
            // of, and against the party peak a healer's rows are all slivers.
            const spellPeak = Math.max(1, actor.spells[0]?.total ?? 1);
            return (
              <Fragment key={actor.actorIndex}>
                <tr className="actor" onClick={() => toggle(actor.actorIndex)}>
                  <td className="left barcell">
                    <div
                      className="bar"
                      style={{ width: `${(actor.total / peak) * 100}%`, background: spec.color }}
                    />
                    <span className="namecell">
                      <span className="chev">{open ? '▾' : '▸'}</span>
                      <SpecIcon
                        specId={actor.specId}
                        title={`${shortName(actor.name)} — ${spec.name} ${spec.className}`}
                      />
                      <span className="pname">{shortName(actor.name)}</span>
                      <span className="spec">{spec.name}</span>
                    </span>
                  </td>
                  {parses === undefined ? null : (
                    <td>
                      <ParseBadge parse={parses[actor.actorIndex]} />
                    </td>
                  )}
                  <td>{short(actor.perSecond)}</td>
                  <td>{short(actor.total)}</td>
                  <td>{percent(actor.share)}</td>
                  {active ? (
                    <td>
                      <ActiveCell activeMs={actor.activeMs} durationMs={report.durationMs} mode={mode} />
                    </td>
                  ) : null}
                  <td style={{ color: 'var(--muted)' }}>{short(actor.wasted)}</td>
                  {/*
                    Which side of the support transfer this player is on. Both
                    amounts are already inside the Total beside them — an
                    Augmentation Evoker's Ebon Might is counted as the evoker's
                    damage and taken off the ally's ability — so this column
                    says where it came from, not what to add to anything.
                  */}
                  {mode === 'done' ? (
                    <td style={{ color: 'var(--muted)' }}>
                      {actor.supportGiven > 0 ? `+${short(actor.supportGiven)} enabled` : ''}
                      {actor.supportReceived > 0 ? `−${short(actor.supportReceived)} credited out` : ''}
                    </td>
                  ) : null}
                </tr>
                {open ? (
                  <tr className="nest">
                    {/*
                      The abilities are their own table rather than more rows of
                      this one. They measure different things — casts, averages,
                      uptime — and nine columns of them would either drag the
                      five player columns out of shape or have to be squeezed
                      into them. Nested, each table keeps its own widths.
                    */}
                    <td colSpan={playerColumns}>
                      {/* Scrolls on its own rather than pushing the window
                          wider: nine fixed columns need more room than the
                          five above them, and a narrow window should cost the
                          abilities a scrollbar, not the player rows their
                          layout. */}
                      <div className="nest-scroll">
                        <table className="breakdown abilities">
                          <colgroup>
                            <col />
                            {columns.map((column) => (
                              <col key={column.key} style={{ width: column.width }} />
                            ))}
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="left">
                                {mode === 'taken' ? 'Enemy ability · source' : 'Ability'}
                              </th>
                              {columns.map((column) => (
                                <th key={column.key}>{column.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {actor.spells.slice(0, SPELL_LIMIT).flatMap((spell) => {
                              const key = rowKey(actor.actorIndex, spell.spellId);
                              const parts = spell.parts ?? [];
                              const split = openSpells.has(key);
                              const cells = (row: SpellBreakdown): React.JSX.Element[] =>
                                columns.map((column) => (
                                  <td
                                    key={column.key}
                                    style={column.dim === true ? { color: 'var(--dim)' } : undefined}
                                  >
                                    {column.cell(row)}
                                  </td>
                                ));
                              return [
                                <tr
                                  className="spell"
                                  key={key}
                                  onMouseEnter={tip.show({ spell, actor })}
                                  onMouseLeave={tip.hide}
                                  onClick={parts.length > 0 ? () => toggleSpell(key) : undefined}
                                >
                                  <td className="left barcell">
                                    {/* Same gauge as the player row above it, one scale down. */}
                                    <div
                                      className="bar"
                                      style={{
                                        width: `${Math.max(0, (spell.total / spellPeak) * 100)}%`,
                                        background: spec.color,
                                      }}
                                    />
                                    {/* Only merged rows get a chevron, and the
                                        column holds its width either way so the
                                        names stay in one line down the table. */}
                                    <span className="chev">
                                      {parts.length === 0 ? '' : split ? '▾' : '▸'}
                                    </span>
                                    <span className="name">{spell.name}</span>
                                    {parts.length > 0 && !split ? (
                                      <span style={{ color: 'var(--dim)' }}> · {parts.length} ids</span>
                                    ) : null}
                                    {mode === 'taken' && spell.topSourceName !== '' ? (
                                      <span style={{ color: 'var(--dim)' }}> · {spell.topSourceName}</span>
                                    ) : null}
                                  </td>
                                  {cells(spell)}
                                </tr>,
                                ...(split
                                  ? parts.map((part) => (
                                      <tr
                                        className="spell part"
                                        key={`${key}/${part.spellId}`}
                                        onMouseEnter={tip.show({ spell: part, actor })}
                                        onMouseLeave={tip.hide}
                                      >
                                        <td className="left barcell">
                                          <div
                                            className="bar"
                                            style={{
                                              width: `${Math.max(0, (part.total / spellPeak) * 100)}%`,
                                              background: spec.color,
                                            }}
                                          />
                                          {/* The id, because the whole reason to
                                              open a merged row is that two of its
                                              parts can carry the very same name. */}
                                          <span className="name">{part.name}</span>
                                          <span style={{ color: 'var(--dim)' }}> · {part.spellId}</span>
                                        </td>
                                        {cells(part)}
                                      </tr>
                                    ))
                                  : []),
                              ];
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {tip.data === null ? null : (
        <Tip state={tip} icon={icons.get(tip.data.spell.spellId)}>
          <SpellDetail hover={tip.data} mode={mode} />
        </Tip>
      )}
    </div>
  );
}

/**
 * The numbers the ability table has no column for.
 *
 * Deliberately not a second copy of the row: casts, averages, crit rate and
 * uptime are columns now, so what is left is the breakdown behind them — how
 * much of the player's own total this was, how a crit compares to an ordinary
 * hit, and how much of the hit count was DoT ticks rather than presses.
 */
function SpellDetail({ hover, mode }: { hover: SpellHover; mode: Props['mode'] }): React.JSX.Element {
  const { spell, actor } = hover;
  const share = actor.total > 0 ? spell.total / actor.total : 0;
  const normalHits = spell.hits - spell.crits;
  const normalTotal = spell.total - spell.critTotal;

  return (
    <>
      <strong>{spell.name}</strong>
      <span className="dim">
        {spell.topSourceName !== '' && mode === 'taken'
          ? spell.topSourceName
          : shortName(actor.name)}
      </span>
      <dl className="tip-rows">
        <dt>{mode === 'healing' ? 'Healing' : 'Damage'}</dt>
        <dd>
          {short(spell.total)} · {percent(share)} of this player
        </dd>
        {spell.ticks > 0 ? (
          <>
            <dt>Ticks</dt>
            <dd>
              {integer(spell.ticks)} of {integer(spell.hits)} hits
            </dd>
          </>
        ) : null}
        {spell.misses > 0 ? (
          <>
            <dt>Avoided</dt>
            <dd>{integer(spell.misses)}</dd>
          </>
        ) : null}
        {spell.crits > 0 ? (
          <>
            <dt>Avg crit</dt>
            <dd>{short(spell.critTotal / spell.crits)}</dd>
          </>
        ) : null}
        {/* Only worth the line when it differs from the average hit, which it
            does the moment any of them crit. */}
        {spell.crits > 0 && normalHits > 0 ? (
          <>
            <dt>Avg normal</dt>
            <dd>{short(normalTotal / normalHits)}</dd>
          </>
        ) : null}
        <dt>Biggest</dt>
        <dd>{short(spell.max)}</dd>
        {spell.wasted > 0 ? (
          <>
            <dt>{mode === 'healing' ? 'Overheal' : 'Overkill'}</dt>
            <dd>{short(spell.wasted)}</dd>
          </>
        ) : null}
      </dl>
    </>
  );
}

/**
 * A player's Warcraft Logs percentile, in the site's colours. The number is
 * the bracket percentile — same spec, same keystone level — because that is
 * the one a report page shows for a key; the overall one is in the hover with
 * the site's own rate, which divides by a slightly different clock and so
 * need not match the number beside it.
 */
function ParseBadge({ parse }: { parse: WclParse | undefined }): React.JSX.Element | null {
  if (parse === undefined) return null;
  const shown = parse.bracketPercent ?? parse.rankPercent;
  const detail = [
    parse.bracketPercent === null ? null : `${Math.floor(parse.bracketPercent)} at this key level`,
    `${Math.floor(parse.rankPercent)} overall`,
    parse.amount === null ? null : `Warcraft Logs reads ${short(parse.amount)}/s`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  return (
    <span className="parse" style={{ color: parseColor(shown) }} title={detail}>
      {Math.floor(shown)}
    </span>
  );
}

/**
 * How much of the window a player was active: all of it but the stretches of
 * over ten seconds without a row in this table. Warcraft Logs' rule, to the
 * millisecond, so the two read alike. See `ACTIVE_GAP_MS` in the analysis.
 */
function ActiveCell({
  activeMs,
  durationMs,
  mode,
}: {
  activeMs: number;
  durationMs: number;
  mode: Props['mode'];
}): React.JSX.Element {
  const doing = mode === 'healing' ? 'healing' : 'dealing damage';
  return (
    <span title={`Active for ${clock(activeMs)} of ${clock(durationMs)}: all but the stretches of over 10 seconds without ${doing}`}>
      {percent(activeMs / Math.max(durationMs, 1))}
    </span>
  );
}

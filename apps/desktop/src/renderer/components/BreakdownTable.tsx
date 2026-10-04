import { Fragment, useState } from 'react';

import type { ActorBreakdown, BreakdownReport, SpellBreakdown } from '@mplus/analysis';

import { integer, percent, short } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import { Tip, useTip } from './Tip.js';

interface Props {
  report: BreakdownReport;
  /** 'taken' names the source of each ability; 'done' names the caster's crit rate. */
  mode: 'done' | 'taken' | 'healing';
  /**
   * Start with every player open. Only the server-rendered smoke test uses it:
   * a string render cannot click, and the ability rows are most of this view.
   */
  defaultExpanded?: boolean;
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
  done: 'Damage each player dealt. Expand a row for their own abilities, and hover one for its casts and averages.',
  taken: 'Damage each player took. Expand a row for the enemy abilities that hit them, and hover one for the detail.',
  healing: 'Healing each player did. Expand a row for their own spells, and hover one for its casts and averages.',
};

export function BreakdownTable({ report, mode, defaultExpanded = false }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(defaultExpanded ? report.actors.map((actor) => actor.actorIndex) : []),
  );
  const tip = useTip<SpellHover>();
  const peak = report.actors[0]?.total ?? 1;
  const rate = mode === 'healing' ? 'HPS' : mode === 'taken' ? 'DTPS' : 'DPS';

  // Only what is on screen: a run has thousands of spell ids and the expanded
  // rows are a handful of them.
  const icons = useSpellIcons(
    report.actors
      .filter((actor) => expanded.has(actor.actorIndex))
      .flatMap((actor) => actor.spells.slice(0, SPELL_LIMIT).map((spell) => spell.spellId)),
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
          <col style={{ width: 84 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 68 }} />
          <col style={{ width: 92 }} />
          {mode === 'done' ? <col style={{ width: 132 }} /> : null}
        </colgroup>
        <thead>
          <tr>
            <th className="left">Player</th>
            <th>{rate}</th>
            <th>Total</th>
            <th>Share</th>
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
                  <td>{short(actor.perSecond)}</td>
                  <td>{short(actor.total)}</td>
                  <td>{percent(actor.share)}</td>
                  <td style={{ color: 'var(--muted)' }}>{short(actor.wasted)}</td>
                  {mode === 'done' ? (
                    <td style={{ color: 'var(--muted)' }}>
                      {actor.supportGiven > 0 ? `+${short(actor.supportGiven)} given` : ''}
                      {actor.supportReceived > 0 ? `${short(actor.supportReceived)} aided` : ''}
                    </td>
                  ) : null}
                </tr>
                {open ? (
                  <tr className="spell subhead">
                    <td className="left">{mode === 'taken' ? 'Enemy ability · source' : 'Ability'}</td>
                    <td>Hits</td>
                    <td>Total</td>
                    <td>Share</td>
                    <td>{mode === 'taken' ? 'Biggest' : 'Crit'}</td>
                    {mode === 'done' ? <td /> : null}
                  </tr>
                ) : null}
                {open
                  ? actor.spells.slice(0, SPELL_LIMIT).map((spell) => (
                      <tr
                        className="spell"
                        key={spell.spellId}
                        onMouseEnter={tip.show({ spell, actor })}
                        onMouseLeave={tip.hide}
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
                          <span className="name">{spell.name}</span>
                          {mode === 'taken' && spell.topSourceName !== '' ? (
                            <span style={{ color: 'var(--dim)' }}> · {spell.topSourceName}</span>
                          ) : null}
                        </td>
                        <td>{integer(spell.hits)}</td>
                        <td>{short(spell.total)}</td>
                        <td>{percent(actor.total > 0 ? spell.total / actor.total : 0)}</td>
                        <td>
                          {spell.hits > 0 && mode !== 'taken'
                            ? percent(spell.crits / spell.hits)
                            : short(spell.max)}
                        </td>
                        {mode === 'done' ? <td /> : null}
                      </tr>
                    ))
                  : null}
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
 * The numbers a table row has no column for.
 *
 * Per-cast averages are the ones worth hovering for: hits alone cannot be read
 * as "how hard does this hit", because one cast of a DoT is a dozen ticks and
 * one cleave is five hits on five targets.
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
          {short(spell.total)} · {percent(share)}
        </dd>
        {spell.casts > 0 ? (
          <>
            <dt>Casts</dt>
            <dd>{integer(spell.casts)}</dd>
            <dt>Per cast</dt>
            <dd>{short(spell.total / spell.casts)}</dd>
          </>
        ) : null}
        <dt>Hits</dt>
        <dd>
          {integer(spell.hits)}
          {spell.ticks > 0 ? ` · ${integer(spell.ticks)} ticks` : ''}
        </dd>
        {spell.hits > 0 ? (
          <>
            <dt>Avg hit</dt>
            <dd>{short(spell.total / spell.hits)}</dd>
            <dt>Crit rate</dt>
            <dd>{percent(spell.crits / spell.hits)}</dd>
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

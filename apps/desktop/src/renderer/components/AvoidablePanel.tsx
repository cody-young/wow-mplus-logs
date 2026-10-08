import { Fragment, useMemo, useState } from 'react';

import { summarizeAvoidable } from '@mplus/analysis';

import { clock, integer, short } from '../format.js';
import { useSpellDescriptions, useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import { Tip, useTip } from './Tip.js';
import type { AvoidableReport } from '../../shared.js';

/**
 * Superiority Assister: Elitism Helper's avoidable-damage report, from the log.
 *
 * Who stood in what. Every hit here is on a hand-kept list of puddles, swirls,
 * frontals and death explosions — `@mplus/data/avoidable` — and everything
 * else a player took is the Damage Taken tab's business. Amounts are that
 * tab's net figure, so the two agree. Blizzard's own avoidable flag was tried
 * beside the list and dropped: too much of what it flags is not avoidable.
 *
 * The worst offender is first, the way the addon's end-of-dungeon report read;
 * a player with nothing on them is not listed at all, which in this tab is
 * the good outcome.
 *
 * Hovering a spell, in a player's hits or in what the party stood in, shows
 * its in-game description, so a name like "Shadow Burst" says what it was.
 */

/** Abilities past this in the party list are a tail of one-offs. */
const ABILITY_LIMIT = 18;

/** The spell under the pointer. */
type SpellHover = { spellId: number; name: string };

export function AvoidablePanel({
  avoidable,
  defaultExpanded = false,
}: {
  avoidable: AvoidableReport;
  /**
   * Start with every player's hits open. Only the server-rendered smoke test
   * uses it: a string render cannot click.
   */
  defaultExpanded?: boolean;
}): React.JSX.Element {
  const hits = avoidable.hits;
  const summary = useMemo(() => summarizeAvoidable(hits), [hits]);
  const spellIds = useMemo(() => [...new Set(hits.map((hit) => hit.spellId))], [hits]);
  const icons = useSpellIcons(spellIds);
  const descriptions = useSpellDescriptions(spellIds);
  const tip = useTip<SpellHover>();
  const hovered = tip.data === null ? undefined : descriptions.get(tip.data.spellId);
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(defaultExpanded ? hits.map((hit) => hit.actorIndex) : []),
  );

  if (!avoidable.covered) {
    return (
      <div className="empty">
        <h2>Not on the list</h2>
        <p>
          What counts as avoidable is a hand-kept list of this season&apos;s dungeons, and this
          one is not on it. Nothing here was checked, so this is not a clean run — just an
          unmarked one.
        </p>
      </div>
    );
  }

  if (summary.hits === 0) {
    return (
      <div className="empty">
        <h2>No avoidable damage</h2>
        <p>Nobody stood in anything on the list. Superior.</p>
      </div>
    );
  }

  const toggle = (actorIndex: number): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(actorIndex)) next.delete(actorIndex);
      else next.add(actorIndex);
      return next;
    });
  };

  const peak = Math.max(1, ...summary.actors.map((actor) => actor.amount));

  return (
    <div className="breakdown-wrap" ref={tip.rootRef}>
      <p className="measure">
        Damage from things a careful player takes none of: puddles, swirls, frontals, beams and
        death explosions, from a hand-kept list of this season&apos;s dungeons. A frontal aimed at
        the tank counts against everyone but the tank. Expand a row for every hit, newest first.
      </p>

      <table className="breakdown players avoid-table">
        <colgroup>
          <col />
          <col style={{ width: 66 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="left">Player</th>
            <th>Hits</th>
            <th title="Times an avoidable hit was the killing blow">Deaths</th>
            <th>Damage</th>
          </tr>
        </thead>
        <tbody>
          {summary.actors.map((actor) => {
            const open = expanded.has(actor.actorIndex);
            const spec = specOf(actor.specId);
            // Newest first, like every other list in the app.
            const mine = open ? hits.filter((hit) => hit.actorIndex === actor.actorIndex).reverse() : [];
            return (
              <Fragment key={actor.actorIndex}>
                <tr className="actor" onClick={() => toggle(actor.actorIndex)}>
                  <td className="left barcell">
                    <div
                      className="bar"
                      style={{ width: `${(actor.amount / peak) * 100}%`, background: spec.color }}
                    />
                    <span className="namecell">
                      <span className="chev">{open ? '▾' : '▸'}</span>
                      <SpecIcon
                        specId={actor.specId}
                        title={`${shortName(actor.name)} — ${spec.name} ${spec.className}`}
                      />
                      <span className="pname">{shortName(actor.name)}</span>
                      <span className="spec">
                        {actor.abilities
                          .slice(0, 3)
                          .map((ability) => ability.name)
                          .join(', ')}
                      </span>
                    </span>
                  </td>
                  <td>{integer(actor.hits)}</td>
                  <td className={actor.deaths > 0 ? 'avoid-fatal' : 'zero'}>{integer(actor.deaths)}</td>
                  <td>{short(actor.amount)}</td>
                </tr>
                {open ? (
                  <tr className="nest">
                    <td colSpan={4}>
                      <div className="nest-scroll">
                        <table className="breakdown abilities interrupt-log">
                          <colgroup>
                            <col style={{ width: 66 }} />
                            <col style={{ width: 240 }} />
                            <col />
                            <col style={{ width: 92 }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="left">Time</th>
                              <th className="left">Ability</th>
                              <th className="left">From</th>
                              <th>Damage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mine.map((hit, index) => (
                              <tr className="spell" key={`${hit.ts}:${hit.spellId}:${index}`}>
                                <td className="left">{clock(hit.ts)}</td>
                                <td
                                  className="left"
                                  onMouseEnter={tip.show({ spellId: hit.spellId, name: hit.spellName })}
                                  onMouseLeave={tip.hide}
                                >
                                  <span className="namecell">
                                    <SpellIcon url={icons.get(hit.spellId)} name={hit.spellName} />
                                    <span className="name">{hit.spellName}</span>
                                  </span>
                                </td>
                                <td className="left" style={{ color: 'var(--muted)' }}>
                                  {hit.sourceName}
                                </td>
                                <td className={hit.fatal ? 'avoid-fatal' : undefined}>
                                  {short(hit.amount)}
                                  {hit.fatal ? ' ☠' : ''}
                                </td>
                              </tr>
                            ))}
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

      <div className="panel" style={{ marginTop: 14 }}>
        <h3>
          What the party stood in — {short(summary.amount)} over {integer(summary.hits)} hits
        </h3>
        <div className="hits">
          {summary.abilities.slice(0, ABILITY_LIMIT).map((ability) => (
            <div
              className="hit"
              key={ability.name}
              onMouseEnter={tip.show({ spellId: ability.spellId, name: ability.name })}
              onMouseLeave={tip.hide}
            >
              <span className="t">{short(ability.amount)}</span>
              <span className="namecell">
                <SpellIcon url={icons.get(ability.spellId)} name={ability.name} />
                <span>
                  {ability.name}
                  <span className="src">
                    {' '}
                    · {integer(ability.hits)} {ability.hits === 1 ? 'hit' : 'hits'} on{' '}
                    {ability.players} {ability.players === 1 ? 'player' : 'players'}
                    {ability.deaths > 0 ? ` · ${ability.deaths} ☠` : ''}
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {tip.data === null || hovered === undefined ? null : (
        <Tip state={tip} icon={icons.get(tip.data.spellId)}>
          <strong>{tip.data.name}</strong>
          <span className="tip-desc">{hovered}</span>
        </Tip>
      )}
    </div>
  );
}

/** A spell's art where there is any, and its box either way. */
function SpellIcon({ url, name }: { url: string | undefined; name: string }): React.JSX.Element {
  return (
    <span className="spell-ico">
      {url === undefined ? null : <img src={url} alt="" width={16} height={16} />}
    </span>
  );
}

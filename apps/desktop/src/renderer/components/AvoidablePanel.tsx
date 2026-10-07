import { Fragment, useMemo, useState } from 'react';

import {
  combinedAvoidable,
  summarizeAvoidable,
  type AvoidableHit,
  type AvoidableSummary,
} from '@mplus/analysis';

import { clock, integer, short } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import type { AvoidableReport } from '../../shared.js';

/**
 * Superiority Assister: Elitism Helper's avoidable-damage report, from the log.
 *
 * Who stood in what, counted three ways while it is decided which one the tab
 * keeps: our hand-kept list of puddles, swirls, frontals and death explosions
 * (`@mplus/data/avoidable`), Blizzard's own avoidable flag on the spell, and
 * the flag with the list filling its gaps. Amounts are the Damage Taken tab's
 * net figure, so they agree with it.
 *
 * At the top, all three sides' player bars on one scale, so they compare at a
 * glance. Below, each side gets the full report: players worst first, each
 * expandable into every hit, then what the party stood in. A player with
 * nothing on them is not listed at all, which here is the good outcome.
 */

/** Abilities past this in the party list are a tail of one-offs. */
const ABILITY_LIMIT = 18;

type Player = { actorIndex: number; name: string; specId: number };

export function AvoidablePanel({
  avoidable,
  defaultExpanded = false,
}: {
  avoidable: AvoidableReport;
  /**
   * Start with every player's hits open in every section. Only the
   * server-rendered smoke test uses it: a string render cannot click.
   */
  defaultExpanded?: boolean;
}): React.JSX.Element {
  const combinedHits = useMemo(() => combinedAvoidable(avoidable), [avoidable]);
  const ours = useMemo(() => summarizeAvoidable(avoidable.hits), [avoidable.hits]);
  const theirs = useMemo(() => summarizeAvoidable(avoidable.blizzard), [avoidable.blizzard]);
  const combined = useMemo(() => summarizeAvoidable(combinedHits), [combinedHits]);
  const icons = useSpellIcons(
    useMemo(
      () => [...new Set([...avoidable.hits, ...avoidable.blizzard].map((hit) => hit.spellId))],
      [avoidable.hits, avoidable.blizzard],
    ),
  );

  // One order and one scale for every side, so a player's bars sit at the
  // same height and their lengths compare directly. The combined side has
  // every player either of the others has, so it sets the order.
  const players = useMemo(() => {
    const byIndex = new Map<number, Player>();
    for (const actor of [...combined.actors, ...ours.actors, ...theirs.actors]) {
      if (!byIndex.has(actor.actorIndex)) byIndex.set(actor.actorIndex, actor);
    }
    return [...byIndex.values()];
  }, [combined, ours, theirs]);
  const peak = Math.max(
    1,
    ...[ours, theirs, combined].flatMap((summary) => summary.actors.map((actor) => actor.amount)),
  );

  const methods = [
    {
      key: 'ours',
      title: 'Ours — hand-kept list',
      hits: avoidable.hits,
      summary: ours,
      note: 'Only spells on our list, and only in dungeons the list covers. A tank is not charged for a frontal aimed at them.',
      uncovered: !avoidable.covered,
      none: 'No avoidable damage: nobody stood in anything on the list. Superior.',
    },
    {
      key: 'blizzard',
      title: "Blizzard's — spell flag",
      hits: avoidable.blizzard,
      summary: theirs,
      note: "Every spell Blizzard's data flags as avoidable, in any dungeon. No tank rule: a flagged frontal counts against whoever it hits.",
      uncovered: false,
      none: 'Nobody took a hit Blizzard flags as avoidable.',
    },
    {
      key: 'combined',
      title: 'Combined — flag plus list',
      hits: combinedHits,
      summary: combined,
      note: "Blizzard's side, plus hits from our list on spells the flag misses. Flagged spells follow Blizzard's rules; list-only spells follow ours, and so do the few flagged spells our list overrules, such as Infest's DoT.",
      uncovered: false,
      none: 'Nobody took a hit under the flag or on the list.',
    },
  ];

  return (
    <div className="breakdown-wrap">
      <div className="dev-note">
        <strong>* In development.</strong> Our hand-kept list beside Blizzard&apos;s own avoidable flag
        (SpellMisc attribute 15, bit 22), which is read as the flag behind the in-game meter&apos;s
        Avoidable Damage Taken but has not been checked against it. Combined is Blizzard&apos;s flag
        plus anything on our list the flag misses. Ours skips frontals aimed at the tank for tanks;
        Blizzard&apos;s side has no such rule, and Combined follows Blizzard&apos;s for any spell it
        flags.
      </div>

      {players.length > 0 ? (
        <div className="compare-grid">
          {methods.map((method) => (
            <Side
              key={method.key}
              title={method.title}
              summary={method.summary}
              players={players}
              peak={peak}
              empty={method.uncovered ? 'This dungeon is not on the list.' : null}
            />
          ))}
        </div>
      ) : null}

      {methods.map((method) => (
        <section key={method.key} className="avoid-section">
          <MethodSection
            title={method.title}
            note={method.note}
            hits={method.hits}
            summary={method.summary}
            uncovered={method.uncovered}
            none={method.none}
            icons={icons}
            defaultExpanded={defaultExpanded}
          />
        </section>
      ))}
    </div>
  );
}

/** One side's player bars, in the shared order and on the shared scale. */
function Side({
  title,
  summary,
  players,
  peak,
  empty,
}: {
  title: string;
  summary: AvoidableSummary;
  players: readonly Player[];
  peak: number;
  empty: string | null;
}): React.JSX.Element {
  const byIndex = new Map(summary.actors.map((actor) => [actor.actorIndex, actor]));
  return (
    <div className="panel">
      <h3>
        {title} — {short(summary.amount)}, {integer(summary.hits)} hits
      </h3>
      {empty !== null ? (
        <p className="measure">{empty}</p>
      ) : (
        <table className="breakdown players avoid-table">
          <colgroup>
            <col />
            <col style={{ width: 56 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="left">Player</th>
              <th>Hits</th>
              <th>Damage</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => {
              const actor = byIndex.get(player.actorIndex);
              const spec = specOf(player.specId);
              const amount = actor?.amount ?? 0;
              return (
                <tr key={player.actorIndex}>
                  <td className="left barcell">
                    <div className="bar" style={{ width: `${(amount / peak) * 100}%`, background: spec.color }} />
                    <span className="namecell">
                      <SpecIcon
                        specId={player.specId}
                        title={`${shortName(player.name)} — ${spec.name} ${spec.className}`}
                      />
                      <span className="pname">{shortName(player.name)}</span>
                    </span>
                  </td>
                  <td className={actor === undefined ? 'zero' : undefined}>{integer(actor?.hits ?? 0)}</td>
                  <td className={actor === undefined ? 'zero' : undefined}>{short(amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** One side's full report: its players, each one's hits, and what the party stood in. */
function MethodSection({
  title,
  note,
  hits,
  summary,
  uncovered,
  none,
  icons,
  defaultExpanded,
}: {
  title: string;
  note: string;
  hits: readonly AvoidableHit[];
  summary: AvoidableSummary;
  /** The hand-kept list does not cover this dungeon, so nothing was checked. */
  uncovered: boolean;
  /** What to say when this side counted nothing. */
  none: string;
  icons: ReadonlyMap<number, string>;
  defaultExpanded: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(defaultExpanded ? hits.map((hit) => hit.actorIndex) : []),
  );

  const heading = (
    <h3 className="dispel-title">
      {title}
      {summary.hits > 0 ? ` — ${short(summary.amount)} over ${integer(summary.hits)} hits` : ''}
    </h3>
  );

  if (uncovered) {
    return (
      <>
        {heading}
        <div className="empty">
          <h2>Not on the list</h2>
          <p>
            What counts as avoidable is a hand-kept list of this season&apos;s dungeons, and this
            one is not on it. Nothing here was checked, so this is not a clean run — just an
            unmarked one.
          </p>
        </div>
      </>
    );
  }

  if (summary.hits === 0) {
    return (
      <>
        {heading}
        <p className="measure">{none}</p>
      </>
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
    <>
      {heading}
      <p className="measure">{note} Expand a row for every hit, newest first.</p>

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
                                <td className="left">
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
            <div className="hit" key={ability.name}>
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
    </>
  );
}

/** A spell's art where there is any, and its box either way. */
function SpellIcon({ url, name }: { url: string | undefined; name: string }): React.JSX.Element {
  return (
    <span className="spell-ico">
      {url === undefined ? null : <img src={url} alt="" width={16} height={16} title={name} />}
    </span>
  );
}

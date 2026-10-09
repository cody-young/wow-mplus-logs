import { Fragment, useMemo, useRef, useState } from 'react';

import { DISPEL_KINDS, summarizeDispels, type DispelKind } from '@mplus/analysis';

import { clock, integer } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import type { DispelRecord, DispelReport } from '../../shared.js';

/**
 * Dispels, which are three different jobs that share a word.
 *
 * Purging a mob's shield, soothing its enrage and cleansing a curse off the
 * healer are pressed by different people for different reasons, and a single
 * "dispels: 40" hides which of those happened. So the tab opens with all three
 * stacked per player — who did how much of which — and then gives each its
 * own section below, where the question changes from "how much" to "what came
 * off, and off whom".
 *
 * Every number is an aura removed rather than a press. The log reports
 * removals and nothing else; a Purge on a mob with nothing to purge writes no
 * line, so presses here are only the ones that took something.
 */

const KIND_META: Record<DispelKind, { title: string; one: string; why: string }> = {
  purge: {
    title: 'Purges',
    one: 'purge',
    why: 'Magic taken off an enemy — Purge, Dispel Magic, Spellsteal, Consume Magic. A stolen buff is the mage’s now.',
  },
  soothe: {
    title: 'Soothes',
    one: 'soothe',
    why: 'Enrages taken off an enemy — Soothe, Shiv, Tranquilizing Shot. Decided by what came off, so a Tranquilizing Shot that took a magic buff is a purge.',
  },
  cleanse: {
    title: 'Friendly dispels',
    one: 'cleanse',
    why: 'Magic, curses, poisons, diseases and bleeds taken off the party. A cleansing totem’s pulse counts for its shaman.',
  },
};

/** Auras past this are a tail of one-offs. */
const AURA_LIMIT = 18;

export function DispelsPanel({
  dispels,
  defaultExpanded = false,
}: {
  dispels: DispelReport;
  /**
   * Start with every player's log open in every section. Only the
   * server-rendered smoke test uses it: a string render cannot click.
   */
  defaultExpanded?: boolean;
}): React.JSX.Element {
  const list = dispels.dispels;
  const all = useMemo(() => summarizeDispels(list), [list]);
  const byKind = useMemo(() => {
    const split = {} as Record<DispelKind, DispelRecord[]>;
    for (const kind of DISPEL_KINDS) split[kind] = list.filter((entry) => entry.kind === kind);
    return split;
  }, [list]);

  const icons = useSpellIcons(
    useMemo(() => [...new Set(list.flatMap((entry) => [entry.spellId, entry.auraId]))], [list]),
  );

  const sections = useRef<Partial<Record<DispelKind, HTMLElement | null>>>({});

  if (all.removed === 0) {
    return (
      <div className="empty">
        <h2>No dispels</h2>
        <p>
          Nobody purged, soothed or cleansed anything here — or what they pressed found nothing to
          remove, which leaves no trace in the log.
        </p>
      </div>
    );
  }

  const peak = Math.max(1, ...all.actors.map((actor) => actor.removed));

  return (
    <div className="breakdown-wrap">
      <p className="measure">
        Auras each player took off, by kind: magic off enemies, enrages off enemies, and harmful
        effects off the party. Each kind has its own section below.
      </p>

      <section className="dispel-section">
        <h3 className="dispel-title">
          All dispels — {integer(all.removed)} removed, {integer(all.casts)} casts
        </h3>
        <div className="dispel-legend">
          {DISPEL_KINDS.map((kind) => (
            <button
              type="button"
              key={kind}
              className="dispel-key"
              data-tip={`${KIND_META[kind].why} Jump to the section.`}
              onClick={() =>
                sections.current[kind]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              <span className={`swatch ${kind}`} />
              {KIND_META[kind].title} <span className="n">{integer(all.byKind[kind])}</span>
            </button>
          ))}
        </div>

        <table className="breakdown players dispel-stack">
          <colgroup>
            <col style={{ width: 190 }} />
            <col />
            <col style={{ width: 74 }} />
            <col style={{ width: 74 }} />
            <col style={{ width: 74 }} />
            <col style={{ width: 66 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="left">Player</th>
              <th className="left" />
              <th>Purges</th>
              <th>Soothes</th>
              <th>Friendly</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {all.actors.map((actor) => (
              <tr key={actor.actorIndex}>
                <td className="left">
                  <span className="namecell">
                    <SpecIcon specId={actor.specId} title={specTitle(actor.name, actor.specId)} />
                    <span className="pname" style={{ color: specOf(actor.specId).color }}>
                      {shortName(actor.name)}
                    </span>
                  </span>
                </td>
                <td className="left">
                  {/* Scaled to the busiest player's total, so the lengths
                      compare across rows and the colours within one. */}
                  <div className="stack" style={{ width: `${(actor.removed / peak) * 100}%` }}>
                    {DISPEL_KINDS.filter((kind) => actor.byKind[kind] > 0).map((kind) => (
                      <span
                        key={kind}
                        className={`seg ${kind}`}
                        style={{ flexGrow: actor.byKind[kind] }}
                        data-tip={`${shortName(actor.name)}: ${actor.byKind[kind]} ${KIND_META[kind].title.toLowerCase()}`}
                      />
                    ))}
                  </div>
                </td>
                {DISPEL_KINDS.map((kind) => (
                  <td key={kind} className={actor.byKind[kind] === 0 ? 'zero' : undefined}>
                    {integer(actor.byKind[kind])}
                  </td>
                ))}
                <td>{integer(actor.removed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {DISPEL_KINDS.map((kind) => (
        <section
          key={kind}
          className="dispel-section"
          ref={(element) => {
            sections.current[kind] = element;
          }}
        >
          <KindSection
            kind={kind}
            entries={byKind[kind]}
            icons={icons}
            defaultExpanded={defaultExpanded}
          />
        </section>
      ))}
    </div>
  );
}

/** One kind's players, their logs, and what came off. */
function KindSection({
  kind,
  entries,
  icons,
  defaultExpanded,
}: {
  kind: DispelKind;
  entries: readonly DispelRecord[];
  icons: ReadonlyMap<number, string>;
  defaultExpanded: boolean;
}): React.JSX.Element {
  const meta = KIND_META[kind];
  const summary = useMemo(() => summarizeDispels(entries), [entries]);
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(defaultExpanded ? entries.map((entry) => entry.actorIndex) : []),
  );

  const toggle = (actorIndex: number): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(actorIndex)) next.delete(actorIndex);
      else next.add(actorIndex);
      return next;
    });
  };

  const heading = (
    <h3 className="dispel-title">
      <span className={`swatch ${kind}`} />
      {meta.title} — {integer(summary.removed)} removed
      {summary.removed > 0 ? `, ${integer(summary.casts)} casts` : ''}
    </h3>
  );

  if (summary.removed === 0) {
    return (
      <>
        {heading}
        <p className="measure">None here. {meta.why}</p>
      </>
    );
  }

  const peak = Math.max(1, ...summary.actors.map((actor) => actor.removed));
  // A cleanse is taken off a player and a purge off a mob, and the column says
  // which so the reader is not left to work it out from the names.
  const offWhom = kind === 'cleanse' ? 'Off' : 'Target';
  // Only a player's name carries a realm to trim. An enemy's can have a dash
  // of its own — Blood-Crazed Wolf — that shortName would cut at.
  const unit = kind === 'cleanse' ? shortName : (name: string): string => name;

  return (
    <>
      {heading}
      <p className="measure">{meta.why} Expand a row for every one, newest first.</p>

      <table className="breakdown players">
        <colgroup>
          <col />
          <col style={{ width: 72 }} />
          <col style={{ width: 84 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="left">Player</th>
            <th>Casts</th>
            <th>Removed</th>
          </tr>
        </thead>
        <tbody>
          {summary.actors.map((actor) => {
            const open = expanded.has(actor.actorIndex);
            // Newest first, like every other list in the app.
            const mine = entries.filter((entry) => entry.actorIndex === actor.actorIndex).reverse();
            return (
              <Fragment key={actor.actorIndex}>
                <tr className="actor" onClick={() => toggle(actor.actorIndex)}>
                  <td className="left barcell">
                    <div
                      className={`bar ${kind}`}
                      style={{ width: `${(actor.removed / peak) * 100}%` }}
                    />
                    <span className="namecell">
                      <span className="chev">{open ? '▾' : '▸'}</span>
                      <SpecIcon specId={actor.specId} title={specTitle(actor.name, actor.specId)} />
                      <span className="pname">{shortName(actor.name)}</span>
                      <span className="spec">
                        {actor.abilities.map((ability) => ability.name).join(', ')}
                      </span>
                    </span>
                  </td>
                  <td>{integer(actor.casts)}</td>
                  <td>{integer(actor.removed)}</td>
                </tr>
                {open ? (
                  <tr className="nest">
                    <td colSpan={3}>
                      <div className="nest-scroll">
                        <table className="breakdown abilities interrupt-log">
                          <colgroup>
                            <col style={{ width: 66 }} />
                            <col style={{ width: 210 }} />
                            <col style={{ width: 230 }} />
                            <col />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="left">Time</th>
                              <th className="left">Dispel</th>
                              <th className="left">Removed</th>
                              <th className="left">{offWhom}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mine.map((entry, index) => (
                              <tr className="spell" key={`${entry.ts}:${entry.auraId}:${index}`}>
                                <td className="left">{clock(entry.ts)}</td>
                                <td className="left">
                                  <span className="namecell">
                                    <SpellIcon url={icons.get(entry.spellId)} name={entry.spellName} />
                                    <span className="name">{entry.spellName}</span>
                                    {/* Whose hands it was in, when they were
                                        not the player's: an imp's Singe Magic,
                                        a totem's pulse. */}
                                    {entry.petName === '' ? null : (
                                      <span style={{ color: 'var(--dim)' }}>{entry.petName}</span>
                                    )}
                                  </span>
                                </td>
                                <td className="left">
                                  <span className="namecell">
                                    <SpellIcon url={icons.get(entry.auraId)} name={entry.auraName} />
                                    <span className="name">{entry.auraName}</span>
                                    {entry.stolen ? (
                                      <span style={{ color: 'var(--dim)' }}>stolen</span>
                                    ) : null}
                                  </span>
                                </td>
                                <td className="left">{unit(entry.targetName)}</td>
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
        <h3>What came off</h3>
        <div className="hits">
          {summary.auras.slice(0, AURA_LIMIT).map((aura) => (
            <div className="hit" key={aura.auraId}>
              <span className="t">×{aura.count}</span>
              <span className="namecell">
                <SpellIcon url={icons.get(aura.auraId)} name={aura.name} />
                <span>
                  {aura.name}
                  {aura.targetName === '' ? null : (
                    <span className="src">
                      {' '}
                      · mostly {kind === 'cleanse' ? 'off' : 'on'} {unit(aura.targetName)}
                    </span>
                  )}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function specTitle(name: string, specId: number): string {
  const spec = specOf(specId);
  return `${shortName(name)} — ${spec.name} ${spec.className}`;
}

/** A spell's art where there is any, and its box either way. */
function SpellIcon({ url, name }: { url: string | undefined; name: string }): React.JSX.Element {
  return (
    <span className="spell-ico">
      {url === undefined ? null : <img src={url} alt="" width={16} height={16} data-tip={name} />}
    </span>
  );
}

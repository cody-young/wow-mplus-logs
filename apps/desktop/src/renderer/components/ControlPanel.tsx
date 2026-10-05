import { Fragment, useMemo, useState } from 'react';

import { controlKindNames, summarizeCrowdControl, type ControlEnd } from '@mplus/analysis';

import { clock, integer, seconds } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import type { ControlApplication, ControlReport } from '../../shared.js';

/**
 * Crowd control, which is three numbers that have to be read together.
 *
 * "Nine casts" says what a player pressed, "eighty-three targets" says the
 * presses were area control rather than a sheep, and the seconds say whether
 * any of it was held long enough to matter. Any one of them alone is
 * misleading: a paladin whose Blinding Light catches six enemies for half a
 * second each has better-looking numbers than a mage who sheeped the caster
 * for thirty, in every column but the one that counts.
 *
 * So the seconds are the bar and the sort, and the last column is why they are
 * what they are — because the usual reason a control chart reads low is that
 * the party's own damage kept ending it early.
 */

/** What became of a control, in the order a reader should meet them. */
const ENDINGS: ReadonlyArray<{ key: ControlEnd; label: string; why: string }> = [
  {
    key: 'broken',
    label: 'broken early',
    why: "The party's own damage ended it. The one ending worth acting on: a sheep broken by a stray dot is a press wasted by the group rather than by whoever made it.",
  },
  {
    key: 'died',
    label: 'died held',
    why: 'The enemy died while still controlled, which is usually the point of controlling it.',
  },
  {
    key: 'refreshed',
    label: 'pressed again',
    why: 'The same control was reapplied before it came off, so this one ended where the next began.',
  },
  {
    key: 'open',
    label: 'never came off',
    why: 'The log never reports it ending — the unit despawned, or the key ended with it still held. Credited with the longest the same control was seen to last here, so it is a floor rather than a guess.',
  },
];

const LABELS = new Map(ENDINGS.map((ending) => [ending.key, ending.label]));

/** Controls past this are a tail of one-offs. */
const SPELL_LIMIT = 18;

export function ControlPanel({
  control,
  defaultExpanded = false,
}: {
  control: ControlReport;
  /**
   * Start with every player's log open. Only the server-rendered smoke test
   * uses it: a string render cannot click, and the log is the half of this
   * view that says what actually happened.
   */
  defaultExpanded?: boolean;
}): React.JSX.Element {
  const { applications } = control;
  const summary = useMemo(() => summarizeCrowdControl(applications), [applications]);
  const [expanded, setExpanded] = useState<Set<number>>(
    () =>
      new Set(defaultExpanded ? applications.map((application) => application.actorIndex) : []),
  );

  // The controls pressed, which is a small closed set: there is nothing here to
  // limit to what is on screen.
  const icons = useSpellIcons(summary.spells.map((spell) => spell.spellId));

  if (summary.casts === 0) {
    return (
      <div className="empty">
        <h2>No crowd control</h2>
        <p>
          Nobody stunned, feared, rooted, silenced or sheeped anything here — or what they pressed
          caught nothing, which leaves no trace in the log.
        </p>
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

  const peak = Math.max(1, ...summary.actors.map((actor) => actor.ms));

  return (
    <div className="breakdown-wrap">
      <p className="measure">
        Control each player pressed, how many enemies it caught, and how long it held them. Expand a
        row for every application, newest first.
      </p>

      <table className="breakdown players">
        <colgroup>
          <col />
          <col style={{ width: 72 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 280 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="left">Player</th>
            <th>Casts</th>
            <th>Targets</th>
            <th>Held</th>
            <th className="left">How it ended</th>
          </tr>
        </thead>
        <tbody>
          {summary.actors.map((actor) => {
            const spec = specOf(actor.specId);
            const open = expanded.has(actor.actorIndex);
            // Newest first, like every other list in the app.
            const mine = applications
              .filter((application) => application.actorIndex === actor.actorIndex)
              .reverse();
            const endings = tally(mine);
            return (
              <Fragment key={actor.actorIndex}>
                <tr className="actor" onClick={() => toggle(actor.actorIndex)}>
                  <td className="left barcell">
                    {/* Scaled to seconds held rather than to presses: a cast
                        that caught nothing for no time is not the thing this
                        chart is about. */}
                    <div
                      className="bar"
                      style={{ width: `${(actor.ms / peak) * 100}%`, background: spec.color }}
                    />
                    <span className="namecell">
                      <span className="chev">{open ? '▾' : '▸'}</span>
                      <SpecIcon
                        specId={actor.specId}
                        title={`${shortName(actor.name)} — ${spec.name} ${spec.className}`}
                      />
                      <span className="pname">{shortName(actor.name)}</span>
                      <span className="spec">
                        {actor.abilities.map((ability) => ability.name).join(', ')}
                      </span>
                    </span>
                  </td>
                  <td>{integer(actor.casts)}</td>
                  <td>{integer(actor.targets)}</td>
                  <td>{held(actor.ms)}</td>
                  <td className="left">
                    <span className="chips">
                      {ENDINGS.filter((ending) => (endings.get(ending.key) ?? 0) > 0).map(
                        (ending) => (
                          <span
                            className="chip"
                            key={ending.key}
                            title={ending.why}
                            style={
                              ending.key === 'broken' ? { color: 'var(--danger)' } : undefined
                            }
                          >
                            {ending.label} {endings.get(ending.key)}
                          </span>
                        ),
                      )}
                      {endings.size === 1 && endings.has('expired') ? (
                        <span style={{ color: 'var(--good)' }}>every one ran its course</span>
                      ) : null}
                    </span>
                  </td>
                </tr>
                {open ? (
                  <tr className="nest">
                    <td colSpan={5}>
                      <div className="nest-scroll">
                        <table className="breakdown abilities interrupt-log">
                          <colgroup>
                            <col style={{ width: 66 }} />
                            <col style={{ width: 230 }} />
                            <col style={{ width: 200 }} />
                            <col style={{ width: 80 }} />
                            <col />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="left">Time</th>
                              <th className="left">Control</th>
                              <th className="left">Target</th>
                              <th className="left">Held</th>
                              <th className="left">Ended</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mine.map((application, index) => (
                              <tr
                                className="spell"
                                key={`${application.ts}:${application.spellId}:${index}`}
                              >
                                <td className="left">{clock(application.ts)}</td>
                                <td className="left">
                                  <span className="namecell">
                                    <SpellIcon
                                      url={icons.get(application.spellId)}
                                      name={application.spellName}
                                    />
                                    <span className="name">{application.spellName}</span>
                                    {/* Whose hands it was in, when they were
                                        not the player's: a felguard's Axe Toss
                                        is the warlock's stun. */}
                                    {application.petName === '' ? null : (
                                      <span style={{ color: 'var(--dim)' }}>
                                        {application.petName}
                                      </span>
                                    )}
                                  </span>
                                </td>
                                <td className="left">{application.targetName}</td>
                                <td className="left">{seconds(application.durationMs)}</td>
                                <td className="left">{endText(application)}</td>
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
          Control pressed — {integer(summary.casts)} casts, {integer(summary.targets)} targets,{' '}
          {held(summary.ms)} held
        </h3>
        <div className="hits">
          {summary.spells.slice(0, SPELL_LIMIT).map((spell) => (
            <div className="hit" key={spell.spellId}>
              <span className="t">×{spell.targets}</span>
              <span className="namecell">
                <SpellIcon url={icons.get(spell.spellId)} name={spell.name} />
                <span>
                  {spell.name}
                  <span className="src">
                    {' '}
                    · {controlKindNames(spell.kinds).join(' + ')}
                    {spell.targetName === '' ? '' : ` · mostly ${spell.targetName}`}
                  </span>
                </span>
              </span>
              <span className="amt" style={{ color: 'var(--dim)' }}>
                {held(spell.ms)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Time held, as mm:ss.
 *
 * Both places this is used are columns of figures meant to be compared down
 * the page, and a column that reads 12:39, 04:13, 01:43, 20s is doing the
 * reader's eye no favours. The individual applications in the log are the
 * other case entirely — those are single stuns, and three seconds is "3.0s"
 * there rather than "00:03".
 */
function held(ms: number): string {
  return clock(ms);
}

function tally(applications: readonly ControlApplication[]): Map<ControlEnd, number> {
  const counts = new Map<ControlEnd, number>();
  for (const application of applications) {
    counts.set(application.end, (counts.get(application.end) ?? 0) + 1);
  }
  return counts;
}

/**
 * How one control ended, in a word.
 *
 * `expired` is the unremarkable case and says the least, so it is dimmed and
 * the rest are not: what a reader is scanning this column for is the ones that
 * ended before they should have.
 */
function endText(application: ControlApplication): React.JSX.Element {
  if (application.end === 'expired') {
    return <span style={{ color: 'var(--dim)' }}>ran its course</span>;
  }
  if (application.end === 'broken') {
    return <span style={{ color: 'var(--danger)' }}>broken early</span>;
  }
  if (application.end === 'died') {
    return <span style={{ color: 'var(--good)' }}>died held</span>;
  }
  return (
    <span style={{ color: 'var(--muted)' }}>{LABELS.get(application.end) ?? application.end}</span>
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

import { Fragment, useMemo, useState } from 'react';

import { summarizeInterrupts, type InterruptOutcome } from '@mplus/analysis';

import { clock, integer, percent } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import type { InterruptAttempt, InterruptReport } from '../../shared.js';

/**
 * Interrupts, which are two numbers that disagree about the same key.
 *
 * "Stopped 10 casts" is praise and "pressed 15" is the question behind it, so
 * they belong in one row — and the gap between them needs explaining before
 * anybody acts on it, because most of it is usually two people covering the
 * same cast rather than anybody missing. Hence the last column: the whiffs,
 * broken down by what the press actually ran into.
 */

/**
 * What a whiff means, in the order a reader should meet them.
 *
 * `doubled` first because it is most of them, and because it is the only one
 * the party can fix together. `nothing` last because it is the only one that
 * is simply a wasted press.
 */
const REASONS: ReadonlyArray<{ key: InterruptOutcome; label: string; why: string }> = [
  {
    key: 'doubled',
    label: 'doubled up',
    why: "Another player's interrupt stopped that cast first — two cooldowns spent on one cast, leaving the next one uncovered.",
  },
  {
    key: 'ignored',
    label: 'cast carried on',
    why: 'The target was mid-cast and the cast completed anyway. The log never says why; usually it could not be interrupted at all.',
  },
  { key: 'late', label: 'a beat late', why: 'The cast it was aimed at had already finished.' },
  { key: 'early', label: 'a beat early', why: 'The target began casting just after the press.' },
  {
    key: 'missed',
    label: 'missed',
    why: 'The log reports the interrupt itself as avoided — immune, or dodged.',
  },
  {
    key: 'nothing',
    label: 'nothing to stop',
    why: 'The target was not casting within a second either way.',
  },
];

const LABELS = new Map(REASONS.map((reason) => [reason.key, reason.label]));

/** Enemy casts past this are a tail of one-offs. */
const STOPPED_LIMIT = 18;

export function InterruptsPanel({
  interrupts,
  defaultExpanded = false,
}: {
  interrupts: InterruptReport;
  /**
   * Start with every player's press log open. Only the server-rendered smoke
   * test uses it: a string render cannot click, and the log is the half of
   * this view that says what actually happened.
   */
  defaultExpanded?: boolean;
}): React.JSX.Element {
  const { attempts, stops } = interrupts;
  const summary = useMemo(() => summarizeInterrupts(attempts, stops), [attempts, stops]);
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(defaultExpanded ? attempts.map((attempt) => attempt.actorIndex) : []),
  );

  // The buttons that were pressed and the casts that were stopped: two small
  // closed sets, so there is nothing here to limit to what is on screen.
  const icons = useSpellIcons([
    ...summary.actors.flatMap((actor) => actor.abilities.map((ability) => ability.spellId)),
    ...summary.stopped.map((cast) => cast.spellId),
  ]);

  if (summary.casts === 0) {
    return (
      <div className="empty">
        <h2>No interrupts</h2>
        <p>Nobody pressed one here.</p>
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

  const peak = Math.max(1, ...summary.actors.map((actor) => actor.casts));

  return (
    <div className="breakdown-wrap">
      <p className="measure">
        Interrupts each player pressed, and what the ones that stopped nothing ran into. Expand a
        row for every press, newest first.
      </p>

      <table className="breakdown players">
        <colgroup>
          <col />
          <col style={{ width: 84 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 76 }} />
          <col style={{ width: 300 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="left">Player</th>
            <th>Pressed</th>
            <th>Interrupted</th>
            <th>Landed %</th>
            <th className="left">Of the rest</th>
          </tr>
        </thead>
        <tbody>
          {summary.actors.map((actor) => {
            const spec = specOf(actor.specId);
            const open = expanded.has(actor.actorIndex);
            // Newest first, like every other list in the app: the press worth
            // understanding is usually the one just made.
            const mine = attempts
              .filter((attempt) => attempt.actorIndex === actor.actorIndex)
              .reverse();
            return (
              <Fragment key={actor.actorIndex}>
                <tr className="actor" onClick={() => toggle(actor.actorIndex)}>
                  <td className="left barcell">
                    {/* Scaled to presses rather than to interrupts, so the bar
                        is how much of the party's interrupting this player was
                        asked to do and the columns say how it went. */}
                    <div
                      className="bar"
                      style={{ width: `${(actor.casts / peak) * 100}%`, background: spec.color }}
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
                  <td>{integer(actor.stops)}</td>
                  <td>{percent(actor.stops / Math.max(actor.casts, 1))}</td>
                  <td className="left">
                    {actor.whiffs === 0 ? (
                      <span style={{ color: 'var(--good)' }}>every press landed</span>
                    ) : (
                      <span className="chips">
                        {REASONS.filter((reason) => actor.outcomes[reason.key] > 0).map((reason) => (
                          <span className="chip" key={reason.key} title={reason.why}>
                            {reason.label} {actor.outcomes[reason.key]}
                          </span>
                        ))}
                      </span>
                    )}
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
                            <col />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="left">Time</th>
                              <th className="left">Pressed</th>
                              <th className="left">Target</th>
                              <th className="left">What happened</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mine.map((attempt, index) => (
                              <tr className="spell" key={`${attempt.ts}:${attempt.spellId}:${index}`}>
                                <td className="left">{clock(attempt.ts)}</td>
                                <td className="left">
                                  <span className="namecell">
                                    <SpellIcon
                                      url={icons.get(attempt.spellId)}
                                      name={attempt.spellName}
                                    />
                                    <span className="name">{attempt.spellName}</span>
                                    {/* Whose hands it was in, when they were
                                        not the player's: a felhunter's Spell
                                        Lock is the warlock's interrupt. */}
                                    {attempt.petName === '' ? null : (
                                      <span style={{ color: 'var(--dim)' }}>{attempt.petName}</span>
                                    )}
                                  </span>
                                </td>
                                <td className="left">
                                  {attempt.targetName === '' ? (
                                    <span style={{ color: 'var(--dim)' }}>no target</span>
                                  ) : (
                                    attempt.targetName
                                  )}
                                </td>
                                <td className="left">{outcomeText(attempt)}</td>
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
        <h3>Casts stopped — {integer(summary.stops)}</h3>
        {summary.stopped.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--danger)' }}>
            {integer(summary.casts)} presses and nothing stopped by any of them.
          </p>
        ) : (
          <div className="hits">
            {summary.stopped.slice(0, STOPPED_LIMIT).map((cast) => (
              <div className="hit" key={cast.spellId}>
                <span className="t">×{cast.count}</span>
                <span className="namecell">
                  <SpellIcon url={icons.get(cast.spellId)} name={cast.name} />
                  <span>
                    {cast.name}
                    <span className="src"> · {cast.sourceName}</span>
                  </span>
                </span>
                <span className="amt" style={{ color: 'var(--dim)' }}>
                  {percent(cast.count / Math.max(summary.stops, 1))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One press in a sentence.
 *
 * The cast is named wherever the log identified one, including on the whiffs:
 * "a beat late — Crush" is a different note to the same player than "nothing
 * to stop", and both are different again from being doubled up by the tank.
 */
function outcomeText(attempt: InterruptAttempt): React.JSX.Element {
  if (attempt.outcome === 'interrupted') {
    return (
      <span>
        <span style={{ color: 'var(--good)' }}>stopped</span> {attempt.castSpellName || 'a cast'}
        {attempt.stops > 1 ? (
          <span style={{ color: 'var(--dim)' }}> · and {attempt.stops - 1} more</span>
        ) : null}
      </span>
    );
  }
  const label = LABELS.get(attempt.outcome) ?? attempt.outcome;
  return (
    <span style={{ color: 'var(--muted)' }}>
      {label}
      {attempt.beatenBy === '' ? null : ` — ${shortName(attempt.beatenBy)} got it`}
      {attempt.beatenBy === '' && attempt.castSpellName !== '' ? ` — ${attempt.castSpellName}` : ''}
    </span>
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

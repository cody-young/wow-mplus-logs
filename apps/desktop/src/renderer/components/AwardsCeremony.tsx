import { useEffect, useState } from 'react';

import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import { memberTitle, type PartyMember } from './RunRow.js';
import type { Awards, Badge, MvpStanding } from '../awards.js';

/**
 * The awards ceremony at the top of the stats tab.
 *
 * Plays when the reader opens the tab, never by itself: the app does not move
 * anyone off the tab they chose because a key ended. Once a run's ceremony has
 * played it opens finished, with a button to play it again.
 *
 * One badge takes the stage at a time, roasts first, then settles onto the
 * shelf below; the MVP podium comes last, with confetti. A reader who asked
 * the system for less motion gets the finished ceremony straight away.
 */

/** How long each badge holds the stage. */
const STEP_MS = 1600;

const CONFETTI = 36;

export function AwardsCeremony({
  awards,
  party,
  autoplay,
  onPlayed,
}: {
  awards: Awards;
  party: readonly PartyMember[];
  autoplay: boolean;
  /** Called once the ceremony has started, so it is not autoplayed again. */
  onPlayed: () => void;
}): React.JSX.Element {
  const total = awards.badges.length;
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  /** Badges revealed so far; `total` means all of them, and then the MVP. */
  const [step, setStep] = useState(autoplay && !reduced ? 0 : total + 1);
  const playing = step <= total;

  useEffect(() => {
    if (autoplay) onPlayed();
    // Only on mount: replaying from the button is not a first viewing.
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setStep((current) => current + 1), step === 0 ? 600 : STEP_MS);
    return () => clearTimeout(timer);
  }, [step, playing]);

  const member = (index: number): PartyMember | undefined => party.find((entry) => entry.actorIndex === index);
  /** The badge on stage right now, if any: the one most recently revealed. */
  const onStage = playing && step > 0 ? awards.badges[step - 1] : undefined;
  const shelf = awards.badges.slice(0, playing ? Math.max(0, step - 1) : total);

  return (
    <section className={`ceremony${playing ? ' playing' : ''}`}>
      <div className="ceremony-head">
        <h3 className="stat-title">Awards</h3>
        {playing ? (
          <button type="button" onClick={() => setStep(total + 1)}>
            Skip
          </button>
        ) : (
          <button type="button" onClick={() => setStep(0)} disabled={reduced} title={reduced ? 'Reduced motion is on' : undefined}>
            ▶ Replay
          </button>
        )}
      </div>

      {playing ? (
        <div className="ceremony-stage">
          {onStage === undefined ? (
            <p className="ceremony-drumroll">And the awards go to…</p>
          ) : (
            <BadgeCard key={onStage.key} badge={onStage} member={member} big />
          )}
        </div>
      ) : (
        <Podium awards={awards} />
      )}

      {shelf.length > 0 ? (
        <div className="badge-shelf">
          {shelf.map((badge) => (
            <BadgeCard key={badge.key} badge={badge} member={member} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BadgeCard({
  badge,
  member,
  big = false,
}: {
  badge: Badge;
  member: (index: number) => PartyMember | undefined;
  big?: boolean;
}): React.JSX.Element {
  return (
    <div className={`badge-card${badge.roast ? ' roast' : ''}${big ? ' big' : ''}`} title={badge.blurb}>
      <span className="badge-icon" aria-hidden="true">
        {badge.icon}
      </span>
      <span className="badge-body">
        <span className="badge-title">{badge.title}</span>
        {badge.winners.map((index) => {
          const who = member(index);
          return (
            <span key={index} className="badge-winner">
              {who === undefined ? null : <SpecIcon specId={who.specId} title={memberTitle(who)} size={big ? 20 : 14} />}
              <span className="pname" style={{ color: specOf(who?.specId ?? -1).color }}>
                {shortName(who?.name ?? '?')}
              </span>
              <span className="badge-reason" title={badge.reasons[index]}>
                {badge.reasons[index]}
              </span>
            </span>
          );
        })}
        {big ? <span className="badge-blurb">{badge.blurb}</span> : null}
      </span>
    </div>
  );
}

/** Second, first, third, the way a podium stands, then everyone else. */
function Podium({ awards }: { awards: Awards }): React.JSX.Element {
  const { standings, mvp } = awards;
  const order = [standings[1], standings[0], standings[2]].filter((entry): entry is MvpStanding => entry !== undefined);
  return (
    <div className="podium-wrap">
      <div className="confetti" aria-hidden="true">
        {Array.from({ length: CONFETTI }, (_, i) => (
          <span
            key={i}
            style={{
              left: `${(i * 37) % 100}%`,
              animationDelay: `${(i * 53) % 900}ms`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              transform: `rotate(${(i * 47) % 360}deg)`,
            }}
          />
        ))}
      </div>
      <p className="mvp-line">
        {mvp.length > 1 ? 'Co-MVPs' : 'Dungeon MVP'}
        {': '}
        {mvp
          .map((index) => standings.find((entry) => entry.member.actorIndex === index))
          .filter((entry): entry is MvpStanding => entry !== undefined)
          .map((entry, i) => (
            <span key={entry.member.actorIndex}>
              {i > 0 ? ' & ' : ''}
              <span style={{ color: specOf(entry.member.specId).color }}>{shortName(entry.member.name)}</span>
            </span>
          ))}
      </p>
      <div className="podium">
        {order.map((entry) => {
          const place = standings.indexOf(entry) + 1;
          return (
            <div key={entry.member.actorIndex} className={`podium-step place-${place}`} title={pointsTitle(entry)}>
              <span className="podium-who">
                {mvp.includes(entry.member.actorIndex) ? <span className="stat-crown">♛</span> : null}
                <SpecIcon specId={entry.member.specId} title={memberTitle(entry.member)} size={22} />
                <span className="pname" style={{ color: specOf(entry.member.specId).color }}>
                  {shortName(entry.member.name)}
                </span>
              </span>
              <span className="podium-block">
                <span className="podium-place">{place}</span>
                <span className="podium-points">{entry.points} pts</span>
              </span>
            </div>
          );
        })}
      </div>
      {standings.length > 3 ? (
        <ol className="podium-rest" start={4}>
          {standings.slice(3).map((entry) => (
            <li key={entry.member.actorIndex} title={pointsTitle(entry)}>
              <span className="pname" style={{ color: specOf(entry.member.specId).color }}>
                {shortName(entry.member.name)}
              </span>{' '}
              <span className="badge-reason">{entry.points} pts</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="measure">
        Points are rank points: in each of damage, healing, kicks, crowd control, dispels, deaths,
        totems and avoidable damage, one for every player beaten, plus one. Hover a step for the sums.
      </p>
    </div>
  );
}

function pointsTitle(entry: MvpStanding): string {
  return entry.lines.map((line) => `${line.category}: ${line.points}`).join('\n') || 'No points';
}

const CONFETTI_COLORS = ['#d4a24a', '#6ea8fe', '#e05c5c', '#5cc98a', '#c27ce0', '#f0e1a0'];

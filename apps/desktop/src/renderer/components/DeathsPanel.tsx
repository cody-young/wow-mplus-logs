import { useEffect, useState } from 'react';

import { SegmentKind, type DeathReport } from '@mplus/analysis';

import { clock, percent, seconds, short } from '../format.js';
import { shortName, specOf } from '../specs.js';
import { DeathTimeline } from './DeathTimeline.js';
import { SpecIcon } from './SpecIcon.js';

/** Deaths within this of each other usually share one cause. */
const CASCADE_MS = 8000;

export function DeathsPanel({ deaths }: { deaths: DeathReport[] }): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  // Keep the selection valid as a live run appends deaths.
  useEffect(() => {
    if (selected >= deaths.length) setSelected(Math.max(0, deaths.length - 1));
  }, [deaths.length, selected]);

  if (deaths.length === 0) {
    return (
      <div className="empty">
        <h2>No deaths</h2>
        <p>Clean key.</p>
      </div>
    );
  }

  const death = deaths[Math.min(selected, deaths.length - 1)]!;
  const healing = healingBySpell(death);

  return (
    <div className="death-grid">
      <div className="death-list">
        {deaths.map((entry, index) => {
          const entrySpec = specOf(entry.specId);
          const cascade = entry.sincePreviousDeathMs !== null && entry.sincePreviousDeathMs < CASCADE_MS;
          return (
            <button
              key={`${entry.actorIndex}-${entry.ts}`}
              type="button"
              className={`death-item${index === selected ? ' selected' : ''}`}
              onClick={() => setSelected(index)}
            >
              <span className="who">
                <SpecIcon
                  specId={entry.specId}
                  title={`${shortName(entry.name)} — ${entrySpec.name} ${entrySpec.className}`}
                />
                <span style={{ color: entrySpec.color, fontWeight: 600 }}>{shortName(entry.name)}</span>
                <span style={{ color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{clock(entry.ts)}</span>
              </span>
              <span className="where">
                {entry.segmentKind === SegmentKind.BOSS ? 'Boss · ' : ''}
                {entry.segmentLabel}
              </span>
              <span className="cause">
                {entry.killingBlow ? `${entry.killingBlow.spellName} — ${entry.killingBlow.sourceName}` : 'cause unclear'}
              </span>
              {cascade ? (
                <span className="cascade">
                  {seconds(entry.sincePreviousDeathMs ?? 0)} after the previous death
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div>
        <div className="panel">
          <h3>Second by second</h3>
          <DeathTimeline death={death} />
        </div>

        <div className="panel">
          <div className="split">
            <div>
              <h3>Damage by ability</h3>
              <div className="hits">
                {death.byAbility.map((ability) => (
                  <div className="hit" key={ability.spellId}>
                    <span className="t">×{ability.hits}</span>
                    <span>
                      {ability.name}
                      <span className="src"> · {ability.sourceName}</span>
                    </span>
                    <span className="amt">
                      {short(ability.total)}
                      <span style={{ color: 'var(--dim)' }}>
                        {' '}
                        {percent(death.damageTaken > 0 ? ability.total / death.damageTaken : 0)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3>Healing received</h3>
              {healing.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--danger)' }}>
                  No healing landed on them in the {death.windowMs / 1000}s before they died.
                </p>
              ) : (
                <div className="hits">
                  {healing.map((heal) => (
                    <div className="hit" key={heal.spellId}>
                      <span className="t">×{heal.hits}</span>
                      <span>
                        {heal.name}
                        <span className="src"> · {heal.sourceName}</span>
                      </span>
                      <span className="amt">
                        {short(heal.total)}
                        <span style={{ color: 'var(--dim)' }}>
                          {' '}
                          {percent(death.healingReceived > 0 ? heal.total / death.healingReceived : 0)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>What they pressed</h3>
          {death.ownCasts.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--danger)' }}>
              Nothing cast in the {death.windowMs / 1000}s before dying.
            </p>
          ) : (
            <div className="chips">
              {death.ownCasts.map((castRecord, index) => (
                <span className="chip" key={`${castRecord.ts}-${castRecord.spellId}-${index}`}>
                  {castRecord.name}
                  <span style={{ color: 'var(--dim)' }}> −{((death.ts - castRecord.ts) / 1000).toFixed(1)}s</span>
                </span>
              ))}
            </div>
          )}
          {death.debuffsAtDeath.length > 0 ? (
            <>
              <h3 style={{ marginTop: 14 }}>Debuffs at death</h3>
              <div className="chips">
                {death.debuffsAtDeath.map((debuff) => (
                  <span className="chip" key={debuff.spellId}>
                    {debuff.name}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface HealingTotal {
  spellId: number;
  name: string;
  sourceName: string;
  total: number;
  hits: number;
}

/**
 * Heals received in the summary window, grouped by spell.
 *
 * The analysis keeps them as a flat list because the timeline needs individual
 * timestamps; this is the same data asked the other question — which spells
 * actually did the work. The list reaches back as far as the recap can be
 * scrolled, which is further than `healingReceived` counts, so it is cut to
 * the window first: the percentages beside each spell are shares of that
 * total, and shares of a different window add up to more than all of it.
 */
function healingBySpell(death: DeathReport): HealingTotal[] {
  const grouped = new Map<number, HealingTotal & { sources: Map<string, number> }>();
  for (const heal of death.healsReceived) {
    if (heal.amount <= 0 || heal.ts < death.ts - death.windowMs) continue;
    let entry = grouped.get(heal.spellId);
    if (entry === undefined) {
      entry = {
        spellId: heal.spellId,
        name: heal.spellName,
        sourceName: '',
        total: 0,
        hits: 0,
        sources: new Map(),
      };
      grouped.set(heal.spellId, entry);
    }
    entry.total += heal.amount;
    entry.hits++;
    entry.sources.set(heal.sourceName, (entry.sources.get(heal.sourceName) ?? 0) + heal.amount);
  }
  return [...grouped.values()]
    .map((entry) => {
      let best = '';
      let bestTotal = -1;
      for (const [name, total] of entry.sources) {
        if (total > bestTotal) {
          best = name;
          bestTotal = total;
        }
      }
      return { ...entry, sourceName: shortName(best) };
    })
    .sort((a, b) => b.total - a.total);
}

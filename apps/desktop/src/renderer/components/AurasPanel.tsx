import { useMemo, useState } from 'react';

import { aurasIn, type AuraRow } from '@mplus/analysis';

import { clock, integer, percent } from '../format.js';
import { useSpellIcons, useSpellNames } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import type { PartyMember } from './RunRow.js';
import type { AuraUptime } from '../../shared.js';

/**
 * Aura uptime: what was on each player, and for how much of the key.
 *
 * One player at a time, as Warcraft Logs has it, because the question is
 * almost always about one person — was the tank's Ironfur up, did the healer
 * have their flask — and five players' auras at once is two hundred rows.
 * Buffs first, then debuffs, each sorted by uptime, each row drawn as a strip
 * of when it was up across the window so a gap reads as a gap and not as a
 * smaller number.
 *
 * The window is the key or the pull selected. A pull cuts every span to its
 * own start and end, so a buff up the whole key reads as 100% of every pull.
 */

/** Rows shown before the long tail of one-off procs is folded away. */
const ROW_LIMIT = 20;

export function AurasPanel({
  auras,
  party,
  from,
  to,
}: {
  auras: readonly AuraUptime[];
  party: readonly PartyMember[];
  /** The window, store-relative ms: the key, or the pull selected. */
  from: number;
  to: number;
}): React.JSX.Element {
  const [picked, setPicked] = useState<number | null>(null);
  const member = party.find((entry) => entry.actorIndex === picked) ?? party[0];
  const actorIndex = member?.actorIndex ?? -1;

  const rows = useMemo(() => aurasIn(auras, actorIndex, from, to), [auras, actorIndex, from, to]);
  const ids = useMemo(() => rows.map((row) => row.spellId), [rows]);
  const icons = useSpellIcons(ids);
  const names = useSpellNames(useMemo(() => rows.filter((row) => row.name === '').map((row) => row.spellId), [rows]));

  if (member === undefined) {
    return (
      <div className="empty">
        <h2>No party</h2>
        <p>This run has nobody in it to have auras.</p>
      </div>
    );
  }

  const span = Math.max(1, to - from);
  const nameOf = (row: AuraRow): string => (row.name !== '' ? row.name : names.get(row.spellId) ?? `Spell ${row.spellId}`);

  return (
    <div className="breakdown-wrap">
      <p className="measure">
        How long each buff and debuff was on one player, over {clock(span)}. A buff from
        several casters counts once, and anything already up when the key started counts from
        its start.
      </p>

      <div className="aura-party">
        {party.map((entry) => (
          <button
            key={entry.actorIndex}
            type="button"
            className={`aura-member${entry.actorIndex === actorIndex ? ' active' : ''}`}
            onClick={() => setPicked(entry.actorIndex)}
          >
            <SpecIcon specId={entry.specId} title={null} />
            <span style={{ color: specOf(entry.specId).color }}>{shortName(entry.name)}</span>
          </button>
        ))}
      </div>

      {(['buff', 'debuff'] as const).map((kind) => (
        <AuraTable
          // Remounted per player, so one player's "show all" is not another's.
          key={`${kind}:${actorIndex}`}
          kind={kind}
          rows={rows.filter((row) => row.buff === (kind === 'buff'))}
          from={from}
          span={span}
          icons={icons}
          nameOf={nameOf}
        />
      ))}
    </div>
  );
}

function AuraTable({
  kind,
  rows,
  from,
  span,
  icons,
  nameOf,
}: {
  kind: 'buff' | 'debuff';
  rows: readonly AuraRow[];
  from: number;
  span: number;
  icons: ReadonlyMap<number, string>;
  nameOf: (row: AuraRow) => string;
}): React.JSX.Element {
  const [all, setAll] = useState(false);
  const title = kind === 'buff' ? 'Buffs' : 'Debuffs';
  const shown = all ? rows : rows.slice(0, ROW_LIMIT);

  return (
    <section className="dispel-section">
      <h3 className="dispel-title">
        <span className={`swatch ${kind}`} />
        {title} — {integer(rows.length)}
      </h3>
      {rows.length === 0 ? (
        <p className="measure">None here.</p>
      ) : (
        <table className="breakdown players aura-table">
          <colgroup>
            <col style={{ width: 260 }} />
            <col />
            <col style={{ width: 80 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="left">{kind === 'buff' ? 'Buff' : 'Debuff'}</th>
              <th className="left">When</th>
              <th>Uptime</th>
              <th data-tip="Times it went up, counting once if it was already up">Count</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const name = nameOf(row);
              const source = row.selfApplied
                ? ''
                : row.sourceName === ''
                  ? ''
                  : row.sourcePlayer
                    ? shortName(row.sourceName)
                    : row.sourceName;
              return (
                <tr key={`${row.spellId}:${row.name}`}>
                  <td className="left">
                    <span className="namecell">
                      <SpellIcon url={icons.get(row.spellId)} name={name} />
                      <span className="aura-name">{name}</span>
                      {source === '' ? null : <span className="spec">{source}</span>}
                    </span>
                  </td>
                  <td className="left">
                    <div
                      className="aura-strip"
                      data-tip={`${name}: up ${clock(row.upMs)} of ${clock(span)}, ${integer(row.count)} ${row.count === 1 ? 'time' : 'times'}`}
                    >
                      {spans(row.spans).map(([start, end]) => (
                        <span
                          key={start}
                          className={`aura-span ${kind}`}
                          style={{
                            left: `${((start - from) / span) * 100}%`,
                            width: `${((end - start) / span) * 100}%`,
                          }}
                        />
                      ))}
                    </div>
                  </td>
                  <td>{percent(row.upMs / span)}</td>
                  <td>{integer(row.count)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > ROW_LIMIT ? (
        <button type="button" className="link aura-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${integer(rows.length)}`}
        </button>
      ) : null}
    </section>
  );
}

function spans(flat: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

/** A spell's art where there is any, and its box either way. */
function SpellIcon({ url, name }: { url: string | undefined; name: string }): React.JSX.Element {
  return (
    <span className="spell-ico">
      {url === undefined ? null : <img src={url} alt="" width={16} height={16} data-tip={name} />}
    </span>
  );
}

import { useState } from 'react';

import { SegmentKind, type EnemyGroup, type RunForces, type Segment } from '@mplus/analysis';

import { integer, percent, short } from '../format.js';

interface Props {
  segment: Segment;
  /** Run-level forces, which is what says *why* a count column is empty. */
  forces: RunForces;
}

/**
 * The "showing one pull only" line, expandable into what was in it.
 *
 * The collapsed line names the pull the way the timeline does and gives its
 * enemy forces — the "count" a key is actually measured in — alongside the raw
 * enemy tally. Both numbers matter and they are not the same question: twelve
 * enemies worth 4 apiece move the bar less than one miniboss worth 25.
 */
export function EnemyRoster({ segment, forces }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const total = segment.enemies.length;
  const summons = segment.roster.reduce((n, group) => (group.summon ? n + group.spawns : n), 0);
  // Built as one string rather than interpolated pieces so the tally stays a
  // single text node and reads the same in the DOM as on screen.
  const tally =
    `${integer(total)} ${total === 1 ? 'enemy' : 'enemies'}` +
    (summons > 0 ? `, ${integer(summons)} summoned` : '') +
    (forces.known ? ` · ${countOf(segment, forces)}` : '');

  return (
    <div className="roster">
      <button type="button" className="roster-head" onClick={() => setOpen(!open)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span>
          Showing <strong>{segment.label}</strong> {`only — ${tally}`}
        </span>
      </button>
      {open ? <RosterTable segment={segment} forces={forces} /> : null}
    </div>
  );
}

/** `48 count (5.9%)`, the pairing every route tool shows. */
function countOf(segment: Segment, forces: RunForces): string {
  const share = forces.total > 0 ? ` (${percent(segment.forces / forces.total)})` : '';
  return `${integer(segment.forces)} count${share}`;
}

/** Exported so the smoke test can render the expanded state it cannot click. */
export function RosterTable({ segment, forces }: Props): React.JSX.Element {
  const { roster } = segment;
  if (roster.length === 0) {
    return <p className="roster-note">No enemies were attributed to this segment.</p>;
  }

  // 0 means the health was never recorded, not that the enemy had none, so the
  // columns are dropped rather than filled with zeroes.
  const anyHealth = roster.some((group) => group.maxHp > 0);
  // Dropped wholesale without a table, because a column of dashes is worse
  // than no column: it reads as "these enemies are worth nothing".
  const columns = 4 + (forces.known ? 2 : 0) + (anyHealth ? 2 : 0);

  return (
    <>
      <table className="breakdown roster-table">
        <thead>
          <tr>
            <th className="left">Enemy</th>
            <th title="Spawns that died, out of the spawns the party damaged">Killed</th>
            {forces.known ? <th title="Enemy forces earned: the per-kill value times kills">Count</th> : null}
            {forces.known ? <th title="Share of the forces this dungeon requires">%</th> : null}
            {anyHealth ? <th>Max HP</th> : null}
            {anyHealth ? <th>Health pool</th> : null}
            <th className="left">Kind</th>
            <th>NPC id</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((group) => (
            <tr key={group.npcId >= 0 ? `#${group.npcId}` : `@${group.name}`}>
              <td className="left">
                <span className={group.summon ? 'roster-summon' : 'roster-name'}>{group.name}</span>
              </td>
              <td title={`${integer(group.spawns)} damaged, ${integer(group.killed)} killed`}>
                {killedOf(group)}
              </td>
              {forces.known ? (
                <td title={eachOf(group)}>
                  {group.forcesEach === null ? '—' : integer(group.forces)}
                </td>
              ) : null}
              {forces.known ? (
                <td style={{ color: 'var(--muted)' }}>
                  {group.forcesEach === null || forces.total === 0
                    ? '—'
                    : percent(group.forces / forces.total)}
                </td>
              ) : null}
              {anyHealth ? <td>{group.maxHp > 0 ? short(group.maxHp) : '—'}</td> : null}
              {anyHealth ? (
                <td style={{ color: 'var(--muted)' }}>
                  {group.maxHp > 0 ? short(group.maxHp * group.spawns) : '—'}
                </td>
              ) : null}
              <td className="left">
                <span className={`chip${group.summon ? ' summon' : ''}`}>{kindOf(segment, group.summon, group.name)}</span>
              </td>
              <td style={{ color: 'var(--dim)' }}>{group.npcId >= 0 ? group.npcId : '—'}</td>
            </tr>
          ))}
        </tbody>
        {forces.known ? (
          <tfoot>
            <tr>
              <td className="left">Segment total</td>
              <td>{integer(roster.reduce((n, group) => n + group.killed, 0))}</td>
              <td>{integer(segment.forces)}</td>
              <td>{forces.total > 0 ? percent(segment.forces / forces.total) : '—'}</td>
              {/* The remaining columns have no meaningful total: health does not
                  add up across creatures in a way worth printing, and an npc id
                  cannot be summed at all. */}
              <td colSpan={columns - 4} />
            </tr>
          </tfoot>
        ) : null}
      </table>
      <RosterNote segment={segment} forces={forces} />
    </>
  );
}

/** `2 / 4` when some survived, `4` when all died, so the common case stays quiet. */
function killedOf(group: EnemyGroup): string {
  return group.killed === group.spawns
    ? integer(group.spawns)
    : `${integer(group.killed)} / ${integer(group.spawns)}`;
}

function eachOf(group: EnemyGroup): string {
  if (group.forcesEach === null) return 'Not in the enemy-forces table';
  return `${integer(group.forcesEach)} per kill × ${integer(group.killed)} killed`;
}

/** The caveat when a killed creature had no entry: the count is a floor. */
function lowerBound(missing: EnemyGroup[]): string {
  const plural = missing.length > 1;
  const names = missing.map((group) => group.name).join(', ');
  return (
    `${integer(missing.length)} creature${plural ? 's' : ''} here ${plural ? 'are' : 'is'}` +
    ` not in that table (${names}), so this segment's count is a lower bound.`
  );
}

function RosterNote({ segment, forces }: Props): React.JSX.Element {
  const missing = forces.known
    ? segment.roster.filter((group) => group.forcesEach === null && group.killed > 0)
    : [];

  return (
    <p className="roster-note">
      Killed counts distinct spawns the party damaged, so a mob that was never hit does not appear.
      Max HP comes from the advanced block and reads as — when advanced combat logging was off.{' '}
      {forces.known ? (
        <>
          Enemy forces are not in the combat log; the per-kill values come from{' '}
          {forces.source === '' ? 'Mythic Dungeon Tools' : forces.source} on this machine, and the
          key needs {integer(forces.total)}.
          {missing.length > 0 ? ` ${lowerBound(missing)}` : ''}
        </>
      ) : (
        <>
          Enemy forces are not in the combat log and no table was found for this dungeon, so there
          is no count column. Install Mythic Dungeon Tools into the same WoW folder this log came
          from and reopen the log.
        </>
      )}
    </p>
  );
}

function kindOf(segment: Segment, summon: boolean, name: string): string {
  if (summon) return 'summon';
  // The encounter name is the boss's own name, so the unit it matches is the boss.
  return segment.kind === SegmentKind.BOSS && segment.label.startsWith(name) ? 'boss' : 'trash';
}

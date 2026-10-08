import { integer, short } from '../format.js';
import type { Awards } from '../awards.js';
import { AwardsCeremony } from './AwardsCeremony.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import { memberTitle, type PartyMember } from './RunRow.js';
import type { StatsReport } from '../../shared.js';

/**
 * The awards tab: the awards ceremony, then one card per stat, the whole
 * party ranked on each.
 *
 * The cards follow the selected pull like every other tab; the awards are
 * for the whole run, as the badges in the header are.
 *
 * Everyone is listed, zeroes too, because "nobody stomped a single totem" is
 * as much the joke as who stomped the most. The leader of each card gets the
 * crown; a tie shares it.
 */

interface StatRow {
  member: PartyMember;
  value: number;
  /** Hover text: what the number is made of. */
  detail: string;
}

interface Stat {
  key: string;
  title: string;
  /** One line on what is counted, so nobody has to guess. */
  measure: string;
  /** How a value is written; whole numbers by default. */
  unit?: (value: number) => string;
  rows: StatRow[];
}

export function StatsPanel({
  stats,
  party,
  awards,
  autoplay = false,
  onPlayed = () => undefined,
}: {
  stats: StatsReport;
  party: readonly PartyMember[];
  /** Null while a key is live, which gets no ceremony. */
  awards: Awards | null;
  /** Play the ceremony from the start rather than open it finished. */
  autoplay?: boolean;
  onPlayed?: () => void;
}): React.JSX.Element {
  const cards: Stat[] = [
    {
      key: 'totems',
      title: 'Totem Stomper',
      measure: 'Enemy totems finished off. One that expired, or that something else broke, counts for nobody.',
      rows: party.map((member) => {
        const mine = stats.totemKills.filter((kill) => kill.actorIndex === member.actorIndex);
        const byName = new Map<string, number>();
        for (const kill of mine) byName.set(kill.totemName, (byName.get(kill.totemName) ?? 0) + 1);
        const pets = new Set(mine.filter((kill) => kill.petName !== '').map((kill) => kill.petName));
        return {
          member,
          value: mine.length,
          detail: [
            ...[...byName].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ×${n}`),
            ...(pets.size > 0 ? [`some by ${[...pets].join(', ')}`] : []),
          ].join(', '),
        };
      }),
    },
    {
      key: 'falls',
      title: 'Gravity Enjoyer',
      measure: 'Fall damage taken, most first. Hover for how many falls and the hardest landing.',
      unit: short,
      rows: party.map((member) => {
        const mine = stats.falls.filter((entry) => entry.actorIndex === member.actorIndex);
        const hardest = Math.max(0, ...mine.map((entry) => entry.amount));
        const fatal = mine.filter((entry) => entry.fatal).length;
        return {
          member,
          value: mine.reduce((sum, entry) => sum + entry.amount, 0),
          detail:
            mine.length === 0
              ? ''
              : `${mine.length} ${mine.length === 1 ? 'fall' : 'falls'}, hardest ${short(hardest)}` +
                (fatal > 0 ? `, ${fatal} fatal` : ''),
        };
      }),
    },
    {
      key: 'biggest',
      title: 'Biggest Hit',
      measure: 'Each player’s single largest hit on an enemy, overkill included. Hover for what it was.',
      unit: short,
      rows: party.map((member) => {
        const hit = stats.biggestHits.find((entry) => entry.actorIndex === member.actorIndex);
        return {
          member,
          value: hit?.amount ?? 0,
          detail: hit === undefined ? '' : `${hit.spellName} on ${hit.targetName}`,
        };
      }),
    },
  ];

  return (
    <div className="breakdown-wrap">
      {awards === null ? (
        <p className="measure">The awards are handed out when the key ends.</p>
      ) : (
        <AwardsCeremony awards={awards} party={party} autoplay={autoplay} onPlayed={onPlayed} />
      )}
      <div className="stat-cards">
        {cards.map((card) => (
          <StatCard key={card.key} stat={card} />
        ))}
      </div>
    </div>
  );
}

function StatCard({ stat }: { stat: Stat }): React.JSX.Element {
  const rows = [...stat.rows].sort((a, b) => b.value - a.value);
  const peak = Math.max(0, ...rows.map((row) => row.value));
  return (
    <section className="stat-card">
      <h3 className="stat-title">{stat.title}</h3>
      <p className="measure">{stat.measure}</p>
      <ol className="stat-rows">
        {rows.map((row) => {
          const leader = peak > 0 && row.value === peak;
          const spec = specOf(row.member.specId);
          return (
            <li
              key={row.member.actorIndex}
              className={`stat-row${leader ? ' leader' : ''}${row.value === 0 ? ' zero' : ''}`}
              title={row.detail === '' ? undefined : row.detail}
            >
              <span className="namecell">
                <SpecIcon specId={row.member.specId} title={memberTitle(row.member)} />
                <span className="pname" style={{ color: spec.color }}>
                  {shortName(row.member.name)}
                </span>
                {leader ? <span className="stat-crown" aria-label="leader">♛</span> : null}
              </span>
              <span className="stat-bar">
                <span style={{ width: `${peak === 0 ? 0 : (row.value / peak) * 100}%` }} />
              </span>
              <span className="stat-value">{(stat.unit ?? integer)(row.value)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

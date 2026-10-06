import { useMemo } from 'react';

import { combinedAvoidable, summarizeAvoidable, type AvoidableSummary } from '@mplus/analysis';

import { integer, short } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { SpecIcon } from './SpecIcon.js';
import type { AvoidableReport } from '../../shared.js';

/**
 * In development: the hand-kept avoidable list beside Blizzard's own flag.
 *
 * Three sets of player bars on one scale — the list, the flag, and the flag
 * with the list filling its gaps — then every ability any side counted, so a
 * disagreement reads as a row rather than a difference of two totals. Here to decide whether the flag can carry the Superiority Assister
 * with the list as a supplement; it goes away once that is decided.
 */

/** Abilities past this are a tail of one-offs. */
const ABILITY_LIMIT = 40;

export function AvoidableComparePanel({ avoidable }: { avoidable: AvoidableReport }): React.JSX.Element {
  const ours = useMemo(() => summarizeAvoidable(avoidable.hits), [avoidable.hits]);
  const theirs = useMemo(() => summarizeAvoidable(avoidable.blizzard), [avoidable.blizzard]);
  const combined = useMemo(() => summarizeAvoidable(combinedAvoidable(avoidable)), [avoidable]);
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
    const byIndex = new Map<number, { actorIndex: number; name: string; specId: number }>();
    for (const actor of [...combined.actors, ...ours.actors, ...theirs.actors]) {
      if (!byIndex.has(actor.actorIndex)) byIndex.set(actor.actorIndex, actor);
    }
    return [...byIndex.values()];
  }, [combined, ours, theirs]);
  const peak = Math.max(
    1,
    ...[ours, theirs, combined].flatMap((summary) => summary.actors.map((actor) => actor.amount)),
  );

  const abilities = useMemo(() => {
    const rows = new Map<
      string,
      {
        spellId: number;
        name: string;
        ours: number;
        theirs: number;
        both: number;
        oursHits: number;
        theirsHits: number;
        bothHits: number;
      }
    >();
    const row = (spellId: number, name: string) => {
      let found = rows.get(name);
      if (found === undefined) {
        found = { spellId, name, ours: 0, theirs: 0, both: 0, oursHits: 0, theirsHits: 0, bothHits: 0 };
        rows.set(name, found);
      }
      return found;
    };
    for (const ability of ours.abilities) {
      const found = row(ability.spellId, ability.name);
      found.ours += ability.amount;
      found.oursHits += ability.hits;
    }
    for (const ability of theirs.abilities) {
      const found = row(ability.spellId, ability.name);
      found.theirs += ability.amount;
      found.theirsHits += ability.hits;
    }
    for (const ability of combined.abilities) {
      const found = row(ability.spellId, ability.name);
      found.both += ability.amount;
      found.bothHits += ability.hits;
    }
    return [...rows.values()].sort((a, b) => b.both - a.both || b.bothHits - a.bothHits);
  }, [ours, theirs, combined]);

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

      {players.length === 0 ? (
        <div className="empty">
          <h2>Neither side counted anything</h2>
          <p>
            {avoidable.covered
              ? 'Nobody stood in anything on the list or under the flag.'
              : 'This dungeon is not on the hand-kept list, and nothing here carried the flag.'}
          </p>
        </div>
      ) : (
        <>
          <div className="compare-grid">
            <Side
              title="Ours — hand-kept list"
              summary={ours}
              players={players}
              peak={peak}
              note="Only spells on our list, and only in dungeons the list covers. A tank is not charged for a frontal aimed at them."
              empty={avoidable.covered ? null : 'This dungeon is not on the list.'}
            />
            <Side
              title="Blizzard's — spell flag"
              summary={theirs}
              players={players}
              peak={peak}
              note="Every spell Blizzard's data flags as avoidable, in any dungeon. No tank rule: a flagged frontal counts against whoever it hits."
              empty={null}
            />
            <Side
              title="Combined — flag plus list"
              summary={combined}
              players={players}
              peak={peak}
              note="Blizzard's side, plus hits from our list on spells the flag misses. Flagged spells follow Blizzard's rules; list-only spells follow ours."
              empty={null}
            />
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h3>By ability — where the sides disagree is the point</h3>
            <p className="measure">
              Every ability any side counted, as damage · hits. &quot;Counted by&quot; says which sides saw it:
              &quot;ours only&quot; is a spell the flag misses, &quot;Blizzard only&quot; one our list misses
              or leaves out for tanks.
            </p>
            <table className="breakdown abilities compare-abilities">
              <colgroup>
                <col />
                <col style={{ width: 130 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="left">Ability</th>
                  <th className="left">Counted by</th>
                  <th>Ours</th>
                  <th>Blizzard&apos;s</th>
                  <th>Combined</th>
                </tr>
              </thead>
              <tbody>
                {abilities.slice(0, ABILITY_LIMIT).map((ability) => {
                  const who =
                    ability.oursHits > 0 && ability.theirsHits > 0
                      ? 'both'
                      : ability.oursHits > 0
                        ? 'ours only'
                        : 'Blizzard only';
                  return (
                    <tr className="spell" key={ability.name}>
                      <td className="left">
                        <span className="namecell">
                          <SpellIcon url={icons.get(ability.spellId)} name={ability.name} />
                          <span className="name">{ability.name}</span>
                          <span className="spec">{ability.spellId}</span>
                        </span>
                      </td>
                      <td className={`left compare-who${who === 'both' ? ' zero' : ''}`}>{who}</td>
                      <td className={ability.oursHits === 0 ? 'zero' : undefined}>
                        {ability.oursHits === 0 ? '—' : `${short(ability.ours)} · ${integer(ability.oursHits)}`}
                      </td>
                      <td className={ability.theirsHits === 0 ? 'zero' : undefined}>
                        {ability.theirsHits === 0 ? '—' : `${short(ability.theirs)} · ${integer(ability.theirsHits)}`}
                      </td>
                      <td className={ability.bothHits === 0 ? 'zero' : undefined}>
                        {ability.bothHits === 0 ? '—' : `${short(ability.both)} · ${integer(ability.bothHits)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** One side's player bars, in the shared order and on the shared scale. */
function Side({
  title,
  summary,
  players,
  peak,
  note,
  empty,
}: {
  title: string;
  note: string;
  summary: AvoidableSummary;
  players: ReadonlyArray<{ actorIndex: number; name: string; specId: number }>;
  peak: number;
  empty: string | null;
}): React.JSX.Element {
  const byIndex = new Map(summary.actors.map((actor) => [actor.actorIndex, actor]));
  return (
    <div className="panel">
      <h3>
        {title} — {short(summary.amount)}, {integer(summary.hits)} hits
      </h3>
      <p className="measure">{note}</p>
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

/** A spell's art where there is any, and its box either way. */
function SpellIcon({ url, name }: { url: string | undefined; name: string }): React.JSX.Element {
  return (
    <span className="spell-ico">
      {url === undefined ? null : <img src={url} alt="" width={16} height={16} title={name} />}
    </span>
  );
}

/**
 * One key in the sidebar's list.
 *
 * Its own component because it is the only place a run is summarised rather
 * than examined, and because that makes it renderable on its own: the key
 * selector is the first thing anyone looks at and was otherwise the one view
 * the smoke test could not reach, being inline in `App`.
 *
 * Reads top to bottom as the questions get asked: which dungeon, how it went,
 * then who was in it.
 */
import { SegmentKind } from '@mplus/analysis';

import { clock, percent } from '../format.js';
import { shortName, specOf } from '../specs.js';
import type { RunAnalysis } from '../../shared.js';
import { DungeonIcon } from './DungeonIcon.js';
import { SpecIcon } from './SpecIcon.js';

/** Where the party list puts each role, so every run reads the same way. */
const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const;

export interface PartyMember {
  actorIndex: number;
  name: string;
  specId: number;
}

/**
 * The run's party, tank first.
 *
 * Spec ids live on the breakdown rows rather than on `meta.party`, which is
 * only actor indices — so this is the join, done once per run instead of once
 * per row. A player who did no damage at all still belongs in the list, hence
 * the fallback to -1 rather than dropping them.
 */
export function partyOf(analysis: RunAnalysis): PartyMember[] {
  return analysis.meta.party
    .map((actorIndex) => ({
      actorIndex,
      name: analysis.names[actorIndex] ?? '?',
      specId:
        analysis.damage.actors.find((actor) => actor.actorIndex === actorIndex)?.specId ?? -1,
    }))
    .sort((a, b) => ROLE_ORDER[specOf(a.specId).role] - ROLE_ORDER[specOf(b.specId).role]);
}

/** "Thrall — Restoration Shaman", for a hover that fits in an icon's width. */
export function memberTitle(member: PartyMember): string {
  const spec = specOf(member.specId);
  return `${shortName(member.name)} — ${spec.name} ${spec.className}`;
}

export function RunRow({
  analysis,
  selected,
  onSelect,
}: {
  analysis: RunAnalysis;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { meta } = analysis;
  const state = analysis.live ? 'inprogress' : meta.success ? 'timed' : 'depleted';
  const party = partyOf(analysis);

  return (
    <button type="button" className={`run${selected ? ' selected' : ''}`} onClick={onSelect}>
      <DungeonIcon teleportSpellId={analysis.forces.teleportSpellId} zoneName={meta.zoneName} />
      <span className="run-body">
        <span className="top">
          <span className="level">+{meta.keystoneLevel}</span>
          <span className={state} style={{ fontSize: 11 }}>
            {analysis.live ? 'in progress' : meta.success ? 'timed' : 'depleted'}
          </span>
        </span>
        <span className="zone">{meta.zoneName}</span>
        <span className="meta">
          <span>{clock(meta.totalTimeMs ?? 0)}</span>
          <span>{analysis.deaths.length} deaths</span>
          <span>{analysis.segments.filter((s) => s.kind === SegmentKind.PULL).length} pulls</span>
          {analysis.forces.known ? <span>{percent(analysis.forces.fraction)} count</span> : null}
        </span>
        {party.length > 0 ? (
          <span className="run-party">
            {party.map((member) => (
              <SpecIcon
                key={member.actorIndex}
                specId={member.specId}
                size={14}
                title={memberTitle(member)}
              />
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

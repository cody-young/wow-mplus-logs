/**
 * Server-renders the view components against a real parsed run.
 *
 * The Electron binary is not always available (npm blocks its postinstall), and
 * even when it is, a visual check does not prove the components survive real
 * data: 160-sample health traces, missing spec ids, enemy names with quotes,
 * segments one millisecond long. Rendering to a string in Node catches every
 * crash and lets the output be asserted on.
 */
import { renderToString } from 'react-dom/server';

import { BreakdownTable } from '../src/renderer/components/BreakdownTable.js';
import { DeathsPanel } from '../src/renderer/components/DeathsPanel.js';
import { DungeonIcon } from '../src/renderer/components/DungeonIcon.js';
import { EnemyRoster, RosterTable } from '../src/renderer/components/EnemyRoster.js';
import { RunRow, partyOf } from '../src/renderer/components/RunRow.js';
import { SegmentTimeline } from '../src/renderer/components/SegmentTimeline.js';
import { SpecIcon } from '../src/renderer/components/SpecIcon.js';
import { SPECS } from '../src/renderer/specs.js';
import type { RunAnalysis, RunForces } from '../src/shared.js';

/** A run whose dungeon no forces table covered, which drops the count columns. */
const NO_FORCES: RunForces = {
  known: false,
  dungeon: '',
  source: '',
  total: 0,
  teleportSpellId: 0,
  counted: 0,
  fraction: 0,
  unknown: [],
};

export function render(analysis: RunAnalysis): Record<string, string> {
  const span = Math.max(analysis.meta.totalTimeMs ?? 0, ...analysis.segments.map((s) => s.endTs));
  const firstSegment = analysis.segments[0]?.id ?? null;
  const perSegment = firstSegment === null ? undefined : analysis.bySegment[firstSegment];
  // The pull with the most kinds of enemy in it, which is where the roster has
  // the most to get wrong.
  const widest = analysis.segments.reduce<(typeof analysis.segments)[number] | null>(
    (best, segment) => (best === null || segment.roster.length > best.roster.length ? segment : best),
    null,
  );

  return {
    timeline: renderToString(
      <SegmentTimeline
        segments={analysis.segments}
        durationMs={span}
        forces={analysis.forces}
        selectedId={firstSegment}
        onSelect={() => undefined}
      />,
    ),
    damage: renderToString(<BreakdownTable report={analysis.damage} mode="done" />),
    taken: renderToString(<BreakdownTable report={analysis.taken} mode="taken" />),
    healing: renderToString(<BreakdownTable report={analysis.healing} mode="healing" />),
    deaths: renderToString(<DeathsPanel deaths={analysis.deaths} />),
    roster: widest === null ? '' : renderToString(<EnemyRoster segment={widest} forces={analysis.forces} />),
    rosterTable: widest === null ? '' : renderToString(<RosterTable segment={widest} forces={analysis.forces} />),
    // The same pull with no forces table at all — the case for anyone without
    // MDT installed, where the count columns must disappear rather than read 0.
    rosterNoForces:
      widest === null ? '' : renderToString(<RosterTable segment={widest} forces={NO_FORCES} />),
    // A segment whose enemies were never seen in an advanced block, which
    // drops the health columns entirely.
    rosterNoHealth:
      widest === null
        ? ''
        : renderToString(
            <RosterTable
              segment={{ ...widest, roster: widest.roster.map((group) => ({ ...group, maxHp: 0 })) }}
              forces={analysis.forces}
            />,
          ),
    // Every player open, which is the only way a string render reaches the
    // ability rows: their bars and hover detail are most of this view.
    expandedDamage: renderToString(
      <BreakdownTable report={analysis.damage} mode="done" defaultExpanded />,
    ),
    expandedTaken: renderToString(
      <BreakdownTable report={analysis.taken} mode="taken" defaultExpanded />,
    ),
    // A single segment's reports, which is what clicking a pull shows.
    segmentDamage: perSegment === undefined ? '' : renderToString(<BreakdownTable report={perSegment.damage} mode="done" />),
    // Degenerate inputs the UI must tolerate.
    emptyDeaths: renderToString(<DeathsPanel deaths={[]} />),
    emptyDamage: renderToString(
      <BreakdownTable report={{ ...analysis.damage, actors: [], total: 0 }} mode="done" />,
    ),
    emptyRoster:
      widest === null
        ? ''
        : renderToString(
            <EnemyRoster segment={{ ...widest, enemies: [], roster: [] }} forces={analysis.forces} />,
          ),

    // --- Icons -------------------------------------------------------------
    // Every spec at once, which is the only way to catch a spec whose icon
    // name was never filled in: in the app you would have to play all 39.
    specIcons: renderToString(
      <>
        {Object.keys(SPECS).map((specId) => (
          <SpecIcon key={specId} specId={Number(specId)} />
        ))}
      </>,
    ),
    // A pet, an NPC, or a player whose COMBATANT_INFO never arrived.
    unknownSpecIcon: renderToString(<SpecIcon specId={-1} />),
    // The key selector's dungeon icon, with the run's own teleport spell.
    dungeonIcon: renderToString(
      <DungeonIcon
        teleportSpellId={analysis.forces.teleportSpellId}
        zoneName={analysis.meta.zoneName}
      />,
    ),
    // The same row for anyone without MDT, where there is no teleport id to
    // resolve and the initials carry the row instead.
    dungeonIconNoMdt: renderToString(
      <DungeonIcon teleportSpellId={0} zoneName={analysis.meta.zoneName} />,
    ),

    // The key selector, which is the first thing anyone looks at.
    runRow: renderToString(<RunRow analysis={analysis} selected onSelect={() => undefined} />),
    // A key still being run: no result yet, and a party that may still be
    // filling in as COMBATANT_INFO arrives.
    runRowLive: renderToString(
      <RunRow
        analysis={{ ...analysis, live: true, meta: { ...analysis.meta, success: null } }}
        selected={false}
        onSelect={() => undefined}
      />,
    ),
    // The same key for someone with no MDT: no count, no dungeon art.
    runRowNoMdt: renderToString(
      <RunRow
        analysis={{ ...analysis, forces: NO_FORCES }}
        selected={false}
        onSelect={() => undefined}
      />,
    ),
  };
}

/** Re-exported so the assertions can compute the same party the row renders. */
export { partyOf };

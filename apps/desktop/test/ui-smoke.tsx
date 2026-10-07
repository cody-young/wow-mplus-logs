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

import { AvoidablePanel } from '../src/renderer/components/AvoidablePanel.js';
import { BreakdownTable } from '../src/renderer/components/BreakdownTable.js';
import { DeathTimeline } from '../src/renderer/components/DeathTimeline.js';
import { ControlPanel } from '../src/renderer/components/ControlPanel.js';
import { DispelsPanel } from '../src/renderer/components/DispelsPanel.js';
import { DeathsPanel } from '../src/renderer/components/DeathsPanel.js';
import { DungeonIcon } from '../src/renderer/components/DungeonIcon.js';
import { EnemyRoster, RosterTable } from '../src/renderer/components/EnemyRoster.js';
import { InterruptsPanel } from '../src/renderer/components/InterruptsPanel.js';
import { MapPanel } from '../src/renderer/components/MapPanel.js';
import { RunRow, partyOf } from '../src/renderer/components/RunRow.js';
import { SegmentTimeline } from '../src/renderer/components/SegmentTimeline.js';
import { SpecIcon } from '../src/renderer/components/SpecIcon.js';
import { UpdateFooter } from '../src/renderer/components/UpdateFooter.js';
import {
  shareAvoidable,
  shareBreakdown,
  shareControl,
  shareDeaths,
  shareDispels,
  shareInterrupts,
  shareRoute,
} from '../src/renderer/share.js';
import { SPECS } from '../src/renderer/specs.js';
import type { RunAnalysis, RunForces, UpdateState, UpdateStatus } from '../src/shared.js';

/** A run whose dungeon the criteria table does not cover, which drops the count columns. */
const NO_FORCES: RunForces = {
  known: false,
  dungeon: '',
  source: '',
  required: 0,
  teleportSpellId: 0,
  counted: 0,
  fraction: 0,
  incomplete: false,
};

/**
 * The update strip, which has more states than the rest of the sidebar put
 * together and reaches none of them on a machine that is already current. Every
 * phase is rendered here because the one that matters — a staged update, a
 * failed check — is the one nobody sees until it happens to them.
 */
function updateView(status: UpdateStatus, capability: UpdateState['capability'] = 'install'): string {
  const state: UpdateState = {
    capability,
    automatic: true,
    currentVersion: '0.1.2',
    releasesUrl: 'https://example.invalid/releases',
    status,
  };
  return renderToString(
    <UpdateFooter
      state={state}
      onCheck={() => undefined}
      onDownload={() => undefined}
      onInstall={() => undefined}
      onOpenReleases={() => undefined}
      onToggleAutomatic={() => undefined}
    />,
  );
}

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
    interrupts: renderToString(<InterruptsPanel interrupts={analysis.interrupts} />),
    // The press log, which is the half of this view a string render cannot
    // click its way into. Expanded by hand for the same reason the damage
    // table has an `expandedDamage` above.
    interruptLog: renderToString(
      <InterruptsPanel interrupts={analysis.interrupts} defaultExpanded />,
    ),
    control: renderToString(<ControlPanel control={analysis.control} />),
    // The application log, open for the same reason the press log above is.
    controlLog: renderToString(<ControlPanel control={analysis.control} defaultExpanded />),
    dispels: renderToString(<DispelsPanel dispels={analysis.dispels} />),
    // Every section's log open, for the same reason.
    dispelLog: renderToString(<DispelsPanel dispels={analysis.dispels} defaultExpanded />),
    avoidable: renderToString(<AvoidablePanel avoidable={analysis.avoidable} />),
    // Every player's hits open in every section, for the same reason.
    avoidableLog: renderToString(<AvoidablePanel avoidable={analysis.avoidable} defaultExpanded />),
    // Only the chrome around the canvas: the canvas has no size until it is
    // mounted, so a string render draws nothing on it by design.
    map: renderToString(<MapPanel run={analysis} selectedSegment={null} onSelectSegment={() => {}} />),
    // The copy button's text for every tab, whole key, which is plain text
    // rather than markup but fails the same ways: a crash on real data, a
    // line too long for chat.
    shareDamage: shareBreakdown(analysis.damage, 'done', { meta: analysis.meta, segment: null }),
    shareTaken: shareBreakdown(analysis.taken, 'taken', { meta: analysis.meta, segment: null }),
    shareHealing: shareBreakdown(analysis.healing, 'healing', { meta: analysis.meta, segment: null }),
    shareInterrupts: shareInterrupts(analysis.interrupts, { meta: analysis.meta, segment: null }),
    shareControl: shareControl(analysis.control, { meta: analysis.meta, segment: null }),
    shareDispels: shareDispels(analysis.dispels, { meta: analysis.meta, segment: null }),
    shareAvoidable: shareAvoidable(analysis.avoidable, { meta: analysis.meta, segment: null }),
    shareDeaths: shareDeaths(analysis.deaths, { meta: analysis.meta, segment: null }),
    shareRoute: shareRoute(analysis.segments, analysis.forces, { meta: analysis.meta, segment: null }),
    // One pull's text, which names the pull in its heading.
    shareSegment:
      analysis.segments[0] === undefined || perSegment === undefined
        ? ''
        : shareBreakdown(perSegment.damage, 'done', { meta: analysis.meta, segment: analysis.segments[0] }),
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
    // The death recap zoomed all the way in, which is where the row count
    // quadruples and the labels grow decimals. Rendered on its own because the
    // resolution is the chart's own state and a string render cannot click.
    deathZoomed:
      analysis.deaths[0] === undefined
        ? ''
        : renderToString(<DeathTimeline death={analysis.deaths[0]} defaultResolutionMs={250} />),
    // Degenerate inputs the UI must tolerate.
    emptyDeaths: renderToString(<DeathsPanel deaths={[]} />),
    // A key where nothing was ever interruptible, which is a real outcome and
    // not an error: no presses at all.
    emptyInterrupts: renderToString(<InterruptsPanel interrupts={{ attempts: [], stops: [] }} />),
    // A key where nobody pressed any control, which is an ordinary key and not
    // an error.
    emptyControl: renderToString(<ControlPanel control={{ applications: [], casts: 0 }} />),
    // A key where nothing was dispelled, which is common: plenty of dungeons
    // have nothing to purge and a party can avoid every debuff.
    emptyDispels: renderToString(<DispelsPanel dispels={{ dispels: [], casts: 0 }} />),
    // A clean key, and a key from a dungeon the list does not cover, which
    // must not read as clean.
    emptyAvoidable: renderToString(<AvoidablePanel avoidable={{ hits: [], covered: true, blizzard: [] }} />),
    uncoveredAvoidable: renderToString(<AvoidablePanel avoidable={{ hits: [], covered: false, blizzard: [] }} />),
    shareUncovered: shareAvoidable({ hits: [], covered: false, blizzard: [] }, { meta: analysis.meta, segment: null }),
    // Presses that stopped nothing whatsoever — the case where the panel's
    // headline number is zero and the breakdown is the whole content.
    allWhiffedInterrupts: renderToString(
      <InterruptsPanel
        interrupts={{
          attempts: analysis.interrupts.attempts.map((attempt) => ({
            ...attempt,
            outcome: 'nothing',
            stops: 0,
            castSpellId: 0,
            castSpellName: '',
            beatenBy: '',
          })),
          stops: [],
        }}
      />,
    ),
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
    // --- Updates -----------------------------------------------------------
    updateIdle: updateView({ phase: 'idle' }),
    updateChecking: updateView({ phase: 'checking' }),
    updateCurrent: updateView({ phase: 'none', checkedAt: Date.now() }),
    updateAvailable: updateView({
      phase: 'available',
      version: '0.1.3',
      notes: 'Fixes the count column.',
      sizeBytes: 113_246_208,
    }),
    // The feed knew about the version but not the file size, which is what a
    // release assembled by hand tends to look like.
    updateAvailableNoSize: updateView({
      phase: 'available',
      version: '0.1.3',
      notes: null,
      sizeBytes: null,
    }),
    // The same update seen by the portable .exe or the .deb, which cannot
    // apply it: no Download button, a link to the page instead.
    updateNotify: updateView(
      { phase: 'available', version: '0.1.3', notes: null, sizeBytes: 113_246_208 },
      'notify',
    ),
    updateDownloading: updateView({
      phase: 'downloading',
      version: '0.1.3',
      percent: 42.5,
      bytesPerSecond: 2_600_000,
    }),
    updateReady: updateView({ phase: 'ready', version: '0.1.3' }),
    updateFailed: updateView({ phase: 'failed', message: 'net::ERR_NAME_NOT_RESOLVED' }),
    // A dev run, where there is no feed to ask and the strip renders nothing.
    updateDev: updateView({ phase: 'idle' }, 'none'),

    // The same key for someone with no MDT: no count, no dungeon art.
    runRowNoMdt: renderToString(
      <RunRow
        analysis={{ ...analysis, forces: NO_FORCES }}
        selected={false}
        onSelect={() => undefined}
      />,
    ),

    // The real King's Rest +12: timed, 584 counted from the kills the log
    // reports dead, plus the 30 for the Shadow of Zul, which is driven to 1
    // health and removed by script. 614 of 608 is the full clear it was — just
    // over 100%, like any timed key, and the case the star must NOT appear on.
    runRowObjective: renderToString(
      <RunRow
        analysis={{
          ...analysis,
          meta: { ...analysis.meta, success: true },
          forces: {
            ...analysis.forces,
            known: true,
            required: 608,
            counted: 614,
            fraction: 614 / 608,
            incomplete: false,
          },
        }}
        selected={false}
        onSelect={() => undefined}
      />,
    ),

    // The same key short of the count it asks for, which is the one shortfall
    // worth warning about. Nobody sees this unless a dungeon is retuned out
    // from under the build, which is why it is rendered here.
    runRowShort: renderToString(
      <RunRow
        analysis={{
          ...analysis,
          meta: { ...analysis.meta, success: true },
          forces: {
            ...analysis.forces,
            known: true,
            required: 608,
            counted: 500,
            fraction: 500 / 608,
            incomplete: true,
          },
        }}
        selected={false}
        onSelect={() => undefined}
      />,
    ),
  };
}

/** Re-exported so the assertions can compute the same party the row renders. */
export { partyOf };

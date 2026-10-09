import { useEffect, useMemo, useRef, useState } from 'react';

import { SegmentKind } from '@mplus/analysis';

import { AurasPanel } from './components/AurasPanel.js';
import { AvoidablePanel } from './components/AvoidablePanel.js';
import { BreakdownTable } from './components/BreakdownTable.js';
import { WclBar } from './components/WclBar.js';
import { useWcl } from './wcl.js';
import { ControlPanel } from './components/ControlPanel.js';
import { DispelsPanel } from './components/DispelsPanel.js';
import { DeathsPanel } from './components/DeathsPanel.js';
import { EnemyRoster } from './components/EnemyRoster.js';
import { InterruptsPanel } from './components/InterruptsPanel.js';
import { MapPanel } from './components/MapPanel.js';
import { RunRow, memberTitle, partyOf } from './components/RunRow.js';
import { PullStat } from './components/PullStat.js';
import { SegmentTimeline } from './components/SegmentTimeline.js';
import { SpecIcon } from './components/SpecIcon.js';
import { StatsPanel } from './components/StatsPanel.js';
import { UpdateFooter, useUpdates } from './components/UpdateFooter.js';
import { awardsFor, badgesOf, type Badge } from './awards.js';
import { difficultyName, integer, percent, runClock, short, wipeCutoff } from './format.js';
import {
  shareAuras,
  shareAvoidable,
  shareBreakdown,
  shareControl,
  shareDeaths,
  shareDispels,
  shareInterrupts,
  shareRoute,
  shareStats,
} from './share.js';
import { shortName, specOf } from './specs.js';
import type { LogSummary, ParseProgress, RunAnalysis, StatsReport } from '../shared.js';

type Tab =
  | 'damage'
  | 'taken'
  | 'healing'
  | 'auras'
  | 'interrupts'
  | 'control'
  | 'dispels'
  | 'avoidable'
  | 'deaths'
  | 'stats'
  | 'map';

/** Tabs built on dungeon data — the avoidable list, MDT's map — that a raid pull does not get. */
const DUNGEON_TABS: ReadonlySet<Tab> = new Set(['avoidable', 'map']);

export function App(): React.JSX.Element {
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [analyses, setAnalyses] = useState<RunAnalysis[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('damage');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * True once the reader has deliberately gone back to an older key.
   *
   * A ref rather than state because nothing renders from it: it only decides
   * whether the next key to arrive is allowed to take the view. Reset when a
   * log is opened, since the choice was about the keys in the previous one.
   */
  const browsingOlder = useRef(false);
  /**
   * Runs whose awards ceremony has played. The ceremony plays the first time
   * the reader opens the awards tab on a finished key, and opens finished after
   * that. A ref for the same reason as `browsingOlder`: nothing renders from
   * it until the tab mounts again.
   */
  const celebrated = useRef(new Set<string>());
  const updates = useUpdates();

  useEffect(() => {
    const off = [
      window.mplus.onLog(setSummary),
      window.mplus.onProgress(setProgress),
      window.mplus.onAnalysis((analysis) => {
        setAnalyses((current) => {
          // A run arrives repeatedly while live, then once more when it ends.
          const index = current.findIndex((entry) => entry.runId === analysis.runId);
          if (index === -1) return [...current, analysis];
          const next = current.slice();
          next[index] = analysis;
          return next;
        });
      }),
      window.mplus.onDone(() => setBusy(false)),
      window.mplus.onFailed((message) => {
        setError(message);
        setBusy(false);
      }),
    ];
    return () => {
      for (const unsubscribe of off) unsubscribe();
    };
  }, []);

  const open = async (path: string | null, tail: boolean): Promise<void> => {
    if (path === null) return;
    setError(null);
    setAnalyses([]);
    setSelectedRun(null);
    setSelectedSegment(null);
    browsingOlder.current = false;
    // Cleared so the bar starts from empty rather than where the last log finished.
    setProgress(null);
    setBusy(true);
    setSummary({ path, sizeBytes: 0, advancedLogging: null, buildVersion: '' });
    const { mdtSearched } = await window.mplus.open(path, tail);
    // The map tab falls back to the log's coordinates without a word, so say here where MDT was looked for.
    if (mdtSearched.length > 0) {
      console.warn(`MDT not found for ${path}; looked in:\n  ${mdtSearched.join('\n  ')}`);
    }
  };

  /**
   * The key list, newest first.
   *
   * Sorted rather than reversed, because arrival order is only chronological
   * while reading a file start to finish — and sorted on `startMs` rather than
   * on the result, so a run still in progress stays at the top where it was
   * when it was still the one being watched.
   */
  const listed = useMemo(
    () => [...analyses].sort((a, b) => b.meta.startMs - a.meta.startMs),
    [analyses],
  );

  /**
   * Follow the newest key as the keys arrive.
   *
   * Live, that is the one being played, which is the whole point of watching a
   * log; reading a file, it is the key you came back to look at. Clicking an
   * older one stops the following — and clicking the newest again resumes it —
   * so the view is never pulled out from under someone mid-read, and no stale
   * key is left selected once a new one starts.
   */
  useEffect(() => {
    const newest = listed[0];
    if (newest === undefined || browsingOlder.current) return;
    if (selectedRun === newest.runId) return;
    setSelectedRun(newest.runId);
    // Segment ids are per run, so one carried across would show an unrelated
    // pull's numbers under the new key's name.
    setSelectedSegment(null);
  }, [listed, selectedRun]);

  const run = useMemo(
    () => analyses.find((entry) => entry.runId === selectedRun) ?? null,
    [analyses, selectedRun],
  );

  const raid = run?.meta.kind === 'raid';
  /**
   * The tab shown, which is the one picked unless this run lacks it. Kept apart
   * from `tab` so that stepping through raid pulls from the Map tab returns to
   * the map at the next key, instead of forgetting it was chosen.
   */
  const shown: Tab = raid && DUNGEON_TABS.has(tab) ? 'damage' : tab;

  const segment = useMemo(
    () => (run === null || selectedSegment === null ? null : run.segments.find((entry) => entry.id === selectedSegment) ?? null),
    [run, selectedSegment],
  );

  const wcl = useWcl(run);
  const parses = useMemo(() => {
    const result = wcl.result;
    if (result?.status !== 'found' || selectedSegment !== null) return undefined;
    const metric = shown === 'damage' ? 'dps' : shown === 'healing' ? 'hps' : null;
    if (metric === null) return undefined;
    return Object.fromEntries(
      Object.entries(result.players).flatMap(([actor, parsed]) =>
        parsed[metric] === undefined ? [] : [[Number(actor), parsed[metric]]],
      ),
    );
  }, [wcl.result, selectedSegment, shown]);

  const reports = useMemo(() => {
    if (run === null) return null;
    if (selectedSegment !== null && run.bySegment[selectedSegment] !== undefined) {
      return run.bySegment[selectedSegment];
    }
    return { damage: run.damage, taken: run.taken, healing: run.healing };
  }, [run, selectedSegment]);

  const deaths = useMemo(() => {
    if (run === null) return [];
    if (selectedSegment === null) return run.deaths;
    return run.deaths.filter((death) => death.segmentId === selectedSegment);
  }, [run, selectedSegment]);

  /**
   * The same filter for interrupts, which is all a pull's interrupts are.
   *
   * Every attempt carries the segment its target belongs to, so there is no
   * per-segment report to look up here the way there is for damage — the view
   * rolls the filtered lists up itself.
   */
  const interrupts = useMemo(() => {
    if (run === null) return { attempts: [], stops: [] };
    if (selectedSegment === null) return run.interrupts;
    return {
      attempts: run.interrupts.attempts.filter((attempt) => attempt.segmentId === selectedSegment),
      stops: run.interrupts.stops.filter((stop) => stop.segmentId === selectedSegment),
    };
  }, [run, selectedSegment]);

  /**
   * And the same for control, which is one list for the same reason.
   */
  const control = useMemo(() => {
    if (run === null) return { applications: [], casts: 0 };
    if (selectedSegment === null) return run.control;
    const applications = run.control.applications.filter(
      (application) => application.segmentId === selectedSegment,
    );
    return {
      applications,
      // Recounted rather than carried over: the run's figure counts presses
      // that landed in other pulls.
      casts: new Set(applications.map((application) => application.castId)).size,
    };
  }, [run, selectedSegment]);

  /**
   * And dispels, one list of all three kinds for the same reason.
   */
  const dispels = useMemo(() => {
    if (run === null) return { dispels: [], casts: 0 };
    if (selectedSegment === null) return run.dispels;
    const list = run.dispels.dispels.filter((entry) => entry.segmentId === selectedSegment);
    return { dispels: list, casts: new Set(list.map((entry) => entry.castId)).size };
  }, [run, selectedSegment]);

  /**
   * And avoidable damage, one list of hits for the same reason.
   */
  const avoidable = useMemo(() => {
    if (run === null) return { hits: [], covered: false };
    if (selectedSegment === null) return run.avoidable;
    return {
      hits: run.avoidable.hits.filter((hit) => hit.segmentId === selectedSegment),
      covered: run.avoidable.covered,
    };
  }, [run, selectedSegment]);

  /**
   * The window the auras tab cuts its spans to: the pull selected, else the
   * whole key.
   */
  const auraWindow = useMemo((): [number, number] => {
    if (segment !== null) return [segment.startTs, segment.endTs];
    return [0, run?.damage.durationMs ?? 0];
  }, [run, segment]);

  /** The post-game awards, for the whole run whatever pull is selected. */
  const awards = useMemo(() => (run === null ? null : awardsFor(run)), [run]);

  /**
   * And the awards tab's lists, for the same reason.
   */
  const stats = useMemo((): StatsReport => {
    if (run === null) {
      return {
        totemKills: [],
        falls: [],
        biggestHits: [],
        picks: [],
        lusts: [],
        cheats: [],
        ankhs: [],
        lockouts: [],
        reflects: [],
        taunts: [],
        selfInfusions: [],
        infusions: [],
        externals: [],
        rezzes: [],
        lifts: [],
        defensives: [],
        immunities: [],
        gateways: [],
        dashes: [],
        drains: [],
        tallies: [],
        paddingKnown: false,
      };
    }
    if (selectedSegment === null) return run.stats;
    const inPull = <T extends { segmentId: number }>(list: T[]): T[] =>
      list.filter((entry) => entry.segmentId === selectedSegment);
    // The tallies are whole-key sums with no pull to filter by; only the
    // badges read them, and a badge is for the whole run anyway.
    return {
      ...run.stats,
      totemKills: inPull(run.stats.totemKills),
      falls: inPull(run.stats.falls),
      biggestHits: inPull(run.stats.biggestHits),
      picks: inPull(run.stats.picks),
      lusts: inPull(run.stats.lusts),
      cheats: inPull(run.stats.cheats),
      ankhs: inPull(run.stats.ankhs),
      lockouts: inPull(run.stats.lockouts),
      reflects: inPull(run.stats.reflects),
      taunts: inPull(run.stats.taunts),
      selfInfusions: inPull(run.stats.selfInfusions),
      infusions: inPull(run.stats.infusions),
      externals: inPull(run.stats.externals),
      rezzes: inPull(run.stats.rezzes),
      lifts: inPull(run.stats.lifts),
      defensives: inPull(run.stats.defensives),
      immunities: inPull(run.stats.immunities),
      gateways: inPull(run.stats.gateways),
      dashes: inPull(run.stats.dashes),
      drains: inPull(run.stats.drains),
    };
  }, [run, selectedSegment]);

  /**
   * The open tab as text, for the copy button.
   *
   * Built on the click rather than on every render: the summaries behind it
   * are the panels' own, and nobody needs them twice unless they copy.
   */
  const shareText = (): string => {
    if (run === null || reports === null) return '';
    const scope = { meta: run.meta, segment };
    switch (shown) {
      case 'damage':
        return shareBreakdown(reports.damage, 'done', scope);
      case 'taken':
        return shareBreakdown(reports.taken, 'taken', scope);
      case 'healing':
        return shareBreakdown(reports.healing, 'healing', scope);
      case 'auras':
        return shareAuras(run.auras, partyOf(run), auraWindow, scope);
      case 'interrupts':
        return shareInterrupts(interrupts, scope);
      case 'control':
        return shareControl(control, scope);
      case 'dispels':
        return shareDispels(dispels, scope);
      case 'avoidable':
        return shareAvoidable(avoidable, scope);
      case 'deaths':
        return shareDeaths(deaths, scope);
      case 'stats':
        return shareStats(stats, partyOf(run), scope, awards);
      case 'map':
        return shareRoute(run.segments, run.forces, scope);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>M+ Logs</h1>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void window.mplus.pickLog().then((path) => open(path, false))}
            >
              Open log…
            </button>
            <button
              type="button"
              disabled={busy}
              data-tip="Find the newest combat log and follow it as you play"
              onClick={() => void window.mplus.watchLog().then((path) => open(path, true))}
            >
              Watch live
            </button>
          </div>
          {summary !== null ? <div className="path">{summary.path}</div> : null}
        </header>

        {busy ? (
          <div className="progress">
            <div style={{ width: `${percentRead(progress)}%` }} />
          </div>
        ) : null}

        <div className="runs">
          {analyses.length === 0 && !busy ? (
            <p style={{ color: 'var(--dim)', padding: '10px 9px', fontSize: 13, lineHeight: 1.5 }}>
              Nothing loaded yet.
            </p>
          ) : null}
          {listed.map((analysis) => (
            <RunRow
              key={analysis.runId}
              analysis={analysis}
              selected={analysis.runId === selectedRun}
              onSelect={() => {
                browsingOlder.current = analysis.runId !== listed[0]?.runId;
                setSelectedRun(analysis.runId);
                setSelectedSegment(null);
              }}
            />
          ))}
        </div>

        {updates !== null ? <UpdateFooter {...updates} /> : null}
      </aside>

      <main className="main">
        {run === null ? (
          <Welcome summary={summary} busy={busy} error={error} progress={progress} />
        ) : (
          <>
            <header>
              {run.meta.kind === 'key' ? (
                <h2>
                  +{run.meta.keystoneLevel} {run.meta.zoneName}
                </h2>
              ) : (
                <h2>
                  {run.meta.encounterName}
                  <span style={{ color: 'var(--dim)', fontWeight: 'normal' }}>
                    {' '}
                    {difficultyName(run.meta.difficultyId)} · pull {run.meta.pull}
                  </span>
                </h2>
              )}
              {run.live ? <span className="live">live</span> : null}
              <div className="stat">
                <span className="label">Time</span>
                <span className="value">{runClock(run.meta)}</span>
              </div>
              <div className="stat">
                <span className="label">{raid ? 'Raid dps' : 'Party dps'}</span>
                <span className="value">
                  {/* The report's own duration, which is elapsed time. The
                      keystone clock beside it is longer by the death penalty
                      and would quietly understate every rate on the page. */}
                  {short(run.damage.total / Math.max(run.damage.durationMs / 1000, 1))}
                </span>
              </div>
              {raid ? null : (
                <>
                  <div className="stat">
                    <span className="label">Count</span>
                    <span
                      className="value"
                      data-tip={
                        run.forces.known
                          ? `${integer(run.forces.counted)} of the ${integer(run.forces.required)} enemy` +
                            ` forces this dungeon asks for — values from ${run.forces.source}.` +
                            ' A dungeon holds more count than it requires, so a full route reads a' +
                            ' little over 100%' +
                            (run.forces.incomplete
                              ? '. The game completed this key, so the count was met — these kills do' +
                                ' not add up to it'
                              : '')
                          : 'Enemy forces are not in the combat log, and the criteria table has no' +
                            ' entry for this dungeon.'
                      }
                    >
                      {run.forces.known ? (
                        <>
                          {integer(run.forces.counted)}
                          <span style={{ color: 'var(--dim)' }}>
                            {' '}
                            / {integer(run.forces.required)} · {percent(run.forces.fraction)}
                            {/* A completed key met its requirement, so a figure under
                                100% is the table's error and not the party's. Marked
                                here and explained in the banner below. */}
                            {run.forces.incomplete ? '*' : ''}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--dim)' }}>—</span>
                      )}
                    </span>
                  </div>
                </>
              )}
              <div className="stat">
                <span className="label">Deaths</span>
                <span className="value">
                  {run.deaths.length}
                  {/* What the deaths cost on the keystone timer. A raid has no timer. */}
                  {raid ? null : <span style={{ color: 'var(--dim)' }}> · {run.deaths.length * 5}s</span>}
                </span>
              </div>
              {run.pull === null ? null : <PullStat analysis={run} pull={run.pull} />}
              <div className="stat">
                <span className="label">{raid ? `Raid · ${run.meta.party.length}` : 'Party'}</span>
                <span className="value" style={{ display: 'flex', flexWrap: 'wrap', gap: raid ? 3 : 7 }}>
                  {/* Twenty names do not fit a header, so a raid shows the icons
                      and leaves the names to their hover. */}
                  {partyOf(run).map((member) => (
                    <span key={member.actorIndex} className="party-member">
                      <SpecIcon specId={member.specId} title={memberTitle(member)} />
                      {raid ? null : (
                        <span style={{ color: specOf(member.specId).color }}>
                          {shortName(member.name)}
                        </span>
                      )}
                      {raid ? null : (
                        <BadgeChips
                          badges={badgesOf(awards, member.actorIndex)}
                          mvp={awards?.mvp.includes(member.actorIndex) === true}
                          reason={member.actorIndex}
                          onOpen={() => setTab('stats')}
                        />
                      )}
                    </span>
                  ))}
                </span>
              </div>
            </header>

            <nav className="tabs">
              {(
                [
                  ['damage', 'Damage done'],
                  ['taken', 'Damage taken'],
                  ['healing', 'Healing'],
                  ['auras', 'Auras'],
                  [
                    'interrupts',
                    `Interrupts${interrupts.stops.length > 0 ? ` (${interrupts.stops.length})` : ''}`,
                  ],
                  ['control', `CC${control.casts > 0 ? ` (${control.casts})` : ''}`],
                  [
                    'dispels',
                    `Dispels${dispels.dispels.length > 0 ? ` (${dispels.dispels.length})` : ''}`,
                  ],
                  [
                    'avoidable',
                    `Superiority Assister${avoidable.hits.length > 0 ? ` (${avoidable.hits.length})` : ''}`,
                  ],
                  ['deaths', `Deaths${deaths.length > 0 ? ` (${deaths.length})` : ''}`],
                  ['stats', 'Awards'],
                  ['map', 'Map'],
                ] as Array<[Tab, string]>
              )
                .filter(([key]) => !(raid && DUNGEON_TABS.has(key)))
                .map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`tab${shown === key ? ' active' : ''}`}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              <CopyButton text={shareText} />
            </nav>

            <div className="content">
              {summary?.advancedLogging === false ? (
                <div className="warn">
                  Advanced combat logging is off in this log. Health traces, positions and death
                  post-mortems need it. Enable it in the game&apos;s Network settings before the next key.
                </div>
              ) : null}

              {run.forces.incomplete ? (
                <div className="warn">
                  Count reads {percent(run.forces.fraction)}, which cannot be what happened: enemy
                  forces are a completion requirement, and the game completed this key. Every
                  creature that died was credited at{' '}
                  {run.forces.source === '' ? 'the forces table' : run.forces.source}&apos;s own
                  value, reaching {integer(run.forces.counted)} of the{' '}
                  {integer(run.forces.required)} this dungeon asks for. So either a creature here is
                  worth more than the table says, or the dungeon was retuned since this build read
                  it. Treat every count on this page as a floor.
                </div>
              ) : null}

              {/* A raid pull is one fight, so there is nothing to pick between. */}
              {raid ? null : (
                <SegmentTimeline
                  segments={run.segments}
                  durationMs={Math.max(run.damage.durationMs, ...run.segments.map((s) => s.endTs))}
                  forces={run.forces}
                  selectedId={selectedSegment}
                  onSelect={setSelectedSegment}
                />
              )}

              {segment !== null ? <EnemyRoster segment={segment} forces={run.forces} /> : null}

              {shown === 'map' ? (
                <MapPanel
                  key={run.runId}
                  run={run}
                  selectedSegment={selectedSegment}
                  onSelectSegment={setSelectedSegment}
                />
              ) : shown === 'stats' ? (
                <StatsPanel
                  key={run.runId}
                  party={partyOf(run)}
                  awards={awards}
                  autoplay={!celebrated.current.has(run.runId)}
                  onPlayed={() => celebrated.current.add(run.runId)}
                />
              ) : shown === 'deaths' ? (
                <DeathsPanel
                  key={`${run.runId}:${selectedSegment ?? 'all'}`}
                  deaths={deaths}
                  wipeAfter={wipeCutoff(run.meta, deaths)}
                  clean={raid ? 'Nobody died this pull.' : 'Clean key.'}
                  showWhere={!raid}
                />
              ) : shown === 'auras' ? (
                <AurasPanel
                  key={run.runId}
                  auras={run.auras.auras}
                  party={partyOf(run)}
                  from={auraWindow[0]}
                  to={auraWindow[1]}
                />
              ) : shown === 'interrupts' ? (
                <InterruptsPanel
                  key={`${run.runId}:${selectedSegment ?? 'all'}`}
                  interrupts={interrupts}
                />
              ) : shown === 'control' ? (
                <ControlPanel key={`${run.runId}:${selectedSegment ?? 'all'}`} control={control} />
              ) : shown === 'dispels' ? (
                <DispelsPanel key={`${run.runId}:${selectedSegment ?? 'all'}`} dispels={dispels} />
              ) : shown === 'avoidable' ? (
                <AvoidablePanel
                  key={`${run.runId}:${selectedSegment ?? 'all'}`}
                  avoidable={avoidable}
                />
              ) : reports !== null ? (
                <>
                  <BreakdownTable
                    report={shown === 'damage' ? reports.damage : shown === 'taken' ? reports.taken : reports.healing}
                    mode={shown === 'damage' ? 'done' : shown === 'taken' ? 'taken' : 'healing'}
                    {...(parses === undefined ? {} : { parses })}
                  />
                  {shown !== 'taken' && !raid ? <WclBar wcl={wcl} wholeRun={selectedSegment === null} /> : null}
                </>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * A party member's badges beside their name in the header, MVP crown first.
 *
 * Icons only, with the title and what earned it on the hover, so five names
 * with a few badges each still fit one header line. A click opens the awards
 * tab, which is a click the reader made.
 */
function BadgeChips({
  badges,
  mvp,
  reason,
  onOpen,
}: {
  badges: readonly Badge[];
  mvp: boolean;
  /** The member's actor index, to read what earned each badge. */
  reason: number;
  onOpen: () => void;
}): React.JSX.Element | null {
  if (badges.length === 0 && !mvp) return null;
  return (
    <button type="button" className="badge-chips" onClick={onOpen} data-tip="Open the awards">
      {mvp ? (
        <span className="badge-chip mvp" data-tip="Dungeon MVP">
          ♛
        </span>
      ) : null}
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`badge-chip${badge.roast ? ' roast' : ''}`}
          data-tip={`${badge.title}: ${badge.reasons[reason] ?? ''}`}
        >
          {badge.icon}
        </span>
      ))}
    </button>
  );
}

/**
 * Copies the open tab as text, and says so for a moment.
 *
 * Takes a function rather than the text, so the text is only built when
 * someone actually copies.
 */
function CopyButton({ text }: { text: () => string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = (): void => {
    window.clearTimeout(timer.current);
    window.mplus
      .copyText(text())
      .then(() => setState('done'))
      .catch(() => setState('failed'))
      .finally(() => {
        timer.current = window.setTimeout(() => setState('idle'), 1600);
      });
  };

  return (
    <button
      type="button"
      className={`share${state === 'done' ? ' done' : ''}`}
      data-tip="Copy this tab as text, ready to paste into chat or Discord"
      onClick={copy}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

/** How far through the file the worker is, 0 to 100; 0 before the first report. */
function percentRead(progress: ParseProgress | null): number {
  if (progress === null || progress.totalBytes <= 0) return 0;
  return Math.min(100, (progress.bytesRead / progress.totalBytes) * 100);
}

function Welcome({
  summary,
  busy,
  error,
  progress,
}: {
  summary: LogSummary | null;
  busy: boolean;
  error: string | null;
  progress: ParseProgress | null;
}): React.JSX.Element {
  return (
    <div className="content">
      <div className="empty">
        {error !== null ? (
          <>
            <h2>Could not read that log</h2>
            <p style={{ color: 'var(--danger)' }}>{error}</p>
          </>
        ) : busy ? (
          <>
            <h2>Reading {summary?.path.split('/').pop() ?? 'log'}…</h2>
            <div
              className="progress reading"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percentRead(progress))}
            >
              <div style={{ width: `${percentRead(progress)}%` }} />
            </div>
            {progress !== null ? (
              <p>
                {percentRead(progress).toFixed(0)}% · {integer(progress.linesSeen)} lines ·{' '}
                {(progress.bytesRead / 1_048_576).toFixed(0)} of {(progress.totalBytes / 1_048_576).toFixed(0)} MB
                {progress.elapsedMs > 0
                  ? ` · ${(progress.bytesRead / 1_048_576 / (progress.elapsedMs / 1000)).toFixed(0)} MB/s`
                  : ''}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h2>Open a combat log</h2>
            <p>
              <strong>Open log…</strong> reads a saved <code>WoWCombatLog-*.txt</code> and lists every key and
              raid boss pull in it.
            </p>
            <p>
              <strong>Watch live</strong> finds your newest log and follows it as you play. If it cannot
              find one, it asks you for it once and remembers the folder.
            </p>
            <p style={{ marginTop: 18, color: 'var(--dim)' }}>
              Type <code>/combatlog</code> in game to start logging, and turn on advanced combat logging
              in Network settings — death analysis depends on it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

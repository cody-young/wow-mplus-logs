import { useEffect, useMemo, useState } from 'react';

import { SegmentKind } from '@mplus/analysis';

import { BreakdownTable } from './components/BreakdownTable.js';
import { DeathsPanel } from './components/DeathsPanel.js';
import { EnemyRoster } from './components/EnemyRoster.js';
import { RunRow, memberTitle, partyOf } from './components/RunRow.js';
import { SegmentTimeline } from './components/SegmentTimeline.js';
import { SpecIcon } from './components/SpecIcon.js';
import { clock, integer, percent, short } from './format.js';
import { shortName, specOf } from './specs.js';
import type { LogSummary, ParseProgress, RunAnalysis } from '../shared.js';

type Tab = 'damage' | 'taken' | 'healing' | 'deaths';

export function App(): React.JSX.Element {
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [analyses, setAnalyses] = useState<RunAnalysis[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('damage');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        setSelectedRun((current) => current ?? analysis.runId);
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
    setBusy(true);
    setSummary({ path, sizeBytes: 0, advancedLogging: null, buildVersion: '' });
    await window.mplus.open(path, tail);
  };

  const run = useMemo(
    () => analyses.find((entry) => entry.runId === selectedRun) ?? null,
    [analyses, selectedRun],
  );

  const segment = useMemo(
    () => (run === null || selectedSegment === null ? null : run.segments.find((entry) => entry.id === selectedSegment) ?? null),
    [run, selectedSegment],
  );

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
              title="Find the newest combat log and follow it as you play"
              onClick={() => void window.mplus.findLatestLog().then((path) => open(path, true))}
            >
              Watch live
            </button>
          </div>
          {summary !== null ? <div className="path">{summary.path}</div> : null}
        </header>

        {busy && progress !== null ? (
          <div className="progress">
            <div
              style={{
                width: `${progress.totalBytes > 0 ? Math.min(100, (progress.bytesRead / progress.totalBytes) * 100) : 0}%`,
              }}
            />
          </div>
        ) : null}

        <div className="runs">
          {analyses.length === 0 && !busy ? (
            <p style={{ color: 'var(--dim)', padding: '10px 9px', fontSize: 12, lineHeight: 1.5 }}>
              No keys loaded yet.
            </p>
          ) : null}
          {analyses.map((analysis) => (
            <RunRow
              key={analysis.runId}
              analysis={analysis}
              selected={analysis.runId === selectedRun}
              onSelect={() => {
                setSelectedRun(analysis.runId);
                setSelectedSegment(null);
              }}
            />
          ))}
        </div>
      </aside>

      <main className="main">
        {run === null ? (
          <Welcome summary={summary} busy={busy} error={error} progress={progress} />
        ) : (
          <>
            <header>
              <h2>
                +{run.meta.keystoneLevel} {run.meta.zoneName}
              </h2>
              {run.live ? <span className="live">live</span> : null}
              <div className="stat">
                <span className="label">Time</span>
                <span className="value">{clock(run.meta.totalTimeMs ?? 0)}</span>
              </div>
              <div className="stat">
                <span className="label">Party dps</span>
                <span className="value">
                  {short(
                    run.damage.total / Math.max((run.meta.totalTimeMs ?? 1) / 1000, 1),
                  )}
                </span>
              </div>
              <div className="stat">
                <span className="label">Count</span>
                <span
                  className="value"
                  title={
                    run.forces.known
                      ? `${integer(run.forces.counted)} of ${integer(run.forces.total)} enemy forces` +
                        ` — values from ${run.forces.source}` +
                        (run.forces.unknown.length > 0
                          ? `. ${run.forces.unknown.length} creature(s) killed are not in that` +
                            ` table (npc ${run.forces.unknown.join(', ')}), so this is a lower bound`
                          : '')
                      : 'Enemy forces are not in the combat log. Install Mythic Dungeon Tools' +
                        ' into the same WoW folder this log came from and reopen the log.'
                  }
                >
                  {run.forces.known ? (
                    <>
                      {integer(run.forces.counted)}
                      <span style={{ color: 'var(--dim)' }}>
                        {' '}
                        / {integer(run.forces.total)} · {percent(run.forces.fraction)}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--dim)' }}>—</span>
                  )}
                </span>
              </div>
              <div className="stat">
                <span className="label">Deaths</span>
                <span className="value">
                  {run.deaths.length}
                  <span style={{ color: 'var(--dim)' }}> · {run.deaths.length * 5}s</span>
                </span>
              </div>
              <div className="stat">
                <span className="label">Party</span>
                <span className="value" style={{ display: 'flex', gap: 7 }}>
                  {partyOf(run).map((member) => (
                    <span key={member.actorIndex} className="party-member">
                      <SpecIcon specId={member.specId} title={memberTitle(member)} />
                      <span style={{ color: specOf(member.specId).color }}>
                        {shortName(member.name)}
                      </span>
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
                  ['deaths', `Deaths${deaths.length > 0 ? ` (${deaths.length})` : ''}`],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`tab${tab === key ? ' active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="content">
              {summary?.advancedLogging === false ? (
                <div className="warn">
                  Advanced combat logging is off in this log. Health traces, positions and death
                  post-mortems need it. Enable it in the game&apos;s Network settings before the next key.
                </div>
              ) : null}

              <SegmentTimeline
                segments={run.segments}
                durationMs={Math.max(run.meta.totalTimeMs ?? 0, ...run.segments.map((s) => s.endTs))}
                forces={run.forces}
                selectedId={selectedSegment}
                onSelect={setSelectedSegment}
              />

              {segment !== null ? <EnemyRoster segment={segment} forces={run.forces} /> : null}

              {tab === 'deaths' ? (
                <DeathsPanel key={`${run.runId}:${selectedSegment ?? 'all'}`} deaths={deaths} />
              ) : reports !== null ? (
                <BreakdownTable
                  report={tab === 'damage' ? reports.damage : tab === 'taken' ? reports.taken : reports.healing}
                  mode={tab === 'damage' ? 'done' : tab === 'taken' ? 'taken' : 'healing'}
                />
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
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
            {progress !== null ? (
              <p>
                {integer(progress.linesSeen)} lines · {(progress.bytesRead / 1_048_576).toFixed(0)} MB
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
              <strong>Open log…</strong> reads a saved <code>WoWCombatLog-*.txt</code> and lists every key in it.
            </p>
            <p>
              <strong>Watch live</strong> finds your newest log and follows it as you play.
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

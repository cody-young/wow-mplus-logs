/**
 * Warcraft Logs parses for the open run, fetched once it has finished.
 *
 * Only a finished key is looked up: a run still being tailed cannot have been
 * uploaded and ranked yet, and asking on every live update would spend the
 * reader's rate budget on nothing. A raid pull is not looked up yet either.
 *
 * A key that has only just finished is usually not on Warcraft Logs yet, or
 * is there but not ranked, so a miss is asked about again on a backoff while
 * the key is open and the window is showing. Only for a recent key: a miss
 * on one from hours ago is not going to change.
 */
import { useCallback, useEffect, useState } from 'react';

import type { RunAnalysis, WclRunResult, WclStatus } from '../shared.js';

/** Delay before each automatic re-ask after a miss, in order. */
const BACKOFF_MS = [5_000, 30_000, 60_000, 120_000, 240_000];
/** How long after a key ends a miss is still worth re-asking about. */
const RECENT_MS = 60 * 60_000;

export interface WclState {
  status: WclStatus | null;
  /** Whether the open run is one that can be looked up: a finished key. */
  lookable: boolean;
  /** Null while there is nothing to ask about, or the first answer is on its way. */
  result: WclRunResult | null;
  /** True while asking again after a miss; `result` still holds the miss. */
  checking: boolean;
  signIn(): void;
  signOut(): void;
  /** Asks again now, and restarts the backoff. */
  retry(): void;
}

/** Which ask this is for the run: `n` counts asks, `step` the backoff used. */
interface Ask {
  runId: string | null;
  n: number;
  step: number;
}

export function useWcl(run: RunAnalysis | null): WclState {
  const [status, setStatus] = useState<WclStatus | null>(null);
  const [result, setResult] = useState<WclRunResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [askState, setAsk] = useState<Ask>({ runId: null, n: 0, step: 0 });
  const visible = useVisible();

  useEffect(() => {
    void window.mplus.wclStatus().then(setStatus);
  }, []);

  const runId = run?.runId ?? null;
  const meta = run?.meta ?? null;
  const lookable = run !== null && !run.live && meta?.kind === 'key' && meta.endMs !== null;
  const signedIn = status?.signedIn === true;
  // Asks belong to a run; a different run starts from its first.
  const ask = askState.runId === runId ? askState : { runId, n: 0, step: 0 };

  useEffect(() => {
    // A re-ask keeps the miss on screen until the new answer replaces it.
    if (ask.n === 0) setResult(null);
    if (!lookable || !signedIn || run === null || meta?.kind !== 'key' || meta.endMs === null) return;
    let current = true;
    setChecking(ask.n > 0);
    void window.mplus
      .wclParses(
        {
          runId: run.runId,
          keystoneLevel: meta.keystoneLevel,
          startMs: meta.startMs,
          endMs: meta.endMs,
          utcOffsetMinutes: meta.utcOffsetMinutes,
          party: meta.party.map((actorIndex) => ({ actorIndex, name: run.names[actorIndex] ?? '' })),
        },
        ask.n > 0,
      )
      .then((next) => {
        if (!current) return;
        setResult(next);
        setChecking(false);
        if (next.status === 'signed-out') setStatus((s) => (s === null ? s : { ...s, signedIn: false }));
      });
    return () => {
      current = false;
      setChecking(false);
    };
    // The run's identity, not the object: a re-sent analysis of the same key
    // must not ask again.
  }, [runId, lookable, signedIn, ask.n]);

  const missed =
    result !== null && (result.status === 'not-found' || result.status === 'unranked' || result.status === 'error');
  // The log's times are its local wall clock; the offset makes them an instant.
  const endedAt =
    meta?.kind === 'key' && meta.endMs !== null ? meta.endMs - meta.utcOffsetMinutes * 60_000 : null;

  useEffect(() => {
    if (!lookable || !missed || checking || !visible || endedAt === null) return;
    if (Date.now() - endedAt > RECENT_MS) return;
    const delay = BACKOFF_MS[ask.step];
    if (delay === undefined) return;
    // Hidden or switched away, the timer goes; the step it was on comes back.
    const timer = setTimeout(() => {
      setAsk((prev) => {
        const from = prev.runId === runId ? prev : { runId, n: 0, step: 0 };
        return { runId, n: from.n + 1, step: from.step + 1 };
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [runId, lookable, missed, checking, visible, endedAt, ask.step]);

  const signIn = useCallback(() => {
    void window.mplus.wclSignIn().then(setStatus);
  }, []);
  const signOut = useCallback(() => {
    void window.mplus.wclSignOut().then(setStatus);
  }, []);
  const retry = useCallback(() => {
    setAsk((prev) => {
      const from = prev.runId === runId ? prev : { runId, n: 0, step: 0 };
      return { runId, n: from.n + 1, step: 0 };
    });
  }, [runId]);

  return {
    status,
    lookable,
    result: lookable ? result : null,
    checking: lookable && checking,
    signIn,
    signOut,
    retry,
  };
}

/** Whether the window is showing, so a hidden app does not keep asking. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/** Warcraft Logs' own colour bands, so a parse reads as it does on the site. */
export function parseColor(percent: number): string {
  if (percent >= 100) return '#e5cc80';
  if (percent >= 99) return '#e268a8';
  if (percent >= 95) return '#ff8000';
  if (percent >= 75) return '#a335ee';
  if (percent >= 50) return '#0070ff';
  if (percent >= 25) return '#1eff00';
  return '#9d9d9d';
}

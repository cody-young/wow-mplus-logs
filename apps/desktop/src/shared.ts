/**
 * The contract between the parse worker, the main process and the renderer.
 *
 * Everything crossing these boundaries must be structured-cloneable, which is
 * why the renderer never sees the event store: typed-array columns stay in the
 * worker and only finished reports are posted. A report for a long key is a few
 * hundred kilobytes; the store it came from is tens of megabytes.
 */
import type {
  ActorBreakdown,
  BreakdownReport,
  DeathReport,
  EnemyGroup,
  InterruptAttempt,
  InterruptReport,
  InterruptStop,
  RunForces,
  Segment,
} from '@mplus/analysis';
import type { ForcesTable } from '@mplus/data';
import type { RunMeta } from '@mplus/parser';

export type {
  ActorBreakdown,
  BreakdownReport,
  DeathReport,
  EnemyGroup,
  InterruptAttempt,
  InterruptReport,
  InterruptStop,
  RunForces,
  Segment,
  RunMeta,
};

/** Per-segment reports, keyed by segment id. */
export interface SegmentReports {
  damage: BreakdownReport;
  taken: BreakdownReport;
  healing: BreakdownReport;
}

export interface RunAnalysis {
  runId: string;
  meta: RunMeta;
  /** Actor index -> display name, for everything the reports reference. */
  names: Record<number, string>;
  segments: Segment[];
  damage: BreakdownReport;
  taken: BreakdownReport;
  healing: BreakdownReport;
  deaths: DeathReport[];
  /**
   * Every interrupt pressed and every cast stopped, as two flat lists.
   *
   * Not split per segment like the damage reports, because they need the event
   * store and these do not: each attempt carries the segment its target belongs
   * to, so selecting a pull is a filter in the view rather than another report
   * to compute and ship.
   */
  interrupts: InterruptReport;
  bySegment: Record<number, SegmentReports>;
  /**
   * Enemy forces for the run. `known: false` when no table covered the
   * dungeon, which is the normal case without MDT installed.
   */
  forces: RunForces;
  /** True while the key is still in progress. */
  live: boolean;
}

export interface LogSummary {
  path: string;
  sizeBytes: number;
  /** Null until COMBAT_LOG_VERSION is seen. */
  advancedLogging: boolean | null;
  buildVersion: string;
}

export interface ParseProgress {
  bytesRead: number;
  totalBytes: number;
  linesSeen: number;
  elapsedMs: number;
}

export type WorkerRequest =
  /**
   * The forces table travels with the request rather than being read by the
   * worker, because finding MDT is filesystem guesswork that belongs with the
   * other install discovery in the main process, and because the worker is
   * meant to be portable enough to become a browser worker later.
   */
  | { type: 'open'; path: string; tail: boolean; forces: ForcesTable }
  | { type: 'stop' };

export type WorkerEvent =
  | { type: 'log'; summary: LogSummary }
  | { type: 'progress'; progress: ParseProgress }
  | { type: 'analysis'; analysis: RunAnalysis }
  | { type: 'done'; runCount: number }
  | { type: 'failed'; message: string };

/**
 * What the running build can do about a new version.
 *
 * `install` is the NSIS installer and the AppImage, which can replace
 * themselves. `notify` is the portable .exe and the .deb, which can see an
 * update but cannot apply it — those builds get a link to the releases page.
 * `none` is a dev run, where there is no update feed at all.
 */
export type UpdateCapability = 'install' | 'notify' | 'none';

export type UpdateStatus =
  /** Nothing to say: never checked, or a quiet automatic check found nothing. */
  | { phase: 'idle' }
  | { phase: 'checking' }
  | {
      phase: 'available';
      version: string;
      /** Release notes, when the feed carried them as text. */
      notes: string | null;
      sizeBytes: number | null;
    }
  | { phase: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  /** Downloaded and staged. Installs on the next quit, or on request. */
  | { phase: 'ready'; version: string }
  /** Up to date, and someone asked — so it is worth confirming. */
  | { phase: 'none'; checkedAt: number }
  | { phase: 'failed'; message: string };

export interface UpdateState {
  capability: UpdateCapability;
  /** Whether the startup check runs. Persisted across launches. */
  automatic: boolean;
  currentVersion: string;
  /** Where a `notify` build sends the reader. */
  releasesUrl: string;
  status: UpdateStatus;
}

/** What the preload bridge exposes on window.mplus. */
export interface DesktopApi {
  /** Opens a file picker and begins parsing. Resolves to the chosen path. */
  pickLog(): Promise<string | null>;
  /**
   * The log to follow live: the newest in the remembered directory, else the
   * newest the install search finds, else whatever the reader picks when asked.
   * Null when there is nothing to watch and they dismissed the picker.
   */
  watchLog(): Promise<string | null>;
  open(path: string, tail: boolean): Promise<void>;
  /**
   * Spell icons as data URLs, keyed by spell id. Ids with no icon available
   * are omitted, so the result is exactly what the UI can draw. Never
   * rejects: unavailable icons are an empty result, not an error.
   */
  resolveIcons(spellIds: number[]): Promise<Record<number, string>>;
  /**
   * The same, for art asked for by texture name rather than by spell id — the
   * spec icons, which are not spells and so have no id to look up. Keyed by
   * the name that was asked for, with unavailable names omitted.
   */
  resolveNamedIcons(names: string[]): Promise<Record<string, string>>;
  onLog(handler: (summary: LogSummary) => void): () => void;
  onProgress(handler: (progress: ParseProgress) => void): () => void;
  onAnalysis(handler: (analysis: RunAnalysis) => void): () => void;
  onDone(handler: (runCount: number) => void): () => void;
  onFailed(handler: (message: string) => void): () => void;
  /** The update state as it stands, for the first render. */
  updateState(): Promise<UpdateState>;
  /** Check now, on behalf of the reader: failures are reported, not swallowed. */
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  /** Quit and install a staged update. Does not return. */
  installUpdate(): Promise<void>;
  setAutomaticUpdates(on: boolean): Promise<void>;
  /** Opens the releases page in the system browser. */
  openReleases(): Promise<void>;
  onUpdateState(handler: (state: UpdateState) => void): () => void;
}

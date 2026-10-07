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
  AvoidableHit,
  AvoidableReport,
  BreakdownReport,
  ControlApplication,
  ControlReport,
  DeathReport,
  DispelRecord,
  DispelReport,
  EnemyGroup,
  InterruptAttempt,
  InterruptReport,
  InterruptStop,
  MdtFloorFit,
  MdtMatch,
  MdtPlacement,
  PositionReport,
  PositionTrack,
  RunForces,
  Segment,
} from '@mplus/analysis';
import type { ForcesTable, MdtDungeon } from '@mplus/data';
import type { RunMeta } from '@mplus/parser';

export type {
  ActorBreakdown,
  AvoidableHit,
  AvoidableReport,
  BreakdownReport,
  ControlApplication,
  ControlReport,
  DeathReport,
  DispelRecord,
  DispelReport,
  EnemyGroup,
  InterruptAttempt,
  InterruptReport,
  InterruptStop,
  MdtFloorFit,
  MdtMatch,
  MdtPlacement,
  PositionReport,
  PositionTrack,
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
  /**
   * Every control the party put on an enemy, as one flat list.
   *
   * Not split per segment, for the same reason as the interrupts: each
   * application carries the segment its target belongs to, so a pull is a
   * filter in the view rather than another report to compute and ship.
   */
  control: ControlReport;
  /**
   * Every aura the party dispelled, purged, soothed or stole, as one flat list.
   *
   * One list rather than three, because the tab's first chart stacks the three
   * kinds per player; each record says which it was. Not split per segment,
   * for the same reason as the control list.
   */
  dispels: DispelReport;
  /**
   * Every avoidable hit the party took, as one flat list, and whether the
   * dungeon is one the avoidable list covers at all.
   *
   * Not split per segment, for the same reason as the control list.
   */
  avoidable: AvoidableReport;
  /**
   * Where every party member and engaged enemy was over the key, for the map.
   *
   * The one report made of typed arrays, a few hundred kilobytes for a long
   * key. They cross the worker and IPC boundaries as copies of their bytes,
   * which is far cheaper than the same samples as objects would be.
   */
  positions: PositionReport;
  /**
   * The run fitted to Mythic Dungeon Tools' map of the dungeon, floor by
   * floor. Null when MDT is not installed or has no map of this dungeon.
   */
  mdt: MdtPlacement | null;
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
  | { type: 'open'; path: string; tail: boolean; forces: ForcesTable; mdt: MdtDungeon[] }
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
   * Spell descriptions as plain text, keyed by spell id, from the same
   * tooltip lookup as the icons and with the same contract: missing ids are
   * omitted, and it never rejects.
   */
  resolveDescriptions(spellIds: number[]): Promise<Record<number, string>>;
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
  /**
   * Puts text on the system clipboard, for the share button on every tab.
   *
   * Through the main process rather than navigator.clipboard, which a
   * sandboxed renderer only gets with focus and a permission grant; a web
   * build swaps this for that.
   */
  copyText(text: string): Promise<void>;
  /**
   * One MDT floor's 150 map tiles as data URLs, in MDT's order (row by row
   * from the top left), with null for a tile that could not be read. Null
   * when MDT is not installed beside the open log. `textureDir` is a
   * sublevel's, relative to MDT's folder.
   */
  mdtTiles(textureDir: string, sublevel: number): Promise<Array<string | null> | null>;
}

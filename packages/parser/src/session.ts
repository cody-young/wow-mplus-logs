import type { ActorTable } from './actors.js';
import { CombatLogParser, type ChallengeEndInfo, type ChallengeStartInfo, type CombatantInfo, type EncounterInfo, type LogVersionInfo, type ParserOptions } from './parser.js';
import { EventStore } from './store.js';

/**
 * Run segmentation.
 *
 * A log file holds a whole evening: several keys, possibly a raid, and idle
 * time in town. CHALLENGE_MODE_START and CHALLENGE_MODE_END bracket each key
 * exactly, so unlike trash-pull detection this part needs no heuristics.
 *
 * Each run gets its own event store, and the parser's target is swapped to it
 * for the duration. Outside a run the target is null, so dungeon-irrelevant
 * events cost a timestamp parse and nothing else — which is what keeps opening
 * a multi-gigabyte log cheap.
 */

/**
 * A boss fight's window inside a key.
 *
 * Timestamps are store-relative, like the event column, so a segment can be
 * compared against event rows without converting.
 */
export interface EncounterWindow {
  encounterId: number;
  name: string;
  difficultyId: number;
  startTs: number;
  /** Null if the key ended mid-fight. */
  endTs: number | null;
  success: boolean | null;
}

export interface RunMeta {
  /** Stable within a session: instance id plus start time. */
  id: string;
  zoneName: string;
  instanceId: number;
  challengeModeId: number;
  keystoneLevel: number;
  affixes: number[];
  /** Wall-clock ms of CHALLENGE_MODE_START. */
  startMs: number;
  /** Wall-clock ms of CHALLENGE_MODE_END, null while in progress. */
  endMs: number | null;
  /** Null while in progress. */
  success: boolean | null;
  /** The game's own clock, which excludes pre-pull time and is authoritative. */
  totalTimeMs: number | null;
  /**
   * Boss windows inside the run, in order. Both ends are needed, not just
   * kills: segmentation uses the window to decide whether a newly engaged
   * enemy is a boss add or trash that was dragged in.
   */
  encounters: EncounterWindow[];
  /**
   * Actor indices of this run's party, in COMBATANT_INFO order.
   *
   * Per-run rather than read off the actor table, because `Actor.inParty` is
   * sticky and the table spans the whole file: over an evening with a tank
   * swap, the file-wide list is everyone who played, and attributing a run to
   * it shows the absent player with zeros in every column.
   */
  party: number[];
}

export interface Run {
  meta: RunMeta;
  store: EventStore;
  /** Shared across runs: actor identity is stable within a log file. */
  actors: ActorTable;
}

export interface SessionHooks {
  onRunStart?(run: Run): void;
  /** Fired periodically while tailing, at most once per `progressInterval` events. */
  onRunProgress?(run: Run): void;
  onRunEnd?(run: Run): void;
  onCombatantInfo?(info: CombatantInfo): void;
  onVersion?(info: LogVersionInfo): void;
  onUnknownEvent?(name: string, line: string): void;
}

export interface SessionOptions extends Omit<ParserOptions, 'hooks'> {
  hooks?: SessionHooks;
  /** Events between onRunProgress callbacks while tailing. */
  progressInterval?: number;
  /**
   * Keep completed runs' stores in memory. The desktop app sets this false and
   * persists a snapshot instead, so a long evening does not accumulate.
   */
  retainCompletedRuns?: boolean;
}

export class LogSession {
  readonly parser: CombatLogParser;
  readonly runs: Run[] = [];
  current: Run | null = null;

  private readonly hooks: SessionHooks;
  private readonly progressInterval: number;
  private readonly retain: boolean;
  private eventsSinceProgress = 0;

  constructor(options: SessionOptions = {}) {
    const { hooks = {}, progressInterval = 2000, retainCompletedRuns = true, ...parserOptions } = options;
    this.hooks = hooks;
    this.progressInterval = progressInterval;
    this.retain = retainCompletedRuns;

    this.parser = new CombatLogParser({
      ...parserOptions,
      hooks: {
        onChallengeStart: (info) => this.startRun(info),
        onChallengeEnd: (info) => this.endRun(info),
        onEncounterStart: (info) => this.openEncounter(info),
        onEncounterEnd: (info) => this.closeEncounter(info),
        onCombatantInfo: (info) => {
          this.recordCombatant(info);
          this.hooks.onCombatantInfo?.(info);
        },
        onVersion: (info) => this.hooks.onVersion?.(info),
        onUnknownEvent: (name, line) => this.hooks.onUnknownEvent?.(name, line),
      },
    });
  }

  push(chunk: Uint8Array): void {
    this.parser.push(chunk);
    this.maybeReportProgress();
  }

  pushText(text: string): void {
    this.parser.pushText(text);
    this.maybeReportProgress();
  }

  /** Flushes a trailing partial line. Not for use while tailing. */
  end(): void {
    this.parser.end();
    this.maybeReportProgress();
  }

  private maybeReportProgress(): void {
    const run = this.current;
    if (run === null || this.hooks.onRunProgress === undefined) return;
    const delta = run.store.count - this.eventsSinceProgress;
    if (delta >= this.progressInterval) {
      this.eventsSinceProgress = run.store.count;
      this.hooks.onRunProgress(run);
    }
  }

  private startRun(info: ChallengeStartInfo): void {
    // A second START without an END means the party reset the key. Abandon the
    // partial run rather than letting two keys share a store.
    if (this.current !== null) this.discardCurrent();

    const store = new EventStore();
    store.baseMs = info.ts;
    const run: Run = {
      meta: {
        id: `${info.instanceId}-${info.ts}`,
        zoneName: info.zoneName,
        instanceId: info.instanceId,
        challengeModeId: info.challengeModeId,
        keystoneLevel: info.keystoneLevel,
        affixes: info.affixes,
        startMs: info.ts,
        endMs: null,
        success: null,
        totalTimeMs: null,
        encounters: [],
        party: [],
      },
      store,
      actors: this.parser.actors,
    };
    this.current = run;
    this.eventsSinceProgress = 0;
    this.parser.target = store;
    this.runs.push(run);
    this.hooks.onRunStart?.(run);
  }

  private endRun(info: ChallengeEndInfo): void {
    const run = this.current;
    if (run === null) return;
    run.meta.endMs = info.ts;
    run.meta.success = info.success;
    run.meta.totalTimeMs = info.totalTimeMs > 0 ? info.totalTimeMs : info.ts - run.meta.startMs;
    if (info.keystoneLevel > 0) run.meta.keystoneLevel = info.keystoneLevel;

    run.store.compact();
    this.current = null;
    this.parser.target = null;
    this.hooks.onRunEnd?.(run);

    if (!this.retain) {
      const index = this.runs.indexOf(run);
      if (index >= 0) this.runs.splice(index, 1);
    }
  }

  private discardCurrent(): void {
    const run = this.current;
    if (run === null) return;
    const index = this.runs.indexOf(run);
    if (index >= 0) this.runs.splice(index, 1);
    this.current = null;
    this.parser.target = null;
  }

  /**
   * COMBATANT_INFO is emitted at the start of each key, so membership recorded
   * while a run is open belongs to that run.
   */
  private recordCombatant(info: CombatantInfo): void {
    const run = this.current;
    if (run === null) return;
    if (!run.meta.party.includes(info.actor.index)) run.meta.party.push(info.actor.index);
  }

  private openEncounter(info: EncounterInfo): void {
    const run = this.current;
    if (run === null) return;
    run.meta.encounters.push({
      encounterId: info.encounterId,
      name: info.name,
      difficultyId: info.difficultyId,
      startTs: info.ts - run.meta.startMs,
      endTs: null,
      success: null,
    });
  }

  private closeEncounter(info: EncounterInfo): void {
    const run = this.current;
    if (run === null) return;
    // Match the most recent open window for this encounter; a wipe and a retry
    // produce two windows for the same boss.
    for (let i = run.meta.encounters.length - 1; i >= 0; i--) {
      const window = run.meta.encounters[i]!;
      if (window.endTs === null && window.encounterId === info.encounterId) {
        window.endTs = info.ts - run.meta.startMs;
        window.success = info.success;
        return;
      }
    }
    // An END with no START (the log began mid-fight): record it as a point.
    run.meta.encounters.push({
      encounterId: info.encounterId,
      name: info.name,
      difficultyId: info.difficultyId,
      startTs: info.ts - run.meta.startMs,
      endTs: info.ts - run.meta.startMs,
      success: info.success,
    });
  }
}

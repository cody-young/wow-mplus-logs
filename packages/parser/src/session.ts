import type { ActorTable } from './actors.js';
import { CombatLogParser, type ChallengeEndInfo, type ChallengeStartInfo, type CombatantInfo, type EncounterInfo, type LogVersionInfo, type MapChangeInfo, type ParserOptions } from './parser.js';
import { EventStore } from './store.js';

/**
 * Run segmentation.
 *
 * A log file holds a whole evening: several keys, possibly a raid, and idle
 * time in town. CHALLENGE_MODE_START and CHALLENGE_MODE_END bracket each key
 * exactly, so unlike trash-pull detection this part needs no heuristics.
 *
 * A raid has no key around it, so there each boss pull is its own run, from
 * ENCOUNTER_START to ENCOUNTER_END. A pull is the unit a raid is reviewed in —
 * a wipe is read on its own, never pooled with the kill that followed — and
 * that keeps every rate's denominator the fight, as Warcraft Logs has it.
 *
 * Each run gets its own event store, and the parser's target is swapped to it
 * for the duration. Outside a run the target is null, so irrelevant events
 * cost a timestamp parse and nothing else — which is what keeps opening a
 * multi-gigabyte log cheap.
 *
 * The one exception is the time between pulls in a raid. ENCOUNTER_START
 * fires when the boss is hit, which is after whoever pulled it pressed the
 * button: a tank's Heroic Throw is cast most of a second before it lands. So
 * in a raid zone the idle events go to a short rolling buffer, and each pull
 * takes the last PRE_PULL_MS of it as its `prePull` store.
 */

/**
 * How much of the time before a raid pull is kept with it.
 *
 * Thirty seconds rather than a few, because the question is often not who hit
 * first but whether they meant to: a Misdirection onto the tank is cast well
 * ahead of the pull and lasts thirty seconds.
 */
export const PRE_PULL_MS = 30_000;

/**
 * Difficulty ids that make an encounter outside a key a raid pull.
 *
 * Dungeon bosses outside a key send ENCOUNTER_START too — normal, heroic and
 * mythic 0 — and are left alone. A list rather than `groupSize > 5`, because
 * a raid can be pulled with five people in it, and a list is what the game
 * defines: Normal/Heroic/Mythic (14-16), LFR (17), Story (220), Timewalking
 * (33, 151), and the legacy 10/25-player, 40-player and old LFR ids.
 */
const RAID_DIFFICULTIES: ReadonlySet<number> = new Set([3, 4, 5, 6, 7, 9, 14, 15, 16, 17, 33, 151, 220]);

export function isRaidDifficulty(difficultyId: number): boolean {
  return RAID_DIFFICULTIES.has(difficultyId);
}

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

/**
 * One uiMap a run was played on, and the world rectangle the game draws it over.
 *
 * Positions in the store carry a uiMapId, and this is what places them on that
 * map's image: `(x - minX) / (maxX - minX)` and the same for y.
 */
export interface MapBounds {
  uiMapId: number;
  name: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** What every run carries, key or raid pull. */
interface RunMetaBase {
  /** Stable within a session: instance id plus start time. */
  id: string;
  zoneName: string;
  instanceId: number;
  /** Wall-clock ms of the opening START. */
  startMs: number;
  /** Wall-clock ms of the closing END, null while in progress. */
  endMs: number | null;
  /** Timed, or killed. Null while in progress. */
  success: boolean | null;
  /**
   * Wall-clock ms from START to END, null while in progress.
   *
   * The denominator for every rate. Warcraft Logs divides by this, and the
   * difference is not small: on a +12 Den of Nalorakk the keystone clock read
   * 23:35 against 21:58 of real time, which put our DPS 7% under theirs for
   * every player at once.
   */
  elapsedMs: number | null;
  /**
   * The log's UTC offset at the START, in minutes; 0 for a legacy log that
   * writes none. `startMs` is the local wall clock, so the instant the run
   * began is `startMs - utcOffsetMinutes * 60_000` — which is what anything
   * outside the log, Warcraft Logs included, times it by.
   */
  utcOffsetMinutes: number;
  /**
   * Boss windows inside the run, in order; a raid pull has exactly one,
   * starting at 0. Both ends are needed, not just kills: segmentation uses the
   * window to decide whether a newly engaged enemy is a boss add or trash that
   * was dragged in.
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
  /**
   * Every uiMap the logging player entered during the run, in the order first
   * entered, with its bounds from MAP_CHANGE.
   *
   * Seeded with the map the player was standing on at the START,
   * because the game logs that MAP_CHANGE on zoning in, minutes before the key
   * is started — and it is the map the first pulls happen on.
   *
   * Only the logging player's maps. A party member who walks onto a floor the
   * logger never visits leaves positions with a uiMapId that has no entry
   * here, so a consumer must tolerate a missing one.
   */
  maps: MapBounds[];
}

export interface KeyRunMeta extends RunMetaBase {
  kind: 'key';
  challengeModeId: number;
  keystoneLevel: number;
  affixes: number[];
  /**
   * The game's own clock: what the keystone timer showed at the end.
   *
   * Authoritative for whether the key was timed, and wrong as the denominator
   * of a rate. It counts the +15s charged for each death, so a key with seven
   * deaths reports 97s that no damage could have been dealt in. Use
   * `elapsedMs` for anything per-second — see there.
   */
  totalTimeMs: number | null;
}

/** One boss pull in a raid: a wipe or the kill. */
export interface RaidPullMeta extends RunMetaBase {
  kind: 'raid';
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  groupSize: number;
  /**
   * Which attempt on this boss at this difficulty, from 1, counted across the
   * session. Counts every pull the log shows, so a log started mid-night
   * numbers from wherever it began.
   */
  pull: number;
  /**
   * The server's fight length from ENCOUNTER_END, null while in progress or
   * when the line omits it. Unlike `elapsedMs` it is the same in every
   * player's log, which is what anything shared across a raid keys on.
   */
  fightTimeMs: number | null;
}

export type RunMeta = KeyRunMeta | RaidPullMeta;

export interface Run {
  meta: RunMeta;
  store: EventStore;
  /**
   * A raid pull's last PRE_PULL_MS before its ENCOUNTER_START, on the same
   * clock as `store`, so every row is at a negative ts. Null for a key, and for
   * a pull the log never saw the run-up to — it began in the raid without a
   * ZONE_CHANGE. Empty when the run-up was seen and nothing happened in it.
   *
   * Separate from `store` so that nothing before the pull can leak into a
   * rate, a death recap or a damage total.
   */
  prePull: EventStore | null;
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
  /**
   * Open a run for each raid boss pull. On by default; off, a raid costs what
   * it did before raids were read at all — a timestamp parse per line.
   */
  raids?: boolean;
}

export class LogSession {
  readonly parser: CombatLogParser;
  readonly runs: Run[] = [];
  current: Run | null = null;

  private readonly hooks: SessionHooks;
  private readonly progressInterval: number;
  private readonly retain: boolean;
  private readonly raids: boolean;
  private eventsSinceProgress = 0;
  /** The latest MAP_CHANGE, run or no run, to seed the next run's maps. */
  private lastMap: MapBounds | null = null;
  /** The latest ZONE_CHANGE, to name a raid pull: ENCOUNTER_START carries no zone name. */
  private lastZone: { instanceId: number; name: string; difficultyId: number } | null = null;
  /**
   * The rolling pre-pull buffer: idle events in a raid zone, written to `lobby`
   * until it spans PRE_PULL_MS, then the two swap. Together they always hold at
   * least the last PRE_PULL_MS. Null outside a raid zone.
   */
  private lobby: EventStore | null = null;
  private lobbyPrevious: EventStore | null = null;
  /** Pulls seen so far per boss and difficulty, to number the next. */
  private readonly pulls = new Map<string, number>();

  constructor(options: SessionOptions = {}) {
    const { hooks = {}, progressInterval = 2000, retainCompletedRuns = true, raids = true, ...parserOptions } = options;
    this.hooks = hooks;
    this.progressInterval = progressInterval;
    this.retain = retainCompletedRuns;
    this.raids = raids;

    this.parser = new CombatLogParser({
      ...parserOptions,
      hooks: {
        onChallengeStart: (info) => this.startRun(info),
        onChallengeEnd: (info) => this.endRun(info),
        onEncounterStart: (info) => this.openEncounter(info),
        onEncounterEnd: (info) => this.closeEncounter(info),
        onMapChange: (info) => this.enterMap(info),
        onZoneChange: (ts, instanceId, name, difficultyId) => this.enterZone(ts, instanceId, name, difficultyId),
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
    this.afterChunk();
  }

  pushText(text: string): void {
    this.parser.pushText(text);
    this.afterChunk();
  }

  /** Flushes a trailing partial line. Not for use while tailing. */
  end(): void {
    this.parser.end();
    this.afterChunk();
  }

  private afterChunk(): void {
    this.rotateLobby();
    this.maybeReportProgress();
  }

  /**
   * Swaps the pre-pull buffers once the one being written spans PRE_PULL_MS.
   *
   * Checked per chunk rather than per event, which lets the buffer run a chunk
   * past its span — a few hundred lines — and saves a branch on every line of
   * every log. The pull trims to the span anyway.
   */
  private rotateLobby(): void {
    const lobby = this.lobby;
    if (lobby === null || lobby.count === 0 || this.parser.target !== lobby) return;
    const last = lobby.ts[lobby.count - 1]!;
    if (last - lobby.ts[0]! < PRE_PULL_MS) return;
    const next = this.lobbyPrevious ?? new EventStore(1 << 12);
    next.reset(lobby.baseMs + last);
    this.lobbyPrevious = lobby;
    this.lobby = next;
    this.parser.target = next;
  }

  /**
   * Copies the buffered events from the PRE_PULL_MS before `startMs` into a
   * store of their own on the pull's clock, and empties the buffer.
   */
  private takePrePull(startMs: number): EventStore | null {
    if (this.lobby === null) return null;
    const out = new EventStore(1 << 12);
    out.baseMs = startMs;
    for (const source of [this.lobbyPrevious, this.lobby]) {
      if (source === null) continue;
      const from = source.seek(startMs - PRE_PULL_MS - source.baseMs);
      for (let row = from; row < source.count; row++) out.copyRow(source, row);
    }
    this.lobbyPrevious?.reset(startMs);
    this.lobby.reset(startMs);
    // Empty is an answer — nothing happened — where null would say the log
    // never saw this stretch.
    out.compact();
    return out;
  }

  /** Where idle events go: the pre-pull buffer in a raid zone, else nowhere. */
  private idleTarget(): EventStore | null {
    return this.lobby;
  }

  private enterZone(ts: number, instanceId: number, name: string, difficultyId: number): void {
    this.lastZone = { instanceId, name, difficultyId };
    const raid = this.raids && isRaidDifficulty(difficultyId);
    if (raid && this.lobby === null) {
      this.lobby = new EventStore(1 << 12);
      this.lobby.baseMs = ts;
    } else if (!raid) {
      this.lobby = null;
      this.lobbyPrevious = null;
    }
    if (this.current === null) this.parser.target = this.idleTarget();
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
    // The game re-announces an in-progress key when the party re-enters the
    // instance — step out to change talents and a second CHALLENGE_MODE_START
    // arrives mid-run, naming the same instance, dungeon and keystone level.
    // Reading that as a fresh key throws away everything killed before it: a
    // Ruby Life Pools +11 re-announced four minutes in came out 377 of 551.
    //
    // A reset is a different shape. The game marks every real beginning with a
    // zeroed CHALLENGE_MODE_END — instance id, then 0,0,0 — a quarter-second
    // before the START, including the beginning that follows an abandoned key.
    // So an END is what separates one key from the next, and a START with no
    // END behind it is the same key being announced twice. The log says so
    // outright: the END of that Ruby Life Pools run reports a 19:49 timer
    // against 19:53 of wall clock from the FIRST of its two starts.
    if (this.current !== null) {
      if (this.isReannouncement(info)) return;
      this.discardCurrent();
    }

    this.open({
      kind: 'key',
      id: `${info.instanceId}-${info.ts}`,
      zoneName: info.zoneName,
      instanceId: info.instanceId,
      challengeModeId: info.challengeModeId,
      keystoneLevel: info.keystoneLevel,
      affixes: info.affixes,
      startMs: info.ts,
      utcOffsetMinutes: this.parser.tzOffsetMinutes,
      endMs: null,
      success: null,
      totalTimeMs: null,
      elapsedMs: null,
      encounters: [],
      party: [],
      maps: this.seedMaps(),
    });
  }

  /**
   * A raid boss engaged with no key open: the start of a pull.
   *
   * A pull still open when another begins lost its END — a disconnect, or the
   * game closing the log mid-fight. It is dropped, as a key without its END
   * is, rather than closed at a time the log never gave.
   */
  private startPull(info: EncounterInfo): void {
    if (this.current !== null) this.discardCurrent();

    const key = `${info.encounterId}/${info.difficultyId}`;
    const pull = (this.pulls.get(key) ?? 0) + 1;
    this.pulls.set(key, pull);
    // A zone change for another instance is stale: name nothing rather than
    // the wrong place.
    const zone = this.lastZone !== null && this.lastZone.instanceId === info.instanceId ? this.lastZone.name : '';

    const prePull = this.takePrePull(info.ts);
    this.open({
      kind: 'raid',
      id: `${info.instanceId}-${info.encounterId}-${info.ts}`,
      zoneName: zone,
      instanceId: info.instanceId,
      encounterId: info.encounterId,
      encounterName: info.name,
      difficultyId: info.difficultyId,
      groupSize: info.groupSize,
      pull,
      fightTimeMs: null,
      startMs: info.ts,
      utcOffsetMinutes: this.parser.tzOffsetMinutes,
      endMs: null,
      success: null,
      elapsedMs: null,
      encounters: [
        { encounterId: info.encounterId, name: info.name, difficultyId: info.difficultyId, startTs: 0, endTs: null, success: null },
      ],
      party: [],
      maps: this.seedMaps(),
    }, prePull);
  }

  private seedMaps(): MapBounds[] {
    return this.lastMap === null ? [] : [{ ...this.lastMap }];
  }

  private open(meta: RunMeta, prePull: EventStore | null = null): void {
    const store = new EventStore();
    store.baseMs = meta.startMs;
    const run: Run = {
      meta,
      store,
      prePull,
      actors: this.parser.actors,
    };
    this.current = run;
    this.eventsSinceProgress = 0;
    this.parser.target = store;
    this.runs.push(run);
    this.hooks.onRunStart?.(run);
  }

  /**
   * Whether this START is the open run being announced again rather than a new
   * key — see `startRun`.
   *
   * Every field is compared, not just the instance id: an identical
   * announcement is the same key, and anything that differs is a key this
   * cannot vouch for, which keeps the fallback the old conservative one.
   */
  private isReannouncement(info: ChallengeStartInfo): boolean {
    const open = this.current?.meta;
    return (
      open?.kind === 'key' &&
      open.instanceId === info.instanceId &&
      open.challengeModeId === info.challengeModeId &&
      open.keystoneLevel === info.keystoneLevel &&
      open.zoneName === info.zoneName
    );
  }

  private endRun(info: ChallengeEndInfo): void {
    const run = this.current;
    if (run === null || run.meta.kind !== 'key') return;
    const elapsed = info.ts - run.meta.startMs;
    run.meta.totalTimeMs = info.totalTimeMs > 0 ? info.totalTimeMs : elapsed;
    if (info.keystoneLevel > 0) run.meta.keystoneLevel = info.keystoneLevel;
    this.finish(run, info.ts, info.success);
  }

  private finish(run: Run, ts: number, success: boolean): void {
    run.meta.endMs = ts;
    run.meta.success = success;
    run.meta.elapsedMs = ts - run.meta.startMs;

    run.store.compact();
    this.current = null;
    this.parser.target = this.idleTarget();
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
    this.parser.target = this.idleTarget();
  }

  /**
   * COMBATANT_INFO is emitted at the start of each key, and right after each
   * raid ENCOUNTER_START, so membership recorded while a run is open belongs
   * to that run.
   */
  private recordCombatant(info: CombatantInfo): void {
    const run = this.current;
    if (run === null) return;
    if (!run.meta.party.includes(info.actor.index)) run.meta.party.push(info.actor.index);
  }

  private enterMap(info: MapChangeInfo): void {
    const { ts: _ts, ...bounds } = info;
    this.lastMap = bounds;
    const run = this.current;
    if (run === null) return;
    // Keyed by id: the party crosses back and forth between floors all key.
    if (!run.meta.maps.some((map) => map.uiMapId === bounds.uiMapId)) run.meta.maps.push({ ...bounds });
  }

  private openEncounter(info: EncounterInfo): void {
    if (this.raids && isRaidDifficulty(info.difficultyId) && this.current?.meta.kind !== 'key') {
      this.startPull(info);
      return;
    }
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
    if (run.meta.kind === 'raid') {
      // An END for another boss is not this pull's, and closes nothing.
      if (info.encounterId !== run.meta.encounterId) return;
      const window = run.meta.encounters[0]!;
      window.endTs = info.ts - run.meta.startMs;
      window.success = info.success;
      run.meta.fightTimeMs = info.fightTimeMs > 0 ? info.fightTimeMs : null;
      this.finish(run, info.ts, info.success);
      return;
    }
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

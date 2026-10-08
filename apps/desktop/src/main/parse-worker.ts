/**
 * Parsing worker.
 *
 * Runs off the main thread because a long key is a couple of hundred megabytes
 * and even at 157 MB/s that is long enough to drop frames. Only finished
 * reports cross back; the event store stays here.
 *
 * Live tailing needs no special backscan. The engine reads at well over 100
 * MB/s, so the cheapest way to attach to a key already in progress is to parse
 * the whole file from the start — a 188 MB log takes about a second — and then
 * follow appends from the end. The in-progress run falls out of that naturally,
 * CHALLENGE_MODE_START included.
 */
import { createReadStream, statSync, watch, type FSWatcher } from 'node:fs';
import { parentPort } from 'node:worker_threads';

import {
  avoidableReport,
  buildSegments,
  contextFor,
  crowdControlReport,
  damageReport,
  deathReports,
  dispelReport,
  healingReport,
  interruptReport,
  placeOnMdt,
  positionTracks,
  statsReport,
  whoPulled,
  type SegmentIndex,
} from '@mplus/analysis';
import { EMPTY_TABLE, forcesFor, type ForcesTable, type MdtDungeon } from '@mplus/data';
import { LogSession, type Run, type RunMeta } from '@mplus/parser';

import type { RunAnalysis, SegmentReports, WorkerEvent, WorkerRequest } from '../shared.js';

const port = parentPort;
if (port === null) throw new Error('parse-worker must be run as a worker thread');

const post = (event: WorkerEvent): void => port.postMessage(event);

/** Minimum gap between recomputes while a key is in progress. */
const LIVE_THROTTLE_MS = 1500;
/** Minimum gap between progress reports while reading, so the bar moves without flooding the port. */
const PROGRESS_THROTTLE_MS = 100;

let session: LogSession | null = null;
let watcher: FSWatcher | null = null;
let offset = 0;
let reading = false;
let lastLiveAt = 0;
let lastProgressAt = 0;
let startedAt = 0;
let totalBytes = 0;
/** Enemy forces for the client that wrote this log; empty when MDT was absent. */
let forcesTable: ForcesTable = EMPTY_TABLE;
/** MDT's map of each dungeon, by challenge-mode id; empty when MDT was absent. */
let mdtDungeons = new Map<number, MdtDungeon>();

function analyze(active: LogSession, run: Run, live: boolean): RunAnalysis {
  const context = contextFor(active, run);
  const key = run.meta.kind === 'key' ? run.meta : null;
  // The challenge-mode id is the join key, not the instance id: it is the only
  // number that appears in both CHALLENGE_MODE_START and MDT's tables.
  const segments: SegmentIndex = buildSegments(context, {
    forces: key === null ? null : forcesFor(forcesTable, key.challengeModeId),
  });

  const bySegment: Record<number, SegmentReports> = {};
  for (const segment of segments.segments) {
    bySegment[segment.id] = {
      damage: damageReport(context, segments, { segmentId: segment.id }),
      taken: damageReport(context, segments, { segmentId: segment.id, direction: 'taken' }),
      healing: healingReport(context, segments, { segmentId: segment.id }),
    };
  }

  // Names for everything the reports reference only by index: the party, and
  // the enemies making up each pull.
  const names: Record<number, string> = {};
  const note = (index: number): void => {
    const actor = run.actors.at(index);
    if (actor !== undefined) names[index] = active.parser.interner.resolve(actor.nameId);
  };
  for (const index of run.meta.party) note(index);
  for (const segment of segments.segments) for (const enemy of segment.enemies) note(enemy);
  const pull = whoPulled(context);
  if (pull !== null) {
    for (const contact of pull.contacts) [contact.actor, contact.via, contact.enemy].forEach(note);
    for (const near of pull.nearest) [near.actor, near.enemy].forEach(note);
    for (const summon of pull.summons) [summon.actor, summon.unit].forEach(note);
    if (pull.redirect !== null) note(pull.redirect.onto);
  }

  // The dungeon-only reports: a raid has no avoidable list and no MDT map, and
  // twenty players' tracks are the heaviest report there is, for a map tab a
  // raid does not get.
  const positions = key === null ? { maps: [], tracks: [] } : positionTracks(context, segments);
  const mdtDungeon = key === null ? undefined : mdtDungeons.get(key.challengeModeId);

  return {
    runId: run.meta.id,
    meta: structuredCloneable(run.meta),
    names,
    segments: segments.segments.map((segment) => ({ ...segment })),
    damage: damageReport(context, segments),
    taken: damageReport(context, segments, { direction: 'taken' }),
    healing: healingReport(context, segments),
    deaths: deathReports(context, segments),
    interrupts: interruptReport(context, segments),
    control: crowdControlReport(context, segments),
    dispels: dispelReport(context, segments),
    avoidable: key === null ? { hits: [], covered: false } : avoidableReport(context, segments),
    stats: statsReport(context, segments),
    positions,
    mdt: mdtDungeon === undefined ? null : placeOnMdt(positions, mdtDungeon),
    pull,
    bySegment,
    // Every field is a scalar now, so a shallow copy is a full one.
    forces: { ...segments.forces },
    live,
  };
}

/** RunMeta holds only plain values, but copy it so the worker's copy is not shared. */
function structuredCloneable(meta: RunMeta): RunMeta {
  const shared = {
    party: [...meta.party],
    encounters: meta.encounters.map((encounter) => ({ ...encounter })),
    maps: meta.maps.map((map) => ({ ...map })),
  };
  return meta.kind === 'key' ? { ...meta, ...shared, affixes: [...meta.affixes] } : { ...meta, ...shared };
}

function emitProgress(linesSeen: number): void {
  lastProgressAt = Date.now();
  post({
    type: 'progress',
    progress: { bytesRead: offset, totalBytes, linesSeen, elapsedMs: Date.now() - startedAt },
  });
}

function makeSession(): LogSession {
  runsEnded = 0;
  const active = new LogSession({
    progressInterval: 4000,
    // Each run is analysed as it ends and its store let go. A raid night is
    // a few hundred megabytes of stores, none of which is looked at again.
    retainCompletedRuns: false,
    hooks: {
      onVersion: (info) => {
        // The game writes COMBAT_LOG_VERSION on every reload, so a single log
        // carries many. Only report a change, or the renderer gets six
        // identical messages for one file.
        const fingerprint = `${info.buildVersion}/${String(info.advancedLogging)}`;
        if (fingerprint === lastVersionSeen) return;
        lastVersionSeen = fingerprint;
        post({
          type: 'log',
          summary: {
            path: currentPath,
            sizeBytes: totalBytes,
            advancedLogging: info.advancedLogging,
            buildVersion: info.buildVersion,
          },
        });
      },
      onRunEnd: (run) => {
        runsEnded++;
        post({ type: 'analysis', analysis: analyze(active, run, false) });
      },
      onRunProgress: (run) => {
        const now = Date.now();
        if (now - lastLiveAt < LIVE_THROTTLE_MS) return;
        lastLiveAt = now;
        post({ type: 'analysis', analysis: analyze(active, run, true) });
      },
    },
  });
  return active;
}

/** Runs finished in the current file: the session itself keeps none of them. */
let runsEnded = 0;
let currentPath = '';
let lastVersionSeen = '';

/** Reads from `offset` to end of file, feeding the session. */
async function drain(active: LogSession): Promise<void> {
  if (reading) return;
  reading = true;
  try {
    const size = statSync(currentPath).size;
    if (size < offset) {
      // The file shrank: the game rotated to a new log. Start over.
      offset = 0;
      session = makeSession();
      return drainWith(session, size);
    }
    totalBytes = size;
    if (size === offset) return;
    await drainWith(active, size);
  } finally {
    reading = false;
  }
}

async function drainWith(active: LogSession, size: number): Promise<void> {
  const stream = createReadStream(currentPath, { start: offset, highWaterMark: 1 << 20 });
  for await (const chunk of stream) {
    const bytes = chunk as Buffer;
    active.push(bytes);
    offset += bytes.length;
    if (Date.now() - lastProgressAt >= PROGRESS_THROTTLE_MS) emitProgress(active.parser.linesSeen);
  }
  totalBytes = Math.max(size, offset);
  emitProgress(active.parser.linesSeen);
}

port.on('message', (message: WorkerRequest) => {
  void (async () => {
    try {
      if (message.type === 'stop') {
        watcher?.close();
        watcher = null;
        return;
      }

      watcher?.close();
      watcher = null;
      currentPath = message.path;
      forcesTable = message.forces;
      mdtDungeons = new Map(message.mdt.map((dungeon) => [dungeon.challengeModeId, dungeon]));
      lastVersionSeen = '';
      offset = 0;
      startedAt = Date.now();
      totalBytes = statSync(currentPath).size;
      session = makeSession();
      // Report zero straight away, so the bar appears before the first chunk.
      emitProgress(0);

      await drain(session);
      // A run still open at end of file is a key in progress; report it now
      // rather than making the user wait for CHALLENGE_MODE_END.
      if (session.current !== null) {
        post({ type: 'analysis', analysis: analyze(session, session.current, true) });
      }
      post({ type: 'done', runCount: runsEnded + (session.current === null ? 0 : 1) });

      if (message.tail) {
        // fs.watch coalesces rapid appends, which is what we want: the game
        // writes constantly and each drain reads everything available.
        watcher = watch(currentPath, { persistent: true }, () => {
          const active = session;
          if (active === null) return;
          void drain(active).catch((error: unknown) => {
            post({ type: 'failed', message: String(error) });
          });
        });
      }
    } catch (error) {
      post({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  })();
});

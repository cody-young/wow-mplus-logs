import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SegmentKind, TrackKind, mdtExportString, mdtRoute, positionAt, routeUid, toMdt } from '@mplus/analysis';
import { MDT_CANVAS, MDT_TILES } from '@mplus/data';

import { clock, integer, percent } from '../format.js';
import { usePortraits } from '../icons.js';
import { shortName, specOf } from '../specs.js';
import { partyOf } from './RunRow.js';
import type { MdtFloorFit, MdtPlacement, PositionTrack, RunAnalysis, Segment } from '../../shared.js';

/**
 * The key on a map: where each pull was, the way the party walked, and a
 * replay of both.
 *
 * With Mythic Dungeon Tools installed, each floor whose fit to MDT's map is
 * good is drawn on MDT's art, in MDT's coordinates, with MDT's spawns marked.
 * Without it, or on a floor that fitted badly, the map is the log's own
 * coordinates on a blank page. That is less bare than it sounds: four samples
 * a second of five players walking the whole dungeon trace its corridors well
 * enough to read, and every pull sits where it was fought. Each floor is its
 * own uiMap with its own coordinates, so each is drawn on its own.
 *
 * Pulls are drawn where their enemies stood before they were touched (each
 * track's `home`), not where they died: a dragged pack dies on top of the next
 * one, and a map of death spots would draw two pulls as one.
 *
 * As in MDT, each pull is one outline in a colour of its own around every mob
 * it killed, and each mob is its portrait. On MDT's map a kill placed on a
 * spawn is drawn on that spawn, so the outline sits on the art where MDT would
 * draw it, and the spawns nothing was killed on are drawn grey.
 */

interface Props {
  run: RunAnalysis;
  selectedSegment: number | null;
  onSelectSegment(id: number | null): void;
}

/**
 * A rectangle on a floor's plane: u across to the right, v down. In yards for
 * a floor drawn from the log, in MDT canvas units for one drawn on MDT's map.
 */
interface Box {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

interface Floor {
  uiMapId: number;
  name: string;
  /** When the party first set foot on it, for ordering the tabs. */
  firstTs: number;
  /** The floor's fit to MDT's map, when it is drawn on it. */
  fit: MdtFloorFit | null;
  /** World position to the plane. */
  plane(x: number, y: number): Point;
  /** The extent of everything drawn on it, padded. */
  view: Box;
}

interface PullShape {
  segment: Segment;
  uiMapId: number;
  /** The enemies to draw, each with a `home` on `uiMapId`. */
  mobs: PositionTrack[];
}

/** What MDT says a creature looks like, by creature id. */
interface Model {
  displayId: number | null;
  boss: boolean;
}

/** A mob on the map, in canvas px. */
interface MobIcon {
  x: number;
  y: number;
  displayId: number | null;
  boss: boolean;
  /** The pull that killed it, or null for a spawn left standing. */
  segmentId: number | null;
}

/** One pull's outline on a floor, in canvas px. */
interface Hull {
  pull: PullShape;
  outline: Point[];
  centre: Point;
}

/** Party colours by actor index, from spec. */
type Palette = Map<number, string>;

const SPEEDS = [1, 4, 8, 16, 32] as const;
const DEFAULT_SPEED = 8;
/** How much of each player's path trails behind their dot, in ms of key time. */
const TRAIL_MS = 15_000;
/** An enemy not seen dead is dropped this long after its last sample: it reset, or walked off. */
const ENEMY_LINGER_MS = 5_000;
/** Room around the drawn extent, as a fraction of its larger side. */
const PAD = 0.05;
/** How far a pull's outline stands off its mobs' icons, in px. */
const HULL_PAD = 4;
/**
 * A mob icon's radius, in plane units: MDT canvas units on its map, yards off
 * it. Bosses are drawn larger, as MDT draws them.
 */
const MOB_RADIUS = { mdt: 4.5, yards: 2.5, boss: 1.6 } as const;
/** The least and most a mob icon's radius is on screen, in px, however far the map is zoomed. */
const MOB_PX = { min: 5, max: 15 } as const;
/** Portraits are cropped and scaled once to this many px square. */
const PORTRAIT_PX = 64;
/** Behind a portrait's clear background, dark on either theme as MDT's are. */
const PORTRAIT_BG = '#1d2027';
const MAX_HEIGHT_VH = 0.7;
/** The least of MDT's canvas a floor shows, in its units, so a small floor keeps its surroundings. */
const MDT_MIN_SPAN = 140;
/** MDT art pixels per canvas unit. */
const ART_SCALE = MDT_TILES.pixels / MDT_TILES.units;
/** The furthest the map zooms in, as a multiple of the whole floor. */
const MAX_ZOOM = 8;
/** How much one notch of the wheel, or one press of a zoom button, zooms. */
const ZOOM_STEP = 1.25;
/** How far the pointer moves, in px, before a press on the map is a drag rather than a click. */
const DRAG_PX = 4;

export function MapPanel({ run, selectedSegment, onSelectSegment }: Props): React.JSX.Element {
  const { positions } = run;
  const party = useMemo(() => partyOf(run), [run]);
  const palette = useMemo<Palette>(
    () => new Map(party.map((member) => [member.actorIndex, specOf(member.specId).color])),
    [party],
  );
  const partyTracks = useMemo(
    () => positions.tracks.filter((track) => track.kind === TrackKind.PARTY),
    [positions],
  );
  const enemyTracks = useMemo(
    () => positions.tracks.filter((track) => track.kind === TrackKind.ENEMY),
    [positions],
  );
  const [useMdt, setUseMdt] = useState(true);
  const mdtFits = useMemo(() => goodFits(run.mdt), [run.mdt]);
  const fits = useMdt ? mdtFits : EMPTY_FITS;
  const floors = useMemo(
    () => floorsOf(run, partyTracks, enemyTracks, fits),
    [run, partyTracks, enemyTracks, fits],
  );
  const art = useMdtArt(useMdt ? run.mdt : null);
  const pulls = useMemo(() => pullShapes(run.segments, enemyTracks), [run.segments, enemyTracks]);
  const colours = useMemo(() => pullColours(pulls), [pulls]);
  // Off MDT's map too: a floor that did not fit still has MDT's creatures on it.
  const models = useMemo(() => modelsOf(run.mdt), [run.mdt]);
  const displayIds = useMemo(
    () => [...models.values()].flatMap((model) => (model.displayId === null ? [] : [model.displayId])),
    [models],
  );
  const portraits = usePortraitArt(usePortraits(displayIds));

  const durationMs = useMemo(() => {
    let end = Math.max(run.damage.durationMs, ...run.segments.map((segment) => segment.endTs));
    for (const track of partyTracks) if (track.ts.length > 0) end = Math.max(end, track.ts[track.ts.length - 1]!);
    return Math.max(end, 1);
  }, [run, partyTracks]);

  // The playhead starts at the end, so the map opens on the whole key.
  const [t, setT] = useState(durationMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  /** A floor the reader picked, or null to show whichever floor the party is on. */
  const [pinnedFloor, setPinnedFloor] = useState<number | null>(null);

  // A live key grows under the playhead. One parked at the end stays there, so
  // the map keeps up with the key; one scrubbed back stays where it was put.
  const lastDuration = useRef(durationMs);
  useEffect(() => {
    setT((current) => (current >= lastDuration.current ? durationMs : Math.min(current, durationMs)));
    lastDuration.current = durationMs;
  }, [durationMs]);

  // Picking a pull, here or on the timeline, jumps to its start.
  useEffect(() => {
    if (selectedSegment === null) return;
    const segment = run.segments.find((candidate) => candidate.id === selectedSegment);
    if (segment === undefined) return;
    setT(segment.startTs);
    setPlaying(false);
    setPinnedFloor(null);
    // Only on a change of selection: a live update re-sends the same segment.
  }, [selectedSegment, run.runId]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = now - last;
      last = now;
      setT((current) => {
        const next = current + dt * speed;
        if (next >= durationMs) {
          setPlaying(false);
          return durationMs;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, durationMs]);

  const followed = useMemo(() => partyFloorAt(partyTracks, t), [partyTracks, t]);
  const floorId = pinnedFloor ?? followed ?? floors[0]?.uiMapId ?? null;
  const floor = floors.find((candidate) => candidate.uiMapId === floorId) ?? floors[0] ?? null;

  if (floor === null) {
    return (
      <div className="empty">
        <h2>No positions in this key</h2>
        <p>
          Positions come from advanced combat logging, which was off or had not reached a unit yet.
        </p>
      </div>
    );
  }

  const deaths = run.deaths.length;
  const floorFit = run.mdt?.floors.find((candidate) => candidate.uiMapId === floor.uiMapId) ?? null;
  return (
    <div className="map-panel">
      <div className="map-bar">
        {floors.length > 1 ? (
          <div className="map-floors" role="tablist" aria-label="Floor">
            {floors.map((candidate) => (
              <button
                key={candidate.uiMapId}
                type="button"
                role="tab"
                aria-selected={candidate.uiMapId === floor.uiMapId}
                className={`map-floor${candidate.uiMapId === floor.uiMapId ? ' active' : ''}${
                  pinnedFloor === null && candidate.uiMapId === followed ? ' party' : ''
                }`}
                title={
                  pinnedFloor === null
                    ? 'Following the party from floor to floor; pick one to stay on it'
                    : undefined
                }
                onClick={() => setPinnedFloor(candidate.uiMapId)}
              >
                {candidate.name}
              </button>
            ))}
            {pinnedFloor !== null ? (
              <button type="button" className="map-follow" onClick={() => setPinnedFloor(null)}>
                Follow party
              </button>
            ) : null}
          </div>
        ) : (
          <div className="map-floor-name">{floor.name}</div>
        )}
        <div className="map-legend">
          {party.map((member) => (
            <span key={member.actorIndex} className="map-legend-item">
              <span className="map-dot" style={{ background: palette.get(member.actorIndex) }} />
              {shortName(member.name)}
            </span>
          ))}
          {deaths > 0 ? <span className="map-legend-item dim">✕ death</span> : null}
          {mdtFits.size > 0 ? (
            <label className="map-mdt-toggle" title="Draw floors on Mythic Dungeon Tools' map where the run fits it">
              <input type="checkbox" checked={useMdt} onChange={(event) => setUseMdt(event.target.checked)} />
              MDT map
            </label>
          ) : null}
          <MdtExportButton run={run} />
        </div>
      </div>
      {useMdt && run.mdt !== null && floor.fit === null ? (
        <div className="map-note">{noFitNote(floorFit)}</div>
      ) : null}

      <MapCanvas
        floor={floor}
        art={floor.fit === null ? null : (art.get(floor.fit.sublevel) ?? null)}
        mdt={floor.fit === null ? null : run.mdt}
        t={t}
        pulls={pulls}
        colours={colours}
        models={models}
        portraits={portraits}
        partyTracks={partyTracks}
        enemyTracks={enemyTracks}
        palette={palette}
        forcesRequired={run.forces.known ? run.forces.required : 0}
        selectedSegment={selectedSegment}
        onSelectSegment={onSelectSegment}
      />

      <div className="map-replay">
        <button
          type="button"
          className="map-play"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            if (playing) {
              setPlaying(false);
              return;
            }
            // Play from the end means play from the start.
            if (t >= durationMs) setT(selectedSegmentStart(run.segments, selectedSegment));
            setPinnedFloor(null);
            setPlaying(true);
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={250}
          value={Math.min(t, durationMs)}
          aria-label="Replay time"
          onChange={(event) => setT(Number(event.target.value))}
        />
        <span className="map-clock">
          {clock(t)} / {clock(durationMs)}
        </span>
        <select
          value={speed}
          aria-label="Replay speed"
          onChange={(event) => setSpeed(Number(event.target.value))}
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Copies the run's pulls as an MDT route string, for MDT's Import. Hidden
 * when no kill landed on MDT's map, since there would be nothing to import.
 */
function MdtExportButton({ run }: { run: RunAnalysis }): React.JSX.Element | null {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const route = useMemo(() => {
    const { meta } = run;
    if (run.mdt === null || meta.kind !== 'key') return null;
    const date = new Date(meta.startMs).toISOString().slice(0, 10);
    return mdtRoute(
      run.mdt,
      run.segments,
      `+${meta.keystoneLevel} ${meta.zoneName} ${date}`,
      meta.keystoneLevel,
      routeUid(run.runId),
    );
  }, [run]);
  if (route === null) return null;

  const fought = run.segments.filter((segment) => segment.enemies.length > 0).length;
  const placed = route.value.pulls.length;
  const copy = (): void => {
    window.clearTimeout(timer.current);
    mdtExportString(route)
      .then((text) => window.mplus.copyText(text))
      .then(() => setState('done'))
      .catch(() => setState('failed'))
      .finally(() => {
        timer.current = window.setTimeout(() => setState('idle'), 1600);
      });
  };
  return (
    <button
      type="button"
      className={`map-export${state === 'done' ? ' done' : ''}`}
      title={`Copy this run's route for Mythic Dungeon Tools' Import: ${placed} of ${fought} pulls, with the kills placed on MDT's map. Kills the map could not place are left out.`}
      onClick={copy}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Export failed' : 'Export to MDT'}
    </button>
  );
}

function selectedSegmentStart(segments: Segment[], selected: number | null): number {
  if (selected === null) return 0;
  return segments.find((segment) => segment.id === selected)?.startTs ?? 0;
}

/**
 * Why a floor is drawn from the log although MDT knows the dungeon. A fit that
 * failed is said plainly, with its numbers, because a map that silently
 * switched style would read as a bug.
 */
function noFitNote(fit: MdtFloorFit | null): string {
  if (fit === null) return 'Too few kills on this floor to place it on the MDT map; drawn from the log instead.';
  // Enough matched, so what failed was the rival test in `placeOnMdt`.
  if (fit.matched >= Math.max(6, fit.observed * 0.3)) {
    return (
      `This floor fits the MDT map two different ways about equally well (${integer(fit.matched)} kills ` +
      `against ${integer(fit.rival)}), so it is drawn from the log instead.`
    );
  }
  return (
    `This floor did not fit the MDT map well (${integer(fit.matched)} of ${integer(fit.observed)} kills ` +
    'landed on a spawn), so it is drawn from the log instead.'
  );
}

const EMPTY_FITS: ReadonlyMap<number, MdtFloorFit> = new Map();

function goodFits(mdt: MdtPlacement | null): ReadonlyMap<number, MdtFloorFit> {
  if (mdt === null) return EMPTY_FITS;
  const art = new Set(mdt.dungeon.sublevels.filter((level) => level.textureDir !== null).map((level) => level.index));
  return new Map(
    mdt.floors.filter((fit) => fit.good && art.has(fit.sublevel)).map((fit) => [fit.uiMapId, fit]),
  );
}

/** Composed floor art by MDT tile folder and sublevel, shared by every run of the dungeon. */
const artCache = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * MDT's art for each sublevel the run is drawn on, as one canvas per
 * sublevel, once its tiles have loaded. Empty until then, and for good when
 * the tiles cannot be read: the floor is still drawn in MDT's coordinates,
 * just without the picture.
 */
function useMdtArt(mdt: MdtPlacement | null): ReadonlyMap<number, HTMLCanvasElement> {
  const [art, setArt] = useState<ReadonlyMap<number, HTMLCanvasElement>>(new Map());
  const wanted = useMemo(() => {
    if (mdt === null) return [];
    const used = new Set(mdt.floors.filter((fit) => fit.good).map((fit) => fit.sublevel));
    return mdt.dungeon.sublevels.filter((level) => used.has(level.index) && level.textureDir !== null);
  }, [mdt]);
  const key = wanted.map((level) => `${level.textureDir}#${level.index}`).join('|');

  useEffect(() => {
    let cancelled = false;
    const api = (window as Partial<Window>).mplus;
    if (wanted.length === 0 || api?.mdtTiles === undefined) return;
    void Promise.all(
      wanted.map(async (level) => {
        const cacheKey = `${level.textureDir}#${level.index}`;
        let pending = artCache.get(cacheKey);
        if (pending === undefined) {
          pending = api.mdtTiles(level.textureDir!, level.index).then(composeTiles, () => null);
          artCache.set(cacheKey, pending);
        }
        return [level.index, await pending] as const;
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const next = new Map<number, HTMLCanvasElement>();
      for (const [index, canvas] of loaded) if (canvas !== null) next.set(index, canvas);
      setArt(next);
    });
    return () => {
      cancelled = true;
    };
    // `key` stands for `wanted`, which is a new array on every live update.
  }, [key]);
  return art;
}

/** MDT's 15 by 10 tiles laid out as one image, or null when none loaded. */
async function composeTiles(tiles: Array<string | null> | null): Promise<HTMLCanvasElement | null> {
  if (tiles === null) return null;
  const size = MDT_TILES.pixels;
  const canvas = document.createElement('canvas');
  canvas.width = MDT_TILES.columns * size;
  canvas.height = MDT_TILES.rows * size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  let drawn = 0;
  await Promise.all(
    tiles.map(async (url, index) => {
      if (url === null) return;
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        return;
      }
      const row = Math.floor(index / MDT_TILES.columns);
      const column = index % MDT_TILES.columns;
      ctx.drawImage(image, column * size, row * size, size, size);
      drawn++;
    }),
  );
  return drawn === 0 ? null : canvas;
}

interface CanvasProps {
  floor: Floor;
  /** MDT's art for the floor's sublevel, once loaded. */
  art: HTMLCanvasElement | null;
  /** The run's MDT placement, when this floor is drawn on MDT's map. */
  mdt: MdtPlacement | null;
  t: number;
  pulls: PullShape[];
  /** Each pull's colour, by segment id. */
  colours: ReadonlyMap<number, string>;
  models: ReadonlyMap<number, Model>;
  /** Cropped portraits by display id, as they load. */
  portraits: ReadonlyMap<number, HTMLCanvasElement>;
  partyTracks: PositionTrack[];
  enemyTracks: PositionTrack[];
  palette: Palette;
  forcesRequired: number;
  selectedSegment: number | null;
  onSelectSegment(id: number | null): void;
}

/**
 * How far the reader has zoomed into a floor: `k` times the whole floor,
 * centred on (u, v) of its plane. Kept with the floor it was made on, so a
 * change of floor, or of MDT map, starts that floor whole.
 */
interface Zoom {
  uiMapId: number;
  onMdt: boolean;
  k: number;
  u: number;
  v: number;
}

/** Pixel geometry for one floor at one size. */
interface Frame {
  width: number;
  height: number;
  /** The whole floor, unzoomed. */
  base: Box;
  /** What of the floor's plane the frame shows. */
  view: Box;
  /** World to canvas px, with the quarter turn every WoW map has. */
  px(x: number, y: number): [number, number];
  /** Plane to canvas px. */
  planePx(u: number, v: number): [number, number];
  /** Canvas px per plane unit. */
  scale: number;
}

function MapCanvas({
  floor,
  art,
  mdt,
  t,
  pulls,
  colours,
  models,
  portraits,
  partyTracks,
  enemyTracks,
  palette,
  forcesRequired,
  selectedSegment,
  onSelectSegment,
}: CanvasProps): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const element = wrap.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth));
    observer.observe(element);
    setAvailable(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const [zoomState, setZoom] = useState<Zoom | null>(null);
  const onMdt = floor.fit !== null;
  const zoom = zoomState !== null && zoomState.uiMapId === floor.uiMapId && zoomState.onMdt === onMdt ? zoomState : null;

  const frame = useMemo<Frame | null>(() => {
    if (available <= 0) return null;
    const { plane } = floor;
    const cap = window.innerHeight * MAX_HEIGHT_VH;
    // On MDT's map there is always more map to show, so fill the frame with
    // it rather than with bars.
    const base = floor.fit === null ? floor.view : fillView(floor.view, available / cap);
    const spanU = base.maxU - base.minU;
    const spanV = base.maxV - base.minV;
    let width = available;
    let height = (width * spanV) / spanU;
    if (height > cap) {
      height = cap;
      width = (height * spanU) / spanV;
    }
    // Zooming keeps the frame's size and shows less of the floor in it.
    const view = zoomedView(base, zoom);
    const scale = width / (view.maxU - view.minU);
    const planePx = (u: number, v: number): [number, number] => [(u - view.minU) * scale, (v - view.minV) * scale];
    return {
      width: Math.round(width),
      height: Math.round(height),
      base,
      view,
      px: (x, y) => planePx(...plane(x, y)),
      planePx,
      scale,
    };
  }, [floor, available, zoom]);

  /** Zooms by `factor` about a point of the frame, keeping that point where it is on screen. */
  const zoomAbout = useCallback(
    (factor: number, x: number, y: number): void => {
      if (frame === null) return;
      const k = Math.min(MAX_ZOOM, Math.max(1, (zoom?.k ?? 1) * factor));
      if (k === 1) {
        setZoom(null);
        return;
      }
      const { base, view } = frame;
      const u = view.minU + x / frame.scale;
      const v = view.minV + y / frame.scale;
      const spanU = (base.maxU - base.minU) / k;
      const spanV = (base.maxV - base.minV) / k;
      const minU = u - (x / frame.width) * spanU;
      const minV = v - (y / frame.height) * spanV;
      setZoom(clampZoom(base, { uiMapId: floor.uiMapId, onMdt, k, u: minU + spanU / 2, v: minV + spanV / 2 }));
    },
    [frame, zoom, floor.uiMapId, onMdt],
  );

  // The wheel zooms. React's wheel handler is passive and cannot keep the page
  // from scrolling too, so this one is added by hand.
  const zoomAboutRef = useRef(zoomAbout);
  zoomAboutRef.current = zoomAbout;
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      // Trackpads send many small deltas, a wheel a few large ones; both come
      // out at about one step per notch.
      const factor = ZOOM_STEP ** (-event.deltaY / (event.deltaMode === 0 ? 100 : 3));
      zoomAboutRef.current(factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [frame !== null]);

  /** Icon radius in px for a mob, at this zoom. */
  const radius = useCallback(
    (boss: boolean): number => {
      if (frame === null) return MOB_PX.min;
      const r = (floor.fit === null ? MOB_RADIUS.yards : MOB_RADIUS.mdt) * frame.scale;
      const clamped = Math.min(MOB_PX.max, Math.max(MOB_PX.min, r));
      return boss ? clamped * MOB_RADIUS.boss : clamped;
    },
    [frame, floor.fit],
  );

  const { hulls, mobs } = useMemo(() => {
    if (frame === null) return { hulls: [] as Hull[], mobs: [] as MobIcon[] };
    const sublevel = floor.fit?.sublevel ?? null;
    const mobs: MobIcon[] = [];
    // On MDT's map, a kill placed on a spawn is drawn on it.
    const spawned = new Map<number, Point>();
    if (mdt !== null && sublevel !== null) {
      const killed = new Map(mdt.matches.map((match) => [`${match.enemyIndex}:${match.cloneIndex}`, match.actor]));
      for (const enemy of mdt.dungeon.enemies) {
        for (const clone of enemy.clones) {
          if (clone.sublevel !== sublevel) continue;
          // MDT's y points up from the canvas top; the plane's v points down.
          const at = frame.planePx(clone.x, -clone.y);
          const actor = killed.get(`${enemy.index}:${clone.index}`);
          if (actor !== undefined) spawned.set(actor, at);
          else mobs.push({ x: at[0], y: at[1], displayId: enemy.displayId, boss: enemy.isBoss, segmentId: null });
        }
      }
    }
    const hulls: Hull[] = [];
    for (const pull of pulls) {
      if (pull.uiMapId !== floor.uiMapId) continue;
      const corners: Point[] = [];
      const points = pull.mobs.map((track): Point => {
        const at = spawned.get(track.actor) ?? frame.px(track.home!.x, track.home!.y);
        const model = models.get(track.npcId);
        const boss = model?.boss ?? false;
        mobs.push({ x: at[0], y: at[1], displayId: model?.displayId ?? null, boss, segmentId: pull.segment.id });
        // The outline goes round the icons, not their centres, so a boss's
        // larger icon is inside it too.
        const r = radius(boss);
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          corners.push([at[0] + Math.cos(angle) * r, at[1] + Math.sin(angle) * r]);
        }
        return at;
      });
      hulls.push({ pull, outline: inflate(convexHull(corners), HULL_PAD), centre: centroid(points) });
    }
    return { hulls, mobs };
  }, [pulls, floor, frame, mdt, models, radius]);

  const bosses = useMemo(
    () => new Set(pulls.filter((pull) => pull.segment.kind === SegmentKind.BOSS).map((pull) => pull.segment.id)),
    [pulls],
  );

  /**
   * The parts that do not move with the playhead, drawn once per floor and
   * size: the party's whole route and every pull's outline.
   */
  const backdrop = useMemo(() => {
    if (frame === null) return null;
    const ratio = window.devicePixelRatio || 1;
    const layer = document.createElement('canvas');
    layer.width = frame.width * ratio;
    layer.height = frame.height * ratio;
    const ctx = layer.getContext('2d');
    if (ctx === null) return null;
    ctx.scale(ratio, ratio);
    const css = getComputedStyle(document.documentElement);
    const colour = (name: string): string => css.getPropertyValue(name).trim();

    if (art !== null) {
      // The plane is MDT's canvas with v pointing down, and the art is that
      // canvas at ART_SCALE pixels per unit.
      const { view } = frame;
      ctx.drawImage(
        art,
        view.minU * ART_SCALE,
        view.minV * ART_SCALE,
        (view.maxU - view.minU) * ART_SCALE,
        (view.maxV - view.minV) * ART_SCALE,
        0,
        0,
        frame.width,
        frame.height,
      );
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const track of partyTracks) {
      ctx.strokeStyle = palette.get(track.actor) ?? colour('--muted');
      ctx.globalAlpha = art !== null ? 0.4 : 0.16;
      ctx.lineWidth = 3;
      strokePath(ctx, track, floor.uiMapId, frame, 0, Infinity);
    }
    ctx.globalAlpha = 1;

    // MDT's art is busy and light, so pulls on it need more weight to read.
    const weight = art !== null ? 1.6 : 1;
    for (const { pull, outline } of hulls) {
      const selected = pull.segment.id === selectedSegment;
      const tint = colours.get(pull.segment.id) ?? colour('--pull');
      ctx.beginPath();
      outline.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.globalAlpha = (selected ? 0.4 : selectedSegment === null ? 0.2 : 0.07) * weight;
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.globalAlpha = selected ? 1 : selectedSegment === null ? 0.9 : 0.35;
      ctx.strokeStyle = selected ? colour('--text') : tint;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Spawns left standing first, so a killed mob on top of one shows.
    for (const mob of mobs) {
      const left = mob.segmentId === null;
      const dim = left || (selectedSegment !== null && mob.segmentId !== selectedSegment);
      drawMob(ctx, mob, radius(mob.boss), {
        art: mob.displayId === null ? null : (portraits.get(mob.displayId) ?? null),
        ring: left ? null : (colours.get(mob.segmentId!) ?? colour('--pull')),
        alpha: left ? 0.6 : dim ? 0.5 : 1,
        grey: left,
      });
    }
    ctx.globalAlpha = 1;
    return layer;
  }, [frame, art, partyTracks, palette, floor, hulls, mobs, colours, portraits, radius, selectedSegment]);

  useEffect(() => {
    const element = canvas.current;
    if (element === null || frame === null || backdrop === null) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = frame.width * ratio;
    element.height = frame.height * ratio;
    const ctx = element.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, frame.width, frame.height);
    ctx.drawImage(backdrop, 0, 0, frame.width, frame.height);
    const css = getComputedStyle(document.documentElement);
    const colour = (name: string): string => css.getPropertyValue(name).trim();

    // Enemies alive at t: engaged, and neither dead nor gone quiet.
    for (const track of enemyTracks) {
      const n = track.ts.length;
      if (n === 0 || track.ts[0]! > t) continue;
      const died = track.deaths[0];
      if (died !== undefined ? died <= t : track.ts[n - 1]! + ENEMY_LINGER_MS < t) continue;
      const at = positionAt(track, t);
      if (at === null || at.uiMapId !== floor.uiMapId) continue;
      const [x, y] = frame.px(at.x, at.y);
      const boss = bosses.has(track.segmentId);
      ctx.beginPath();
      ctx.arc(x, y, boss ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = colours.get(track.segmentId) ?? colour('--danger');
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Pull numbers above the enemies, so a busy pull still shows which it is.
    for (const { pull, centre } of hulls) {
      const boss = pull.segment.kind === SegmentKind.BOSS;
      const selected = pull.segment.id === selectedSegment;
      const dim = selectedSegment !== null && !selected;
      ctx.globalAlpha = dim ? 0.45 : 1;
      const label = boss ? '☠' : String(pull.segment.pullNumber);
      ctx.beginPath();
      ctx.arc(centre[0], centre[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = colours.get(pull.segment.id) ?? colour(boss ? '--boss' : '--pull');
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 1.25;
      ctx.stroke();
      // White on a dark edge reads on every hue the pulls are given.
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5;
      ctx.strokeText(label, centre[0], centre[1] + 0.5);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, centre[0], centre[1] + 0.5);
      if (forcesRequired > 0 && pull.segment.forces > 0) {
        ctx.font = '500 10px system-ui, sans-serif';
        ctx.fillStyle = colour('--text');
        ctx.strokeStyle = colour('--bg');
        ctx.lineWidth = 3;
        const text = percent(pull.segment.forces / forcesRequired);
        ctx.strokeText(text, centre[0], centre[1] + 17);
        ctx.fillText(text, centre[0], centre[1] + 17);
      }
    }
    ctx.globalAlpha = 1;

    // Each player's last few seconds, then the player, then where they died.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const track of partyTracks) {
      const tint = palette.get(track.actor) ?? colour('--muted');
      ctx.strokeStyle = tint;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      strokePath(ctx, track, floor.uiMapId, frame, t - TRAIL_MS, t);
      ctx.globalAlpha = 1;

      for (const death of track.deaths) {
        if (death > t) continue;
        const at = positionAt(track, death);
        if (at === null || at.uiMapId !== floor.uiMapId) continue;
        const [x, y] = frame.px(at.x, at.y);
        cross(ctx, x, y, 5, tint, colour('--bg'));
      }

      const dead = isDeadAt(track, t);
      const at = positionAt(track, t);
      if (at === null || at.uiMapId !== floor.uiMapId) continue;
      const [x, y] = frame.px(at.x, at.y);
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = dead ? colour('--bg') : tint;
      ctx.fill();
      ctx.strokeStyle = dead ? tint : colour('--bg');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [frame, backdrop, t, enemyTracks, partyTracks, palette, floor, hulls, colours, bosses, selectedSegment, forcesRequired]);

  /** The pull under a point: the smallest outline containing it, or the nearest label. */
  const pullAt = useCallback(
    (x: number, y: number): Segment | null => {
      let best: Segment | null = null;
      let bestArea = Infinity;
      for (const { pull, outline, centre } of hulls) {
        if (Math.hypot(centre[0] - x, centre[1] - y) <= 11) return pull.segment;
        if (!inside(outline, x, y)) continue;
        const area = polygonArea(outline);
        if (area < bestArea) {
          bestArea = area;
          best = pull.segment;
        }
      }
      return best;
    },
    [hulls],
  );

  const [hover, setHover] = useState<Segment | null>(null);
  const local = (event: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  // Dragging a zoomed map pans it. A press that barely moves is still a click
  // on a pull; one that dragged is not.
  const drag = useRef<{ x: number; y: number; u: number; v: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragged = useRef(false);

  return (
    <div className="map-canvas" ref={wrap}>
      {frame !== null ? (
        <div className="map-stage" style={{ width: frame.width, height: frame.height }}>
          <canvas
            ref={canvas}
            style={{
              width: frame.width,
              height: frame.height,
              cursor: dragging ? 'grabbing' : hover !== null ? 'pointer' : zoom !== null ? 'grab' : 'default',
            }}
            title={hover !== null && !dragging ? pullTitle(hover, forcesRequired) : ''}
            onPointerDown={(event) => {
              dragged.current = false;
              if (zoom === null || event.button !== 0) return;
              drag.current = { x: event.clientX, y: event.clientY, u: zoom.u, v: zoom.v, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (start === null || zoom === null) return;
              const dx = event.clientX - start.x;
              const dy = event.clientY - start.y;
              if (!start.moved && Math.hypot(dx, dy) < DRAG_PX) return;
              if (!start.moved) {
                start.moved = true;
                setDragging(true);
                setHover(null);
              }
              setZoom(clampZoom(frame.base, { ...zoom, u: start.u - dx / frame.scale, v: start.v - dy / frame.scale }));
            }}
            onPointerUp={(event) => {
              dragged.current = drag.current?.moved ?? false;
              drag.current = null;
              setDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onMouseMove={(event) => {
              if (drag.current?.moved) return;
              setHover(pullAt(...local(event)));
            }}
            onMouseLeave={() => setHover(null)}
            onClick={(event) => {
              if (dragged.current) return;
              const segment = pullAt(...local(event));
              if (segment === null) return;
              onSelectSegment(segment.id === selectedSegment ? null : segment.id);
            }}
            onDoubleClick={(event) => {
              // A double click on empty map zooms in there; on a pull it is two clicks.
              const at = local(event);
              if (pullAt(...at) === null) zoomAbout(ZOOM_STEP * ZOOM_STEP, ...at);
            }}
          />
          <div className="map-zoom" aria-label="Zoom">
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in (or scroll on the map)"
              disabled={zoom !== null && zoom.k >= MAX_ZOOM}
              onClick={() => zoomAbout(ZOOM_STEP * ZOOM_STEP, frame.width / 2, frame.height / 2)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={zoom === null}
              onClick={() => zoomAbout(1 / (ZOOM_STEP * ZOOM_STEP), frame.width / 2, frame.height / 2)}
            >
              −
            </button>
            {zoom !== null ? (
              <button type="button" className="map-zoom-reset" title="Show the whole floor" onClick={() => setZoom(null)}>
                Fit
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One mob: its portrait in a circle, ringed in its pull's colour. A spawn left
 * standing is grey, the way MDT draws what a route skips. Without a portrait,
 * still loading or with no MDT to name the model, it is a plain dot.
 */
function drawMob(
  ctx: CanvasRenderingContext2D,
  mob: MobIcon,
  r: number,
  style: { art: HTMLCanvasElement | null; ring: string | null; alpha: number; grey: boolean },
): void {
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.beginPath();
  ctx.arc(mob.x, mob.y, r, 0, Math.PI * 2);
  ctx.fillStyle = style.art !== null ? PORTRAIT_BG : (style.ring ?? '#8a8f99');
  ctx.fill();
  if (style.art !== null) {
    ctx.save();
    ctx.clip();
    if (style.grey) ctx.filter = 'grayscale(1) brightness(0.8)';
    ctx.drawImage(style.art, mob.x - r, mob.y - r, r * 2, r * 2);
    ctx.restore();
  }
  ctx.strokeStyle = style.ring ?? 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = style.ring !== null ? 2 : 1;
  ctx.stroke();
  ctx.restore();
}

/**
 * A colour for every pull, the same on every floor. Each step is the golden
 * angle round the hue wheel, so pulls next to each other on the map, which
 * are next to each other in the key, never come out alike.
 */
function pullColours(pulls: PullShape[]): ReadonlyMap<number, string> {
  return new Map(
    pulls.map((pull, index) => [pull.segment.id, `hsl(${Math.round((index * 137.508 + 200) % 360)}, 72%, 55%)`]),
  );
}

function modelsOf(mdt: MdtPlacement | null): ReadonlyMap<number, Model> {
  if (mdt === null) return new Map();
  return new Map(mdt.dungeon.enemies.map((enemy) => [enemy.npcId, { displayId: enemy.displayId, boss: enemy.isBoss }]));
}

/** Cropped portraits by display id, shared by every run. */
const portraitArt = new Map<number, Promise<HTMLCanvasElement | null>>();

/** The portraits cropped to faces, as they finish. */
function usePortraitArt(urls: ReadonlyMap<number, string>): ReadonlyMap<number, HTMLCanvasElement> {
  const [art, setArt] = useState<ReadonlyMap<number, HTMLCanvasElement>>(new Map());
  // The ids come sorted, so this stands for `urls`, which is new every render.
  const key = [...urls.keys()].join(',');
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      [...urls].map(async ([id, url]) => {
        let pending = portraitArt.get(id);
        if (pending === undefined) {
          pending = cropPortrait(url);
          portraitArt.set(id, pending);
        }
        return [id, await pending] as const;
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const next = new Map<number, HTMLCanvasElement>();
      for (const [id, canvas] of loaded) if (canvas !== null) next.set(id, canvas);
      setArt(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return art;
}

/**
 * A face out of a whole-creature render: a square as wide as the creature,
 * from the top of a tall one, or all of a wide one. The render's soft glow and
 * particles are see-through enough to leave out of the measure.
 */
async function cropPortrait(url: string): Promise<HTMLCanvasElement | null> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (pctx === null || w === 0 || h === 0) return null;
  pctx.drawImage(image, 0, 0);
  const { data } = pctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! < 128) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const side = Math.min(Math.max(bw, bh * 0.55) * 1.1, Math.max(w, h));
  const cx = (minX + maxX) / 2;
  const cy = bh > side ? minY + side * 0.45 : (minY + maxY) / 2;
  const out = document.createElement('canvas');
  out.width = PORTRAIT_PX;
  out.height = PORTRAIT_PX;
  const ctx = out.getContext('2d');
  if (ctx === null) return null;
  ctx.drawImage(image, cx - side / 2, cy - side / 2, side, side, 0, 0, PORTRAIT_PX, PORTRAIT_PX);
  return out;
}

/**
 * A view grown to the frame's aspect ratio about its centre, then moved to
 * keep as much of MDT's canvas in it as it can hold.
 */
function fillView(view: Box, aspect: number): Box {
  let spanU = view.maxU - view.minU;
  let spanV = view.maxV - view.minV;
  if (!(aspect > 0) || !Number.isFinite(aspect)) return view;
  if (spanU / spanV < aspect) spanU = spanV * aspect;
  else spanV = spanU / aspect;
  // A view smaller than the canvas slides back onto it; a larger one centres
  // it, since everything MDT draws is on the canvas.
  const fit = (mid: number, span: number, limit: number): number =>
    span <= limit ? Math.min(Math.max(mid - span / 2, 0), limit - span) : (limit - span) / 2;
  const minU = fit((view.minU + view.maxU) / 2, spanU, MDT_CANVAS.width);
  const minV = fit((view.minV + view.maxV) / 2, spanV, MDT_CANVAS.height);
  return { minU, maxU: minU + spanU, minV, maxV: minV + spanV };
}

/**
 * The part of the whole floor a zoom shows: `k` times smaller, about its
 * centre, slid back inside the floor so panning never runs off its edge.
 */
function zoomedView(base: Box, zoom: Zoom | null): Box {
  if (zoom === null || zoom.k <= 1) return base;
  const spanU = (base.maxU - base.minU) / zoom.k;
  const spanV = (base.maxV - base.minV) / zoom.k;
  const minU = Math.min(Math.max(zoom.u - spanU / 2, base.minU), base.maxU - spanU);
  const minV = Math.min(Math.max(zoom.v - spanV / 2, base.minV), base.maxV - spanV);
  return { minU, maxU: minU + spanU, minV, maxV: minV + spanV };
}

/** A zoom with its centre moved to that of the view it shows. */
function clampZoom(base: Box, zoom: Zoom): Zoom {
  const view = zoomedView(base, zoom);
  return { ...zoom, u: (view.minU + view.maxU) / 2, v: (view.minV + view.maxV) / 2 };
}

function pullTitle(segment: Segment, forcesRequired: number): string {
  const head = segment.kind === SegmentKind.BOSS ? segment.label : `Pull ${segment.pullNumber} — ${segment.label}`;
  const mobs = `${integer(segment.enemies.length)} ${segment.enemies.length === 1 ? 'mob' : 'mobs'}`;
  const forces = forcesRequired > 0 && segment.forces > 0 ? ` · ${percent(segment.forces / forcesRequired)}` : '';
  return `${head}\n${mobs}${forces} · ${clock(segment.startTs)}–${clock(segment.endTs)}`;
}

/**
 * Whether a player is dead at t: died at or before it, and not seen acting
 * since. A battle-rezzed or released player shows up in the log again, which
 * is the only sign of it the log carries.
 */
function isDeadAt(track: PositionTrack, t: number): boolean {
  let last = -Infinity;
  for (const death of track.deaths) if (death <= t) last = Math.max(last, death);
  if (last === -Infinity) return false;
  // Any sample after the death, up to t, means they were back.
  return !track.ts.some((ts) => ts > last && ts <= t);
}

/** Strokes one track's samples on one floor between two times, broken wherever it left the floor. */
function strokePath(
  ctx: CanvasRenderingContext2D,
  track: PositionTrack,
  uiMapId: number,
  frame: Frame,
  from: number,
  to: number,
): void {
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < track.ts.length; i++) {
    const ts = track.ts[i]!;
    if (ts < from) continue;
    if (ts > to) break;
    if (track.uiMapId[i] !== uiMapId) {
      pen = false;
      continue;
    }
    const [x, y] = frame.px(track.x[i]!, track.y[i]!);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tint: string, halo: string): void {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.strokeStyle = halo;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * The floors the key used, in the order the party reached them.
 *
 * Built from the samples rather than from `meta.maps`, which lists only the
 * floors the logging player stepped on. Bounds are not needed to draw: each
 * floor is framed on what was drawn on it, which also crops away the empty
 * margins a map's own bounds leave around the dungeon.
 */
function floorsOf(
  run: RunAnalysis,
  party: PositionTrack[],
  enemies: PositionTrack[],
  fits: ReadonlyMap<number, MdtFloorFit>,
): Floor[] {
  // Across the screen is world Y, reversed; down it is world X, reversed. On
  // MDT's map that quarter turn is part of the fit, and MDT's y points up.
  const planes = new Map<number, (x: number, y: number) => Point>();
  const planeOf = (uiMapId: number): ((x: number, y: number) => Point) => {
    let plane = planes.get(uiMapId);
    if (plane === undefined) {
      const fit = fits.get(uiMapId);
      plane =
        fit === undefined
          ? (x, y) => [-y, -x]
          : (x, y) => {
              const [u, v] = toMdt(fit, x, y);
              return [u, -v];
            };
      planes.set(uiMapId, plane);
    }
    return plane;
  };
  const extents = new Map<number, Box & { firstTs: number }>();
  const add = (uiMapId: number, x: number, y: number, ts: number): void => {
    const [u, v] = planeOf(uiMapId)(x, y);
    const box = extents.get(uiMapId);
    if (box === undefined) {
      extents.set(uiMapId, { minU: u, maxU: u, minV: v, maxV: v, firstTs: ts });
      return;
    }
    box.minU = Math.min(box.minU, u);
    box.maxU = Math.max(box.maxU, u);
    box.minV = Math.min(box.minV, v);
    box.maxV = Math.max(box.maxV, v);
    box.firstTs = Math.min(box.firstTs, ts);
  };
  for (const track of party) {
    for (let i = 0; i < track.ts.length; i++) add(track.uiMapId[i]!, track.x[i]!, track.y[i]!, track.ts[i]!);
  }
  // Enemy start points widen a floor but never start one: a floor only the
  // enemies were on is a boss's platform the party fought from below.
  for (const track of enemies) {
    const home = track.home;
    if (home !== null && extents.has(home.uiMapId)) add(home.uiMapId, home.x, home.y, Infinity);
  }

  const floors: Floor[] = [];
  for (const [uiMapId, box] of extents) {
    const fit = fits.get(uiMapId) ?? null;
    const largest = Math.max(box.maxU - box.minU, box.maxV - box.minV);
    const pad = Math.max(largest, 20) * PAD;
    // A floor the party only crossed in a corridor is a line; give it some
    // depth. On MDT's map, show enough around it to see where it is.
    const least = fit === null ? largest / 3 : Math.max(largest / 3, MDT_MIN_SPAN);
    const midU = (box.minU + box.maxU) / 2;
    const midV = (box.minV + box.maxV) / 2;
    const halfU = Math.max(box.maxU - box.minU, least) / 2 + pad;
    const leastV = fit === null ? least : least * (MDT_CANVAS.height / MDT_CANVAS.width);
    const halfV = Math.max(box.maxV - box.minV, leastV) / 2 + pad;
    floors.push({
      uiMapId,
      name: run.meta.maps.find((map) => map.uiMapId === uiMapId)?.name || `Map ${uiMapId}`,
      firstTs: box.firstTs,
      fit,
      plane: planeOf(uiMapId),
      view: { minU: midU - halfU, maxU: midU + halfU, minV: midV - halfV, maxV: midV + halfV },
    });
  }
  floors.sort((a, b) => a.firstTs - b.firstTs);
  // Some dungeons give every floor the dungeon's own name; number those.
  const names = floors.map((floor) => floor.name);
  floors.forEach((floor, index) => {
    const same = names.filter((name) => name === names[index]).length;
    if (same > 1) floor.name = `${names[index]} ${names.slice(0, index + 1).filter((name) => name === names[index]).length}`;
  });
  return floors;
}

/**
 * Each pull's enemy start points, on the floor most of them stood on.
 *
 * Summons are left out where the segment has anything else: they appear
 * wherever their summoner put them mid-fight, which would draw a pack where
 * none stood.
 */
function pullShapes(segments: Segment[], enemies: PositionTrack[]): PullShape[] {
  const bySegment = new Map<number, PositionTrack[]>();
  for (const track of enemies) {
    if (track.home === null || track.segmentId < 0) continue;
    const list = bySegment.get(track.segmentId);
    if (list === undefined) bySegment.set(track.segmentId, [track]);
    else list.push(track);
  }
  const shapes: PullShape[] = [];
  for (const segment of segments) {
    const tracks = bySegment.get(segment.id);
    if (tracks === undefined) continue;
    const summoned = new Set(segment.roster.filter((group) => group.summon).map((group) => group.npcId));
    const placed = tracks.filter((track) => !summoned.has(track.npcId));
    const used = placed.length > 0 ? placed : tracks;
    const votes = new Map<number, number>();
    for (const track of used) votes.set(track.home!.uiMapId, (votes.get(track.home!.uiMapId) ?? 0) + 1);
    const uiMapId = [...votes].sort((a, b) => b[1] - a[1])[0]![0];
    shapes.push({ segment, uiMapId, mobs: used.filter((track) => track.home!.uiMapId === uiMapId) });
  }
  return shapes;
}

/** The floor most of the living party is on at t, or null before anyone is seen. */
function partyFloorAt(party: PositionTrack[], t: number): number | null {
  const votes = new Map<number, number>();
  for (const track of party) {
    const at = positionAt(track, t);
    if (at !== null) votes.set(at.uiMapId, (votes.get(at.uiMapId) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 0;
  for (const [uiMapId, count] of votes) {
    if (count > most) {
      best = uiMapId;
      most = count;
    }
  }
  return best;
}

// ------------------------------------------------------------------ geometry

type Point = [number, number];

/** Andrew's monotone chain; collinear points dropped. */
function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const turn = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]!;
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * A hull grown outward by `by` px, as a rounded polygon: each corner becomes
 * an arc. One or two points become a circle or a capsule the same way.
 */
function inflate(hull: Point[], by: number): Point[] {
  const out: Point[] = [];
  const steps = 6;
  if (hull.length === 0) return out;
  if (hull.length === 1) {
    const [x, y] = hull[0]!;
    for (let i = 0; i < steps * 4; i++) {
      const angle = (i / (steps * 4)) * Math.PI * 2;
      out.push([x + Math.cos(angle) * by, y + Math.sin(angle) * by]);
    }
    return out;
  }
  // A two-point hull is walked there and back, so each end gets a half circle.
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const prev = hull[(i - 1 + n) % n]!;
    const here = hull[i]!;
    const next = hull[(i + 1) % n]!;
    const inAngle = Math.atan2(here[1] - prev[1], here[0] - prev[0]) - Math.PI / 2;
    let outAngle = Math.atan2(next[1] - here[1], next[0] - here[0]) - Math.PI / 2;
    // The hull winds so that the outward normal is the edge direction minus a
    // quarter turn; sweep from one edge's normal to the next, never backwards.
    while (outAngle < inAngle) outAngle += Math.PI * 2;
    for (let s = 0; s <= steps; s++) {
      const angle = inAngle + ((outAngle - inAngle) * s) / steps;
      out.push([here[0] + Math.cos(angle) * by, here[1] + Math.sin(angle) * by]);
    }
  }
  return out;
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / Math.max(points.length, 1), y / Math.max(points.length, 1)];
}

function inside(polygon: Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function polygonArea(polygon: Point[]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j]![0] + polygon[i]![0]) * (polygon[j]![1] - polygon[i]![1]);
  }
  return Math.abs(area / 2);
}

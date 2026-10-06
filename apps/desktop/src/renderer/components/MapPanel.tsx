import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SegmentKind, TrackKind, positionAt, toMdt } from '@mplus/analysis';
import { MDT_CANVAS, MDT_TILES } from '@mplus/data';

import { clock, integer, percent } from '../format.js';
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
  /**
   * Enemy start points, world space, grouped into packs: points closer than
   * `PACK_YARDS` to one another, chained. The largest pack is first.
   */
  packs: Point[][];
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
/**
 * Enemies this close, chained, are drawn as one pack.
 *
 * A segment is continuous combat, so a chain pull — three packs walked into
 * each other down a corridor — is one segment. One outline around all of it
 * is a wedge over every wall in between; one per pack is what a route
 * planner would draw.
 */
const PACK_YARDS = 18;
/** How far a pull's outline stands off its enemies, in px. */
const HULL_PAD = 9;
const MAX_HEIGHT_VH = 0.7;
/** The least of MDT's canvas a floor shows, in its units, so a small floor keeps its surroundings. */
const MDT_MIN_SPAN = 140;
/** MDT art pixels per canvas unit. */
const ART_SCALE = MDT_TILES.pixels / MDT_TILES.units;

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
  partyTracks: PositionTrack[];
  enemyTracks: PositionTrack[];
  palette: Palette;
  forcesRequired: number;
  selectedSegment: number | null;
  onSelectSegment(id: number | null): void;
}

/** Pixel geometry for one floor at one size. */
interface Frame {
  width: number;
  height: number;
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

  const frame = useMemo<Frame | null>(() => {
    if (available <= 0) return null;
    const { plane } = floor;
    const cap = window.innerHeight * MAX_HEIGHT_VH;
    // On MDT's map there is always more map to show, so fill the frame with
    // it rather than with bars.
    const view = floor.fit === null ? floor.view : fillView(floor.view, available / cap);
    const spanU = view.maxU - view.minU;
    const spanV = view.maxV - view.minV;
    let width = available;
    let height = (width * spanV) / spanU;
    if (height > cap) {
      height = cap;
      width = (height * spanU) / spanV;
    }
    const scale = width / spanU;
    const planePx = (u: number, v: number): [number, number] => [(u - view.minU) * scale, (v - view.minV) * scale];
    return {
      width: Math.round(width),
      height: Math.round(height),
      view,
      px: (x, y) => planePx(...plane(x, y)),
      planePx,
      scale,
    };
  }, [floor, available]);

  const hulls = useMemo(() => {
    if (frame === null) return [];
    return pulls
      .filter((pull) => pull.uiMapId === floor.uiMapId)
      .map((pull) => {
        const packs = pull.packs.map((pack) => pack.map(([x, y]) => frame.px(x, y)));
        const centres = packs.map(centroid);
        return {
          pull,
          outlines: packs.map((pack) => inflate(convexHull(pack), HULL_PAD)),
          centre: centres[0]!,
          // Packs tied together, so a chain reads as one pull.
          links: spanningTree(centres),
        };
      });
  }, [pulls, floor, frame]);

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
    if (mdt !== null && floor.fit !== null) drawSpawns(ctx, mdt, floor.fit.sublevel, frame, colour);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const track of partyTracks) {
      ctx.strokeStyle = palette.get(track.actor) ?? colour('--muted');
      ctx.globalAlpha = art !== null ? 0.4 : 0.16;
      ctx.lineWidth = 3;
      strokePath(ctx, track, floor.uiMapId, frame, 0, Infinity);
    }
    ctx.globalAlpha = 1;

    for (const { pull, outlines, links } of hulls) {
      const boss = pull.segment.kind === SegmentKind.BOSS;
      const selected = pull.segment.id === selectedSegment;
      const base = colour(boss ? '--boss' : '--pull');
      if (links.length > 0) {
        ctx.beginPath();
        for (const [from, to] of links) {
          ctx.moveTo(from[0], from[1]);
          ctx.lineTo(to[0], to[1]);
        }
        ctx.setLineDash([3, 4]);
        ctx.globalAlpha = selected ? 0.9 : selectedSegment === null ? 0.5 : 0.2;
        ctx.strokeStyle = selected ? colour('--text') : base;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      for (const outline of outlines) {
        outline.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
      }
      // MDT's art is busy and light, so pulls on it need more weight to read.
      const weight = art !== null ? 1.8 : 1;
      ctx.globalAlpha = (selected ? 0.32 : selectedSegment === null ? 0.16 : 0.07) * weight;
      ctx.fillStyle = base;
      ctx.fill();
      ctx.globalAlpha = Math.min(1, (selected ? 1 : selectedSegment === null ? 0.7 : 0.3) * weight);
      ctx.strokeStyle = selected ? colour('--text') : base;
      ctx.lineWidth = (selected ? 2 : 1.25) * (art !== null ? 1.4 : 1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return layer;
  }, [frame, art, mdt, partyTracks, palette, floor, hulls, selectedSegment]);

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
      ctx.arc(x, y, boss ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = boss ? colour('--boss') : colour('--danger');
      ctx.globalAlpha = 0.85;
      ctx.fill();
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
      ctx.fillStyle = colour(boss ? '--boss' : '--pull');
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
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
  }, [frame, backdrop, t, enemyTracks, partyTracks, palette, floor, hulls, bosses, selectedSegment, forcesRequired]);

  /** The pull under a point: the smallest outline containing it, or the nearest label. */
  const pullAt = useCallback(
    (x: number, y: number): Segment | null => {
      let best: Segment | null = null;
      let bestArea = Infinity;
      for (const { pull, outlines, centre } of hulls) {
        if (Math.hypot(centre[0] - x, centre[1] - y) <= 11) return pull.segment;
        for (const outline of outlines) {
          if (!inside(outline, x, y)) continue;
          const area = polygonArea(outline);
          if (area < bestArea) {
            bestArea = area;
            best = pull.segment;
          }
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

  return (
    <div className="map-canvas" ref={wrap}>
      {frame !== null ? (
        <canvas
          ref={canvas}
          style={{ width: frame.width, height: frame.height, cursor: hover !== null ? 'pointer' : 'default' }}
          title={hover !== null ? pullTitle(hover, forcesRequired) : ''}
          onMouseMove={(event) => setHover(pullAt(...local(event)))}
          onMouseLeave={() => setHover(null)}
          onClick={(event) => {
            const segment = pullAt(...local(event));
            if (segment === null) return;
            onSelectSegment(segment.id === selectedSegment ? null : segment.id);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * MDT's spawns on the floor: hollow where nothing was killed, filled where a
 * kill landed on one. The hollow ones are what the route skipped, or dragged
 * too far to tell.
 */
function drawSpawns(
  ctx: CanvasRenderingContext2D,
  mdt: MdtPlacement,
  sublevel: number,
  frame: Frame,
  colour: (name: string) => string,
): void {
  const killed = new Set(mdt.matches.map((match) => `${match.enemyIndex}:${match.cloneIndex}`));
  const r = Math.max(2, Math.min(4, frame.scale * 1.6));
  ctx.lineWidth = 1;
  for (const enemy of mdt.dungeon.enemies) {
    for (const clone of enemy.clones) {
      if (clone.sublevel !== sublevel) continue;
      // MDT's y points up from the canvas top; the plane's v points down.
      const [x, y] = frame.planePx(clone.x, -clone.y);
      if (x < -r || y < -r || x > frame.width + r || y > frame.height + r) continue;
      ctx.beginPath();
      ctx.arc(x, y, enemy.isBoss ? r * 1.8 : r, 0, Math.PI * 2);
      if (killed.has(`${enemy.index}:${clone.index}`)) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = colour('--bg');
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = colour('--bg');
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
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
    const points = used
      .filter((track) => track.home!.uiMapId === uiMapId)
      .map((track): Point => [track.home!.x, track.home!.y]);
    shapes.push({ segment, uiMapId, packs: packsOf(points) });
  }
  return shapes;
}

/** Single-linkage clusters at `PACK_YARDS`, largest first. */
function packsOf(points: Point[]): Point[][] {
  const parent = points.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= PACK_YARDS) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Point[]>();
  points.forEach((point, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [point]);
    else group.push(point);
  });
  return [...groups.values()].sort((a, b) => b.length - a.length);
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

/**
 * The shortest set of lines joining every point (Prim's). A chain pull's packs
 * come out joined in the order they lie along the corridor, where a star from
 * the largest pack would criss-cross the map.
 */
function spanningTree(points: Point[]): Array<[Point, Point]> {
  const links: Array<[Point, Point]> = [];
  if (points.length < 2) return links;
  const joined = [points[0]!];
  const rest = points.slice(1);
  while (rest.length > 0) {
    let best = Infinity;
    let from = 0;
    let to = 0;
    joined.forEach((a, i) =>
      rest.forEach((b, j) => {
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (distance < best) {
          best = distance;
          from = i;
          to = j;
        }
      }),
    );
    const next = rest.splice(to, 1)[0]!;
    links.push([joined[from]!, next]);
    joined.push(next);
  }
  return links;
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

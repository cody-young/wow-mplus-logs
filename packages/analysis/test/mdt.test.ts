import assert from 'node:assert/strict';
import test from 'node:test';

import type { MdtDungeon } from '@mplus/data';

import { TrackKind, placeOnMdt, toMdt, type PositionReport, type PositionTrack } from '../src/index.js';

/**
 * A made-up dungeon on MDT's canvas, and kills placed in world coordinates by
 * a known transform, so a fit can be checked against the truth.
 *
 * Thirty spawns of four creatures on a grid 30 MDT units apart: further apart
 * than the match radius, as most of a real dungeon's packs are, and with
 * every creature spawning many times over, so a kill's creature alone does
 * not say which spawn it was.
 */
const TRUTH = { scale: 0.8, offsetX: 420, offsetY: -310 };
const UI_MAP = 2433;

const DUNGEON: MdtDungeon = {
  challengeModeId: 588,
  dungeonIndex: 164,
  name: 'Test Hold',
  teleportSpellId: 0,
  sublevels: [{ index: 1, name: 'TestHold', textureDir: 'Midnight/Textures/TestHold' }],
  enemies: [0, 1, 2, 3].map((n) => ({
    index: n + 1,
    npcId: 1000 + n,
    name: `Creature ${n}`,
    count: 4,
    isBoss: false,
    clones: Array.from({ length: 30 }, (_, i) => i)
      .filter((i) => i % 4 === n)
      .map((i, k) => ({ index: k + 1, x: 300 + (i % 6) * 30, y: -200 - Math.floor(i / 6) * 30, sublevel: 1, group: null })),
  })),
};

/** The world position MDT's spawn stands at under the true transform. */
function worldOf(u: number, v: number): { x: number; y: number } {
  return { x: (v - TRUTH.offsetY) / TRUTH.scale, y: (TRUTH.offsetX - u) / TRUTH.scale };
}

let nextActor = 100;
function kill(npcId: number, x: number, y: number, uiMapId = UI_MAP): PositionTrack {
  return {
    actor: nextActor++,
    kind: TrackKind.ENEMY,
    name: String(npcId),
    npcId,
    segmentId: 0,
    deaths: [5000],
    ts: Int32Array.of(1000),
    x: Float32Array.of(x),
    y: Float32Array.of(y),
    uiMapId: Uint16Array.of(uiMapId),
    hpPct: Uint8Array.of(100),
    home: { ts: 1000, x, y, uiMapId },
  };
}

/** A small, fixed wobble, so kills are near their spawns but never on them. */
const wobble = (i: number): number => Math.sin(i * 12.9898) * 1.5;

function report(tracks: PositionTrack[]): PositionReport {
  return { maps: [], tracks };
}

test('a floor is fitted from its kills, and each kill placed on its spawn', () => {
  const tracks: PositionTrack[] = [];
  const truth = new Map<number, string>();
  for (const enemy of DUNGEON.enemies) {
    for (const clone of enemy.clones.slice(0, 6)) {
      const { x, y } = worldOf(clone.x, clone.y);
      const track = kill(enemy.npcId, x + wobble(tracks.length), y + wobble(tracks.length + 7));
      truth.set(track.actor, `${enemy.index}:${clone.index}`);
      tracks.push(track);
    }
  }
  // Two packs dragged half a room before anything touched them.
  const dragged = [DUNGEON.enemies[0]!.clones[7]!, DUNGEON.enemies[1]!.clones[7]!].map((clone, i) => {
    const { x, y } = worldOf(clone.x, clone.y);
    return kill(1000 + i, x + 40, y - 35);
  });
  tracks.push(...dragged);

  const placement = placeOnMdt(report(tracks), DUNGEON);
  assert.equal(placement.floors.length, 1);
  const fit = placement.floors[0]!;
  assert.equal(fit.uiMapId, UI_MAP);
  assert.equal(fit.sublevel, 1);
  assert.equal(fit.good, true);
  assert.equal(fit.observed, 26);
  assert.ok(Math.abs(fit.scale - TRUTH.scale) < 0.01, `scale ${fit.scale}`);
  assert.ok(Math.abs(fit.offsetX - TRUTH.offsetX) < 2, `offsetX ${fit.offsetX}`);
  assert.ok(Math.abs(fit.offsetY - TRUTH.offsetY) < 2, `offsetY ${fit.offsetY}`);

  // Every undragged kill on its own spawn; the dragged ones on none, rather
  // than on whichever free spawn happened to be nearest.
  const placed = new Map(placement.matches.map((match) => [match.actor, `${match.enemyIndex}:${match.cloneIndex}`]));
  for (const [actor, spawn] of truth) assert.equal(placed.get(actor), spawn);
  for (const track of dragged) assert.equal(placed.has(track.actor), false);
});

test("a spawn's world position goes where MDT draws it", () => {
  const clone = DUNGEON.enemies[2]!.clones[3]!;
  const { x, y } = worldOf(clone.x, clone.y);
  const [u, v] = toMdt(TRUTH, x, y);
  assert.ok(Math.abs(u - clone.x) < 1e-9 && Math.abs(v - clone.y) < 1e-9);
});

test('a floor with too few kills is not fitted at all', () => {
  const tracks = DUNGEON.enemies[0]!.clones.slice(0, 5).map((clone) => {
    const { x, y } = worldOf(clone.x, clone.y);
    return kill(1000, x, y, 2434);
  });
  assert.deepEqual(placeOnMdt(report(tracks), DUNGEON).floors, []);
});

test('a floor whose kills match nothing is fitted but not trusted', () => {
  // Kills scattered with no relation to the spawns: whatever fit comes out
  // matches a few by chance, and must say so rather than be drawn.
  const tracks: PositionTrack[] = [];
  for (let i = 0; i < 30; i++) tracks.push(kill(1000 + (i % 4), Math.sin(i * 7.1) * 400, Math.cos(i * 3.3) * 400, 2435));
  const placement = placeOnMdt(report(tracks), DUNGEON);
  const fit = placement.floors.find((floor) => floor.uiMapId === 2435);
  if (fit !== undefined) assert.equal(fit.good, false, `${fit.matched} of ${fit.observed} matched`);
  assert.deepEqual(placement.matches, []);
});

test('a floor that fits two ways equally well is not trusted', () => {
  // One creature on a regular lattice, killed in the middle of it: shifting
  // the whole run one spawn over matches every kill just as well, and nothing
  // in the run says which is right.
  const lattice: MdtDungeon = {
    ...DUNGEON,
    enemies: [
      {
        index: 1,
        npcId: 2000,
        name: 'Lattice Guard',
        count: 1,
        isBoss: false,
        clones: Array.from({ length: 40 }, (_, i) => ({
          index: i + 1,
          x: 300 + (i % 8) * 30,
          y: -200 - Math.floor(i / 8) * 30,
          sublevel: 1,
          group: null,
        })),
      },
    ],
  };
  const tracks = lattice.enemies[0]!.clones
    .filter((clone) => clone.x > 300 && clone.x < 510 && clone.y < -200 && clone.y > -320)
    .map((clone, i) => {
      const { x, y } = worldOf(clone.x, clone.y);
      return kill(2000, x + wobble(i), y + wobble(i + 3));
    });
  const fit = placeOnMdt(report(tracks), lattice).floors[0]!;
  assert.ok(fit.rival >= fit.matched * 0.85, `${fit.matched} against ${fit.rival}`);
  assert.equal(fit.good, false);
});

test('a creature killed more often than MDT has spawns for is a summon, and left out', () => {
  const tracks: PositionTrack[] = [];
  for (const enemy of DUNGEON.enemies) {
    for (const clone of enemy.clones.slice(0, 4)) {
      const { x, y } = worldOf(clone.x, clone.y);
      tracks.push(kill(enemy.npcId, x, y));
    }
  }
  // Creature 1003 has seven spawns; ten kills of it are adds, wherever they stood.
  for (let i = 0; i < 6; i++) tracks.push(kill(1003, 500 + i, 500));
  const fit = placeOnMdt(report(tracks), DUNGEON).floors[0]!;
  assert.equal(fit.observed, 12);
  assert.equal(fit.matched, 12);
});

test('players and the living are not kills', () => {
  const tracks: PositionTrack[] = [];
  for (const clone of DUNGEON.enemies[0]!.clones) {
    const { x, y } = worldOf(clone.x, clone.y);
    const alive = kill(1000, x, y);
    alive.deaths = [];
    tracks.push(alive);
    tracks.push({ ...kill(1000, x, y), kind: TrackKind.PARTY, npcId: -1 });
  }
  assert.deepEqual(placeOnMdt(report(tracks), DUNGEON).floors, []);
});

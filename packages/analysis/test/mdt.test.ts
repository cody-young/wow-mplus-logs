import assert from 'node:assert/strict';
import test from 'node:test';

import type { MdtDungeon, MdtFloorTransform } from '@mplus/data';

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
  // No real dungeon's id, so the shipped table has nothing for it.
  challengeModeId: 9999,
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
function kill(npcId: number, x: number, y: number, uiMapId = UI_MAP, ts = 1000, segmentId = 0): PositionTrack {
  return {
    actor: nextActor++,
    kind: TrackKind.ENEMY,
    name: String(npcId),
    npcId,
    segmentId,
    deaths: [5000],
    ts: Int32Array.of(ts),
    x: Float32Array.of(x),
    y: Float32Array.of(y),
    uiMapId: Uint16Array.of(uiMapId),
    hpPct: Uint8Array.of(100),
    home: { ts, x, y, uiMapId },
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
  assert.deepEqual(placeOnMdt(report(tracks), DUNGEON, []).floors, []);
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

/**
 * One creature on a regular lattice, killed in the middle of it: shifting the
 * whole run one spawn over matches every kill just as well, and nothing in the
 * run says which is right.
 */
function latticeRun(): { lattice: MdtDungeon; tracks: PositionTrack[] } {
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
  return { lattice, tracks };
}

/** The true transform as a shipped table row. */
const SHIPPED: MdtFloorTransform = { challengeModeId: DUNGEON.challengeModeId, uiMapId: UI_MAP, sublevel: 1, ...TRUTH };

test('a floor that fits two ways equally well is not trusted', () => {
  const { lattice, tracks } = latticeRun();
  const fit = placeOnMdt(report(tracks), lattice, []).floors[0]!;
  assert.ok(fit.rival >= fit.matched * 0.85, `${fit.matched} against ${fit.rival}`);
  assert.equal(fit.good, false);
  assert.equal(fit.fromTable, false);
});

test('a floor that fits two ways is settled by the shipped fit the run agrees with', () => {
  const { lattice, tracks } = latticeRun();
  const placement = placeOnMdt(report(tracks), lattice, [SHIPPED]);
  const fit = placement.floors[0]!;
  assert.equal(fit.good, true);
  assert.equal(fit.fromTable, true);
  assert.equal(fit.scale, TRUTH.scale);
  assert.equal(fit.matched, tracks.length);
  assert.equal(placement.matches.length, tracks.length);
});

test('a shipped fit the run contradicts is not used', () => {
  // As if MDT had redrawn the floor since the table was made: the shipped
  // fit lands the run's kills on nothing.
  const { lattice, tracks } = latticeRun();
  const stale = { ...SHIPPED, offsetX: SHIPPED.offsetX + 200 };
  const fit = placeOnMdt(report(tracks), lattice, [stale]).floors[0]!;
  assert.equal(fit.good, false);
  assert.equal(fit.fromTable, false);
});

test("a run's own good fit is kept over the shipped one", () => {
  // The kills of the first test, which fit well on their own.
  const tracks: PositionTrack[] = [];
  for (const enemy of DUNGEON.enemies) {
    for (const clone of enemy.clones.slice(0, 6)) {
      const { x, y } = worldOf(clone.x, clone.y);
      tracks.push(kill(enemy.npcId, x + wobble(tracks.length), y + wobble(tracks.length + 7)));
    }
  }
  const nudged = { ...SHIPPED, offsetX: SHIPPED.offsetX + 3 };
  const fit = placeOnMdt(report(tracks), DUNGEON, [nudged]).floors[0]!;
  assert.equal(fit.good, true);
  assert.equal(fit.fromTable, false);
});

test('a floor with too few kills to fit is placed by the shipped fit', () => {
  const tracks = DUNGEON.enemies[0]!.clones.slice(0, 4).map((clone, i) => {
    const { x, y } = worldOf(clone.x, clone.y);
    return kill(1000, x + wobble(i), y + wobble(i + 2));
  });
  const fit = placeOnMdt(report(tracks), DUNGEON, [SHIPPED]).floors[0]!;
  assert.equal(fit.good, true);
  assert.equal(fit.fromTable, true);
  assert.equal(fit.observed, 4);
});

/**
 * Nine packs of three, each a creature of its own at the pack's corners. Five
 * are pulled one at a time, a minute apart: the first mob stands on its spawn
 * and the other two are first seen a few seconds later, having run toward it
 * past the match radius.
 */
function packRun(gapMs: number): { packs: MdtDungeon; tracks: PositionTrack[] } {
  const corners = [
    [300, -200],
    [380, -230],
    [330, -320],
    [450, -280],
    [400, -380],
    [520, -210],
    [260, -400],
    [500, -420],
    [600, -330],
  ];
  const packs: MdtDungeon = {
    ...DUNGEON,
    enemies: [0, 1, 2].map((n) => ({
      index: n + 1,
      npcId: 3000 + n,
      name: `Pack Member ${n}`,
      count: 1,
      isBoss: false,
      clones: corners.map(([u, v], g) => ({
        index: g + 1,
        x: u! + (n === 1 ? 8 : 0),
        y: v! + (n === 2 ? 8 : 0),
        sublevel: 1,
        group: g + 1,
      })),
    })),
  };
  const tracks: PositionTrack[] = [];
  for (let g = 0; g < 5; g++) {
    for (const enemy of packs.enemies) {
      const clone = enemy.clones[g]!;
      const n = enemy.index - 1;
      // 16 MDT units off for the two that ran, each its own way.
      const angle = g * 1.3 + n * 2.1;
      const off = n === 0 ? 0 : 16;
      const { x, y } = worldOf(clone.x + off * Math.cos(angle), clone.y + off * Math.sin(angle));
      tracks.push(kill(enemy.npcId, x + wobble(tracks.length), y, UI_MAP, 60_000 * (g + 1) + n * gapMs, g));
    }
  }
  return { packs, tracks };
}

test('near misses the pull backs up settle a floor the plain fit cannot', () => {
  const { packs, tracks } = packRun(800);
  const placement = placeOnMdt(report(tracks), packs, []);
  const fit = placement.floors[0]!;
  assert.equal(fit.good, true, `${fit.matched} of ${fit.observed} against ${fit.rival}`);
  assert.equal(fit.byPacks, true);
  assert.equal(fit.matched, tracks.length);
  assert.ok(Math.abs(fit.scale - TRUTH.scale) < 0.03, `scale ${fit.scale}`);
  // Every kill on its own pack's spawn.
  for (const match of placement.matches) {
    const g = Math.floor(tracks.findIndex((track) => track.actor === match.actor) / 3) + 1;
    assert.equal(match.cloneIndex, g);
  }
});

test('near misses pulled apart from their pack are not backed up', () => {
  // The same kills, but each mob of a pack first seen ten seconds after the last.
  const { packs, tracks } = packRun(10_000);
  const fit = placeOnMdt(report(tracks), packs, []).floors[0]!;
  assert.equal(fit.good, false, `${fit.matched} of ${fit.observed} against ${fit.rival}`);
});

test('a pack one of whose mobs a pull took is filled from the rest of that pull', () => {
  // Every pack pulled on its own: two mobs on their spawns, the third gathered
  // 20 MDT units off, past the match radius.
  const { packs } = packRun(0);
  const tracks: PositionTrack[] = [];
  for (let g = 0; g < 8; g++) {
    for (const enemy of packs.enemies) {
      const clone = enemy.clones[g]!;
      const off = enemy.index === 3 ? 20 : 0;
      const { x, y } = worldOf(clone.x + off, clone.y - wobble(g));
      tracks.push(kill(enemy.npcId, x + wobble(tracks.length), y, UI_MAP, 60_000 * (g + 1), g));
    }
  }
  // A mob of the third pull's creature, killed in it but standing as close to
  // the ninth pack's spawn as the gathered ones stand to their own. The ninth
  // pack was never pulled, so it is no one's to fill.
  const ninth = packs.enemies[2]!.clones[8]!;
  const { x, y } = worldOf(ninth.x + 20, ninth.y);
  const stray = kill(3002, x, y, UI_MAP, 180_000, 2);
  tracks.push(stray);

  const placement = placeOnMdt(report(tracks), packs, []);
  const fit = placement.floors[0]!;
  assert.equal(fit.good, true, `${fit.matched} of ${fit.observed} against ${fit.rival}`);
  assert.equal(fit.byPacks, false);
  assert.equal(placement.matches.length, 24);
  for (const match of placement.matches) {
    const g = tracks.find((track) => track.actor === match.actor)!.segmentId;
    assert.equal(match.cloneIndex, g + 1);
  }
  assert.equal(
    placement.matches.some((match) => match.actor === stray.actor),
    false,
  );
});

test("a pack is one pull's, so a kill from another pull that lands on it is dropped", () => {
  const { packs } = packRun(0);
  const tracks: PositionTrack[] = [];
  for (let g = 0; g < 8; g++) {
    for (const enemy of packs.enemies) {
      const clone = enemy.clones[g]!;
      // The first pack's third mob a few steps off its spawn.
      const off = g === 0 && enemy.index === 3 ? 6 : 0;
      const { x, y } = worldOf(clone.x + off, clone.y);
      tracks.push(kill(enemy.npcId, x + wobble(tracks.length), y - wobble(tracks.length + 3), UI_MAP, 60_000 * (g + 1), g));
    }
  }
  // A mob of that creature from the third pull, standing right on the first
  // pack's spawn for it: closer than the first pull's own, but the rest of the
  // pack died in the first pull, so the spawn is the first pull's.
  const first = packs.enemies[2]!.clones[0]!;
  const { x, y } = worldOf(first.x, first.y);
  const late = kill(3002, x, y, UI_MAP, 200_000, 2);
  tracks.push(late);

  const placement = placeOnMdt(report(tracks), packs, []);
  assert.equal(placement.floors[0]!.good, true);
  const owner = placement.matches.find((match) => match.enemyIndex === 3 && match.cloneIndex === 1);
  assert.equal(tracks.find((track) => track.actor === owner?.actor)?.segmentId, 0);
  assert.equal(
    placement.matches.some((match) => match.actor === late.actor),
    false,
  );
});

test('what a pull took of a pack is placed, even when the rest of it is missing', () => {
  const { packs } = packRun(0);
  const tracks: PositionTrack[] = [];
  for (let g = 0; g < 8; g++) {
    for (const enemy of packs.enemies) {
      // The first pull has no kill of the first pack's third mob.
      if (g === 0 && enemy.index === 3) continue;
      const clone = enemy.clones[g]!;
      const { x, y } = worldOf(clone.x, clone.y);
      tracks.push(kill(enemy.npcId, x + wobble(tracks.length), y - wobble(tracks.length + 3), UI_MAP, 60_000 * (g + 1), g));
    }
  }

  // The two it has stand on their spawns, which nothing else can be.
  const placement = placeOnMdt(report(tracks), packs, []);
  assert.equal(placement.floors[0]!.good, true);
  assert.equal(placement.matches.length, 23);
  assert.deepEqual(
    placement.matches.filter((match) => match.cloneIndex === 1).map((match) => match.enemyIndex).sort(),
    [1, 2],
  );
});

test('a pack dragged into another pull is placed whole, and no kill twice', () => {
  // Every pack pulled on its own, but the first pull gathers the second pack
  // onto the first: its first mob is seen on its spawn, the other two only
  // once they stand among the first pack, 85 MDT units from their own.
  const { packs } = packRun(0);
  const tracks: PositionTrack[] = [];
  for (let g = 0; g < 8; g++) {
    for (const enemy of packs.enemies) {
      const dragged = g === 1 && enemy.index > 1;
      const clone = enemy.clones[dragged ? 0 : g]!;
      const { x, y } = worldOf(clone.x + (dragged ? 4 : 0), clone.y + (dragged ? 3 : 0));
      tracks.push(kill(enemy.npcId, x + wobble(tracks.length), y, UI_MAP, 60_000 * (g + 1), g === 1 ? 0 : g));
    }
  }

  const placement = placeOnMdt(report(tracks), packs, []);
  assert.equal(placement.floors[0]!.good, true);
  assert.equal(placement.matches.length, 24);
  assert.equal(new Set(placement.matches.map((match) => match.actor)).size, 24);
  assert.equal(new Set(placement.matches.map((match) => `${match.enemyIndex}:${match.cloneIndex}`)).size, 24);
  const second = placement.matches.filter((match) => match.cloneIndex === 2);
  assert.equal(second.length, 3);
  for (const match of second) assert.equal(tracks.find((track) => track.actor === match.actor)!.segmentId, 0);
});

test('a pack waits only on the creatures that die', () => {
  // A boss's adds that leave with it: in MDT's pack, never in the log.
  const { packs, tracks } = packRun(0);
  const adds = {
    index: 4,
    npcId: 3009,
    name: 'Departing Add',
    count: 0,
    isBoss: false,
    clones: [{ index: 1, x: 310, y: -210, sublevel: 1, group: 1 }],
  };
  const placement = placeOnMdt(report(tracks), { ...packs, enemies: [...packs.enemies, adds] }, []);
  assert.equal(placement.matches.length, tracks.length);
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

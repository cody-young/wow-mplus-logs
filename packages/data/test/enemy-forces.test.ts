import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_TABLE,
  db2DungeonCount,
  db2Dungeons,
  forcesFor,
  forcesFraction,
  type ForcesTable,
} from '../src/index.js';

/**
 * The generated table, which is the one the app actually ships.
 *
 * Asserted on by shape and by invariant rather than value by value: the
 * numbers change whenever Blizzard hotfixes a dungeon, and a test that has to
 * be edited every patch stops being read. The exception is King's Rest, which
 * is pinned deliberately — see below.
 */
test('the generated table covers the dungeons and nothing else', () => {
  const dungeons = db2Dungeons();
  assert.equal(dungeons.length, db2DungeonCount());
  assert.ok(dungeons.length > 60, `only ${dungeons.length} dungeons decoded`);

  const ids = new Set<number>();
  for (const dungeon of dungeons) {
    assert.ok(dungeon.challengeModeId > 0, `${dungeon.name} has no challenge-mode id`);
    assert.ok(!ids.has(dungeon.challengeModeId), `${dungeon.name} is listed twice`);
    ids.add(dungeon.challengeModeId);

    assert.ok(dungeon.total > 0, `${dungeon.name} has no requirement`);
    assert.ok(dungeon.name !== '', `${dungeon.challengeModeId} has no name`);
    assert.ok(dungeon.enemies.length > 0, `${dungeon.name} has no creatures`);
    // The generated table never carries a teleport: nothing in Blizzard's data
    // links a dungeon to a spell, so the desktop app fills these in from MDT.
    assert.equal(dungeon.teleportSpellId, 0);

    for (const enemy of dungeon.enemies) {
      assert.ok(Number.isInteger(enemy.npcId) && enemy.npcId > 0, `${dungeon.name} npc ${enemy.npcId}`);
      // Every row awards something. A creature worth nothing has no row, which
      // is what makes `of()` able to answer 0 for anything it has not heard of.
      assert.ok(enemy.count > 0, `${dungeon.name} npc ${enemy.npcId} is worth ${enemy.count}`);
    }
    // The non-kill award is a tolerance on the requirement, so one larger than
    // the requirement would switch the warning off entirely.
    assert.ok(dungeon.nonKillForces >= 0 && dungeon.nonKillForces < dungeon.total);
  }
});

/**
 * King's Rest, pinned, because it is the case that justifies the whole shape.
 *
 * A real +12 there timed with 584 of 608 counted from kills, which read as a
 * completed key at 96% until the criteria data explained it: 30 of the 608 are
 * awarded for a scenario objective, and the combat log never mentions one. Had
 * the table carried only kills, the only available conclusions would have been
 * "the table is stale" or "the app missed a kill", and both are wrong.
 */
test("King's Rest carries the objective award that explains a short count", () => {
  const kingsRest = db2Dungeons().find((dungeon) => dungeon.challengeModeId === 249);
  assert.notEqual(kingsRest, undefined);
  assert.equal(kingsRest!.total, 608);
  assert.equal(kingsRest!.nonKillForces, 30);
  assert.ok(584 + kingsRest!.nonKillForces >= kingsRest!.total, 'the real run has to reconcile');

  // Mchimba the Embalmer's trash mummy, at the value MDT agrees on. Its fight
  // variant (273050) has no criteria row at all and so is worth nothing.
  const byId = new Map(kingsRest!.enemies.map((enemy) => [enemy.npcId, enemy.count]));
  assert.equal(byId.get(270502), 7);
  assert.equal(byId.has(273050), false);
});

test('lookup is by challenge-mode id and misses are null', () => {
  const table: ForcesTable = { source: 'test', dungeons: db2Dungeons() };
  const forces = forcesFor(table, 249);
  assert.notEqual(forces, null);
  assert.equal(forces!.name, "Kings' Rest");
  assert.equal(forces!.total, 608);
  assert.equal(forces!.nonKillForces, 30);
  assert.equal(forces!.of(270502), 7);
  // A creature with no row is worth 0, not unknown: Blizzard lists only what
  // awards something, so "absent" and "worth nothing" are the same answer and
  // there is no third state for the UI to render.
  assert.equal(forces!.of(273050), 0);
  assert.equal(forces!.of(1), 0);

  // A dungeon the table does not cover, a nonsense id, and no table at all.
  assert.equal(forcesFor(table, 56), null, 'a pre-Legion challenge mode has no forces');
  assert.equal(forcesFor(table, -1), null);
  assert.equal(forcesFor(EMPTY_TABLE, 249), null);
});

test('a caller cannot mutate the cached table through the one it is handed', () => {
  // The desktop app writes teleport ids onto the dungeons it loads, so the
  // decode has to hand out its own copy or the second load inherits them.
  const first = db2Dungeons();
  first[0]!.teleportSpellId = 12345;
  first[0]!.enemies.length = 0;
  const second = db2Dungeons();
  assert.equal(second[0]!.teleportSpellId, 0);
  assert.ok(second[0]!.enemies.length > 0);
});

test('forces are a fraction of the requirement', () => {
  assert.equal(forcesFraction(400, 800), 0.5);
  // 0 rather than NaN, so a dungeon with no requirement renders as a blank.
  assert.equal(forcesFraction(0, 0), 0);
});

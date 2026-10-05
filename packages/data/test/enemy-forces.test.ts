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
  }
});

/**
 * King's Rest, pinned, because it is the case that justifies the whole shape.
 *
 * A real +12 there timed with 584 counted from kills, which read as a completed
 * key at 96% of 608. The dungeon does carry a 30-point `Criteria.Type 92`
 * child, and taking that off the requirement made the number look right for
 * the wrong reason: the 30 is the Shadow of Zul, which has a kill row of its
 * own. What the run was missing was the kill, not the requirement — the Shadow
 * is driven to 1 health and removed by script, so the log never reports it
 * dead. Credit it and the same run reads 614 of 608.
 */
test("King's Rest asks for all of its count, Shadow of Zul included", () => {
  const kingsRest = db2Dungeons().find((dungeon) => dungeon.challengeModeId === 249);
  assert.notEqual(kingsRest, undefined);
  assert.equal(kingsRest!.total, 608);
  const shadowOfZul = kingsRest!.enemies.find((enemy) => enemy.npcId === 138489);
  assert.equal(shadowOfZul?.count, 30, 'the 30 is a creature, not an objective');
  assert.ok(584 + 30 >= kingsRest!.total, 'the real run has to reconcile');

  // Mchimba the Embalmer's trash mummy, at the value MDT agrees on. Its fight
  // variant (273050) has no criteria row at all and so is worth nothing.
  const byId = new Map(kingsRest!.enemies.map((enemy) => [enemy.npcId, enemy.count]));
  assert.equal(byId.get(270502), 7);
  assert.equal(byId.has(273050), false);
});

/**
 * Ruby Life Pools, pinned, because its two rows are recovered rather than read.
 *
 * The 12.1 criteria data deleted the `CriteriaTree` nodes for npc 190034 and
 * npc 190206 and grew two `Criteria.Type 92` children worth exactly 25 and 7 —
 * the same creatures, addressed by something other than an npc id. Their
 * `Criteria` rows survive and still name them, so only the amounts had to come
 * from the last build that carried them. Without this the dungeon lost 163 of
 * reachable count and four timed keys read 77-82%.
 */
test('Ruby Life Pools keeps the two rows the 12.1 criteria data dropped', () => {
  const rubyLifePools = db2Dungeons().find((dungeon) => dungeon.challengeModeId === 399);
  assert.notEqual(rubyLifePools, undefined);
  assert.equal(rubyLifePools!.total, 551);
  const byId = new Map(rubyLifePools!.enemies.map((enemy) => [enemy.npcId, enemy.count]));
  assert.equal(byId.get(190034), 25, 'Blazebound Destroyer');
  assert.equal(byId.get(190206), 7, 'Ashseer Flamelasher');
});

test('lookup is by challenge-mode id and misses are null', () => {
  const table: ForcesTable = { source: 'test', dungeons: db2Dungeons() };
  const forces = forcesFor(table, 249);
  assert.notEqual(forces, null);
  assert.equal(forces!.name, "Kings' Rest");
  assert.equal(forces!.required, 608, 'kills have to supply the whole requirement');
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

test('forces are a fraction of what the kills have to supply', () => {
  assert.equal(forcesFraction(400, 800), 0.5);
  // Over 100% is allowed: a party that killed everything in a dungeon with an
  // objective earned more than its kills had to cover.
  assert.equal(forcesFraction(584, 578), 584 / 578);
  // 0 rather than NaN, so a dungeon with no requirement renders as a blank.
  assert.equal(forcesFraction(0, 0), 0);
});

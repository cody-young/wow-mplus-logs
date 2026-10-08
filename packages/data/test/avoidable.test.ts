import assert from 'node:assert/strict';
import test from 'node:test';

import {
  afterCasts,
  avoidable,
  avoidableDungeons,
  avoidableEntries,
  db2Dungeons,
  ownAuras,
} from '../src/index.js';

/**
 * This table is kept by hand, so these tests hold the mistakes hands make:
 * the same id filed twice, a dungeon id that is not one, a cast id where the
 * damage id belongs.
 */

test('every id appears once', () => {
  const seen = new Map<number, string>();
  for (const entry of avoidableEntries()) {
    const before = seen.get(entry.id);
    assert.equal(before, undefined, `${entry.id} ${entry.name} is in ${before} and ${entry.dungeon}`);
    seen.set(entry.id, entry.dungeon);
  }
});

test("every dungeon is one of Blizzard's challenge modes, under its own name", () => {
  const known = new Map(db2Dungeons().map((dungeon) => [dungeon.challengeModeId, dungeon.name]));
  for (const id of avoidableDungeons()) assert.ok(known.has(id), `challenge mode ${id} is not in the enemy-forces table`);
  for (const entry of avoidableEntries()) assert.equal(known.get(entry.challengeModeId), entry.dungeon);
});

test('the whole season is covered', () => {
  assert.equal(avoidableDungeons().size, 8);
});

test('a puddle counts and the slam that made it does not', () => {
  // Defiled Slam: the slam hits everyone, the detonations it leaves are the fail.
  assert.equal(avoidable(1294836)?.name, 'Defiled Detonation');
  assert.equal(avoidable(1294827), undefined);
  // Demonic Rage's chaos hit is unavoidable; its Burning Steps are not.
  assert.equal(avoidable(474234)?.name, 'Burning Steps');
  assert.equal(avoidable(474197), undefined);
});

test('a tank frontal is marked as one, and a ground effect is not', () => {
  assert.equal(avoidable(473898)?.tank, true, 'Legion Strike');
  assert.notEqual(avoidable(1215985)?.tank, true, 'Fel Beam');
});

test("a burst's own debuff is an aura, not a damage id on the list", () => {
  assert.deepEqual([...ownAuras()], [1308865]);
  for (const aura of ownAuras()) assert.equal(avoidable(aura), undefined);
});

test("a mechanic's cast is an enemy cast, not a damage id on the list", () => {
  assert.deepEqual([...afterCasts()], [1297797]);
  for (const cast of afterCasts()) assert.equal(avoidable(cast), undefined);
});

test('every entry says why', () => {
  for (const entry of avoidableEntries()) assert.ok(entry.why.length > 0, `${entry.id} ${entry.name}`);
});

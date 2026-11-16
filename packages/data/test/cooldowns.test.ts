import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HEALTH_POTION_MS,
  HEALTHSTONE_CHARGES,
  HEALTHSTONE_MS,
  defensiveClock,
  isBigDefensive,
  isHealthPotion,
  isHealthstone,
} from '../src/index.js';

test('big defensives come back on the clock the game gives them', () => {
  assert.deepEqual(defensiveClock(871), { ms: 180_000, charges: 1 }, 'Shield Wall');
  assert.deepEqual(defensiveClock(45438), { ms: 240_000, charges: 1 }, 'Ice Block');
  // The aura is not the button, so it borrows the button's clock.
  assert.deepEqual(defensiveClock(97463), { ms: 180_000, charges: 1 }, 'Rallying Cry');
});

test('every clocked spell is a big defensive, and an unknown one has no clock', () => {
  for (const id of [871, 45438, 97463, 48792, 642]) assert.ok(isBigDefensive(id), `${id}`);
  assert.equal(defensiveClock(100), null);
  // Renewing Blaze carries no clock in the data, and is not guessed at.
  assert.equal(defensiveClock(374349), null);
});

test('health potions are found by category, and a combat potion is not one', () => {
  assert.ok(isHealthPotion(1234768), 'Silvermoon Health Potion');
  assert.ok(isHealthPotion(1295247), 'Concentrated Silvermoon Health Potion');
  assert.ok(isHealthPotion(431416), 'Algari Healing Potion, last expansion');
  assert.ok(!isHealthPotion(1236994), 'Potion of Recklessness');
  assert.equal(HEALTH_POTION_MS, 300_000);
});

test('a healthstone is three uses on a minute', () => {
  assert.ok(isHealthstone(6262));
  assert.ok(isHealthstone(452930), "the warlock's own");
  assert.ok(!isHealthPotion(6262));
  assert.equal(HEALTHSTONE_MS, 60_000);
  assert.equal(HEALTHSTONE_CHARGES, 3);
});

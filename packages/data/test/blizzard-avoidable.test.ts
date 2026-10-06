import assert from 'node:assert/strict';
import test from 'node:test';

import { avoidableEntries, blizzardAvoidableCount, isBlizzardAvoidable } from '../src/index.js';

/**
 * Blizzard's avoidable flag, read off SpellMisc. Nobody maintains its
 * contents; these hold the reading that produced it.
 */

test('the flag is on puddles, beams and death explosions', () => {
  assert.ok(isBlizzardAvoidable(1294836), 'Defiled Detonation');
  assert.ok(isBlizzardAvoidable(474234), 'Burning Steps');
  assert.ok(isBlizzardAvoidable(1215985), 'Fel Beam');
});

test('the flag is off a party-wide pulse and off player spells', () => {
  assert.ok(!isBlizzardAvoidable(383925), 'Chillstorm');
  assert.ok(!isBlizzardAvoidable(133), 'Fireball');
  assert.ok(!isBlizzardAvoidable(0), 'melee');
});

test('the flag agrees with most of the hand-kept list', () => {
  // 91 of 117 when the bit was found. A big drop means the bit moved, not
  // that the list got worse overnight.
  const entries = avoidableEntries();
  const agree = entries.filter((entry) => isBlizzardAvoidable(entry.id)).length;
  assert.ok(agree / entries.length > 0.6, `${agree} of ${entries.length}`);
  assert.ok(blizzardAvoidableCount() > 500);
});

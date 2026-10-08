import assert from 'node:assert/strict';
import test from 'node:test';

import { procCount, procsPerMinute } from '../src/index.js';

/**
 * Generated like the other spell tables, so what these hold is the join that
 * produced it: the spell the log shows, linked back through its passive's
 * trigger aura to a rate.
 */

test('the procs a key actually shows are in the table, at their rate', () => {
  // Weapon enchants, read off a real evening of keys, where each landed close
  // to three a minute on every player who had one.
  const procs: [number, string][] = [
    [1241715, 'Might of the Void'],
    [1241761, 'Precision of the Dragonhawk'],
    [1241762, 'Frenzied Focus'],
    [1297663, "Halazzi's Rite"],
  ];
  for (const [spellId, name] of procs) {
    assert.equal(procsPerMinute(spellId, 7, 264), 3, `${name} (${spellId}) procs three times a minute`);
  }
});

test('a spell that is pressed, not procced, has no rate', () => {
  assert.equal(procsPerMinute(2825, 7, 264), 0, 'Bloodlust');
  assert.equal(procsPerMinute(1766, 4, 259), 0, 'Kick');
});

test('the table is not empty', () => {
  assert.ok(procCount() > 500);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { Defense, defenseKinds, defensiveCount, isDefensive } from '../src/index.js';

/**
 * The defensive table is generated from Blizzard's effect data, so there is no
 * point asserting its contents line by line — it is rebuilt wholesale every
 * patch and the point of generating it is that nobody maintains the contents.
 *
 * What these tests hold is the shape of the thing: the decoder round-trips, the
 * classification agrees with the game for spells whose behaviour is not in
 * dispute, and the famous noise stays out. A patch that reshuffles aura
 * numbering would break all of them at once, which is the alarm worth having.
 */

test('the table decodes to something the size of the game', () => {
  const size = defensiveCount();
  // Generated at ~9k. A table an order of magnitude off either way means the
  // aura list stopped matching the data rather than the game having changed.
  assert.ok(size > 3000 && size < 40000, `table holds ${size} spells`);
});

test('spells are filed by what they actually do', () => {
  // Each of these is the witness for one aura type in scripts/spell-effects.mjs:
  // if the classification drifts, the one that moved is named in the failure.
  const cases: [number, string, number][] = [
    [17, 'Power Word: Shield', Defense.ABSORB],
    [871, 'Shield Wall', Defense.REDUCTION],
    [642, 'Divine Shield', Defense.IMMUNITY],
    [5277, 'Evasion', Defense.AVOIDANCE],
    [12975, 'Last Stand', Defense.HEALTH],
    [6940, 'Blessing of Sacrifice', Defense.SHARED],
  ];
  for (const [spellId, name, kind] of cases) {
    assert.ok((defenseKinds(spellId) & kind) !== 0, `${name} (${spellId}) should be filed under ${kind}`);
  }
});

test('a spell can do more than one thing', () => {
  // Demon Spikes parries and reduces; the mask has to hold both rather than
  // whichever effect the generator happened to read last.
  const spikes = defenseKinds(203819);
  assert.ok((spikes & Defense.AVOIDANCE) !== 0 && (spikes & Defense.REDUCTION) !== 0, `Demon Spikes reads ${spikes}`);
});

test('defensives Blizzard implements as a script are still found', () => {
  // Survival Instincts carries its 50% as SPELL_AURA_DUMMY, so no reading of
  // the effect data can see it. It is in the generator's short hand-held list,
  // and that list existing is the reason this test does.
  assert.ok(isDefensive(61336), 'Survival Instincts is a defensive');
});

test('the noise a real key is full of stays out', () => {
  // Every one of these landed on a player in a logged key. They are why the
  // lane is filtered at all: none of them does anything about damage.
  const noise: [number, string][] = [
    [48107, 'Heating Up'],
    [48108, 'Hot Streak!'],
    [61295, 'Riptide'],
    [1459, 'Arcane Intellect'],
    [2983, 'Sprint'],
  ];
  for (const [spellId, name] of noise) {
    assert.equal(isDefensive(spellId), false, `${name} (${spellId}) is not a defensive`);
  }
});

test('a spell the table has never heard of is not a defensive', () => {
  // The safe way round: a spell added after the table was generated reads as
  // not defensive, so a new patch shortens the lane rather than filling it.
  assert.equal(defenseKinds(999_999_999), 0);
  assert.equal(isDefensive(0), false);
});

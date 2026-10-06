import assert from 'node:assert/strict';
import test from 'node:test';

import { dispelCount, enrageCount, isDispel, isEnrage } from '../src/index.js';

/**
 * Like the other generated tables, nobody maintains this one's contents. What
 * these tests hold is the rule that produced it: a dispel is a spell carrying
 * the dispel effect, and a soothe is decided by the aura that came off.
 *
 * Every id below was read off a real combat log, as the spell named on a
 * SPELL_DISPEL or SPELL_STOLEN line.
 */

test('the dispels a party presses are in the table', () => {
  const dispels: [number, string][] = [
    [370, 'Purge'],
    [378773, 'Greater Purge'],
    [528, 'Dispel Magic'],
    [30449, 'Spellsteal'],
    [19505, 'Devour Magic'],
    [278326, 'Consume Magic'],
    [2908, 'Soothe'],
    [19801, 'Tranquilizing Shot'],
    [5938, 'Shiv'],
    [406971, 'Oppressing Roar'],
    [4987, 'Cleanse'],
    [115450, 'Detox'],
    [77130, 'Purify Spirit'],
    [527, 'Purify'],
    [2782, 'Remove Corruption'],
    [365585, 'Expunge'],
    [475, 'Remove Curse'],
    [115310, 'Revival'],
    [32375, 'Mass Dispel'],
    [383015, 'Poison Cleansing'],
    [374251, 'Cauterizing Flame'],
  ];
  for (const [spellId, name] of dispels) {
    assert.ok(isDispel(spellId), `${name} (${spellId}) is a dispel`);
  }
});

test('a root-breaker the log calls a dispel is not one', () => {
  // Each of these is written to the log as SPELL_DISPEL when it removes a
  // root or a snare, and none carries the dispel effect.
  const breakers: [number, string][] = [
    [768, 'Cat Form'],
    [5487, 'Bear Form'],
    [781, 'Disengage'],
    [116841, "Tiger's Lust"],
    [48020, 'Demonic Circle: Teleport'],
    [357148, "Master's Call"],
    [199508, 'Spreading The Word: Freedom'],
  ];
  for (const [spellId, name] of breakers) {
    assert.ok(!isDispel(spellId), `${name} (${spellId}) only breaks free, it does not dispel`);
  }
});

test('enrage is a property of the aura, not of the button', () => {
  // Soothe and Tranquilizing Shot are dispels, not enrages: the table is asked
  // about what came off. An ordinary magic buff is not an enrage either.
  assert.ok(!isEnrage(2908), 'Soothe itself is not an enrage');
  assert.ok(!isEnrage(19801), 'Tranquilizing Shot itself is not an enrage');
  assert.ok(!isEnrage(17), 'Power Word: Shield is magic, not an enrage');
  assert.ok(isEnrage(18499), 'Berserker Rage is an enrage');
});

test('neither table is empty', () => {
  assert.ok(dispelCount() > 200);
  assert.ok(enrageCount() > 500);
});

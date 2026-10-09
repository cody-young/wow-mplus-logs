import assert from 'node:assert/strict';
import test from 'node:test';

import { Control, controlCount, controlKinds, isCrowdControl } from '../src/index.js';

/**
 * Like the other generated tables, nobody maintains this one's contents. What
 * these tests hold is the rule that produced it: the seven auras that mean a
 * unit is not fighting are in, slows are out, and the aura numbers are the
 * ones the witnesses actually carry.
 *
 * Every id below is an aura as a real combat log reports it on
 * SPELL_AURA_APPLIED, which is very often not the id of the button: Polymorph
 * is pressed as 118 and lands as 28271, Fists of Fury as 117418 and lands as
 * 120086, Fear as 5782 and lands as 118699. The aura is what the table is
 * asked about, so the aura is what is tested — and getting one of these wrong
 * is the likeliest way to misread the table as broken.
 */

test('the control a party presses in a key is in the table', () => {
  const cc: [number, string, number][] = [
    [853, 'Hammer of Justice', Control.STUN],
    [119381, 'Leg Sweep', Control.STUN],
    [179057, 'Chaos Nova', Control.STUN],
    [30283, 'Shadowfury', Control.STUN],
    [118905, 'Capacitor Totem', Control.STUN],
    [120086, 'Fists of Fury', Control.STUN],
    [221562, 'Asphyxiate', Control.STUN],
    [28271, 'Polymorph', Control.DISORIENT],
    [105421, 'Blinding Light', Control.DISORIENT],
    [207167, 'Blinding Sleet', Control.DISORIENT],
    [8122, 'Psychic Scream', Control.FEAR],
    [118699, 'Fear', Control.FEAR],
    [5484, 'Howl of Terror', Control.FEAR],
    [15487, 'Silence', Control.SILENCE],
    [374776, 'Tightening Grasp', Control.SILENCE],
    [339, 'Entangling Roots', Control.ROOT],
    [122, 'Frost Nova', Control.ROOT],
  ];
  for (const [spellId, name, kind] of cc) {
    assert.ok(
      (controlKinds(spellId) & kind) !== 0,
      `${name} (${spellId}) is control of kind ${kind}, got ${controlKinds(spellId)}`,
    );
  }
});

test('the second stun and root auras are not spare', () => {
  // Asphyxiate carries 298 and Entangling Roots carries 455, each with no
  // other control aura at all. Dropping either number loses the spell
  // outright, which is why both are in the generator's list.
  assert.equal(controlKinds(221562), Control.STUN, 'Asphyxiate is a stun through aura 298 alone');
  assert.equal(controlKinds(339), Control.ROOT, 'Entangling Roots is a root through aura 455 alone');
});

test('a spell that does two things to a unit says both', () => {
  // Blinding Sleet disorients and slows. The slow is not in the table at all,
  // so what comes back is the disorient — and the mask is a mask because
  // Cyclone-shaped spells really do carry more than one kind.
  assert.equal(controlKinds(207167) & Control.DISORIENT, Control.DISORIENT);
});

test('a slow is not crowd control', () => {
  // The decision the whole table turns on. These three were the top of the
  // chart on a real evening of keys when MOD_DECREASE_SPEED was included, and
  // not one of them is a press: a paladin standing in their own Consecration
  // is not controlling anything.
  assert.equal(isCrowdControl(204242), false, 'Consecration is not control');
  assert.equal(isCrowdControl(273977), false, 'Grip of the Dead is not control');
  assert.equal(isCrowdControl(370898), false, 'Permeating Chill is not control');
});

test('a knockback is control, read off its effect rather than an aura', () => {
  // A knockback writes no aura, so the seven aura numbers never saw one.
  // These carry KNOCK_BACK (98) or KNOCK_BACK_DEST (144) and nothing the aura
  // half of the table knows, which is why each is a knockback and only that.
  const knockbacks: [number, string][] = [
    [157980, 'Supernova'],
    [51490, 'Thunderstorm'],
    [61391, 'Typhoon'],
    [357214, 'Wing Buffet'],
    [368970, 'Tail Swipe'],
  ];
  for (const [spellId, name] of knockbacks) {
    assert.equal(controlKinds(spellId), Control.KNOCKBACK, `${name} (${spellId}) is a knockback`);
  }
});

test('the table is the size of the game, not of a spec', () => {
  const size = controlCount();
  // Generated at 11,995: the player buttons plus every NPC spell that shares
  // the auras, which is most of it — a boss stun is in here too, and the
  // pairing in `crowdControlReport` is what keeps it out of the party's chart.
  assert.ok(size > 2000 && size < 60_000, `table holds ${size} spells`);
});

test('a spell the table has never heard of is not control', () => {
  // The safe way round: control added after this file was generated reads as
  // an ordinary debuff, so it goes uncounted rather than counted wrong.
  assert.equal(isCrowdControl(999_999_999), false);
  assert.equal(isCrowdControl(0), false);
});

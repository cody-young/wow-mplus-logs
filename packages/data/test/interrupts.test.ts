import assert from 'node:assert/strict';
import test from 'node:test';

import { interruptCount, isInterrupt } from '../src/index.js';

/**
 * Like the defensive table, this one is generated and nobody maintains its
 * contents. What these tests hold is the rule that produced it: every button a
 * party presses is in, every spell that merely happens to interrupt is out, and
 * the hand-held entries for the ones Blizzard scripted are still there.
 */

test('every interrupt a party actually presses is in the table', () => {
  // One per class that brings one, each read off a real log as the cast that
  // preceded a SPELL_INTERRUPT. A patch that reshuffles effect numbering drops
  // all of them at once, which is the alarm worth having.
  const buttons: [number, string][] = [
    [1766, 'Kick'],
    [6552, 'Pummel'],
    [2139, 'Counterspell'],
    [47528, 'Mind Freeze'],
    [57994, 'Wind Shear'],
    [183752, 'Disrupt'],
    [351338, 'Quell'],
    [96231, 'Rebuke'],
    [116705, 'Spear Hand Strike'],
    [147362, 'Counter Shot'],
    [19647, 'Spell Lock'],
  ];
  for (const [spellId, name] of buttons) {
    assert.ok(isInterrupt(spellId), `${name} (${spellId}) is an interrupt`);
  }
});

test('an interrupt the game implements as a script is still found', () => {
  // Skull Bash is a DUMMY in the effect data and the interrupt lands under a
  // different id entirely (93985), so no reading of the data can see it. It is
  // in the generator's short hand-held list, and that list existing is the
  // reason this test does.
  assert.ok(isInterrupt(106839), 'Skull Bash is an interrupt');
  assert.ok(isInterrupt(78675), 'Solar Beam is an interrupt');
});

test('an ability that interrupts as a side effect is not an interrupt button', () => {
  // Avenger's Shield carries the interrupt effect and is pressed on cooldown
  // for its damage. Counting its casts as attempts would report a protection
  // paladin whiffing a hundred interrupts a key, which is the whole reason the
  // table is "does nothing else" rather than "interrupts".
  assert.equal(isInterrupt(31935), false, "Avenger's Shield is not an interrupt button");
  // The command the warlock presses to make the pet cast Spell Lock. The pet's
  // own cast is the press, and counting both would double every one of them.
  assert.equal(isInterrupt(119910), false, 'Command Demon is not the press');
});

test('the table is the size of the game, not of a spec', () => {
  const size = interruptCount();
  // Generated at 141: the player buttons plus the NPC spells that share the
  // effect. An order of magnitude either way means the rule stopped matching
  // the data.
  assert.ok(size > 30 && size < 2000, `table holds ${size} spells`);
});

test('a spell the table has never heard of is not an interrupt', () => {
  // The safe way round: an interrupt added after this file was generated reads
  // as an ordinary cast, so its presses go uncounted rather than counted wrong.
  assert.equal(isInterrupt(999_999_999), false);
  assert.equal(isInterrupt(0), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { buttonCount, isButton } from '../src/index.js';

/**
 * The button table says one thing: the game puts a clock on this spell, so
 * somebody had to press it.
 *
 * Like the other generated tables, nobody maintains its contents — what these
 * tests hold is the rule that produced it. The dangerous direction here is a
 * real button reading as a proc, because the cost is a missing line in the
 * recap of the death it was pressed in, so the first test is the one to watch.
 */

test('every shape of button the game has is in the table', () => {
  // One per clock, each read off SpellCooldowns/SpellCategories rather than
  // trusted from memory. A press that carries only one of the three is exactly
  // what a careless rule drops, so none of these has a spare.
  for (const [id, name] of [
    [383328, 'Final Verdict — the global cooldown'],
    [1329, 'Mutilate — the global cooldown'],
    [48792, 'Icebound Fortitude — off the GCD, its own 2 minutes'],
    [47528, 'Mind Freeze — 15s on its category, nothing on the spell'],
    [96231, 'Rebuke — the same shape'],
    [108853, 'Fire Blast — a pool of charges'],
    [43265, 'Death and Decay — a GCD and charges'],
    [17, 'Power Word: Shield'],
    [642, 'Divine Shield'],
    [633, 'Lay on Hands'],
    [361469, 'Living Flame'],
    [357208, 'Fire Breath — empowered, a 500ms GCD'],
  ] as const) {
    assert.equal(isButton(id), true, `${id} ${name}`);
  }
});

test('a proc the log reports as a cast is not a button', () => {
  // Every one of these was witnessed in a real log as SPELL_CAST_SUCCESS under
  // a player's own name, which is why the recap needed this table at all.
  for (const [id, name] of [
    [408385, 'Crusading Strikes — an auto-attack, 258 casts in one arena'],
    [370454, 'Charged Blast — an evoker buff'],
    [27576, "Mutilate — the off-hand half of 1329's one press"],
    [452538, 'Fatebound Coin (Tails) — a coin flip, 66 casts'],
    [1223412, 'Soul Fragment — picking one up, 637 casts'],
    [126664, 'Charge — the triggered half, logged beside the press'],
    [52174, 'Heroic Leap — the same shape'],
  ] as const) {
    assert.equal(isButton(id), false, `${id} ${name}`);
  }
});

test('a spell newer than the table reads as a button', () => {
  // The safe way round, and the reason the table carries a frontier at all.
  // Spell ids are handed out in order, so an id above the highest the build had
  // belongs to a patch this file has never seen: calling it a proc would hide a
  // brand-new defensive from the recap of the death it was pressed in.
  assert.equal(isButton(99_999_999), true);
  // Below the frontier the table is the whole answer, and 0 is not a spell.
  assert.equal(isButton(0), false);
});

test('the table is the size of the game, not of a spec', () => {
  const size = buttonCount();
  // Generated at 40k: every clocked spell in the game, players and NPCs alike.
  // An order of magnitude either way means a column stopped meaning what it
  // used to and the rule needs re-reading.
  assert.ok(size > 5000 && size < 150000, `table holds ${size} spells`);
});

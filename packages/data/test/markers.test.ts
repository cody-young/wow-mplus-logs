import assert from 'node:assert/strict';
import test from 'node:test';

import { inertCount, isInertMarker } from '../src/index.js';

/**
 * The marker table says one thing: the game's data gives this spell no effect.
 *
 * The witnesses below are all spells whose nature is not in dispute — five
 * cooldown notes the player puts on themselves, and five mechanics that killed
 * somebody in a real key. The dangerous direction is a real mechanic reading as
 * inert, so the second group matters more than the first.
 */

test('the table decodes to something the size of the game', () => {
  const size = inertCount();
  // Generated at ~50k: most of the game's scripted spells land here, which is
  // the point of the warning in markers.ts. An order of magnitude off either
  // way means the effect columns stopped meaning what they used to.
  assert.ok(size > 10000 && size < 150000, `table holds ${size} spells`);
});

test("the game's own notes to itself are inert", () => {
  // Each of these was read out of SpellEffect.db2 and carries exactly one
  // effect row: APPLY_AURA / SPELL_AURA_DUMMY, triggering nothing.
  for (const [id, name] of [
    [57724, 'Sated — had Bloodlust'],
    [57723, 'Exhaustion — had Heroism'],
    [80354, 'Temporal Displacement — had Time Warp'],
    [264689, 'Fatigued — had Primal Rage'],
    [41425, 'Hypothermia — Ice Block is on cooldown'],
    [87024, 'Cauterized — Cauterize is on cooldown'],
    [45181, 'Cheated Death — Cheat Death is on cooldown'],
    [113942, 'Demonic Gateway — this one is spent'],
  ] as const) {
    assert.equal(isInertMarker(id), true, `${id} ${name}`);
  }
});

test('mechanics that have killed somebody are not inert', () => {
  // Every one of these is a debuff from one logged Kings' Rest key, and every
  // one has a real aura in the data: fear, bleed, damage amplification, a
  // health-pool cut. If any of these ever reads as inert the rule is wrong.
  for (const [id, name] of [
    [276031, 'Pit of Despair — MOD_FEAR'],
    [270003, 'Suppression Slam'],
    [1302028, 'Soul Crush — MOD_DAMAGE_PERCENT_TAKEN'],
    [1297918, 'Mortal Bleed — periodic damage'],
    [267626, 'Desiccation — stat and healing cuts'],
    [269936, 'Fixate — MOD_FIXATE'],
    [111400, 'Burning Rush — drains the caster'],
  ] as const) {
    assert.equal(isInertMarker(id), false, `${id} ${name}`);
  }
});

test('an unknown spell reads as doing something', () => {
  // The safe way round: a spell added after the table was generated shows up in
  // the chart rather than being silently dropped from it.
  assert.equal(isInertMarker(0), false);
  assert.equal(isInertMarker(99999999), false);
});

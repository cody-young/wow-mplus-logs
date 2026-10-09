import assert from 'node:assert/strict';
import test from 'node:test';

import { castingCounts, channelMs, gcdMs } from '../src/index.js';

/**
 * The casting table says how long a press holds a player up before haste.
 * Generated like the others, so what these hold is the rule: the GCD column
 * means what Active % takes it to mean, and the channel bits find channels.
 */

test('a press reads its own global cooldown', () => {
  for (const [id, ms, name] of [
    [116, 1500, 'Frostbolt'],
    [61295, 1500, 'Riptide'],
    [1329, 1000, 'Mutilate — an energy GCD'],
    [357208, 500, 'Fire Breath — empowered'],
    [100780, 1500, "Tiger Palm — 1s for a Windwalker, but by a passive the table can't see"],
  ] as const) {
    assert.equal(gcdMs(id), ms, `${id} ${name}`);
  }
});

test('what is off the global cooldown reads 0', () => {
  for (const [id, name] of [
    [47528, 'Mind Freeze'],
    [31884, 'Avenging Wrath'],
    [1223412, 'Soul Fragment — a proc the log reports as a cast'],
    [99_999_999, 'a spell newer than the table'],
  ] as const) {
    assert.equal(gcdMs(id), 0, `${id} ${name}`);
  }
});

test('channels have a length, and casts and instants are not channels', () => {
  assert.equal(channelMs(15407), 4500, 'Mind Flay');
  assert.equal(channelMs(740), 6000, 'Tranquility');
  assert.equal(channelMs(473728), 3000, 'Void Ray');
  assert.equal(channelMs(116), -1, 'Frostbolt');
  assert.equal(channelMs(1329), -1, 'Mutilate');
});

test('the tables are the size of the game', () => {
  const { gcds, channels } = castingCounts();
  // 15k and 945 when generated. An order of magnitude off means a column moved.
  assert.ok(gcds > 3000 && gcds < 60000, `${gcds} gcds`);
  assert.ok(channels > 100 && channels < 5000, `${channels} channels`);
});

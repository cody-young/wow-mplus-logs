import assert from 'node:assert/strict';
import test from 'node:test';

import { LogSession } from '@mplus/parser';

import { buildSegments, contextFor, deathReports, type DeathNarc } from '../src/index.js';
import { DPS, HEALER, LINES, TANK, at, aura, cast, died } from './fixture.js';

/**
 * The narc in a key of its own, long enough for a potion to come back: the
 * fixture's party, a warlock when asked for, and whatever happened, read at
 * each death in order.
 */
const LOCK = 'Player-1-00000009';
const STATS = '0,1,1,1,1,1,0,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1';
const TAIL = '[(1,1)],[],[],[],[],1,0,0,0';

function narcs(lines: string[], warlock = false): DeathNarc[] {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      LINES[0]!,
      LINES[1]!,
      ...LINES.filter((line) => line.includes('COMBATANT_INFO')),
      ...(warlock ? [`${at(1)}  COMBATANT_INFO,${LOCK},${STATS},266,${TAIL}`] : []),
      ...lines,
      `${at(1000)}  CHALLENGE_MODE_END,2000,1,15,1000000,100`,
    ].join('\n') + '\n',
  );
  session.end();
  const context = contextFor(session, session.runs[0]!);
  return deathReports(context, buildSegments(context)).map((death) => death.narc);
}

const potion = (seconds: number, src = DPS, name = 'Dee') => cast(seconds, src, name, 1234768, 'Silvermoon Health Potion');
const stone = (seconds: number, src = DPS, name = 'Dee') => cast(seconds, src, name, 6262, 'Healthstone');
const shieldWall = (seconds: number) => aura(seconds, TANK, 'Tank', TANK, 'Tank', 871, 'Shield Wall', true, { buff: true, dstFlags: '0x511' });

test('a potion is ready until drunk, pressed in the window, and back after five minutes', () => {
  const [never, pressed, cooling, back] = narcs([
    died(20, DPS, 'Dee'),
    potion(100),
    died(105, DPS, 'Dee'),
    died(300, DPS, 'Dee'),
    died(401, DPS, 'Dee'),
  ]);
  assert.deepEqual(never!.potion, { state: 'ready', lastUsedTs: null });
  assert.equal(pressed!.potion.state, 'pressed');
  assert.equal(cooling!.potion.state, 'cooldown');
  assert.equal(back!.potion.state, 'ready');
  assert.equal(back!.potion.lastUsedTs, 100_000);
});

test('a combat potion does not lock out a health potion', () => {
  const [death] = narcs([cast(50, DPS, 'Dee', 1236994, 'Potion of Recklessness'), died(80, DPS, 'Dee')]);
  assert.equal(death!.potion.state, 'ready');
});

test('no warlock, no healthstone to hold against anyone', () => {
  const [death] = narcs([died(20, DPS, 'Dee')]);
  assert.equal(death!.healthstone, null);
});

test('a healthstone is three uses, and a Soulwell hands out another', () => {
  const [ready, cooling, empty, restocked] = narcs(
    [
      died(20, DPS, 'Dee'),
      stone(100),
      died(150, DPS, 'Dee'),
      stone(200),
      stone(300),
      died(400, DPS, 'Dee'),
      cast(500, LOCK, 'Lock', 29893, 'Create Soulwell'),
      died(600, DPS, 'Dee'),
    ],
    true,
  );
  assert.equal(ready!.healthstone?.state, 'ready');
  assert.equal(cooling!.healthstone?.state, 'cooldown');
  assert.equal(empty!.healthstone?.state, 'empty');
  assert.equal(restocked!.healthstone?.state, 'ready');
});

test('a big defensive is only theirs once seen, and ready when its clock has run', () => {
  const [unseen, cooling, ready] = narcs([
    died(20, HEALER, 'Heals'),
    shieldWall(100),
    died(200, TANK, 'Tank'),
    died(300, TANK, 'Tank'),
  ]);
  assert.deepEqual(unseen!.defensives, [], "the healer has no Shield Wall");
  assert.deepEqual(
    cooling!.defensives.map((entry) => [entry.name, entry.state]),
    [['Shield Wall', 'cooldown']],
  );
  assert.deepEqual(
    ready!.defensives.map((entry) => [entry.name, entry.state]),
    [['Shield Wall', 'ready']],
  );
});

test('a defensive is ready before its first use, if the run shows they have it', () => {
  const [before] = narcs([died(50, TANK, 'Tank'), shieldWall(100)]);
  assert.deepEqual(
    before!.defensives.map((entry) => [entry.name, entry.state, entry.lastUsedTs]),
    [['Shield Wall', 'ready', null]],
  );
});

test('a defensive that cannot be cast on yourself is not held against you', () => {
  const [death] = narcs([
    aura(50, HEALER, 'Heals', TANK, 'Tank', 6940, 'Blessing of Sacrifice', true, { buff: true, dstFlags: '0x511' }),
    died(400, HEALER, 'Heals'),
  ]);
  assert.deepEqual(death!.defensives, []);
});

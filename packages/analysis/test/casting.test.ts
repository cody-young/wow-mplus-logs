import assert from 'node:assert/strict';
import test from 'node:test';

import { LogSession } from '@mplus/parser';

import { buildSegments, castingReport, contextFor, type CastingActor } from '../src/index.js';
import { DPS, LINES, at, aura, cast, castStart, creature, died, hit, interrupt } from './fixture.js';

/**
 * A key of its own, 100 seconds long, with only what one player cast in it.
 * The spell ids are real, because the GCD and channel tables are keyed on them:
 * Riptide is an instant on a 1.5s GCD, Lava Burst a hard cast, Mind Flay a
 * channel and Wind Shear off the GCD.
 */
const RIPTIDE = [61295, 'Riptide'] as const;
const LAVA_BURST = [51505, 'Lava Burst'] as const;
const MIND_FLAY = [15407, 'Mind Flay'] as const;
const WIND_SHEAR = [57994, 'Wind Shear'] as const;
const ENEMY = creature(1000, 1);

function key(lines: string[]): CastingActor {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      LINES[0]!,
      LINES[1]!,
      ...LINES.filter((line) => line.includes('COMBATANT_INFO')),
      hit(1, DPS, 'Dee', ENEMY, 'Gnoll', 1000),
      ...lines,
      `${at(100)}  CHALLENGE_MODE_END,2000,1,15,100000,100`,
    ].join('\n') + '\n',
  );
  session.end();
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  const report = castingReport(context, buildSegments(context));
  return report.actors.find((actor) => actor.name.startsWith('Dee'))!;
}

const started = (seconds: number, spell: readonly [number, string]): string =>
  castStart(seconds, DPS, 'Dee', ...spell, { srcFlags: '0x511' });
const failed = (seconds: number, spell: readonly [number, string], reason: string): string =>
  `${at(seconds)}  SPELL_CAST_FAILED,${DPS},"Dee",0x511,0x0,0000000000000000,nil,0x80000000,0x0,${spell[0]},"${spell[1]}",0x4,"${reason}"`;

test('every cast that landed is a press, however fast they came', () => {
  // A second apart, as at 50% haste.
  const dee = key([10, 11, 12, 13, 14].map((seconds) => cast(seconds, DPS, 'Dee', ...RIPTIDE)));
  assert.equal(dee.presses, 5);
});

test('a press off the global cooldown counts too, but a proc is not a press', () => {
  const dee = key([
    cast(50, DPS, 'Dee', ...RIPTIDE),
    // A talent's free Riptide, logged beside the press.
    cast(50.01, DPS, 'Dee', ...RIPTIDE),
    cast(60, DPS, 'Dee', ...WIND_SHEAR),
  ]);
  assert.equal(dee.presses, 2);
});

test('a hard cast is one bar and one press', () => {
  const dee = key([
    // A 2.2s Lava Burst, then one that went instant: START and SUCCESS together.
    started(50, LAVA_BURST),
    cast(52.2, DPS, 'Dee', ...LAVA_BURST),
    started(60, LAVA_BURST),
    cast(60, DPS, 'Dee', ...LAVA_BURST),
  ]);
  assert.deepEqual(
    dee.bars.map((bar) => [bar.start, bar.end, bar.finished]),
    [
      [50_000, 52_200, true],
      [60_000, 60_000, true],
    ],
  );
  assert.equal(dee.presses, 2);
  assert.equal(dee.cancelled, 0);
});

test('an abandoned cast counts, a refused press does not, and a kick is not the player\u2019s', () => {
  const dee = key([
    // "Not yet recovered" with no bar open is the game turning a press down.
    failed(40, LAVA_BURST, 'Not yet recovered'),
    // Moved 0.8s in.
    started(50, LAVA_BURST),
    failed(50.8, LAVA_BURST, "Can't do that while moving"),
    // Kicked 1.2s in.
    started(60, LAVA_BURST),
    interrupt(61.2, ENEMY, 'Gnoll', DPS, 'Dee', 1766, 'Kick', LAVA_BURST[0], LAVA_BURST[1], {
      srcFlags: '0xa48',
      dstFlags: '0x511',
    }),
    failed(61.2, LAVA_BURST, 'Interrupted'),
  ]);
  assert.equal(dee.cancelled, 1);
  assert.deepEqual(
    dee.bars.map((bar) => [bar.start, bar.end, bar.finished, bar.kicked]),
    [
      [50_000, 50_800, false, false],
      [60_000, 61_200, false, true],
    ],
  );
  assert.equal(dee.presses, 0);
});

test('a channel runs until its aura comes off, not its full length', () => {
  const dee = key([
    cast(50, DPS, 'Dee', ...MIND_FLAY),
    aura(50, DPS, 'Dee', ENEMY, 'Gnoll', ...MIND_FLAY, true),
    // Clipped at 2.5s of its 4.5.
    aura(52.5, DPS, 'Dee', ENEMY, 'Gnoll', ...MIND_FLAY, false),
  ]);
  assert.deepEqual(
    dee.bars.map((bar) => [bar.start, bar.end, bar.channel]),
    [[50_000, 52_500, true]],
  );
});

test('a cast a death cut short is not an abandoned one', () => {
  const dee = key([started(50, LAVA_BURST), died(51, DPS, 'Dee', '0x511')]);
  assert.equal(dee.cancelled, 0);
  assert.deepEqual(
    dee.bars.map((bar) => [bar.end, bar.died]),
    [[51_000, true]],
  );
});

test('a bar the log never closes runs no longer than the player ever took to finish one', () => {
  const dee = key([
    started(50, LAVA_BURST),
    cast(52, DPS, 'Dee', ...LAVA_BURST),
    // Queued as the pull ended, then never mentioned again.
    started(52, LAVA_BURST),
  ]);
  assert.equal(dee.bars.at(-1)!.end, 54_000);
  assert.equal(dee.cancelled, 1);
});

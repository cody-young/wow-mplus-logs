import assert from 'node:assert/strict';
import test from 'node:test';

import { LogSession } from '@mplus/parser';

import { buildSegments, contextFor, damageReport, healingReport, type BreakdownReport } from '../src/index.js';
import { DPS, HEALER, LINES, PET, at, aura, creature, heal, hit, hitPet } from './fixture.js';

/**
 * Active time on the damage and healing tables, in a 100 second key of its
 * own: the gaps between a player's rows, any longer than ten seconds left out.
 */
const ENEMY = creature(1000, 1);

function key(lines: string[]): { damage: BreakdownReport; healing: BreakdownReport } {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      LINES[0]!,
      LINES[1]!,
      ...LINES.filter((line) => line.includes('COMBATANT_INFO')),
      ...lines,
      `${at(100)}  CHALLENGE_MODE_END,2000,1,15,100000,100`,
    ].join('\n') + '\n',
  );
  session.end();
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  const segments = buildSegments(context);
  return { damage: damageReport(context, segments), healing: healingReport(context, segments) };
}

const activeOf = (report: BreakdownReport, name: string): number =>
  report.actors.find((actor) => actor.name.startsWith(name))!.activeMs;

test('active time is the gaps between hits, leaving out any over ten seconds', () => {
  const { damage } = key(
    // 2s, then 18s that is not counted, then 5s and exactly 10s, which is.
    [10, 12, 30, 35, 45].map((seconds) => hit(seconds, DPS, 'Dee', ENEMY, 'Gnoll', 1000)),
  );
  assert.equal(activeOf(damage, 'Dee'), 2_000 + 5_000 + 10_000);
});

test('a hit alone counts nothing, and a pet fills its owner’s gaps', () => {
  const alone = key([hit(10, DPS, 'Dee', ENEMY, 'Gnoll', 1000)]);
  assert.equal(activeOf(alone.damage, 'Dee'), 0);

  const { damage } = key([
    hitPet(5, ENEMY, 'Gnoll', PET, 'Imp', DPS, 100),
    hit(10, DPS, 'Dee', ENEMY, 'Gnoll', 1000),
    hit(18, PET, 'Imp', ENEMY, 'Gnoll', 500),
    hit(26, DPS, 'Dee', ENEMY, 'Gnoll', 1000),
  ]);
  assert.equal(activeOf(damage, 'Dee'), 16_000);
});

test('a shield coming off is healing activity, but no other aura is', () => {
  const { healing } = key([
    heal(10, HEALER, 'Hal', DPS, 'Dee', 1000),
    // An absorb's removal ends in what it had left; a plain buff's does not.
    `${aura(16, HEALER, 'Hal', DPS, 'Dee', 17, 'Power Word: Shield', false, { buff: true, dstFlags: '0x511', srcFlags: '0x512' })},0`,
    aura(20, HEALER, 'Hal', DPS, 'Dee', 774, 'Rejuvenation', false, { buff: true, dstFlags: '0x511', srcFlags: '0x512' }),
    heal(24, HEALER, 'Hal', DPS, 'Dee', 1000),
  ]);
  // 10 → 16 → 24: the Rejuvenation at 20 adds nothing, and without the shield
  // the 14s from 10 to 24 would not count at all.
  assert.equal(activeOf(healing, 'Hal'), 14_000);
});

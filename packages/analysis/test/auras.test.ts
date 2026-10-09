import assert from 'node:assert/strict';
import test from 'node:test';

import { LogSession } from '@mplus/parser';

import { auraReport, aurasIn, buildSegments, contextFor, elapsedMs } from '../src/index.js';
import { DPS, HEALER, TANK, at, aura } from './fixture.js';

const STATS = '0,1,1,1,1,1,0,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1';
const ME = '0x511';
const FLASK = 9999;
const FORTITUDE = 21562;

/**
 * A key with nothing in it but auras on the party, each one a rule:
 *
 *   the tank's flask      on the opening list and never mentioned again
 *   Fortitude on the tank on the opening list, then removed at 50s
 *   the healer's rune     first seen coming off, at 25s
 *   the tank's Ironfur    10s to 20s, and again 60s to 70s
 *   Mark on the dps       two casters, 30s to 50s overlapped
 */
const LOG = [
  `${at(0)}  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1`,
  `${at(0)}  CHALLENGE_MODE_START,"Test Hold",2000,500,15,[10,9,147]`,
  `${at(0)}  COMBATANT_INFO,${HEALER},${STATS},270,[(1,1)],[],[],[],[],1,0,0,0`,
  `${at(0)}  COMBATANT_INFO,${TANK},${STATS},250,[(1,1)],[],[],[(5,1,(),(),())],[${HEALER},${FORTITUDE},1,${TANK},${FLASK},1],1,0,0,0`,
  `${at(0)}  COMBATANT_INFO,${DPS},${STATS},62,[(1,1)],[],[],[],[],1,0,0,0`,
  aura(10, TANK, 'Tank', TANK, 'Tank', 192081, 'Ironfur', true, { buff: true, dstFlags: ME }),
  aura(20, TANK, 'Tank', TANK, 'Tank', 192081, 'Ironfur', false, { buff: true, dstFlags: ME }),
  aura(25, HEALER, 'Heals', HEALER, 'Heals', 1234, 'Rune', false, { buff: true, dstFlags: ME }),
  aura(30, HEALER, 'Heals', DPS, 'Dee', 1126, 'Mark of the Wild', true, { buff: true, dstFlags: ME }),
  aura(35, TANK, 'Tank', DPS, 'Dee', 1126, 'Mark of the Wild', true, { buff: true, dstFlags: ME }),
  aura(40, HEALER, 'Heals', DPS, 'Dee', 1126, 'Mark of the Wild', false, { buff: true, dstFlags: ME }),
  aura(50, TANK, 'Tank', DPS, 'Dee', 1126, 'Mark of the Wild', false, { buff: true, dstFlags: ME }),
  aura(50, HEALER, 'Heals', TANK, 'Tank', FORTITUDE, 'Power Word: Fortitude', false, { buff: true, dstFlags: ME }),
  aura(60, TANK, 'Tank', TANK, 'Tank', 192081, 'Ironfur', true, { buff: true, dstFlags: ME }),
  aura(70, TANK, 'Tank', TANK, 'Tank', 192081, 'Ironfur', false, { buff: true, dstFlags: ME }),
  `${at(100)}  CHALLENGE_MODE_END,2000,1,15,100000,180`,
].join('\n');

function load() {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(`${LOG}\n`);
  session.end();
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  const segments = buildSegments(context);
  return { run, report: auraReport(context, segments), end: elapsedMs(run) };
}

test('the opening list is read off COMBATANT_INFO, caster and all', () => {
  const { run } = load();
  const tank = run.meta.party.find((index) => run.actors.at(index)?.guid === TANK);
  assert.deepEqual(
    run.openingAuras.map((entry) => [entry.actorIndex, entry.spellId, entry.sourceIndex === tank]),
    [
      [tank, FORTITUDE, false],
      [tank, FLASK, true],
    ],
  );
});

test('an aura on the opening list and never mentioned again is up the whole key', () => {
  const { run, report, end } = load();
  const tank = run.meta.party.find((index) => run.actors.at(index)?.guid === TANK)!;
  const flask = report.auras.find((entry) => entry.spellId === FLASK)!;
  assert.equal(flask.actorIndex, tank);
  assert.equal(flask.name, '', 'the list is ids alone, and the log never named it');
  assert.equal(flask.selfApplied, true);
  assert.deepEqual(flask.spans, [0, end]);

  const fortitude = report.auras.find((entry) => entry.spellId === FORTITUDE)!;
  assert.deepEqual(fortitude.spans, [0, 50_000], 'from the start to its removal');
  assert.equal(fortitude.name, 'Power Word: Fortitude', 'named by the removal');
  assert.equal(fortitude.selfApplied, false);
});

test('an aura first seen coming off was up since the start', () => {
  const { report } = load();
  const rune = report.auras.find((entry) => entry.spellId === 1234)!;
  assert.deepEqual(rune.spans, [0, 25_000]);
});

test('two casters of one buff are one span, ending when the last copy does', () => {
  const { report } = load();
  const mark = report.auras.find((entry) => entry.spellId === 1126)!;
  assert.deepEqual(mark.spans, [30_000, 50_000]);
});

test('a window cuts every span to itself', () => {
  const { run, report } = load();
  const tank = run.meta.party.find((index) => run.actors.at(index)?.guid === TANK)!;
  const rows = aurasIn(report.auras, tank, 15_000, 65_000);
  const ironfur = rows.find((row) => row.name === 'Ironfur')!;
  assert.deepEqual(ironfur.spans, [15_000, 20_000, 60_000, 65_000]);
  assert.equal(ironfur.upMs, 10_000);
  assert.equal(ironfur.count, 2);
  assert.equal(rows[0]!.upMs, 50_000, 'the flask, up throughout, sorts first');
});

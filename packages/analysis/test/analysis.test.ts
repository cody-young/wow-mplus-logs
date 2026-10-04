import assert from 'node:assert/strict';
import test from 'node:test';

import { forcesFor } from '@mplus/data';
import { LogSession, type Run } from '@mplus/parser';

import {
  SegmentKind,
  buildSegments,
  contextFor,
  damageReport,
  deathReports,
  healingReport,
  type AnalysisContext,
  type SegmentIndex,
  type SegmentOptions,
} from '../src/index.js';
import { ACTORS, DPS, FORCES, HEALER, LOG_TEXT, PET, TANK } from './fixture.js';

function load(options: SegmentOptions = {}): {
  session: LogSession;
  run: Run;
  context: AnalysisContext;
  segments: SegmentIndex;
} {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(LOG_TEXT);
  session.end();
  assert.equal(session.runs.length, 1, 'one key in the fixture');
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  return { session, run, context, segments: buildSegments(context, options) };
}

/** The same run with enemy forces attached, which is the normal case now. */
function loadWithForces(table = FORCES) {
  const lookup = forcesFor(table, 500);
  assert.ok(lookup, 'the fixture dungeon is in the forces table');
  return load({ forces: lookup });
}

function labelled(segments: SegmentIndex, label: string) {
  const found = segments.segments.find((segment) => segment.label.includes(label));
  assert.ok(found, `expected a segment matching "${label}"`);
  return found;
}

test('trash separated by more than the gap becomes separate pulls', () => {
  const { segments } = load();
  const pulls = segments.segments.filter((segment) => segment.kind === SegmentKind.PULL);
  // Gnolls, the Ogre 26s later, the dragged straggler, and the totem pack.
  assert.equal(pulls.length, 4);
  const gnolls = labelled(segments, 'Gnoll');
  assert.equal(gnolls.enemies.length, 2, 'both Gnolls in one pull');
  assert.ok(labelled(segments, 'Ogre').startTs > gnolls.endTs);
});

test('a boss engaged before its window still belongs to its own fight', () => {
  // The boss is hit at t=66, four seconds before ENCOUNTER_START at t=70. Left
  // alone it lands in the preceding trash pull and the boss segment reads zero.
  const { run, segments } = load();
  const boss = labelled(segments, 'Big Bad');
  assert.equal(boss.kind, SegmentKind.BOSS);
  assert.ok(boss.enemies.includes(indexOf(run, ACTORS.BOSS)), 'the boss itself is in its fight');
  assert.ok(boss.enemies.includes(indexOf(run, ACTORS.BOSS_ADD)), 'and so is its add');
  // The pre-window hit extends the segment back past ENCOUNTER_START.
  assert.ok(boss.startTs <= 66_000, 'the segment covers the early hit');
});

test('trash dragged into a boss keeps its own pull', () => {
  // Health is what separates this case from the one above: the straggler was
  // engaged 10s before the boss window, the boss 4s before, so no time window
  // can tell them apart. The boss has 100x the health.
  const { run, segments } = load();
  const straggler = labelled(segments, 'Straggler');
  assert.equal(straggler.kind, SegmentKind.PULL);
  assert.deepEqual(straggler.enemies, [indexOf(run, ACTORS.DRAGGED)]);
  const boss = labelled(segments, 'Big Bad');
  assert.ok(
    straggler.overlaps.includes(boss.id),
    'the pull overlaps the boss fight and the UI should say so',
  );
});

test('a pull is named after what was pulled, not after what it summoned', () => {
  // The totems out-mass the shaman four to one, so ranking by health or by
  // count alone names the pull "Magma Totem x4 +1" — the thing the pull
  // produced rather than the thing the party walked into.
  const { segments } = load();
  const pull = labelled(segments, 'Flame Shaman');
  assert.equal(pull.label, 'Flame Shaman +4');
  assert.equal(pull.enemies.length, 5, 'the totems are still counted as enemies');
});

test('roster pools enemies by creature and flags summons two ways', () => {
  const { segments } = load();
  const { roster } = labelled(segments, 'Flame Shaman');

  assert.deepEqual(
    roster.map((group) => [group.name, group.spawns, group.maxHp, group.summon]),
    [
      ['Flame Shaman', 1, 60_000, false],
      // One row for all four totems, even though two were announced by
      // SPELL_SUMMON and two only by the guardian bit in their unit flags.
      ['Magma Totem', 4, 20_000, true],
    ],
    'non-summons first, then by health pool',
  );
  assert.equal(roster[1]!.npcId, 1005, 'pooling is keyed on the creature id');
});

test('roster health comes from the advanced block, so a boss outranks its add', () => {
  const { segments } = load();
  const { roster } = labelled(segments, 'Big Bad');
  assert.deepEqual(
    roster.map((group) => group.name),
    ['Big Bad', 'Minion'],
  );
  assert.equal(roster[0]!.maxHp, 500_000);
  assert.equal(roster[1]!.maxHp, 5000);
});

test('segment damage sums to the run total, with nothing double-counted', () => {
  // The property that makes overlapping segments safe: attribution is keyed on
  // the enemy, so a pull running through a boss fight is counted exactly once.
  const { context, segments } = load();
  const whole = damageReport(context, segments);
  const summed = segments.segments.reduce(
    (total, segment) => total + damageReport(context, segments, { segmentId: segment.id }).total,
    0,
  );
  assert.ok(whole.total > 0);
  assert.equal(summed, whole.total);
});

test('pet damage rolls up to its owner', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS));
  assert.ok(dps);
  // Dee's own hits plus the Imp's 900.
  const totemPack = 2000 + 300 + 300 + 300 + 300 + 2000;
  assert.equal(
    dps.total,
    1000 + 1000 + 1000 + 3000 + 3000 + 500 + 5000 + 7000 + 4000 + 600 + 500 + 900 + totemPack,
  );
  assert.ok(!report.actors.some((actor) => actor.actorIndex === indexOf(run, PET)), 'the pet is not its own row');
});

test('_SUPPORT rows are credit, never extra damage', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const healer = report.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER));

  // The fixture's _SUPPORT line duplicates the 4000 hit before it. Counting
  // both would add 4000 to the total.
  assert.equal(dps.supportReceived, 4000, 'credit is recorded');
  assert.ok(healer, 'the supporter appears, on credit alone');
  assert.equal(healer.supportGiven, 4000);
  assert.equal(healer.total, 0, 'but with no damage of their own');

  // With creditSupport the amount moves rather than appearing twice.
  const moved = damageReport(context, segments, { creditSupport: true });
  const movedDps = moved.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const movedHealer = moved.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER))!;
  assert.equal(movedDps.total, dps.total - 4000);
  assert.equal(movedHealer.total, 4000);
  assert.equal(moved.total, report.total, 'the run total is unchanged either way');
});

test('healing reports effective amounts, not gross', () => {
  const { run, context, segments } = load();
  const report = healingReport(context, segments);
  const healer = report.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER))!;
  // 30000 logged with 10000 overhealed.
  assert.equal(healer.total, 20000);
  assert.equal(healer.wasted, 10000);
});

test('a pet dying is not a player death', () => {
  // attribute(pet) resolves to its owner, who is in the party, so testing the
  // owner instead of the victim turned 9 real deaths into 27 on a real log.
  const { context, segments } = load();
  const deaths = deathReports(context, segments);
  assert.equal(deaths.length, 1, 'only the tank');
  assert.equal(deaths[0]!.name, 'Tank');
});

test('a death carries a descending health trace and the blow that landed it', () => {
  const { context, segments } = load();
  const death = deathReports(context, segments)[0]!;

  assert.ok(death.trace.length >= 2, 'a trace needs at least two samples');
  assert.ok(
    death.trace[death.trace.length - 1]!.hp < death.trace[0]!.hp,
    'health must fall across the window',
  );
  assert.equal(death.trace[death.trace.length - 1]!.hp, 0, 'ending at zero');

  assert.ok(death.killingBlow);
  assert.equal(death.killingBlow.spellName, 'Smash');
  assert.equal(death.killingBlow.overkill, 50000, 'the overkilling hit is the killing blow');

  // 400000 + (150000 - 50000 overkill).
  assert.equal(death.damageTaken, 500000);
  assert.equal(death.healingReceived, 20000, 'effective healing in the window');
  assert.equal(death.byAbility[0]!.name, 'Smash');
  assert.equal(death.byAbility[0]!.sourceName, 'Big Bad');

  // What they pressed is as diagnostic as what hit them.
  assert.ok(death.ownCasts.some((c) => c.name === 'Icebound Fortitude'));
  assert.equal(death.segmentKind, SegmentKind.BOSS, 'the death is filed under the boss');
});

test('an absorb in the window names its shield and whose it was', () => {
  const { context, segments } = load();
  const death = deathReports(context, segments)[0]!;

  assert.equal(death.absorbed, 45000, 'the two shields together');
  assert.equal(death.absorbsReceived.length, 2);

  // The shield, not the hit it stopped: Smash is already in `incoming`.
  const own = death.absorbsReceived.find((a) => a.spellName === 'Icebound Fortitude')!;
  assert.ok(own, 'the tank\'s own cooldown');
  assert.equal(own.amount, 30000);
  assert.equal(own.selfApplied, true);

  const external = death.absorbsReceived.find((a) => a.spellName === 'Power Word: Shield')!;
  assert.ok(external, 'the healer\'s shield');
  assert.equal(external.amount, 15000);
  assert.equal(external.sourceName, 'Heals');
  assert.equal(external.selfApplied, false, 'somebody else put it up');
});

test('damage taken names the ability and its biggest source', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments, { direction: 'taken' });
  const tank = report.actors.find((actor) => actor.actorIndex === indexOf(run, TANK))!;
  const worst = tank.spells[0]!;
  assert.equal(worst.name, 'Smash');
  assert.equal(worst.topSourceName, 'Big Bad');
  assert.equal(worst.hits, 2);
});

test('a spell carries its casts and its crits, not just its hits', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const nuke = dps.spells.find((spell) => spell.name === 'Nuke')!;

  // Casts are counted on their own events, so they are free to disagree with
  // hits — which is the point: an average per cast is not an average per hit.
  assert.equal(nuke.casts, 2);
  assert.ok(nuke.hits > nuke.casts, 'the fixture logs more hits than casts');
  assert.equal(nuke.crits, 1);
  assert.equal(nuke.critTotal, 7000, 'the crit amount, for an average crit');

  // Damage taken has no casts to report: those presses were the enemy's.
  const taken = damageReport(context, segments, { direction: 'taken' });
  const tank = taken.actors.find((actor) => actor.actorIndex === indexOf(run, TANK))!;
  assert.ok(tank.spells.every((spell) => spell.casts === 0));
});

function indexOf(run: Run, guid: string): number {
  const actor = run.actors.get(guid);
  assert.ok(actor, `actor ${guid} should exist`);
  return actor.index;
}

// --- Enemy forces ------------------------------------------------------------

test('without a forces table the roster still counts spawns and kills', () => {
  const { segments } = load();
  const gnolls = labelled(segments, 'Gnoll');
  assert.equal(gnolls.roster[0]!.spawns, 2);
  assert.equal(gnolls.roster[0]!.killed, 2);
  // Unknown, not zero: there was no table to ask.
  assert.equal(gnolls.roster[0]!.forcesEach, null);
  assert.equal(gnolls.forces, 0);
  assert.equal(segments.forces.known, false);
  assert.equal(segments.forces.total, 0);
  assert.equal(segments.forces.fraction, 0);
});

test('forces are awarded per kill, not per enemy engaged', () => {
  const { segments } = loadWithForces();
  const gnolls = labelled(segments, 'Gnoll');
  assert.equal(gnolls.roster[0]!.forcesEach, 4);
  assert.equal(gnolls.roster[0]!.killed, 2);
  assert.equal(gnolls.forces, 8, 'two Gnolls at 4 apiece');

  // The straggler was tagged twice and never killed, so it moved the bar by
  // nothing even though it is in the roster with one spawn.
  const straggler = labelled(segments, 'Straggler');
  assert.equal(straggler.roster[0]!.spawns, 1);
  assert.equal(straggler.roster[0]!.killed, 0);
  assert.equal(straggler.roster[0]!.forcesEach, 7);
  assert.equal(straggler.forces, 0);
});

test('a boss contributes nothing, its adds contribute normally', () => {
  const { segments } = loadWithForces();
  const boss = labelled(segments, 'Big Bad');
  const byName = new Map(boss.roster.map((group) => [group.name, group]));
  assert.equal(byName.get('Big Bad')!.forcesEach, 0);
  assert.equal(byName.get('Big Bad')!.forces, 0);
  assert.equal(byName.get('Minion')!.forces, 2);
  assert.equal(boss.forces, 2);
});

test('summons worth nothing do not inflate the pull that spawned them', () => {
  const { segments } = loadWithForces();
  const pack = labelled(segments, 'Flame Shaman');
  const totems = pack.roster.find((group) => group.summon)!;
  assert.equal(totems.killed, 2, 'two of the four totems died');
  assert.equal(totems.forcesEach, 0);
  assert.equal(pack.forces, 12, 'the shaman alone');
});

test('run forces sum the segments and divide by the requirement', () => {
  const { segments } = loadWithForces();
  const summed = segments.segments.reduce((total, segment) => total + segment.forces, 0);
  // Gnolls 8 + Ogre 10 + straggler 0 + boss 2 + shaman 12.
  assert.equal(summed, 32);
  assert.equal(segments.forces.counted, 32);
  assert.equal(segments.forces.total, 100);
  assert.equal(segments.forces.fraction, 0.32);
  assert.equal(segments.forces.dungeon, 'Test Hold');
  assert.equal(segments.forces.known, true);
  assert.deepEqual(segments.forces.unknown, [], 'the fixture table covers every kill');
});

test('a creature missing from the table is reported, not silently dropped', () => {
  // A dungeon reworked since the table was built: the add is gone from it.
  const thinned = {
    ...FORCES,
    dungeons: [
      {
        ...FORCES.dungeons[0]!,
        enemies: FORCES.dungeons[0]!.enemies.filter((enemy) => enemy.npcId !== 2002),
      },
    ],
  };
  const { segments } = loadWithForces(thinned);
  assert.deepEqual(segments.forces.unknown, [2002]);
  assert.equal(segments.forces.counted, 30, 'the add no longer contributes its 2');
  const boss = labelled(segments, 'Big Bad');
  assert.equal(boss.roster.find((group) => group.name === 'Minion')!.forcesEach, null);
});

test('a log from a dungeon the table does not cover reads as unknown', () => {
  assert.equal(forcesFor(FORCES, 9999), null);
});

test('an enemy that died without being engaged counts for nothing', () => {
  // A wave despawning at the end of an event fires UNIT_DIED for every member
  // without the party ever hitting them, and the game credits none of it. The
  // fixture's two are worth 9 apiece, so a kills-only rule would read 50.
  const { segments } = loadWithForces();
  assert.equal(segments.forces.counted, 32);
  for (const segment of segments.segments) {
    assert.ok(
      !segment.roster.some((group) => group.npcId === 1006),
      'an unengaged enemy is in no roster',
    );
  }
});

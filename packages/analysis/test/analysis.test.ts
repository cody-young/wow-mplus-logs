import assert from 'node:assert/strict';
import test from 'node:test';

import { forcesFor } from '@mplus/data';
import { LogSession, type Run } from '@mplus/parser';

import {
  SegmentKind,
  abilityName,
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
  assert.equal(pulls.length, 5);
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

test('a rate is per second of the key, not per second of the keystone timer', () => {
  // The timer charges 15s for a death. Dividing by it reports damage during
  // seconds the key was already over, which on a real +12 put every player
  // 7% under their Warcraft Logs DPS at once — the same 7%, for everyone,
  // which is what gives a bad denominator away.
  const { context, segments } = load();
  const whole = damageReport(context, segments);
  assert.equal(context.run.meta.totalTimeMs, 135_000, 'the timer the game showed');
  assert.equal(whole.durationMs, 120_000, 'the time the key actually took');
  const top = whole.actors[0]!;
  assert.equal(top.perSecond, top.total / 120);
});

test('pet damage rolls up to its owner', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS));
  assert.ok(dps);
  // Dee's own hits plus the Imp's 900.
  const totemPack = 2000 + 300 + 300 + 300 + 300 + 2000;
  // The last pull: the Tyrant's 1500, a hit the Warded Ogre's shield ate
  // whole, and 700 into a block of ice that carries Dee's name but is not
  // Dee's. Each of the three was once dropped for a different reason.
  const lastPull = 1500 + 800 + 700 + (300 + 100 + 200 + 150) + 50;
  // The boss fight also carries Agony's 1200, whose aura the uptime test reads.
  assert.equal(
    dps.total,
    1000 + 1000 + 1000 + 3000 + 3000 + 500 + 5000 + 7000 + 4000 + 600 + 500 + 900 + 1200 + totemPack + lastPull,
  );
  assert.ok(!report.actors.some((actor) => actor.actorIndex === indexOf(run, PET)), 'the pet is not its own row');
});

test('a guardian summoned by a player counts as that player', () => {
  // The bug this fixes was worth a fifth of a demonology warlock's damage: a
  // Demonic Tyrant is a Creature- GUID with no ownerGUID anywhere, so without
  // reading SPELL_SUMMON its output belonged to nobody and was dropped.
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;

  assert.ok(
    dps.spells.some((spell) => spell.name === 'Nuke'),
    'the player\'s own damage is still theirs',
  );
  assert.ok(
    !report.actors.some((actor) => actor.actorIndex === indexOf(run, ACTORS.TYRANT)),
    'and the guardian is not a row of its own',
  );
});

test('a hit an enemy shield swallows is still damage done', () => {
  // Warcraft Logs counts it and so must this: the swing landed and the player
  // produced the output. On a real +12 leaving it out put every damage dealer
  // 0.4-0.8% short.
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const bolt = dps.spells.find((spell) => spell.name === 'Chaos Bolt')!;

  assert.equal(bolt.total, 800, 'the whole of it, though no damage event was logged');
  assert.equal(bolt.hits, 1);

  // The tank's two absorbs, 45000 between them, stay out of damage taken: a
  // shield that holds is not a wound, and a death already reports it apart.
  const taken = damageReport(context, segments, { direction: 'taken' });
  const tank = taken.actors.find((actor) => actor.actorIndex === indexOf(run, TANK))!;
  assert.equal(tank.total, 2000 + 12_000 + 400_000 + 100_000);
});

test('one ability logged under four spell ids is one row, openable', () => {
  // Spell ids are how the log reports damage; abilities are how a player
  // reads it. A modern ability is several ids — the cast, what it procs, the
  // talented version, the off-hand copy — and listed apart the biggest thing
  // a player did can be absent from the top of their own table.
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;

  const cleave = dps.spells.filter((spell) => spell.name === 'Cleave');
  assert.equal(cleave.length, 1, 'one row, not four');
  assert.equal(cleave[0]!.total, 300 + 100 + 200 + 150);
  assert.equal(cleave[0]!.hits, 4);
  assert.equal(cleave[0]!.spellId, 200, 'the plainly named part, whose icon the row wears');

  // Opening it has to give the ids back, including the two that share a name
  // and so can only be told apart by their id.
  const parts = cleave[0]!.parts ?? [];
  assert.deepEqual(
    parts.map((part) => [part.spellId, part.total]),
    [
      [200, 300],
      [202, 200],
      [203, 150],
      [201, 100],
    ],
    'biggest first',
  );

  // A name that says something else is a different ability, whatever it is
  // named after.
  const overload = dps.spells.find((spell) => spell.name === 'Cleave Overload')!;
  assert.equal(overload.total, 50);
  assert.equal(overload.parts, undefined, 'nothing merged, nothing to open');

  // Merging must not move damage: the rows still add up to the player.
  const summed = dps.spells.reduce((total, spell) => total + spell.total, 0);
  assert.equal(summed, dps.total);
});

test('abilityName strips the suffixes that mean "same button", and no others', () => {
  assert.equal(abilityName('Stormstrike Off-Hand'), 'Stormstrike');
  assert.equal(abilityName('Crash Lightning (Unleashed)'), 'Crash Lightning');
  assert.equal(abilityName('Eviscerate (Coup de Grace)'), 'Eviscerate');
  assert.equal(abilityName('Power Word: Shield (Unfolding Vision)'), 'Power Word: Shield');
  assert.equal(abilityName('Chain Lightning Overload'), 'Chain Lightning Overload');
  assert.equal(abilityName('Melee'), 'Melee');
  // A name that is nothing but a parenthetical keeps itself rather than
  // becoming the empty string and swallowing every other such row.
  assert.equal(abilityName('(Unknown)'), '(Unknown)');
});

test('a unit that merely names a player is still an enemy', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;

  assert.ok(dps.total > 0);
  const pull = segments.segments.find((segment) => segment.enemies.includes(indexOf(run, ACTORS.TOMB)));
  assert.ok(pull, 'the ice is in a pull rather than being counted as one of us');
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
  // 30000 logged with 10000 overhealed, plus the 15000 their shield ate and
  // the net 2500 of Spirit Link (see the test below).
  assert.equal(healer.total, 20000 + 15000 + 2500);
  assert.equal(healer.wasted, 10000);
});

test('an ability that heals by hurting is credited with the difference', () => {
  // Spirit Link Totem levels a group's health, which means healing whoever is
  // lowest by hurting whoever is highest — both under one spell id. Counting
  // only the healing half credited a real shaman with 4.09M for an ability
  // whose net effect that key was -0.47M.
  const { run, context, segments } = load();
  const report = healingReport(context, segments);
  const healer = report.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER))!;

  const link = healer.spells.find((spell) => spell.name === 'Spirit Link')!;
  assert.equal(link.total, 5000 - 2000 - 500, 'the heal, less what it cost the other two');
  assert.equal(link.wasted, 0, 'hurting someone is not overhealing them');

  // Only abilities that healed are netted. Self-harm that heals nobody has no
  // healing row to charge it against, and must not be charged against the
  // rest — deducting it would have cost two players on a real log a figure
  // that currently matches Warcraft Logs exactly.
  assert.ok(!healer.spells.some((spell) => spell.name === 'Burning Rush'));
  assert.equal(
    healer.spells.reduce((total, spell) => total + spell.total, 0),
    healer.total,
    'and the rows still add up to the player',
  );

  // None of it is damage done: hitting your own party is not output.
  const damage = damageReport(context, segments);
  const dealer = damage.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER));
  assert.ok(!dealer?.spells.some((spell) => spell.name === 'Spirit Link'));
});

test('damage a shield stopped is healing by whoever cast the shield', () => {
  // Warcraft Logs counts it, and without it a blood death knight's Blood
  // Shield and a warlock's Soul Leech are not healing at all: on a real +12
  // that was 44.7M of the tank's 125.5M and 12.2M of the warlock's 19.9M.
  const { run, context, segments } = load();
  const report = healingReport(context, segments);
  const tank = report.actors.find((actor) => actor.actorIndex === indexOf(run, TANK))!;
  const healer = report.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER))!;

  // The row's own source is the boss that swung. Credit follows the shield.
  const own = tank.spells.find((spell) => spell.name === 'Icebound Fortitude')!;
  assert.equal(own.total, 30000, 'the tank shielded themselves');
  const external = healer.spells.find((spell) => spell.name === 'Power Word: Shield')!;
  assert.equal(external.total, 15000, 'the healer shielded the tank');

  // Named for the shield, not for the blow it stopped.
  assert.ok(!tank.spells.some((spell) => spell.name === 'Smash'), 'not the hit');

  // A shield on an enemy is the enemy's mitigation. It is damage we dealt,
  // counted there already, and healing by nobody.
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS));
  assert.ok(!dps?.spells.some((spell) => spell.name === 'Warding Crystal'));

  // An absorb has no overheal the log ever states — a shield that expires
  // unspent is waste nothing reports — so it adds to a total and never to
  // the overheal beside it.
  assert.equal(healer.wasted, 10000, 'the heal\'s overheal, and nothing from the shield');
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

test('a death carries its auras as spans, buffs told from debuffs', () => {
  const { context, segments } = load();
  const death = deathReports(context, segments)[0]!;
  const by = (name: string) => death.auras.find((aura) => aura.spellName === name)!;

  // Pressed inside the window and never coming off: it ran to the death.
  const own = by('Icebound Fortitude');
  assert.equal(own.buff, true);
  assert.equal(own.selfApplied, true);
  assert.equal(own.openStart, false, 'the application is in the window');
  assert.equal(own.openEnd, true, 'they died in it');
  assert.equal(own.endTs, death.ts);
  assert.equal(death.ts - own.startTs, 1600, 'pressed 1.6s before dying');

  // Applied before the window and removed inside it. The removal is the only
  // line naming it, so its auraType is the only thing that calls it a buff.
  const external = by('Blessing of Protection');
  assert.equal(external.buff, true, 'a BUFF on a SPELL_AURA_REMOVED');
  assert.equal(external.openStart, true, 'already up when the window opened');
  assert.equal(external.startTs, death.ts - death.scrollbackMs);
  assert.equal(external.sourceName, 'Heals');

  // On and off inside the window: both ends are real.
  const debuff = by('Crushing Grip');
  assert.equal(debuff.buff, false);
  assert.equal(debuff.openStart, false);
  assert.equal(debuff.openEnd, false);
  assert.equal(debuff.endTs - debuff.startTs, 4500);

  // A debuff they put on themselves that the game's data gives no effect: the
  // game's own note that they have had Bloodlust, and nothing to do with dying.
  const sated = by('Sated');
  assert.equal(sated.buff, false);
  assert.equal(sated.selfApplied, true);
  assert.equal(sated.bookkeeping, true);
  assert.equal(debuff.bookkeeping, false, 'a boss debuff is not bookkeeping');
  assert.equal(own.bookkeeping, false, 'buffs are never marked');

  // What was on them when they died is the debuffs still open, and only those:
  // the tank's own shield was up too, and it belongs in the other column —
  // as does Sated, which is still up and still not worth saying.
  assert.deepEqual(
    death.debuffsAtDeath.map((entry) => entry.name),
    ['Sundered'],
  );
});

test('the event lists reach further back than the totals do', () => {
  const { context, segments } = load();
  const death = deathReports(context, segments)[0]!;

  // The recap slides a ten-second view back through the capture, so the lists
  // have to cover the whole of it while every total stays the ten seconds it
  // is labelled with everywhere it is shown.
  assert.ok(death.scrollbackMs > death.windowMs);
  assert.ok(
    death.incoming.some((hit) => hit.ts < death.ts - death.windowMs),
    'a hit older than the summary window is still in the list',
  );
  assert.equal(death.damageTaken, 500000, 'and is not in the total');

  // Narrowing the capture to the summary window puts them back in step.
  const narrow = deathReports(context, segments, { scrollbackMs: 0 })[0]!;
  assert.equal(narrow.scrollbackMs, narrow.windowMs, 'never shorter than the window');
  assert.ok(narrow.incoming.every((hit) => hit.ts >= narrow.ts - narrow.windowMs));
  assert.equal(narrow.damageTaken, death.damageTaken, 'the total is unchanged either way');
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

test('a miss rate counts what was avoided, not what a shield ate', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const nuke = dps.spells.find((spell) => spell.name === 'Nuke')!;

  // Two misses in the fixture, one dodged and one absorbed. Counting both
  // would double-report the absorbed blow, whose damage is already in the
  // table, and overstate the rate by a factor of two.
  assert.equal(nuke.misses, 1);
  assert.equal(nuke.misses / (nuke.misses + nuke.hits), 1 / (1 + nuke.hits));

  // Nothing the party did to itself, and nothing it avoided, lands on the
  // victim's side of the table.
  const taken = damageReport(context, segments, { direction: 'taken' });
  const tank = taken.actors.find((actor) => actor.actorIndex === indexOf(run, TANK))!;
  assert.ok(tank.spells.every((spell) => spell.misses === 0));
});

test('uptime is the union of an aura\'s intervals, not a count of its events', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const agony = dps.spells.find((spell) => spell.name === 'Agony')!;

  // Applied at t=76.5 and removed at t=94.5, over a 120s key.
  assert.equal(report.durationMs, 120_000);
  assert.equal(agony.uptimeMs, 18_000);

  // Abilities that apply no aura say so with a zero rather than inheriting one
  // from the ability above them.
  const nuke = dps.spells.find((spell) => spell.name === 'Nuke')!;
  assert.equal(nuke.uptimeMs, 0);

  // Inside the boss fight the same debuff is up for the same 18s of a shorter
  // window, so its share of that window is larger — which is the whole reason
  // a per-segment report exists.
  const boss = segments.segments.find((segment) => segment.kind === SegmentKind.BOSS)!;
  const inBoss = damageReport(context, segments, { segmentId: boss.id });
  const bossDps = inBoss.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const bossAgony = bossDps.spells.find((spell) => spell.name === 'Agony')!;
  assert.equal(bossAgony.uptimeMs, 18_000);
  assert.ok(
    bossAgony.uptimeMs / inBoss.durationMs > agony.uptimeMs / report.durationMs,
    'the same 18s is more of a pull than it is of a key',
  );
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
  // Zero rather than null: the boss has no row in the table, and in Blizzard's
  // criteria data that is how "awards nothing" is spelled.
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
});

test('a creature with no row in the table is worth nothing, not unknown', () => {
  // The criteria data lists only creatures that award something, so a creature
  // the table does not mention is worth 0 — the same answer as a boss or a
  // totem, and for the same reason. There is no third state to render.
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
  assert.equal(segments.forces.counted, 30, 'the add no longer contributes its 2');
  const boss = labelled(segments, 'Big Bad');
  assert.equal(boss.roster.find((group) => group.name === 'Minion')!.forcesEach, 0);
});

test('a log from a dungeon the table does not cover reads as unknown', () => {
  assert.equal(forcesFor(FORCES, 9999), null);
});

/** The fixture table with a different requirement, which is the only field these need. */
function withTotal(total: number) {
  return {
    ...FORCES,
    dungeons: [{ ...FORCES.dungeons[0]!, total }],
  };
}

/** The fixture table with a non-kill award, as eight real dungeons have. */
function withNonKill(nonKillForces: number) {
  return {
    ...FORCES,
    dungeons: [{ ...FORCES.dungeons[0]!, nonKillForces }],
  };
}

test('a completed key whose values fall short of the requirement is flagged', () => {
  // The fixture key is completed and its kills come to 32 of 100, which is not
  // a thing the game can produce: forces are a completion requirement, so the
  // run reached 100% and something about this table is short.
  const { run, segments } = loadWithForces();
  assert.equal(run.meta.success, true);
  assert.equal(segments.forces.counted, 32);
  assert.equal(segments.forces.nonKill, 0);
  assert.equal(segments.forces.incomplete, true);
});

test("a shortfall the dungeon's non-kill award covers is not flagged", () => {
  // King's Rest in miniature: the kills come to 32 of 100 and the dungeon
  // awards 68 for a scenario objective the combat log never mentions, so the
  // key really did reach 100% and there is nothing to warn about. `counted`
  // stays at the kills — there is no evidence the objective happened — so the
  // page still reads 32%.
  const { segments } = loadWithForces(withNonKill(68));
  assert.equal(segments.forces.counted, 32, 'the award is a tolerance, not an addend');
  assert.equal(segments.forces.fraction, 0.32);
  assert.equal(segments.forces.nonKill, 68);
  assert.equal(segments.forces.incomplete, false);
});

test('a non-kill award too small to close the gap still leaves the key flagged', () => {
  const { segments } = loadWithForces(withNonKill(67));
  assert.equal(segments.forces.incomplete, true);
});

test('a completed key that reaches the requirement is not flagged', () => {
  const { segments } = loadWithForces(withTotal(32));
  assert.equal(segments.forces.fraction, 1);
  assert.equal(segments.forces.incomplete, false, 'exactly the requirement is enough');
});

test('a requirement the table does not carry cannot be fallen short of', () => {
  const { segments } = loadWithForces(withTotal(0));
  assert.equal(segments.forces.incomplete, false);
});

test('without a forces table nothing is short of anything', () => {
  const { segments } = load();
  assert.equal(segments.forces.known, false);
  assert.equal(segments.forces.incomplete, false);
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

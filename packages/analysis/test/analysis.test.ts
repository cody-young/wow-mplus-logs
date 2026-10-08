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
  controlKindNames,
  crowdControlReport,
  dispelReport,
  summarizeDispels,
  interruptReport,
  summarizeCrowdControl,
  summarizeInterrupts,
  type AnalysisContext,
  type ControlApplication,
  type ControlReport,
  type InterruptAttempt,
  type InterruptReport,
  type SegmentIndex,
  type SegmentOptions,
  avoidableReport,
  summarizeAvoidable,
  TrackKind,
  mapPoint,
  positionAt,
  positionTracks,
  statsReport,
  whoPulled,
  type PullReport,
} from '../src/index.js';
import { ACTORS, DPS, FORCES, HEALER, LINES, LOG_TEXT, PET, TANK, at, aura, creature, died, hit, taken } from './fixture.js';

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
  assert.equal(context.run.meta.kind === 'key' ? context.run.meta.totalTimeMs : null, 135_000, 'the timer the game showed');
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
  // The boss fight also carries Agony's 1200, whose aura the uptime test reads,
  // and a 2500 swing that counts once although the log writes it twice.
  //
  // The 4000 Bombardment Dee set off is not here: it is the evoker's bomb and
  // the support test below follows it there. Nor are the 1500 of Dee's Nuke
  // and the 400 of the swing that Ebon Might added, which the same test
  // follows to the evoker.
  const boss = (7000 - 1500) + (2500 - 400) + 1200;
  assert.equal(
    dps.total,
    1000 + 1000 + 1000 + 3000 + 3000 + 500 + 5000 + 600 + 500 + 900 + boss + totemPack + lastPull,
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

test('an Ebon Might slice is never extra damage, whoever is credited with it', () => {
  const { run, context, segments } = load();
  // The log's own arithmetic: the slice stays inside the hit it was part of,
  // and the evoker is named beside it without being paid.
  const kept = damageReport(context, segments, { creditSupport: false });
  const keptDps = kept.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const keptHealer = kept.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER))!;
  // 1500 of Dee's Nuke and 400 of their swing, plus 4000 of a tank swing the
  // game wrote only from the victim's side.
  assert.equal(keptDps.supportReceived, 1900, 'credit is recorded');
  assert.equal(keptHealer.supportGiven, 1900 + 4000);
  const keptNuke = keptDps.spells.find((spell) => spell.name === 'Nuke')!;
  assert.ok(
    !keptHealer.spells.some((spell) => spell.name === 'Ebon Might'),
    'and buys the evoker no ability of their own',
  );

  // The default, and how Warcraft Logs reports an aug: the slice moves to the
  // evoker, which is the only way one reads as anything but a bystander.
  const moved = damageReport(context, segments);
  const dps = moved.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const healer = moved.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER))!;
  assert.equal(dps.total, keptDps.total - 1900);
  assert.equal(healer.total, keptHealer.total + 1900 + 3000);
  assert.equal(moved.total, kept.total, 'the run total is unchanged either way');

  // Moved as an ability on both sides, not as a lump sum. The evoker's table
  // reads Ebon Might, and Dee's Nuke no longer reads the part of it that the
  // evoker has just been paid for.
  const given = healer.spells.find((spell) => spell.name === 'Ebon Might')!;
  assert.ok(given, 'the evoker carries the buff as an ability');
  assert.equal(given.hits, 3, 'one for every hit it rode in on');
  const nuke = dps.spells.find((spell) => spell.name === 'Nuke')!;
  assert.equal(nuke.total, keptNuke.total - 1500, 'taken off the ability it rode in on');
  assert.equal(nuke.hits, keptNuke.hits, 'which lost none of its hits by it');

  // Melee is the awkward one. The log reports the slice on SWING_DAMAGE_LANDED
  // and the damage on SWING_DAMAGE, and totals read only the second — so the
  // slice has to be picked up off a code the totals ignore and taken off the
  // one they do not, with the swing itself still counted exactly once.
  const keptMelee = keptDps.spells.find((spell) => spell.name === 'Melee')!;
  assert.equal(keptMelee.total, 2500, 'one swing, not the two lines it took to log it');
  const melee = dps.spells.find((spell) => spell.name === 'Melee')!;
  assert.equal(melee.total, 2500 - 400);

  // The transfer is capped by what the dealer's ability actually holds. The
  // tank's swings total 12000 and only 3000 of that reached the report, the
  // game having written the other one from the victim's side alone — so of the
  // 4000 the buff is owed, 3000 can be paid and the rest cannot. Paying it all
  // would invent damage: on one raid log that was 6M across 2,132 pets, each
  // left with a negative Melee row.
  const keptTank = kept.actors.find((actor) => actor.actorIndex === indexOf(run, TANK))!;
  assert.equal(keptTank.supportReceived, 4000, 'the credit is recorded in full');
  assert.equal(keptTank.total, 3000, 'of which 3000 was ever counted');
  assert.equal(keptTank.spells.find((spell) => spell.name === 'Melee')!.total, 3000);
  assert.equal(
    moved.actors.find((actor) => actor.actorIndex === indexOf(run, TANK)),
    undefined,
    'so the 3000 is all that leaves, and leaves nothing behind',
  );
  assert.equal(given.total, 1900 + 3000, 'and the evoker is paid no more than that');
});

test('a twinned _SUPPORT pair belongs to the supporter, not the dealer', () => {
  const { run, context, segments } = load();
  const report = damageReport(context, segments);
  const dps = report.actors.find((actor) => actor.actorIndex === indexOf(run, DPS))!;
  const healer = report.actors.find((actor) => actor.actorIndex === indexOf(run, HEALER))!;

  // The fixture's Bombardments pair is one 4000 hit written twice: an ordinary
  // SPELL_DAMAGE credited to the player who set the bomb off, and a _SUPPORT
  // copy naming the evoker whose talent it is. The damage is the evoker's.
  const bombs = healer.spells.find((spell) => spell.name === 'Bombardments')!;
  assert.ok(bombs, 'the supporter carries the ability');
  assert.equal(bombs.total, 4000);
  assert.equal(bombs.hits, 1, 'one hit, not the two lines it took to log it');
  assert.ok(
    !dps.spells.some((spell) => spell.name === 'Bombardments'),
    'and the player who triggered it carries none of it',
  );

  // Not credit either: the bomb was never Dee's to be helped with, so it must
  // not read as damage the healer lent them.
  assert.equal(dps.supportReceived, 1900, 'the Ebon Might slices and nothing more');
  assert.equal(healer.supportGiven, 1900 + 4000, 'and the tank swing the buff also rode in on');
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
  // Including what they pressed on themselves, which names them on both sides
  // of the event.
  assert.ok(death.ownCasts.some((c) => c.name === 'Death Pact'), 'a cast aimed at themselves');
  // And excluding what they never pressed. Crusading Strikes is logged as a
  // cast on every auto-attack, so taken at face value a ret paladin presses
  // forty buttons in the ten seconds before dying.
  assert.equal(
    death.ownCasts.some((c) => c.name === 'Crusading Strikes'),
    false,
    'a proc is not a press',
  );
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

// --- Interrupts --------------------------------------------------------------

/** The fixture's presses, rolled up the way the view rolls them up. */
function interrupts() {
  const { context, segments } = load();
  const report = interruptReport(context, segments);
  return { report, summary: summarizeInterrupts(report.attempts, report.stops), segments };
}

function attemptsBy(report: InterruptReport, name: string): InterruptAttempt[] {
  return report.attempts.filter((attempt) => attempt.name.startsWith(name));
}

test('an interrupt names the cast it stopped, not just the button pressed', () => {
  const { report } = interrupts();
  const stop = report.stops[0]!;
  assert.equal(stop.spellName, 'Kick');
  assert.equal(stop.castSpellName, 'Crush', 'the suffix spell is the one that was stopped');
  assert.equal(stop.targetName, 'Warded Ogre');
  // What the party stopped, pooled: the question a key leader actually asks.
  const crush = report.stops.filter((entry) => entry.castSpellId === 666);
  assert.equal(crush.length, 4, 'four of the Ogre\'s five Crushes were stopped');
  const { summary } = interrupts();
  assert.deepEqual(
    summary.stopped.map((cast) => [cast.name, cast.count, cast.sourceName]),
    [['Crush', 4, 'Warded Ogre']],
  );
});

test('a press that stopped nothing is counted, which the log never reports', () => {
  const { summary } = interrupts();
  // Ten presses: four that stopped a cast — one of them pressed by a pet — and
  // six that stopped nothing. Nothing in the log says any of the ten was an
  // interrupt attempt; they are ordinary casts of spells whose only effect is
  // to stop one.
  assert.equal(summary.casts, 10);
  assert.equal(summary.stops, 4);
  assert.equal(summary.whiffs, 6);
  assert.equal(
    summary.actors.reduce((total, actor) => total + actor.casts, 0),
    summary.casts,
    'every press belongs to a player',
  );
});

test('one button logged under two ids is one press, not a press and a whiff', () => {
  const { report, summary } = interrupts();
  // Skull Bash arrives as a cast of 93985 and a cast of 106839 on the same
  // millisecond at the same target, and the interrupt is logged under the
  // first. Taken at face value the healer pressed four interrupts and whiffed
  // two of them.
  const heals = summary.actors.find((actor) => actor.name.startsWith('Heals'))!;
  assert.equal(heals.casts, 2);
  assert.deepEqual(
    heals.abilities.map((ability) => [ability.name, ability.casts]),
    [['Skull Bash', 2]],
    'one ability row, not one per id',
  );
  // And the pairing still finds the interrupt, which carries the other id.
  const landed = attemptsBy(report, 'Heals').find((attempt) => attempt.stops > 0)!;
  assert.equal(landed.outcome, 'interrupted');
  assert.equal(landed.castSpellName, 'Crush');
});

test("a pet's interrupt is its owner's", () => {
  const { report } = interrupts();
  const pressed = attemptsBy(report, 'Dee').find((attempt) => attempt.petName !== '')!;
  assert.equal(pressed.spellName, 'Spell Lock');
  assert.equal(pressed.petName, 'Tyrant');
  assert.equal(pressed.outcome, 'interrupted');
  assert.equal(report.stops.some((stop) => stop.name.startsWith('Tyrant')), false, 'credited to Dee');
});

test('an enemy interrupting a player is not one of the party\'s interrupts', () => {
  const { report } = interrupts();
  assert.equal(
    report.stops.some((stop) => stop.name.startsWith('Warded')),
    false,
  );
  assert.equal(report.stops.length, 4, 'four stops, all of them the party\'s');
});

test('a whiff says what became of the cast it was about', () => {
  const { report } = interrupts();
  const whiffs = report.attempts.filter((attempt) => attempt.stops === 0);
  const outcomes = new Map(whiffs.map((attempt) => [attempt.outcome, attempt]));
  // Every outcome a whiff can have, once each, which is what the fixture was
  // built to produce.
  assert.equal(outcomes.size, whiffs.length, 'no two whiffs share an outcome here');
  assert.deepEqual(
    [...outcomes.keys()].sort(),
    ['doubled', 'early', 'ignored', 'late', 'missed', 'nothing'],
  );

  // Someone else got the cast first, which is most whiffs in a real key.
  const doubled = outcomes.get('doubled')!;
  assert.equal(doubled.name.startsWith('Dee'), true);
  assert.equal(doubled.castSpellName, 'Crush');
  assert.equal(doubled.beatenBy.startsWith('Tank'), true);

  // The press landed inside a cast that completed anyway.
  assert.equal(outcomes.get('ignored')!.castSpellName, 'Crush');
  // The cast had already gone off.
  assert.equal(outcomes.get('late')!.castSpellName, 'Crush');
  // The log reports the press itself as missing, so the target's casts are
  // beside the point.
  assert.equal(outcomes.get('missed')!.spellName, 'Skull Bash');
  // The target began casting just after the press.
  assert.equal(outcomes.get('early')!.castSpellName, 'Terrify');
});

test('a press at a target that was not casting is told from one that was', () => {
  const { report } = interrupts();
  const idle = report.attempts.filter((attempt) => attempt.outcome === 'nothing');
  assert.equal(idle.length, 1);
  assert.equal(idle[0]!.name.startsWith('Tank'), true);
  // No cast to name, which is the whole content of the outcome.
  assert.equal(idle[0]!.castSpellId, 0);
  assert.equal(idle[0]!.castSpellName, '');
});

test('an attempt belongs to its target\'s pull, not to the clock', () => {
  const { report, segments } = interrupts();
  // The Kick at t=119.6 is aimed at the straggler, which was engaged at t=60
  // and dragged through the boss fight. Everything else at that moment is in
  // the last pull.
  const early = report.attempts.find((attempt) => attempt.outcome === 'early')!;
  const dragged = labelled(segments, 'Straggler');
  assert.equal(early.segmentId, dragged.id);
  const ogre = report.attempts.find((attempt) => attempt.targetName === 'Warded Ogre')!;
  assert.notEqual(ogre.segmentId, dragged.id);
  assert.equal(segments.get(ogre.segmentId)?.enemies.includes(ogre.targetIndex), true);
});

test('summarising a pull is the same question asked of fewer attempts', () => {
  const { report, segments } = interrupts();
  // What the view does when a pull is selected: the same roll-up over the
  // attempts that belong to it, rather than a second report to compute.
  const dragged = labelled(segments, 'Straggler');
  const summary = summarizeInterrupts(
    report.attempts.filter((attempt) => attempt.segmentId === dragged.id),
    report.stops.filter((stop) => stop.segmentId === dragged.id),
  );
  assert.equal(summary.casts, 1);
  assert.equal(summary.stops, 0);
  assert.equal(summary.whiffs, 1);
  assert.deepEqual(summary.stopped, []);
  assert.equal(summary.actors[0]!.outcomes.early, 1);
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
  assert.equal(segments.forces.required, 0);
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
  // Kills owe the whole requirement; nothing is taken off for an objective.
  assert.equal(segments.forces.required, 100);
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

test('an enemy driven to the health floor counts without a death event', () => {
  // The straggler is tagged twice and never reported dead, so it is worth
  // nothing — until one more hit leaves it at 1 health and it is never heard
  // from again. That is how Temple of Sethraliss' Static Anomalies read, and
  // the game credits them: six at 5 apiece, 30 of the 687 it asks for.
  const lines = LOG_TEXT.split('\n');
  const end = lines.findIndex((line) => line.includes('CHALLENGE_MODE_END'));
  assert.ok(end > 0, 'the fixture key ends');
  lines.splice(end, 0, hit(80, DPS, 'Dee', creature(1003, 4), 'Straggler', 500, { hp: 1, hpMax: 1000000 }));

  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(lines.join('\n'));
  session.end();
  const run = session.runs[0]!;
  const lookup = forcesFor(FORCES, 500);
  assert.ok(lookup);
  const segments = buildSegments(contextFor(session, run), { forces: lookup });

  // By npc id, not by label: one more hit puts it inside the boss window, so
  // the reassignment pass moves it onto that segment.
  const straggler = segments.segments
    .flatMap((segment) => segment.roster)
    .find((group) => group.npcId === 1003);
  assert.ok(straggler, 'the straggler is still in a roster');
  assert.equal(straggler.killed, 1, 'pinned at the floor and never heard from again is defeated');
  assert.equal(straggler.forces, 7);
  assert.equal(segments.forces.counted, 39, 'the 32 the kills reported plus its 7');
});

test('a wave that despawns untouched is still not credited', () => {
  // The other half of the floor rule: these are never damaged, so they are in
  // no segment, and their health is never the subject of a block it reads. A
  // real +12 Voidscar Arena had fourteen of them and counting them took the
  // run from 100.5% to 106.2%.
  const { segments } = loadWithForces();
  assert.equal(segments.forces.counted, 32);
});

/** The fixture table with a different requirement, which is the only field these need. */
function withTotal(total: number) {
  return {
    ...FORCES,
    dungeons: [{ ...FORCES.dungeons[0]!, total }],
  };
}

test('a completed key whose values fall short of the requirement is flagged', () => {
  // The fixture key is completed and its kills come to 32 of 100, which is not
  // a thing the game can produce: forces are a completion requirement, so the
  // run reached 100% and something about this table is short.
  const { run, segments } = loadWithForces();
  assert.equal(run.meta.success, true);
  assert.equal(segments.forces.counted, 32);
  assert.equal(segments.forces.incomplete, true);
});

test('a completed key whose kills exactly meet the requirement is not flagged', () => {
  const { segments } = loadWithForces(withTotal(32));
  assert.equal(segments.forces.counted, 32);
  assert.equal(segments.forces.required, 32);
  assert.equal(segments.forces.fraction, 1);
  assert.equal(segments.forces.incomplete, false);
});

test('one short of the requirement still leaves a completed key flagged', () => {
  const { segments } = loadWithForces(withTotal(33));
  assert.equal(segments.forces.required, 33);
  assert.equal(segments.forces.fraction, 32 / 33);
  assert.equal(segments.forces.incomplete, true);
});

test('killing more than the requirement reads over 100% rather than capping', () => {
  // The overpull is information: a dungeon holds more count than it asks for,
  // so every route overshoots, and that is what a route planner shows too.
  const { segments } = loadWithForces(withTotal(30));
  assert.equal(segments.forces.required, 30);
  assert.ok(segments.forces.fraction > 1);
  assert.equal(segments.forces.incomplete, false);
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

// --- Crowd control ---------------------------------------------------------

function control() {
  const { context, segments } = load();
  const report = crowdControlReport(context, segments);
  return { report, summary: summarizeCrowdControl(report.applications), segments };
}

function appliedTo(report: ControlReport, target: string, spellId: number): ControlApplication[] {
  return report.applications.filter(
    (entry) => entry.targetName === target && entry.spellId === spellId,
  );
}

test('one area control is one press and several targets', () => {
  // The number the whole report turns on. A Leg Sweep that caught two totems
  // is one button press, and counting applications — which is what the log
  // gives you — would report it as two.
  const { report, summary } = control();
  const sweeps = report.applications.filter((entry) => entry.spellId === 119381);
  assert.equal(sweeps.length, 2, 'two totems caught');
  assert.equal(sweeps[0]!.castId, sweeps[1]!.castId, 'both came from one press');
  const dee = summary.actors.find((actor) => actor.name.startsWith('Dee'))!;
  const sweep = dee.abilities.find((ability) => ability.spellId === 119381)!;
  assert.equal(sweep.casts, 1);
  assert.equal(sweep.targets, 2);
});

test('seconds are the aura, not the tooltip', () => {
  // A thirty-second sheep that ran its course, read off the gap between the
  // application and the removal. Nothing in the log states the duration.
  const { report } = control();
  const poly = appliedTo(report, 'Straggler', 28271);
  assert.equal(poly.length, 1);
  assert.equal(poly[0]!.durationMs, 30_000);
  assert.equal(poly[0]!.end, 'expired');
});

test('a control damage broke early is counted as the seconds it lasted', () => {
  // The reason a control chart reads low, and the only line that says so is
  // the SPELL_AURA_BROKEN_SPELL. Two seconds of a thirty-second sheep.
  const { report, summary } = control();
  const broken = appliedTo(report, 'Warded Ogre', 28271);
  assert.equal(broken.length, 1);
  assert.equal(broken[0]!.end, 'broken');
  assert.equal(broken[0]!.durationMs, 2000);
  assert.equal(summary.broken, 1, 'one of the key\'s controls was broken');
});

test('a mob that dies still held ends the control there', () => {
  // Without this the stun would be left open and credited with the longest
  // Chaos Nova in the key, which in a key with only one would be nothing at
  // all — and in a real one, somebody else's three seconds.
  const { report } = control();
  const nova = appliedTo(report, 'Wave Minion', 179057);
  assert.equal(nova.length, 1);
  assert.equal(nova[0]!.end, 'died');
  assert.equal(nova[0]!.durationMs, 500);
});

test('an aura the log never removes is bounded by one it did', () => {
  // The despawn case. The second Leg Sweep is never taken off, and what it is
  // credited with is the three seconds the first one was measured at — not the
  // rest of the key, and not a flat cap that would invent a minute.
  const { report } = control();
  const open = appliedTo(report, 'Magma Totem', 119381).filter((entry) => entry.end === 'open');
  assert.equal(open.length, 1, 'one sweep was never removed');
  assert.equal(open[0]!.durationMs, 3000, "bounded by the sweep that did come off");
});

test('a guardian\'s control is its owner\'s', () => {
  // The same rollup as a pet's damage: the warlock pressed it.
  const { report } = control();
  const fury = report.applications.filter((entry) => entry.spellId === 30283);
  assert.equal(fury.length, 1);
  assert.equal(fury[0]!.petName, 'Tyrant', 'the pet that cast it is named');
  assert.ok(fury[0]!.name.startsWith('Dee'), `credited to the owner, got ${fury[0]!.name}`);
});

test('only the party controlling an enemy counts', () => {
  // Four auras in the fixture would each pass a looser test: an enemy's stun
  // on a player, a player's stun on a player, a buff that carries a control
  // aura, and a slow. All four are in the log at 108.6-108.9 and none of them
  // is the party controlling something.
  const { report, summary } = control();
  assert.equal(
    report.applications.filter((entry) => entry.spellId === 853).length,
    0,
    'no Hammer of Justice: every one in the fixture is a buff, friendly, or an enemy\'s',
  );
  assert.equal(
    report.applications.filter((entry) => entry.spellId === 204242).length,
    0,
    'Consecration is a slow, which is not control',
  );
  // What is left is exactly the six real applications: two Leg Sweeps, two
  // sheep, a Shadowfury and a Chaos Nova.
  assert.equal(summary.targets, 6);
  assert.equal(summary.casts, 5, 'five presses, one of which caught two totems');
});

test('a pull filters control the way it filters everything else', () => {
  // Every application carries its target's segment, so a pull is a filter on
  // the one list rather than a second report. The sheep on the straggler
  // belongs to the straggler's pull, not to the boss it was dragged into.
  const { report, segments } = control();
  const poly = appliedTo(report, 'Straggler', 28271)[0]!;
  const straggler = segments.segments.find((segment) => segment.label === 'Straggler')!;
  assert.equal(poly.segmentId, straggler.id);
  const inPull = summarizeCrowdControl(
    report.applications.filter((entry) => entry.segmentId === straggler.id),
  );
  assert.equal(inPull.casts, 1);
  assert.equal(inPull.ms, 30_000);
});

test('what a control does to the unit comes off the table, not the name', () => {
  const { report } = control();
  const poly = appliedTo(report, 'Straggler', 28271)[0]!;
  assert.deepEqual(controlKindNames(poly.kinds), ['disorient'], 'a sheep is a disorient');
  const nova = appliedTo(report, 'Wave Minion', 179057)[0]!;
  assert.deepEqual(controlKindNames(nova.kinds), ['stun']);
});

// --- Dispels ----------------------------------------------------------------

function dispels() {
  const { context, segments } = load();
  const report = dispelReport(context, segments);
  return { report, summary: summarizeDispels(report.dispels), segments };
}

test('dispels are sorted into purges, soothes and cleanses', () => {
  const { summary } = dispels();
  // Two Purges and a Spellsteal; a Soothe; a Singe Magic, a Cleanse and a
  // Revival that took two.
  assert.deepEqual(summary.byKind, { purge: 3, soothe: 1, cleanse: 4 });
  assert.equal(summary.removed, 8);
});

test('an enrage taken off an enemy is a soothe, a magic buff a purge', () => {
  const { report } = dispels();
  const soothe = report.dispels.find((entry) => entry.spellId === 2908)!;
  assert.equal(soothe.kind, 'soothe');
  assert.equal(soothe.auraName, 'Berserker Rage', 'what came off is named, not just the button');
  const purge = report.dispels.find((entry) => entry.spellId === 370)!;
  assert.equal(purge.kind, 'purge');
});

test('a spellsteal is a purge, and says the buff was taken', () => {
  const { report } = dispels();
  const steal = report.dispels.find((entry) => entry.spellId === 30449)!;
  assert.equal(steal.kind, 'purge');
  assert.equal(steal.stolen, true);
});

test('one mass dispel is one press and several auras', () => {
  // Revival took two in the same millisecond; the two Purges 1.2s apart are
  // two presses, which a crowd-control-sized window would have merged.
  const { summary } = dispels();
  const heals = summary.actors.find((actor) => actor.name.startsWith('Heals'))!;
  const revival = heals.abilities.find((ability) => ability.spellId === 115310)!;
  assert.equal(revival.removed, 2);
  assert.equal(revival.casts, 1);
  const dee = summary.actors.find((actor) => actor.name.startsWith('Dee'))!;
  const purge = dee.abilities.find((ability) => ability.spellId === 370)!;
  assert.equal(purge.casts, 2);
});

test("a pet's dispel is its owner's", () => {
  const { report } = dispels();
  const singe = report.dispels.find((entry) => entry.spellId === 89808)!;
  assert.equal(singe.petName, 'Imp');
  assert.ok(singe.name.startsWith('Dee'), `credited to the owner, got ${singe.name}`);
});

test('a root-breaker, an enemy purge and a buff off a friend are not dispels', () => {
  const { report } = dispels();
  assert.ok(!report.dispels.some((entry) => entry.spellId === 768), 'Cat Form breaks roots, it does not dispel');
  assert.ok(!report.dispels.some((entry) => entry.auraId === 7007), "the boss's purge is not the party's");
  assert.ok(!report.dispels.some((entry) => entry.spellId === 32592), 'a buff off a friend is not a purge');
});

test('a purge belongs to its target\'s pull, a cleanse to the pull it happened in', () => {
  // A cleanse names no enemy, so it is filed by time like a death.
  const { report, segments } = dispels();
  const boss = labelled(segments, 'Big Bad');
  for (const entry of report.dispels) assert.equal(entry.segmentId, boss.id, `${entry.spellName} at ${entry.ts}`);
});

test('one mechanic under two aura ids is one line of what came off', () => {
  // Real keys do this: Corroding Spittle came off one party as two ids.
  const { report } = dispels();
  const base = report.dispels.find((entry) => entry.kind === 'cleanse')!;
  const twin = { ...base, auraId: base.auraId + 1 };
  const summary = summarizeDispels([base, twin]);
  assert.equal(summary.auras.length, 1);
  assert.equal(summary.auras[0]!.count, 2);
});

// --- Avoidable damage ---------------------------------------------------------

/**
 * A key of its own rather than more lines in the shared fixture, because the
 * list is keyed on real spell ids and dungeons: this one is Murder Row, and
 * every id below is a real Xathuux ability.
 */
function murderRow(challengeModeId = 587) {
  const xathuux = creature(228470, 40);
  const lines = [
    LINES[0]!,
    `${at(0)}  CHALLENGE_MODE_START,"Murder Row",2000,${challengeModeId},12,[10,9,147]`,
    ...LINES.filter((line) => line.includes('COMBATANT_INFO')),
    hit(10, DPS, 'Dee', xathuux, 'Xathuux', 1000),
    // His puddles: counted.
    taken(11, xathuux, 'Xathuux', DPS, 'Dee', 5000, { spellId: 474234, spellName: 'Burning Steps' }),
    // The chaos hit on everyone that comes with them: not.
    taken(12, xathuux, 'Xathuux', DPS, 'Dee', 3000, { spellId: 474197, spellName: 'Demonic Rage' }),
    // His frontal, on the tank who is meant to take it and on the healer who
    // is not.
    taken(13, xathuux, 'Xathuux', TANK, 'Tank', 8000, { spellId: 473898, spellName: 'Legion Strike' }),
    taken(14, xathuux, 'Xathuux', HEALER, 'Heals', 7000, { spellId: 473898, spellName: 'Legion Strike' }),
    // A last tick of the puddle that killed: 1000 of the 4000 was overkill.
    taken(15, xathuux, 'Xathuux', DPS, 'Dee', 4000, { spellId: 474234, spellName: 'Burning Steps', overkill: 1000 }),
    `${at(30)}  CHALLENGE_MODE_END,2000,1,12,30000,30`,
  ];
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(lines.join('\n') + '\n');
  session.end();
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  return avoidableReport(context, buildSegments(context));
}

test('a puddle counts and the hit that came with it does not', () => {
  const { hits } = murderRow();
  const dee = hits.filter((entry) => entry.name.startsWith('Dee'));
  assert.deepEqual(dee.map((entry) => entry.spellName), ['Burning Steps', 'Burning Steps']);
});

test("a tank frontal counts against everyone but the tank", () => {
  const { hits } = murderRow();
  const strikes = hits.filter((entry) => entry.spellId === 473898);
  assert.deepEqual(strikes.map((entry) => entry.name), ['Heals']);
});

test('amounts are net of overkill, and a killing blow says so', () => {
  const summary = summarizeAvoidable(murderRow().hits);
  const dee = summary.actors.find((actor) => actor.name.startsWith('Dee'))!;
  assert.equal(dee.amount, 5000 + 3000);
  assert.equal(dee.deaths, 1);
  assert.equal(summary.amount, 8000 + 7000);
  // Worst offender first.
  assert.equal(summary.actors[0]!.name, 'Dee');
  assert.equal(summary.abilities[0]!.name, 'Burning Steps');
});

test('a dungeon the list does not cover says so instead of reading clean', () => {
  assert.equal(murderRow().covered, true);
  assert.equal(murderRow(500).covered, false);
});

/**
 * Altar of Fangs' Infest: a DoT on everyone, and a burst around each player as
 * theirs runs out. The burst on its own bearer is unavoidable; landing on
 * anyone else, it is not. Gaps between removal and burst are the real ones.
 */
function infest() {
  const serpent = creature(261573, 50);
  const off = (seconds: number, dst: string, name: string) =>
    aura(seconds, serpent, 'Ascendant Serpent', dst, name, 1308865, 'Infest', false, { srcFlags: '0xa48', dstFlags: '0x511' });
  const tick = (seconds: number, dst: string, name: string) =>
    taken(seconds, serpent, 'Ascendant Serpent', dst, name, 1000, { spellId: 1309382, spellName: 'Infest' });
  const burst = (seconds: number, dst: string, name: string) =>
    taken(seconds, serpent, 'Ascendant Serpent', dst, name, 5000, { spellId: 1309398, spellName: 'Infest' });
  const lines = [
    LINES[0]!,
    `${at(0)}  CHALLENGE_MODE_START,"Altar of Fangs",2000,588,12,[10,9,147]`,
    ...LINES.filter((line) => line.includes('COMBATANT_INFO')),
    tick(10, DPS, 'Dee'),
    tick(10, HEALER, 'Heals'),
    // The tank's runs out and bursts on the tank, and on Dee beside them.
    off(15, TANK, 'Tank'),
    burst(15, TANK, 'Tank'),
    burst(15, DPS, 'Dee'),
    // Dee's own, 14ms late.
    off(15.1, DPS, 'Dee'),
    burst(15.114, DPS, 'Dee'),
    // The healer's own, and later a stray one when theirs is long gone.
    off(15.3, HEALER, 'Heals'),
    burst(15.3, HEALER, 'Heals'),
    burst(16, HEALER, 'Heals'),
    `${at(30)}  CHALLENGE_MODE_END,2000,1,12,30000,30`,
  ];
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(lines.join('\n') + '\n');
  session.end();
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  return avoidableReport(context, buildSegments(context));
}

test("Infest's burst counts on everyone but the player whose debuff it was", () => {
  const { hits } = infest();
  assert.deepEqual(
    hits.map((entry) => `${entry.spellId} on ${entry.name.split('-')[0]}`),
    ['1309398 on Dee', '1309398 on Heals'],
  );
});

/**
 * Den of Nalorakk's Spectral Slash: a stacking DoT from an Echo of Nalorakk.
 * Whoever stops the Echoes charging Zul'jarra is slashed under a second into
 * Forceful Slam, which is the job; walking into one is the fail.
 */
function spectralSlash() {
  const nalorakk = creature(246404, 60);
  const echo = creature(246500, 61);
  const slam = `${at(20)}  SPELL_CAST_START,${nalorakk},"Nalorakk",0xa48,0x0,0000000000000000,nil,0x80000000,0x80000000,1297797,"Forceful Slam",0x1`;
  const on = (seconds: number, dst: string, name: string, up = true) =>
    aura(seconds, echo, 'Echo of Nalorakk', dst, name, 1255577, 'Spectral Slash', up, { srcFlags: '0xa48', dstFlags: '0x511' });
  const tick = (seconds: number, dst: string, name: string) =>
    taken(seconds, echo, 'Echo of Nalorakk', dst, name, 1000, { spellId: 1255577, spellName: 'Spectral Slash' }).replace(
      'SPELL_DAMAGE',
      'SPELL_PERIODIC_DAMAGE',
    );
  const lines = [
    LINES[0]!,
    `${at(0)}  CHALLENGE_MODE_START,"Den of Nalorakk",2000,586,12,[10,9,147]`,
    ...LINES.filter((line) => line.includes('COMBATANT_INFO')),
    // Dee walks into one before any slam.
    on(5, DPS, 'Dee'),
    tick(5, DPS, 'Dee'),
    on(9, DPS, 'Dee', false),
    slam,
    // The tank and the healer stop two Echoes, and keep ticking after.
    on(20.8, TANK, 'Tank'),
    tick(20.8, TANK, 'Tank'),
    on(21.1, HEALER, 'Heals'),
    tick(21.1, HEALER, 'Heals'),
    tick(22.8, TANK, 'Tank'),
    tick(23.1, HEALER, 'Heals'),
    // The last tick lands just after the aura comes off, as the game logs it.
    on(30, TANK, 'Tank', false),
    tick(30.001, TANK, 'Tank'),
    on(31, HEALER, 'Heals', false),
    // Dee again, well after the slam.
    on(24, DPS, 'Dee'),
    tick(24, DPS, 'Dee'),
    `${at(40)}  CHALLENGE_MODE_END,2000,1,12,40000,40`,
  ];
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(lines.join('\n') + '\n');
  session.end();
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  return avoidableReport(context, buildSegments(context));
}

test('a slash from stopping the Echoes is not counted, and walking into one is', () => {
  const { hits } = spectralSlash();
  assert.deepEqual(
    hits.map((entry) => `${entry.spellName} on ${entry.name.split('-')[0]}`),
    ['Spectral Slash on Dee', 'Spectral Slash on Dee'],
  );
});

/**
 * A short key on one map: a tank walked from (10,10) to (40,40) while hitting
 * a mob that started untouched at (50,60), and a second mob first seen already
 * hurt. Every coordinate has a fraction, as the game always writes one: the
 * parser finds positionX by its decimal point.
 */
function positionsRun() {
  const ward = creature(2001, 1);
  const hurt = creature(2002, 2);
  const lines = [
    `${at(-60)}  MAP_CHANGE,2291,"Test Hold",300.000000,0.000000,400.000000,0.000000`,
    `${at(0)}  CHALLENGE_MODE_START,"Test Hold",2000,500,15,[10,9,147]`,
    ...LINES.filter((line) => line.includes('COMBATANT_INFO')),
    hit(1, TANK, 'Tank', ward, 'Ward', 0, { pos: { x: 50.5, y: 60.5 } }),
    hit(1.1, TANK, 'Tank', ward, 'Ward', 100, { hp: 900, pos: { x: 49.5, y: 59.5 } }),
    hit(1.3, TANK, 'Tank', ward, 'Ward', 100, { hp: 800, pos: { x: 45.5, y: 55.5 } }),
    hit(2, DPS, 'Dee', hurt, 'Hurt', 100, { hp: 500, pos: { x: 70.5, y: 80.5 } }),
    hit(3, DPS, 'Dee', hurt, 'Hurt', 100, { hp: 1000, pos: { x: 71.5, y: 81.5 } }),
    taken(4, ward, 'Ward', TANK, 'Tank', 10, { pos: { x: 10.5, y: 10.5 } }),
    taken(5, ward, 'Ward', TANK, 'Tank', 10, { pos: { x: 20.5, y: 20.5 } }),
    taken(10, ward, 'Ward', TANK, 'Tank', 10, { pos: { x: 40.5, y: 40.5 } }),
    died(11, ward, 'Ward', '0xa48'),
    `${at(30)}  CHALLENGE_MODE_END,2000,1,15,30000,30`,
  ];
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(lines.join('\n') + '\n');
  session.end();
  const run = session.runs[0]!;
  const context = contextFor(session, run);
  const report = positionTracks(context, buildSegments(context));
  const track = (guid: string) => report.tracks.find((t) => t.actor === indexOf(run, guid))!;
  return { report, ward: track(ward), hurt: track(hurt), tank: track(TANK) };
}

test('position tracks thin a busy unit to four samples a second', () => {
  const { report, ward, tank } = positionsRun();
  assert.equal(report.tracks[0]!.kind, TrackKind.PARTY, 'party first');
  assert.equal(ward.kind, TrackKind.ENEMY);
  assert.equal(ward.npcId, 2001);
  assert.ok(ward.segmentId >= 0, 'an enemy carries the pull it was in');
  // 1.1s is 100ms after the first sample and dropped; 1.3s is kept.
  assert.deepEqual([...ward.ts], [1000, 1300]);
  assert.deepEqual([...ward.hpPct], [100, 80]);
  assert.deepEqual(ward.deaths, [11000]);
  assert.deepEqual([...tank.uiMapId], [2291, 2291, 2291]);
  assert.equal(tank.home, null, 'a player has no spawn point');
  assert.deepEqual(report.maps.map((map) => map.uiMapId), [2291]);
});

test("an enemy's home is where it stood untouched, not where it was dragged", () => {
  const { ward, hurt } = positionsRun();
  assert.deepEqual(ward.home, { ts: 1000, x: 50.5, y: 60.5, uiMapId: 2291 });
  // Never seen at full health before it was hit: the first sight will do.
  // The later full-health sample is a heal, not a spawn.
  assert.deepEqual(hurt.home, { ts: 2000, x: 70.5, y: 80.5, uiMapId: 2291 });
});

test('a replay interpolates across a short gap and holds across a long one', () => {
  const { tank } = positionsRun();
  assert.equal(positionAt(tank, 3000), null, 'not seen yet');
  const mid = positionAt(tank, 4500)!;
  assert.equal(mid.x, 15.5);
  assert.equal(mid.y, 15.5);
  // 5s to 10s is longer than the gap the tank may be glided across.
  assert.equal(positionAt(tank, 7000)!.x, 20.5);
  assert.equal(positionAt(tank, 60000)!.x, 40.5, 'the last sample holds');
});

test('a world position lands on its map image a quarter turn round', () => {
  const { report } = positionsRun();
  const bounds = report.maps[0]!;
  // North (high X) is the top of the image; west (high Y) is the left.
  assert.deepEqual(mapPoint(bounds, 300, 400), { u: 0, v: 0 });
  assert.deepEqual(mapPoint(bounds, 0, 0), { u: 1, v: 1 });
  assert.deepEqual(mapPoint(bounds, 150, 100), { u: 0.75, v: 0.5 });
});

// --- Raid pulls ---------------------------------------------------------------

/**
 * A raid wipe with everything that makes counting its dead hard: a Feign
 * Death, a battle res, and a shaman's Reincarnation.
 */
function raidWipe() {
  const STATS = '0,1,1,1,1,1,0,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1';
  const TAIL = '[(1,1)],[],[],[],[],1,0,0,0';
  const unitDied = (seconds: number, guid: string, name: string, unconscious: 0 | 1): string =>
    `${at(seconds)}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${guid},"${name}",0x512,0x80000000,${unconscious}`;
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      `${at(0)}  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657`,
      `${at(0)}  COMBATANT_INFO,${TANK},${STATS},250,${TAIL}`,
      `${at(0)}  COMBATANT_INFO,${HEALER},${STATS},264,${TAIL}`,
      `${at(0)}  COMBATANT_INFO,${DPS},${STATS},255,${TAIL}`,
      unitDied(5, DPS, 'Dee', 1),
      unitDied(10, TANK, 'Tank', 0),
      unitDied(12, HEALER, 'Heals', 0),
      `${at(15)}  SPELL_RESURRECT,${DPS},"Dee",0x512,0x80000000,${TANK},"Tank",0x512,0x80000000,61999,"Raise Ally",0x20`,
      unitDied(20, DPS, 'Dee', 0),
      `${at(22)}  SPELL_CAST_SUCCESS,${HEALER},"Heals",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,21169,"Reincarnation",0x8`,
      unitDied(25, TANK, 'Tank', 0),
      `${at(30)}  ENCOUNTER_END,2902,"Ulgrax the Devourer",16,20,0,30000`,
      '',
    ].join('\n'),
  );
  session.end();
  assert.equal(session.runs.length, 1, 'one pull');
  const context = contextFor(session, session.runs[0]!);
  return deathReports(context, buildSegments(context, { forces: null }));
}

test('a Feign Death is not a death', () => {
  const deaths = raidWipe();
  assert.ok(!deaths.some((death) => death.ts === 5000), 'the hunter feigning at 5s');
  assert.deepEqual(
    deaths.map((death) => death.name),
    ['Tank', 'Heals', 'Dee', 'Tank'],
  );
});

test('a death counts who was dead at once, net of battle res and Reincarnation', () => {
  // By place in the list this reads 1, 2, 3, 4. The tank was raised before
  // the third death and the shaman came back before the fourth.
  assert.deepEqual(
    raidWipe().map((death) => death.deadAtOnce),
    [1, 2, 2, 2],
  );
});

/**
 * A raid pull at 60s, in a raid zone so the minute before it is buffered, with
 * whatever happened around it. The boss stands at (130, 200); the party at
 * (100, 200) unless a line says otherwise.
 */
function raidPull(lines: string[]): PullReport | null {
  const STATS = '0,1,1,1,1,1,0,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1';
  const TAIL = '[(1,1)],[],[],[],[],1,0,0,0';
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      `${at(0)}  ZONE_CHANGE,2657,"Nerub-ar Palace",16`,
      ...lines.filter((line) => line < at(60)),
      `${at(60)}  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657`,
      `${at(60)}  COMBATANT_INFO,${TANK},${STATS},250,${TAIL}`,
      `${at(60)}  COMBATANT_INFO,${HEALER},${STATS},264,${TAIL}`,
      `${at(60)}  COMBATANT_INFO,${DPS},${STATS},258,${TAIL}`,
      ...lines.filter((line) => line >= at(60)),
      hit(64, TANK, 'Tank', BOSS, 'Ulgrax', 100, { pos: { x: 130, y: 200 } }),
      `${at(90)}  ENCOUNTER_END,2902,"Ulgrax the Devourer",16,20,0,30000`,
      '',
    ].join('\n'),
  );
  session.end();
  assert.equal(session.runs.length, 1, 'one pull');
  return whoPulled(contextFor(session, session.runs[0]!));
}

const BOSS = creature(215657, 1);

const cast = (seconds: number, guid: string, name: string, spellId: number, spellName: string): string =>
  `${at(seconds)}  SPELL_CAST_SUCCESS,${guid},"${name}",0x511,0x0,${BOSS},"Ulgrax",0xa48,0x0,${spellId},"${spellName}",0x20`;

test('who pulled is whoever landed first, with the cast that sent it', () => {
  const pull = raidPull([
    // Hunter's Mark goes on early and does not pull.
    `${at(59.5)}  SPELL_AURA_APPLIED,${HEALER},"Heals",0x511,0x0,${BOSS},"Ulgrax",0xa48,0x0,257284,"Hunter's Mark",0x8,DEBUFF`,
    cast(58.8, DPS, 'Dee', 8092, 'Mind Blast'),
    hit(60.02, DPS, 'Dee', BOSS, 'Ulgrax', 100, { spellId: 8092, spellName: 'Mind Blast', pos: { x: 130, y: 200 } }),
    hit(60.4, TANK, 'Tank', BOSS, 'Ulgrax', 100, { pos: { x: 130, y: 200 } }),
  ])!;
  assert.equal(pull.first?.spellName, 'Mind Blast');
  assert.equal(pull.first?.ts, 20);
  assert.equal(pull.first?.castTs, -1200, 'the button was pressed 1.2s before the pull');
  assert.equal(pull.confidence, 'clear', 'the tank landed 380ms later');
  assert.equal(pull.tank, false);
  assert.deepEqual(pull.contacts.map((contact) => contact.spellName), ['Mind Blast', 'Nuke']);
});

test('two players landing in the same instant is too close to call', () => {
  const pull = raidPull([
    hit(60.01, TANK, 'Tank', BOSS, 'Ulgrax', 100, { pos: { x: 130, y: 200 } }),
    hit(60.1, DPS, 'Dee', BOSS, 'Ulgrax', 100, { pos: { x: 130, y: 200 } }),
  ])!;
  assert.equal(pull.confidence, 'close');
  assert.equal(pull.tank, true);
});

test('a pull nothing touched names what was summoned just before it', () => {
  const totem = creature(225409, 9);
  const pull = raidPull([
    `${at(58.2)}  SPELL_SUMMON,${HEALER},"Heals",0x511,0x0,${totem},"Surging Totem",0xa28,0x0,444995,"Surging Totem",0x8`,
    // Someone's first hit, seconds after the boss had already pulled.
    hit(63, DPS, 'Dee', BOSS, 'Ulgrax', 100, { pos: { x: 130, y: 200 } }),
  ])!;
  assert.equal(pull.first, null, 'a hit 3s after the START is not what pulled');
  assert.equal(pull.confidence, 'unclear');
  assert.equal(pull.summons.length, 1);
  assert.equal(pull.summons[0]!.spellName, 'Surging Totem');
  assert.equal(pull.summons[0]!.ts, -1800);
  assert.equal(pull.summons[0]!.placed, true);
  assert.equal(pull.contacts[0]?.ts, 3000, 'still listed, as who got there first');
});

test('a key gets no who-pulled report', () => {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(LOG_TEXT);
  session.end();
  assert.equal(whoPulled(contextFor(session, session.runs[0]!)), null);
});

/** The fixture key with `extra` lines just before it ends. */
function statsWith(extra: string[]) {
  const lines = LOG_TEXT.split('\n');
  const end = lines.findIndex((line) => line.includes('CHALLENGE_MODE_END'));
  lines.splice(end, 0, ...extra);
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(lines.join('\n'));
  session.end();
  const context = contextFor(session, session.runs[0]!);
  return statsReport(context, buildSegments(context));
}

function partyKill(seconds: number, src: string, srcName: string, dst: string, dstName: string, srcFlags = '0x511'): string {
  return `${at(seconds)}  PARTY_KILL,${src},"${srcName}",${srcFlags},0x0,${dst},"${dstName}",0xa48,0x0,0`;
}

test('a totem that expired is nobody\'s stomp', () => {
  // The fixture's two Magma Totems die with no PARTY_KILL, the way a totem
  // runs out its duration.
  assert.deepEqual(statsWith([]).totemKills, []);
});

test('a totem is stomped by whoever the log says finished it', () => {
  const totem = creature(1005, 13);
  const kills = statsWith([
    partyKill(104.5, DPS, 'Dee', totem, 'Magma Totem'),
    died(104.5, totem, 'Magma Totem', '0xa48'),
  ]).totemKills;
  assert.equal(kills.length, 1);
  assert.equal(kills[0]!.name, 'Dee');
  assert.equal(kills[0]!.totemName, 'Magma Totem');
  assert.equal(kills[0]!.petName, '');
  assert.ok(kills[0]!.segmentId >= 0, 'filed under the pull it fell in');
});

test("a pet's stomp is its owner's", () => {
  const kills = statsWith([
    partyKill(104.5, PET, 'Imp', creature(1005, 14), 'Magma Totem', '0x1111'),
  ]).totemKills;
  assert.equal(kills.length, 1);
  assert.equal(kills[0]!.name, 'Dee');
  assert.equal(kills[0]!.petName, 'Imp');
});

test('the caster that drops totems is not one', () => {
  const kills = statsWith([
    partyKill(104.5, DPS, 'Dee', creature(1010, 40), 'Ruthless Totemcaller'),
    partyKill(104.6, DPS, 'Dee', creature(1004, 10), 'Flame Shaman'),
  ]).totemKills;
  assert.deepEqual(kills, []);
});

function fall(seconds: number, guid: string, name: string, amount: number, overkill = 0, type = 'Falling'): string {
  const block = `${guid},0000000000000000,1000,1000,0,0,1470,0,0,0,3,100,100,0,100.5,200.5,2291,1.5,70`;
  return `${at(seconds)}  ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,${guid},"${name}",0x511,0x0,${block},${type},${amount},${amount},${overkill},1,0,0,0,nil,nil,nil`;
}

test('a fall is counted for whoever fell, and lava is not a fall', () => {
  const falls = statsWith([
    fall(104, HEALER, 'Heals', 400),
    fall(104.5, HEALER, 'Heals', 1200, 300),
    fall(105, TANK, 'Tank', 900, 0, 'Lava'),
  ]).falls;
  assert.deepEqual(
    falls.map((entry) => [entry.name, entry.amount, entry.fatal]),
    [
      ['Heals', 400, false],
      ['Heals', 900, true],
    ],
  );
});

test('a fall that kills is named in the death, not called melee', () => {
  const lines = LOG_TEXT.split('\n');
  const end = lines.findIndex((line) => line.includes('CHALLENGE_MODE_END'));
  lines.splice(end, 0, fall(104, HEALER, 'Heals', 1200, 300), died(104.1, HEALER, 'Heals'));
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(lines.join('\n'));
  session.end();
  const context = contextFor(session, session.runs[0]!);
  const death = deathReports(context, buildSegments(context)).find((entry) => entry.name === 'Heals');
  assert.ok(death);
  assert.equal(death.killingBlow?.spellName, 'Falling');
});

test("a player's biggest hit is their single largest, not a support share of someone else's", () => {
  const hits = statsWith([
    hit(104, DPS, 'Dee', creature(1004, 10), 'Flame Shaman', 90_000, { spellName: 'Chaos Bolt', spellId: 116858 }),
    hit(104.1, DPS, 'Dee', creature(1004, 10), 'Flame Shaman', 500_000, { support: TANK }),
  ]).biggestHits;
  const dee = hits.find((entry) => entry.name === 'Dee');
  assert.ok(dee);
  assert.equal(dee.amount, 90_000);
  assert.equal(dee.spellName, 'Chaos Bolt');
  assert.equal(dee.targetName, 'Flame Shaman');
});

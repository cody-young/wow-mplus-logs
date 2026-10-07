import assert from 'node:assert/strict';
import test from 'node:test';

import { ActorKind } from '../src/actors.js';
import { Ev, EvFlag } from '../src/events.js';
import { LogSession, type KeyRunMeta, type RaidPullMeta, type Run } from '../src/session.js';
import { TimestampReader } from '../src/timestamp.js';
import { MAX_FIELDS, fieldStr, splitFields } from '../src/tokenizer.js';
import {
  ENEMY,
  GUARDIAN,
  HEALER,
  LEGACY_TEXT,
  LOG_TEXT,
  PET,
  PLAYER,
  PLAYER_NAME,
  TOMB,
} from './fixture.js';

function parseAll(text: string): LogSession {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(text);
  session.end();
  return session;
}

function onlyRun(session: LogSession): Run {
  assert.equal(session.runs.length, 1, 'expected exactly one run');
  return session.runs[0]!;
}

function keyMeta(run: Run): KeyRunMeta {
  assert.equal(run.meta.kind, 'key');
  return run.meta as KeyRunMeta;
}

function raidMeta(run: Run): RaidPullMeta {
  assert.equal(run.meta.kind, 'raid');
  return run.meta as RaidPullMeta;
}

/** Rows in a run's store matching a predicate on (code, index). */
function rows(run: Run, code: Ev): number[] {
  const out: number[] = [];
  for (let i = 0; i < run.store.count; i++) {
    if (run.store.code[i] === code) out.push(i);
  }
  return out;
}

test('tokenizer keeps commas inside quotes and brackets', () => {
  const line = 'CHALLENGE_MODE_START,"Ara-Kara, City of Echoes",2660,503,12,[10,9,147,148]';
  const offsets = new Int32Array(MAX_FIELDS * 2);
  const count = splitFields(line, 'CHALLENGE_MODE_START,'.length, offsets);
  assert.equal(count, 5);
  assert.equal(fieldStr(line, offsets, 0), 'Ara-Kara, City of Echoes');
  assert.equal(fieldStr(line, offsets, 1), '2660');
  assert.equal(fieldStr(line, offsets, 4), '[10,9,147,148]');
});

test('timestamp reads the current format with year and zone offset', () => {
  const reader = new TimestampReader({ assumedYear: 2026 });
  assert.ok(reader.read('9/30/2026 18:50:23.123-4  SPELL_DAMAGE,x'));
  assert.equal(reader.hasYear, true);
  assert.equal(reader.tzOffsetMinutes, -240);
  assert.equal(reader.ms, Date.UTC(2026, 8, 30, 18, 50, 23, 123));
  assert.equal('9/30/2026 18:50:23.123-4  SPELL_DAMAGE,x'.slice(reader.bodyStart, reader.bodyStart + 12), 'SPELL_DAMAGE');
});

test('timestamp reads the legacy format and rolls the year at January', () => {
  const reader = new TimestampReader({ assumedYear: 2026 });
  assert.ok(reader.read('12/31 23:59:59.900  SPELL_DAMAGE,x'));
  const december = reader.ms;
  assert.ok(reader.read('1/1 00:00:00.100  SPELL_DAMAGE,x'));
  assert.ok(reader.ms > december, 'January must follow December, not precede it');
  assert.equal(reader.ms - december, 200);
});

test('session brackets the run and parses its keystone metadata', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const meta = keyMeta(run);
  assert.equal(meta.zoneName, 'Ara-Kara, City of Echoes');
  assert.equal(meta.instanceId, 2660);
  assert.equal(meta.challengeModeId, 503);
  assert.equal(meta.keystoneLevel, 12);
  assert.deepEqual(meta.affixes, [10, 9, 147, 148]);
  assert.equal(meta.success, true);
  assert.equal(meta.totalTimeMs, 1_890_000, 'the keystone timer, death penalty included');
  assert.equal(run.meta.elapsedMs, 1_860_000, 'the time that actually passed');
  assert.equal(run.meta.encounters.length, 1);
  const boss = run.meta.encounters[0]!;
  assert.equal(boss.name, 'Avanoxx');
  assert.equal(boss.success, true);
  // Window bounds are store-relative, so they line up with the event column.
  assert.equal(boss.startTs, Date.UTC(2026, 8, 30, 19, 5, 0) - run.meta.startMs);
  assert.equal(boss.endTs, Date.UTC(2026, 8, 30, 19, 8, 30) - run.meta.startMs);
});

test('events outside a run are not recorded', () => {
  const session = parseAll(LOG_TEXT);
  const run = onlyRun(session);
  // The fixture's last damage line is ten minutes after CHALLENGE_MODE_END.
  for (let i = 0; i < run.store.count; i++) {
    assert.ok(run.store.ts[i]! <= run.meta.endMs! - run.meta.startMs);
  }
  assert.equal(session.current, null);
});

test('damage events resolve amount, overkill and the crit flag', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const damage = rows(run, Ev.SPELL_DAMAGE);
  // Four player hits, one pet hit, and the _SUPPORT variants folded onto the
  // same code so callers need only one branch.
  assert.equal(damage.length, 10);

  const first = damage[0]!;
  assert.equal(run.store.amount[first], 54321);
  assert.equal(run.store.waste[first], -1, 'overkill is -1 on a non-killing hit');
  assert.equal(run.store.flags[first]! & EvFlag.CRITICAL, 0);

  const crit = damage[1]!;
  assert.equal(run.store.amount[crit], 108642);
  assert.ok(run.store.flags[crit]! & EvFlag.CRITICAL, 'crit flag must be set');

  const killing = damage[3]!;
  assert.equal(run.store.amount[killing], 120000);
  assert.equal(run.store.waste[killing], 7400, 'overkill on the killing blow');
});

test('advanced block yields target health and position', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const first = rows(run, Ev.SPELL_DAMAGE)[0]!;
  assert.ok(run.store.flags[first]! & EvFlag.ADVANCED);
  assert.equal(run.store.hpCurrent[first], 120000);
  assert.equal(run.store.hpMax[first], 150000);
  assert.ok(Math.abs(run.store.posX[first]! - 1234.56) < 0.01);
  assert.ok(Math.abs(run.store.posY[first]! - 789.01) < 0.01);
});

test('heals separate effective amount from overhealing', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const heal = rows(run, Ev.SPELL_HEAL)[0]!;
  assert.equal(run.store.amount[heal], 32000);
  assert.equal(run.store.waste[heal], 5000, 'overhealing');
  assert.ok(run.store.flags[heal]! & EvFlag.CRITICAL);
});

test('interrupts record the interrupted spell, not just the interrupting one', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const interrupt = rows(run, Ev.SPELL_INTERRUPT)[0]!;
  assert.equal(run.store.spellId[interrupt], 183752, 'Disrupt');
  assert.equal(run.store.extraSpellId[interrupt], 324652, 'Horrific Scream');
  assert.equal(run.store.flags[interrupt]! & EvFlag.ADVANCED, 0, 'interrupts carry no advanced block');
});

test('pet damage attributes to its owner', () => {
  const session = parseAll(LOG_TEXT);
  const run = onlyRun(session);
  const pet = session.parser.actors.get(PET);
  assert.ok(pet, 'pet actor exists');
  assert.equal(pet.kind, ActorKind.PET);
  const owner = session.parser.actors.get(PLAYER);
  assert.ok(owner);
  assert.equal(pet.ownerIndex, owner.index, 'owner link read from the advanced block');
  assert.equal(session.parser.actors.attribute(pet.index), owner.index);
});

test('a guardian is linked by SPELL_SUMMON, which is the only link it has', () => {
  // A Demonic Tyrant deals a fifth of a demonology warlock's damage and never
  // carries an ownerGUID: it is a Creature- GUID whose damage events describe
  // the victim. Missing this link cost one warlock 63.7M on a real +12.
  const session = parseAll(LOG_TEXT);
  const actors = session.parser.actors;
  const guardian = actors.get(GUARDIAN)!;
  const player = actors.get(PLAYER)!;

  assert.equal(guardian.ownerIndex, -1, 'nothing ever named an owner for it');
  assert.equal(guardian.summonerIndex, player.index, 'but the summon did');
  assert.equal(actors.attribute(guardian.index), player.index, 'so its damage is the warlock\'s');
});

test('a unit a player merely owns is not a unit they control', () => {
  // A Frostfang's Glacial Tomb names the player it encased in its own
  // ownerGUID, exactly as a pet names its master. Reading that as ownership
  // made the ice friendly: the party's damage into it counted for nobody and
  // it disappeared from the pull it belonged to.
  const session = parseAll(LOG_TEXT);
  const actors = session.parser.actors;
  const tomb = actors.get(TOMB)!;
  const player = actors.get(PLAYER)!;

  assert.equal(tomb.ownerIndex, player.index, 'the log does say the player owns it');
  assert.equal(tomb.everPlayerControlled, false, 'but it was never theirs to command');
  assert.equal(actors.attribute(tomb.index), tomb.index, 'so it stays an enemy in its own right');
});

test('COMBATANT_INFO spec id is found structurally, not by field index', () => {
  const session = parseAll(LOG_TEXT);
  const party = session.parser.actors.party();
  assert.equal(party.length, 2);
  const tank = session.parser.actors.get(PLAYER)!;
  assert.equal(tank.inParty, true);
  // The fixture pads the stat run past the pre-12.1.0 layout, so a fixed
  // field index would read a stat here instead of the spec.
  assert.equal(tank.specId, 268, 'Brewmaster');
  assert.equal(session.parser.actors.get(HEALER)!.specId, 270, 'Mistweaver');
});

test('non-ASCII names survive interning', () => {
  const session = parseAll(LOG_TEXT);
  const player = session.parser.actors.get(PLAYER)!;
  assert.equal(session.parser.interner.resolve(player.nameId), PLAYER_NAME);
});

test('enemy npc id is recovered from the GUID', () => {
  const session = parseAll(LOG_TEXT);
  assert.equal(session.parser.actors.get(ENEMY)!.npcId, 191622);
});

test('swing damage reads its 10-field suffix, which has no ST/AOE category', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const swing = rows(run, Ev.SWING_DAMAGE)[0]!;
  assert.equal(run.store.amount[swing], 75979, 'damage taken after armor');
  assert.equal(run.store.waste[swing], -1);
  // The advanced block describes the destination, so this is the player's HP.
  assert.equal(run.store.hpCurrent[swing], 88000);
  assert.equal(run.store.hpMax[swing], 120000);
});

test('ENVIRONMENTAL_DAMAGE has no prefix and its type follows the advanced block', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const fall = rows(run, Ev.ENVIRONMENTAL_DAMAGE)[0]!;
  assert.equal(run.store.amount[fall], 58734);
  assert.equal(run.store.waste[fall], 0, 'overkill, read past the environmentalType field');
  assert.equal(run.store.hpCurrent[fall], 88000, 'advanced block starts right after the base block');
  assert.ok(Math.abs(run.store.posX[fall]! - 1200.5) < 0.01);
});

test('advanced block width is measured, so a 17-field block still parses', () => {
  // LEGACY_TEXT carries the pre-12.1.0 block. If the width were assumed to be
  // 19, positionX would be read from uiMapID and the suffix would shift by two.
  const run = onlyRun(parseAll(LEGACY_TEXT));
  const damage = rows(run, Ev.SPELL_DAMAGE)[0]!;
  assert.ok(run.store.flags[damage]! & EvFlag.ADVANCED, 'the block is present, just narrower');
  assert.ok(Math.abs(run.store.posX[damage]! - 1234.56) < 0.01, 'positions located from the block end');
  assert.ok(Math.abs(run.store.posY[damage]! - 789.01) < 0.01);
  assert.equal(run.store.hpCurrent[damage], 120000, 'health located from the block start');
  assert.equal(run.store.amount[damage], 54321);
  assert.equal(run.store.waste[damage], -1, 'overkill sits one slot earlier without baseAmount');
});

test('SPELL_ABSORBED reads the hit absorbed, not the shield pool', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const absorbed = rows(run, Ev.SPELL_ABSORBED);
  assert.equal(
    absorbed.length,
    6,
    'two shapes, a healer-cast one, two with no attacker and one _SUPPORT copy',
  );

  // 18 fields: no attacker spell, so the prefix slot holds no spell id.
  assert.equal(run.store.amount[absorbed[0]!], 59945, 'absorbed by this hit');
  assert.notEqual(run.store.amount[absorbed[0]!], 833881, 'not the shield total');
  assert.equal(run.store.extraSpellId[absorbed[0]!], 206967, 'the absorbing shield');
  assert.equal(run.store.spellId[absorbed[0]!], 0, 'melee hit has no spell');

  // 21 fields: attacker spell present ahead of the absorber block.
  assert.equal(run.store.amount[absorbed[1]!], 21011);
  assert.equal(run.store.spellId[absorbed[1]!], 1216570, 'the incoming spell');
  assert.equal(run.store.extraSpellId[absorbed[1]!], 206967, 'the absorbing shield');

  // The _SUPPORT copy, whose supporter GUID is appended rather than taking a
  // field's place: an absorb has no ST/AOE category to give up, so every read
  // anchored to the end of the line shifts by one. Read as a plain absorb this
  // row says 4,041 — the shield's pool — instead of the 1,325 of it that this
  // hit consumed.
  const support = absorbed.find((row) => (run.store.flags[row]! & EvFlag.SUPPORT) !== 0)!;
  assert.ok(support !== undefined, 'the copy folds onto the same code');
  assert.equal(run.store.amount[support], 1325);
  assert.equal(run.store.extraSpellId[support], 413984, 'the buff, where the shield usually is');
  assert.equal(run.store.spellId[support], 1216570, 'the incoming spell, as on a plain absorb');
});

test('an absorb that named no attacker is given one by the blow it belongs to', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const absorbed = rows(run, Ev.SPELL_ABSORBED);
  const player = run.actors.get(PLAYER)!.index;
  const nobody = run.actors.get('0000000000000000')!.index;

  // Blizzard writes the attacker as all zeroes on a minority of absorbs, and
  // the hit then belongs to nobody and drops out of the damage table. The
  // *_MISSED on the next line is the same blow — same target, same spell —
  // and it does name them.
  assert.equal(run.store.srcActor[absorbed[3]!], player, 'taken from the miss');
  assert.equal(run.store.amount[absorbed[3]!], 4400);

  // The repair only ever copies an attacker the log actually supplied. With
  // no matching blow there is nothing to copy, and guessing from whatever
  // came next would be worse than the gap it fills.
  assert.equal(run.store.srcActor[absorbed[4]!], nobody, 'left as it was found');
});

test('an absorb names the shield and who cast it, in both shapes', () => {
  const session = parseAll(LOG_TEXT);
  const run = onlyRun(session);
  const { spellNames, interner } = session.parser;
  const absorbed = rows(run, Ev.SPELL_ABSORBED);

  // Without the name the shield is a bare id, which answers nothing: the only
  // reason to record the absorb is knowing what stopped the hit.
  const shieldName = (id: number): string => interner.resolve(spellNames.get(id)!);
  assert.equal(shieldName(206967), 'Will of the Necropolis');
  assert.equal(shieldName(17), 'Power Word: Shield');

  // The caster triple sits at the same distance from the end in both shapes,
  // which is why the melee line and the spell line are both checked.
  const player = run.actors.get(PLAYER)!.index;
  const healer = run.actors.get(HEALER)!.index;
  assert.equal(run.store.extraActor.get(absorbed[0]!), player, 'self-applied, melee shape');
  assert.equal(run.store.extraActor.get(absorbed[1]!), player, 'self-applied, spell shape');
  assert.equal(run.store.extraActor.get(absorbed[2]!), healer, 'cast by the healer');
  assert.equal(run.store.extraSpellId[absorbed[2]!], 17, 'the healer-cast shield');
});

test('SPELL_HEAL_ABSORBED has no critical flag, so its tail differs', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const row = rows(run, Ev.SPELL_HEAL_ABSORBED)[0]!;
  assert.equal(run.store.amount[row], 1225);
  assert.equal(run.store.extraSpellId[row], 45470, 'the heal that was absorbed');
  assert.equal(run.store.spellId[row], 116888, 'the absorbing effect');
});

test('_SUPPORT damage records the supporter without double-counting', () => {
  const session = parseAll(LOG_TEXT);
  const run = onlyRun(session);
  const { store } = run;
  // The event folds onto the base code with the SUPPORT flag, so a damage
  // table sees one event kind and decides attribution itself.
  const row = [...store.support.keys()].find((at) => store.spellId[at] === 395152)!;
  assert.equal(store.code[row], Ev.SPELL_DAMAGE);
  assert.ok(store.flags[row]! & EvFlag.SUPPORT);
  assert.equal(store.amount[row], 4482);
  assert.equal(store.support.get(row), session.parser.actors.get(PLAYER)!.index);
  // No plain row in the log carries Ebon Might, so there is nothing for it to
  // pair with: the amount is a slice of the healer's own hit, not an ability of
  // the evoker's that the log misfiled.
  assert.ok(!(store.flags[row]! & EvFlag.SUPPORT_TWIN), 'nothing to twin with');

  // Which leaves the ability it was part of knowable only from the line it
  // sits behind, since the copy names the buff instead. Without it, crediting
  // the evoker could only move a lump sum: the healer's Shadow Word: Pain
  // would still read the 4,482 the evoker had just been paid for.
  assert.equal(store.extraSpellId[row], 589, 'the hit on the line before');
});

test('a swing _SUPPORT copy carries a spell triple that a plain swing does not', () => {
  const session = parseAll(LOG_TEXT);
  const run = onlyRun(session);
  const { store } = run;

  const swings = rows(run, Ev.SWING_DAMAGE_LANDED);
  const plain = swings.find((row) => (store.flags[row]! & EvFlag.SUPPORT) === 0)!;
  const copy = swings.find((row) => (store.flags[row]! & EvFlag.SUPPORT) !== 0)!;
  assert.ok(plain !== undefined && copy !== undefined);

  // The copy's three extra fields shift everything behind them. Read as a
  // prefix-less swing, the advanced block is not recognised at all and the
  // amount comes out of the spell id: all 99,028 such rows in one real raid
  // log reported Ebon Might's id as damage, 39.1 billion of it.
  assert.equal(store.spellId[plain], 0, 'a swing names no spell');
  assert.equal(store.amount[plain], 9000);
  assert.equal(store.spellId[copy], 395152, 'the buff, not the swing it rode in on');
  assert.equal(store.amount[copy], 700);
  assert.ok(store.flags[copy]! & EvFlag.ADVANCED, 'the block is found past the triple');
  assert.equal(store.hpCurrent[copy], 120000);
  // Melee is spell 0, so there is nothing to record: the row the slice came
  // off is the swing, and that is what a damage table will take it off.
  assert.equal(store.extraSpellId[copy], 0);
  assert.equal(store.support.get(copy), session.parser.actors.get(PLAYER)!.index);
});

test('a _SUPPORT row repeating the line before it hands that line to the supporter', () => {
  const session = parseAll(LOG_TEXT);
  const run = onlyRun(session);
  const { store } = run;
  const evoker = session.parser.actors.get(PLAYER)!.index;

  const pair = rows(run, Ev.SPELL_DAMAGE).filter((row) => store.spellId[row] === 434481);
  assert.equal(pair.length, 2, 'Bombardments is logged twice, as the game writes it');
  const [plain, copy] = pair as [number, number];
  assert.equal(copy, plain + 1, 'the copy is the next event, which is how it is found');

  // The plain row keeps its source — the party member whose hit set the bomb
  // off — and gains the supporter the copy named, so a damage table can file
  // 12.8M of a real key under the evoker instead of across the party.
  assert.ok(!(store.flags[plain]! & EvFlag.SUPPORT), 'still an ordinary damage event');
  assert.ok(store.flags[plain]! & EvFlag.SUPPORT_TWIN);
  assert.equal(store.support.get(plain), evoker);
  assert.equal(store.amount[plain], 3000);

  // And the copy says it is one, so a total can skip it without having to
  // decide whether it was credit.
  assert.ok(store.flags[copy]! & EvFlag.SUPPORT);
  assert.ok(store.flags[copy]! & EvFlag.SUPPORT_TWIN);
});

test('auras without a stack amount do not invent one', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const applied = rows(run, Ev.SPELL_AURA_APPLIED)[0]!;
  assert.equal(run.store.spellId[applied], 43308);
  assert.equal(run.store.amount[applied], 0);
  const extra = rows(run, Ev.SPELL_EXTRA_ATTACKS)[0]!;
  assert.equal(run.store.amount[extra], 1, 'extra attack count');
});

test('a miss is only flagged as avoided when nothing landed', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const missed = rows(run, Ev.SPELL_MISSED);
  assert.equal(missed.length, 2);
  const [absorb, dodge] = missed as [number, number];

  // Both are misses as far as the log is concerned.
  assert.ok(run.store.flags[absorb]! & EvFlag.MISSED);
  assert.ok(run.store.flags[dodge]! & EvFlag.MISSED);

  // Only one of them is a miss as far as a miss rate is concerned. The absorbed
  // blow connected and its damage is already counted by the shield that ate it,
  // so folding it in would overstate the rate and contradict the damage table.
  assert.equal(run.store.flags[absorb]! & EvFlag.AVOIDED, 0, 'ABSORB is not an avoid');
  assert.ok(run.store.flags[dodge]! & EvFlag.AVOIDED, 'DODGE is');

  // A missType-only suffix has no amountMissed to read past the end of.
  assert.equal(run.store.amount[dodge], 0);
});

test('the advanced block is attributed to the unit its infoGUID names', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const swings = rows(run, Ev.SWING_DAMAGE);
  assert.equal(swings.length, 2);

  // First swing: the block describes the victim.
  assert.equal(run.store.flags[swings[0]!]! & EvFlag.INFO_IS_SOURCE, 0);
  assert.equal(run.store.hpCurrent[swings[0]!], 88000, "the player's health");

  // Second swing: the block describes the attacker, so the health belongs to
  // the enemy. Reading it as the victim's would corrupt any death analysis.
  assert.ok(run.store.flags[swings[1]!]! & EvFlag.INFO_IS_SOURCE);
  assert.equal(run.store.hpCurrent[swings[1]!], 120000, "the enemy's health");
});

test('healing a pet does not make the healer that pet owner\'s minion', () => {
  // The regression that motivated the infoGUID check: the advanced block of a
  // heal describes the pet and names its owner. Applying that owner to the
  // event's source made the healer resolve to the pet's owner, and every
  // per-player total silently read zero.
  const session = parseAll(LOG_TEXT);
  const healer = session.parser.actors.get(HEALER)!;
  const pet = session.parser.actors.get(PET)!;
  const player = session.parser.actors.get(PLAYER)!;

  assert.equal(healer.ownerIndex, -1, 'the healer owns themselves');
  assert.equal(session.parser.actors.attribute(healer.index), healer.index);
  assert.equal(pet.ownerIndex, player.index, 'the pet still links to its owner');
});

test('byte-level chunking is indistinguishable from a single push', () => {
  // This is the test that makes live tailing trustworthy: the game flushes
  // whenever it likes, so every possible split point must behave identically.
  const whole = parseAll(LOG_TEXT);
  const bytes = new TextEncoder().encode(LOG_TEXT);

  for (const size of [1, 2, 3, 7, 64, 1024]) {
    const session = new LogSession({ assumedYear: 2026 });
    for (let offset = 0; offset < bytes.length; offset += size) {
      session.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
    }
    session.end();

    const a = onlyRun(whole);
    const b = onlyRun(session);
    assert.equal(b.store.count, a.store.count, `event count at chunk size ${size}`);
    assert.deepEqual(keyMeta(b).affixes, keyMeta(a).affixes, `affixes at chunk size ${size}`);
    assert.equal(b.meta.zoneName, a.meta.zoneName, `zone name at chunk size ${size}`);
    for (let i = 0; i < a.store.count; i++) {
      assert.equal(b.store.code[i], a.store.code[i], `code[${i}] at chunk size ${size}`);
      assert.equal(b.store.amount[i], a.store.amount[i], `amount[${i}] at chunk size ${size}`);
      assert.equal(b.store.ts[i], a.store.ts[i], `ts[${i}] at chunk size ${size}`);
    }
    assert.equal(
      session.parser.interner.resolve(session.parser.actors.get(PLAYER)!.nameId),
      PLAYER_NAME,
      `multi-byte name intact at chunk size ${size}`,
    );
  }
});

test('a reset key abandons the partial run instead of merging two', () => {
  // The zeroed END is what makes this a reset rather than the re-announcement
  // below. The game writes one before every real beginning, this one included.
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 18:00:00.000-4  CHALLENGE_MODE_START,"Ara-Kara, City of Echoes",2660,503,12,[10]',
      `9/30/2026 18:00:01.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,500,500,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:09:59.000-4  CHALLENGE_MODE_END,2660,0,0,0,0.000000,0.000000',
      '9/30/2026 18:10:00.000-4  CHALLENGE_MODE_START,"Ara-Kara, City of Echoes",2660,503,12,[10]',
      `9/30/2026 18:10:01.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,700,700,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:40:00.000-4  CHALLENGE_MODE_END,2660,1,12,1800000,180',
      '',
    ].join('\n'),
  );
  assert.equal(session.runs.length, 2, 'the abandoned attempt is kept, as a failure');
  const abandoned = session.runs[0]!;
  assert.equal(abandoned.meta.success, false);
  assert.equal(abandoned.store.count, 1);
  assert.equal(abandoned.store.amount[0], 500);
  const run = session.runs[1]!;
  assert.equal(run.meta.success, true);
  assert.equal(run.store.count, 1, 'and nothing of it leaks into the key that followed');
  assert.equal(run.store.amount[0], 700);
});

test('a key re-announced mid-run keeps everything killed before it', () => {
  // Stepping out of the instance to change talents makes the game write a
  // second CHALLENGE_MODE_START for the key already in progress. There is no
  // END behind it, so it is the same key — and the kills from its first four
  // minutes have to survive, or the count comes up short by all of them.
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 18:00:00.000-4  CHALLENGE_MODE_START,"Ruby Life Pools",2521,399,11,[158,9,10]',
      `9/30/2026 18:00:01.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,500,500,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:04:00.000-4  CHALLENGE_MODE_START,"Ruby Life Pools",2521,399,11,[158,9,10]',
      `9/30/2026 18:04:01.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,700,700,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:19:49.000-4  CHALLENGE_MODE_END,2521,1,11,1189000,180',
      '',
    ].join('\n'),
  );
  const run = onlyRun(session);
  assert.equal(run.store.count, 2, 'both halves of the key are in one store');
  assert.equal(run.store.amount[0], 500);
  assert.equal(run.store.amount[1], 700);
  // Timed from the first start, which is where the game's own clock is timed
  // from: a 19:49 keystone timer against 19:49 of wall clock.
  assert.equal(run.meta.startMs, run.store.baseMs);
  assert.equal(run.meta.elapsedMs, 1189000);
  assert.equal(run.store.ts[0], 1000, 'and the event column still starts at the first one');
});

test('a key announced again at a different level is a new key', () => {
  // Same instance, no END, but the keystone changed — which a re-entry cannot
  // do. Nothing vouches for this being one key, so it is read as two.
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 18:00:00.000-4  CHALLENGE_MODE_START,"Murder Row",2813,587,16,[10,9,147]',
      `9/30/2026 18:00:01.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,500,500,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:10:00.000-4  CHALLENGE_MODE_START,"Murder Row",2813,587,15,[10,9,147]',
      `9/30/2026 18:10:01.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,700,700,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:40:00.000-4  CHALLENGE_MODE_END,2813,1,15,1800000,180',
      '',
    ].join('\n'),
  );
  const run = onlyRun(session);
  assert.equal(keyMeta(run).keystoneLevel, 15);
  assert.equal(run.store.count, 1);
  assert.equal(run.store.amount[0], 700);
});

test('party membership is per run, so a tank swap does not leak across keys', () => {
  // Actor.inParty is sticky and the actor table spans the file, so a run that
  // read membership off the table would list everyone who played that evening
  // and show the absent player with zeros in every column.
  const other = 'Player-1234-0000CAFE';
  const stats = '0,1,1,1,1,1,0,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1';
  const tail = '[(1,1)],[],[],[],[],1,0,0,0';
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 18:00:00.000-4  CHALLENGE_MODE_START,"Murder Row",2669,500,16,[10]',
      `9/30/2026 18:00:01.000-4  COMBATANT_INFO,${PLAYER},${stats},250,${tail}`,
      `9/30/2026 18:00:01.000-4  COMBATANT_INFO,${HEALER},${stats},270,${tail}`,
      '9/30/2026 18:25:00.000-4  CHALLENGE_MODE_END,2669,1,16,1500000,180',
      '9/30/2026 19:00:00.000-4  CHALLENGE_MODE_START,"Murder Row",2669,500,16,[10]',
      `9/30/2026 19:00:01.000-4  COMBATANT_INFO,${other},${stats},581,${tail}`,
      `9/30/2026 19:00:01.000-4  COMBATANT_INFO,${HEALER},${stats},270,${tail}`,
      '9/30/2026 19:25:00.000-4  CHALLENGE_MODE_END,2669,1,16,1500000,180',
      '',
    ].join('\n'),
  );

  assert.equal(session.runs.length, 2);
  const actors = session.parser.actors;
  const first = session.runs[0]!.meta.party;
  const second = session.runs[1]!.meta.party;
  assert.deepEqual(first, [actors.get(PLAYER)!.index, actors.get(HEALER)!.index]);
  assert.deepEqual(second, [actors.get(other)!.index, actors.get(HEALER)!.index]);
  assert.ok(!second.includes(actors.get(PLAYER)!.index), 'the swapped-out tank is absent');
  // The file-wide view still knows all three played.
  assert.equal(actors.party().length, 3);
});

test('unparseable lines are counted, not thrown', () => {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText('garbage line with no timestamp\n\n9/30/2026 18:00:00.000-4  TOTALLY_NEW_EVENT,1,2,3\n');
  assert.equal(session.parser.linesRejected, 1);
  assert.equal(session.parser.unknownEvents, 1);
});

test('an advanced row keeps the uiMap its position is on', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  const swings = rows(run, Ev.SWING_DAMAGE);
  assert.equal(run.store.uiMapId[swings[0]!], 2291);
  assert.equal(run.store.posX[swings[0]!], Math.fround(1200.5), "the player's position");
  assert.equal(run.store.posX[swings[1]!], Math.fround(1234.56), "the enemy's position");
  // No advanced block, no map.
  assert.equal(run.store.uiMapId[rows(run, Ev.SPELL_INTERRUPT)[0]!], 0);
});

test('a run lists each map it entered once, starting with the one it began on', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  assert.deepEqual(
    run.meta.maps.map((map) => map.uiMapId),
    [2357, 2358],
    'the MAP_CHANGE before the START seeds the run; returning to it adds nothing',
  );
  // The log writes each pair larger first; the run stores min and max.
  assert.deepEqual(run.meta.maps[1], {
    uiMapId: 2358,
    name: 'The Hollows',
    minX: 1150.5,
    maxX: 1250.5,
    minY: 750,
    maxY: 850,
  });
});

/** A Nerub-ar Palace night: zone in, wipe on Ulgrax, kill him, and a mythic 0 boss after. */
function raidNight(options: { raids?: boolean } = {}): LogSession {
  const stats = '0,1,1,1,1,1,0,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1';
  const tail = '[(1,1)],[],[],[],[],1,0,0,0';
  const boss = 'Creature-0-1234-2657-1234-215657-00004321';
  const hit = (time: string, amount: number): string =>
    `9/30/2026 ${time}-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${boss},"Ulgrax",0xa48,0x0,1,"S",0x1,${amount},${amount},-1,1,0,0,0,nil,nil,nil`;
  const session = new LogSession({ assumedYear: 2026, ...options });
  session.pushText(
    [
      '9/30/2026 20:00:00.000-4  ZONE_CHANGE,2657,"Nerub-ar Palace",16',
      hit('20:01:00.000', 100),
      '9/30/2026 20:02:00.000-4  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657',
      `9/30/2026 20:02:00.000-4  COMBATANT_INFO,${PLAYER},${stats},250,${tail}`,
      `9/30/2026 20:02:00.000-4  COMBATANT_INFO,${HEALER},${stats},270,${tail}`,
      hit('20:02:01.000', 500),
      '9/30/2026 20:04:00.000-4  ENCOUNTER_END,2902,"Ulgrax the Devourer",16,20,0,120000',
      hit('20:05:00.000', 100),
      '9/30/2026 20:10:00.000-4  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657',
      `9/30/2026 20:10:00.000-4  COMBATANT_INFO,${PLAYER},${stats},250,${tail}`,
      hit('20:10:01.000', 700),
      hit('20:15:00.000', 900),
      '9/30/2026 20:16:00.000-4  ENCOUNTER_END,2902,"Ulgrax the Devourer",16,20,1,360000',
      '9/30/2026 21:00:00.000-4  ZONE_CHANGE,2660,"Ara-Kara, City of Echoes",23',
      '9/30/2026 21:05:00.000-4  ENCOUNTER_START,2926,"Avanoxx",23,5,2660',
      '9/30/2026 21:07:00.000-4  ENCOUNTER_END,2926,"Avanoxx",23,5,1,120000',
      '',
    ].join('\n'),
  );
  session.end();
  return session;
}

test('each raid boss pull is its own run, numbered per boss and difficulty', () => {
  const session = raidNight();
  assert.equal(session.runs.length, 2, 'two pulls, and the mythic 0 dungeon boss is not a raid pull');
  const [wipe, kill] = session.runs.map(raidMeta);

  assert.equal(wipe!.encounterName, 'Ulgrax the Devourer');
  assert.equal(wipe!.encounterId, 2902);
  assert.equal(wipe!.difficultyId, 16);
  assert.equal(wipe!.groupSize, 20);
  assert.equal(wipe!.instanceId, 2657);
  assert.equal(wipe!.zoneName, 'Nerub-ar Palace', 'named from the ZONE_CHANGE, since ENCOUNTER_START carries no zone');
  assert.equal(wipe!.pull, 1);
  assert.equal(wipe!.success, false);
  assert.equal(wipe!.elapsedMs, 120_000);

  assert.equal(kill!.pull, 2);
  assert.equal(kill!.success, true);
  assert.equal(kill!.elapsedMs, 360_000);
  assert.deepEqual(kill!.encounters, [
    { encounterId: 2902, name: 'Ulgrax the Devourer', difficultyId: 16, startTs: 0, endTs: 360_000, success: true },
  ]);
});

test('a raid pull records only its own fight and its own roster', () => {
  const session = raidNight();
  const [wipe, kill] = session.runs;
  assert.deepEqual([...wipe!.store.amount.subarray(0, wipe!.store.count)], [500], 'nothing from before or after the fight');
  assert.deepEqual([...kill!.store.amount.subarray(0, kill!.store.count)], [700, 900]);

  const actors = session.parser.actors;
  assert.deepEqual(wipe!.meta.party, [actors.get(PLAYER)!.index, actors.get(HEALER)!.index]);
  assert.deepEqual(kill!.meta.party, [actors.get(PLAYER)!.index], 'the healer sat out the kill');
});

test('raid pulls can be switched off, leaving only keys', () => {
  assert.equal(raidNight({ raids: false }).runs.length, 0);
});

test('a raid pull that never logged its END is dropped when the next begins', () => {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 20:02:00.000-4  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657',
      '9/30/2026 20:10:00.000-4  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657',
      '9/30/2026 20:16:00.000-4  ENCOUNTER_END,2902,"Ulgrax the Devourer",16,20,1,360000',
      '',
    ].join('\n'),
  );
  const meta = raidMeta(onlyRun(session));
  assert.equal(meta.startMs, Date.UTC(2026, 8, 30, 20, 10));
  assert.equal(meta.pull, 2, 'the lost pull still counts as an attempt');
  assert.equal(meta.success, true);
});

test('a dungeon boss inside a key stays a window of the key', () => {
  const run = onlyRun(parseAll(LOG_TEXT));
  assert.equal(run.meta.kind, 'key');
  assert.equal(run.meta.encounters[0]!.name, 'Avanoxx');
});

test('a death logged as unconscious is flagged as a Feign Death', () => {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 20:02:00.000-4  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657',
      `9/30/2026 20:02:05.000-4  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${PLAYER},"A",0x512,0x80000000,1`,
      `9/30/2026 20:02:09.000-4  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${PLAYER},"A",0x512,0x80000000,0`,
      '9/30/2026 20:04:00.000-4  ENCOUNTER_END,2902,"Ulgrax the Devourer",16,20,0,120000',
      '',
    ].join('\n'),
  );
  const run = onlyRun(session);
  const died = rows(run, Ev.UNIT_DIED);
  assert.equal(died.length, 2, 'both are kept: the flag is for readers to act on');
  assert.notEqual(run.store.flags[died[0]!]! & EvFlag.FEIGNED, 0);
  assert.equal(run.store.flags[died[1]!]! & EvFlag.FEIGNED, 0);
});

test('a raid pull keeps the half-minute before it, apart from the fight', () => {
  const boss = 'Creature-0-1234-2657-1234-215657-00004321';
  const hit = (time: string, amount: number): string =>
    `9/30/2026 ${time}-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${boss},"Ulgrax",0xa48,0x0,1,"S",0x1,${amount},${amount},-1,1,0,0,0,nil,nil,nil`;
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 20:00:00.000-4  ZONE_CHANGE,2657,"Nerub-ar Palace",16',
      hit('20:01:00.000', 100),
      hit('20:01:58.000', 200),
      '9/30/2026 20:02:00.000-4  ENCOUNTER_START,2902,"Ulgrax the Devourer",16,20,2657',
      hit('20:02:01.000', 500),
      '9/30/2026 20:04:00.000-4  ENCOUNTER_END,2902,"Ulgrax the Devourer",16,20,0,120000',
      '',
    ].join('\n'),
  );
  session.end();
  const run = onlyRun(session);
  const prePull = run.prePull;
  assert.ok(prePull !== null);
  assert.equal(prePull.count, 1, 'the hit a minute before is out of range');
  assert.equal(prePull.ts[0], -2000, 'on the pull\'s own clock');
  assert.equal(prePull.amount[0], 200);
  assert.deepEqual([...run.store.amount.slice(0, run.store.count)], [500], 'none of it in the fight');
});

test('a key has no pre-pull store, and nothing is buffered outside a raid', () => {
  const session = new LogSession({ assumedYear: 2026 });
  session.pushText(
    [
      '9/30/2026 17:59:00.000-4  ZONE_CHANGE,2660,"Ara-Kara, City of Echoes",8',
      `9/30/2026 17:59:59.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,100,100,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:00:00.000-4  CHALLENGE_MODE_START,"Ara-Kara, City of Echoes",2660,503,12,[10]',
      `9/30/2026 18:00:01.000-4  SPELL_DAMAGE,${PLAYER},"A",0x511,0x0,${ENEMY},"B",0xa48,0x0,1,"S",0x1,500,500,-1,1,0,0,0,nil,nil,nil`,
      '9/30/2026 18:40:00.000-4  CHALLENGE_MODE_END,2660,1,12,1800000,180',
      '',
    ].join('\n'),
  );
  session.end();
  assert.equal(onlyRun(session).prePull, null);
  assert.equal(session.parser.target, null, 'idle time in a dungeon costs a timestamp parse, as before');
});

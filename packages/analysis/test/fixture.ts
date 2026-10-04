import type { ForcesTable } from '@mplus/data';

/**
 * Synthetic key built to exercise the segmentation rules that a real log found
 * the hard way: an overlapping pull, a boss engaged before its window opened,
 * pet rollup, and _SUPPORT duplicate rows.
 */

export const TANK = 'Player-1-00000001';
export const HEALER = 'Player-1-00000002';
export const DPS = 'Player-1-00000003';
export const PET = 'Pet-0-1-2291-1-165189-00000003';

const STATS = '0,1,1,1,1,1,0,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1';
const TAIL = '[(1,1)],[],[],[],[],1,0,0,0';

const pad = (n: number) => String(n).padStart(2, '0');
/** Seconds from the key's start to a log timestamp. */
export function at(seconds: number): string {
  const total = 18 * 3600 + seconds;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `9/30/2026 ${pad(h)}:${pad(m)}:${pad(s)}.${String(ms).padStart(3, '0')}-4`;
}

/** 19-field advanced block describing `guid`, optionally naming its owner. */
function adv(guid: string, hp: number, hpMax: number, owner = '0000000000000000', x = 100.5, y = 200.5): string {
  return `${guid},${owner},${hp},${hpMax},0,0,1470,0,0,0,3,100,100,0,${x},${y},2291,1.5,70`;
}

/**
 * An enemy hits a pet. This is the only shape that teaches the parser the
 * pet->owner link, because the link lives in the advanced block and the block
 * describes the target.
 */
export function hitPet(seconds: number, src: string, srcName: string, pet: string, petName: string, owner: string, amount: number): string {
  return `${at(seconds)}  SPELL_DAMAGE,${src},"${srcName}",0xa48,0x0,${pet},"${petName}",0x1111,0x0,600,"Swipe",0x8,${adv(pet, 4000, 5000, owner)},${amount},${amount},-1,8,0,0,0,nil,nil,nil,ST`;
}

export function creature(npcId: number, spawn: number): string {
  return `Creature-0-1-2291-1-${npcId}-${String(spawn).padStart(8, '0')}`;
}

/** Player hits an enemy. The advanced block describes the enemy (the target). */
export function hit(
  seconds: number,
  src: string,
  srcName: string,
  dst: string,
  dstName: string,
  amount: number,
  opts: {
    hp?: number;
    hpMax?: number;
    spellId?: number;
    spellName?: string;
    support?: string;
    /** Target unit flags. 0x2a48 adds TYPE_GUARDIAN, which marks a summon. */
    dstFlags?: string;
    /** Source unit flags. 0x2112 is a player's guardian rather than a player. */
    srcFlags?: string;
    /** ownerGUID in the target's advanced block, the way a pet names its master. */
    dstOwner?: string;
    crit?: boolean;
  } = {},
): string {
  const hp = opts.hp ?? 1000;
  const hpMax = opts.hpMax ?? 1000;
  const spellId = opts.spellId ?? 100;
  const spellName = opts.spellName ?? 'Nuke';
  const dstFlags = opts.dstFlags ?? '0xa48';
  const srcFlags = opts.srcFlags ?? '0x511';
  const event = opts.support === undefined ? 'SPELL_DAMAGE' : 'SPELL_DAMAGE_SUPPORT';
  const tailField = opts.support ?? 'ST';
  const crit = opts.crit === true ? '1' : 'nil';
  const block = adv(dst, hp, hpMax, opts.dstOwner ?? '0000000000000000');
  return `${at(seconds)}  ${event},${src},"${srcName}",${srcFlags},0x0,${dst},"${dstName}",${dstFlags},0x0,${spellId},"${spellName}",0x8,${block},${amount},${amount},-1,8,0,0,0,${crit},nil,nil,${tailField}`;
}

/** A player summoning a guardian, which is NPC-flagged until it acts. */
export function summonedByPlayer(seconds: number, src: string, srcName: string, dst: string, dstName: string): string {
  return `${at(seconds)}  SPELL_SUMMON,${src},"${srcName}",0x511,0x0,${dst},"${dstName}",0xa28,0x0,265187,"Summon Tyrant",0x20`;
}

/**
 * A hit an enemy's shield eats whole, which still happened.
 *
 * Given its own spell id so a test can tell it apart: it is the only output
 * in the key that produces no damage event at all.
 */
export function absorbedByEnemy(seconds: number, src: string, srcName: string, dst: string, dstName: string, amount: number): string {
  return `${at(seconds)}  SPELL_ABSORBED,${src},"${srcName}",0x511,0x0,${dst},"${dstName}",0xa48,0x0,101,"Chaos Bolt",0x8,${dst},"${dstName}",0xa48,0x0,881,"Warding Crystal",0x2,${amount},${amount * 3},nil`;
}

/** One enemy summoning another, the clearest signal that a unit is a spawn. */
export function summon(seconds: number, src: string, srcName: string, dst: string, dstName: string): string {
  return `${at(seconds)}  SPELL_SUMMON,${src},"${srcName}",0xa48,0x0,${dst},"${dstName}",0x2a48,0x0,8017,"Magma Totem",0x4`;
}

/** Enemy hits a player. The advanced block describes the player (the target). */
export function taken(
  seconds: number,
  src: string,
  srcName: string,
  dst: string,
  dstName: string,
  amount: number,
  opts: {
    hp?: number;
    hpMax?: number;
    spellId?: number;
    spellName?: string;
    overkill?: number;
    crit?: boolean;
  } = {},
): string {
  const hp = opts.hp ?? 500000;
  const hpMax = opts.hpMax ?? 1000000;
  const spellId = opts.spellId ?? 500;
  const spellName = opts.spellName ?? 'Cleave';
  const overkill = opts.overkill ?? -1;
  const crit = opts.crit === true ? '1' : 'nil';
  return `${at(seconds)}  SPELL_DAMAGE,${src},"${srcName}",0xa48,0x0,${dst},"${dstName}",0x511,0x0,${spellId},"${spellName}",0x8,${adv(dst, hp, hpMax)},${amount},${amount},${overkill},8,0,0,0,${crit},nil,nil,ST`;
}

export function heal(
  seconds: number,
  src: string,
  srcName: string,
  dst: string,
  dstName: string,
  amount: number,
  overheal = 0,
  opts: { spellId?: number; spellName?: string } = {},
): string {
  const spellId = opts.spellId ?? 116670;
  const spellName = opts.spellName ?? 'Vivify';
  return `${at(seconds)}  SPELL_HEAL,${src},"${srcName}",0x512,0x0,${dst},"${dstName}",0x511,0x0,${spellId},"${spellName}",0x8,${adv(dst, 500000, 1000000)},${amount},${amount},${overheal},0,nil`;
}

/**
 * One party member damaging another.
 *
 * Rare, and when it happens it is usually half of something: Spirit Link
 * Totem levels a group's health by hurting whoever is highest, under the same
 * spell id it heals with.
 */
export function friendlyHit(
  seconds: number,
  src: string,
  srcName: string,
  dst: string,
  dstName: string,
  amount: number,
  spellId: number,
  spellName: string,
): string {
  return `${at(seconds)}  SPELL_DAMAGE,${src},"${srcName}",0x512,0x0,${dst},"${dstName}",0x511,0x0,${spellId},"${spellName}",0x8,${adv(dst, 500000, 1000000)},${amount},${amount},-1,8,0,0,0,nil,nil,nil,ST`;
}

/** SPELL_ABSORBED, spell shape: the shield triple and its caster sit at the tail. */
export function absorbed(
  seconds: number,
  src: string,
  srcName: string,
  dst: string,
  dstName: string,
  caster: string,
  casterName: string,
  shieldId: number,
  shieldName: string,
  amount: number,
): string {
  return `${at(seconds)}  SPELL_ABSORBED,${src},"${srcName}",0x548,0x0,${dst},"${dstName}",0x511,0x0,777,"Smash",0x1,${caster},"${casterName}",0x512,0x0,${shieldId},"${shieldName}",0x2,${amount},${amount * 2},nil`;
}

/**
 * `flags` defaults to a player's. Enemies must pass their own: a death line
 * reports unit flags like any other event, and claiming an enemy was
 * player-controlled as it died is enough to make it somebody's minion.
 */
export function died(seconds: number, guid: string, name: string, flags = '0x511'): string {
  return `${at(seconds)}  UNIT_DIED,0000000000000000,nil,0x80000000,0x0,${guid},"${name}",${flags},0x0,0,0,0,0`;
}

/**
 * An attempt that produced no damage.
 *
 * `missType` matters: MISS and DODGE are failures to hit, while ABSORB is the
 * same line shape for a blow that landed and was eaten by a shield. A miss
 * rate must count the first and not the second, so the fixture logs both.
 */
export function missed(
  seconds: number,
  src: string,
  srcName: string,
  dst: string,
  dstName: string,
  spellId: number,
  spellName: string,
  missType = 'DODGE',
): string {
  const suffix = missType === 'ABSORB' ? 'ABSORB,nil,900,nil' : missType;
  return `${at(seconds)}  SPELL_MISSED,${src},"${srcName}",0x511,0x0,${dst},"${dstName}",0xa48,0x0,${spellId},"${spellName}",0x8,${suffix}`;
}

/** An aura going on or coming off a unit, which is all uptime is made of. */
export function aura(
  seconds: number,
  src: string,
  srcName: string,
  dst: string,
  dstName: string,
  spellId: number,
  spellName: string,
  up: boolean,
  opts: { buff?: boolean; dstFlags?: string } = {},
): string {
  const event = up ? 'SPELL_AURA_APPLIED' : 'SPELL_AURA_REMOVED';
  const dstFlags = opts.dstFlags ?? '0xa48';
  const auraType = opts.buff === true ? 'BUFF' : 'DEBUFF';
  return `${at(seconds)}  ${event},${src},"${srcName}",0x511,0x0,${dst},"${dstName}",${dstFlags},0x0,${spellId},"${spellName}",0x8,${auraType}`;
}

export function cast(seconds: number, src: string, srcName: string, spellId: number, spellName: string): string {
  return `${at(seconds)}  SPELL_CAST_SUCCESS,${src},"${srcName}",0x511,0x0,0000000000000000,nil,0x80000000,0x0,${spellId},"${spellName}",0x1,${adv(src, 500000, 1000000)}`;
}

const TRASH_A = creature(1001, 1);
const TRASH_B = creature(1001, 2);
const LATER_A = creature(1002, 3);
const DRAGGED = creature(1003, 4);
const BOSS = creature(2001, 5);
const BOSS_ADD = creature(2002, 6);
const SHAMAN = creature(1004, 10);
/** Four totems of one creature id. Two announced by SPELL_SUMMON, two not. */
const TOTEM_A = creature(1005, 11);
const TOTEM_B = creature(1005, 12);
const TOTEM_C = creature(1005, 13);
const TOTEM_D = creature(1005, 14);
/**
 * A wave that despawns rather than being killed: never damaged, both dying at
 * the same instant. Real logs are full of these and the game credits none of
 * them — see the note on `died` in segments.ts.
 */
const WAVE_A = creature(1006, 20);
const WAVE_B = creature(1006, 21);
/** Dee's guardian: a Creature- GUID, so SPELL_SUMMON is its only owner link. */
const TYRANT = creature(1007, 30);
/** Shielded, so one hit on it is logged as absorbed rather than as damage. */
const WARDED = creature(1008, 31);
/** Hostile, but its advanced block names the player it encased as its owner. */
const TOMB = creature(1009, 32);

export const ACTORS = {
  TRASH_A,
  TRASH_B,
  LATER_A,
  DRAGGED,
  BOSS,
  BOSS_ADD,
  SHAMAN,
  TOTEM_A,
  TOTEM_C,
  TYRANT,
  WARDED,
  TOMB,
};

/**
 * Enemy forces for the fixture dungeon, in the shape the MDT reader produces.
 *
 * `challengeModeId` is 500 to match the fixture's CHALLENGE_MODE_START, and
 * the values are chosen so every case the UI has to render appears once: a
 * creature killed more than once, one tagged and never killed, a boss worth
 * nothing, and summons worth nothing.
 */
export const FORCES: ForcesTable = {
  source: 'fixture',
  dungeons: [
    {
      challengeModeId: 500,
      name: 'Test Hold',
      total: 100,
      teleportSpellId: 393256,
      enemies: [
        { npcId: 1001, name: 'Gnoll', count: 4, isBoss: false },
        { npcId: 1002, name: 'Ogre', count: 10, isBoss: false },
        { npcId: 1003, name: 'Straggler', count: 7, isBoss: false },
        { npcId: 1004, name: 'Flame Shaman', count: 12, isBoss: false },
        { npcId: 1005, name: 'Magma Totem', count: 0, isBoss: false },
        { npcId: 2001, name: 'Big Bad', count: 0, isBoss: true },
        { npcId: 2002, name: 'Minion', count: 2, isBoss: false },
        { npcId: 1006, name: 'Wave Minion', count: 9, isBoss: false },
        { npcId: 1008, name: 'Warded Ogre', count: 0, isBoss: false },
        { npcId: 1009, name: 'Ice Tomb', count: 0, isBoss: false },
      ],
    },
  ],
};

/**
 * Timeline:
 *   t=10..14   pull 1, two Gnolls
 *   t=40..44   pull 2 (past the 5s gap), one Ogre
 *   t=60       DRAGGED trash engaged — stays its own pull through the boss
 *   t=66       BOSS engaged, 4s BEFORE its ENCOUNTER_START, with 50x the health
 *   t=70       ENCOUNTER_START
 *   t=72..80   boss damage, an add, a death, a pet hit, a _SUPPORT duplicate
 *   t=95       ENCOUNTER_END (kill)
 *   t=100..103 pull 4, one shaman plus four totems it summoned. The totems
 *              out-mass the shaman, so only the summon rule names the pull
 *              after the thing that was pulled.
 */
export const LINES: string[] = [
  `${at(0)}  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1`,
  `${at(0)}  CHALLENGE_MODE_START,"Test Hold",2000,500,15,[10,9,147]`,
  `${at(1)}  COMBATANT_INFO,${TANK},${STATS},250,${TAIL}`,
  `${at(1)}  COMBATANT_INFO,${HEALER},${STATS},270,${TAIL}`,
  `${at(1)}  COMBATANT_INFO,${DPS},${STATS},62,${TAIL}`,

  hit(10, DPS, 'Dee', TRASH_A, 'Gnoll', 1000),
  hit(11, DPS, 'Dee', TRASH_B, 'Gnoll', 1000),
  taken(12, TRASH_A, 'Gnoll', TANK, 'Tank', 2000),
  hit(14, DPS, 'Dee', TRASH_A, 'Gnoll', 1000),
  // Both Gnolls die, so one creature contributes its forces value twice.
  died(14.5, TRASH_A, 'Gnoll', '0xa48'),
  died(14.6, TRASH_B, 'Gnoll', '0xa48'),

  hit(40, DPS, 'Dee', LATER_A, 'Ogre', 3000),
  hit(44, DPS, 'Dee', LATER_A, 'Ogre', 3000),
  died(44.5, LATER_A, 'Ogre', '0xa48'),

  hit(60, DPS, 'Dee', DRAGGED, 'Straggler', 500),
  // A hit on the tank seventeen seconds before they die: inside the recap's
  // capture and outside the ten seconds its totals describe.
  taken(62, DRAGGED, 'Straggler', TANK, 'Tank', 12000, { hp: 900000, hpMax: 1000000 }),
  hit(66, DPS, 'Dee', BOSS, 'Big Bad', 5000, { hp: 500000, hpMax: 500000 }),

  `${at(70)}  ENCOUNTER_START,9001,"Big Bad",8,5,2000`,
  // Two presses of Nuke, one of them a crit. Casts are deliberately fewer than
  // hits here: every other Nuke in the key is logged without a cast line, the
  // way a proc or a cleave arrives.
  cast(71.9, DPS, 'Dee', 100, 'Nuke'),
  hit(72, DPS, 'Dee', BOSS, 'Big Bad', 7000, { hp: 480000, hpMax: 500000, crit: true }),
  cast(73.9, DPS, 'Dee', 100, 'Nuke'),
  // Teaches the parser that the Imp belongs to Dee, so its damage rolls up.
  hitPet(72.5, BOSS, 'Big Bad', PET, 'Imp', DPS, 100),
  hit(73, PET, 'Imp', BOSS, 'Big Bad', 900, { hp: 470000, hpMax: 500000 }),
  // A _SUPPORT duplicate of the line above it: same amount, same dealer.
  hit(74, DPS, 'Dee', BOSS, 'Big Bad', 4000, { hp: 460000, hpMax: 500000 }),
  hit(74, DPS, 'Dee', BOSS, 'Big Bad', 4000, { hp: 460000, hpMax: 500000, support: HEALER }),
  hit(75, DPS, 'Dee', BOSS_ADD, 'Minion', 600, { hp: 5000, hpMax: 5000 }),
  hit(76, DPS, 'Dee', DRAGGED, 'Straggler', 500),
  // Two Nukes the boss turned away, one dodged and one eaten by a shield. Only
  // the dodge is a miss: the absorbed one landed, and in a real log its damage
  // arrives on a SPELL_ABSORBED line of its own.
  missed(76.2, DPS, 'Dee', BOSS, 'Big Bad', 100, 'Nuke'),
  missed(76.4, DPS, 'Dee', BOSS, 'Big Bad', 100, 'Nuke', 'ABSORB'),
  // A debuff on the boss, applied once and removed 18s later, dealing damage
  // in between. Uptime comes from those two lines and from nothing else: the
  // damage says the ability did something, not how long it was up.
  aura(76.5, DPS, 'Dee', BOSS, 'Big Bad', 310, 'Agony', true),
  hit(80, DPS, 'Dee', BOSS, 'Big Bad', 1200, {
    spellId: 310,
    spellName: 'Agony',
    hp: 450000,
    hpMax: 500000,
  }),
  aura(94.5, DPS, 'Dee', BOSS, 'Big Bad', 310, 'Agony', false),

  // The tank's auras through the fight, which is what the recap's side lanes
  // are made of. Four shapes, because each one is read differently:
  //   1022  a buff whose application predates the window — only its removal
  //         is logged inside it, so the auraType on a SPELL_AURA_REMOVED is
  //         the only thing that can file it as a buff
  //   888   a debuff that went on and came off inside the window
  //   48792 their own defensive, pressed and still up when they died
  //   889   a debuff still on them at the death
  //   57724 Sated — a debuff they put on themselves that does nothing, which
  //         the recap drops from both the lane and the list
  aura(70, HEALER, 'Heals', TANK, 'Tank', 1022, 'Blessing of Protection', false, {
    buff: true,
    dstFlags: '0x511',
  }),
  aura(74, BOSS, 'Big Bad', TANK, 'Tank', 888, 'Crushing Grip', true, { dstFlags: '0x511' }),
  heal(77, HEALER, 'Heals', TANK, 'Tank', 30000, 10000),
  cast(77.5, TANK, 'Tank', 48792, 'Icebound Fortitude'),
  aura(77.5, TANK, 'Tank', TANK, 'Tank', 48792, 'Icebound Fortitude', true, {
    buff: true,
    dstFlags: '0x511',
  }),
  aura(77.6, TANK, 'Tank', TANK, 'Tank', 57724, 'Sated', true, { dstFlags: '0x511' }),
  // A crit, which the recap marks on the bar with an asterisk: a 400K hit and
  // a 400K hit that could have been 200K are different problems.
  taken(78, BOSS, 'Big Bad', TANK, 'Tank', 400000, {
    hp: 100000,
    hpMax: 1000000,
    spellId: 777,
    spellName: 'Smash',
    crit: true,
  }),
  // Two shields on the same hit, one the tank's own and one the healer's, so a
  // recap has to say which absorbed what rather than just "absorbed 45000".
  absorbed(78.1, BOSS, 'Big Bad', TANK, 'Tank', TANK, 'Tank', 48792, 'Icebound Fortitude', 30000),
  absorbed(78.2, BOSS, 'Big Bad', TANK, 'Tank', HEALER, 'Heals', 17, 'Power Word: Shield', 15000),
  aura(78.5, BOSS, 'Big Bad', TANK, 'Tank', 888, 'Crushing Grip', false, { dstFlags: '0x511' }),
  aura(78.6, BOSS, 'Big Bad', TANK, 'Tank', 889, 'Sundered', true, { dstFlags: '0x511' }),
  taken(79, BOSS, 'Big Bad', TANK, 'Tank', 150000, { hp: 0, hpMax: 1000000, spellId: 777, spellName: 'Smash', overkill: 50000 }),
  died(79.1, TANK, 'Tank'),
  // A pet death, which must not count as a player death.
  died(79.5, PET, 'Imp', '0x1111'),

  // The add dies; the straggler is tagged at t=60 and t=76 and never killed,
  // which is the case that separates "engaged" from "counted".
  died(80, BOSS_ADD, 'Minion', '0xa48'),
  died(94.9, BOSS, 'Big Bad', '0xa48'),

  `${at(95)}  ENCOUNTER_END,9001,"Big Bad",8,5,1`,

  hit(100, DPS, 'Dee', SHAMAN, 'Flame Shaman', 2000, { hp: 60000, hpMax: 60000 }),
  summon(100.5, SHAMAN, 'Flame Shaman', TOTEM_A, 'Magma Totem'),
  summon(100.6, SHAMAN, 'Flame Shaman', TOTEM_B, 'Magma Totem'),
  hit(101, DPS, 'Dee', TOTEM_A, 'Magma Totem', 300, { hp: 20000, hpMax: 20000 }),
  hit(101.2, DPS, 'Dee', TOTEM_B, 'Magma Totem', 300, { hp: 20000, hpMax: 20000 }),
  // No SPELL_SUMMON for these two, the way a scripted wave arrives. The
  // guardian bit in their unit flags is the only thing that gives them away.
  hit(101.4, DPS, 'Dee', TOTEM_C, 'Magma Totem', 300, { hp: 20000, hpMax: 20000, dstFlags: '0x2a48' }),
  hit(101.6, DPS, 'Dee', TOTEM_D, 'Magma Totem', 300, { hp: 20000, hpMax: 20000, dstFlags: '0x2a48' }),
  hit(103, DPS, 'Dee', SHAMAN, 'Flame Shaman', 2000, { hp: 50000, hpMax: 60000 }),
  // Two of the four totems expire, the other two are left standing. Totems are
  // worth nothing either way, so the pack's forces come from the shaman alone.
  died(103.2, TOTEM_A, 'Magma Totem', '0xa48'),
  died(103.3, TOTEM_B, 'Magma Totem', '0xa48'),
  died(103.5, SHAMAN, 'Flame Shaman', '0xa48'),
  // The despawning wave. Worth 9 apiece in the table, so counting them would
  // add 18 — and the party never touched either one.
  died(110, WAVE_A, 'Wave Minion', '0xa48'),
  died(110, WAVE_B, 'Wave Minion', '0xa48'),
  // t=110..112, the last pull: a guardian of Dee's, a shielded enemy and a
  // block of ice with Dee's name on it. Three ways a total can go wrong.
  summonedByPlayer(110, DPS, 'Dee', TYRANT, 'Tyrant'),
  // The guardian's own damage. Its advanced block describes the victim, so
  // nothing here says whose guardian it is except the summon above.
  hit(110.5, TYRANT, 'Tyrant', WARDED, 'Warded Ogre', 1500, { srcFlags: '0x2112', hp: 40_000, hpMax: 40_000 }),
  // A hit the enemy's shield swallows entirely. No damage event is logged for
  // it at all, only this.
  absorbedByEnemy(111, DPS, 'Dee', WARDED, 'Warded Ogre', 800),
  // The ice names Dee as its owner, the way a pet names its master. It is
  // still an enemy, and hitting it is still damage done.
  hit(111.5, DPS, 'Dee', TOMB, 'Ice Tomb', 700, { hp: 9000, hpMax: 9000, dstOwner: DPS }),
  died(112, TOMB, 'Ice Tomb', '0xa48'),
  // One button, four spell ids, three spellings — the shape the game actually
  // logs a modern ability in. Apart they are four small rows; together they
  // are Dee's second-largest ability.
  hit(113, DPS, 'Dee', WARDED, 'Warded Ogre', 300, { spellId: 200, spellName: 'Cleave' }),
  hit(113.2, DPS, 'Dee', WARDED, 'Warded Ogre', 100, {
    spellId: 201,
    spellName: 'Cleave Off-Hand',
  }),
  hit(113.4, DPS, 'Dee', WARDED, 'Warded Ogre', 200, {
    spellId: 202,
    spellName: 'Cleave (Empowered)',
  }),
  // The case no rule can see coming: a second id under the identical name.
  hit(113.6, DPS, 'Dee', WARDED, 'Warded Ogre', 150, { spellId: 203, spellName: 'Cleave' }),
  // Named for the same ability but not the same button, so it stays apart.
  hit(113.8, DPS, 'Dee', WARDED, 'Warded Ogre', 50, {
    spellId: 204,
    spellName: 'Cleave Overload',
  }),

  // An ability that heals by hurting: 5000 onto the tank paid for with 2000
  // off Dee and 500 off the healer, all under spell 300. What it did is the
  // difference, which is what a healing table should say it did.
  heal(114, HEALER, 'Heals', TANK, 'Tank', 5000, 0, { spellId: 300, spellName: 'Spirit Link' }),
  friendlyHit(114.1, HEALER, 'Heals', DPS, 'Dee', 2000, 300, 'Spirit Link'),
  friendlyHit(114.2, HEALER, 'Heals', HEALER, 'Heals', 500, 300, 'Spirit Link'),
  // Self-harm that heals nobody. It must not be charged against the healing
  // the healer did with everything else.
  friendlyHit(114.3, HEALER, 'Heals', HEALER, 'Heals', 1000, 301, 'Burning Rush'),
  // 120s of wall clock, and a keystone timer of 135s because someone died.
  // The two must stay different: a rate divided by the wrong one still looks
  // plausible, so only a fixture where they disagree can catch it.
  `${at(120)}  CHALLENGE_MODE_END,2000,1,15,135000,180`,
];

export const LOG_TEXT = LINES.join('\n') + '\n';

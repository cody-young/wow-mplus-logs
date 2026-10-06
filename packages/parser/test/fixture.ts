/**
 * Synthetic log matching real build 12.1.0 / COMBAT_LOG_VERSION 22 shapes:
 * a 19-field advanced block, the trailing ST/AOE field on spell damage,
 * ENVIRONMENTAL_DAMAGE with its type after the block, a quoted field with a
 * comma in it, a non-ASCII realm name, and a complete CHALLENGE_MODE bracket.
 *
 * LEGACY_TEXT carries the pre-12.1.0 17-field block so the width calibration
 * is tested in both directions rather than only against today's format.
 */

// 19 fields: infoGUID, ownerGUID, curHP, maxHP, attackPower, spellPower,
// armor, +2 stats added in 12.1.0, absorb, powerType, power, maxPower,
// powerCost, posX, posY, uiMapID, facing, level.
const ADV_ENEMY =
  'Creature-0-1234-2291-1234-191622-00001234,0000000000000000,120000,150000,0,0,1470,0,0,0,3,100,100,0,1234.56,789.01,2291,1.5,70';
const ADV_PLAYER =
  'Player-1234-0000ABCD,0000000000000000,88000,120000,4200,345,9701,824,176,0,6,60,100,0,1200.50,800.25,2291,2.1,80';
const ADV_PET =
  'Pet-0-1234-2291-1234-165189-01000ABCD,Player-1234-0000ABCD,5000,5000,0,0,0,0,0,0,0,0,0,0,1210.00,805.00,2291,2.1,80';
/** The tomb's own block, naming the player it encased as its owner. */
const ADV_TOMB =
  'Creature-0-1234-2291-1234-246591-00009999,Player-1234-0000ABCD,9000,9000,0,0,1470,0,0,0,3,100,100,0,1215.00,810.00,2291,1.5,70';

export const PLAYER = 'Player-1234-0000ABCD';
export const HEALER = 'Player-1234-0000BEEF';
export const PET = 'Pet-0-1234-2291-1234-165189-01000ABCD';
export const ENEMY = 'Creature-0-1234-2291-1234-191622-00001234';
/** A player's guardian: a Creature- GUID, linked only by SPELL_SUMMON. */
export const GUARDIAN = 'Creature-0-1234-2291-1234-250289-00005678';
/** A hostile unit whose advanced block names the player it trapped. */
export const TOMB = 'Creature-0-1234-2291-1234-246591-00009999';

/** Realm name with multi-byte characters, to exercise decoder boundaries. */
export const PLAYER_NAME = 'Tésty-Ázshara';

/**
 * Stat run ahead of the spec id. Deliberately longer than the pre-12.1.0
 * layout so any parser that indexes the spec by a fixed field number fails
 * this fixture.
 */
const COMBATANT_STATS = '0,5000,3000,8000,2000,500,0,0,3000,3000,3000,0,0,2500,2500,2500,0,1800,1200,1200,900,12000,9701,824,176';
const COMBATANT_TAIL = '[(12345,1)],[],[(207200,639,())],[(12345,610,(),(),())],[],1,0,0,0';

export const LINES: string[] = [
  '9/30/2026 18:48:00.000-4  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1',
  // Zoning in logs the map before the key starts; the run must still get it.
  '9/30/2026 18:48:30.000-4  MAP_CHANGE,2357,"Ara-Kara, City of Echoes",1300.000000,1100.000000,900.000000,700.000000',
  // Zone name contains a comma inside quotes.
  '9/30/2026 18:49:00.000-4  CHALLENGE_MODE_START,"Ara-Kara, City of Echoes",2660,503,12,[10,9,147,148]',
  `9/30/2026 18:49:01.000-4  COMBATANT_INFO,${PLAYER},${COMBATANT_STATS},268,${COMBATANT_TAIL}`,
  `9/30/2026 18:49:01.000-4  COMBATANT_INFO,${HEALER},${COMBATANT_STATS},270,${COMBATANT_TAIL}`,
  // Spell damage: 11-field suffix ending in the ST/AOE category.
  `9/30/2026 18:50:23.123-4  SPELL_DAMAGE,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323764,"Convoke the Spirits",0x8,${ADV_ENEMY},54321,48000,-1,8,0,0,0,nil,nil,nil,ST`,
  `9/30/2026 18:50:24.500-4  SPELL_DAMAGE,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323764,"Convoke the Spirits",0x8,${ADV_ENEMY},108642,48000,-1,8,0,0,0,1,nil,nil,AOE`,
  // Pet damage: the owner link lives only in the advanced block.
  `9/30/2026 18:50:25.000-4  SPELL_DAMAGE,${PET},"Spirit Wolf",0x1111,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323765,"Bite",0x1,${ADV_PET},9000,9000,-1,1,0,0,0,nil,nil,nil,ST`,
  // Down a floor and back: two maps, each listed once.
  '9/30/2026 18:50:25.500-4  MAP_CHANGE,2358,"The Hollows",1250.500000,1150.500000,850.000000,750.000000',
  '9/30/2026 18:50:25.600-4  MAP_CHANGE,2357,"Ara-Kara, City of Echoes",1300.000000,1100.000000,900.000000,700.000000',
  // Heal: amount, baseAmount, overhealing, absorbed, critical.
  `9/30/2026 18:50:26.000-4  SPELL_HEAL,${HEALER},"Healy-Ázshara",0x512,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,116670,"Vivify",0x8,${ADV_PLAYER},32000,30000,5000,0,1`,
  // Healer tops up another player's pet. The advanced block describes the pet
  // and names its owner, which must not be read as the healer's owner.
  `9/30/2026 18:50:26.500-4  SPELL_HEAL,${HEALER},"Healy-Ázshara",0x512,0x0,${PET},"Spirit Wolf",0x1111,0x0,116670,"Vivify",0x8,${ADV_PET},4000,4000,0,0,nil`,
  // Interrupt: no advanced block, extra spell triple in the suffix.
  `9/30/2026 18:50:27.000-4  SPELL_INTERRUPT,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,183752,"Disrupt",0x1,324652,"Horrific Scream",0x20`,
  // Swing damage: 10-field suffix, no ST/AOE category.
  `9/30/2026 18:50:27.500-4  SWING_DAMAGE,${ENEMY},"Fungal Fiend",0xa48,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ADV_PLAYER},75979,248908,-1,1,0,0,0,nil,nil,nil`,
  // SWING_DAMAGE whose advanced block describes the ATTACKER, not the victim.
  `9/30/2026 18:50:27.600-4  SWING_DAMAGE,${ENEMY},"Fungal Fiend",0xa48,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ADV_ENEMY},1234,1234,-1,1,0,0,0,nil,nil,nil`,
  // Killing blow: overkill is positive here.
  `9/30/2026 18:50:28.000-4  SPELL_DAMAGE,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323764,"Convoke the Spirits",0x8,${ADV_ENEMY},120000,110000,7400,8,0,0,0,nil,nil,nil,ST`,
  `9/30/2026 18:50:28.001-4  UNIT_DIED,0000000000000000,nil,0x80000000,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,0,0,0,0`,
  // SPELL_ABSORBED, melee shape: no attacker spell triple. 18 fields.
  `9/30/2026 18:50:29.000-4  SPELL_ABSORBED,${ENEMY},"Fungal Fiend",0xa48,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,206967,"Will of the Necropolis",0x1,59945,833881,nil`,
  // SPELL_ABSORBED, spell shape: attacker spell triple present. 21 fields.
  `9/30/2026 18:50:29.500-4  SPELL_ABSORBED,${ENEMY},"Fungal Fiend",0xa48,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,1216570,"Fel Missiles",0x4,${PLAYER},"${PLAYER_NAME}",0x511,0x0,206967,"Will of the Necropolis",0x1,21011,73975,nil`,
  // SPELL_ABSORBED applied by someone else, which is the case that matters:
  // "absorbed" is only useful if it can say whose shield it was.
  `9/30/2026 18:50:29.700-4  SPELL_ABSORBED,${ENEMY},"Fungal Fiend",0xa48,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,1216570,"Fel Missiles",0x4,${HEALER},"Healy-Ázshara",0x512,0x0,17,"Power Word: Shield",0x2,8800,24000,nil`,
  // An absorb the log forgot to attribute: the attacker field is all zeroes.
  // The *_MISSED a millisecond later is the same blow and does name them.
  `9/30/2026 18:50:29.800-4  SPELL_ABSORBED,0000000000000000,nil,0x80000000,0x80000000,${ENEMY},"Fungal Fiend",0xa48,0x0,1216570,"Fel Missiles",0x4,${ENEMY},"Fungal Fiend",0xa48,0x0,881,"Warding Crystal",0x2,4400,12000,nil`,
  `9/30/2026 18:50:29.801-4  SPELL_MISSED,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,1216570,"Fel Missiles",0x4,ABSORB,nil,4400,4400,nil,ST`,
  // A miss that really missed, whose suffix is the missType and nothing else.
  // The ABSORB above it is logged as a miss too and must not read as one: that
  // blow connected, and its damage is on the SPELL_ABSORBED line beside it.
  `9/30/2026 18:50:29.850-4  SPELL_MISSED,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,1216570,"Fel Missiles",0x4,DODGE`,
  // The same hole with nothing to fill it. It must stay empty rather than
  // inherit whoever happens to swing next.
  `9/30/2026 18:50:29.900-4  SPELL_ABSORBED,0000000000000000,nil,0x80000000,0x80000000,${ENEMY},"Fungal Fiend",0xa48,0x0,999999,"Mystery Bolt",0x4,${ENEMY},"Fungal Fiend",0xa48,0x0,881,"Warding Crystal",0x2,1100,12000,nil`,
  // SPELL_HEAL_ABSORBED: same tail, minus the critical flag. 20 fields.
  `9/30/2026 18:50:30.000-4  SPELL_HEAL_ABSORBED,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,116888,"Shroud of Purgatory",0x20,${PLAYER},"${PLAYER_NAME}",0x511,0x0,45470,"Death Strike",0x1,1225,1081978`,
  // _SUPPORT: the supporter's GUID takes the place of the ST/AOE category.
  //
  // Two opposite things wear the suffix, and the line beside it is the only
  // thing that tells them apart. Ebon Might is the slice of the healer's own
  // hit that the evoker's buff added: the evoker's spell id, and no plain row
  // anywhere in the log carrying it. There is nothing to pair it with, and its
  // amount is already inside the healer's own damage — the hit on the line
  // above, which is the only thing the log says about which ability it was
  // part of, since the copy names the buff instead.
  `9/30/2026 18:50:30.999-4  SPELL_DAMAGE,${HEALER},"Healy-Ázshara",0x512,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,589,"Shadow Word: Pain",0x20,${ADV_ENEMY},12000,12000,-1,32,0,0,0,nil,nil,nil,ST`,
  `9/30/2026 18:50:31.000-4  SPELL_DAMAGE_SUPPORT,${HEALER},"Healy-Ázshara",0x512,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,395152,"Ebon Might",0xc,${ADV_ENEMY},4482,2141,-1,12,0,0,0,1,nil,nil,${PLAYER}`,
  // Bombardments is the other shape: a Scalecommander evoker's own bomb, which
  // the game logs as an ordinary hit credited to whichever party member set it
  // off, with the copy on the very next line naming the evoker. Same spell,
  // same actors, same amount — one hit written twice, and it is the evoker's.
  `9/30/2026 18:50:31.100-4  SPELL_DAMAGE,${HEALER},"Healy-Ázshara",0x512,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,434481,"Bombardments",0xc,${ADV_ENEMY},3000,3000,-1,12,0,0,0,nil,nil,nil,ST`,
  `9/30/2026 18:50:31.101-4  SPELL_DAMAGE_SUPPORT,${HEALER},"Healy-Ázshara",0x512,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,434481,"Bombardments",0xc,${ADV_ENEMY},3000,3000,-1,12,0,0,0,nil,nil,nil,${PLAYER}`,
  // A melee swing and the slice of it the buff added. This is the one place in
  // the format where _SUPPORT changes the layout rather than just the last
  // field: the copy carries a spell triple that a plain swing has nothing in
  // the place of, so the plain line is 37 fields and the copy 41. Blizzard
  // writes melee support only on the landed side — there is no
  // SWING_DAMAGE_SUPPORT at all.
  `9/30/2026 18:50:31.200-4  SWING_DAMAGE_LANDED,${HEALER},"Healy-Ázshara",0x512,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,${ADV_ENEMY},9000,9000,-1,1,0,0,0,nil,nil,nil`,
  `9/30/2026 18:50:31.201-4  SWING_DAMAGE_LANDED_SUPPORT,${HEALER},"Healy-Ázshara",0x512,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,395152,"Ebon Might",0xc,${ADV_ENEMY},700,700,-1,1,0,0,0,nil,nil,nil,${PLAYER}`,
  // An absorb's copy, which appends the supporter instead of replacing
  // anything: an absorb has no ST/AOE category to give up. Every read anchored
  // to the end of the line therefore shifts by one, and read as a plain absorb
  // this says the hit took 4,041 off the shield rather than 1,325. Blizzard
  // also puts the buff in the shield's slot here rather than the attack's,
  // which is why an absorbed slice is the one kind that cannot be credited.
  `9/30/2026 18:50:31.300-4  SPELL_ABSORBED_SUPPORT,${ENEMY},"Fungal Fiend",0xa48,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,1216570,"Fel Missiles",0x4,${HEALER},"Healy-Ázshara",0x512,0x0,413984,"Shifting Sands",0x40,1325,4041,nil,${PLAYER}`,
  // Aura with no stack amount, and SPELL_EXTRA_ATTACKS.
  `9/30/2026 18:50:32.000-4  SPELL_AURA_APPLIED,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,43308,"Find Fish",0x1,BUFF`,
  `9/30/2026 18:50:33.000-4  SPELL_EXTRA_ATTACKS,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,465660,"Skyfury",0x1,1`,
  // ENVIRONMENTAL_DAMAGE: environmentalType follows the advanced block.
  `9/30/2026 18:50:40.000-4  ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,${PLAYER},"${PLAYER_NAME}",0x512,0x0,${ADV_PLAYER},Falling,58734,58734,0,1,0,0,0,nil,nil,nil`,
  // A guardian, the half of pet attribution the advanced block cannot carry.
  // It is a Creature- GUID, NPC-flagged at the moment it is summoned, and its
  // own damage describes the victim — so SPELL_SUMMON is the only link there
  // is. By the time it swings it is player-controlled, which is what makes the
  // link trustworthy.
  `9/30/2026 18:50:34.000-4  SPELL_SUMMON,${PLAYER},"${PLAYER_NAME}",0x512,0x0,${GUARDIAN},"Demonic Tyrant",0xa28,0x0,265187,"Summon Demonic Tyrant",0x20`,
  `9/30/2026 18:50:35.000-4  SPELL_DAMAGE,${GUARDIAN},"Demonic Tyrant",0x2112,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,1264093,"Burning Cleave",0x24,${ADV_ENEMY},13000,13000,-1,36,0,0,0,nil,nil,nil,AOE`,
  // The same shape used against the party: a hostile unit that names a player
  // in its ownerGUID because it encased them. It never becomes
  // player-controlled, so it is nobody's minion.
  `9/30/2026 18:50:36.000-4  SPELL_DAMAGE,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${TOMB},"Glacial Tomb",0xa48,0x0,323764,"Convoke the Spirits",0x8,${ADV_TOMB},700,700,-1,8,0,0,0,nil,nil,nil,ST`,
  '9/30/2026 19:05:00.000-4  ENCOUNTER_START,2926,"Avanoxx",8,5,2660',
  '9/30/2026 19:08:30.000-4  ENCOUNTER_END,2926,"Avanoxx",8,5,1',
  // The key ran 31 minutes of wall clock and the timer says 31:30: the extra
  // 30s is what the game charged for dying. Deliberately different, so a test
  // can tell the two clocks apart.
  '9/30/2026 19:20:00.000-4  CHALLENGE_MODE_END,2660,1,12,1890000,180',
  // An event outside any run, which must not be recorded.
  `9/30/2026 19:30:00.000-4  SPELL_DAMAGE,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Target Dummy",0xa48,0x0,323764,"Convoke the Spirits",0x8,${ADV_ENEMY},1,1,-1,8,0,0,0,nil,nil,nil,ST`,
];

export const LOG_TEXT = LINES.join('\n') + '\n';

/**
 * Pre-12.1.0 equivalent: no year, no zone offset, a 17-field advanced block,
 * no baseAmount in the damage suffix and no ST/AOE category.
 */
const ADV_ENEMY_17 =
  'Creature-0-1234-2291-1234-191622-00001234,0000000000000000,120000,150000,0,0,1470,0,3,100,100,0,1234.56,789.01,2291,1.5,70';

export const LEGACY_LINES: string[] = [
  '9/30 18:49:00.000  CHALLENGE_MODE_START,"Ara-Kara, City of Echoes",2660,503,12,[10,9,147,148]',
  `9/30 18:50:23.123  SPELL_DAMAGE,${PLAYER},"Testy-Area52",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323764,"Convoke",0x8,${ADV_ENEMY_17},54321,-1,8,0,0,0,nil,nil,nil`,
  '9/30 19:20:00.000  CHALLENGE_MODE_END,2660,1,12,1860000,180',
];

export const LEGACY_TEXT = LEGACY_LINES.join('\n') + '\n';

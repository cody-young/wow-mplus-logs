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

export const PLAYER = 'Player-1234-0000ABCD';
export const HEALER = 'Player-1234-0000BEEF';
export const PET = 'Pet-0-1234-2291-1234-165189-01000ABCD';
export const ENEMY = 'Creature-0-1234-2291-1234-191622-00001234';

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
  // Zone name contains a comma inside quotes.
  '9/30/2026 18:49:00.000-4  CHALLENGE_MODE_START,"Ara-Kara, City of Echoes",2660,503,12,[10,9,147,148]',
  `9/30/2026 18:49:01.000-4  COMBATANT_INFO,${PLAYER},${COMBATANT_STATS},268,${COMBATANT_TAIL}`,
  `9/30/2026 18:49:01.000-4  COMBATANT_INFO,${HEALER},${COMBATANT_STATS},270,${COMBATANT_TAIL}`,
  // Spell damage: 11-field suffix ending in the ST/AOE category.
  `9/30/2026 18:50:23.123-4  SPELL_DAMAGE,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323764,"Convoke the Spirits",0x8,${ADV_ENEMY},54321,48000,-1,8,0,0,0,nil,nil,nil,ST`,
  `9/30/2026 18:50:24.500-4  SPELL_DAMAGE,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323764,"Convoke the Spirits",0x8,${ADV_ENEMY},108642,48000,-1,8,0,0,0,1,nil,nil,AOE`,
  // Pet damage: the owner link lives only in the advanced block.
  `9/30/2026 18:50:25.000-4  SPELL_DAMAGE,${PET},"Spirit Wolf",0x1111,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,323765,"Bite",0x1,${ADV_PET},9000,9000,-1,1,0,0,0,nil,nil,nil,ST`,
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
  // SPELL_HEAL_ABSORBED: same tail, minus the critical flag. 20 fields.
  `9/30/2026 18:50:30.000-4  SPELL_HEAL_ABSORBED,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,116888,"Shroud of Purgatory",0x20,${PLAYER},"${PLAYER_NAME}",0x511,0x0,45470,"Death Strike",0x1,1225,1081978`,
  // _SUPPORT: the supporter's GUID takes the place of the ST/AOE category.
  `9/30/2026 18:50:31.000-4  SPELL_DAMAGE_SUPPORT,${HEALER},"Healy-Ázshara",0x512,0x0,${ENEMY},"Fungal Fiend",0xa48,0x0,434481,"Bombardments",0xc,${ADV_ENEMY},4482,2141,-1,12,0,0,0,1,nil,nil,${PLAYER}`,
  // Aura with no stack amount, and SPELL_EXTRA_ATTACKS.
  `9/30/2026 18:50:32.000-4  SPELL_AURA_APPLIED,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,43308,"Find Fish",0x1,BUFF`,
  `9/30/2026 18:50:33.000-4  SPELL_EXTRA_ATTACKS,${PLAYER},"${PLAYER_NAME}",0x511,0x0,${PLAYER},"${PLAYER_NAME}",0x511,0x0,465660,"Skyfury",0x1,1`,
  // ENVIRONMENTAL_DAMAGE: environmentalType follows the advanced block.
  `9/30/2026 18:50:40.000-4  ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,${PLAYER},"${PLAYER_NAME}",0x512,0x0,${ADV_PLAYER},Falling,58734,58734,0,1,0,0,0,nil,nil,nil`,
  '9/30/2026 19:05:00.000-4  ENCOUNTER_START,2926,"Avanoxx",8,5,2660',
  '9/30/2026 19:08:30.000-4  ENCOUNTER_END,2926,"Avanoxx",8,5,1',
  '9/30/2026 19:20:00.000-4  CHALLENGE_MODE_END,2660,1,12,1860000,180',
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

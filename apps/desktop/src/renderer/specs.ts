/**
 * Class and spec identity.
 *
 * Static game data that will move to a `@mplus/data` package once dungeon and
 * affix tables join it. The ids are stable across patches; new specs get added.
 */
export interface SpecInfo {
  name: string;
  className: string;
  color: string;
  role: 'tank' | 'healer' | 'dps';
  /**
   * The spec's icon as the game's own texture name, which is also the filename
   * the icon CDN serves. Named rather than given as a spell id because a spec
   * is not a spell: there is no id to look up, and these names have outlived
   * every spell whose icon they once were.
   */
  icon: string;
}

const C = {
  deathKnight: '#C41E3A',
  demonHunter: '#A330C9',
  druid: '#FF7C0A',
  evoker: '#33937F',
  hunter: '#AAD372',
  mage: '#3FC7EB',
  monk: '#00FF98',
  paladin: '#F48CBA',
  priest: '#F0F0F0',
  rogue: '#FFF468',
  shaman: '#0070DD',
  warlock: '#8788EE',
  warrior: '#C69B6D',
} as const;

export const SPECS: Record<number, SpecInfo> = {
  250: { name: 'Blood', className: 'Death Knight', color: C.deathKnight, role: 'tank', icon: 'spell_deathknight_bloodpresence' },
  251: { name: 'Frost', className: 'Death Knight', color: C.deathKnight, role: 'dps', icon: 'spell_deathknight_frostpresence' },
  252: { name: 'Unholy', className: 'Death Knight', color: C.deathKnight, role: 'dps', icon: 'spell_deathknight_unholypresence' },
  577: { name: 'Havoc', className: 'Demon Hunter', color: C.demonHunter, role: 'dps', icon: 'ability_demonhunter_specdps' },
  581: { name: 'Vengeance', className: 'Demon Hunter', color: C.demonHunter, role: 'tank', icon: 'ability_demonhunter_spectank' },
  102: { name: 'Balance', className: 'Druid', color: C.druid, role: 'dps', icon: 'spell_nature_starfall' },
  103: { name: 'Feral', className: 'Druid', color: C.druid, role: 'dps', icon: 'ability_druid_catform' },
  104: { name: 'Guardian', className: 'Druid', color: C.druid, role: 'tank', icon: 'ability_racial_bearform' },
  105: { name: 'Restoration', className: 'Druid', color: C.druid, role: 'healer', icon: 'spell_nature_healingtouch' },
  1467: { name: 'Devastation', className: 'Evoker', color: C.evoker, role: 'dps', icon: 'classicon_evoker_devastation' },
  1468: { name: 'Preservation', className: 'Evoker', color: C.evoker, role: 'healer', icon: 'classicon_evoker_preservation' },
  1473: { name: 'Augmentation', className: 'Evoker', color: C.evoker, role: 'dps', icon: 'classicon_evoker_augmentation' },
  253: { name: 'Beast Mastery', className: 'Hunter', color: C.hunter, role: 'dps', icon: 'ability_hunter_bestialdiscipline' },
  254: { name: 'Marksmanship', className: 'Hunter', color: C.hunter, role: 'dps', icon: 'ability_hunter_focusedaim' },
  255: { name: 'Survival', className: 'Hunter', color: C.hunter, role: 'dps', icon: 'ability_hunter_camouflage' },
  62: { name: 'Arcane', className: 'Mage', color: C.mage, role: 'dps', icon: 'spell_holy_magicalsentry' },
  63: { name: 'Fire', className: 'Mage', color: C.mage, role: 'dps', icon: 'spell_fire_firebolt02' },
  64: { name: 'Frost', className: 'Mage', color: C.mage, role: 'dps', icon: 'spell_frost_frostbolt02' },
  268: { name: 'Brewmaster', className: 'Monk', color: C.monk, role: 'tank', icon: 'spell_monk_brewmaster_spec' },
  269: { name: 'Windwalker', className: 'Monk', color: C.monk, role: 'dps', icon: 'spell_monk_windwalker_spec' },
  270: { name: 'Mistweaver', className: 'Monk', color: C.monk, role: 'healer', icon: 'spell_monk_mistweaver_spec' },
  65: { name: 'Holy', className: 'Paladin', color: C.paladin, role: 'healer', icon: 'spell_holy_holybolt' },
  66: { name: 'Protection', className: 'Paladin', color: C.paladin, role: 'tank', icon: 'ability_paladin_shieldofthetemplar' },
  70: { name: 'Retribution', className: 'Paladin', color: C.paladin, role: 'dps', icon: 'spell_holy_auraoflight' },
  256: { name: 'Discipline', className: 'Priest', color: C.priest, role: 'healer', icon: 'spell_holy_powerwordshield' },
  257: { name: 'Holy', className: 'Priest', color: C.priest, role: 'healer', icon: 'spell_holy_guardianspirit' },
  258: { name: 'Shadow', className: 'Priest', color: C.priest, role: 'dps', icon: 'spell_shadow_shadowwordpain' },
  259: { name: 'Assassination', className: 'Rogue', color: C.rogue, role: 'dps', icon: 'ability_rogue_eviscerate' },
  260: { name: 'Outlaw', className: 'Rogue', color: C.rogue, role: 'dps', icon: 'inv_sword_30' },
  261: { name: 'Subtlety', className: 'Rogue', color: C.rogue, role: 'dps', icon: 'ability_stealth' },
  262: { name: 'Elemental', className: 'Shaman', color: C.shaman, role: 'dps', icon: 'spell_nature_lightning' },
  263: { name: 'Enhancement', className: 'Shaman', color: C.shaman, role: 'dps', icon: 'spell_shaman_improvedstormstrike' },
  264: { name: 'Restoration', className: 'Shaman', color: C.shaman, role: 'healer', icon: 'spell_nature_magicimmunity' },
  265: { name: 'Affliction', className: 'Warlock', color: C.warlock, role: 'dps', icon: 'spell_shadow_deathcoil' },
  266: { name: 'Demonology', className: 'Warlock', color: C.warlock, role: 'dps', icon: 'spell_shadow_metamorphosis' },
  267: { name: 'Destruction', className: 'Warlock', color: C.warlock, role: 'dps', icon: 'spell_shadow_rainoffire' },
  71: { name: 'Arms', className: 'Warrior', color: C.warrior, role: 'dps', icon: 'ability_warrior_savageblow' },
  72: { name: 'Fury', className: 'Warrior', color: C.warrior, role: 'dps', icon: 'ability_warrior_innerrage' },
  73: { name: 'Protection', className: 'Warrior', color: C.warrior, role: 'tank', icon: 'ability_warrior_defensivestance' },
};

const UNKNOWN: SpecInfo = {
  name: 'Unknown',
  className: '',
  color: '#8a8aa0',
  role: 'dps',
  // No icon rather than a placeholder one: an unknown spec is a pet, an NPC or
  // a player whose COMBATANT_INFO never arrived, and a question-mark icon in a
  // damage table reads as a broken image.
  icon: '',
};

export function specOf(specId: number): SpecInfo {
  return SPECS[specId] ?? UNKNOWN;
}

/** Player names arrive as "Name-Realm"; the realm is noise in a party of five. */
export function shortName(name: string): string {
  const dash = name.indexOf('-');
  return dash === -1 ? name : name.slice(0, dash);
}

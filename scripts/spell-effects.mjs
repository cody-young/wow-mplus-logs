#!/usr/bin/env node
/**
 * Rebuild what we know about spells from Blizzard's own data.
 *
 * One table, SpellEffect.db2, answers three questions the reports ask, so one
 * script reads it once and writes all three answers:
 *
 *   packages/data/src/defensives.ts     which spells do something about damage
 *   packages/data/src/markers.ts        which spells the data gives no effect at all
 *   packages/data/src/interrupts.ts     which spells are interrupt buttons
 *   packages/data/src/crowd-control.ts  which auras take a unit out of the fight
 *   packages/data/src/dispels.ts        which spells are dispels, and which auras are enrages
 *   packages/data/src/procs.ts          how often each proc is meant to fire
 *
 * There is no "this is a defensive" flag in the game's data, and no amount of
 * looking for one will turn one up. What Blizzard does classify is *effects*:
 * every spell carries a list of them in SpellEffect.db2, and each one names the
 * aura it applies — SCHOOL_ABSORB, MOD_DAMAGE_PERCENT_TAKEN, SCHOOL_IMMUNITY.
 * That vocabulary is the thing we actually want. A spell that reduces the
 * damage you take is a defensive whatever it is called and whichever patch
 * invented it.
 *
 * So the judgement call is not "which five hundred spells are defensives",
 * which goes stale every patch and has to be redone per spec. It is "which ten
 * aura types mean survival", which has barely moved in a decade. The list is in
 * KINDS below, with the spell that proves each one.
 *
 * The second question falls out of the same read. A spell whose every effect
 * applies SPELL_AURA_DUMMY and triggers nothing has no effect in the data at
 * all, and the markers the game leaves on players — Sated, Hypothermia,
 * Cauterized — are exactly that shape. See markers.ts for why that is only
 * trustworthy about an aura the player put on themselves.
 *
 * The third is the same move again, against a different effect: the one that
 * stops a cast. See EFFECT_INTERRUPT_CAST and SCRIPTED_INTERRUPTS below.
 *
 * The fourth is the aura vocabulary again, for a different question: which
 * auras mean the unit is not fighting. See CONTROLS.
 *
 * The fifth needs a second, much smaller table. Which spells are dispels is an
 * effect again (EFFECT_DISPEL), but whether the aura a dispel removed was an
 * enrage is not an effect of anything: it is the aura's own dispel type, which
 * lives in SpellCategories.db2. See DISPEL_EFFECTS and DISPEL_TYPE_ENRAGE.
 *
 * The sixth follows the trigger aura from a proc's passive to the spell the
 * log shows, and joins the passive's rate from three more small tables. See
 * PROC_TRIGGER_AURAS.
 *
 *   node scripts/spell-effects.mjs [--build 12.1.0.69933] [--csv SpellEffect.csv]
 *                                  [--categories-csv SpellCategories.csv]
 *                                  [--keep] [--check]
 *
 * --build pins a build (default: whatever wago.tools says is live), --csv and
 * --categories-csv read tables already on disk, --keep leaves the downloads in
 * the cache directory it prints, and --check writes nothing and exits non-zero
 * if any committed table is out of date, which is the form to run in CI.
 *
 * The downloads are ~60MB and the result is ~130KB of spell IDs, which is the
 * whole reason this is a build step and not something the app does at runtime.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The aura types that mean survival, each with the spell that demonstrates it.
 *
 * Every number here was read off the data rather than trusted from memory: the
 * witness spell was looked up in SpellEffect.db2 and found to carry the aura.
 * The names match TrinityCore's SpellAuraDefines.h, which agrees with all ten.
 *
 * MECHANIC_IMMUNITY (77) is deliberately absent. It is crowd-control immunity —
 * Blessing of Freedom, the PvP trinket — which is utility rather than survival,
 * and every real defensive that carries it (Icebound Fortitude, Unending
 * Resolve, Aspect of the Turtle) carries MOD_DAMAGE_PERCENT_TAKEN as well, so
 * including it would have bought noise and nothing else.
 */
const KINDS = [
  { aura: 69, name: 'SCHOOL_ABSORB', kind: 'absorb', flag: 1, witness: 'Power Word: Shield' },
  { aura: 87, name: 'MOD_DAMAGE_PERCENT_TAKEN', kind: 'reduction', flag: 2, witness: 'Shield Wall, −40' },
  { aura: 39, name: 'SCHOOL_IMMUNITY', kind: 'immunity', flag: 4, witness: 'Divine Shield' },
  { aura: 40, name: 'DAMAGE_IMMUNITY', kind: 'immunity', flag: 4, witness: 'Netherwalk' },
  { aura: 47, name: 'MOD_PARRY_PERCENT', kind: 'avoidance', flag: 8, witness: 'Demon Spikes, +8' },
  { aura: 49, name: 'MOD_DODGE_PERCENT', kind: 'avoidance', flag: 8, witness: 'Evasion, +200' },
  { aura: 34, name: 'MOD_INCREASE_HEALTH', kind: 'health', flag: 16, witness: 'Rallying Cry' },
  { aura: 133, name: 'MOD_INCREASE_HEALTH_PERCENT', kind: 'health', flag: 16, witness: 'Last Stand, +30' },
  { aura: 118, name: 'MOD_HEALING_PCT', kind: 'healing', flag: 32, witness: 'Vampiric Blood, +30' },
  { aura: 81, name: 'SPLIT_DAMAGE_PCT', kind: 'shared', flag: 64, witness: 'Blessing of Sacrifice, 30' },
];

/**
 * Defensives the data cannot describe, because Blizzard implemented them as a
 * script behind SPELL_AURA_DUMMY rather than as an effect.
 *
 * This is the part that has to be maintained by hand, and the reason to keep it
 * honest and short: a list of two is a footnote, a list of two hundred is the
 * curation problem this script exists to avoid. Anything added here needs the
 * check that it really is a dummy — if the aura is in the data, fix the aura
 * list instead.
 */
const SCRIPTED = [
  { id: 61336, flag: 2, why: 'Survival Instincts — 50% reduction, carried as DUMMY(50)' },
  { id: 374348, flag: 2, why: 'Renewing Blaze — DUMMY(100), the healing is scripted' },
];

/**
 * Buffs the data files under a survival aura that are not what anybody means
 * by a defensive: they sit on a player all key, so a death recap that lists
 * them lists them on every death.
 *
 * SCRIPTED's mirror image, and held to the same rule — short, and each entry
 * read off the data. The obvious general rule does not work: Earth Shield and
 * Fortitude carry MOD_DAMAGE_PERCENT_TAKEN at 0, a slot a talent fills, but so
 * do Feint, Cloak of Shadows, Shield Block and Defensive Stance, whose real
 * value is scripted. Dropping zeroes would have dropped those with them.
 */
const NOT_DEFENSIVE = [
  { id: 974, why: 'Earth Shield — MOD_DAMAGE_PERCENT_TAKEN(0), filled by a talent' },
  { id: 383648, why: 'Earth Shield, the copy on the shaman — same three effects' },
  { id: 21562, why: 'Power Word: Fortitude — MOD_DAMAGE_PERCENT_TAKEN(0), filled by a talent' },
  { id: 207400, why: 'Ancestral Vigor, the talent — MOD_INCREASE_HEALTH_PERCENT(0)' },
  { id: 207498, why: 'Ancestral Vigor — +10% health on whoever the shaman heals' },
];

/**
 * The effect that stops a cast.
 *
 * 68 is SPELL_EFFECT_INTERRUPT_CAST, read off the data rather than trusted
 * from memory: every interrupt a player presses carries it — Kick (1766),
 * Pummel (6552), Mind Freeze (47528), Counterspell (2139), Wind Shear (57994),
 * Disrupt (183752), Quell (351338), Rebuke (96231), Spear Hand Strike
 * (116705), Counter Shot (147362), Spell Lock (19647) — and TrinityCore's
 * SharedDefines.h gives the same number the same name.
 */
const EFFECT_INTERRUPT_CAST = 68;

/**
 * An interrupt button is a spell that does nothing *but* interrupt.
 *
 * 603 spells in the data carry the interrupt effect, and most of them are not
 * what anybody means by an interrupt. Avenger's Shield interrupts; a
 * protection paladin presses it on cooldown as a rotational ability, and
 * counting its casts as interrupt attempts would report a tank whiffing a
 * hundred interrupts a key. What separates the two is not the interrupt but
 * everything else: Avenger's Shield also deals damage, jumps to two more
 * targets and applies a silence, while a Kick does nothing at all except stop
 * a cast.
 *
 * So the rule is subtraction rather than curation: of the 603, the 136 whose
 * *every* described effect is INTERRUPT_CAST. Every player interrupt in the
 * game is in that set, and nothing that deals damage is.
 */

/**
 * Interrupt buttons the data cannot describe, because the interrupt is in a
 * script or behind a trigger rather than in the spell that was pressed.
 *
 * The same hand-held list as SCRIPTED above, for the same reason and with the
 * same rule: each entry names the evidence. The first four are witnessed
 * pairings — the cast is in a real log, followed within milliseconds by a
 * SPELL_INTERRUPT under a different id — and the fifth is linked by the data
 * itself through its own trigger spell.
 *
 * Nothing here is load-bearing for the interrupts a key *landed*: those are
 * read off SPELL_INTERRUPT, which needs no table at all. A button missing from
 * this list costs only its whiffs, which is why the list can afford to hold
 * just what could be identified.
 */
const SCRIPTED_INTERRUPTS = [
  { id: 106839, why: 'Skull Bash — DUMMY in the data; the interrupt lands as 93985 (64 pairings)' },
  { id: 15487, why: 'Silence — a MOD_SILENCE aura; the interrupt lands as 220543 (18 pairings)' },
  { id: 132409, why: 'Spell Lock, sacrificed pet — INTERRUPT_CAST plus a DUMMY, so not dedicated (7 pairings)' },
  { id: 78675, why: 'Solar Beam — triggers 97547, which is dedicated (2 pairings)' },
  { id: 89766, why: 'Axe Toss — a stun whose trigger, 347008, is dedicated' },
];

/**
 * The auras that take a unit out of the fight, each with its evidence.
 *
 * Same move as KINDS above and the same reason: "which seven auras are crowd
 * control" is a question about the game's vocabulary, which barely moves,
 * while "which spells are crowd control" is a list that goes stale every
 * patch and has to be redone per spec.
 *
 * Two things were read off the data for each one, because the aura number
 * alone is a guess. The witness is a spell that carries the aura and is
 * unarguably that kind of control. The mechanic is the agreement: most rows
 * carrying these auras also name a mechanic, and the one they name matches —
 * aura 12 with MECHANIC_STUN on 1,351 rows, aura 7 with MECHANIC_FEAR on 222.
 * Two independent columns saying the same thing is the whole case here.
 *
 * Stun and root each have two aura numbers. The second is not a duplicate of
 * the first: Asphyxiate carries 298 and nothing else, Entangling Roots
 * carries 455 and nothing else, so dropping either loses real control.
 *
 * MOD_DECREASE_SPEED (33) is deliberately absent, and this is the decision
 * that shapes the whole table. A slow is not being taken out of the fight,
 * and the auras cannot tell a Ring of Frost from a paladin standing in their
 * own Consecration. Measured on one real evening of keys, including it put
 * Consecration top of the chart at 1,430 applications, with Grip of the Dead
 * (1,058) and Permeating Chill (891) behind it — three passives, none of them
 * pressed, none of them control, between them nine times every hard control
 * in the log put together. Left out, the same log reports eight distinct
 * spells and every one of them is a real press.
 */
const CONTROLS = [
  { aura: 12, kind: 'stun', flag: 1, witness: 'Hammer of Justice', mechanic: 'STUN on 1351 rows' },
  { aura: 298, kind: 'stun', flag: 1, witness: 'Asphyxiate, which carries no other', mechanic: 'STUN on 17 rows' },
  { aura: 5, kind: 'disorient', flag: 2, witness: 'Blind', mechanic: 'DISORIENTED on 189 rows' },
  { aura: 7, kind: 'fear', flag: 4, witness: 'Psychic Scream', mechanic: 'FEAR on 222 rows' },
  { aura: 27, kind: 'silence', flag: 8, witness: 'Silence', mechanic: 'SILENCE on 131 rows' },
  { aura: 26, kind: 'root', flag: 16, witness: 'Chains of Ice', mechanic: 'ROOT on 355 rows' },
  { aura: 455, kind: 'root', flag: 16, witness: 'Entangling Roots, which carries no other', mechanic: 'ROOT on 46 rows' },
];

/**
 * The implicit target that means an effect lands on the caster and nobody
 * else: TARGET_UNIT_CASTER, as TrinityCore's SharedDefines.h names it.
 *
 * A control effect aimed there is the caster holding itself still, not
 * control of anything, and the log cannot tell the two apart because it
 * names the spell rather than the effect. The Antoran Inquisitor's Mind Sear
 * (1280457) is the case that found it: a periodic trigger on the enemy and a
 * MOD_ROOT on the Inquisitor while it channels. Counted by spell, every tick
 * of its channel read as a root on the boss it was searing, which was 10,105
 * applications across a month of keys, on bosses that cannot be rooted at
 * all. Over the same logs it was the only aura the party put on an enemy
 * that this rule removes. 5,185 spells leave the table, nearly all of them
 * NPCs rooting or stunning themselves for a cast.
 */
const TARGET_UNIT_CASTER = 1;

/**
 * The effects that make a spell a dispel.
 *
 * 38 is SPELL_EFFECT_DISPEL, whose misc value is the dispel type it removes,
 * and 126 is SPELL_EFFECT_STEAL_BENEFICIAL_BUFF, which is Spellsteal. Both read
 * off the data rather than trusted from memory: every dispel a party presses
 * carries 38 — Purge (370), Cleanse (4987), Detox (115450), Purify (527),
 * Soothe (2908), Tranquilizing Shot (19801), the Poison Cleansing totem's pulse
 * (383015) — and Spellsteal (30449) carries 126 alone.
 *
 * The table exists because the log is generous with the word. SPELL_DISPEL is
 * also what the game writes when Cat Form, Disengage, Tiger's Lust or Demonic
 * Circle shrug off a root, and across eight real evenings of logs those were a
 * fifth of every party member's "dispels" of their own party. None of them
 * carries effect 38 — a shapeshift is an aura, a Disengage is a leap — so the
 * effect is the line between "removed a debuff" and "moved out of a root",
 * and no list of exceptions has to be kept.
 */
const DISPEL_EFFECTS = new Set([38, 126]);

/**
 * The dispel type that makes a removed buff a soothe rather than a purge.
 *
 * Read off SpellDispelType.db2, where 9 is Enrage (1 Magic, 2 Curse, 3 Disease,
 * 4 Poison, 11 Bleed). The witnesses are the dispels themselves: Soothe and
 * Shiv carry EFFECT_DISPEL with misc value 9 and nothing else, and
 * Tranquilizing Shot carries both 1 and 9 — which is exactly why this is a
 * property of the aura and not of the button. One Tranquilizing Shot is a
 * purge and the next is a soothe, and only the aura it took says which.
 */
const DISPEL_TYPE_ENRAGE = 9;

/**
 * The two numbers that spell "this effect does nothing the data can describe".
 *
 * Effect 6 is APPLY_AURA and aura 4 is SPELL_AURA_DUMMY, both confirmed against
 * TrinityCore's SpellAuraDefines.h and against the witnesses in markers.ts. A
 * dummy that names a trigger spell is not inert — the trigger is the effect —
 * so EffectTriggerSpell has to be 0 as well.
 */
const EFFECT_APPLY_AURA = 6;
const AURA_DUMMY = 4;

/**
 * The auras that fire another spell when something happens: PROC_TRIGGER_SPELL
 * (42) and PROC_TRIGGER_SPELL_WITH_VALUE (231), as TrinityCore names them.
 *
 * A proc is two spells. The passive on the player — a trinket's equip effect,
 * a weapon enchant — carries the chance, in SpellAuraOptions.db2; the spell
 * it triggers is the one the log shows, as a buff or a hit. This aura is the
 * link between them, and its EffectTriggerSpell names the second.
 */
const PROC_TRIGGER_AURAS = new Set([42, 231]);

/**
 * The real-procs-per-minute modifiers this table honours, from
 * SpellProcsPerMinuteMod.db2's Type column, as SimulationCraft names them.
 *
 * Class and spec only. The others scale with a player's haste, crit, race or
 * item level, which the log does not reliably carry, and leaving them out
 * moves every player's expected count the same way rather than reordering
 * anyone. Read off the data: Might of the Void, Frenzied Focus and Halazzi's
 * Rite carry no modifier at all, while 573 of the 841 rows are spec rows.
 */
const RPPM_MOD_CLASS = 3;
const RPPM_MOD_SPEC = 4;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const checkOnly = args.includes('--check');
const keep = args.includes('--keep');

const outDefensives = fileURLToPath(new URL('../packages/data/src/defensives.ts', import.meta.url));
const outMarkers = fileURLToPath(new URL('../packages/data/src/markers.ts', import.meta.url));
const outInterrupts = fileURLToPath(new URL('../packages/data/src/interrupts.ts', import.meta.url));
const outControl = fileURLToPath(new URL('../packages/data/src/crowd-control.ts', import.meta.url));
const outDispels = fileURLToPath(new URL('../packages/data/src/dispels.ts', import.meta.url));
const outProcs = fileURLToPath(new URL('../packages/data/src/procs.ts', import.meta.url));

const build = flag('build') ?? (await liveBuild());
const csvPath = flag('csv');
const csv = csvPath === undefined ? await download('SpellEffect', build) : readFileSync(csvPath, 'utf8');
const categoriesPath = flag('categories-csv');
const categoriesCsv =
  categoriesPath === undefined
    ? await download('SpellCategories', build)
    : readFileSync(categoriesPath, 'utf8');
const auraOptionsCsv = await download('SpellAuraOptions', build);
const rppmCsv = await download('SpellProcsPerMinute', build);
const rppmModCsv = await download('SpellProcsPerMinuteMod', build);

const header = csv.slice(0, csv.indexOf('\n')).split(',');
const columns = {
  aura: header.indexOf('EffectAura'),
  spell: header.indexOf('SpellID'),
  effect: header.indexOf('Effect'),
  trigger: header.indexOf('EffectTriggerSpell'),
  target: header.indexOf('ImplicitTarget_0'),
};
const missing = Object.entries(columns)
  .filter(([, at]) => at < 0)
  .map(([name]) => name);
if (missing.length > 0) {
  console.error(`SpellEffect.csv has no ${missing.join('/')} column. Columns: ${header.join(', ')}`);
  console.error('The table was renamed or restructured; the aura list needs re-reading before this can run.');
  process.exit(1);
}
const { aura: auraAt, spell: spellAt, effect: effectAt, trigger: triggerAt, target: targetAt } = columns;

// Every value in this table is a number, so splitting on commas is safe and an
// order of magnitude faster than a real CSV reader over 629k rows.
const wanted = new Map(KINDS.map((entry) => [String(entry.aura), entry.flag]));
const flags = new Map();
// Control auras, gathered the same way as the defensive ones: a spell can
// carry several — Blinding Sleet disorients and slows — so the bits are or-ed
// together rather than the first one winning.
const controlWanted = new Map();
for (const entry of CONTROLS) {
  controlWanted.set(String(entry.aura), (controlWanted.get(String(entry.aura)) ?? 0) | entry.flag);
}
const controlFlags = new Map();
// A spell is inert if it has a do-nothing effect and no other kind. Both halves
// are collected in the one pass and subtracted afterwards, because the rows of
// a spell are not guaranteed to be adjacent.
const doesNothing = new Set();
const doesSomething = new Set();
// Interrupts, gathered the same way and subtracted the same way: a spell is a
// dedicated interrupt if it stops casts and does nothing else.
const interrupts = new Set();
const alsoDoesSomethingElse = new Set();
// Dispels need no subtraction: a spell that dispels is a dispel whatever else
// it does, and Revival healing the party while it cleanses is still a cleanse.
const dispels = new Set();
// Passive -> the spells its proc auras trigger.
const triggers = new Map();
let rows = 0;
for (const line of csv.split('\n')) {
  if (line === '' || rows++ === 0) continue;
  const fields = line.split(',');
  const id = Number(fields[spellAt]);
  if (!Number.isFinite(id) || id === 0) continue;

  const bit = wanted.get(fields[auraAt]);
  if (bit !== undefined) flags.set(id, (flags.get(id) ?? 0) | bit);

  const control = controlWanted.get(fields[auraAt]);
  const onSelf = Number(fields[targetAt]) === TARGET_UNIT_CASTER;
  if (control !== undefined && !onSelf) controlFlags.set(id, (controlFlags.get(id) ?? 0) | control);

  const triggered = Number(fields[triggerAt]);
  if (PROC_TRIGGER_AURAS.has(Number(fields[auraAt])) && triggered > 0) {
    if (!triggers.has(id)) triggers.set(id, new Set());
    triggers.get(id).add(triggered);
  }

  const effect = Number(fields[effectAt]);
  if (effect === 0) continue;
  if (DISPEL_EFFECTS.has(effect)) dispels.add(id);
  if (effect === EFFECT_INTERRUPT_CAST) interrupts.add(id);
  else alsoDoesSomethingElse.add(id);
  if (
    effect === EFFECT_APPLY_AURA &&
    Number(fields[auraAt]) === AURA_DUMMY &&
    Number(fields[triggerAt]) === 0
  ) {
    doesNothing.add(id);
  } else {
    doesSomething.add(id);
  }
}
for (const { id, flag: bit } of SCRIPTED) flags.set(id, (flags.get(id) ?? 0) | bit);

const ids = [...flags.keys()].sort((a, b) => a - b);
const controlIds = [...controlFlags.keys()].sort((a, b) => a - b);
const inert = [...doesNothing].filter((id) => !doesSomething.has(id)).sort((a, b) => a - b);
const dedicated = [...interrupts].filter((id) => !alsoDoesSomethingElse.has(id));
const byHand = SCRIPTED_INTERRUPTS.filter(({ id }) => !dedicated.includes(id));
const stoppers = [...new Set([...dedicated, ...SCRIPTED_INTERRUPTS.map(({ id }) => id)])].sort((a, b) => a - b);
console.log(
  `${rows - 1} effect rows → ${ids.length} defensive spells, ${inert.length} inert markers, ` +
    `${stoppers.length} interrupts (${interrupts.size} carry the effect, ${dedicated.length} do nothing else, ` +
    `${byHand.length} added by hand), ${controlIds.length} control auras`,
);
for (const { kind, flag: bit } of dedupe(KINDS)) {
  console.log(`  ${kind.padEnd(10)} ${ids.filter((id) => (flags.get(id) & bit) !== 0).length}`);
}

const categoriesHeader = categoriesCsv.slice(0, categoriesCsv.indexOf('\n')).split(',');
const categoryColumns = {
  spell: categoriesHeader.indexOf('SpellID'),
  dispelType: categoriesHeader.indexOf('DispelType'),
for (const { id } of NOT_DEFENSIVE) flags.delete(id);
};
if (categoryColumns.spell < 0 || categoryColumns.dispelType < 0) {
  console.error(`SpellCategories.csv has no SpellID/DispelType column. Columns: ${categoriesHeader.join(', ')}`);
  process.exit(1);
}
// A spell can have one row per difficulty. Any row saying enrage makes it one:
// the dispel type does not vary by difficulty in practice, and a soothe that
// removed it settles the question for that log either way.
const enrages = new Set();
let categoryRows = 0;
for (const line of categoriesCsv.split('\n')) {
  if (line === '' || categoryRows++ === 0) continue;
  const fields = line.split(',');
  if (Number(fields[categoryColumns.dispelType]) !== DISPEL_TYPE_ENRAGE) continue;
  const id = Number(fields[categoryColumns.spell]);
  if (Number.isFinite(id) && id !== 0) enrages.add(id);
}
const dispelIds = [...dispels].sort((a, b) => a - b);
const enrageIds = [...enrages].sort((a, b) => a - b);
console.log(
  `${dispelIds.length} dispels; ${categoryRows - 1} category rows → ${enrageIds.length} enrage auras`,
);
for (const { kind, flag: bit } of dedupe(CONTROLS)) {
  console.log(`  ${kind.padEnd(10)} ${controlIds.filter((id) => (controlFlags.get(id) & bit) !== 0).length}`);
}

// Procs. Three small tables joined to the trigger links gathered above:
// SpellAuraOptions names the passive's rate, SpellProcsPerMinute is the rate,
// SpellProcsPerMinuteMod adjusts it per class and spec.
const rppmBase = new Map();
for (const fields of csvRows(rppmCsv, ['ID', 'BaseProcRate'])) {
  const rate = Number(fields.BaseProcRate);
  if (rate > 0) rppmBase.set(Number(fields.ID), Number(rate.toFixed(4)));
}
const rppmMods = new Map();
for (const fields of csvRows(rppmModCsv, ['Type', 'Param', 'Coeff', 'SpellProcsPerMinuteID'])) {
  const type = Number(fields.Type);
  if (type !== RPPM_MOD_CLASS && type !== RPPM_MOD_SPEC) continue;
  const id = Number(fields.SpellProcsPerMinuteID);
  if (!rppmMods.has(id)) rppmMods.set(id, []);
  rppmMods.get(id).push(`${type === RPPM_MOD_CLASS ? 'c' : 's'}${fields.Param}:${Number(Number(fields.Coeff).toFixed(4))}`);
}
const passiveRate = new Map();
for (const fields of csvRows(auraOptionsCsv, ['SpellID', 'SpellProcsPerMinuteID'])) {
  const rppm = Number(fields.SpellProcsPerMinuteID);
  if (rppmBase.has(rppm)) passiveRate.set(Number(fields.SpellID), rppm);
}
// A spell some other passive also fires, at no rate, has no expectation:
// Tempest procs at 1.1 a minute from Stormbringer and on every Ascendance,
// and counted against the first alone it read as three times lucky.
const unrated = new Set();
for (const [passive, fired] of triggers) {
  if (!passiveRate.has(passive)) for (const triggered of fired) unrated.add(triggered);
}
// A triggered spell reached from two rated passives keeps the lower passive
// id's rate, so a rebuild against the same data writes the same file.
const procRate = new Map();
for (const passive of [...passiveRate.keys()].sort((a, b) => a - b)) {
  for (const triggered of triggers.get(passive) ?? []) {
    if (procRate.has(triggered) || unrated.has(triggered)) continue;
    const rppm = passiveRate.get(passive);
    const mods = (rppmMods.get(rppm) ?? []).sort().join(',');
    procRate.set(triggered, `${rppmBase.get(rppm)}|${mods}`);
  }
}
console.log(`${passiveRate.size} passives with a real-procs-per-minute rate → ${procRate.size} proc spells`);

const written = [
  [outDefensives, renderDefensives(ids, flags, build)],
  [outMarkers, renderMarkers(inert, build)],
  [outInterrupts, renderInterrupts(stoppers, interrupts.size, dedicated.length, build)],
  [outControl, renderControl(controlIds, controlFlags, build)],
  [outDispels, renderDispels(dispelIds, enrageIds, build)],
  [outProcs, renderProcs(procRate, build)],
];
if (checkOnly) {
  const stale = written.filter(([path, source]) => {
    const have = existsSync(path) ? readFileSync(path, 'utf8') : '';
    return have !== source;
  });
  if (stale.length === 0) {
    console.log(`up to date for build ${build}`);
    process.exit(0);
  }
  for (const [path] of stale) console.error(`${path} is out of date for build ${build}`);
  console.error('Run: node scripts/spell-effects.mjs');
  process.exit(1);
}
for (const [path, source] of written) {
  writeFileSync(path, source);
  console.log(`wrote ${path} (${(source.length / 1024).toFixed(1)}KB) for build ${build}`);
}

/**
 * A small table's rows as objects, by column name.
 *
 * Only for the tables whose every column is a number, like the split above:
 * none of the three it reads carries a name or a description.
 */
function* csvRows(text, needed) {
  const lines = text.split('\n');
  const header = lines[0].split(',');
  const missing = needed.filter((name) => !header.includes(name));
  if (missing.length > 0) throw new Error(`no ${missing.join('/')} column in: ${header.join(', ')}`);
  for (const line of lines.slice(1)) {
    if (line === '') continue;
    const fields = line.split(',');
    yield Object.fromEntries(header.map((name, at) => [name, fields[at]]));
  }
}

function dedupe(entries) {
  const byKind = new Map();
  for (const entry of entries) if (!byKind.has(entry.kind)) byKind.set(entry.kind, entry);
  return [...byKind.values()];
}

async function liveBuild() {
  const response = await fetch('https://wago.tools/api/builds');
  if (!response.ok) throw new Error(`wago.tools/api/builds: ${response.status}`);
  const builds = await response.json();
  const version = builds.wow?.[0]?.version;
  if (typeof version !== 'string') throw new Error('no live retail build in the builds list');
  return version;
}

/**
 * A table, cached by build. Re-running against the same patch should not
 * re-download 57MB, and the cache is in the OS temp dir rather than the repo
 * because it is Blizzard's data and does not belong in a commit.
 */
async function download(table, version) {
  const dir = join(tmpdir(), 'mplus-db2');
  mkdirSync(dir, { recursive: true });
  const cached = join(dir, `${table}-${version}.csv`);
  if (existsSync(cached)) {
    console.log(`using cached ${cached}`);
    return readFileSync(cached, 'utf8');
  }
  const url = `https://wago.tools/db2/${table}/csv?build=${version}`;
  console.log(`downloading ${url} — this takes a minute`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const text = await response.text();
  if (!text.startsWith('ID,')) throw new Error(`${url} did not return a CSV: ${text.slice(0, 120)}`);
  writeFileSync(cached, text);
  if (!keep) console.log(`cached at ${cached}`);
  return text;
}

/**
 * The table as a module.
 *
 * Deltas in base 36, because the ids are sorted and the gaps are small: the
 * whole table is a third the size of the same numbers written out, and the
 * decoder is four lines. One string per kind rather than one combined string
 * with packed flags, so the generated file can be read — "these are the
 * absorbs" is a sentence, a column of bitmasks is not.
 */
function renderDefensives(ids, flags, version) {
  const kinds = dedupe(KINDS);
  const lists = kinds.map(({ kind, flag: bit }) => {
    const members = ids.filter((id) => (flags.get(id) & bit) !== 0);
    let previous = 0;
    const deltas = members.map((id) => {
      const delta = id - previous;
      previous = id;
      return delta.toString(36);
    });
    return { kind, bit, count: members.length, text: deltas.join('.') };
  });
  const witnesses = KINDS.map((entry) => ` *   ${String(entry.aura).padStart(3)} ${entry.name.padEnd(28)} ${entry.kind.padEnd(10)} ${entry.witness}`);
  return `/**
 * Spells that do something about damage, derived from Blizzard's own data.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-effects.mjs\`.
 * Built from SpellEffect.db2, retail build ${version}, via wago.tools.
 *
 * The game has no flag that says "this is a defensive". What it has is the aura
 * each spell effect applies, and ten of those mean survival. Membership here is
 * therefore a fact about what a spell does, not an opinion about whether it
 * matters — which is the point, because the opinion is what goes stale.
 *
${witnesses.join('\n')}
 *
 * Only spell ids are stored. No names, no descriptions, no art: the log already
 * carries the name of every aura it reports, and numbers are the only part of
 * this that is ours to keep.
 */

/** What a spell does about damage. A spell can do several. */
export const Defense = {
${kinds.map(({ kind, flag: bit }) => `  ${kind.toUpperCase()}: ${bit},`).join('\n')}
} as const;

export type DefenseKind = (typeof Defense)[keyof typeof Defense];

${lists
  .map(
    ({ kind, count, text }) =>
      `/** ${count} spells. */\nconst ${kind.toUpperCase()} =\n  '${chunk(text)}';`,
  )
  .join('\n\n')}

const LISTS: readonly (readonly [string, number])[] = [
${lists.map(({ kind, bit }) => `  [${kind.toUpperCase()}, ${bit}],`).join('\n')}
];

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Map<number, number> | null = null;

function decode(): Map<number, number> {
  const built = new Map<number, number>();
  for (const [text, bit] of LISTS) {
    let id = 0;
    for (const delta of text.split('.')) {
      id += parseInt(delta, 36);
      built.set(id, (built.get(id) ?? 0) | bit);
    }
  }
  return built;
}

/**
 * What this spell does about damage, as a mask of \`Defense\` values, or 0.
 *
 * 0 is the answer for most spell ids, including every one the table has never
 * heard of — a spell added after this file was generated reads as not a
 * defensive, which is the safe way round for a chart that is meant to be short.
 */
export function defenseKinds(spellId: number): number {
  table ??= decode();
  return table.get(spellId) ?? 0;
}

/** Whether the spell does anything at all about damage. */
export function isDefensive(spellId: number): boolean {
  return defenseKinds(spellId) !== 0;
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function defensiveCount(): number {
  table ??= decode();
  return table.size;
}
`;
}

/**
 * The inert spells as a module.
 *
 * Same encoding as the defensive table, and a Set rather than a Map because
 * there is nothing to say about a member beyond that it is one.
 */
function renderMarkers(inert, version) {
  let previous = 0;
  const deltas = inert.map((id) => {
    const delta = id - previous;
    previous = id;
    return delta.toString(36);
  });
  return `/**
 * Spells the game's own data gives no effect at all.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-effects.mjs\`.
 * Built from SpellEffect.db2, retail build ${version}, via wago.tools.
 *
 * Every effect a spell has is a row in SpellEffect.db2, and almost every row
 * names the aura it applies. A spell whose rows all apply SPELL_AURA_DUMMY and
 * trigger nothing has no described effect: whatever it does, it does in a
 * script the data cannot see — and often it does nothing at all, because it
 * exists to be looked at. Sated is the type. It is how the game remembers you
 * have had Bloodlust; the refusal to give you another lives in Bloodlust.
 *
 * So membership here is emphatically not "this spell does not matter". Boss
 * mechanics are in this list in quantity: a debuff that detonates when it
 * expires is scripted, so the data describes it as nothing, and three of the
 * thirty-eight debuffs in one real key land here for exactly that reason.
 *
 * What makes it usable is the pairing. Asked only of an aura a player put on
 * *themselves*, an inert spell is a note the game left for its own benefit —
 * hero sickness, a cooldown lock, a gateway already used — and never a
 * mechanic that killed anybody. That pairing is done once, in \`bookkeeping\`
 * in @mplus/analysis, rather than at each call site. Asked of anything else
 * this answers a question nobody should be relying on.
 *
 * ${inert.length} spells. Only ids are stored: no names, no descriptions, no art.
 */

const INERT =
  '${chunk(deltas.join('.'))}';

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Set<number> | null = null;

function decode(): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of INERT.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/**
 * Whether the game's data describes this spell as doing nothing.
 *
 * False for every id the table has never heard of, so a spell added after this
 * file was generated reads as doing something — the safe way round, because the
 * cost of a wrong false is a line of noise and the cost of a wrong true is a
 * mechanic missing from the chart that explains a death.
 */
export function isInertMarker(spellId: number): boolean {
  table ??= decode();
  return table.has(spellId);
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function inertCount(): number {
  table ??= decode();
  return table.size;
}
`;
}

/**
 * The interrupt table as a module.
 *
 * Same encoding and same shape as the markers table: a Set, because there is
 * nothing to say about a member beyond that it is one.
 */
function renderInterrupts(ids, carrying, dedicated, version) {
  let previous = 0;
  const deltas = ids.map((id) => {
    const delta = id - previous;
    previous = id;
    return delta.toString(36);
  });
  const scripted = SCRIPTED_INTERRUPTS.map(({ id, why }) => ` *   ${String(id).padStart(6)}  ${why}`);
  return `/**
 * The spells a player presses to stop a cast.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-effects.mjs\`.
 * Built from SpellEffect.db2, retail build ${version}, via wago.tools.
 *
 * Interrupts that landed need no table: the game logs SPELL_INTERRUPT and
 * names both spells on it. This table answers the other half of the question —
 * how many times the button was pressed — which the log only reports as an
 * ordinary cast, indistinguishable from any other until you know what the
 * spell is.
 *
 * The effect to look for is SPELL_EFFECT_INTERRUPT_CAST (68), and ${carrying} spells
 * carry it. Most are not interrupts in the sense anyone means: Avenger's
 * Shield interrupts, and a protection paladin presses it on cooldown as a
 * rotational ability. What tells the two apart is everything else the spell
 * does — Avenger's Shield also deals damage, jumps to two more targets and
 * silences, while a Kick does nothing at all except stop a cast. So the rule
 * is subtraction: the ${dedicated} spells whose *every* described effect is
 * INTERRUPT_CAST. Every player interrupt in the game is in that set, and
 * nothing that deals damage is.
 *
 * A further ${SCRIPTED_INTERRUPTS.length} are added by hand, because the press and the interrupt are two
 * different spells and the data only describes the second one:
 *
${scripted.join('\n')}
 *
 * A button missing from this list costs only its whiffs. Its interrupts still
 * count, because those are read off the log's own SPELL_INTERRUPT lines.
 *
 * ${ids.length} spells. Only ids are stored: no names, no descriptions, no art.
 */

const STOPPERS =
  '${chunk(deltas.join('.'))}';

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Set<number> | null = null;

function decode(): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of STOPPERS.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/**
 * Whether pressing this spell is an attempt to interrupt something.
 *
 * False for every id the table has never heard of, so an interrupt added in a
 * patch newer than this file reads as an ordinary cast: it goes uncounted
 * rather than counted wrong, and the interrupts it lands are reported anyway.
 */
export function isInterrupt(spellId: number): boolean {
  table ??= decode();
  return table.has(spellId);
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function interruptCount(): number {
  table ??= decode();
  return table.size;
}
`;
}

/** Wrapped at 96 columns so the generated file can be opened without a horizontal scrollbar. */
function chunk(text) {
  const lines = [];
  for (let at = 0; at < text.length; at += 96) lines.push(text.slice(at, at + 96));
  return lines.join("' +\n  '");
}

/**
 * The control table as a module.
 *
 * Same encoding and same shape as the defensive table — one string per kind,
 * so the generated file reads as sentences rather than as a column of
 * bitmasks — and a Map rather than a Set, because which kind of control it was
 * is the thing the panel groups by.
 */
function renderControl(ids, flags, version) {
  const kinds = dedupe(CONTROLS);
  const lists = kinds.map(({ kind, flag: bit }) => {
    const members = ids.filter((id) => (flags.get(id) & bit) !== 0);
    let previous = 0;
    const deltas = members.map((id) => {
      const delta = id - previous;
      previous = id;
      return delta.toString(36);
    });
    return { kind, bit, count: members.length, text: deltas.join('.') };
  });
  const witnesses = CONTROLS.map(
    (entry) =>
      ` *   ${String(entry.aura).padStart(3)}  ${entry.kind.padEnd(9)} ${entry.witness.padEnd(40)} ${entry.mechanic}`,
  );
  return `/**
 * The auras that take a unit out of the fight.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-effects.mjs\`.
 * Built from SpellEffect.db2, retail build ${version}, via wago.tools.
 *
 * The game has no flag for "this is crowd control" any more than it has one
 * for "this is a defensive", and the answer is the same: the aura each effect
 * applies. Seven of them mean the unit is not fighting, and membership here is
 * a fact about what a spell does rather than an opinion about whether it
 * counts.
 *
 * Each aura was confirmed twice over, because the number on its own is a
 * guess. A witness spell carries it and is unarguably that kind of control;
 * and the mechanic column agrees — most rows carrying these auras also name a
 * mechanic, and it is the matching one. Two independent columns saying the
 * same thing is the case for all seven.
 *
${witnesses.join('\n')}
 *
 * Stun and root have two aura numbers each, and the second is not spare:
 * Asphyxiate carries 298 alone and Entangling Roots carries 455 alone.
 *
 * Slows are not here, which is the decision that shapes the table. A slow is
 * not being taken out of the fight, and MOD_DECREASE_SPEED cannot tell a Ring
 * of Frost from a paladin standing in their own Consecration. On one real
 * evening of keys, including it put Consecration top of the chart at 1,430
 * applications, then Grip of the Dead (1,058) and Permeating Chill (891) —
 * three passives, none of them pressed, between them nine times all the hard
 * control in the log. Left out, the same log reports eight spells and every
 * one is a real press.
 *
 * Asked of the wrong event this answers a question nobody should rely on: an
 * enemy's stun on a player is in this table too, and so is a mob's root on
 * another mob. The pairing that makes it mean "the party controlled
 * something" — a debuff, cast by the party, onto something that is not the
 * party — is done once, in \`crowdControlReport\` in @mplus/analysis.
 *
 * ${ids.length} spells. Only ids are stored: no names, no descriptions, no art.
 */

/** What a control aura does to the unit. A spell can do several. */
export const Control = {
${kinds.map(({ kind, flag: bit }) => `  ${kind.toUpperCase()}: ${bit},`).join('\n')}
} as const;

export type ControlKind = (typeof Control)[keyof typeof Control];

${lists
  .map(
    ({ kind, count, text }) =>
      `/** ${count} spells. */\nconst ${kind.toUpperCase()} =\n  '${chunk(text)}';`,
  )
  .join('\n\n')}

const LISTS: readonly (readonly [string, number])[] = [
${lists.map(({ kind, bit }) => `  [${kind.toUpperCase()}, ${bit}],`).join('\n')}
];

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Map<number, number> | null = null;

function decode(): Map<number, number> {
  const built = new Map<number, number>();
  for (const [text, bit] of LISTS) {
    let id = 0;
    for (const delta of text.split('.')) {
      id += parseInt(delta, 36);
      built.set(id, (built.get(id) ?? 0) | bit);
    }
  }
  return built;
}

/**
 * What this aura does to the unit, as a mask of \`Control\` values, or 0.
 *
 * 0 for every id the table has never heard of, so a control added in a patch
 * newer than this file reads as an ordinary debuff: it goes uncounted rather
 * than counted wrong, which is the right way round for a chart whose whole
 * claim is that everything on it was a press.
 */
export function controlKinds(spellId: number): number {
  table ??= decode();
  return table.get(spellId) ?? 0;
}

/** Whether the aura takes the unit out of the fight at all. */
export function isCrowdControl(spellId: number): boolean {
  return controlKinds(spellId) !== 0;
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function controlCount(): number {
  table ??= decode();
  return table.size;
}
`;
}

/**
 * The dispel tables as a module.
 *
 * Two Sets in one file, because they answer the two halves of one question
 * and are only ever asked together: whether a SPELL_DISPEL line was a dispel
 * at all, and if it took a buff off an enemy, whether that buff was an enrage.
 */
function renderDispels(dispelIds, enrageIds, version) {
  const encode = (ids) => {
    let previous = 0;
    return ids
      .map((id) => {
        const delta = id - previous;
        previous = id;
        return delta.toString(36);
      })
      .join('.');
  };
  return `/**
 * Which spells are dispels, and which auras are enrages.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-effects.mjs\`.
 * Built from SpellEffect.db2 and SpellCategories.db2, retail build ${version},
 * via wago.tools.
 *
 * The log names every dispel outright — SPELL_DISPEL and SPELL_STOLEN carry
 * the dispel, the aura it removed, and whether that aura was a BUFF or a
 * DEBUFF — so what these tables add is not detection but judgement, twice.
 *
 * DISPELS is every spell carrying SPELL_EFFECT_DISPEL (38) or
 * STEAL_BENEFICIAL_BUFF (126). It is needed because the log uses SPELL_DISPEL
 * for more than dispels: Cat Form, Disengage, Tiger's Lust and Demonic Circle
 * all log it when they shrug off a root, and none of them carries the effect.
 * On eight real evenings those were a fifth of every "dispel" a party member
 * cast on their own party.
 *
 * ENRAGES is every aura whose dispel type is Enrage (9), which is the line
 * between a soothe and a purge. It has to be the aura rather than the button:
 * Tranquilizing Shot removes magic and enrage alike, and only what it took
 * says which it was.
 *
 * ${dispelIds.length} dispels and ${enrageIds.length} enrages. Only ids are stored: no names, no
 * descriptions, no art.
 */

const DISPELS =
  '${chunk(encode(dispelIds))}';

const ENRAGES =
  '${chunk(encode(enrageIds))}';

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let dispels: Set<number> | null = null;
let enrages: Set<number> | null = null;

function decode(text: string): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of text.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/**
 * Whether this spell removes auras by dispelling them.
 *
 * False for a root-breaker that the log reports as SPELL_DISPEL, and for every
 * id the table has never heard of — so a dispel added in a patch newer than
 * this file goes uncounted rather than a shapeshift being counted as one.
 */
export function isDispel(spellId: number): boolean {
  dispels ??= decode(DISPELS);
  return dispels.has(spellId);
}

/**
 * Whether this aura is an enrage, so that removing it was a soothe.
 *
 * Asked of the aura that came off, never of the dispel that took it.
 */
export function isEnrage(auraId: number): boolean {
  enrages ??= decode(ENRAGES);
  return enrages.has(auraId);
}

/** How many spells each table knows. Exported for the test, which asserts neither is empty. */
export function dispelCount(): number {
  dispels ??= decode(DISPELS);
  return dispels.size;
}

export function enrageCount(): number {
  enrages ??= decode(ENRAGES);
  return enrages.size;
}
`;
}

/**
 * The proc table as a module.
 *
 * One row per distinct rate: the base procs per minute, its class and spec
 * multipliers, and the delta-coded spells that proc at it. Most procs share a
 * handful of rates, so grouping by rate keeps the file to its ids.
 */
function renderProcs(procRate, version) {
  const groups = new Map();
  for (const [id, signature] of procRate) {
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(id);
  }
  const rows = [...groups]
    .map(([signature, ids]) => {
      const [base, mods] = signature.split('|');
      ids.sort((a, b) => a - b);
      let previous = 0;
      const deltas = ids.map((id) => {
        const delta = id - previous;
        previous = id;
        return delta.toString(36);
      });
      return { base: Number(base), mods, first: ids[0], text: deltas.join('.') };
    })
    .sort((a, b) => a.base - b.base || a.mods.localeCompare(b.mods) || a.first - b.first);
  return `/**
 * How often each proc is meant to happen, from Blizzard's own data.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-effects.mjs\`.
 * Built from SpellEffect.db2, SpellAuraOptions.db2, SpellProcsPerMinute.db2
 * and SpellProcsPerMinuteMod.db2, retail build ${version}, via wago.tools.
 *
 * A proc is two spells: the passive a player carries — a trinket, an enchant,
 * an embellishment — and the spell it fires, which is what the log shows. The
 * passive's real-procs-per-minute rate is in the data, and its
 * PROC_TRIGGER_SPELL aura names the spell it fires. This table is that join,
 * keyed on the spell the log will show.
 *
 * A spell that some other passive also fires at no rate is left out: what it
 * was meant to do cannot be said. Only class and spec multipliers are applied. The rest scale with haste,
 * crit, race or item level, which the log does not reliably give; leaving
 * them out moves everyone's expected count the same way, so a comparison
 * between players still reads true. Procs on a flat chance per hit are not
 * here at all: they have no rate to expect.
 *
 * ${procRate.size} spells at ${rows.length} rates. Only ids and numbers are stored: no names, no
 * descriptions, no art.
 */

/**
 * Base procs per minute, class and spec adjustments ("c<classMask>:x", "s<specId>:x"),
 * spells. An adjustment is added to 1 and multiplied in, the way the game reads
 * it: a tank spec's -0.75 is a quarter of the rate.
 */
const RATES: readonly (readonly [number, string, string])[] = [
${rows.map(({ base, mods, text }) => `  [${base}, '${mods}', '${chunk(text)}'],`).join('\n')}
];

interface Rate {
  base: number;
  /** Class mask -> what it adds to the rate, as a fraction: -0.75 is a quarter of it. */
  classes: ReadonlyArray<readonly [number, number]>;
  /** Spec id -> the same. */
  specs: ReadonlyMap<number, number>;
}

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Map<number, Rate> | null = null;

function decode(): Map<number, Rate> {
  const built = new Map<number, Rate>();
  for (const [base, mods, text] of RATES) {
    const classes: Array<readonly [number, number]> = [];
    const specs = new Map<number, number>();
    for (const mod of mods === '' ? [] : mods.split(',')) {
      const [key, coeff] = mod.split(':') as [string, string];
      if (key[0] === 'c') classes.push([Number(key.slice(1)), Number(coeff)]);
      else specs.set(Number(key.slice(1)), Number(coeff));
    }
    const rate = { base, classes, specs };
    let id = 0;
    for (const delta of text.split('.')) {
      id += parseInt(delta, 36);
      built.set(id, rate);
    }
  }
  return built;
}

/**
 * How many times a minute this spell is meant to proc for a player of this
 * class and spec, or 0 when it is not a proc with a rate.
 *
 * 0 for every id the table has never heard of, so a proc newer than this file
 * is simply not counted, rather than counted against an expectation of nothing.
 */
export function procsPerMinute(spellId: number, classId: number, specId: number): number {
  table ??= decode();
  const rate = table.get(spellId);
  if (rate === undefined) return 0;
  let perMinute = rate.base;
  for (const [mask, coeff] of rate.classes) if (classId > 0 && mask & (1 << (classId - 1))) perMinute *= 1 + coeff;
  return perMinute * (1 + (rate.specs.get(specId) ?? 0));
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function procCount(): number {
  table ??= decode();
  return table.size;
}
`;
}

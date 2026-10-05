#!/usr/bin/env node
/**
 * Rebuild what we know about spells from Blizzard's own data.
 *
 * One table, SpellEffect.db2, answers three questions the reports ask, so one
 * script reads it once and writes all three answers:
 *
 *   packages/data/src/defensives.ts  which spells do something about damage
 *   packages/data/src/markers.ts     which spells the data gives no effect at all
 *   packages/data/src/interrupts.ts  which spells are interrupt buttons
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
 *   node scripts/spell-effects.mjs [--build 12.1.0.69933] [--csv SpellEffect.csv]
 *                                  [--keep] [--check]
 *
 * --build pins a build (default: whatever wago.tools says is live), --csv reads
 * a table already on disk, --keep leaves the download in the cache directory it
 * prints, and --check writes nothing and exits non-zero if either committed
 * table is out of date, which is the form to run in CI.
 *
 * The download is ~57MB and the result is ~130KB of spell IDs, which is the
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
 * The two numbers that spell "this effect does nothing the data can describe".
 *
 * Effect 6 is APPLY_AURA and aura 4 is SPELL_AURA_DUMMY, both confirmed against
 * TrinityCore's SpellAuraDefines.h and against the witnesses in markers.ts. A
 * dummy that names a trigger spell is not inert — the trigger is the effect —
 * so EffectTriggerSpell has to be 0 as well.
 */
const EFFECT_APPLY_AURA = 6;
const AURA_DUMMY = 4;

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

const build = flag('build') ?? (await liveBuild());
const csvPath = flag('csv');
const csv = csvPath === undefined ? await download(build) : readFileSync(csvPath, 'utf8');

const header = csv.slice(0, csv.indexOf('\n')).split(',');
const columns = {
  aura: header.indexOf('EffectAura'),
  spell: header.indexOf('SpellID'),
  effect: header.indexOf('Effect'),
  trigger: header.indexOf('EffectTriggerSpell'),
};
const missing = Object.entries(columns)
  .filter(([, at]) => at < 0)
  .map(([name]) => name);
if (missing.length > 0) {
  console.error(`SpellEffect.csv has no ${missing.join('/')} column. Columns: ${header.join(', ')}`);
  console.error('The table was renamed or restructured; the aura list needs re-reading before this can run.');
  process.exit(1);
}
const { aura: auraAt, spell: spellAt, effect: effectAt, trigger: triggerAt } = columns;

// Every value in this table is a number, so splitting on commas is safe and an
// order of magnitude faster than a real CSV reader over 629k rows.
const wanted = new Map(KINDS.map((entry) => [String(entry.aura), entry.flag]));
const flags = new Map();
// A spell is inert if it has a do-nothing effect and no other kind. Both halves
// are collected in the one pass and subtracted afterwards, because the rows of
// a spell are not guaranteed to be adjacent.
const doesNothing = new Set();
const doesSomething = new Set();
// Interrupts, gathered the same way and subtracted the same way: a spell is a
// dedicated interrupt if it stops casts and does nothing else.
const interrupts = new Set();
const alsoDoesSomethingElse = new Set();
let rows = 0;
for (const line of csv.split('\n')) {
  if (line === '' || rows++ === 0) continue;
  const fields = line.split(',');
  const id = Number(fields[spellAt]);
  if (!Number.isFinite(id) || id === 0) continue;

  const bit = wanted.get(fields[auraAt]);
  if (bit !== undefined) flags.set(id, (flags.get(id) ?? 0) | bit);

  const effect = Number(fields[effectAt]);
  if (effect === 0) continue;
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
const inert = [...doesNothing].filter((id) => !doesSomething.has(id)).sort((a, b) => a - b);
const dedicated = [...interrupts].filter((id) => !alsoDoesSomethingElse.has(id));
const byHand = SCRIPTED_INTERRUPTS.filter(({ id }) => !dedicated.includes(id));
const stoppers = [...new Set([...dedicated, ...SCRIPTED_INTERRUPTS.map(({ id }) => id)])].sort((a, b) => a - b);
console.log(
  `${rows - 1} effect rows → ${ids.length} defensive spells, ${inert.length} inert markers, ` +
    `${stoppers.length} interrupts (${interrupts.size} carry the effect, ${dedicated.length} do nothing else, ` +
    `${byHand.length} added by hand)`,
);
for (const { kind, flag: bit } of dedupe(KINDS)) {
  console.log(`  ${kind.padEnd(10)} ${ids.filter((id) => (flags.get(id) & bit) !== 0).length}`);
}

const written = [
  [outDefensives, renderDefensives(ids, flags, build)],
  [outMarkers, renderMarkers(inert, build)],
  [outInterrupts, renderInterrupts(stoppers, interrupts.size, dedicated.length, build)],
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
 * The table, cached by build. Re-running against the same patch should not
 * re-download 57MB, and the cache is in the OS temp dir rather than the repo
 * because it is Blizzard's data and does not belong in a commit.
 */
async function download(version) {
  const dir = join(tmpdir(), 'mplus-db2');
  mkdirSync(dir, { recursive: true });
  const cached = join(dir, `SpellEffect-${version}.csv`);
  if (existsSync(cached)) {
    console.log(`using cached ${cached}`);
    return readFileSync(cached, 'utf8');
  }
  const url = `https://wago.tools/db2/SpellEffect/csv?build=${version}`;
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

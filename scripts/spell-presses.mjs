#!/usr/bin/env node
/**
 * Which spells a player can actually press, from Blizzard's own data.
 *
 *   packages/data/src/buttons.ts   spells the game puts on a clock
 *
 * The combat log reports a proc exactly the way it reports a press. When a
 * retribution paladin takes Crusading Strikes, every auto-attack writes
 * `SPELL_CAST_SUCCESS ... 408385 "Crusading Strikes"` under the player's own
 * name — 258 of them in one logged arena — and an evoker's Charged Blast does
 * the same thing for a stacking buff nobody has a keybind for. Read at face
 * value, the death recap's "what they pressed" fills up with spells the player
 * never pressed, which is worse than empty: it reads as a player mashing
 * buttons while they died.
 *
 * There is no "this is a button" flag to look for, and the same lesson as the
 * defensives applies: a hand-kept list of procs is a list of thousands that
 * moves every patch. What the data does say is what a cast *costs*, and that
 * is the discriminator. Everything a player can press is on a clock of some
 * kind — the global cooldown, a cooldown of its own, or a charge — because an
 * ability with no clock at all would be spammable, and nothing in the game is.
 * A triggered strike has none of the three: the talent that triggers it owns
 * the rate, so the triggered spell needs no clock and is given none.
 *
 * Three tables, all small, hold those three facts:
 *
 *   SpellCategories  StartRecoveryCategory — the global cooldown this spell is on
 *                    ChargeCategory        — which pool of charges it draws from
 *   SpellCooldowns   StartRecoveryTime     — how long a GCD it triggers
 *                    RecoveryTime          — its own cooldown
 *                    CategoryRecoveryTime  — a cooldown shared with other spells
 *   SpellCategory    MaxCharges            — whether a charge pool holds charges
 *                    ChargeRecoveryTime      and how fast they come back
 *
 *   node scripts/spell-presses.mjs [--build 12.1.0.69933] [--keep] [--check]
 *
 * --build pins a build (default: whatever wago.tools says is live), --keep
 * leaves the downloads in the cache directory it prints, and --check writes
 * nothing and exits non-zero if the committed table is out of date, which is
 * the form to run in CI.
 *
 * The three downloads come to ~4MB, which is a rounding error next to the 57MB
 * SpellEffect.db2 that `spell-effects.mjs` reads, so this one is cheap to
 * re-run. The two scripts are separate because they share no table and answer
 * questions that go stale at different rates.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The spells that prove each half of the rule, every one read off the data
 * rather than trusted from memory.
 *
 * The presses are picked to cover all three clocks, because a press that only
 * has one of them is the one a careless rule drops: Icebound Fortitude is off
 * the global cooldown entirely and is a press because it has its own two
 * minutes, Mind Freeze's cooldown is shared with the category rather than
 * named on the spell, and Fire Blast's is a charge pool.
 */
const PRESSES = [
  { id: 383328, why: 'Final Verdict — a rotational button, on the global cooldown' },
  { id: 48792, why: 'Icebound Fortitude — off the GCD, 2 minutes of its own' },
  { id: 47528, why: 'Mind Freeze — no cooldown on the spell, 15s on its category' },
  { id: 108853, why: 'Fire Blast — a charge pool rather than a cooldown' },
  { id: 43265, why: 'Death and Decay — a GCD and charges both' },
];

/**
 * The procs that prove the other half, all four witnessed in real logs as
 * `SPELL_CAST_SUCCESS` rows under a player's name.
 */
const PROCS = [
  { id: 408385, why: 'Crusading Strikes — a retribution paladin auto-attack, 258 casts in one arena' },
  { id: 370454, why: 'Charged Blast — an evoker buff the log reports as a cast' },
  { id: 27576, why: 'Mutilate — the off-hand half of the one button, logged alongside 1329' },
  { id: 452538, why: 'Fatebound Coin (Tails) — a rogue coin flip, 66 casts' },
  { id: 1223412, why: 'Soul Fragment — a demon hunter picking one up, 637 casts' },
];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const checkOnly = args.includes('--check');
const keep = args.includes('--keep');

const outButtons = fileURLToPath(new URL('../packages/data/src/buttons.ts', import.meta.url));

const build = flag('build') ?? (await liveBuild());

/**
 * Charge pools that hold charges.
 *
 * A spell points at a pool rather than carrying its charges itself, because a
 * pool is shared: a paladin's Hammer of Wrath and a protection paladin's
 * Avenger's Shield can draw on the same three. A pool with no charges and no
 * recovery is a category used for something else, so both fields are checked.
 */
const chargePools = new Set();
{
  const { rows, at } = await table('SpellCategory', ['ID', 'MaxCharges', 'ChargeRecoveryTime']);
  for (const fields of rows) {
    if (Number(fields[at.MaxCharges]) > 0 || Number(fields[at.ChargeRecoveryTime]) > 0) {
      chargePools.add(Number(fields[at.ID]));
    }
  }
}

/** Why each spell is a press, for the counts the generated file reports. */
const reasons = { gcd: 0, gcdTime: 0, cooldown: 0, category: 0, charges: 0 };
const buttons = new Set();
/**
 * The highest spell id these tables carry.
 *
 * Spell ids are handed out in order, so every spell a later patch adds sits
 * above this. That is what makes the table safe to read as "not a press":
 * above the frontier the answer is "this file is older than the spell", which
 * the lookup reports as a press rather than as a proc. See buttons.ts.
 */
let frontier = 0;

{
  const { rows, at } = await table('SpellCategories', [
    'SpellID',
    'StartRecoveryCategory',
    'ChargeCategory',
  ]);
  for (const fields of rows) {
    const id = Number(fields[at.SpellID]);
    if (id > frontier) frontier = id;
    if (Number(fields[at.StartRecoveryCategory]) !== 0) {
      buttons.add(id);
      reasons.gcd++;
    }
    if (chargePools.has(Number(fields[at.ChargeCategory]))) {
      buttons.add(id);
      reasons.charges++;
    }
  }
}

{
  const { rows, at } = await table('SpellCooldowns', [
    'SpellID',
    'StartRecoveryTime',
    'RecoveryTime',
    'CategoryRecoveryTime',
  ]);
  for (const fields of rows) {
    const id = Number(fields[at.SpellID]);
    if (id > frontier) frontier = id;
    if (Number(fields[at.StartRecoveryTime]) > 0) {
      buttons.add(id);
      reasons.gcdTime++;
    }
    if (Number(fields[at.RecoveryTime]) > 0) {
      buttons.add(id);
      reasons.cooldown++;
    }
    if (Number(fields[at.CategoryRecoveryTime]) > 0) {
      buttons.add(id);
      reasons.category++;
    }
  }
}

const ids = [...buttons].sort((a, b) => a - b);
console.log(
  `${ids.length} spells the game puts on a clock, out of ids up to ${frontier}\n` +
    `  ${String(reasons.gcd).padStart(6)} on a global cooldown category\n` +
    `  ${String(reasons.gcdTime).padStart(6)} with a global cooldown length\n` +
    `  ${String(reasons.cooldown).padStart(6)} with a cooldown of their own\n` +
    `  ${String(reasons.category).padStart(6)} with a cooldown on their category\n` +
    `  ${String(reasons.charges).padStart(6)} drawing on a pool of charges`,
);

// The witnesses are the test the script can run on itself: if the rule or the
// columns stop meaning what they used to, this is louder and earlier than a
// chip list quietly emptying out in the app.
const wrongPress = PRESSES.filter(({ id }) => !buttons.has(id));
const wrongProc = PROCS.filter(({ id }) => buttons.has(id));
for (const { id, why } of wrongPress) console.error(`${id} is a press and the rule missed it: ${why}`);
for (const { id, why } of wrongProc) console.error(`${id} is a proc and the rule kept it: ${why}`);
if (wrongPress.length > 0 || wrongProc.length > 0) {
  console.error('The columns were renamed or the rule stopped matching the data. Fix it before committing.');
  process.exit(1);
}

const source = render(ids, frontier, reasons, build);
if (checkOnly) {
  const have = existsSync(outButtons) ? readFileSync(outButtons, 'utf8') : '';
  if (have === source) {
    console.log(`up to date for build ${build}`);
    process.exit(0);
  }
  console.error(`${outButtons} is out of date for build ${build}`);
  console.error('Run: node scripts/spell-presses.mjs');
  process.exit(1);
}
writeFileSync(outButtons, source);
console.log(`wrote ${outButtons} (${(source.length / 1024).toFixed(1)}KB) for build ${build}`);

async function liveBuild() {
  const response = await fetch('https://wago.tools/api/builds');
  if (!response.ok) throw new Error(`wago.tools/api/builds: ${response.status}`);
  const builds = await response.json();
  const version = builds.wow?.[0]?.version;
  if (typeof version !== 'string') throw new Error('no live retail build in the builds list');
  return version;
}

/**
 * One DB2 table as rows of fields, with the columns this script needs located
 * by name.
 *
 * Every value read here is a number, so splitting on commas is safe. A missing
 * column is fatal rather than zero: a renamed column would otherwise empty the
 * table and read as "nobody pressed anything".
 */
async function table(name, columns) {
  const csv = await download(name, build);
  const newline = csv.indexOf('\n');
  const header = csv.slice(0, newline).split(',');
  const at = {};
  const missing = [];
  for (const column of columns) {
    at[column] = header.indexOf(column);
    if (at[column] < 0) missing.push(column);
  }
  if (missing.length > 0) {
    console.error(`${name}.csv has no ${missing.join('/')} column. Columns: ${header.join(', ')}`);
    console.error('The table was renamed or restructured; the rule needs re-reading before this can run.');
    process.exit(1);
  }
  const rows = [];
  for (const line of csv.slice(newline + 1).split('\n')) {
    if (line !== '') rows.push(line.split(','));
  }
  return { rows, at };
}

/**
 * A table, cached by build, in the same directory the effect script uses: the
 * two together are the DB2 working set, and it is Blizzard's data, so it lives
 * in the OS temp dir rather than in a commit.
 */
async function download(name, version) {
  const dir = join(tmpdir(), 'mplus-db2');
  mkdirSync(dir, { recursive: true });
  const cached = join(dir, `${name}-${version}.csv`);
  if (existsSync(cached)) {
    console.log(`using cached ${cached}`);
    return readFileSync(cached, 'utf8');
  }
  const url = `https://wago.tools/db2/${name}/csv?build=${version}`;
  console.log(`downloading ${url}`);
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
 * Same encoding as the other generated tables: deltas in base 36, which on a
 * sorted list of ids with small gaps is a third the size of the numbers
 * written out, and a four-line decoder.
 */
function render(ids, frontier, reasons, version) {
  let previous = 0;
  const deltas = ids.map((id) => {
    const delta = id - previous;
    previous = id;
    return delta.toString(36);
  });
  const presses = PRESSES.map(({ id, why }) => ` *   ${String(id).padStart(7)}  ${why}`);
  const procs = PROCS.map(({ id, why }) => ` *   ${String(id).padStart(7)}  ${why}`);
  return `/**
 * Spells the game puts on a clock — the ones a player can press.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-presses.mjs\`.
 * Built from SpellCategories.db2, SpellCooldowns.db2 and SpellCategory.db2,
 * retail build ${version}, via wago.tools.
 *
 * The combat log reports a proc exactly the way it reports a press. A
 * retribution paladin's Crusading Strikes writes a SPELL_CAST_SUCCESS under
 * the player's own name on every auto-attack, and an evoker's Charged Blast
 * does it for a stacking buff nobody has a keybind for. Nothing on those rows
 * says which of the two it was.
 *
 * What the data does say is what a cast costs, and everything a player can
 * press is on a clock of some kind: the global cooldown, a cooldown of its
 * own, or a charge. An ability with no clock at all would be spammable, and
 * nothing in the game is. A triggered strike has none of the three, because
 * the talent that triggers it owns the rate.
 *
 * Presses, one for each clock:
 *
${presses.join('\n')}
 *
 * Procs, every one witnessed in a real log as a cast under a player's name:
 *
${procs.join('\n')}
 *
 * ${ids.length} spells in all:
 *
 *   ${String(reasons.gcd).padStart(6)}  on a global cooldown category
 *   ${String(reasons.gcdTime).padStart(6)}  with a global cooldown length
 *   ${String(reasons.cooldown).padStart(6)}  with a cooldown of their own
 *   ${String(reasons.category).padStart(6)}  with a cooldown on their category
 *   ${String(reasons.charges).padStart(6)}  drawing on a pool of charges
 *
 * Only ids are stored: no names, no descriptions, no art.
 *
 * The table is not the whole answer on its own. A handful of defensives carry
 * no clock in the data either — Renewing Blaze and Shield of Vengeance are the
 * two found — so the recap asks this question beside \`isDefensive\`, and a
 * defensive is a press whatever this table says. That pairing is done once, in
 * \`pressed\` in @mplus/analysis.
 */

const CLOCKED =
  '${chunk(deltas.join('.'))}';

/**
 * The highest spell id this build had.
 *
 * Spell ids are handed out in order, so anything above this is from a patch
 * newer than this file, and the honest answer about it is "no idea" rather
 * than "not a press". \`isButton\` says press, which costs a line of noise in a
 * chip list; the other way round costs a new button missing from the recap of
 * the death it was pressed in.
 */
const FRONTIER = ${frontier};

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Set<number> | null = null;

function decode(): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of CLOCKED.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/**
 * Whether this is a spell a player can press.
 *
 * True above the frontier, where the table is older than the spell. False for
 * a proc, a triggered strike, the second half of a two-spell button, and for
 * the ids the game never gave to a spell at all.
 */
export function isButton(spellId: number): boolean {
  if (spellId > FRONTIER) return true;
  table ??= decode();
  return table.has(spellId);
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function buttonCount(): number {
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

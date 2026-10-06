#!/usr/bin/env node
/**
 * Which spells Blizzard itself calls avoidable, from the game's own data.
 *
 *   packages/data/src/blizzard-avoidable.ts   spells carrying the flag
 *
 * Midnight's built-in damage meter has an "Avoidable Damage Taken" view, and
 * addons read it through `C_DamageMeter`. Nothing documents what it counts,
 * but one spell attribute lines up with it: `SpellMisc.Attributes_15` bit 22.
 * Against the hand-kept list in `avoidable.ts` it is set on 91 of 117 ids, and
 * on 9% of the other enemy spells that hit players in the same logs. No other
 * bit comes within 20 points of that, and it is clear on Chillstorm, the one
 * spell the list dropped for pulsing the whole party.
 *
 * That is a statistical reading, not a documented one, so the table is shipped
 * beside the hand-kept list rather than instead of it, and the tab that uses
 * it is marked in development until the two have been compared in game.
 *
 *   node scripts/spell-avoidable.mjs [--build 12.1.0.69933] [--keep] [--check]
 *
 * --build pins a build (default: whatever wago.tools says is live), --keep
 * leaves the download in the cache directory it prints, and --check writes
 * nothing and exits non-zero if the committed table is out of date.
 *
 * SpellMisc is ~60MB as CSV and the result is under 4KB.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `Attributes_15` bit 22. */
const AVOIDABLE_BIT = 0x400000;

/** Spells the flag must carry, all on the hand-kept list and all seen in logs. */
const FLAGGED = [
  { id: 1294836, why: 'Defiled Detonation — a death explosion' },
  { id: 474234, why: 'Burning Steps — the fire trail behind Demonic Rage' },
  { id: 1215985, why: 'Fel Beam — a beam' },
];

/** Spells it must not, so a column that changed meaning cannot pass. */
const CLEAR = [
  { id: 383925, why: 'Chillstorm — pulses the whole party, dropped from the list for it' },
  { id: 397077, why: 'Chillstorm — the second id of the same pulse' },
  { id: 133, why: 'Fireball — a player spell' },
];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const checkOnly = args.includes('--check');
const keep = args.includes('--keep');

const out = fileURLToPath(new URL('../packages/data/src/blizzard-avoidable.ts', import.meta.url));

const build = flag('build') ?? (await liveBuild());

const flagged = new Set();
{
  const { rows, at } = await table('SpellMisc', ['SpellID', 'Attributes_15']);
  // A spell can have a row per difficulty. Any row carrying the flag counts:
  // the log does not say which difficulty's row the server used, and a key is
  // always Mythic, which is the row most likely to have been tuned.
  for (const fields of rows) {
    if ((Number(fields[at.Attributes_15]) & AVOIDABLE_BIT) !== 0) flagged.add(Number(fields[at.SpellID]));
  }
}

const ids = [...flagged].sort((a, b) => a - b);
console.log(`${ids.length} spells carry the avoidable flag`);

const missed = FLAGGED.filter(({ id }) => !flagged.has(id));
const kept = CLEAR.filter(({ id }) => flagged.has(id));
for (const { id, why } of missed) console.error(`${id} should carry the flag and does not: ${why}`);
for (const { id, why } of kept) console.error(`${id} should not carry the flag and does: ${why}`);
if (missed.length > 0 || kept.length > 0) {
  console.error('The column was renamed or the bit moved. Re-derive it before committing.');
  process.exit(1);
}

const source = render(ids, build);
if (checkOnly) {
  const have = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (have === source) {
    console.log(`up to date for build ${build}`);
    process.exit(0);
  }
  console.error(`${out} is out of date for build ${build}`);
  console.error('Run: node scripts/spell-avoidable.mjs');
  process.exit(1);
}
writeFileSync(out, source);
console.log(`wrote ${out} (${(source.length / 1024).toFixed(1)}KB) for build ${build}`);

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
 * by name. A missing column is fatal rather than zero, as in spell-presses.
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
    process.exit(1);
  }
  const rows = [];
  for (const line of csv.slice(newline + 1).split('\n')) {
    if (line !== '') rows.push(line.split(','));
  }
  return { rows, at };
}

/** A table, cached by build in the same directory the other DB2 scripts use. */
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

/** The table as a module, in the base-36 delta encoding the other tables use. */
function render(ids, version) {
  let previous = 0;
  const deltas = ids.map((id) => {
    const delta = id - previous;
    previous = id;
    return delta.toString(36);
  });
  const lines = (list) => list.map(({ id, why }) => ` *   ${String(id).padStart(7)}  ${why}`).join('\n');
  return `/**
 * Spells Blizzard's own data flags as avoidable.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-avoidable.mjs\`.
 * Built from SpellMisc.db2, retail build ${version}, via wago.tools.
 *
 * \`SpellMisc.Attributes_15\` bit 22. Nothing documents it; it is read as the
 * flag behind the in-game damage meter's "Avoidable Damage Taken" because it
 * matches the hand-kept list in \`avoidable.ts\` on 78% of its ids and only 9%
 * of the other enemy damage seen in the same logs. Until that is checked
 * against the meter in game, this is a second opinion beside the list, not a
 * replacement for it.
 *
 * Flagged, every one also on the hand-kept list:
 *
${lines(FLAGGED)}
 *
 * Not flagged:
 *
${lines(CLEAR)}
 *
 * ${ids.length} spells in all. Only ids are stored.
 *
 * A spell newer than this build reads as unflagged: unlike a button, an
 * unknown spell is not avoidable until the data says so.
 */

const FLAGGED =
  '${chunk(deltas.join('.'))}';

let table: Set<number> | null = null;

function decode(): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of FLAGGED.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/** Whether Blizzard's data flags this spell as avoidable. */
export function isBlizzardAvoidable(spellId: number): boolean {
  table ??= decode();
  return table.has(spellId);
}

/** How many spells carry the flag. Exported for the test, which asserts it is not empty. */
export function blizzardAvoidableCount(): number {
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

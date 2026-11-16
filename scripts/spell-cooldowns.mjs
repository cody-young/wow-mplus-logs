#!/usr/bin/env node
/**
 * How long the things a player could have pressed to live take to come back.
 *
 *   packages/data/src/cooldowns.ts
 *
 * The death recap's "narc" asks of every death what was still in the bag: a
 * healthstone, a health potion, a big defensive. The log says when each was
 * last used and nothing about when it would be ready again, so the answer
 * needs each one's clock — and the clocks are in the game's data:
 *
 *   SpellCooldowns   RecoveryTime / CategoryRecoveryTime — a cooldown of its own
 *                    or one shared with its category
 *   SpellCategories  ChargeCategory — the pool it draws from, if any
 *   SpellCategory    MaxCharges / ChargeRecoveryTime — how many, how fast
 *   ItemEffect       Charges — how many uses a healthstone holds
 *
 * Health potions and healthstones are found by category rather than listed:
 * every expansion brings a new potion, and all of them share the category of
 * the one named in WITNESSES, which is the category the game puts the shared
 * cooldown on. Combat potions (Recklessness and friends) are a different
 * category with a clock of their own, so drinking one never locks out a heal.
 *
 * The big defensives are the ones `defensives.ts` already lists. Most are
 * auras that carry their own clock; the few whose aura is a different spell
 * from the button borrow the button's clock through AURA_CAST.
 *
 * These are base clocks. Talents only ever shorten them, so "it was ready" is
 * safe to say when the base clock has run out; the reverse is not, and the
 * recap never says "it was not ready" as a charge against anyone.
 *
 *   node scripts/spell-cooldowns.mjs [--build 12.1.5.70783] [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Big-defensive auras that are not the spell on the button, and the button
 * whose clock they run on. Read off real logs: the aura applied at the same
 * moment the cast did, under the same player.
 */
const AURA_CAST = [
  { aura: 97463, cast: 97462, why: 'Rallying Cry' },
  { aura: 342246, cast: 342245, why: 'Alter Time' },
  { aura: 110960, cast: 110959, why: 'Greater Invisibility' },
  { aura: 125174, cast: 122470, why: 'Touch of Karma' },
  { aura: 145629, cast: 51052, why: 'Anti-Magic Zone' },
  { aura: 209426, cast: 196718, why: 'Darkness' },
  { aura: 81782, cast: 62618, why: 'Power Word: Barrier' },
  { aura: 325174, cast: 98008, why: 'Spirit Link Totem' },
  { aura: 120954, cast: 115203, why: 'Fortifying Brew' },
  { aura: 393108, cast: 86659, why: 'Guardian of Ancient Kings, a second aura id' },
  { aura: 1309794, cast: 1022, why: 'Blessing of Protection, a second aura id' },
  { aura: 1297686, cast: 108416, why: 'Dark Pact, a second aura id' },
];

/** Clocks the script checks itself against: if one moves, a column did. */
const WITNESSES = [
  { id: 871, ms: 180_000, why: 'Shield Wall — a one-charge pool, not a cooldown' },
  { id: 45438, ms: 240_000, why: 'Ice Block' },
  { id: 48792, ms: 120_000, why: 'Icebound Fortitude' },
  { id: 97463, ms: 180_000, why: 'Rallying Cry, through its cast' },
];
const POTION_WITNESS = { id: 1234768, ms: 300_000, why: 'Silvermoon Health Potion' };
const STONE_WITNESSES = [
  { id: 6262, why: 'Healthstone' },
  { id: 452930, why: 'Demonic Healthstone' },
];
const STONE_MS = 60_000;
const STONE_CHARGES = 3;

/** Anything shorter is a GCD lockout or an internal throttle, not a cooldown. */
const MIN_CLOCK_MS = 5_000;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
};
const checkOnly = args.includes('--check');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'packages/data/src/cooldowns.ts');
const build = flag('build') ?? (await liveBuild());

// The big defensives, from the table that owns the list.
const defensives = readFileSync(join(root, 'packages/data/src/defensives.ts'), 'utf8');
const bigMatch = /const BIG = new Set\(\[([\s\S]*?)\]\);/.exec(defensives);
if (bigMatch === null) {
  console.error('defensives.ts has no BIG set. Regenerate it first: node scripts/spell-effects.mjs');
  process.exit(1);
}
const big = bigMatch[1].match(/\d+/g).map(Number);

const own = new Map();
{
  const { rows, at } = await table('SpellCooldowns', ['SpellID', 'DifficultyID', 'RecoveryTime', 'CategoryRecoveryTime']);
  for (const fields of rows) {
    if (Number(fields[at.DifficultyID]) !== 0) continue;
    own.set(
      Number(fields[at.SpellID]),
      Math.max(Number(fields[at.RecoveryTime]), Number(fields[at.CategoryRecoveryTime])),
    );
  }
}
const pools = new Map();
{
  const { rows, at } = await table('SpellCategory', ['ID', 'MaxCharges', 'ChargeRecoveryTime']);
  for (const fields of rows) {
    const charges = Number(fields[at.MaxCharges]);
    const ms = Number(fields[at.ChargeRecoveryTime]);
    if (charges > 0 && ms > 0) pools.set(Number(fields[at.ID]), { charges, ms });
  }
}
const chargeOf = new Map();
const categoryOf = new Map();
const byCategory = new Map();
{
  const { rows, at } = await table('SpellCategories', ['SpellID', 'DifficultyID', 'Category', 'ChargeCategory']);
  for (const fields of rows) {
    if (Number(fields[at.DifficultyID]) !== 0) continue;
    const id = Number(fields[at.SpellID]);
    const pool = pools.get(Number(fields[at.ChargeCategory]));
    if (pool !== undefined) chargeOf.set(id, pool);
    const category = Number(fields[at.Category]);
    if (category > 0) {
      categoryOf.set(id, category);
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(id);
    }
  }
}

/** A spell's clock: its charge pool if it has one, else its own cooldown. */
function clockOf(id) {
  const pool = chargeOf.get(id);
  const ms = Math.max(own.get(id) ?? 0, pool?.ms ?? 0);
  if (ms < MIN_CLOCK_MS) return null;
  return { ms, charges: pool !== undefined && pool.ms >= ms ? pool.charges : 1 };
}

const castFor = new Map(AURA_CAST.map(({ aura, cast }) => [aura, cast]));
const clocks = new Map();
for (const id of big) {
  const clock = clockOf(id) ?? (castFor.has(id) ? clockOf(castFor.get(id)) : null);
  if (clock !== null) clocks.set(id, clock);
}

const potionCategory = categoryOf.get(POTION_WITNESS.id);
const potions = [...(byCategory.get(potionCategory) ?? [])].sort((a, b) => a - b);
const potionMs = own.get(POTION_WITNESS.id);
const stones = [...new Set(STONE_WITNESSES.flatMap(({ id }) => byCategory.get(categoryOf.get(id)) ?? []))].sort(
  (a, b) => a - b,
);

const stoneCharges = new Set();
{
  const { rows, at } = await table('ItemEffect', ['SpellID', 'Charges', 'CategoryCoolDownMSec']);
  for (const fields of rows) {
    const id = Number(fields[at.SpellID]);
    if (!STONE_WITNESSES.some((witness) => witness.id === id)) continue;
    // Negative charges are consumed with the item, which a healthstone is.
    stoneCharges.add(`${Math.abs(Number(fields[at.Charges]))}/${Number(fields[at.CategoryCoolDownMSec])}`);
  }
}

const wrong = [
  ...WITNESSES.filter(({ id, ms }) => clocks.get(id)?.ms !== ms).map(
    ({ id, ms, why }) => `${id} should come back in ${ms}ms, read ${clocks.get(id)?.ms}: ${why}`,
  ),
  ...(potionMs === POTION_WITNESS.ms ? [] : [`${POTION_WITNESS.why} should be ${POTION_WITNESS.ms}ms, read ${potionMs}`]),
  ...STONE_WITNESSES.filter(({ id }) => !stones.includes(id)).map(({ id, why }) => `${id} is missing: ${why}`),
  ...(stoneCharges.size === 1 && stoneCharges.has(`${STONE_CHARGES}/${STONE_MS}`)
    ? []
    : [`healthstones should be ${STONE_CHARGES} charges on ${STONE_MS}ms, read ${[...stoneCharges].join(', ')}`]),
];
for (const line of wrong) console.error(line);
if (wrong.length > 0) {
  console.error('A column moved or a clock changed. Fix it before committing.');
  process.exit(1);
}
console.log(`${clocks.size} of ${big.length} big defensives have a clock; ${potions.length} health potions; ${stones.length} healthstones`);

const source = render();
if (checkOnly) {
  if ((existsSync(out) ? readFileSync(out, 'utf8') : '') === source) {
    console.log(`up to date for build ${build}`);
    process.exit(0);
  }
  console.error(`${out} is out of date for build ${build}\nRun: node scripts/spell-cooldowns.mjs`);
  process.exit(1);
}
writeFileSync(out, source);
console.log(`wrote ${out} for build ${build}`);

function render() {
  const rows = [...clocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, { ms, charges }]) => `  [${id}, ${ms}, ${charges}],`);
  const list = (ids) => {
    const lines = [];
    for (let i = 0; i < ids.length; i += 10) lines.push(`  ${ids.slice(i, i + 10).join(', ')},`);
    return lines.join('\n');
  };
  return `/**
 * How long the things a player could have pressed to live take to come back.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/spell-cooldowns.mjs\`.
 * Built from SpellCooldowns.db2, SpellCategories.db2, SpellCategory.db2 and
 * ItemEffect.db2, retail build ${build}, via wago.tools.
 *
 * Base clocks, before talents. Talents only shorten them, so a clock that has
 * run out is a cooldown that was certainly back; the reverse is not certain,
 * and nothing should be read into it.
 *
 * Only ids and milliseconds are stored: no names, no descriptions, no art.
 */

/**
 * Big defensives, by the aura the log shows: [aura, ms, charges]. ${clocks.size} of the
 * ${big.length} in \`isBigDefensive\`; the rest are not a player's (a dungeon's
 * buff, a boss's shield) or carry no clock in the data at all.
 */
const DEFENSIVES: readonly (readonly [number, number, number])[] = [
${rows.join('\n')}
];

/** Every health potion: the spells sharing ${POTION_WITNESS.why}'s cooldown category. */
const HEALTH_POTIONS = new Set([
${list(potions)}
]);

/** Healthstones, the warlock's own included. */
const HEALTHSTONES = new Set([${stones.join(', ')}]);

/** The cooldown every health potion shares. */
export const HEALTH_POTION_MS = ${potionMs};
/** A healthstone's cooldown. */
export const HEALTHSTONE_MS = ${STONE_MS};
/** Uses in one healthstone, which is gone after the last. */
export const HEALTHSTONE_CHARGES = ${STONE_CHARGES};

export interface Clock {
  ms: number;
  charges: number;
}

let clocks: Map<number, Clock> | null = null;

/** A big defensive's clock, by the aura it puts up; null when it has none. */
export function defensiveClock(spellId: number): Clock | null {
  clocks ??= new Map(DEFENSIVES.map(([id, ms, charges]) => [id, { ms, charges }]));
  return clocks.get(spellId) ?? null;
}

export function isHealthPotion(spellId: number): boolean {
  return HEALTH_POTIONS.has(spellId);
}

export function isHealthstone(spellId: number): boolean {
  return HEALTHSTONES.has(spellId);
}
`;
}

async function liveBuild() {
  const response = await fetch('https://wago.tools/api/builds');
  if (!response.ok) throw new Error(`wago.tools/api/builds: ${response.status}`);
  const builds = await response.json();
  const version = builds.wow?.[0]?.version;
  if (typeof version !== 'string') throw new Error('no live retail build in the builds list');
  return version;
}

/** One DB2 table as rows of fields, its columns located by name. See spell-presses.mjs. */
async function table(name, columns) {
  const csv = await download(name, build);
  const newline = csv.indexOf('\n');
  const header = csv.slice(0, newline).split(',');
  const at = {};
  const missing = columns.filter((column) => (at[column] = header.indexOf(column)) < 0);
  if (missing.length > 0) {
    console.error(`${name}.csv has no ${missing.join('/')} column. Columns: ${header.join(', ')}`);
    process.exit(1);
  }
  const rows = [];
  for (const line of csv.slice(newline + 1).split('\n')) if (line !== '') rows.push(line.split(','));
  return { rows, at };
}

/** A table, cached by build in the same directory the other DB2 scripts use. */
async function download(name, version) {
  const dir = join(tmpdir(), 'mplus-db2');
  mkdirSync(dir, { recursive: true });
  const cached = join(dir, `${name}-${version}.csv`);
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const url = `https://wago.tools/db2/${name}/csv?build=${version}`;
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const text = await response.text();
  if (!text.startsWith('ID,')) throw new Error(`${url} did not return a CSV: ${text.slice(0, 120)}`);
  writeFileSync(cached, text);
  return text;
}

#!/usr/bin/env node
/**
 * Rebuild the enemy-forces table from Blizzard's own scenario criteria.
 *
 *   packages/data/src/enemy-forces.ts   what every creature is worth
 *
 * A Mythic+ key is a scenario, and a scenario's requirements are a tree of
 * criteria. One node in each dungeon's tree is called "Enemy Forces": its
 * `Amount` is the count the key demands, and its children are the ways to earn
 * it. Most children are `Criteria.Type 0` — kill this creature, worth this
 * much — which is the table every count in this app is built from.
 *
 * That makes this the game's own answer rather than a reading of it. Mythic
 * Dungeon Tools, the usual community source, agrees exactly: checked against
 * MDT 6.2.20 across six dungeons, all six totals and all 110 overlapping
 * per-kill values matched. Where the two differ, MDT is *missing* creatures
 * Blizzard credits — ten of them across those same six dungeons — so this is
 * strictly the richer table, and it is Blizzard's data rather than MDT's, so
 * unlike MDT's GPL-2.0 tables it can be shipped in a build.
 *
 *   node scripts/enemy-forces.mjs [--build 12.1.0.69933] [--dir ./csv]
 *                                 [--keep] [--check]
 *
 * --build pins a build (default: whatever wago.tools says is live), --dir reads
 * the five tables from a directory instead of downloading them, --keep leaves
 * the downloads in the cache directory it prints, and --check writes nothing
 * and exits non-zero if the committed table is out of date, which is the form
 * to run in CI.
 *
 * The downloads total ~8MB and the result is ~40KB, which is why this is a
 * build step and not something the app does at runtime.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The tables this needs, and why.
 *
 * MapChallengeMode is the join to the combat log: its `ID` is the number
 * `CHALLENGE_MODE_START` reports. The other four get from there to the
 * criteria — a challenge mode has a Scenario, a Scenario has steps, a step
 * names a CriteriaTree, and a CriteriaTree's leaves name Criteria.
 */
const TABLES = ['MapChallengeMode', 'Scenario', 'ScenarioStep', 'CriteriaTree', 'Criteria'];

/** `Criteria.Type` for "kill this creature", whose `Asset` is an npc id. */
const CRITERIA_KILL_CREATURE = 0;

/**
 * Scenario names that do not match their MapChallengeMode name.
 *
 * Four, out of seventy-six dungeons, and all four are a word order or a
 * punctuation choice rather than a different dungeon. The join is by name
 * because there is no numeric link between MapChallengeMode and Scenario in
 * the data — the tables were added five expansions apart and nobody ever wired
 * them together — so these are the cost of that, and the script fails loudly
 * when a new one appears rather than silently dropping a dungeon.
 */
const SCENARIO_ALIAS = new Map([
  ['Upper Return to Karazhan', 'Return to Karazhan: Upper'],
  ['Lower Return to Karazhan', 'Return to Karazhan: Lower'],
  ['Mechagon Junkyard', 'Operation: Mechagon - Junkyard'],
  ['The Theater of Pain', 'Theater of Pain'],
]);

/**
 * The retired Teeming affix, which doubled as a second copy of every dungeon.
 *
 * Teeming added trash and raised the requirement, so each dungeon's tree still
 * carries a complete second variant marked in the root's description. It has
 * not been live since Legion and its totals disagree with the current ones, so
 * matching it would put the wrong requirement on every key.
 */
const RETIRED_VARIANT = /\(More Trash\)/;

/** How many earlier builds a restoration walk may read before giving up. */
const RESTORE_BUDGET = 6;

/** Every retail build wago.tools knows, newest first. Fetched once. */
let buildList = null;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const checkOnly = args.includes('--check');
const keep = args.includes('--keep');

const out = fileURLToPath(new URL('../packages/data/src/enemy-forces.ts', import.meta.url));

// --build is still honoured with --dir, because the build is the only record of
// which patch a committed table describes and a local copy came from one too.
const localDir = flag('dir');
const build = flag('build') ?? (localDir === undefined ? await liveBuild() : 'local');

const { dungeons, notes } = build_table(await tablesFor(build, localDir));
notes.push(...(await restore(dungeons, build, localDir)));
console.log(`${dungeons.length} dungeons, ${dungeons.reduce((n, d) => n + d.enemies.length, 0)} creatures`);
for (const note of notes) console.log(`  ${note}`);

const source = render(dungeons, notes, build);
if (checkOnly) {
  const have = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (have === source) {
    console.log(`up to date for build ${build}`);
    process.exit(0);
  }
  console.error(`${out} is out of date for build ${build}`);
  console.error('Run: node scripts/enemy-forces.mjs');
  process.exit(1);
}
writeFileSync(out, source);
console.log(`wrote ${out} (${(source.length / 1024).toFixed(1)}KB) for build ${build}`);

/** The five tables for one build, parsed. */
async function tablesFor(version, dir) {
  const out = {};
  for (const name of TABLES) {
    const text = dir === undefined ? await download(name, version) : readFileSync(join(dir, `${name}.csv`), 'utf8');
    out[name] = parse(text, name);
  }
  return out;
}

/**
 * One CSV field at a time, honouring quotes.
 *
 * Creature and dungeon names contain commas and apostrophes and the odd
 * doubled quote ("Lady Waycrest's ""Guest"""), so splitting on commas loses
 * every column after the first such name. This is not hot — five tables and
 * 190k rows once per patch — so correctness wins.
 */
function split(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else field += c;
  }
  fields.push(field);
  return fields;
}

function parse(text, name) {
  const lines = text.split('\n');
  const header = split(lines[0] ?? '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const fields = split(lines[i]);
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = fields[c] ?? '';
    rows.push(row);
  }
  if (rows.length === 0) throw new Error(`${name}.csv has no rows`);
  return rows;
}

/**
 * The whole table, plus the notes that belong in the generated header.
 *
 * Notes rather than warnings: a dungeon the data cannot describe is normal —
 * the MoP and WoD challenge modes were timed runs with no forces requirement
 * at all, and there is always an unreleased dungeon or two in the files — so
 * the useful thing is to write down which ones and why, not to fail.
 */
function build_table(t) {
  const node = new Map(t.CriteriaTree.map((row) => [row.ID, row]));
  const children = new Map();
  for (const row of t.CriteriaTree) {
    const list = children.get(row.Parent);
    if (list === undefined) children.set(row.Parent, [row]);
    else list.push(row);
  }
  const criteria = new Map(t.Criteria.map((row) => [row.ID, row]));
  const stepByTree = new Map(t.ScenarioStep.map((row) => [row.CriteriatreeID, row]));
  const scenario = new Map(t.Scenario.map((row) => [row.ID, row]));

  const challengeByName = new Map();
  for (const row of t.MapChallengeMode) {
    if (!challengeByName.has(row.Name_lang)) challengeByName.set(row.Name_lang, row);
  }

  /** The root of a node's tree, which is the one a ScenarioStep names. */
  const rootOf = (start) => {
    const seen = new Set();
    let at = start;
    while (at !== undefined && at.Parent !== '0' && !seen.has(at.ID)) {
      seen.add(at.ID);
      at = node.get(at.Parent);
    }
    return at ?? null;
  };

  // Every live "Enemy Forces" node, grouped by the challenge mode it belongs
  // to. Siege of Boralus has two — one per faction — and a handful of trees
  // belong to no challenge mode at all.
  const found = new Map();
  const unmatched = new Set();
  for (const ef of t.CriteriaTree) {
    if (ef.Description_lang !== 'Enemy Forces') continue;
    const root = rootOf(ef);
    const step = root === null ? undefined : stepByTree.get(root.ID);
    if (step === undefined || RETIRED_VARIANT.test(root.Description_lang)) continue;
    const name = scenario.get(step.ScenarioID)?.Name_lang ?? '';
    const challenge = challengeByName.get(SCENARIO_ALIAS.get(name) ?? name);
    if (challenge === undefined) {
      unmatched.add(name);
      continue;
    }
    const list = found.get(challenge.ID);
    if (list === undefined) found.set(challenge.ID, { challenge, nodes: [ef] });
    else list.nodes.push(ef);
  }

  /** A node's kill criteria and its other criteria, to any depth. */
  const walk = (start) => {
    const kills = new Map();
    const other = [];
    const descend = (parent, depth) => {
      for (const child of children.get(parent) ?? []) {
        const rule = criteria.get(child.CriteriaID);
        const amount = Number(child.Amount);
        if (rule !== undefined && Number.isFinite(amount)) {
          if (Number(rule.Type) === CRITERIA_KILL_CREATURE) {
            const npcId = Number(rule.Asset);
            // Six creatures across three dungeons carry a kill criterion worth
            // nothing — The Necrotic Wake has four. A row worth 0 says exactly
            // what no row says, so it is dropped rather than shipped, which
            // keeps "every row awards something" true of the whole table.
            //
            // A creature listed twice carries the same value both times, so
            // the first wins rather than the last.
            if (Number.isInteger(npcId) && npcId > 0 && amount > 0 && !kills.has(npcId)) {
              kills.set(npcId, amount);
            }
          } else {
            other.push({ asset: rule.Asset, amount });
          }
        }
        if (depth < 4) descend(child.ID, depth + 1);
      }
    };
    descend(start.ID, 0);
    return { kills, other };
  };

  // How many dungeons each non-kill criterion appears in, which is what
  // separates a per-dungeon criterion from the scaffolding every dungeon
  // carries. See `nonKillAmounts` below.
  const assetDungeons = new Map();
  for (const [id, { nodes }] of found) {
    for (const ef of nodes) {
      for (const { asset } of walk(ef).other) {
        const seen = assetDungeons.get(asset);
        if (seen === undefined) assetDungeons.set(asset, new Set([id]));
        else seen.add(id);
      }
    }
  }

  const dungeons = [];
  const notes = [];
  const empty = [];
  for (const [, { challenge, nodes }] of [...found].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const enemies = new Map();
    let total = 0;
    let nonKillAmounts = [];
    for (const ef of nodes) {
      total = Math.max(total, Number(ef.Amount) || 0);
      const { kills, other } = walk(ef);
      // Faction variants of the same dungeon: the requirement is identical and
      // the trash differs, so the union is what either faction's log needs.
      for (const [npcId, amount] of kills) if (!enemies.has(npcId)) enemies.set(npcId, amount);
      const variant = [];
      for (const { asset, amount } of other) {
        if (assetDungeons.get(asset)?.size === 1 && amount > 0) variant.push(amount);
      }
      if (variant.length > nonKillAmounts.length) nonKillAmounts = variant;
    }
    if (total <= 0 || enemies.size === 0) {
      empty.push(`${challenge.Name_lang} (${challenge.ID})`);
      continue;
    }
    dungeons.push({
      challengeModeId: Number(challenge.ID),
      name: challenge.Name_lang,
      total,
      nonKillAmounts,
      enemies: [...enemies].sort((a, b) => a[0] - b[0]),
    });
  }

  const noForces = t.MapChallengeMode.filter((row) => !found.has(row.ID)).map((row) => row.Name_lang);
  if (noForces.length > 0) {
    notes.push(`${noForces.length} challenge modes have no Enemy Forces node (timed-only, pre-Legion): ${noForces.join(', ')}`);
  }
  if (empty.length > 0) notes.push(`${empty.length} skipped for having no kill criteria yet: ${empty.join(', ')}`);
  if (unmatched.size > 0) {
    notes.push(`UNMATCHED scenario names — add to SCENARIO_ALIAS: ${[...unmatched].join(', ')}`);
  }
  const withNonKill = dungeons.filter((d) => d.nonKillAmounts.length > 0);
  if (withNonKill.length > 0) {
    notes.push(
      `${withNonKill.length} dungeons carry a per-dungeon non-kill criterion: ` +
        withNonKill.map((d) => `${d.name} ${d.nonKillAmounts.join('+')}`).join(', '),
    );
  }
  return { dungeons, notes };
}

/**
 * Put back the kill rows a retune re-expressed as a non-kill criterion.
 *
 * `Criteria.Type 92` is not "the dungeon awards this for an objective". It is
 * a creature kill addressed through something other than an npc id, and a
 * retune can move a creature from one to the other. Ruby Life Pools is the
 * proof: between 12.1.0.69404 and 12.1.0.69933 its kill rows for npc 190034
 * (25) and npc 190206 (7) were deleted and two type-92 criteria appeared
 * worth exactly 25 and 7. Their `Criteria` rows still name the creatures —
 * only the `CriteriaTree` nodes carrying the amounts are gone — so the amounts
 * have to come from a build that still had them.
 *
 * Left alone, that cost the dungeon twice: 32 came off the requirement and 163
 * of reachable count went missing, and four timed keys read 77-82% instead of
 * 101-106%.
 *
 * The match is on amount, which is what makes this safe: a type-92 criterion
 * whose amount is not also a dropped kill row's amount restores nothing. A
 * dungeon whose type-92 criteria are all duplicates of rows it still has —
 * King's Rest, whose 30 is its Shadow of Zul — is left exactly as it is.
 */
async function restore(dungeons, version, dir) {
  const notes = [];
  const wanted = dungeons.filter((d) => d.nonKillAmounts.length > 0);
  if (wanted.length === 0) return notes;
  if (dir !== undefined) {
    notes.push(`RESTORE skipped: --dir reads one build, so dropped rows cannot be recovered`);
    return notes;
  }

  // Outstanding amounts per dungeon, consumed as each one is matched.
  const outstanding = new Map(wanted.map((d) => [d.challengeModeId, [...d.nonKillAmounts]]));
  const byId = new Map(dungeons.map((d) => [d.challengeModeId, d]));
  const restored = [];

  let all;
  try {
    all = await builds();
  } catch (error) {
    notes.push(`RESTORE skipped: could not list builds (${error.message})`);
    return notes;
  }
  // Only builds older than the target, newest first: the newest build that
  // still had a row carries the value closest to the current tuning.
  const at = all.indexOf(version);
  const earlier = at < 0 ? all.filter((v) => v !== version) : all.slice(at + 1);

  for (const older of earlier.slice(0, RESTORE_BUDGET)) {
    if ([...outstanding.values()].every((list) => list.length === 0)) break;
    let past;
    try {
      past = build_table(await tablesFor(older, undefined)).dungeons;
    } catch (error) {
      notes.push(`RESTORE: build ${older} unreadable (${error.message})`);
      continue;
    }
    for (const was of past) {
      const list = outstanding.get(was.challengeModeId);
      if (list === undefined || list.length === 0) continue;
      const now = byId.get(was.challengeModeId);
      const have = new Set(now.enemies.map(([npcId]) => npcId));
      for (const [npcId, amount] of was.enemies) {
        if (have.has(npcId)) continue;
        const slot = list.indexOf(amount);
        if (slot < 0) continue;
        list.splice(slot, 1);
        now.enemies.push([npcId, amount]);
        have.add(npcId);
        restored.push(`${now.name} npc ${npcId} = ${amount} (from ${older})`);
      }
      now.enemies.sort((a, b) => a[0] - b[0]);
    }
  }

  if (restored.length > 0) notes.push(`RESTORED ${restored.length} dropped kill rows: ${restored.join(', ')}`);
  const left = wanted
    .filter((d) => (outstanding.get(d.challengeModeId) ?? []).length > 0)
    .map((d) => `${d.name} ${outstanding.get(d.challengeModeId).join('+')}`);
  if (left.length > 0) {
    notes.push(`non-kill criteria with no dropped row to match, left out of the table: ${left.join(', ')}`);
  }
  return notes;
}

async function builds() {
  if (buildList !== null) return buildList;
  const response = await fetch('https://wago.tools/api/builds');
  if (!response.ok) throw new Error(`wago.tools/api/builds: ${response.status}`);
  const all = await response.json();
  const versions = (all.wow ?? []).map((row) => row.version).filter((v) => typeof v === 'string');
  if (versions.length === 0) throw new Error('no retail builds in the builds list');
  buildList = versions;
  return buildList;
}

async function liveBuild() {
  return (await builds())[0];
}

/** A table, cached by build, in the OS temp dir rather than the repo. */
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
  if (!/^[A-Za-z]/.test(text)) throw new Error(`${url} did not return a CSV: ${text.slice(0, 120)}`);
  writeFileSync(cached, text);
  if (!keep) console.log(`cached at ${cached}`);
  return text;
}

/**
 * The table as a module.
 *
 * One line per dungeon, creatures as `npcId:count` pairs in a string. Not
 * delta-encoded: there are fifteen hundred creatures rather than the five
 * thousand spell ids the defensive table packs, so the saving is a few
 * kilobytes and the cost is that `git diff` after a patch stops being
 * readable. A dungeon whose numbers changed should show as one changed line.
 */
function render(dungeons, notes, version) {
  const rows = dungeons.map((d) => {
    const enemies = d.enemies.map(([npcId, count]) => `${npcId}:${count}`).join(',');
    return (
      `  // ${d.name}\n` +
      `  [${d.challengeModeId}, ${d.total}, ${JSON.stringify(d.name)},\n` +
      `    '${wrap(enemies)}'],`
    );
  });
  return `/**
 * What every creature in a Mythic+ dungeon is worth, from Blizzard's own data.
 *
 * GENERATED — do not edit. Rebuild with \`node scripts/enemy-forces.mjs\`.
 * Built from MapChallengeMode, Scenario, ScenarioStep, CriteriaTree and
 * Criteria, retail build ${version}, via wago.tools.
 *
 * A key is a scenario and a scenario's requirements are a tree of criteria.
 * The node called "Enemy Forces" holds the count the dungeon demands, and its
 * children are the ways to earn it: a \`Criteria.Type 0\` child names a creature
 * and what killing one is worth. That is the whole table.
 *
 * Checked against Mythic Dungeon Tools 6.2.20, which is where this number
 * usually comes from: all six dungeons tested agreed on the total and on all
 * 110 overlapping per-kill values. The differences are all in one direction —
 * MDT omits creatures Blizzard credits, ten across those six dungeons — so
 * nothing here is a second opinion about MDT's numbers. It is the same numbers
 * from upstream, with the gaps filled, and being Blizzard's data rather than
 * MDT's it is not GPL-2.0 and can be shipped.
 *
 * Only ids and amounts are stored, plus each dungeon's own name for the UI to
 * attribute: no creature names, no art. The log already names every creature
 * it reports.
 *
 * Kills have to supply the whole of \`total\`. Nothing is taken off for the
 * \`Criteria.Type 92\` children a few dungeons carry, because those are not
 * objectives: each one is a creature kill addressed by something other than an
 * npc id. King's Rest's 30 is its Shadow of Zul, which already has a kill row;
 * Ruby Life Pools' 25 and 7 are two rows a retune deleted, restored here from
 * the last build that carried them. Mythic Dungeon Tools quotes the same
 * \`total\` for every dungeon and models kills alone, which is the cross-check.
 *
 * Notes from the build:
${notes.map((note) => ` *   ${note}`).join('\n')}
 */
import type { DungeonForces } from './forces.js';

/** The retail build these numbers were read from, for the UI to attribute them. */
export const DB2_BUILD = '${version}';

/** \`[challengeModeId, total, name, 'npcId:count,...']\` */
type Row = readonly [number, number, string, string];

const DUNGEONS: readonly Row[] = [
${rows.join('\n')}
];

/**
 * Decoded on the first call rather than at import: the worker thread that only
 * parses never asks, and a log from an unsupported dungeon never asks either.
 *
 * \`teleportSpellId\` is 0 on every dungeon here. The criteria data has no link
 * from a dungeon to a spell, so the field exists to be filled in from Mythic
 * Dungeon Tools when it is installed — see \`DungeonForces.teleportSpellId\`.
 * Nothing else in the table depends on it.
 */
let table: DungeonForces[] | null = null;

/** Every dungeon the criteria data describes, newest ids last. */
export function db2Dungeons(): DungeonForces[] {
  table ??= DUNGEONS.map(([challengeModeId, total, name, packed]) => ({
    challengeModeId,
    name,
    total,
    teleportSpellId: 0,
    enemies: packed.split(',').map((pair) => {
      const colon = pair.indexOf(':');
      return { npcId: Number(pair.slice(0, colon)), count: Number(pair.slice(colon + 1)) };
    }),
  }));
  // Copied, because the caller owns its table: the desktop app fills in
  // teleport ids on the dungeons it hands to the worker, and that must not
  // mutate the cached decode.
  return table.map((dungeon) => ({ ...dungeon, enemies: [...dungeon.enemies] }));
}

/** How many dungeons the table knows. Exported for the test, which asserts it is not empty. */
export function db2DungeonCount(): number {
  return DUNGEONS.length;
}
`;
}

/** Wrapped at 96 columns so the generated file opens without a scrollbar. */
function wrap(text) {
  const lines = [];
  let at = 0;
  while (at < text.length) {
    // Break after a comma so a pair is never split across two string literals.
    let cut = Math.min(at + 96, text.length);
    if (cut < text.length) {
      const comma = text.lastIndexOf(',', cut);
      if (comma > at) cut = comma + 1;
    }
    lines.push(text.slice(at, cut));
    at = cut;
  }
  return lines.join("' +\n    '");
}

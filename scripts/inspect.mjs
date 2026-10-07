#!/usr/bin/env node
/**
 * Format inspector.
 *
 * The parser derives line layout compositionally, but two things are still
 * assumed: that the advanced-logging block is 17 fields wide, and that
 * COMBATANT_INFO carries the spec id at field 23. Both are patch-sensitive.
 *
 * This reports what a real log actually contains so those assumptions can be
 * checked against evidence rather than recollection, and doubles as a
 * throughput benchmark.
 *
 *   node scripts/inspect.mjs ~/path/to/WoWCombatLog-093026_184800.txt
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  ADVANCED_FIELD_COUNT,
  BASE_FIELD_COUNT,
  Ev,
  LineAssembler,
  LogSession,
  MAX_FIELDS,
  MIN_ADVANCED_FIELD_COUNT,
  TimestampReader,
  fieldHasDot,
  fieldIsArray,
  fieldStr,
  hasBaseBlock,
  identifyEvent,
  looksLikeGuid,
  prefixFieldCount,
  splitFields,
} from '../packages/parser/dist/src/index.js';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/inspect.mjs <WoWCombatLog-*.txt>');
  process.exit(2);
}

const LIMIT = Number(process.env.INSPECT_LIMIT ?? 0) || Infinity;

/** @type {Map<string, {count: number, widths: Map<number, number>, sample: string, advanced: number, plain: number}>} */
const shapes = new Map();
const offsets = new Int32Array(MAX_FIELDS * 2);
const reader = new TimestampReader();
const assembler = new LineAssembler();

/** Measured advanced-block widths, per event name. */
const advancedWidths = new Map();
/** Field index at which COMBATANT_INFO's first bracketed array appears. */
const specIndexes = new Map();
/** Damage suffix widths and whether a -1 overkill sentinel appears where expected. */
const overkillWitness = new Map();

let lines = 0;
let rejected = 0;

function observe(line) {
  lines++;
  if (!reader.read(line)) {
    rejected++;
    return;
  }
  const bodyStart = reader.bodyStart;
  const nameEnd = line.indexOf(',', bodyStart);
  const name = nameEnd === -1 ? line.slice(bodyStart) : line.slice(bodyStart, nameEnd);
  const count = nameEnd === -1 ? 0 : splitFields(line, nameEnd + 1, offsets);

  let shape = shapes.get(name);
  if (shape === undefined) {
    shape = { count: 0, widths: new Map(), sample: line, advanced: 0, plain: 0 };
    shapes.set(name, shape);
  }
  shape.count++;
  shape.widths.set(count, (shape.widths.get(count) ?? 0) + 1);

  const { code } = identifyEvent(name);
  if (!hasBaseBlock(code) || count < BASE_FIELD_COUNT) return;

  if (code === Ev.COMBATANT_INFO) {
    // The spec id is the field before the first bracketed array.
    for (let i = 2; i < count; i++) {
      if (!fieldIsArray(line, offsets, i)) continue;
      const key = `${i - 1}`;
      let bucket = specIndexes.get(key);
      if (bucket === undefined) {
        bucket = new Map();
        specIndexes.set(key, bucket);
      }
      const value = fieldStr(line, offsets, i - 1);
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
      break;
    }
    return;
  }

  const advancedStart = BASE_FIELD_COUNT + prefixFieldCount(name);
  const advanced =
    count > advancedStart + MIN_ADVANCED_FIELD_COUNT &&
    looksLikeGuid(fieldStr(line, offsets, advancedStart));
  if (advanced) shape.advanced++;
  else shape.plain++;

  // Measure the block: positionX is the first fractional field in it, and sits
  // five fields from its end.
  let width = 0;
  if (advanced) {
    for (let i = advancedStart + 5; i < count; i++) {
      if (!fieldHasDot(line, offsets, i)) continue;
      width = i - advancedStart + 5;
      break;
    }
    if (width > 0) {
      let bucket = advancedWidths.get(name);
      if (bucket === undefined) {
        bucket = new Map();
        advancedWidths.set(name, bucket);
      }
      bucket.set(width, (bucket.get(width) ?? 0) + 1);
    }
  }

  if (name.endsWith('_DAMAGE') || name === 'SWING_DAMAGE' || name === 'SWING_DAMAGE_LANDED') {
    let suffixStart = advancedStart + (advanced ? width || ADVANCED_FIELD_COUNT : 0);
    if (name === 'ENVIRONMENTAL_DAMAGE') suffixStart += 1;
    const suffixWidth = count - suffixStart;
    const key = `${name} suffix=${suffixWidth}`;
    let witness = overkillWitness.get(key);
    if (witness === undefined) {
      witness = { at1: 0, at2: 0, neither: 0, sample: line.slice(0, 400) };
      overkillWitness.set(key, witness);
    }
    const one = suffixStart + 1 < count ? fieldStr(line, offsets, suffixStart + 1) : '';
    const two = suffixStart + 2 < count ? fieldStr(line, offsets, suffixStart + 2) : '';
    if (one === '-1') witness.at1++;
    else if (two === '-1') witness.at2++;
    else witness.neither++;
  }
}

const info = await stat(target);
const started = process.hrtime.bigint();

// Second pass target: the real session, so run segmentation is exercised too.
const session = new LogSession({ assumedYear: new Date(info.mtimeMs).getUTCFullYear() });

const stream = createReadStream(target, { highWaterMark: 1 << 20 });
let bytes = 0;
for await (const chunk of stream) {
  bytes += chunk.length;
  assembler.push(chunk, observe);
  session.push(chunk);
  if (lines >= LIMIT) break;
}
assembler.end(observe);
session.end();

const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

const fmt = new Intl.NumberFormat('en-US');
const mb = (n) => `${(n / 1_048_576).toFixed(1)} MB`;

console.log(`\n${basename(target)} — ${mb(info.size)}, read ${mb(bytes)}`);
console.log(
  `${fmt.format(lines)} lines in ${elapsedMs.toFixed(0)} ms  ` +
    `(${fmt.format(Math.round(lines / (elapsedMs / 1000)))} lines/s, ` +
    `${(bytes / 1_048_576 / (elapsedMs / 1000)).toFixed(1)} MB/s)`,
);
if (rejected > 0) console.log(`${fmt.format(rejected)} lines had no parseable timestamp`);

const version = session.parser.version;
console.log(
  `\nCOMBAT_LOG_VERSION: ${version ? `v${version.version}, build ${version.buildVersion}, advanced logging ${version.advancedLogging ? 'ON' : 'OFF'}` : 'not present'}`,
);
if (version && !version.advancedLogging) {
  console.log('  ⚠  Advanced logging is off. No health traces or positions, so');
  console.log('     death post-mortems and pull clustering will not work.');
}

console.log(`\nRuns found: ${session.runs.length}`);
for (const run of session.runs) {
  if (run.meta.kind === 'raid') {
    const minutes = run.meta.elapsedMs ? (run.meta.elapsedMs / 60000).toFixed(1) : '?';
    console.log(
      `  ${run.meta.encounterName} (difficulty ${run.meta.difficultyId}) pull ${run.meta.pull}, ${run.meta.zoneName || '?'} — ` +
        `${run.meta.success === null ? 'in progress' : run.meta.success ? 'kill' : 'wipe'}, ` +
        `${minutes} min, ${fmt.format(run.store.count)} events, ${mb(run.store.byteLength())}, ` +
        `${run.meta.party.length} players`,
    );
    continue;
  }
  const minutes = run.meta.totalTimeMs ? (run.meta.totalTimeMs / 60000).toFixed(1) : '?';
  console.log(
    `  +${run.meta.keystoneLevel} ${run.meta.zoneName} — ` +
      `${run.meta.success === null ? 'in progress' : run.meta.success ? 'timed' : 'depleted'}, ` +
      `${minutes} min, ${fmt.format(run.store.count)} events, ` +
      `${mb(run.store.byteLength())}, affixes [${run.meta.affixes.join(', ')}], ` +
      `${run.meta.encounters.filter((e) => e.success).length} boss kill(s)`,
  );
  const perEvent = run.store.count > 0 ? run.store.byteLength() / run.store.count : 0;
  console.log(`      ${perEvent.toFixed(1)} bytes/event`);
}

console.log('\nAdvanced block width (measured, not assumed)');
const widthTotals = new Map();
for (const bucket of advancedWidths.values()) {
  for (const [w, n] of bucket) widthTotals.set(w, (widthTotals.get(w) ?? 0) + n);
}
if (widthTotals.size === 0) {
  console.log('  no advanced blocks found — is advanced combat logging enabled?');
} else {
  for (const [w, n] of [...widthTotals.entries()].sort((a, b) => b[1] - a[1])) {
    const flag = w === ADVANCED_FIELD_COUNT ? 'matches the default' : '⚠ differs from the default';
    console.log(`  width ${w}: ${fmt.format(n)} events  (${flag} of ${ADVANCED_FIELD_COUNT})`);
  }
  if (widthTotals.size > 1) {
    console.log('  ⚠  more than one width measured. Per event name:');
    for (const [name, bucket] of advancedWidths) {
      if (bucket.size > 1) {
        console.log(`       ${name}: ${[...bucket.entries()].map(([w, n]) => `${w}×${fmt.format(n)}`).join(' ')}`);
      }
    }
  }
}
const mixed = [...shapes.entries()].filter(([, s]) => s.advanced > 0 && s.plain > 0);
if (mixed.length > 0) {
  console.log('  ⚠  these events were sometimes read as advanced and sometimes not:');
  for (const [name, s] of mixed.slice(0, 10)) {
    console.log(`       ${name}: advanced ${fmt.format(s.advanced)} / plain ${fmt.format(s.plain)}`);
  }
}

console.log('\nDamage suffix layout (where overkill sits)');
for (const [key, w] of [...overkillWitness.entries()].sort()) {
  const verdict =
    w.at2 > w.at1 * 4 ? 'offset 2 (baseAmount present)' : w.at1 > w.at2 * 4 ? 'offset 1 (legacy)' : 'AMBIGUOUS';
  console.log(`  ${key}: -1 at +1 ${fmt.format(w.at1)}, at +2 ${fmt.format(w.at2)}, neither ${fmt.format(w.neither)} → ${verdict}`);
  if (verdict === 'AMBIGUOUS') console.log(`      sample: ${w.sample}`);
}

console.log('\nCOMBATANT_INFO spec id (field before the first bracketed array)');
if (specIndexes.size === 0) {
  console.log('  no COMBATANT_INFO lines seen');
} else {
  for (const [index, bucket] of [...specIndexes.entries()].sort()) {
    const values = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    const plausible = values.every(([v]) => /^\d{2,4}$/.test(v) && Number(v) >= 62 && Number(v) <= 2000);
    console.log(
      `  at field ${index}: ${values.map(([v, n]) => `${v}×${fmt.format(n)}`).join(' ')}` +
        (plausible ? '  → all plausible spec ids' : '  ⚠ not spec-shaped'),
    );
  }
  if (specIndexes.size > 1) {
    console.log('  note: the index varies between lines, which is expected — it is');
    console.log('        located structurally rather than by a fixed position.');
  }
}

const unrecognized = [...shapes.entries()].filter(([name]) => identifyEvent(name).code === Ev.UNKNOWN);
console.log(`\nUnrecognized event names: ${unrecognized.length}`);
for (const [name, s] of unrecognized.sort((a, b) => b[1].count - a[1].count).slice(0, 25)) {
  console.log(`  ${name} ×${fmt.format(s.count)}`);
}

console.log('\nTop events by volume');
for (const [name, s] of [...shapes.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
  const widths = [...s.widths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([w, n]) => `${w}×${fmt.format(n)}`)
    .join(' ');
  console.log(`  ${name.padEnd(32)} ${fmt.format(s.count).padStart(10)}  field counts: ${widths}`);
}

if (process.env.INSPECT_SAMPLES) {
  console.log('\nOne sample line per event name');
  for (const [name, s] of [...shapes.entries()].sort()) {
    console.log(`\n  ${name}\n    ${s.sample.slice(0, 600)}`);
  }
}
console.log();

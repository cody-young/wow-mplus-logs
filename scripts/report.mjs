#!/usr/bin/env node
/**
 * Analysis validation: segments, breakdowns and deaths for a real log.
 *
 * The point is plausibility, not pretty output. Segment counts, pull labels,
 * whether per-segment damage sums back to the run total, and whether a death's
 * health trace actually descends — those are the things a fixture cannot check.
 *
 *   node scripts/report.mjs <log> [runIndex]
 */
import { createReadStream } from 'node:fs';

import { forcesFor } from '../packages/data/dist/src/index.js';
import { LogSession } from '../packages/parser/dist/src/index.js';
import {
  SegmentKind,
  buildSegments,
  contextFor,
  damageReport,
  deathReports,
  healingReport,
} from '../packages/analysis/dist/src/index.js';

const target = process.argv[2];
const runIndex = Number(process.argv[3] ?? 0);
if (!target) {
  console.error('usage: node scripts/report.mjs <log> [runIndex]');
  process.exit(2);
}

const session = new LogSession();
for await (const chunk of createReadStream(target, { highWaterMark: 1 << 20 })) session.push(chunk);
session.end();

const run = session.runs[runIndex];
if (!run) {
  console.error(`no run at index ${runIndex}; found ${session.runs.length}`);
  process.exit(1);
}

// Enemy forces, if MDT is installed beside this log. Loaded through the
// desktop app's own reader so this script validates the real path; a missing
// bundle (packages built but the app not) is a report without count, not a
// crash.
let forcesTable = { source: '', dungeons: [] };
try {
  const { loadForces } = await import('../apps/desktop/out/main/forces.js');
  ({ table: forcesTable } = await loadForces(target));
} catch {
  // no desktop bundle; fall through with an empty table
}

const context = contextFor(session, run);
const segments = buildSegments(context, { forces: forcesFor(forcesTable, run.meta.challengeModeId) });
const short = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`;
const clock = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

console.log(
  `\n+${run.meta.keystoneLevel} ${run.meta.zoneName} — ${run.meta.success ? 'timed' : 'depleted'}, ` +
    `${((run.meta.totalTimeMs ?? 0) / 60000).toFixed(1)} min, ${run.store.count.toLocaleString('en-US')} events`,
);

const bosses = segments.segments.filter((s) => s.kind === SegmentKind.BOSS);
const pulls = segments.segments.filter((s) => s.kind === SegmentKind.PULL);
console.log(`${pulls.length} pulls, ${bosses.length} boss fights\n`);

const { forces } = segments;
if (forces.known) {
  console.log(
    `COUNT  ${forces.counted}/${forces.total} (${(forces.fraction * 100).toFixed(1)}%) — ` +
      `${forces.dungeon}, ${forces.source}` +
      (forces.nonKill > 0
        ? `\n       ${forces.nonKill} of those are awarded for an objective, not a kill`
        : '') +
      // The key completed, so it counted 100%, and the dungeon's non-kill
      // award is not big enough to cover the gap on its own.
      (forces.incomplete
        ? `\n       ✗ completed key ${forces.counted} short of ${forces.total}` +
          ` with only ${forces.nonKill} awarded for non-kills`
        : ''),
  );
} else {
  console.log(
    `COUNT  the criteria table has no dungeon for challenge-mode map ${run.meta.challengeModeId}`,
  );
}
console.log();

console.log('SEGMENTS');
for (const segment of segments.segments) {
  const overlapsBoss = segment.overlaps.some((id) => segments.get(id)?.kind === SegmentKind.BOSS);
  const report = damageReport(context, segments, { segmentId: segment.id });
  console.log(
    `  ${clock(segment.startTs)}–${clock(segment.endTs)} ` +
      `${segment.kind === SegmentKind.BOSS ? 'BOSS' : 'pull'} ` +
      `${segment.label.padEnd(34).slice(0, 34)} ` +
      `${String(segment.enemies.length).padStart(3)} enemies  ` +
      (forces.known
        ? `${String(segment.forces).padStart(3)} count (${((segment.forces / Math.max(forces.total, 1)) * 100).toFixed(1).padStart(4)}%)  `
        : '') +
      `${short(report.total).padStart(7)} dmg` +
      (segment.kind === SegmentKind.PULL && overlapsBoss ? '   ⟂ overlaps a boss fight' : ''),
  );
}

// Does attribution conserve? Per-segment totals must sum to the whole-run total.
const whole = damageReport(context, segments);
const summed = segments.segments.reduce(
  (total, segment) => total + damageReport(context, segments, { segmentId: segment.id }).total,
  0,
);
console.log(
  `\nCONSERVATION  whole run ${short(whole.total)}  vs  sum of segments ${short(summed)}  ` +
    `(${(((summed - whole.total) / whole.total) * 100).toFixed(2)}% difference)`,
);

if (forces.known) {
  const summedForces = segments.segments.reduce((total, segment) => total + segment.forces, 0);
  console.log(
    `COUNT RECONCILES  run ${forces.counted}  vs  sum of segments ${summedForces}` +
      (summedForces === forces.counted ? '  ✓' : '  ✗ MISMATCH'),
  );
}

console.log('\nDAMAGE — whole key');
for (const actor of whole.actors.slice(0, 8)) {
  const top = actor.spells
    .slice(0, 3)
    .map((s) => `${s.name} ${short(s.total)}`)
    .join(', ');
  console.log(
    `  ${actor.name.padEnd(26).slice(0, 26)} ${String(actor.specId).padStart(4)} ` +
      `${short(actor.perSecond).padStart(7)} dps  ${short(actor.total).padStart(7)}  ` +
      `${(actor.share * 100).toFixed(1).padStart(5)}%  ${top}`,
  );
  // Both figures are already inside the totals above: support is moved to the
  // evoker by default, so this says where it came from rather than what to add.
  if (actor.supportGiven > 0) console.log(`      ${short(actor.supportGiven)} of that is support they enabled on other players' hits`);
  if (actor.supportReceived > 0) console.log(`      ${short(actor.supportReceived)} of their hits was credited out to a supporter`);
}

const heal = healingReport(context, segments);
console.log('\nHEALING — whole key (effective, overhealing excluded)');
for (const actor of heal.actors.slice(0, 5)) {
  console.log(
    `  ${actor.name.padEnd(26).slice(0, 26)} ${short(actor.perSecond).padStart(7)} hps  ` +
      `${short(actor.total).padStart(7)} effective, ${short(actor.wasted).padStart(7)} overhealed`,
  );
}

const taken = damageReport(context, segments, { direction: 'taken' });
console.log('\nDAMAGE TAKEN — whole key');
for (const actor of taken.actors.slice(0, 6)) {
  const worst = actor.spells[0];
  console.log(
    `  ${actor.name.padEnd(26).slice(0, 26)} ${short(actor.total).padStart(7)}  ` +
      (worst ? `worst: ${worst.name} ${short(worst.total)} from ${worst.topSourceName}` : ''),
  );
}

const deaths = deathReports(context, segments);
console.log(`\nDEATHS — ${deaths.length}`);
for (const death of deaths) {
  console.log(
    `\n  ${clock(death.ts)}  ${death.name} (spec ${death.specId})  in ${death.segmentKind === SegmentKind.BOSS ? 'BOSS ' : ''}${death.segmentLabel}` +
      (death.sincePreviousDeathMs !== null && death.sincePreviousDeathMs < 10000
        ? `   ⚠ ${(death.sincePreviousDeathMs / 1000).toFixed(1)}s after the previous death`
        : ''),
  );
  console.log(
    `    took ${short(death.damageTaken)} in ${death.windowMs / 1000}s, healed ${short(death.healingReceived)}, absorbed ${short(death.absorbed)}`,
  );
  if (death.killingBlow) {
    const kb = death.killingBlow;
    console.log(
      `    killed by ${kb.spellName} from ${kb.sourceName} for ${short(kb.amount)}` +
        (kb.overkill > 0 ? ` (${short(kb.overkill)} overkill)` : '') +
        (kb.critical ? ' CRIT' : ''),
    );
  }
  const first = death.trace[0];
  const last = death.trace[death.trace.length - 1];
  if (first && last) {
    console.log(
      `    health ${(first.fraction * 100).toFixed(0)}% → ${(last.fraction * 100).toFixed(0)}% ` +
        `over ${death.trace.length} samples (${short(first.hpMax)} max)`,
    );
  } else {
    console.log('    no health trace — advanced logging off?');
  }
  for (const ability of death.byAbility.slice(0, 4)) {
    console.log(`      ${short(ability.total).padStart(7)}  ${ability.name} ×${ability.hits} (${ability.sourceName})`);
  }
  if (death.ownCasts.length > 0) {
    console.log(`    they cast: ${death.ownCasts.slice(-5).map((c) => c.name).join(', ')}`);
  } else {
    console.log('    they cast nothing in the window');
  }
}
console.log();

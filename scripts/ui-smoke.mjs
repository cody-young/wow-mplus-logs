#!/usr/bin/env node
/**
 * UI smoke test: render every view against a real log's analysis and assert the
 * output actually contains what it should.
 *
 *   node scripts/ui-smoke.mjs <log> [runIndex]
 */
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import * as esbuild from 'esbuild';

const logPath = process.argv[2];
const runIndex = Number(process.argv[3] ?? 0);
if (!logPath) {
  console.error('usage: node scripts/ui-smoke.mjs <log> [runIndex]');
  process.exit(2);
}

// The bundle must live inside the project: react-dom/server is CommonJS and
// does a dynamic require of node builtins, so it has to stay external and be
// resolved from the project's own node_modules.
const outFile = fileURLToPath(new URL('../apps/desktop/test/.ui-smoke.bundle.mjs', import.meta.url));
await esbuild.build({
  entryPoints: [fileURLToPath(new URL('../apps/desktop/test/ui-smoke.tsx', import.meta.url))],
  bundle: true,
  outfile: outFile,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  target: 'node22',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});

// Loaded through the real main-process module so the smoke test exercises the
// icon lookup too: on a machine with MDT beside the log the dungeon art
// resolves, and on one without it the initials path does. The counts
// themselves are compiled in and render either way.
const { loadForces } = await import(new URL('../apps/desktop/out/main/forces.js', import.meta.url));
const { table: forces, iconsFrom, mdt } = await loadForces(logPath);
console.log(
  `\n  (${forces.dungeons.length} dungeons from ${forces.source}` +
    (iconsFrom === null
      ? '; no Mythic Dungeon Tools beside this log, so no dungeon icons)'
      : `; icons from ${iconsFrom})`),
);

const analysis = await new Promise((resolve, reject) => {
  const worker = new Worker(new URL('../apps/desktop/out/main/parse-worker.js', import.meta.url));
  const found = new Map();
  worker.on('message', (event) => {
    if (event.type === 'analysis') found.set(event.analysis.runId, event.analysis);
    else if (event.type === 'failed') reject(new Error(event.message));
    else if (event.type === 'done') {
      void worker.terminate();
      const list = [...found.values()];
      if (list[runIndex] === undefined) reject(new Error(`no run at index ${runIndex}`));
      else resolve(list[runIndex]);
    }
  });
  worker.on('error', reject);
  worker.postMessage({ type: 'open', path: logPath, tail: false, forces, mdt });
});

const { render, partyOf, wipeCutoff, pullSummary } = await import(outFile);
rmSync(outFile, { force: true });
const views = render(analysis);

/** The words the panel puts on a whiff. Kept in step with InterruptsPanel. */
const REASON_LABELS = [
  'doubled up',
  'cast carried on',
  'a beat late',
  'a beat early',
  'missed',
  'nothing to stop',
];

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const raid = analysis.meta.kind === 'raid';
/** What every share heading and the run row must name: the dungeon, or the boss. */
const runName = raid ? analysis.meta.encounterName : analysis.meta.zoneName;
const runLabel = raid
  ? `${analysis.meta.encounterName} pull ${analysis.meta.pull} (${analysis.meta.success ? 'kill' : 'wipe'})`
  : `+${analysis.meta.keystoneLevel} ${analysis.meta.zoneName}`;
console.log(`\n${runLabel} — rendering ${Object.keys(views).length} views\n`);
for (const [name, html] of Object.entries(views)) {
  console.log(`  ${name.padEnd(15)} ${String(html.length).padStart(7)} bytes`);
}
console.log();

// A raid pull reset before anyone attacked has no damage at all.
const top = analysis.damage.actors[0];
const topPlayer = top?.name.split('-')[0];
const topSpell = top?.spells[0]?.name;
const firstSegmentLabel = analysis.segments[0]?.label ?? '';

if (top !== undefined) {
  check('damage table names the top player', views.damage.includes(topPlayer));
  check('damage table is collapsed by default (no spell rows)', !views.damage.includes(topSpell));
} else {
  console.log('  (nobody did damage; damage table assertions skipped)');
}
// `class="block` alone would also catch the spans inside a block — the tally,
// its share — so the class has to end here: `block"` or `block boss`.
const blocks = (views.timeline.match(/class="block[ "]/g) ?? []).length;
check('timeline renders every segment', blocks === analysis.segments.length,
  `${blocks} blocks vs ${analysis.segments.length} segments`);
check('timeline labels a segment', views.timeline.includes(escapeHtml(firstSegmentLabel)) || firstSegmentLabel.length > 30);

// Segments overlap in time — a pack dragged into a boss, a straggler finished
// after the next pull opened, a pack re-engaged after a wipe. Lanes are packed
// into rows so two of them never draw over each other.
const laneBlocks = views.timeline
  .split('class="lane"')
  .slice(1)
  .map((lane) =>
    [...lane.matchAll(/class="block[^"]*"\s+style="([^"]*)"/g)].map(([, style]) => ({
      left: Number(/left:([\d.]+)%/.exec(style)?.[1] ?? NaN),
      width: Number(/width:([\d.]+)%/.exec(style)?.[1] ?? NaN),
      top: Number(/top:(\d+)px/.exec(style)?.[1] ?? NaN),
    })),
  );
const collision = laneBlocks.flatMap((lane) =>
  lane.flatMap((a, i) =>
    lane.slice(i + 1).filter(
      (b) => a.top === b.top && a.left < b.left + b.width && b.left < a.left + a.width,
    ).map((b) => `${a.left.toFixed(2)}+${a.width.toFixed(2)}% vs ${b.left.toFixed(2)}+${b.width.toFixed(2)}% at top ${a.top}`),
  ),
);
check('timeline blocks are geometrically positioned', laneBlocks.flat().length === analysis.segments.length &&
  laneBlocks.flat().every((b) => Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.top)),
  JSON.stringify(laneBlocks.flat().slice(0, 3)));
check('overlapping segments are packed onto separate rows', collision.length === 0, collision.slice(0, 3).join('; '));
const rows = new Set(laneBlocks.flat().map((b) => b.top));
console.log(`  (timeline rows in use: ${[...rows].sort((a, b) => a - b).join('px, ')}px)`);
// Expanded, every ability row carries the same gauge as the player row above
// it, scaled to that player's own biggest ability — so the top ability of the
// top player is a full-width bar, and nothing is wider than full width.
const spellBars = [...views.expandedDamage.matchAll(/class="bar"\s+style="width:\s*([\d.]+)%/g)]
  .map(([, width]) => Number(width));
const expandedSpellRows = analysis.damage.actors.reduce((n, a) => n + Math.min(a.spells.length, 25), 0);
if (topSpell !== undefined) {
  check('expanded damage names the top ability', views.expandedDamage.includes(escapeHtml(topSpell)));
}
check('every ability row has a bar, on top of every player bar',
  spellBars.length === expandedSpellRows + analysis.damage.actors.length,
  `${spellBars.length} bars vs ${expandedSpellRows} ability + ${analysis.damage.actors.length} player rows`);
check('ability bars are real percentages within range',
  spellBars.length > 0 && spellBars.every((w) => Number.isFinite(w) && w >= 0 && w <= 100),
  JSON.stringify(spellBars.slice(0, 5)));
const fullBars = spellBars.filter((w) => w === 100).length;
check('each player\'s biggest ability fills its bar',
  fullBars >= analysis.damage.actors.filter((a) => a.spells.length > 0).length,
  `${fullBars} full-width bars for ${analysis.damage.actors.length} players`);
// The tip is a hover artefact: it must not be in the markup, and the rows it
// replaces must not have grown a native title either.
check('ability rows carry no native title tooltip', !/class="spell"[^>]*title=/.test(views.expandedDamage));
check('no tip is rendered until something is hovered', !views.expandedDamage.includes('class="tip"'));
check('damage taken names an ability source', views.taken.includes('Melee') || views.taken.length > 500);
check('expanded damage taken names the enemy behind an ability',
  analysis.taken.actors.every((a) => a.spells.length === 0) ||
    analysis.taken.actors.some((a) => a.spells.some((s) => s.topSourceName !== '' && views.expandedTaken.includes(escapeHtml(s.topSourceName)))));
check('healing view renders HPS header', views.healing.includes('HPS'));
check('no NaN leaked into any view', Object.values(views).every((html) => !html.includes('NaN')));
check('no "undefined" leaked into any view', Object.values(views).every((html) => !html.includes('>undefined')));
check('empty deaths view says so', views.emptyDeaths.includes('No deaths'));
check('empty damage view says so', views.emptyDamage.includes('Nothing recorded'));
check('segment-filtered damage renders', views.segmentDamage.length > 200);

const widest = analysis.segments.reduce((best, s) => (s.roster.length > best.roster.length ? s : best), analysis.segments[0]);
check('roster names its segment', views.roster.includes(escapeHtml(widest.label)) || widest.label.length > 30);
check('roster counts the enemies', views.roster.includes(`${widest.enemies.length.toLocaleString('en-US')} enem`),
  views.roster);
check('roster is collapsed by default (no table)', !views.roster.includes('<table'));
check('roster totals reconcile with the enemy list',
  widest.roster.reduce((n, group) => n + group.spawns, 0) === widest.enemies.length,
  `${widest.roster.reduce((n, g) => n + g.spawns, 0)} grouped vs ${widest.enemies.length} enemies`);
check('no group reports more kills than spawns',
  widest.roster.every((group) => group.killed <= group.spawns));
check('empty roster renders without a table', views.emptyRoster.includes('0 enemies'));
// +1 for the header row.
// Header row, one per creature, plus a totals row when there are counts to total.
const rosterRows = widest.roster.length + 1 + (analysis.forces.known ? 1 : 0);
check('expanded roster has a row per creature', countOf(views.rosterTable, '<tr>') === rosterRows,
  `${countOf(views.rosterTable, '<tr>')} rows vs ${rosterRows} expected`);
check('expanded roster names every creature',
  widest.roster.every((group) => views.rosterTable.includes(escapeHtml(group.name))));
// The footnote mentions Max HP either way, so the header is what to look at.
check('expanded roster drops the health columns when nothing was recorded',
  !views.rosterNoHealth.includes('<th>Max HP</th>') && views.rosterTable.includes('<th>Max HP</th>'));
check('summons are labelled as summons',
  widest.roster.every((g) => !g.summon) || views.rosterTable.includes('>summon<'));
console.log(`  (widest pull: ${widest.label} — ${widest.roster.map((g) => `${g.name} x${g.spawns}${g.summon ? ' [summon]' : ''}`).join(', ')})`);

// --- Updates -----------------------------------------------------------------
// The strip is the only part of the UI that shows state nobody can reach on
// demand: you cannot make a release fail to download to see what that looks
// like.
check('the version is always on show', views.updateIdle.includes('v0.1.2'));
check('an idle strip offers a check and nothing else',
  views.updateIdle.includes('Check for updates') && !views.updateIdle.includes('update-banner'));
check('a check in flight says so instead of offering another',
  views.updateChecking.includes('Checking') && !views.updateChecking.includes('Check for updates'));
check('being current is stated, not banner-ed',
  views.updateCurrent.includes('Up to date') && !views.updateCurrent.includes('update-banner'));
check('an available update names the version and its size',
  views.updateAvailable.includes('Version 0.1.3') && views.updateAvailable.includes('108.0 MB download'),
  views.updateAvailable);
check('release notes stay in the tooltip', views.updateAvailable.includes('title="Fixes the count column."'));
check('a feed with no size still offers the download',
  views.updateAvailableNoSize.includes('Ready to download') &&
    views.updateAvailableNoSize.includes('>Download</button>'));
check('a build that cannot update itself offers no Download',
  !views.updateNotify.includes('>Download</button>') && views.updateNotify.includes('releases page'));
check('a download in progress renders a real percentage bar',
  /class="progress"><div style="width:42\.5%"/.test(views.updateDownloading),
  views.updateDownloading);
check('a download in progress shows its rate', views.updateDownloading.includes('43% \u00b7 2.5 MB/s'),
  views.updateDownloading);
check('a staged update says when it installs',
  views.updateReady.includes('0.1.3 is ready') && views.updateReady.includes('when you quit'));
check('a failed check shows the reason and a way to retry',
  views.updateFailed.includes('ERR_NAME_NOT_RESOLVED') && views.updateFailed.includes('Try again'));
check('a dev run renders no update strip at all', views.updateDev === '');
check('the automatic-check box reflects the setting',
  countOf(views.updateIdle, 'type="checkbox" checked') === 1, views.updateIdle);

// --- Enemy forces ------------------------------------------------------------
check('the count columns appear only with a forces table',
  analysis.forces.known
    ? views.rosterTable.includes('<th title="Enemy forces earned: the per-kill value times kills">Count</th>')
    : !views.rosterTable.includes('>Count</th>'),
  `forces.known=${analysis.forces.known}`);
check('a run with no forces table renders no count columns',
  !views.rosterNoForces.includes('>Count</th>') &&
    views.rosterNoForces.includes('has no entry for this'));
check('run forces are the sum over segments',
  analysis.forces.counted === analysis.segments.reduce((n, s) => n + s.forces, 0),
  `${analysis.forces.counted} vs ${analysis.segments.reduce((n, s) => n + s.forces, 0)}`);
if (analysis.forces.known) {
  check('the timeline header shows count out of the requirement',
    views.timeline.includes(`${analysis.forces.counted.toLocaleString('en-US')}/${analysis.forces.required.toLocaleString('en-US')} count`),
    views.timeline.slice(0, 400));
  check('counted forces do not exceed what the dungeon requires by much',
    analysis.forces.counted <= analysis.forces.required * 1.5,
    `${analysis.forces.counted} of ${analysis.forces.required}`);
  console.log(`  (count: ${analysis.forces.counted}/${analysis.forces.required} — ${analysis.forces.dungeon}, ${analysis.forces.source})`);
}

if (analysis.deaths.length > 0) {
  // The list reads newest first and opens on the newest, so the death every
  // recap assertion below is about is the last one of the key.
  const death = analysis.deaths[analysis.deaths.length - 1];
  // Every death, latest at the top, with that one already open — the clock on
  // each item has to run backwards down the list, and the selected item has to
  // be the first one.
  const listTimes = views.deaths.split('class="death-item').slice(1)
    .map((item) => /(\d+:\d\d)/.exec(item)?.[1] ?? '');
  check('the death list holds every death, newest first, open on the newest',
    listTimes.length === analysis.deaths.length &&
      listTimes.every((time, index) => index === 0 || time <= listTimes[index - 1]) &&
      views.deaths.indexOf('class="death-item selected"') ===
        views.deaths.indexOf('class="death-item'),
    `${listTimes.join(' ')} — selected at ${views.deaths.indexOf('class="death-item selected"')}`);
  check('deaths view names the victim', views.deaths.includes(death.name.split('-')[0]));
  check('deaths view names the killing blow',
    death.killingBlow === null || views.deaths.includes(escapeHtml(death.killingBlow.spellName)));
  // The health trace was removed from this view; the second-by-second chart
  // below is what carries the shape of a death now. `HpTrace` still exists as
  // a component with no caller, so there is nothing here to assert on.
  check('death recap renders the second-by-second chart',
    countOf(views.deaths, 'class="dt-row') === Math.round(death.windowMs / 1000) ||
      death.incoming.length + death.healsReceived.length === 0,
    `${countOf(views.deaths, 'class="dt-row')} rows for a ${death.windowMs / 1000}s window`);
  check('death recap bars every incoming hit it has room for',
    countOf(views.deaths, 'class="dt-bar') > 0 || death.incoming.length === 0);
  // Newest at the top. The death is why the recap was opened, so it has to be
  // the first row rather than the fortieth, and time counts backwards from it.
  // A row is labelled by the second it ends on, so the row the killing blow
  // lands in is 0 and the one before it is \u22121 \u2014 a chart of a death whose
  // rows begin at \u22121 has nowhere to put the death. That row then shows a
  // skull rather than its own numbers, so the labels left to read start at \u22121.
  const rowSeconds = [...views.deaths.matchAll(/class="sec">(\u2212?[\d.]+)</g)]
    .map(([, text]) => (text.startsWith('\u2212') ? -Number(text.slice(1)) : Number(text)));
  check('death recap puts the death row first and counts backwards from it',
    rowSeconds.length > 0 &&
      rowSeconds.every((value, index) => index === 0 || value < rowSeconds[index - 1]) &&
      views.deaths.indexOf('class="dt-row') === views.deaths.indexOf('class="dt-row death"'),
    `row labels read ${rowSeconds.join(' ')}`);
  // The death row's 0 and 0% are the two numbers in the chart that say nothing:
  // the second is 0 because the death defines it, the health 0 because they
  // died. A skull stands in for both. End-labelling is still what is under
  // test \u2014 labelled by their start the visible rows would run \u22122 to \u221210.
  check('the row the death falls in carries a skull, not a 0 and a 0%',
    countOf(views.deaths, 'class="dt-skull"') === 1 &&
      !views.deaths.includes('class="sec">0<') &&
      rowSeconds[0] === -1 &&
      rowSeconds[rowSeconds.length - 1] === -(death.windowMs / 1000 - 1),
    `${countOf(views.deaths, 'class="dt-skull"')} skulls, labels run ${rowSeconds[0]} to ${rowSeconds[rowSeconds.length - 1]}`);
  // The two rules that separate the centre column from the bars are drawn on
  // the row box, not on each row, so they run unbroken past the row gaps.
  check('the centre column is ruled off from the bars',
    countOf(views.deaths, 'class="dt-stack"') === 1);
  // The health column holds its cell open on every row it has, trace or no
  // trace: a row that drops the cell shunts the bars either side of it
  // sideways. The death row is the exception, and only because the skull
  // replaces the whole pair rather than half of it.
  check('death recap carries a health cell on every row but the death',
    countOf(views.deaths, 'class="dt-hp') === countOf(views.deaths, 'class="dt-row') - 1,
    `${countOf(views.deaths, 'class="dt-hp')} health cells for ${countOf(views.deaths, 'class="dt-row')} rows`);
  check('death recap reads out the health beside each second',
    /class="dt-hp"[^>]*aria-label="\d+% health"/.test(views.deaths) ||
      death.trace.every((sample) => sample.fraction < 0),
    views.deaths.slice(views.deaths.indexOf('dt-hp') - 200, views.deaths.indexOf('dt-hp') + 120));
  // Zooming in is the only way to tell a two-hit overlap from one huge hit, so
  // the control has to be there, and exactly one of its lengths selected.
  check('death recap offers finer row lengths with one of them selected',
    countOf(views.deaths, 'aria-pressed="true"') === 1 &&
      views.deaths.includes('>.5s<') && views.deaths.includes('>.25s<'),
    views.deaths.slice(views.deaths.indexOf('dt-zoom'), views.deaths.indexOf('dt-zoom') + 420));
  // Zoomed in, every row has to split rather than the window shrinking: the
  // same ten seconds, four times the rows, and labels carrying the quarters.
  check('zooming the death recap splits the same window into more rows',
    countOf(views.deathZoomed, 'class="dt-row') === Math.round(death.windowMs / 250) ||
      views.deathZoomed === '',
    `${countOf(views.deathZoomed, 'class="dt-row')} rows at .25s for a ${death.windowMs / 1000}s window`);
  // Reversing the rows must not take the health column with it: the walk over
  // the trace runs forwards, so the top row — the death — has to carry the last
  // health the log recorded, not the first.
  // The death row carries a skull now, so the topmost health cell belongs to
  // the row ending a second before it. Walked the wrong way that cell would
  // hold the health at the far end of the window instead, which is the bug.
  const asPercent = (sample) => (sample.hp > 0 ? Math.max(1, Math.round(sample.fraction * 100)) : 0);
  const nearDeath = [...death.trace]
    .reverse()
    .find((sample) => sample.fraction >= 0 && sample.ts <= death.ts - 1000);
  const topHp = /class="dt-hp"[^>]*aria-label="(\d+)% health"/.exec(views.deaths)?.[1];
  check('the health column survives the row order being flipped',
    nearDeath === undefined || topHp === String(asPercent(nearDeath)),
    `top health cell reads ${topHp}%, the trace reads ${nearDeath === undefined ? 'nothing' : asPercent(nearDeath) + '%'} a second before the death`);
  check('zoomed row labels carry the quarter seconds, with the skull on the death',
    views.deathZoomed === '' ||
      (views.deathZoomed.includes('\u2212' + (death.windowMs / 1000 - 0.25).toFixed(2)) &&
        views.deathZoomed.includes('class="sec">\u22120.25<') &&
        !views.deathZoomed.includes('class="sec">0.00<') &&
        countOf(views.deathZoomed, 'class="dt-skull"') === 1),
    views.deathZoomed.slice(0, 400));
  check('the zoomed recap still bars and still shows health',
    views.deathZoomed === '' ||
      (countOf(views.deathZoomed, 'class="dt-hp') === countOf(views.deathZoomed, 'class="dt-row') - 1 &&
        !/width:\s*(NaN|Infinity|-)/.test(views.deathZoomed)));
  // The second and the health it ended on share one cell: a time without its
  // health is half a reading, and two cells put a gutter through the column
  // that is meant to be scanned as a pair.
  check('the second and the health are one cell',
    countOf(views.deaths, 'class="dt-mid"') === countOf(views.deaths, 'class="dt-row') &&
      countOf(views.deaths, 'class="dt-mid"') === countOf(views.deaths, 'class="sec"') + 1,
    `${countOf(views.deaths, 'class="dt-mid"')} centre cells, ${countOf(views.deaths, 'class="sec"')} seconds, ${countOf(views.deaths, 'class="dt-row')} rows`);
  // Both totals sit between the centre cell and the bars, so the row reads
  // outwards: what it left them on, how much it was, then what it was made of.
  check('each row carries a total on either side of the centre',
    countOf(views.deaths, 'class="dt-total"') === countOf(views.deaths, 'class="dt-row') * 2);

  // A bar wide enough to hold its own figure carries it, so the big hits can
  // be read without hovering. Every figure must be one the analysis reported.
  const figures = [...views.deaths.matchAll(/class="dt-fig">([^<]+)</g)].map(([, text]) => text);
  check('wide bars carry their own figure',
    figures.length > 0 || death.incoming.length === 0,
    `${figures.length} figures over ${countOf(views.deaths, 'class="dt-bar ') + countOf(views.deaths, 'class="dt-bar"')} bars`);
  check('a figure is a number, with an asterisk only for a crit',
    figures.every((text) => /^[\d.]+[KMB]?\*?$/.test(text)), figures.join(' '));
  // The asterisk marks a crit, and marks nothing else: a 400K hit and a 400K
  // hit that could have been 200K are different problems.
  const critInView = death.incoming.some(
    (hit) => hit.critical && hit.amount > 0 && hit.ts >= death.ts - death.windowMs,
  );
  check('an asterisk appears exactly where something crit',
    critInView === figures.some((text) => text.endsWith('*')),
    `${critInView ? 'a crit landed' : 'nothing crit'}, figures read ${figures.join(' ')}`);

  // The aura lanes. They keep their width with nothing in them, because a
  // chart whose bars shift sideways between deaths cannot be compared across
  // them — so the headings are there either way and only the spans vary.
  check('the recap has a lane at either edge',
    views.deaths.includes('class="dt-lane left"') && views.deaths.includes('class="dt-lane right"'));
  check('the lanes are labelled',
    views.deaths.includes('>Debuffs<') && views.deaths.includes('>Defensives<'));
  const spanStyles = [...views.deaths.matchAll(/class="dt-span[^"]*" style="top:([\d.]+)%;height:([\d.]+)%/g)]
    .map(([, top, height]) => ({ top: Number(top), height: Number(height) }));
  // Buffs are narrowed to the ones that do something about damage. A real key
  // puts well over a hundred distinct buffs on the party, and a lane carrying
  // food, procs and weapon imbues answers no question a death recap asks.
  const visibleAuras = death.auras.filter(
    (aura) =>
      (!aura.buff || aura.defensive) &&
      !aura.bookkeeping &&
      !(aura.openStart && aura.openEnd) &&
      aura.endTs > death.ts - death.windowMs &&
      aura.startTs < death.ts,
  );
  check('every defensive and every debuff overlapping the view is a span',
    spanStyles.length === visibleAuras.length,
    `${spanStyles.length} spans for ${visibleAuras.length} auras`);
  // The narrowing is the point, so it is asserted rather than assumed: a buff
  // the table does not call a defensive must not reach the lane. Named, because
  // a count that happens to match proves nothing about which ones got through.
  const droppedBuffs = death.auras.filter(
    (aura) =>
      aura.buff &&
      !aura.defensive &&
      !(aura.openStart && aura.openEnd) &&
      aura.endTs > death.ts - death.windowMs &&
      aura.startTs < death.ts,
  );
  // By name, which two auras can share: Guardian of Ancient Kings is the
  // defensive (86659) and also a buff of its own (393108). A name a shown
  // defensive carries proves nothing about the dropped one.
  const shownNames = new Set(visibleAuras.map((aura) => aura.spellName));
  const leaked = droppedBuffs.filter(
    (aura) => !shownNames.has(aura.spellName) && views.deaths.includes(`aria-label="${escapeHtml(aura.spellName)},`),
  );
  check('the defensives lane drops the buffs that do nothing about damage', leaked.length === 0,
    `leaked: ${leaked.map((aura) => `${aura.spellName} ${aura.spellId}`).join(', ')}`);
  // The same, for the other lane: a note the player wrote on themselves —
  // Sated, Hypothermia, a spent gateway — is not a thing that happened to them.
  const droppedNotes = death.auras.filter(
    (aura) =>
      aura.bookkeeping &&
      !(aura.openStart && aura.openEnd) &&
      aura.endTs > death.ts - death.windowMs &&
      aura.startTs < death.ts,
  );
  check("the debuff lane drops the game's notes to itself",
    droppedNotes.every((aura) => !views.deaths.includes(`aria-label="${escapeHtml(aura.spellName)},`)),
    `${droppedNotes.length} dropped: ${droppedNotes.map((aura) => aura.spellName).join(', ') || 'none in this window'}`);
  check('aura spans are positioned by time and stay inside the lane',
    spanStyles.every((s) => s.top >= 0 && s.height >= 0 && s.top + s.height <= 100.01),
    JSON.stringify(spanStyles.slice(0, 4)));
  // An aura still up at the death reaches the top of the lane, because the top
  // of the lane is the death.
  check('an aura that never came off reaches the death row',
    visibleAuras.every((aura) => !aura.openEnd) ||
      spanStyles.some((s) => s.top === 0),
    JSON.stringify(spanStyles.slice(0, 4)));
  // A clamped span must never be described by its clamped length: that is the
  // length of the window, and it is a number somebody would quote.
  check('an aura clamped by the window does not claim a duration',
    visibleAuras.every((aura) => !aura.openStart) ||
      /aria-label="[^"]*already up/.test(views.deaths),
    views.deaths.slice(views.deaths.indexOf('dt-span'), views.deaths.indexOf('dt-span') + 300));

  // The scrubber slides the ten-second view back through the captured span.
  check('the recap offers a scrubber over the captured span',
    death.scrollbackMs === death.windowMs ||
      views.deaths.includes(`max="${death.scrollbackMs - death.windowMs}"`),
    views.deaths.slice(views.deaths.indexOf('dt-scrub'), views.deaths.indexOf('dt-scrub') + 300));
  check('the scrubber opens at the death, with no way back from there',
    views.deaths.includes(`value="${death.scrollbackMs - death.windowMs}"`) &&
      /title="Back to the death">death<\/button>/.test(views.deaths) &&
      views.deaths.includes('disabled=""'));
  check('the scrubber names the seconds it is showing',
    views.deaths.includes(`\u2212${death.windowMs / 1000}s`));

  check('death recap shows the healing side',
    death.healsReceived.length === 0
      ? views.deaths.includes('No healing landed')
      : views.deaths.includes('Healing received'));
  // Out of the summary window, not out of the capture: the panel groups the
  // heals the totals describe, and the list reaches three times further back.
  // Asserting on the first heal in the list fails whenever the oldest one
  // captured is older than the ten seconds shown.
  const shownHeal = death.healsReceived.find(
    (heal) => heal.amount > 0 && heal.ts >= death.ts - death.windowMs,
  );
  check('death recap names a heal the player actually got',
    shownHeal === undefined || views.deaths.includes(escapeHtml(shownHeal.spellName)),
    `${death.healsReceived.length} heals captured, first shown ${shownHeal?.spellName ?? 'none'}`);
  // Most recent first, like the death list beside it and the timeline above it.
  // Only a press chip carries a time, so these are the presses and nothing
  // else; newest first means the seconds-before-death run upwards.
  const pressAges = [...views.deaths.matchAll(
    /class="chip">[^<]*<span[^>]*>\s*\u2212(?:<!-- -->)?([\d.]+)(?:<!-- -->)?s</g,
  )].map(([, age]) => Number(age));
  check('the press chips read newest first',
    pressAges.length === death.ownCasts.length &&
      pressAges.every((age, index) => index === 0 || age >= pressAges[index - 1]),
    `${pressAges.length} chips for ${death.ownCasts.length} presses: ${pressAges.join(' ')}`);
  check('death recap bar widths are real percentages',
    !/width:\s*(NaN|Infinity|-)/.test(views.deaths));
  // The native title tooltip was replaced by the chart's own, so a bar must
  // carry its detail as an aria-label and must not also carry a title: two
  // tooltips on one element is the bug that change was meant to remove.
  check('death recap bars describe themselves without a native title',
    /class="dt-bar[^"]*"[^>]*aria-label="[^"]+"/.test(views.deaths) &&
      !/class="dt-bar[^"]*"[^>]*title=/.test(views.deaths));
  // "absorbed 424K" does not say whether that was the healer, a defensive or a
  // trinket, which is the only reason to look at it.
  // Only one the recap draws: the list reaches back through the whole
  // scrollback, and the first view is the last `windowMs` of it.
  const shownAbsorb = death.absorbsReceived.find((a) => a.amount > 0 && a.ts >= death.ts - death.windowMs);
  check('death recap names the shield behind an absorb',
    shownAbsorb === undefined || views.deaths.includes(escapeHtml(shownAbsorb.spellName)),
    death.absorbsReceived.map((a) => `${a.spellName} ${a.amount}`).slice(0, 3).join(', '));
  // Icons resolve through the preload bridge, which does not exist in a server
  // render. Every view must survive that with no icon at all.
  check('death recap renders with no icons available',
    !views.deaths.includes('src=""') && !views.deaths.includes('src="undefined"'));
} else {
  console.log('  (run had no deaths; death view assertions skipped)');
}

// --- Interrupts --------------------------------------------------------------
check('empty interrupts view says so', views.emptyInterrupts.includes('No interrupts'));
const pressed = analysis.interrupts.attempts;
if (pressed.length > 0) {
  const stopped = pressed.filter((attempt) => attempt.stops > 0);
  check('interrupts view names a player who pressed one',
    views.interrupts.includes(pressed[0].name.split('-')[0]));
  check('interrupts view is collapsed by default (no press log)',
    !views.interrupts.includes('interrupt-log'));
  check('the press log holds every press, once',
    countOf(views.interruptLog, 'class="spell"') === pressed.length,
    `${countOf(views.interruptLog, 'class="spell"')} rows for ${pressed.length} presses`);
  // The whole point of the tab: a press that stopped nothing is in the log
  // with a reason, and the log never reports it at all.
  check('a press that stopped nothing is in the log with a reason',
    pressed.length === stopped.length ||
      REASON_LABELS.some((label) => text(views.interruptLog).includes(label)),
    text(views.interruptLog).slice(0, 400));
  // Most recent at the top, like every other list in the app. The log is one
  // table per player, so time runs backwards inside each block and steps
  // forward once at each player boundary — never more often than that.
  const logTimes = [...views.interruptLog.matchAll(/<tr class="spell"><td class="left">([^<]*)</g)]
    .map((match) => match[1]);
  const players = new Set(pressed.map((attempt) => attempt.actorIndex)).size;
  const forwards = logTimes.filter((time, index) => index > 0 && time > logTimes[index - 1]).length;
  check('the press log reads newest first',
    logTimes.length === pressed.length && forwards <= players - 1,
    `${logTimes.length} times, ${forwards} forward steps, ${players} players`);
  check('interrupts view names a cast that was stopped',
    stopped.length === 0 || views.interrupts.includes(escapeHtml(stopped[0].castSpellName)));
  check('every press names its target',
    pressed.every((attempt) => attempt.targetName === '' ||
      views.interruptLog.includes(escapeHtml(attempt.targetName))));
  // Whiff chips are explained by a native title, which is the one place in
  // these views that is deliberate: the reasons need a sentence each.
  check('every whiff chip explains itself',
    !views.interrupts.includes('class="chip"') ||
      /class="chip" title="[^"]+"/.test(views.interrupts));
  check('a key where nothing landed is still explained',
    views.allWhiffedInterrupts.includes('nothing to stop') &&
      views.allWhiffedInterrupts.includes('nothing stopped by any of them'));
  check('interrupts view renders with no icons available',
    !views.interrupts.includes('src=""') && !views.interruptLog.includes('src="undefined"'));
  const landed = pressed.filter((attempt) => attempt.stops > 0).length;
  console.log(
    `  (interrupts: ${pressed.length} pressed, ${analysis.interrupts.stops.length} casts stopped, ` +
      `${pressed.length - landed} stopped nothing)`,
  );
} else {
  console.log('  (nobody pressed an interrupt; interrupt view assertions skipped)');
}

// --- Crowd control -----------------------------------------------------------
check('empty control view says so', views.emptyControl.includes('No crowd control'));
const controlled = analysis.control.applications;
if (controlled.length > 0) {
  check('control view names a player who pressed some',
    views.control.includes(controlled[0].name.split('-')[0]));
  check('control view is collapsed by default (no application log)',
    !views.control.includes('interrupt-log'));
  check('the application log holds every application, once',
    countOf(views.controlLog, 'class="spell"') === controlled.length,
    `${countOf(views.controlLog, 'class="spell"')} rows for ${controlled.length} applications`);
  // The three numbers the tab exists for, and the invariant between two of
  // them: one press of an area control catches several enemies, so there can
  // never be fewer targets than casts.
  check('every press caught at least one target',
    analysis.control.casts <= controlled.length,
    `${analysis.control.casts} casts, ${controlled.length} targets`);
  check('every application names its target',
    controlled.every((entry) => entry.targetName === '' ||
      views.controlLog.includes(escapeHtml(entry.targetName))));
  check('every application says how long it was held',
    countOf(views.controlLog, 's</td>') >= controlled.length,
    `${countOf(views.controlLog, 's</td>')} durations for ${controlled.length} applications`);
  // The same deliberate exception as the whiff chips: each ending needs a
  // sentence, so the chips carry a native title.
  check('every ending chip explains itself',
    !views.control.includes('class="chip"') ||
      /class="chip" title="[^"]+"/.test(views.control));
  check('control view renders with no icons available',
    !views.control.includes('src=""') && !views.controlLog.includes('src="undefined"'));
  const broken = controlled.filter((entry) => entry.end === 'broken').length;
  const ms = controlled.reduce((total, entry) => total + entry.durationMs, 0);
  console.log(
    `  (control: ${analysis.control.casts} casts, ${controlled.length} targets, ` +
      `${(ms / 1000).toFixed(0)}s held, ${broken} broken early)`,
  );
} else {
  console.log('  (nobody pressed any control; control view assertions skipped)');
}

// --- Stats and awards ---------------------------------------------------------
check('stats view has a card for totems, falls and the biggest hit',
  countOf(views.stats, 'class="stat-card"') === 3,
  `${countOf(views.stats, 'class="stat-card"')} cards`);
if (!analysis.live) {
  check('a finished key opens its awards on the podium', views.stats.includes('class="podium"'));
  check('the share text names an MVP', /\nMVP: /.test(views.shareStats));
  const picked = JSON.parse(views.awards);
  check('a key hands out at most six badges', picked.keys.length <= 6, picked.keys.join(', '));
  check('the shelf shows every badge picked',
    countOf(views.stats, 'class="badge-card') === picked.keys.length,
    `${countOf(views.stats, 'class="badge-card')} cards for ${picked.keys.length} badges`);
  check('only a dps is ever the Lifeguard', !picked.lifeguardNotDps);
  check('a runaway name goes to one winner, never a tie', !picked.gappedShared, picked.titles.join(', '));
}
console.log(`  (stats share:\n${views.shareStats.split('\n').map((line) => `    ${line}`).join('\n')})`);

// --- Auras -------------------------------------------------------------------
{
  const first = partyOf(analysis)[0]?.actorIndex;
  const worn = analysis.auras.auras.filter((entry) => entry.actorIndex === first);
  check('auras view has a button per party member',
    countOf(views.auras, 'class="aura-member') === analysis.meta.party.length,
    `${countOf(views.auras, 'class="aura-member')} for ${analysis.meta.party.length}`);
  check('auras view has a buffs and a debuffs section',
    countOf(views.auras, 'class="dispel-section"') === 2);
  check('the first player wore some auras', worn.length > 0, `${worn.length}`);
  check('every span in the report is ordered and inside the key',
    analysis.auras.auras.every((entry) => entry.spans.every((ts, i, all) =>
      ts >= 0 && ts <= analysis.damage.durationMs + 1 && (i === 0 || ts >= all[i - 1]))));
  check('aura share lines fit in chat', views.shareAuras.split('\n').every((line) => line.length <= 255));
}
console.log(`  (auras share:\n${views.shareAuras.split('\n').map((line) => `    ${line}`).join('\n')})`);

// --- Dispels -----------------------------------------------------------------
check('empty dispel view says so', views.emptyDispels.includes('No dispels'));
const removed = analysis.dispels.dispels;
if (removed.length > 0) {
  check('dispel view names a player who dispelled something',
    views.dispels.includes(removed[0].name.split('-')[0]));
  // One aggregate section and one per kind, even when a kind is empty: the
  // sections are the layout, not a list of what happened.
  check('dispel view has the aggregate and all three kind sections',
    countOf(views.dispels, 'class="dispel-section"') === 4,
    `${countOf(views.dispels, 'class="dispel-section"')} sections`);
  const stacked = new Set(removed.map((entry) => entry.actorIndex)).size;
  check('the stacked chart has a row per player who dispelled',
    countOf(views.dispels, 'class="stack"') === stacked,
    `${countOf(views.dispels, 'class="stack"')} stacks for ${stacked} players`);
  check('dispel view is collapsed by default (no removal log)',
    !views.dispels.includes('interrupt-log'));
  check('expanded dispel view lists every removal once, across the three sections',
    countOf(views.dispelLog, 'class="spell"') === removed.length,
    `${countOf(views.dispelLog, 'class="spell"')} rows for ${removed.length} removals`);
  check('dispel casts never exceed removals',
    analysis.dispels.casts <= removed.length,
    `${analysis.dispels.casts} casts, ${removed.length} removals`);
  check('dispel view renders with no icons available',
    !views.dispelLog.includes('src=""') && !views.dispelLog.includes('src="undefined"'));
  const kinds = { purge: 0, soothe: 0, cleanse: 0 };
  for (const entry of removed) kinds[entry.kind]++;
  console.log(
    `  (dispels: ${removed.length} removed in ${analysis.dispels.casts} casts — ` +
      `${kinds.purge} purges, ${kinds.soothe} soothes, ${kinds.cleanse} cleanses)`,
  );
} else {
  console.log('  (nothing was dispelled; dispel view assertions skipped)');
}

// --- Avoidable damage ----------------------------------------------------------
check('a clean key says so', views.emptyAvoidable.includes('No avoidable damage'));
check('an uncovered dungeon does not read as clean',
  views.uncoveredAvoidable.includes('Not on the list') && !views.uncoveredAvoidable.includes('No avoidable damage'));
const stoodIn = analysis.avoidable.hits;
if (!analysis.avoidable.covered) {
  console.log('  (dungeon not on the avoidable list; avoidable view assertions skipped)');
} else if (stoodIn.length > 0) {
  const worst = new Map();
  for (const hit of stoodIn) worst.set(hit.name, (worst.get(hit.name) ?? 0) + hit.amount);
  const top = [...worst.entries()].sort((a, b) => b[1] - a[1])[0][0].split('-')[0];
  check('avoidable view names the worst offender', views.avoidable.includes(top));
  check('avoidable view is collapsed by default (no hit log)', !views.avoidable.includes('interrupt-log'));
  check('expanded avoidable view lists every hit once',
    countOf(views.avoidableLog, 'class="spell"') === stoodIn.length,
    `${countOf(views.avoidableLog, 'class="spell"')} rows for ${stoodIn.length} hits`);
  check('avoidable view renders with no icons available',
    !views.avoidableLog.includes('src=""') && !views.avoidableLog.includes('src="undefined"'));
  check('avoidable share text names the worst offender first',
    views.shareAvoidable.split('\n')[1]?.startsWith(`1. ${top}`), views.shareAvoidable.split('\n')[1]);
  console.log(`  (avoidable: ${stoodIn.length} hits across ${worst.size} players)`);
} else {
  console.log('  (nobody stood in anything; avoidable view assertions skipped)');
}

// --- A raid wipe's deaths ------------------------------------------------------
const cutoff = wipeCutoff(analysis.meta, analysis.deaths);
if (cutoff !== null && cutoff < analysis.deaths.length) {
  const folded = analysis.deaths.length - cutoff;
  const listed = countOf(views.deathsAsShown, 'class="death-item');
  check('a wipe lists the deaths up to a quarter of the raid down', listed === cutoff,
    `${listed} listed, cut at ${cutoff}`);
  check('a wipe folds the rest behind one line that counts them',
    text(views.deathsAsShown).includes(`${folded} more deaths after the raid was wiping`));
  const opened = analysis.deaths[cutoff - 1];
  check('a wipe opens on the last death that mattered, not the last of the wipe',
    views.deathsAsShown.indexOf('class="death-item selected"') === views.deathsAsShown.indexOf('class="death-item') &&
      views.deathsAsShown.includes(escapeHtml(opened.name.split('-')[0])));
  check('the wipe\'s share text leaves the fold out',
    views.shareDeaths.includes(`${folded} more as the raid wiped`), views.shareDeaths);
  console.log(`  (wipe: ${cutoff} of ${analysis.deaths.length} deaths listed, ${opened.name.split('-')[0]} last)`);
} else if (raid) {
  console.log('  (no wipe fold on this pull)');
}

// --- Who pulled ----------------------------------------------------------------
if (raid) {
  const pull = analysis.pull;
  check('a raid pull says who pulled it', pull !== null && views.pull !== '');
  if (pull !== null) {
    const summary = pullSummary(pull, analysis.names);
    check('the pull stat leads with what it found', text(views.pull).startsWith(summary.label), text(views.pull));
    if (summary.actor !== -1) {
      const who = (analysis.names[summary.actor] ?? '?').split('-')[0];
      check('the pull stat names the puller', text(views.pull).includes(escapeHtml(who)), text(views.pull));
    }
    check('every actor the pull report names has a name',
      [...pull.contacts.flatMap((c) => [c.actor, c.enemy]), ...pull.nearest.map((n) => n.actor), ...pull.summons.map((s) => s.actor)]
        .every((index) => analysis.names[index] !== undefined));
    check('the first contact is the earliest', pull.first === null || pull.contacts.every((c) => c.ts >= pull.first.ts));
    console.log(`  (pull: ${summary.label} ${summary.actor === -1 ? '' : analysis.names[summary.actor]} — ${summary.detail})`);
  }
} else {
  check('a key has no who-pulled report', analysis.pull === null);
}

// --- Share text ----------------------------------------------------------------
const shares = Object.entries(views).filter(([name, text]) => name.startsWith('share') && text !== '');
for (const [name, text] of shares) {
  const lines = text.split('\n');
  const long = lines.find((line) => line.length > 255);
  check(`${name} fits chat`, long === undefined, long);
  check(`${name} is headed with the ${raid ? 'pull' : 'key'}`, lines[0].includes(runName), lines[0]);
  check(`${name} carries no markup`, !/[<>]/.test(text));
}
// --- Map -----------------------------------------------------------------------
const partyTracks = analysis.positions.tracks.filter((track) => track.kind === 0);
if (partyTracks.some((track) => track.ts.length > 0)) {
  check('map names every party member', analysis.meta.party.every((index) =>
    views.map.includes(escapeHtml(analysis.names[index]?.split('-')[0] ?? ''))));
  check('map has a replay scrubber', views.map.includes('type="range"'));
  const floors = new Set(partyTracks.flatMap((track) => [...track.uiMapId]));
  check('map offers a tab per floor the party stood on',
    floors.size === 1 || countOf(views.map, 'role="tab"') === floors.size, `${floors.size} floors`);
  check('every engaged enemy has a start point',
    analysis.positions.tracks.every((track) => track.kind === 0 || track.home !== null));
  // MDT's map, when MDT is beside the log: a toggle exactly when a floor fitted.
  const fitted = (analysis.mdt?.floors ?? []).filter((fit) => fit.good);
  check('map offers MDT art exactly when a floor fitted it',
    views.map.includes('MDT map') === fitted.length > 0, `${fitted.length} floors fitted`);
  check('no MDT spawn is claimed by two kills',
    new Set((analysis.mdt?.matches ?? []).map((m) => `${m.enemyIndex}:${m.cloneIndex}`)).size ===
      (analysis.mdt?.matches.length ?? 0));
  console.log(
    analysis.mdt === null
      ? '  (mdt: no map of this dungeon)'
      : `  (mdt: ${analysis.mdt.floors.map((fit) => `${fit.uiMapId} ${fit.matched}/${fit.observed}${fit.good ? '' : ' weak'}`).join(', ')}; ${analysis.mdt.matches.length} kills placed)`,
  );
} else {
  check('map says when there are no positions', views.map.includes('No positions'));
}
check('route share text numbers every pull',
  analysis.segments.length <= 10
    ? analysis.segments.filter((segment) => segment.kind === 0).every((segment) => views.shareRoute.includes(`${segment.pullNumber}. `))
    : views.shareRoute.includes('earlier'));
check('a pull\'s share text names the pull',
  views.shareSegment === '' || views.shareSegment.split('\n')[0].includes(analysis.segments[0].label));
check('uncovered share text says nothing was checked', views.shareUncovered.includes('not on the avoidable list'));

// --- Icons -------------------------------------------------------------------
// Every icon in the app resolves through the preload bridge, which does not
// exist in a server render. So this is the offline case for all of them: the
// boxes must be there, sized and coloured, with no <img> and no broken src.
const specCount = countOf(views.specIcons, 'class="spec-ico"');
check('every spec renders an icon box', specCount === 40, `${specCount} boxes for 40 specs`);
check('spec icon boxes are sized and coloured without art',
  !views.specIcons.includes('<img') &&
    countOf(views.specIcons, 'width:16px') === specCount &&
    countOf(views.specIcons, 'background:#') === specCount,
  views.specIcons.slice(0, 200));
check('every spec icon names its spec for the hover',
  countOf(views.specIcons, 'title="') === specCount);
check('an unknown spec still renders its box', views.unknownSpecIcon.includes('class="spec-ico"'));
check('no icon leaked an empty or undefined src',
  Object.values(views).every((html) => !html.includes('src=""') && !html.includes('src="undefined"')));

// The spec icon replaced the colour swatch beside each player's name, so every
// player row must carry one — this is the assertion that catches the icons
// silently vanishing from the tables.
const playerRows = analysis.damage.actors.length;
check('every player row in the damage table carries a spec icon',
  countOf(views.damage, 'class="spec-ico"') === playerRows,
  `${countOf(views.damage, 'class="spec-ico"')} icons for ${playerRows} players`);
check('the swatch the spec icon replaced is gone', !views.damage.includes('class="swatch"'));
if (analysis.deaths.length > 0) {
  check('every death in the list carries a spec icon',
    countOf(views.deaths, 'class="spec-ico"') >= analysis.deaths.length);
}

// The dungeon icon comes from MDT's teleport spell, so it is present for the
// same users a count is and must degrade to initials for everyone else.
check('the dungeon icon falls back to initials with no teleport spell',
  /class="dungeon-initials">[^<]{1,2}</.test(views.dungeonIconNoMdt) &&
    !views.dungeonIconNoMdt.includes('<img'),
  views.dungeonIconNoMdt);
check('the dungeon icon reserves its box either way',
  countOf(views.dungeonIcon, 'class="dungeon-ico"') === 1 &&
    views.dungeonIcon.includes('width:34px'),
  views.dungeonIcon);
check('the dungeon icon names its dungeon for the hover',
  views.dungeonIcon.includes(`title="${escapeHtml(analysis.meta.zoneName)}"`),
  views.dungeonIcon);
console.log(`  (dungeon icon: teleport spell ${analysis.forces.teleportSpellId || 'none — initials only'})`);

// --- The key selector --------------------------------------------------------
if (raid) {
  const row = text(views.runRow);
  check('the run row names the boss, the difficulty and the pull',
    views.runRow.includes(escapeHtml(analysis.meta.encounterName)) && row.includes(`pull ${analysis.meta.pull}`), row);
  check('the run row says kill or wipe', row.includes(analysis.meta.success ? 'kill' : 'wipe'), row);
  check('the run row counts the raid instead of drawing it',
    row.includes(`${analysis.meta.party.length} players`) && countOf(views.runRow, 'class="spec-ico"') === 0, row);
  check('a live pull says so instead of reporting a result',
    views.runRowLive.includes('in progress') && !/class="(timed|depleted)"/.test(views.runRowLive));
} else {
  const party = partyOf(analysis);
  check('the key selector names the dungeon and the level',
    views.runRow.includes(escapeHtml(analysis.meta.zoneName)) &&
      // A server render separates adjacent text nodes with a comment, so the
      // level reads `+<!-- -->21` in the markup and `+21` on screen.
      text(views.runRow).includes(`+${analysis.meta.keystoneLevel}`),
    text(views.runRow));
  check('the key selector shows one spec icon per party member',
    countOf(views.runRow, 'class="spec-ico"') === party.length,
    `${countOf(views.runRow, 'class="spec-ico"')} icons for a party of ${party.length}`);
  check('the key selector names every party member on their icon',
    party.every((member) => views.runRow.includes(escapeHtml(member.name.split('-')[0]))),
    party.map((m) => m.name).join(', '));
  // Tank first, then healer, then the dps — so the row reads the same for every
  // key regardless of who happened to do the most damage.
  const ROLES = { 250: 'tank', 581: 'tank', 104: 'tank', 268: 'tank', 66: 'tank', 73: 'tank',
    105: 'healer', 1468: 'healer', 270: 'healer', 65: 'healer', 256: 'healer', 257: 'healer', 264: 'healer' };
  const order = party.map((m) => ROLES[m.specId] ?? 'dps');
  check('the party is ordered tank, healer, then dps',
    order.every((role, i) => ['tank', 'healer', 'dps'].indexOf(role) >=
      ['tank', 'healer', 'dps'].indexOf(order[i - 1] ?? 'tank')),
    order.join(' → '));
  check('a finished key reports whether it timed', /class="(timed|depleted)"/.test(views.runRow));
  check('a live key says so instead of reporting a result',
    views.runRowLive.includes('in progress') && !/class="(timed|depleted)"/.test(views.runRowLive));
  check('the key selector drops the count for a dungeon the table misses',
    !views.runRowNoMdt.includes('count') && views.runRowNoMdt.includes('class="dungeon-initials"'),
    views.runRowNoMdt);
  // The King's Rest case: 584 from the kills the log reports dead plus the 30 for
  // the Shadow of Zul, which is removed by script, against the 608 the dungeon
  // asks for. The ordinary just-over-100% a timed key gives, with no star.
  check('a count that reaches the requirement is stated flatly',
    text(views.runRowObjective).includes('101.0% count') &&
      !text(views.runRowObjective).includes('*'),
    text(views.runRowObjective));
  check('a count nothing can account for is marked, not stated flatly',
    text(views.runRowShort).includes('82.2%* count'),
    text(views.runRowShort));
  console.log(`  (key selector party: ${party.map((m) => m.name.split('-')[0]).join(', ')})`);
}

/** Markup as the screen reads it: tags and React's text-node separators gone. */
function text(html) {
  return html.replace(/<!--[^>]*-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

console.log(failures === 0 ? '\nall UI assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

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

// Loaded through the real main-process module so the smoke test exercises MDT
// discovery too: on a machine with MDT beside the log the count columns render,
// and on one without them the no-forces path does.
const { loadForces } = await import(new URL('../apps/desktop/out/main/mdt.js', import.meta.url));
const { table: forces, directory: mdtDir } = await loadForces(logPath);
console.log(
  mdtDir === null
    ? '\n  (no Mythic Dungeon Tools found beside this log — rendering without enemy forces)'
    : `\n  (enemy forces from ${mdtDir}: ${forces.dungeons.length} dungeons)`,
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
  worker.postMessage({ type: 'open', path: logPath, tail: false, forces });
});

const { render, partyOf } = await import(outFile);
rmSync(outFile, { force: true });
const views = render(analysis);

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log(`\n+${analysis.meta.keystoneLevel} ${analysis.meta.zoneName} — rendering ${Object.keys(views).length} views\n`);
for (const [name, html] of Object.entries(views)) {
  console.log(`  ${name.padEnd(15)} ${String(html.length).padStart(7)} bytes`);
}
console.log();

const topPlayer = analysis.damage.actors[0].name.split('-')[0];
const topSpell = analysis.damage.actors[0].spells[0].name;
const firstSegmentLabel = analysis.segments[0].label;

check('damage table names the top player', views.damage.includes(topPlayer));
check('damage table is collapsed by default (no spell rows)', !views.damage.includes(topSpell));
check('timeline renders every segment', countOf(views.timeline, 'class="block') === analysis.segments.length,
  `${countOf(views.timeline, 'class="block')} blocks vs ${analysis.segments.length} segments`);
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
check('expanded damage names the top ability', views.expandedDamage.includes(escapeHtml(topSpell)));
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
  !views.rosterNoForces.includes('>Count</th>') && views.rosterNoForces.includes('no table was found'));
check('run forces are the sum over segments',
  analysis.forces.counted === analysis.segments.reduce((n, s) => n + s.forces, 0),
  `${analysis.forces.counted} vs ${analysis.segments.reduce((n, s) => n + s.forces, 0)}`);
if (analysis.forces.known) {
  check('the timeline header shows count out of the requirement',
    views.timeline.includes(`${analysis.forces.counted.toLocaleString('en-US')}/${analysis.forces.total.toLocaleString('en-US')} count`),
    views.timeline.slice(0, 400));
  check('counted forces do not exceed what the dungeon requires by much',
    analysis.forces.counted <= analysis.forces.total * 1.5,
    `${analysis.forces.counted} of ${analysis.forces.total}`);
  console.log(`  (count: ${analysis.forces.counted}/${analysis.forces.total} — ${analysis.forces.dungeon}, ${analysis.forces.source})`);
  if (analysis.forces.unknown.length > 0) {
    console.log(`  (not in the forces table: npc ${analysis.forces.unknown.join(', ')})`);
  }
}

if (analysis.deaths.length > 0) {
  const death = analysis.deaths[0];
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
  const rowSeconds = [...views.deaths.matchAll(/class="dt-mid">\u2212([\d.]+)</g)]
    .map((match) => Number(match[1]));
  check('death recap puts the death row first and counts backwards from it',
    rowSeconds.length > 0 &&
      rowSeconds.every((value, index) => index === 0 || value > rowSeconds[index - 1]) &&
      views.deaths.indexOf('class="dt-row') === views.deaths.indexOf('class="dt-row death"'),
    `row labels read ${rowSeconds.join(' ')}`);
  // The health column holds its cell open on every row, trace or no trace: a
  // row that drops the cell shunts the bars either side of it sideways.
  check('death recap carries a health cell on every row',
    countOf(views.deaths, 'class="dt-hp') === countOf(views.deaths, 'class="dt-row'),
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
  const lastHp = [...death.trace].reverse().find((sample) => sample.fraction >= 0);
  check('the health column survives the row order being flipped',
    lastHp === undefined ||
      views.deaths.includes(
        `aria-label="${lastHp.hp > 0 ? Math.max(1, Math.round(lastHp.fraction * 100)) : 0}% health"`,
      ) &&
        /class="dt-hp"[^>]*aria-label="(\d+)% health"/.exec(views.deaths)?.[1] ===
          String(lastHp.hp > 0 ? Math.max(1, Math.round(lastHp.fraction * 100)) : 0),
    `first health cell is ${/class="dt-hp"[^>]*aria-label="(\d+)% health"/.exec(views.deaths)?.[1]}%, trace ends at ${lastHp === undefined ? 'nothing' : Math.round(lastHp.fraction * 100) + '%'}`);
  check('zoomed row labels carry the quarter seconds',
    views.deathZoomed === '' ||
      views.deathZoomed.includes('\u2212' + (death.windowMs / 1000 - 0.25).toFixed(2)),
    views.deathZoomed.slice(0, 400));
  check('the zoomed recap still bars and still shows health',
    views.deathZoomed === '' ||
      (countOf(views.deathZoomed, 'class="dt-hp') === countOf(views.deathZoomed, 'class="dt-row') &&
        !/width:\s*(NaN|Infinity|-)/.test(views.deathZoomed)));
  check('death recap shows the healing side',
    death.healsReceived.length === 0
      ? views.deaths.includes('No healing landed')
      : views.deaths.includes('Healing received'));
  check('death recap names a heal the player actually got',
    death.healsReceived.length === 0 ||
      views.deaths.includes(escapeHtml(death.healsReceived[0].spellName)));
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
  check('death recap names the shield behind an absorb',
    death.absorbsReceived.length === 0 ||
      views.deaths.includes(escapeHtml(death.absorbsReceived[0].spellName)),
    death.absorbsReceived.map((a) => `${a.spellName} ${a.amount}`).slice(0, 3).join(', '));
  // Icons resolve through the preload bridge, which does not exist in a server
  // render. Every view must survive that with no icon at all.
  check('death recap renders with no icons available',
    !views.deaths.includes('src=""') && !views.deaths.includes('src="undefined"'));
} else {
  console.log('  (run had no deaths; death view assertions skipped)');
}

// --- Icons -------------------------------------------------------------------
// Every icon in the app resolves through the preload bridge, which does not
// exist in a server render. So this is the offline case for all of them: the
// boxes must be there, sized and coloured, with no <img> and no broken src.
const specCount = countOf(views.specIcons, 'class="spec-ico"');
check('every spec renders an icon box', specCount === 39, `${specCount} boxes for 39 specs`);
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
check('the key selector drops the count for anyone without MDT',
  !views.runRowNoMdt.includes('count') && views.runRowNoMdt.includes('class="dungeon-initials"'),
  views.runRowNoMdt);
console.log(`  (key selector party: ${party.map((m) => m.name.split('-')[0]).join(', ')})`);

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

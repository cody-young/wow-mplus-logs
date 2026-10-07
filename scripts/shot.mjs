#!/usr/bin/env node
/**
 * Screenshot a view, so a layout change can be looked at rather than argued
 * about.
 *
 * The smoke test proves a view renders and says the right things; it cannot see
 * that two columns are drifting apart or that a separator landed a pixel off a
 * row. Running the app is the obvious answer and often the wrong one: it needs a
 * session with a display, the key you want has to be the one it opened on, and
 * an agent working on the layout cannot look at the result at all.
 *
 * So the real components are server-rendered against a real log, dropped into a
 * document with the app's own stylesheet, and handed to Firefox headless. What
 * comes out is the same pixels the renderer would paint, minus the icons, which
 * resolve through a preload bridge that does not exist outside Electron — they
 * come out as empty boxes, which is also what the smoke test checks for.
 *
 *   node scripts/shot.mjs <log> [--view deaths] [--run 0] [--death 0]
 *                               [--width 1500] [--out shot.png] [--html]
 *
 * --view names a view from apps/desktop/test/ui-smoke.tsx; --html keeps the
 * intermediate document, which is what to open when a screenshot looks wrong.
 * --death picks which death the recap opens on, by dropping the ones after it:
 * the panel opens on the most recent in its list, and any earlier death is
 * otherwise unreachable without clicking something.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import * as esbuild from 'esbuild';

const args = process.argv.slice(2);
const logPath = args.find((arg) => !arg.startsWith('--'));
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
if (!logPath) {
  console.error('usage: node scripts/shot.mjs <log> [--view deaths] [--run 0] [--width 1500] [--out shot.png]');
  process.exit(2);
}
const viewName = flag('view', 'deaths');
const runIndex = Number(flag('run', 0));
// Null is "leave the list alone", which opens on the most recent death.
const deathPick = flag('death', null);
const deathIndex = deathPick === undefined || deathPick === null ? null : Number(deathPick);
const width = Number(flag('width', 1500));
const outPath = resolve(flag('out', 'shot.png'));
const keepHtml = args.includes('--html');

const root = new URL('../', import.meta.url);
// Inside the project: react-dom/server is CommonJS and does a dynamic require
// of node builtins, so it stays external and resolves from node_modules.
const bundle = fileURLToPath(new URL('apps/desktop/test/.shot.bundle.mjs', root));
await esbuild.build({
  entryPoints: [fileURLToPath(new URL('apps/desktop/test/ui-smoke.tsx', root))],
  bundle: true,
  outfile: bundle,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  target: 'node22',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});

const { loadForces } = await import(new URL('apps/desktop/out/main/forces.js', root));
const { table: forces, mdt } = await loadForces(logPath);

const analysis = await new Promise((done, fail) => {
  const worker = new Worker(new URL('apps/desktop/out/main/parse-worker.js', root));
  const found = new Map();
  worker.on('message', (event) => {
    if (event.type === 'analysis') found.set(event.analysis.runId, event.analysis);
    else if (event.type === 'failed') fail(new Error(event.message));
    else if (event.type === 'done') {
      void worker.terminate();
      const list = [...found.values()];
      if (list[runIndex] === undefined) fail(new Error(`no run at index ${runIndex} (found ${list.length})`));
      else done(list[runIndex]);
    }
  });
  worker.on('error', fail);
  worker.postMessage({ type: 'open', path: logPath, tail: false, forces, mdt });
});

const { render } = await import(bundle);
rmSync(bundle, { force: true });
const views = render(
  deathIndex === null ? analysis : { ...analysis, deaths: analysis.deaths.slice(0, deathIndex + 1) },
);
const body = views[viewName];
if (body === undefined) {
  console.error(`no view "${viewName}". Try one of: ${Object.keys(views).join(', ')}`);
  process.exit(1);
}

console.log(
  `${analysis.meta.kind === 'raid' ? `${analysis.meta.encounterName} pull ${analysis.meta.pull}` : `+${analysis.meta.keystoneLevel} ${analysis.meta.zoneName}`} — ${analysis.deaths.length} death(s), view "${viewName}"`,
);
analysis.deaths.forEach((death, index) => {
  console.log(
    `  ${index === (deathIndex ?? analysis.deaths.length - 1) ? '>' : ' '} death ${index}: ${death.name} at ${(death.ts / 1000).toFixed(1)}s` +
      ` — ${death.killingBlow?.spellName ?? 'cause unclear'}`,
  );
});

// The app's own stylesheet, so what is shot is what ships. The wrapper mimics
// the panel the view sits in: width is the one thing a server render cannot
// know, and every "does this fit" decision in the chart depends on it.
const css = readFileSync(new URL('apps/desktop/src/renderer/styles.css', root), 'utf8');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${viewName}</title>
<style>${css}
/* Shot-only: the app is a grid filling the window, and nothing here is. */
html { background: var(--bg); }
body { overflow: visible; padding: 16px; width: ${width}px; }
.death-grid, .split { min-width: 0; }
</style></head>
<body><div class="app" style="display:block;height:auto"><div class="content" style="padding:0">${body}</div></div></body></html>`;
const htmlPath = keepHtml ? outPath.replace(/\.png$/, '.html') : join(tmpdir(), `shot-${process.pid}.html`);
writeFileSync(htmlPath, html);

// --no-remote and a throwaway profile, or this hands the page to the Firefox
// the user already has open and screenshots nothing.
const profile = mkdtempSync(join(tmpdir(), 'shot-profile-'));
const result = spawnSync(
  'firefox',
  ['--headless', '--no-remote', '--profile', profile, `--window-size=${width},1200`, '--screenshot', outPath, `file://${htmlPath}`],
  { encoding: 'utf8', env: { ...process.env, MOZ_HEADLESS: '1' }, timeout: 120_000 },
);
rmSync(profile, { recursive: true, force: true });
if (!keepHtml) rmSync(htmlPath, { force: true });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || `firefox exited ${result.status}`);
  process.exit(1);
}
console.log(`wrote ${outPath}${keepHtml ? ` and ${htmlPath}` : ''}`);

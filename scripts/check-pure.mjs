// Guardrail: the parse engine must stay runnable in a browser.
// Any node: import (or require of a core module) in these sources would
// silently kill the future web build, so fail loudly at the first one.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('usage: check-pure.mjs <dir...>');
  process.exit(2);
}

const BANNED = /(?:from\s*['"]node:|require\(\s*['"]node:|from\s*['"](?:fs|path|os|crypto|worker_threads|child_process|stream|buffer|util|events)['"])/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.m?ts$/.test(entry.name)) yield full;
  }
}

let violations = 0;
for (const root of roots) {
  for await (const file of walk(root)) {
    const text = await readFile(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (BANNED.test(line)) {
        console.error(`${relative(process.cwd(), file)}:${i + 1}: node-only import in portable code\n    ${line.trim()}`);
        violations++;
      }
    });
  }
}

if (violations > 0) {
  console.error(`\n${violations} violation(s). The parser must accept bytes, not read them.`);
  process.exit(1);
}
console.log(`check:pure ok — ${roots.join(', ')} is browser-portable`);

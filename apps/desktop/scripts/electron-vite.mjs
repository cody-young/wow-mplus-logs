/**
 * electron-vite, with one class of upstream noise filtered out of stderr.
 *
 * Electron statically links its own copy of fontconfig, older than the system
 * library: the binary carries fontconfig's warning strings but not the
 * `genericfamily` object that fontconfig 2.18 introduced. On a distro shipping
 * 2.18's config fragments, that parser prints ~90 lines of "invalid constant
 * used" and "invalid attribute 'xsi:nil'" on every launch, burying real output.
 *
 * Nothing is broken by it. The system library is fine (`fc-match` is silent),
 * the rules fontconfig skips are only the 2.18 generic-family hints, and the
 * classic last-resort rule that keeps an unknown family such as the renderer's
 * `ui-sans-serif` resolving to the right font parses fine and still applies.
 * Half the lines are not even a config load — fontconfig scans its template
 * directory purely to read each fragment's <description>.
 *
 * It also cannot be fixed from here. FONTCONFIG_FILE can hide the fragments
 * from the real load, but the template scan ignores it; only FONTCONFIG_SYSROOT
 * suppresses that, and a sysroot relocates every font and cache path, which
 * risks changing font resolution and rebuilding the font cache — a worse trade
 * than the noise. So drop exactly these lines and leave every other warning
 * alone.
 *
 * stdout and stdin stay inherited, so colours and electron-vite's terminal keys
 * are untouched; only stderr is piped.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * Two patterns, both upstream noise with no bearing on the app:
 *
 * - fontconfig's complaints about 2.18 syntax, as described above.
 * - Chromium's GL presentation helper failing to read vsync parameters, which
 *   it reports at ERROR level and then carries on; on Wayland it is routine and
 *   says nothing about this app. Scoped to that one message so real GPU errors
 *   still show.
 */
const UPSTREAM_NOISE = [
  /^Fontconfig warning: ".*", line \d+: (invalid constant used|invalid attribute 'xsi:)/,
  /GetVSyncParametersIfAvailable\(\) failed/,
];

// The CLI itself is not in electron-vite's `exports`, so go through the
// package manifest — which is — and read the path out of its `bin` field.
const require = createRequire(import.meta.url);
const manifestPath = require.resolve('electron-vite/package.json');
const bin = join(dirname(manifestPath), require(manifestPath).bin['electron-vite']);
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: ['inherit', 'inherit', 'pipe'],
});

createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => {
  if (!UPSTREAM_NOISE.some((pattern) => pattern.test(line))) process.stderr.write(`${line}\n`);
});

// Without this a killed wrapper orphans electron-vite and the app window with
// it, leaving a stray window sitting on someone's desktop. Interactive Ctrl+C
// already reaches the whole process group; this covers the rest.
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(name, () => child.kill(name));
}

child.on('exit', (code, signal) => {
  // Report a signalled child the way a shell does, so Ctrl+C is not a success.
  process.exitCode = signal === null ? (code ?? 1) : 128 + (constants.signals[signal] ?? 0);
});

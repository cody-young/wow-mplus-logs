import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * The workspace packages are bundled rather than externalized.
 *
 * `externalizeDepsPlugin` leaves every declared dependency as a bare import, to
 * be resolved from `node_modules` at runtime. That is right for real npm
 * packages and wrong for these three: they are workspace symlinks into
 * `packages/*`, so a packaged app would have to carry the links, their
 * `dist/` output and nothing else from the monorepo — and the one that is not
 * declared, `@mplus/data`, would simply be missing.
 *
 * Bundling them instead leaves the built main process importing nothing but
 * `electron` and `node:*` builtins, so packaging has no dependency tree to
 * trace at all.
 *
 * They sit in `devDependencies`, which alone would be enough to get them
 * bundled — the plugin only externalizes `dependencies`. Naming them here too
 * is deliberate: it states the intent where the bundling happens, and it means
 * moving one between the two sections can never quietly change what ships.
 */
const WORKSPACE = ['@mplus/analysis', '@mplus/data', '@mplus/parser'];

/**
 * VS Code sets ELECTRON_RUN_AS_NODE=1 for processes it spawns, and any terminal
 * launched from it inherits that. Electron honours the variable by running as a
 * bare Node process: no Chromium, no window, and `app` undefined — so the app
 * exits without an obvious reason. electron-vite spawns Electron from this
 * process, so clearing it here fixes `dev`, `preview` and `start` at once, on
 * every platform, rather than relying on a POSIX-only `env -u` in the script.
 */
delete process.env['ELECTRON_RUN_AS_NODE'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // The parser runs in a worker thread, so it needs its own entry point.
          'parse-worker': resolve(import.meta.dirname, 'src/main/parse-worker.ts'),
          // An entry only so the CLI scripts can import it: `report.mjs` and
          // `ui-smoke.mjs` load enemy forces through the same reader the app
          // uses, which is the point — a validation script that reimplemented
          // MDT discovery would validate the reimplementation.
          forces: resolve(import.meta.dirname, 'src/main/forces.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE })],
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    // Without these the renderer ships React's development build unminified:
    // ~660 kB with warning machinery and no production fast paths.
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] ?? 'production') },
    build: {
      minify: 'esbuild',
      rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
  },
});

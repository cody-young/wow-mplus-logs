import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';

import type { WorkerEvent, WorkerRequest } from '../shared.js';
import { resolveIcons, resolveNamed } from './icons.js';
import { findLatestLog } from './logs.js';
import { loadForces } from './mdt.js';

const isDev = !app.isPackaged;

let window: BrowserWindow | null = null;
let worker: Worker | null = null;

function startWorker(): Worker {
  if (worker !== null) return worker;
  const created = new Worker(join(import.meta.dirname, 'parse-worker.js'));
  created.on('message', (event: WorkerEvent) => {
    window?.webContents.send('mplus:event', event);
  });
  created.on('error', (error: Error) => {
    window?.webContents.send('mplus:event', { type: 'failed', message: error.message } satisfies WorkerEvent);
  });
  worker = created;
  return created;
}

function send(request: WorkerRequest): void {
  startWorker().postMessage(request);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    show: false,
    backgroundColor: '#12121a',
    title: 'M+ Logs',
    webPreferences: {
      // .mjs, not .js: Electron requires that extension for an ESM preload, so
      // that is what electron-vite emits. Get it wrong and the renderer loads
      // with no window.mplus at all, which surfaces only as React crashing on
      // the first use of the bridge.
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // Without this a renderer exception is invisible: nothing reaches the
    // terminal, and a window that threw before mounting looks exactly like one
    // that rendered an empty view.
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      const tag = ['debug', 'info', 'warning', 'error'][level] ?? String(level);
      const origin = source === '' ? '' : ` (${source}:${line})`;
      process.stdout.write(`[renderer ${tag}] ${message}${origin}\n`);
    });
  }

  window.on('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devServer !== undefined) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

ipcMain.handle('mplus:pickLog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open a combat log',
    properties: ['openFile'],
    filters: [
      { name: 'Combat logs', extensions: ['txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('mplus:findLatestLog', () => findLatestLog());

ipcMain.handle('mplus:icons', (_event, spellIds: number[]) =>
  resolveIcons(Array.isArray(spellIds) ? spellIds : []),
);

ipcMain.handle('mplus:namedIcons', (_event, names: string[]) =>
  resolveNamed(Array.isArray(names) ? names : []),
);

ipcMain.handle('mplus:open', async (_event, path: string, tail: boolean) => {
  // Awaited rather than loaded in parallel with the parse: the analysis needs
  // the table from its first pass, and re-running a 200 MB key to attach the
  // forces values afterwards costs far more than the scan does. It reads a
  // dozen files beside the log, so this is milliseconds.
  const { table } = await loadForces(path);
  send({ type: 'open', path, tail, forces: table });
});

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  worker?.postMessage({ type: 'stop' } satisfies WorkerRequest);
  void worker?.terminate();
  worker = null;
  if (process.platform !== 'darwin') app.quit();
});

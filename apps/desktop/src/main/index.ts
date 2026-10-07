import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron';

import type { UpdateState, WorkerEvent, WorkerRequest } from '../shared.js';
import { resolveDescriptions, resolveIcons, resolveNamed } from './icons.js';
import { findLatestLog, listLogs } from './logs.js';
import { loadForces } from './forces.js';
import { mdtTiles } from './mdt-tiles.js';
import { load as loadSettings, save as saveSettings } from './settings.js';
import {
  check as checkForUpdate,
  download as downloadUpdate,
  initUpdates,
  install as installUpdate,
  openReleases,
  setAutomatic,
  updateState,
} from './updater.js';

const isDev = !app.isPackaged;

let window: BrowserWindow | null = null;
let worker: Worker | null = null;
/** The MDT install beside the open log, where its map tiles are read from. */
let mdtDirectory: string | null = null;

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

/**
 * The log to follow when someone asks to watch live.
 *
 * Three steps, in increasing order of how much they ask of the reader: the
 * directory they pointed us at last time, then the install search, then a
 * picker. What is remembered is the directory and not the file, because the
 * game starts a new log every time `/combatlog` is turned on — so a reader
 * whose install the search cannot find is asked once, not once per session.
 */
async function watchTarget(): Promise<string | null> {
  const remembered = (await loadSettings()).logDirectory;
  if (remembered !== null) {
    const newest = (await listLogs(remembered))[0];
    if (newest !== undefined) return newest.path;
  }

  const found = await findLatestLog();
  if (found !== null) return found;

  const result = await dialog.showOpenDialog({
    // The title carries the explanation: `message` only shows on macOS, and
    // this dialog opening at all means the search already failed.
    title: 'No combat log found — open one from your World of Warcraft Logs folder',
    buttonLabel: 'Watch',
    ...(remembered !== null ? { defaultPath: remembered } : {}),
    properties: ['openFile'],
    filters: [
      { name: 'Combat logs', extensions: ['txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  const picked = result.canceled ? undefined : result.filePaths[0];
  if (picked === undefined) return null;
  // Remembered even though this run follows the picked file directly, so the
  // next press resolves without asking.
  await saveSettings({ logDirectory: dirname(picked) });
  return picked;
}

ipcMain.handle('mplus:watchLog', () => watchTarget());

ipcMain.handle('mplus:icons', (_event, spellIds: number[]) =>
  resolveIcons(Array.isArray(spellIds) ? spellIds : []),
);

ipcMain.handle('mplus:spellDescriptions', (_event, spellIds: number[]) =>
  resolveDescriptions(Array.isArray(spellIds) ? spellIds : []),
);

ipcMain.handle('mplus:namedIcons', (_event, names: string[]) =>
  resolveNamed(Array.isArray(names) ? names : []),
);

ipcMain.handle('mplus:updateState', () => updateState());
ipcMain.handle('mplus:checkForUpdate', () => checkForUpdate(true));
ipcMain.handle('mplus:downloadUpdate', () => downloadUpdate());
ipcMain.handle('mplus:installUpdate', () => installUpdate());
ipcMain.handle('mplus:setAutomaticUpdates', (_event, on: boolean) => setAutomatic(on === true));
ipcMain.handle('mplus:openReleases', () => openReleases());
ipcMain.handle('mplus:copyText', (_event, text: unknown) => {
  if (typeof text === 'string') clipboard.writeText(text);
});

ipcMain.handle('mplus:mdtTiles', (_event, textureDir: unknown, sublevel: unknown) =>
  mdtDirectory === null ? null : mdtTiles(mdtDirectory, textureDir, sublevel),
);

ipcMain.handle('mplus:open', async (_event, path: string, tail: boolean) => {
  // Awaited rather than loaded in parallel with the parse: the analysis needs
  // the table from its first pass, and re-running a 200 MB key to attach the
  // forces values afterwards costs far more than the scan does. It reads a
  // dozen files beside the log, so this is milliseconds.
  const { table, iconsFrom, mdt } = await loadForces(path);
  mdtDirectory = iconsFrom;
  send({ type: 'open', path, tail, forces: table, mdt });
});

void app.whenReady().then(async () => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // After the window, so the first state it pushes has somewhere to land. The
  // renderer also asks for the state once on mount, which covers the gap for a
  // window that is still loading when a check finishes.
  await initUpdates((state: UpdateState) => {
    window?.webContents.send('mplus:update', state);
  });
});

app.on('window-all-closed', () => {
  worker?.postMessage({ type: 'stop' } satisfies WorkerRequest);
  void worker?.terminate();
  worker = null;
  if (process.platform !== 'darwin') app.quit();
});

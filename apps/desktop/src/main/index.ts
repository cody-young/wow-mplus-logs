import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { BrowserWindow, app, clipboard, dialog, ipcMain, screen, shell } from 'electron';

import type { UpdateState, WorkerEvent, WorkerRequest } from '../shared.js';
import { resolveDescriptions, resolveIcons, resolveNamed, resolvePortraits, resolveSpellNames } from './icons.js';
import { findLatestLog, listLogs } from './logs.js';
import { loadForces } from './forces.js';
import { mdtTiles } from './mdt-tiles.js';
import { load as loadSettings, save as saveSettings, type WindowPlacement } from './settings.js';
import {
  check as checkForUpdate,
  download as downloadUpdate,
  initUpdates,
  install as installUpdate,
  openReleases,
  setAutomatic,
  updateState,
} from './updater.js';
import { parsesForRun, signIn as wclSignIn, signOut as wclSignOut, status as wclStatus } from './wcl.js';

const isDev = !app.isPackaged;

// Chromium picks a keyring from the desktop's name, and one it does not know —
// Hyprland, Sway, i3 — gets plain text, which safeStorage reports as no
// encryption at all, so the Warcraft Logs token was never written. Every
// keyring worth having speaks the Secret Service API that libsecret talks to.
// Must be set before ready; an explicit --password-store still wins.
if (process.platform === 'linux' && !app.commandLine.hasSwitch('password-store')) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

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

/**
 * Whether a remembered placement still lands somewhere reachable. A monitor
 * unplugged or rearranged since leaves it off every screen, and a window there
 * opens invisible. The test is the title bar, since that is what has to be on
 * screen for the reader to grab it and drag the rest back.
 */
function onScreen(placement: WindowPlacement): boolean {
  const titleBar = { x: placement.x, y: placement.y, width: placement.width, height: 32 };
  return screen.getAllDisplays().some(({ workArea }) => {
    const across =
      Math.min(titleBar.x + titleBar.width, workArea.x + workArea.width) - Math.max(titleBar.x, workArea.x);
    const down =
      Math.min(titleBar.y + titleBar.height, workArea.y + workArea.height) - Math.max(titleBar.y, workArea.y);
    return across >= 100 && down > 0;
  });
}

/**
 * Keeps the window's placement in settings as it changes, so the next launch —
 * including the one an update restarts into — opens where this one was.
 *
 * Written as it moves rather than only on close: quitting to install an update
 * exits without waiting on the async write a close handler would start, and
 * then the placement from before the last move is what survives.
 */
function rememberPlacement(created: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    clearTimeout(timer);
    if (created.isDestroyed() || created.isMinimized() || created.isFullScreen()) return;
    // The normal bounds, not the current ones: a maximized window's own bounds
    // are the screen's, and restoring them would leave nothing to unmaximize to.
    const bounds = created.getNormalBounds();
    void saveSettings({ window: { ...bounds, maximized: created.isMaximized() } });
  };
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  created.on('move', later);
  created.on('resize', later);
  created.on('maximize', save);
  created.on('unmaximize', save);
  created.on('close', save);
}

async function createWindow(): Promise<void> {
  const remembered = (await loadSettings()).window;
  const placement = remembered !== null && onScreen(remembered) ? remembered : null;
  window = new BrowserWindow({
    ...(placement !== null
      ? { x: placement.x, y: placement.y, width: placement.width, height: placement.height }
      : { width: 1440, height: 940 }),
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

  if (placement?.maximized === true) window.maximize();
  rememberPlacement(window);
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

ipcMain.handle('mplus:spellNames', (_event, spellIds: number[]) =>
  resolveSpellNames(Array.isArray(spellIds) ? spellIds : []),
);

ipcMain.handle('mplus:namedIcons', (_event, names: string[]) =>
  resolveNamed(Array.isArray(names) ? names : []),
);

ipcMain.handle('mplus:portraits', (_event, displayIds: number[]) =>
  resolvePortraits(Array.isArray(displayIds) ? displayIds : []),
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

ipcMain.handle('mplus:wclStatus', () => wclStatus());
ipcMain.handle('mplus:wclSignIn', () => wclSignIn());
ipcMain.handle('mplus:wclSignOut', () => wclSignOut());
ipcMain.handle('mplus:wclParses', (_event, run: unknown, fresh: unknown) => parsesForRun(run, fresh === true));

ipcMain.handle('mplus:open', async (_event, path: string, tail: boolean) => {
  // Awaited rather than loaded in parallel with the parse: the analysis needs
  // the table from its first pass, and re-running a 200 MB key to attach the
  // forces values afterwards costs far more than the scan does. It reads a
  // dozen files beside the log, so this is milliseconds.
  const { table, iconsFrom, mdt, searched } = await loadForces(path);
  mdtDirectory = iconsFrom;
  send({ type: 'open', path, tail, forces: table, mdt });
  return { mdtSearched: searched };
});

void app.whenReady().then(async () => {
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
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

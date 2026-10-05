/**
 * Automatic updates.
 *
 * `electron-updater` is the runtime half of electron-builder: the packaging run
 * already writes `latest.yml` / `latest-linux.yml` beside the installers and
 * `app-update.yml` into the app's resources, so the feed exists without any
 * extra configuration here. What this file is really about is the three places
 * the default behaviour is wrong for this app.
 *
 * **Not every build can update itself.** Of the four targets in
 * `electron-builder.yml` only two can: the NSIS installer, which replaces
 * itself, and the AppImage, which rewrites the file in place. The portable
 * .exe installs nothing, so there is nothing to replace; the .deb belongs to
 * dpkg, and electron-updater's own deb path shells out to `sudo`/`pkexec` to
 * install, which is not a thing a combat log viewer should ever ask for. Those
 * two builds still check the feed — knowing a new version exists is most of the
 * value — and send the reader to the releases page instead. `capability()` is
 * that decision, and the renderer renders from it rather than guessing.
 *
 * **Nothing downloads on its own.** `autoDownload` defaults to true, which
 * means a 110 MB pull starting by itself while someone is mid-key, competing
 * with the game's own traffic. The check is automatic; the download is a
 * button. Once downloaded, `autoInstallOnAppQuit` lets the install happen on
 * the next quit rather than interrupting a run.
 *
 * **A failed check is not an error worth showing.** On the automatic path a
 * timeout, no network or a rate-limited API resolves to silence: the reader did
 * not ask, so there is nothing to tell them. The same failure on the manual
 * path is reported, because there someone is waiting for an answer. Note that
 * the `error` listener is not optional for a quieter reason too — `AppUpdater`
 * is an `EventEmitter`, and an unhandled `error` event takes the process down.
 *
 * One operational note that is easy to lose: `electron-builder.yml` publishes
 * to a **draft** release, and a draft is invisible to the feed. Tagging does
 * not ship an update; clicking Publish on the release does.
 */
import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

import type { UpdateCapability, UpdateState, UpdateStatus } from '../shared.js';
import { load as loadSettings, save as saveSettings } from './settings.js';

/**
 * Where a build that cannot update itself sends the reader. Has to agree with
 * the `repository` field in `package.json`, which is what electron-builder
 * derives the feed's owner/repo from.
 */
const RELEASES_URL = 'https://github.com/cody-young/wow-mplus-logs/releases/latest';

/**
 * Long enough that the check never competes with opening a log, which is what
 * someone launching this app is about to do. Nothing depends on it being
 * prompt: the answer is the same ten seconds later.
 */
const STARTUP_DELAY_MS = 8000;

let automatic = true;
let status: UpdateStatus = { phase: 'idle' };
/**
 * Whether the check in flight was asked for. Decides whether a failure is
 * reported or swallowed, and whether "you are up to date" is worth saying.
 */
let userAsked = false;
let broadcast: (state: UpdateState) => void = () => {};

function capability(): UpdateCapability {
  // Unpackaged is not a target at all: electron-updater refuses to check
  // without `app-update.yml`, which only a packaged build has.
  if (!app.isPackaged) return 'none';
  if (process.platform === 'win32') {
    // Set by the portable target's launcher, and by nothing else — it is how
    // the portable build tells its own app where it was run from.
    return process.env['PORTABLE_EXECUTABLE_FILE'] === undefined ? 'install' : 'notify';
  }
  if (process.platform === 'linux') {
    // The AppImage runtime exports the path to the .AppImage it mounted.
    // Without it this is the .deb, which dpkg owns.
    return process.env['APPIMAGE'] === undefined ? 'notify' : 'install';
  }
  // Nothing is built for macOS, and an unsigned mac build could not update
  // itself anyway: Squirrel.Mac verifies the signature before swapping.
  return 'notify';
}

function state(): UpdateState {
  return {
    capability: capability(),
    automatic,
    currentVersion: app.getVersion(),
    releasesUrl: RELEASES_URL,
    status,
  };
}

function set(next: UpdateStatus): void {
  status = next;
  broadcast(state());
}

export async function setAutomatic(on: boolean): Promise<void> {
  automatic = on;
  broadcast(state());
  await saveSettings({ automaticUpdates: on });
}

export function openReleases(): void {
  void shell.openExternal(RELEASES_URL);
}

export function check(fromUser: boolean): void {
  if (capability() === 'none') return;
  // A second check while one is in flight would double the listeners' work for
  // the same answer. A download in progress or a staged update outranks it.
  if (status.phase === 'checking' || status.phase === 'downloading' || status.phase === 'ready') {
    return;
  }
  userAsked = fromUser;
  set({ phase: 'checking' });
  // Errors arrive through the `error` event, which is already handled, so the
  // rejection here is the same failure reported twice.
  void autoUpdater.checkForUpdates().catch(() => {});
}

export function download(): void {
  if (capability() !== 'install') return;
  if (status.phase !== 'available') return;
  userAsked = true;
  set({ phase: 'downloading', version: status.version, percent: 0, bytesPerSecond: 0 });
  void autoUpdater.downloadUpdate().catch(() => {});
}

export function install(): void {
  if (status.phase !== 'ready') return;
  // `isSilent` false on Windows so the NSIS installer shows its progress —
  // this replaces a running app, and a user who sees nothing happen tends to
  // start clicking. `isForceRunAfter` brings the new version back up.
  autoUpdater.quitAndInstall(false, true);
}

export async function initUpdates(send: (state: UpdateState) => void): Promise<void> {
  broadcast = send;
  automatic = (await loadSettings()).automaticUpdates;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // The default is console, which in a packaged app writes to a stdout nobody
  // is reading. Progress and failures reach the reader through the UI instead.
  // `MPLUS_UPDATE_LOG=1` puts them back, which is the only way to see which
  // release the feed resolved and why a check decided what it did — the same
  // escape hatch `MPLUS_OFFLINE=1` is for the icon fetching.
  autoUpdater.logger = process.env['MPLUS_UPDATE_LOG'] === '1' ? console : null;

  autoUpdater.on('update-available', (info) => {
    set({
      phase: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      // The first file in the platform's own feed, which is the one this build
      // would download: the AppImage in `latest-linux.yml`, the setup .exe in
      // `latest.yml`. Null rather than 0 when the feed omits a size, so the UI
      // can say "ready to download" instead of "0.0 MB".
      sizeBytes: info.files[0]?.size ?? null,
    });
  });

  autoUpdater.on('update-not-available', () => {
    // Only worth saying when someone asked. On the startup check this is the
    // expected answer, and the UI should stay out of the way.
    set(userAsked ? { phase: 'none', checkedAt: Date.now() } : { phase: 'idle' });
  });

  autoUpdater.on('download-progress', (progress) => {
    if (status.phase !== 'downloading') return;
    set({
      phase: 'downloading',
      version: status.version,
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    set({ phase: 'ready', version: info.version });
  });

  autoUpdater.on('error', (error: Error) => {
    if (!userAsked) {
      set({ phase: 'idle' });
      return;
    }
    set({ phase: 'failed', message: error.message });
  });

  if (automatic) setTimeout(() => check(false), STARTUP_DELAY_MS).unref();
}

export { state as updateState };

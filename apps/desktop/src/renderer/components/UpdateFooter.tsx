/**
 * The update strip at the bottom of the key list.
 *
 * Deliberately the quietest thing in the window: on the normal path — launch,
 * check, already current — it is one dim line with the version in it. A banner
 * appears only when there is something to decide.
 *
 * Presentational, like `RunRow`: every phase is a prop, so `ui-smoke` can
 * render all of them without an Electron process or a release to check against.
 * `useUpdates` is the half that talks to the bridge.
 */
import { useEffect, useState } from 'react';

import { megabytes } from '../format.js';
import type { UpdateState } from '../../shared.js';

export interface UpdateFooterProps {
  state: UpdateState;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onOpenReleases: () => void;
  onToggleAutomatic: (on: boolean) => void;
}

export function UpdateFooter({
  state,
  onCheck,
  onDownload,
  onInstall,
  onOpenReleases,
  onToggleAutomatic,
}: UpdateFooterProps): React.JSX.Element | null {
  const { status } = state;
  // A dev run has no feed to ask, so the strip would only ever say so.
  if (state.capability === 'none') return null;

  return (
    <div className="updates">
      {status.phase === 'available' ? (
        <div className="update-banner">
          {/* The notes are a release body — markdown, and as long as whoever
              wrote it felt like. The sidebar is 274px wide, so they live in the
              tooltip and the releases page carries the readable copy. */}
          <strong title={status.notes ?? undefined}>{`Version ${status.version}`}</strong>
          {state.capability === 'install' ? (
            <>
              <p>
                {status.sizeBytes === null
                  ? 'Ready to download. Installs when you quit, or now.'
                  : `${megabytes(status.sizeBytes)} download. Installs when you quit, or now.`}
              </p>
              <div className="update-actions">
                <button type="button" className="primary" onClick={onDownload}>
                  Download
                </button>
                <button type="button" onClick={onOpenReleases}>
                  Notes
                </button>
              </div>
            </>
          ) : (
            <>
              {/* The portable .exe and the .deb. Saying which build this is
                  would mean telling the renderer about packaging; what it
                  needs to convey is only that the file comes from the page. */}
              <p>This build does not update itself — the new version is a download.</p>
              <div className="update-actions">
                <button type="button" className="primary" onClick={onOpenReleases}>
                  Open releases page
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {status.phase === 'downloading' ? (
        <div className="update-banner">
          <strong>{`Downloading ${status.version}`}</strong>
          <div className="progress">
            <div style={{ width: `${Math.min(100, Math.max(0, status.percent))}%` }} />
          </div>
          <p>
            {`${status.percent.toFixed(0)}%${
              status.bytesPerSecond > 0 ? ` · ${megabytes(status.bytesPerSecond)}/s` : ''
            }`}
          </p>
        </div>
      ) : null}

      {status.phase === 'ready' ? (
        <div className="update-banner ready">
          <strong>{`${status.version} is ready`}</strong>
          <p>It installs when you quit. Restart now if you are between keys.</p>
          <div className="update-actions">
            <button type="button" className="primary" onClick={onInstall}>
              Restart
            </button>
          </div>
        </div>
      ) : null}

      {status.phase === 'failed' ? (
        <div className="update-banner failed">
          <strong>Update check failed</strong>
          <p>{status.message}</p>
          <div className="update-actions">
            <button type="button" onClick={onCheck}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      <div className="update-row">
        <span>{`v${state.currentVersion}`}</span>
        {status.phase === 'checking' ? (
          <span className="update-note">Checking…</span>
        ) : status.phase === 'none' ? (
          <span className="update-note">Up to date</span>
        ) : (
          <button type="button" className="linkish" onClick={onCheck}>
            Check for updates
          </button>
        )}
        <label title="Check for a new version shortly after launch. Nothing downloads on its own.">
          <input
            type="checkbox"
            checked={state.automatic}
            onChange={(event) => onToggleAutomatic(event.target.checked)}
          />
          auto
        </label>
      </div>
    </div>
  );
}

/**
 * The live half: the state as the main process knows it, plus the calls that
 * change it. Null until the first state arrives, which keeps the strip from
 * rendering a version number it had to invent.
 */
export function useUpdates(): UpdateFooterProps | null {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const off = window.mplus.onUpdateState(setState);
    // Asked for as well as subscribed to: a check that finished before this
    // window finished loading has already sent its only notification.
    void window.mplus.updateState().then(setState);
    return off;
  }, []);

  if (state === null) return null;
  return {
    state,
    onCheck: () => void window.mplus.checkForUpdate(),
    onDownload: () => void window.mplus.downloadUpdate(),
    onInstall: () => void window.mplus.installUpdate(),
    onOpenReleases: () => void window.mplus.openReleases(),
    onToggleAutomatic: (on) => void window.mplus.setAutomaticUpdates(on),
  };
}

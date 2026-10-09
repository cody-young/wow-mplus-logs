import type { WclState } from '../wcl.js';

/**
 * One line below the meters saying where the parse badges come from, or why
 * there are none. Draws nothing in a build without Warcraft Logs at all.
 */
export function WclBar({ wcl, wholeRun }: { wcl: WclState; wholeRun: boolean }): React.JSX.Element | null {
  const { status, result } = wcl;
  if (status === null || !status.available) return null;

  if (!status.signedIn) {
    return (
      <div className="wcl-bar wcl-signin">
        <span>Show Warcraft Logs parses beside these numbers.</span>
        <button type="button" onClick={wcl.signIn}>
          Sign in with Warcraft Logs
        </button>
      </div>
    );
  }

  const account = (
    <button type="button" className="link" onClick={wcl.signOut} data-tip="Sign out of Warcraft Logs">
      {status.userName ?? 'Signed in'}
    </button>
  );

  const again = (label: string): React.ReactNode =>
    wcl.checking ? (
      <span>Checking…</span>
    ) : (
      <button type="button" className="link" onClick={wcl.retry}>
        {label}
      </button>
    );

  let message: React.ReactNode;
  if (!wcl.lookable) message = 'Parses appear once a key has finished.';
  else if (result === null) message = 'Looking for this key on Warcraft Logs…';
  else if (result.status === 'found') {
    message = (
      <>
        Parses from <a href={result.url} target="_blank" rel="noreferrer">this key on Warcraft Logs</a>
        {wholeRun ? '' : ' are for the whole key, so they are hidden on a single pull'}.
      </>
    );
  } else if (result.status === 'unranked') {
    message = (
      <>
        <a href={result.url} target="_blank" rel="noreferrer">Found on Warcraft Logs</a>, but not ranked yet.{' '}
        {again('Check again')}
      </>
    );
  } else if (result.status === 'not-found') {
    message = (
      <>
        No public Warcraft Logs report of this key yet.{' '}
        {again('Check again')}
      </>
    );
  } else if (result.status === 'error') {
    message = (
      <>
        Could not reach Warcraft Logs.{' '}
        {again('Retry')}
      </>
    );
  } else message = null;

  return (
    <div className="wcl-bar">
      <span>{message}</span>
      {account}
    </div>
  );
}

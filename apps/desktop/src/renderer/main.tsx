import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { AttributeTips } from './components/Tip.js';
import './styles.css';

const host = document.getElementById('root');
if (host === null) throw new Error('missing #root');

// Every view reads from the bridge, so without it React throws on first render
// and leaves an empty document — a failure that looks identical to a blank
// view. Say what actually happened instead.
// The declaration promises the bridge exists, which is the right assumption
// for every view; this one spot has to distrust it.
if ((window as { mplus?: unknown }).mplus === undefined) {
  host.textContent =
    'The preload bridge did not load, so window.mplus is missing. Check that out/preload/index.mjs exists and that main passes that exact path.';
} else {
  createRoot(host).render(
    <StrictMode>
      <App />
      <AttributeTips />
    </StrictMode>,
  );
}

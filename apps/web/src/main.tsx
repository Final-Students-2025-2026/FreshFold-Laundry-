import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {IntentProvider} from './intent';
import ErrorBoundary from './components/ui/ErrorBoundary';
import {ToastProvider} from './components/ui/Toast';
import {installReporting} from './services/analytics';
import {normaliseUrl} from './route';
import './index.css';

/**
 * Promote the deferred font stylesheet.
 *
 * index.html requests Outfit and JetBrains Mono with `media="print"` so they
 * download without blocking the first paint — they are `--font-sans` and
 * `--font-mono`, which only the supervisor desk and a few portal readouts use,
 * and every marketing visitor was waiting on them.
 *
 * The swap has to happen here rather than in an `onload` attribute on the tag:
 * the site's CSP is `script-src 'self'` with no `unsafe-inline`, which blocks
 * inline event handlers, so an attribute would silently never fire and those
 * two families would never load at all.
 *
 * This module is `type="module"`, so it runs after the document has parsed —
 * the request is already in flight by now and this only decides when it
 * applies.
 */
for (const link of document.querySelectorAll<HTMLLinkElement>('link[data-deferred-font]')) {
  link.media = 'all';
}

// Correct a legacy `/#portal?setup=…` URL to `/portal?setup=…` before React
// mounts, so the first render already sees the path form. See route.ts.
normaliseUrl();

// window.onerror and unhandledrejection, plus the batching that sends them.
// Installed before render so a throw during the first paint is still reported.
installReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      The outermost boundary, and the only one that catches a throw from `App`
      itself rather than from one of the lazy screens below it.

      Without it, an error in the marketing page — a bad price, an undefined
      read in a section component — unmounts the entire tree and leaves the
      customer on an empty dark page. There is no `onDismiss` here on purpose:
      there is nothing to dismiss *to*, so the fallback offers a retry, a
      reload and the shop's phone number.
    */}
    <ErrorBoundary context="app-root">
      {/* Above `App` rather than inside it: the Paystack return branch replaces
          the whole page and returns before any of the marketing sections render,
          and a provider below that early return would not exist for them. */}
      <IntentProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </IntentProvider>
    </ErrorBoundary>
  </StrictMode>,
);

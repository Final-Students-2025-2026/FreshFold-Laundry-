/**
 * Where the browser is, as one value.
 *
 * ## What this replaces
 *
 * `App` used to read `window.location.hash` in an effect, pick it apart with
 * `indexOf('?')` and `substring`, and set six pieces of state from it. That
 * worked, and it had three costs worth removing:
 *
 *  - **The URLs were unshareable.** `#portal?bookingId=123456` is one URL as
 *    far as every server, analytics tool and browser history entry is
 *    concerned — the fragment is never sent anywhere. So a customer could not
 *    send a colleague a link to anything, and nothing on the site could be
 *    told apart in a log.
 *  - **Back did not work the way anybody expects.** A hash change is a history
 *    entry, so Back left the portal — but so did the portal's own close
 *    button, by assigning `hash = ''`, which pushed *another* entry. Two ways
 *    out, one of which quietly doubled the history.
 *  - **The parsing was duplicated.** `Footer` wrote `#portal?bookingId=`,
 *    `Header` wrote `#portal`, `App` read both back. Three places that had to
 *    agree on a format nothing declared.
 *
 * ## Paths, with the hashes kept
 *
 * `/portal`, `/admin` and `/paystack-success` are the real routes now, and
 * both deployments already serve `index.html` for any path — Vercel by the
 * catch-all rewrite in vercel.json, the Node server by the `app.get('*')`
 * fallback in apps/server/src/index.ts. Nothing new is needed to make them
 * resolve.
 *
 * **The hash forms are not deprecated, they are permanent aliases.** They are
 * in emails that have already been sent (`setup-links.ts` builds
 * `/#portal?setup=…`), and `/#paystack-success` is in the payment callback
 * allowlist that `payments.check.ts` tests. Arriving on one normalises the URL
 * to its path form with `replaceState`, so it is corrected without adding a
 * history entry somebody would have to press Back through twice.
 */

export type RouteName = 'home' | 'portal' | 'admin' | 'paystack-success' | 'not-found';

export interface Route {
  name: RouteName;
  /** The six-digit order a portal link points at, if it named one. */
  bookingId: string | null;
  /**
   * The token from an emailed setup link.
   *
   * A token rather than the `setup=true` flag this used to be. The flag paired
   * with a booking id, and a booking id is six digits: anyone could walk them
   * against the public booking route and claim a stranger's account, which is
   * the whole reason the password screen asks the server what this token opens
   * instead of trusting the URL.
   */
  setupToken: string | null;
}

const HOME: Route = { name: 'home', bookingId: null, setupToken: null };
const NOT_FOUND: Route = { name: 'not-found', bookingId: null, setupToken: null };

/** The path each route lives at. `home` is the site root. */
const PATHS: Record<Exclude<RouteName, 'home' | 'not-found'>, string> = {
  portal: '/portal',
  admin: '/admin',
  'paystack-success': '/paystack-success',
};

function routeFrom(name: RouteName, params: URLSearchParams): Route {
  return {
    name,
    bookingId: params.get('bookingId'),
    setupToken: params.get('setup'),
  };
}

/**
 * Reads the current URL.
 *
 * Path first, hash second. A URL carrying both — which only happens on the way
 * through a normalisation — is read as its path, because that is the one that
 * survived being sent to a server.
 */
export function currentRoute(): Route {
  const { pathname, search, hash } = window.location;

  /*
   * Lowercased, because a path is typed by a person.
   *
   * The desk is reached by someone typing `/admin` into the bar from memory,
   * and `/Admin` matched nothing, fell through to `home` and rendered the
   * marketing page — the same thing the site shows when the URL is right, so
   * there was no way to tell a capital letter from a desk that had stopped
   * working. The hash branch below has always lowercased its name; this is the
   * two halves of one function agreeing.
   *
   * Safe to fold blindly: every path in `PATHS` is lowercase already, and
   * nothing downstream reads the path again — `bookingId` and `setup` come out
   * of the query string, which is left exactly as it was sent.
   */
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  for (const [name, routePath] of Object.entries(PATHS)) {
    if (path === routePath) {
      return routeFrom(name as RouteName, new URLSearchParams(search));
    }
  }

  // The legacy fragment forms: `#portal?bookingId=123456`, `#admin`,
  // `#paystack-success`. Split on the first `?` — the rest is a query string
  // that lives inside the fragment.
  if (hash.length > 1) {
    const body = hash.slice(1);
    const split = body.indexOf('?');
    const name = (split === -1 ? body : body.slice(0, split)).toLowerCase();
    const params = new URLSearchParams(split === -1 ? '' : body.slice(split + 1));

    if (name === 'portal' || name === 'admin' || name === 'paystack-success') {
      return routeFrom(name, params);
    }
  }

  /*
   * An address that named nothing.
   *
   * This used to be `HOME`, so every wrong URL drew the marketing page — the
   * same thing a *right* URL draws. `/admni` for `/admin`, or a capital before
   * the fold above, was therefore indistinguishable from the desk having been
   * taken away, and the only person who could tell them apart was whoever knew
   * what the site looks like when it is working. That is how a typo gets
   * reported as an outage.
   *
   * The root itself stays `home`, and so does any in-page anchor hanging off
   * it: `#services` and `#contact` are how the footer's links work, and a
   * fragment that names no route is a position on the page rather than a wrong
   * address. Only a *path* nobody claimed is not found.
   */
  return path === '/' ? HOME : NOT_FOUND;
}

/** The canonical URL for a route, path form. */
export function href(route: Route): string {
  // Neither has an address of its own: `home` *is* the root, and `not-found` is
  // the absence of a match rather than a place, so the honest URL for both is
  // the root. Nothing navigates *to* `not-found` — it is only ever arrived at.
  if (route.name === 'home' || route.name === 'not-found') return '/';

  const params = new URLSearchParams();
  if (route.bookingId) params.set('bookingId', route.bookingId);
  if (route.setupToken) params.set('setup', route.setupToken);

  const query = params.toString();
  return query ? `${PATHS[route.name]}?${query}` : PATHS[route.name];
}

/**
 * Go somewhere, and tell the app.
 *
 * `pushState` does not fire `popstate` — that event is only for history the
 * *user* moved through — so every caller would otherwise have to remember to
 * notify separately. One event, `freshfold:route`, is dispatched here and
 * `subscribeToRoute` listens for both it and the browser's own.
 */
export function navigate(
  name: Exclude<RouteName, 'not-found'>,
  options: { bookingId?: string | null; setupToken?: string | null; replace?: boolean } = {}
): void {
  const route: Route = {
    name,
    bookingId: options.bookingId ?? null,
    setupToken: options.setupToken ?? null,
  };
  const url = href(route);

  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);

  window.dispatchEvent(new CustomEvent('freshfold:route'));
}

/**
 * Rewrites a legacy `#hash` URL to its path form, once, on arrival.
 *
 * `replaceState`, so the fragment URL does not stay in the history as a step
 * Back has to travel through. Called from main.tsx before React mounts, so the
 * first render already sees the corrected URL and no effect has to reconcile
 * the two forms.
 */
export function normaliseUrl(): void {
  if (!window.location.hash || window.location.hash === '#') return;

  const route = currentRoute();
  // An in-page anchor — `#services`, `#contact` — is not a route and the
  // footer's section links depend on it staying exactly as it is.
  if (route.name === 'home') return;

  window.history.replaceState(null, '', href(route));
}

/** Fires whenever the route changes, however it changed. Returns an unsubscribe. */
export function subscribeToRoute(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener('freshfold:route', listener);
  // Still worth listening to: a link elsewhere on the page can set a fragment,
  // and an emailed hash URL opened in an already-loaded tab arrives this way.
  window.addEventListener('hashchange', listener);

  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('freshfold:route', listener);
    window.removeEventListener('hashchange', listener);
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for URL parsing — which screen a given address opens.
 *
 * Run with `npm run check --workspace @freshfold/web`.
 *
 * `currentRoute` reads `window.location` and returns a plain object, so the
 * only thing standing between it and a check is the global. A three-field stub
 * is enough: it reads `pathname`, `search` and `hash` and nothing else. That is
 * cheaper than a DOM, and it keeps these runnable by `tsx` alongside every
 * other check in the repo.
 *
 * `href` is checked against the same table in the other direction, because the
 * two are only useful if they agree: `normaliseUrl` rewrites a legacy hash by
 * parsing it with one and writing it back with the other, so a disagreement
 * would silently move somebody to the wrong screen on arrival.
 */

import { check, checkTrue, report, section } from './check';
import { currentRoute, href, type Route } from './route';

/**
 * Points the module's view of the browser at `url` and parses it.
 *
 * Assigned through `unknown`: the real `window` is `Window & typeof globalThis`
 * and this is three properties of one of its fields. Narrower would not be
 * honest about what is being faked; wider would be a DOM.
 */
function at(url: string): Route {
  const parsed = new URL(url, 'https://freshfold.example');
  (globalThis as unknown as { window: unknown }).window = {
    location: {
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
  };
  return currentRoute();
}

/** The route name alone, which is all most of these care about. */
const nameAt = (url: string): string => at(url).name;

section('the desk, however it was typed');

// The bug: `path === routePath` is case-sensitive, so a capital fell through to
// `home` and drew the marketing page — the same thing a correct URL draws when
// the desk is closed, so there was no way to tell a typo from an outage. The
// desk is reached by someone typing it from memory, which is exactly where
// capitals come from.
check('/admin opens the desk', nameAt('/admin'), 'admin');
check('/Admin opens the desk', nameAt('/Admin'), 'admin');
check('/ADMIN opens the desk', nameAt('/ADMIN'), 'admin');
check('/aDmIn opens the desk', nameAt('/aDmIn'), 'admin');

check('a trailing slash is the same address', nameAt('/admin/'), 'admin');
check('so are several', nameAt('/admin///'), 'admin');
check('a query string does not hide it', nameAt('/admin?ref=email'), 'admin');

section('the legacy hash forms still land');

// These are permanent aliases, not deprecated spellings: they are in emails
// that have already been sent, and `#paystack-success` is in the payment
// callback allowlist.
check('#admin', nameAt('/#admin'), 'admin');
check('#portal', nameAt('/#portal'), 'portal');
check('#paystack-success', nameAt('/#paystack-success'), 'paystack-success');
check('a hash is case-folded too', nameAt('/#Admin'), 'admin');

section('the other screens');

check('the site root is home', nameAt('/'), 'home');
check('an empty path is home', nameAt(''), 'home');
check('/portal', nameAt('/portal'), 'portal');
check('/paystack-success', nameAt('/paystack-success'), 'paystack-success');

section('a wrong address is not the desk, and says so');

// Two properties at once. Folding case must not fold anything else in — a
// misspelling still has to miss, or the desk would open on addresses nobody
// meant to be the desk. And a miss must now be *legible*: these used to answer
// `home`, which drew the marketing page, so a typo looked exactly like the desk
// having been taken away. That is how this was reported as an outage.
check('a near miss is not found', nameAt('/admni'), 'not-found');
check('a longer path is not found', nameAt('/admin/orders'), 'not-found');
check('a prefix is not found', nameAt('/administrator'), 'not-found');
check('an unrelated path is not found', nameAt('/pricing'), 'not-found');

// The root keeps its meaning. Only a *path* nobody claimed is not found.
check('the root is still home', nameAt('/'), 'home');

// In-page anchors are how the footer's section links work. A fragment naming no
// route is a position on the page, not a wrong address — if one of these
// answered `not-found`, clicking "Contact" would 404 the site.
check('#contact is an anchor, not a miss', nameAt('/#contact'), 'home');
check('#services is an anchor, not a miss', nameAt('/#services'), 'home');
check('an unknown hash on the root is home', nameAt('/#admin-desk'), 'home');
check('a bare hash is home', nameAt('/#'), 'home');

section('what the portal carries with it');

check('a booking id off the query string', at('/portal?bookingId=123456').bookingId, '123456');
check('a setup token', at('/portal?setup=tok_abc').setupToken, 'tok_abc');
check('both at once', at('/portal?bookingId=123456&setup=tok_abc').setupToken, 'tok_abc');
check('and out of a legacy hash', at('/#portal?bookingId=123456').bookingId, '123456');
check('absent when not given', at('/portal').bookingId, null);

// Case folds the *path*, and must stop there: a token is a credential and a
// booking id is looked up verbatim, so folding either would break the lookup.
check('a setup token keeps its case', at('/portal?setup=ToK_AbC').setupToken, 'ToK_AbC');
check('the desk keeps its query too', at('/ADMIN?setup=ToK_AbC').setupToken, 'ToK_AbC');

section('parsing and building agree');

// `normaliseUrl` parses a hash form with `currentRoute` and writes it back with
// `href`. If the two disagree the rewrite lands somewhere else.
for (const url of ['/admin', '/portal', '/paystack-success']) {
  check(`${url} survives a round trip`, href(at(url)), url);
}

check(
  'a portal link keeps its booking id',
  href(at('/portal?bookingId=123456')),
  '/portal?bookingId=123456'
);
check('home builds as the root', href(at('/')), '/');
check('and so does an address that names nothing', href(at('/admni')), '/');

checkTrue(
  'a capital normalises to the canonical spelling',
  href(at('/ADMIN')) === '/admin'
);

report();

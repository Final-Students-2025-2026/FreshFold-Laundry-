/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Asks a deployed site whether the supervisor desk is still there.
 *
 * ```
 * npm run smoke --workspace @freshfold/web
 * npm run smoke --workspace @freshfold/web -- https://some-preview.vercel.app
 * ```
 *
 * ## Why this is separate from `check`
 *
 * `npm run check` is hermetic and runs on every change. This talks to the
 * internet and is about one deployment at one moment, so it is deliberately
 * *not* part of `npm test` — a suite that fails because Render was asleep is a
 * suite people learn to ignore. Run it after a deploy, or on a schedule from
 * wherever you would run a cron.
 *
 * ## What it can prove, and what it cannot
 *
 * The desk's sign-in form is drawn by React in the browser, so no amount of
 * fetching will see it: `/admin` returns the same `index.html` as every other
 * address. This checks the things that *are* visible over HTTP, and the middle
 * one is the one with teeth:
 *
 *  - the route is served at all, rather than 404ing past the SPA rewrite;
 *  - the JavaScript actually deployed contains the desk — its login chunk and
 *    the strings this app's desk is built from. A stale or misconfigured deploy
 *    serving an older build is precisely the failure this catches, and it is
 *    the one that had us looking at the wrong branch for a round;
 *  - the API behind it answers, and answers as our server rather than as a
 *    gateway apologising for it.
 *
 * What it cannot tell you is whether the form *renders* — that needs a real
 * browser, which would mean a headless-browser dependency this repo has no
 * other use for. `route.check.ts` and `desk.check.ts` cover the logic that
 * decides whether it renders; this covers whether the right code is out there.
 */

import process from 'node:process';
import { check, checkTrue, report, section } from './check';

/** Where the site lives, unless something else was named on the command line. */
const DEFAULT_ORIGIN = 'https://freshfoldb.vercel.app';

const origin = (process.argv[2] || DEFAULT_ORIGIN).replace(/\/$/, '');

/** Long enough for a Render dyno to wake, which is the slow case worth waiting for. */
const TIMEOUT_MS = 90_000;

async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'cache-control': 'no-cache' },
  });
  return { status: response.status, body: await response.text() };
}

console.log(`\nSmoke-testing ${origin}\n`);

section('the desk route is served');

const admin = await get('/admin');
check('/admin answers 200', admin.status, 200);

// The SPA rewrite is what makes a path that only exists in the client resolve
// at all. Without it this is a 404 page, and every deep link into the site is
// broken along with the desk.
const entry = admin.body.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
checkTrue('it serves the app rather than a 404 page', entry !== null);

section('the deployed build contains the desk');

// The failure this exists for: a deploy that succeeded while serving something
// older than the code you think is live. Fetching the entry bundle and looking
// for the desk in it is the cheapest way to tell from outside.
const bundle = entry ? (await get(entry)).body : '';

checkTrue('the entry bundle is fetchable', bundle.length > 0);
checkTrue(
  'the desk login is in the deployed JavaScript',
  bundle.includes('Supervisor desk') || bundle.includes('AdminLogin')
);
checkTrue(
  'the session check has something to draw while it runs',
  bundle.includes('Checking your desk session')
);
checkTrue('the router folds case, so /Admin resolves', bundle.includes('toLowerCase'));

section('the dispatch server behind it answers');

const health = await get('/api/health');
check('/api/health answers 200', health.status, 200);

// A 502/503/504 here is the gateway in front of the server, not the server —
// which is a different fault with a different fix, so it is worth the site
// saying which one it is looking at.
checkTrue(
  'and it is our server answering, not a gateway',
  (() => {
    try {
      return (JSON.parse(health.body) as { ok?: boolean }).ok === true;
    } catch {
      return false;
    }
  })()
);

report();

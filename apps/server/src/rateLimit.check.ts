/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * That a limiter cannot be turned into the attack it exists to stop.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * Three limiters bucket on a value the caller chooses — an email and a phone
 * number on `/auth/register`, a job id in the URL on `PATCH /orders/:id/status`
 * — and the map holding those buckets had no ceiling. Worse, the sweep meant to
 * bound it ran on *every* request that opened a bucket once the map passed five
 * thousand, and deleted nothing: every entry was younger than the window,
 * because the caller had just made it. So each request paid to walk everything
 * the requests before it had created.
 *
 * Measured on the code this replaced: 610,000 requests a second under five
 * thousand buckets, 9,700 at ten thousand, 508 at two hundred thousand — where
 * two hundred thousand requests took six and a half minutes of solid CPU and
 * 48 MB, from a caller with no account and no token. The window is an hour, so
 * fifty-five requests a second is enough to build that and nothing expires
 * while it is being built.
 *
 * The ratio assertion below is the one that matters, and it is written as a
 * ratio on purpose: wall-clock thresholds turn into flakes on a slow CI box,
 * while "the ten-thousandth request must not cost hundreds of times the first"
 * is the actual property and is true on any machine.
 */

import { rateLimit, type RateLimiter } from './rateLimit';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${a}\n        want ${e}`}`
  );
}

function checkTrue(label: string, actual: boolean): void {
  check(label, actual, true);
}

function section(title: string): void {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 55 - title.length))}`);
}

/** Enough of a response for the middleware; nothing here reads it back. */
function fakeRes(): { status: () => unknown; json: () => unknown } {
  const res = { status: () => res, json: () => res };
  return res;
}

type Fire = (key: string) => Promise<void>;

/** A limiter keyed on a caller-supplied string, as three real ones are. */
function keyed(max: number, windowMs: number) {
  const mw = rateLimit({
    max,
    windowMs,
    message: 'too many',
    key: (req) => (req.params as { id: string }).id,
  });

  const fire: Fire = (key) =>
    new Promise((resolve) => {
      mw({ params: { id: key }, body: {}, ip: '1.2.3.4' } as never, fakeRes() as never, () =>
        resolve()
      );
    });

  return { mw, fire };
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  section('a flood of invented keys cannot grow the map without bound');

  const { mw, fire } = keyed(10, 60 * 60 * 1000);

  let seen = 0;
  const burst = async (n: number): Promise<number> => {
    const started = process.hrtime.bigint();
    for (let i = 0; i < n; i += 1) await fire(`invented-${seen++}`);
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  const first = await burst(5_000);
  checkTrue('the first five thousand are held', mw.buckets() > 0);

  for (let more = 0; more < 6; more += 1) await burst(5_000);
  const last = await burst(5_000);

  check('forty thousand invented keys, still capped', mw.buckets() <= 10_000, true);
  checkTrue('...and the cap is actually being reached', mw.buckets() >= 9_000);

  /**
   * The quadratic check. Before the ceiling, this ratio was about 390 — the
   * last five thousand requests cost hundreds of times what the first did,
   * because each one swept everything before it. A generous bound: what is
   * being caught is a return to sweeping per request, not ordinary variance.
   */
  const ratio = last / Math.max(first, 1);
  checkTrue(
    `the ten-thousandth request costs no more than the first (${ratio.toFixed(1)}x)`,
    ratio < 25
  );

  section('...and the limiter still limits');

  /**
   * Bounding the map must not have cost the thing it bounds. A key that has not
   * been evicted is still counted, and still refused on the attempt after its
   * allowance.
   */
  const { mw: counting, fire: count } = keyed(3, 60 * 1000);

  let refusedAt = 0;
  for (let attempt = 1; attempt <= 6 && refusedAt === 0; attempt += 1) {
    let passed = false;
    await new Promise<void>((resolve) => {
      counting(
        { params: { id: 'one-caller' }, body: {}, ip: '1.2.3.4' } as never,
        fakeRes() as never,
        () => {
          passed = true;
          resolve();
        }
      );
      // A refusal never calls next, so resolve on the next tick either way.
      setImmediate(resolve);
    });
    if (!passed) refusedAt = attempt;
  }

  check('a caller is refused on the attempt after its allowance', refusedAt, 4);

  section('and a fresh key still counts after a flood');

  /**
   * The mechanism has to survive the eviction, not merely tolerate it. After
   * forty thousand invented keys have churned through the first limiter, a key
   * arriving now must still get exactly its allowance.
   */
  await count('after-the-flood');
  await count('after-the-flood');
  await count('after-the-flood');

  let refusedAfterFlood = false;
  await new Promise<void>((resolve) => {
    counting(
      { params: { id: 'after-the-flood' }, body: {}, ip: '1.2.3.4' } as never,
      fakeRes() as never,
      () => resolve()
    );
    setImmediate(() => {
      refusedAfterFlood = true;
      resolve();
    });
  });

  checkTrue('a fourth attempt on a fresh key is still refused', refusedAfterFlood);

  // -------------------------------------------------------------------------
  section('a shared proxy address is subdivided, and cannot be escaped');

  /**
   * The website reaches this server through Vercel's rewrite, so `req.ip` is
   * the Vercel edge for every visitor and one bucket held the whole site. The
   * fix cannot be to trust a second hop — the same service answers the mobile
   * apps directly, so the extra entry would be one the caller wrote. So a
   * claimed client subdivides the address's bucket and is bounded in aggregate
   * by it. These are the two halves of that: honest visitors stop spending
   * each other's allowance, and a forger cannot spend more than the multiple.
   */
  /** A limiter behind one proxy address, with room for three clients. */
  const behindProxy = () =>
    rateLimit({ max: 2, windowMs: 60 * 1000, message: 'too many', sharedClients: 3 });

  /** One request from `claimed`, arriving through the proxy at `1.1.1.1`. */
  const throughProxy = (mw: RateLimiter, claimed: string): Promise<boolean> =>
    new Promise((resolve) => {
      let passed = false;
      mw(
        {
          params: {},
          body: {},
          ip: '1.1.1.1',
          ips: ['1.1.1.1'],
          headers: { 'x-forwarded-for': `${claimed}, 1.1.1.1` },
        } as never,
        fakeRes() as never,
        () => {
          passed = true;
          resolve(true);
        }
      );
      setImmediate(() => resolve(passed));
    });

  const allowed = async (mw: RateLimiter, claimed: string, n: number): Promise<number> => {
    let through = 0;
    for (let i = 0; i < n; i += 1) if (await throughProxy(mw, claimed)) through += 1;
    return through;
  };

  // Three visitors, each spending exactly its own allowance. Before this they
  // shared one bucket and the second was refused halfway through.
  const sharing = behindProxy();
  check('the first visitor behind a proxy gets its allowance', await allowed(sharing, '9.0.0.1', 2), 2);
  check("...and has not spent the second visitor's", await allowed(sharing, '9.0.0.2', 2), 2);
  check("...nor the third visitor's", await allowed(sharing, '9.0.0.3', 2), 2);

  // The ceiling is still the stated one, per visitor.
  check('a visitor is held to the stated ceiling', await allowed(behindProxy(), '9.0.0.9', 5), 2);

  /**
   * And the aggregate is the bound that matters: `max * sharedClients` is six,
   * so a forger inventing a fresh client for every pair of requests is cut off
   * at six however many identities he claims. A subdivision is not an escape.
   */
  const forging = behindProxy();
  let forged = 0;
  for (let i = 0; i < 20; i += 1) forged += await allowed(forging, `invented-${i}`, 2);

  check('twenty invented clients still buy only the aggregate', forged, 6);

  /**
   * And with no surplus in the chain there is nothing claimed, so the direct
   * path keys on the address exactly as it did before any of this existed.
   */
  const direct = rateLimit({ max: 2, windowMs: 60 * 1000, message: 'too many', sharedClients: 3 });

  const straight = (): Promise<boolean> =>
    new Promise((resolve) => {
      let passed = false;
      direct(
        {
          params: {},
          body: {},
          ip: '5.5.5.5',
          ips: ['5.5.5.5'],
          headers: { 'x-forwarded-for': '5.5.5.5' },
        } as never,
        fakeRes() as never,
        () => {
          passed = true;
          resolve(true);
        }
      );
      setImmediate(() => resolve(passed));
    });

  let straightThrough = 0;
  for (let i = 0; i < 4; i += 1) if (await straight()) straightThrough += 1;

  check('a direct caller is held to the stated ceiling', straightThrough, 2);
  check('...and opened one bucket, not two', direct.buckets(), 1);

  section('and a request with nothing to bucket on is waved through');

  const skipping = rateLimit({
    max: 1,
    windowMs: 60 * 1000,
    message: 'too many',
    key: () => null,
  });

  let wavedThrough = 0;
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => {
      skipping({ params: {}, body: {} } as never, fakeRes() as never, () => {
        wavedThrough += 1;
        resolve();
      });
    });
  }

  check('a null key skips the limiter every time', wavedThrough, 5);
  check('...and stores nothing', skipping.buckets(), 0);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

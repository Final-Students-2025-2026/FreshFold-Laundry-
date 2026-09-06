/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What creating an account costs a stranger, and what a 500 tells one.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * Two findings, both about what the API gives away to somebody who has not
 * signed in.
 *
 * `/auth/register` carried no rate limit at all. The comment by `/login`
 * explaining the omission — "`/register` creates rather than guesses" — was
 * true about guessing and wrong about cost: each call mails a confirmation to
 * an address the caller chose, spends the month's quota doing it, runs a
 * blocking `scryptSync`, and answers 409 or 201 in a way that says whether the
 * address is already a customer.
 *
 * `guard()` wraps every async route in the product and answered a rejected
 * promise with `error.message` verbatim, so one malformed request against any
 * of ~90 routes returned the table, column and constraint that failed.
 *
 * `/auth/reset` had no limiter either, and the comment by `/login` explaining
 * *that* omission — "`/reset` needs a 32-byte token before it does anything at
 * all" — was simply not true of the code. It derived a full scrypt hash of the
 * caller's password, 64 MB and the better part of a second on a threadpool four
 * wide, and only then looked the token up to find out whether the request had
 * ever been legitimate. Roughly nine a second from one address took the process
 * off the air.
 *
 * The register and reset assertions drive the *real* router. They use a
 * deliberately short password so the handler refuses at validation — before it
 * hashes anything and before it touches the store — which is what lets this run
 * without a database while still proving each limiter is mounted on the route
 * that ships rather than on a copy of it.
 *
 * That same absence of a database is why the *ordering* inside `/reset` is
 * asserted against the source rather than by timing a request: proving the
 * lookup happens first means letting it happen, and there is nothing here for
 * it to happen against. `headers.check.ts` reads `vercel.json` and the built
 * page the same way and for the same reason.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authRouter, looksLikeContact } from './routes/auth';
import { guard } from './helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

interface Reply {
  status: number;
  body: {
    error?: string;
    reference?: string;
    detail?: string;
    exists?: boolean;
    hasPassword?: boolean;
  };
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  // Two routes that exist only here, to exercise the wrapper itself.
  app.get(
    '/boom',
    guard(async () => {
      throw new Error('relation "accounts" violates unique constraint "accounts_email_lower_idx"');
    })
  );
  app.get(
    '/boom-nonerror',
    guard(async () => {
      throw 'a bare string, because not everything thrown is an Error';
    })
  );

  const server = app.listen(4613);
  await new Promise((resolve) => server.once('listening', resolve));

  const get = async (path: string): Promise<Reply> => {
    const res = await fetch(`http://127.0.0.1:4613${path}`);
    return { status: res.status, body: (await res.json()) as Reply['body'] };
  };

  /** A register attempt that fails validation before any hashing or lookup. */
  const register = async (email: string, phone: string): Promise<Reply> => {
    const res = await fetch('http://127.0.0.1:4613/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone, password: 'x' }),
    });
    return { status: res.status, body: (await res.json()) as Reply['body'] };
  };

  /**
   * A reset attempt that fails validation before any hashing or lookup.
   *
   * Same trick as `register` above and for the same reason: the one-character
   * password is refused by `passwordProblem`, which sits above both the token
   * lookup and the hash — so this reaches the real handler on the real router
   * and stops short of the database this suite does not have.
   */
  const reset = async (): Promise<Reply> => {
    const res = await fetch('http://127.0.0.1:4613/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64), password: 'x' }),
    });
    return { status: res.status, body: (await res.json()) as Reply['body'] };
  };

  // -------------------------------------------------------------------------
  section('what a 500 says in production');

  /**
   * `guard` reads `NODE_ENV` inside the catch, so the branch can be selected
   * per request. Production is the one that matters: it is the deployment a
   * stranger can reach, and the assertion is about the *whole* body rather than
   * one field, because a leak in `detail` is a leak.
   *
   * The stack traces printed between these lines are the control working — the
   * real error goes to the log, which is the only place it now appears.
   */
  const wasProduction = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const boom = await get('/boom');
  check('a thrown error is still a 500', boom.status, 500);
  check('the message is fixed', boom.body.error, 'Something went wrong on our end. Please try again.');
  checkTrue('nothing in the body names a table', !JSON.stringify(boom.body).includes('accounts'));
  checkTrue('nothing in the body names a constraint', !JSON.stringify(boom.body).includes('constraint'));
  checkTrue('the developer detail is withheld entirely', boom.body.detail === undefined);
  checkTrue('a reference is issued', /^[0-9a-f]{8}$/.test(boom.body.reference ?? ''));

  const second = await get('/boom');
  checkTrue('two failures get different references', boom.body.reference !== second.body.reference);

  const bare = await get('/boom-nonerror');
  check('something thrown that is not an Error is still handled', bare.status, 500);
  checkTrue('and still gives nothing away', !JSON.stringify(bare.body).includes('bare string'));

  section('...and what it adds outside production');

  process.env.NODE_ENV = 'development';

  const dev = await get('/boom');
  checkTrue('a developer still gets the real message', (dev.body.detail ?? '').includes('constraint'));
  checkTrue('but never in the field a client displays', !(dev.body.error ?? '').includes('constraint'));
  check('and the fixed message is the same one', dev.body.error, boom.body.error);

  process.env.NODE_ENV = wasProduction;

  // -------------------------------------------------------------------------
  section('registering is no longer free');

  // Same address four times. The first three are refused on the password, which
  // proves the request reached the handler; the fourth is refused before it.
  const one = await register('flood@example.test', '0244000001');
  check('a first attempt reaches the handler', one.status, 400);
  checkTrue('...and is refused on its contents', (one.body.error ?? '').includes('Password'));

  await register('flood@example.test', '0244000001');
  await register('flood@example.test', '0244000001');

  const fourth = await register('flood@example.test', '0244000001');
  check('the fourth attempt on one address is refused', fourth.status, 429);
  checkTrue('...as a sign-up, not as a sign-in', (fourth.body.error ?? '').includes('sign-up'));
  /**
   * The limit must not become the oracle it was added to close. What matters is
   * that a refused attempt says the same thing whichever address it names — not
   * that the sentence avoids particular words, which is how an earlier version
   * of this assertion managed to fail on the word "already" in our own copy.
   */
  const refusedKnown = await register('flood@example.test', '0244000001');
  check('a refusal is byte-identical whoever it is about', refusedKnown.body.error, fourth.body.error);
  check('...and carries the same status', refusedKnown.status, fourth.status);

  section('and a phone number cannot be walked either');

  // A fresh email each time, so the address bucket above never fills. Without a
  // bucket on the number, this is how the 409 gets used to enumerate phones.
  await register('walk1@example.test', '0244000002');
  await register('walk2@example.test', '0244000002');
  await register('walk3@example.test', '0244000002');

  const fourthPhone = await register('walk4@example.test', '0244000002');
  check('the fourth attempt on one number is refused', fourthPhone.status, 429);

  const spaced = await register('walk5@example.test', '+233 24 400 0002');
  check('the same number written differently shares the bucket', spaced.status, 429);

  section('and one caller cannot spread it around');

  // Distinct addresses and distinct numbers, so only the per-caller bucket is
  // left to stop this. Bounded rather than exact: the two sections above have
  // already spent some of the same allowance, and asserting a precise remainder
  // would be asserting the arithmetic of this file rather than the limiter.
  let blocked = false;
  for (let attempt = 0; attempt < 12 && !blocked; attempt += 1) {
    const reply = await register(`spread${attempt}@example.test`, `02440100${attempt % 10}${attempt}`);
    if (reply.status === 429) blocked = true;
  }
  checkTrue('a caller using fresh details every time is still stopped', blocked);

  // -------------------------------------------------------------------------
  section('and setting a new password is metered too');

  // Ten through, the eleventh refused. Each of the ten reaches the handler and
  // is turned away on the password, which is what proves the limiter is on the
  // shipped route rather than in front of a copy of it.
  const firstReset = await reset();
  check('a first attempt reaches the handler', firstReset.status, 400);
  checkTrue('...and is refused on its contents', (firstReset.body.error ?? '').includes('Password'));

  for (let attempt = 1; attempt < 10; attempt += 1) await reset();

  const eleventh = await reset();
  check('the eleventh attempt in the window is refused', eleventh.status, 429);
  checkTrue(
    '...as a reset, not as a sign-in',
    (eleventh.body.error ?? '').includes('set a new password')
  );

  section('and a bad link costs a lookup, not a hash');

  /**
   * Asserted against the source, because the alternative is a database.
   *
   * The property is an ordering: the token lookup has to come *before* the
   * scrypt derivation, so that a caller holding a token this server never
   * issued is refused for the price of a `select`. Timing it would mean letting
   * the lookup run, and there is nothing here for it to run against — so the
   * order is read off the handler instead. Scoped to the POST, because the GET
   * above it looks the same token up and would otherwise satisfy this on its
   * own.
   */
  const source = fs.readFileSync(path.resolve(HERE, 'routes', 'auth.ts'), 'utf8');

  // Matched loosely rather than as a literal: this file is checked out with
  // CRLF endings on Windows and LF elsewhere, and an anchor that hard-codes
  // either one is an assertion about the working copy instead of about the
  // handler. The same goes for how the arguments happen to be wrapped today.
  const opens = source.search(/authRouter\.post\(\s*'\/reset',/);
  const closes = source.indexOf('function resetPage(');
  checkTrue('the POST /reset handler was located', opens !== -1 && closes > opens);

  /**
   * Comments stripped before anything is measured.
   *
   * The note above the lookup explains what `hashPassword` used to do and where
   * it used to sit, so it names the call some lines *before* the call it is
   * describing — and an ordering read off the raw text finds the sentence and
   * reports the bug it was written to record as still present. What is being
   * asserted is the order of two statements, so prose has to go first.
   */
  const handler = source
    .slice(opens, closes)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');

  const lookupAt = handler.indexOf('findByResetToken(');
  const hashAt = handler.indexOf('hashPassword(');

  checkTrue('it looks the token up', lookupAt !== -1);
  checkTrue('it still hashes the new password', hashAt !== -1);
  checkTrue('and the lookup comes first', lookupAt < hashAt);
  checkTrue('the limiter is mounted on it', handler.includes('resetLimit'));

  /**
   * The fast refusal must not become an oracle.
   *
   * Two paths now say no to a spent link — the pre-check and the transaction —
   * and if their wording ever diverges, the difference tells a caller which one
   * turned them away, which is a way to ask whether a link is still live. The
   * sentence appearing twice is what keeps them the same.
   */
  const spent = 'That link has expired or has already been used.';
  check('both refusals use one sentence', handler.split(spent).length - 1, 2);

  // -------------------------------------------------------------------------
  section('asking who banks here is metered');

  /**
   * A `/status` lookup that stops at the shape gate.
   *
   * `not-a-contact` is neither an email nor a whole phone number, so the route
   * answers it without a query — which is what lets the limiter be exercised
   * here at all. The matching path needs the database this suite does not have,
   * so `looksLikeContact` is asserted directly below instead.
   */
  const status = async (): Promise<Reply> => {
    const res = await fetch('http://127.0.0.1:4613/api/auth/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'not-a-contact' }),
    });
    return { status: res.status, body: (await res.json()) as Reply['body'] };
  };

  const firstStatus = await status();
  check('a first lookup reaches the handler', firstStatus.status, 200);

  /**
   * The whole body, not one field. This route's entire risk is what it says
   * about a contact, so an assertion that checked only `exists` would not
   * notice a name, an email or a `blockedAt` arriving beside it.
   */
  check('and answers with two booleans and nothing else', firstStatus.body, {
    exists: false,
    hasPassword: false,
  });

  for (let attempt = 1; attempt < 10; attempt += 1) await status();

  const eleventhStatus = await status();
  check('the eleventh lookup in the window is refused', eleventhStatus.status, 429);
  checkTrue(
    '...and says so without naming a contact',
    (eleventhStatus.body.error ?? '').includes('Too many lookups') &&
      !(eleventhStatus.body.error ?? '').includes('not-a-contact')
  );

  section('...and garbage never reaches the database');

  /**
   * The real predicate the route gates on, imported rather than copied.
   *
   * Polarity is the thing worth pinning. Getting this backwards would refuse
   * every genuine customer at the gate and answer "no account" to all of them —
   * a silent break of the one feature the route exists for, and one that no
   * assertion about garbage input would catch on its own.
   */
  checkTrue('an email is worth a lookup', looksLikeContact('ama@example.test'));
  checkTrue('a whole phone number is too', looksLikeContact('0244000000'));
  checkTrue('...however it is written', looksLikeContact('+233 24 400 0000'));
  checkTrue('a bare word is not', !looksLikeContact('not-a-contact'));
  checkTrue('nor is an empty string', !looksLikeContact(''));
  checkTrue('nor half a phone number', !looksLikeContact('0244'));
  checkTrue('nor an address with no domain', !looksLikeContact('ama@'));

  // -------------------------------------------------------------------------
  section('both rendered pages escape what they interpolate');

  /**
   * The two server-rendered pages are near-identical and sat forty lines apart
   * having quietly reached different conclusions: the reset form escaped what
   * it interpolated and the confirmation page did not.
   *
   * Nothing hostile reaches either today — every caller passes a literal, and
   * `home` is `APP_URL`, which is our own configuration. That is precisely the
   * argument that stops being true the day somebody puts a value from anywhere
   * else through one of these, so it is pinned rather than argued.
   *
   * Driven through `APP_URL` because that is the one input to either page a
   * test can actually set. Both routes render without a token, and without a
   * token neither touches the database.
   */
  const html = async (path: string): Promise<string> => {
    const res = await fetch(`http://127.0.0.1:4613${path}`);
    return res.text();
  };

  const wasAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://x.test/"><script>alert(1)</script>';

  for (const [label, path] of [
    ['the confirmation page', '/api/auth/verify'],
    ['the reset page', '/api/auth/reset'],
  ] as const) {
    const body = await html(path);
    checkTrue(`${label} renders`, body.includes('FreshFold'));
    checkTrue(`...and does not emit a raw <script`, !body.includes('<script>alert(1)'));
    checkTrue(`...and does not break out of the href`, !body.includes('/"><'));
    checkTrue(`...having escaped it instead`, body.includes('&quot;') || body.includes('&lt;'));
  }

  process.env.APP_URL = wasAppUrl;

  // -------------------------------------------------------------------------
  section('the health check reports health, not the order book');

  /**
   * Asserted against the source because `index.ts` opens a port and connects to
   * Postgres the moment it is imported, so there is nothing here to drive. The
   * route lives beside the router this file already covers, and there is no
   * `index.check.ts` to put this in.
   *
   * What is being kept out is live job and rider counts, which this answered to
   * anyone who asked. Polled daily by a stranger, those two integers are a
   * growth chart and a headcount.
   */
  const index = fs.readFileSync(path.resolve(HERE, 'index.ts'), 'utf8');
  const healthAt = index.indexOf("'/api/health'");
  const healthEnd = index.indexOf("app.use('/api/admin'");
  checkTrue('the health route was located', healthAt !== -1 && healthEnd > healthAt);

  const health = index
    .slice(healthAt, healthEnd)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');

  checkTrue('it still answers ok', health.includes('ok: true'));
  checkTrue('it still reports a database it cannot reach', health.includes('503'));
  checkTrue('but counts no jobs', !health.includes('jobs.count()'));
  checkTrue('and counts no riders', !health.includes('riders.count()'));

  server.close();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

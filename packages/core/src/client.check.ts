/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for the API client's request budget.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * The behaviour under test is the one described on `COLD_START_TIMEOUT_MS`: a
 * host that may have to be woken gets a minute to do it, and only until it has
 * proved it is running. It is worth assertions because every part of it is
 * invisible from the outside — the symptom of getting it wrong is not a wrong
 * answer but a right answer that arrives after the caller stopped listening,
 * and the customer is told to check their connection.
 *
 * Real timers, with the two budgets shrunk to milliseconds and a stub `fetch`
 * that answers in between them. That keeps the whole file under a second while
 * still exercising the actual `setTimeout`/`AbortController` path rather than a
 * model of it. The clock is injected only where a test needs to skip forward
 * further than it is willing to wait.
 */

import { checkTrue, report, section } from './check';
import {
  ApiError,
  COLD_AFTER_IDLE_MS,
  createClient,
  failureMessage,
  isUnreachable,
  TimeoutError,
} from './client';

const REMOTE = 'https://freshfold-server.onrender.com';
const LAN = 'http://192.168.100.39:4000';

/** Budgets small enough to run, far enough apart to tell which one was used. */
const SHORT = 25;
const LONG = 250;
/** Comfortably over `SHORT` and under `LONG`, so it distinguishes them. */
const REPLY_AFTER = 100;

/**
 * A `fetch` that takes `ms` to answer, and honours an abort while it waits.
 *
 * The abort branch is the point of the stub: a `fetch` that ignored the signal
 * would resolve every request eventually and every assertion here would pass
 * whatever budget the client had chosen.
 */
function respondsIn(ms: number, status = 200): typeof fetch {
  return ((_url: unknown, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify({ ok: true, version: '1.0.0' }), {
              status,
              headers: { 'Content-Type': 'application/json' },
            })
          ),
        ms
      );
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    })) as typeof fetch;
}

/**
 * A cold start with the timing Render actually gives one.
 *
 * The router turns the first request away in no time at all — it has nothing
 * behind it to forward to yet — and that refusal is what starts the boot, so
 * every request after it is held for as long as the boot takes. Both halves
 * matter: a stub that only ever answered 502 could not tell a client that
 * spends its budget from one that has thrown it away.
 */
function coldStart(): typeof fetch {
  let woken = false;
  return ((url: string, init?: RequestInit) => {
    const stage = woken ? respondsIn(REPLY_AFTER) : respondsIn(1, 502);
    woken = true;
    return stage(url, init);
  }) as typeof fetch;
}

/** Whether a call came back at all — the only thing these assertions ask. */
async function answered(call: Promise<unknown>): Promise<boolean> {
  try {
    await call;
    return true;
  } catch {
    return false;
  }
}

section('a host that can sleep');

{
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: SHORT,
    coldStartMs: LONG,
    fetchImpl: respondsIn(REPLY_AFTER),
  });

  checkTrue(
    'the first request waits out a cold start',
    await answered(api.health())
  );
  checkTrue(
    'a proven server is held to the short timeout',
    !(await answered(api.health()))
  );
}

{
  // A 401 is the shape of a mistyped password, and the server had to be awake
  // to send it. Waiting a minute on the next attempt would punish the retry.
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: SHORT,
    coldStartMs: LONG,
    fetchImpl: respondsIn(REPLY_AFTER, 401),
  });

  // The first call spends the cold budget and comes back with the refusal.
  await answered(api.health());

  checkTrue(
    'a refusal still counts as proof of a woken server',
    !(await answered(api.health()))
  );
}

{
  // The case the whole budget exists for, and the one it used to be spent on
  // and then withheld from. Render's router answers 502 in under a second
  // while the process behind it boots, so that reply arrives long before the
  // cold start is over — and if it counts as proof of a woken server, the next
  // request is held to `timeoutMs` and aborts in the middle of the wake it was
  // supposed to sit through. A desk opened after an idle spell then reported
  // no connection for the whole fifty seconds, over a board it could not
  // refresh, on a service that was starting up perfectly well.
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: SHORT,
    coldStartMs: LONG,
    fetchImpl: coldStart(),
  });

  // The gateway's refusal, which arrives whether or not anything is awake.
  await answered(api.health());

  checkTrue(
    'a gateway answer is not proof of a woken server',
    await answered(api.health())
  );
}

{
  let clock = 1_000_000;
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: SHORT,
    coldStartMs: LONG,
    now: () => clock,
    fetchImpl: respondsIn(REPLY_AFTER),
  });

  await api.health();
  clock += COLD_AFTER_IDLE_MS + 1;

  checkTrue(
    'a server unheard from for long enough is doubted again',
    await answered(api.health())
  );
}

section('a host that cannot');

{
  const api = createClient({
    baseUrl: LAN,
    timeoutMs: SHORT,
    fetchImpl: respondsIn(REPLY_AFTER),
  });

  checkTrue(
    'a LAN server is never waited on for a wake it cannot need',
    !(await answered(api.health()))
  );
}

{
  const api = createClient({
    baseUrl: LAN,
    timeoutMs: SHORT,
    coldStartMs: LONG,
    fetchImpl: respondsIn(REPLY_AFTER),
  });

  checkTrue(
    'an explicit budget overrides the guess the hostname invites',
    await answered(api.health())
  );
}

{
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: SHORT,
    coldStartMs: 0,
    fetchImpl: respondsIn(REPLY_AFTER),
  });

  checkTrue('zero opts out of the wait entirely', !(await answered(api.health())));
}

section('what a failed reply says');

/** The message a call rejected with, or '' if it did not reject. */
async function messageFrom(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return '';
  } catch (error) {
    return error instanceof ApiError ? error.message : '';
  }
}

{
  // The gateway's own answer: a status, and a body with no `error` in it. This
  // is what a supervisor met on the sign-in form while Render was waking, and
  // what it used to read out was the method, the path and the number.
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: LONG,
    coldStartMs: 0,
    fetchImpl: respondsIn(1, 502),
  });

  const message = await messageFrom(api.health());

  checkTrue(
    'a gateway failure is not read out as a request trace',
    !message.includes('502') && !message.includes('/health')
  );
  checkTrue(
    'a gateway failure says the server may be starting up',
    message.toLowerCase().includes('starting back up')
  );
}

{
  // And the server's own refusal keeps its wording — the fallback must not
  // reach a reply that came from us. `/health` answers 503 with an `error`
  // field when Postgres is unreachable, which is the collision worth pinning.
  const stated = ((_url: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: false, error: 'Database unreachable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    )) as typeof fetch;

  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: LONG,
    coldStartMs: 0,
    fetchImpl: stated,
  });

  checkTrue(
    'a stated error survives a status the gateway also uses',
    (await messageFrom(api.health())) === 'Database unreachable'
  );
}

section('reached, or not reached at all');

{
  /**
   * The predicate the offline mirror turns on.
   *
   * `apps/web` used to call every rejection a dropped connection, so a desk
   * whose twelve-hour session had aged out sat behind a “no connection” banner
   * while the server answered its 401 in milliseconds — and the board it was
   * covering could not be refreshed for as long as it stayed there. These pin
   * the two halves apart, because both readings look identical from the
   * `catch` that has to choose between them.
   */
  checkTrue(
    'a refused desk token is not a lost connection',
    !isUnreachable(new ApiError('Session expired', 401))
  );
  checkTrue(
    'nor is a scope the server will not grant',
    !isUnreachable(new ApiError('Ask for one order’s messages by id.', 403))
  );
  checkTrue(
    'nor is a fault the server owns up to',
    !isUnreachable(new ApiError('GET /bookings failed (500)', 500))
  );

  // The proxy answering for a process that did not answer it. The reply
  // arrived, but not from the server, so this is what unreachable looks like.
  for (const status of [502, 503, 504]) {
    checkTrue(
      `a ${status} from the gateway means the server was not reached`,
      isUnreachable(new ApiError('The dispatch server is not answering just now.', status))
    );
  }

  // Everything that is not a reply at all.
  checkTrue(
    'a dropped connection is unreachable',
    isUnreachable(new TypeError('Failed to fetch'))
  );
  checkTrue(
    'so is our own timeout firing',
    isUnreachable(new DOMException('The operation was aborted.', 'AbortError'))
  );
  checkTrue(
    'and so is the error it is now reported as',
    isUnreachable(new TimeoutError(8000))
  );
}

section('a timeout says something a person can read');

/**
 * The bug these pin down reached a supervisor's screen.
 *
 * Aborting a `fetch` rejects with whatever the platform calls it — in Chrome,
 * `signal is aborted without reason` — and every screen in `apps/web` renders
 * `error.message`, so that string went into a toast on the hub desk. The class
 * exists to put a sentence there instead; these check that the swap actually
 * happens on the timeout path, and only on it.
 */
{
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: SHORT,
    coldStartMs: 0,
    fetchImpl: respondsIn(REPLY_AFTER),
  });

  let caught: unknown;
  try {
    await api.health();
  } catch (error) {
    caught = error;
  }

  checkTrue('a request that runs out of budget throws TimeoutError', caught instanceof TimeoutError);
  checkTrue(
    'and carries a sentence rather than the platform’s abort text',
    caught instanceof Error && !caught.message.includes('abort')
  );
}

{
  // The other half: a reply that arrives is never re-labelled as a timeout, no
  // matter how close to the budget it lands. `coldStartMs: 0` holds every
  // request to `timeoutMs`, and the stub answers well inside it.
  const api = createClient({
    baseUrl: REMOTE,
    timeoutMs: LONG,
    coldStartMs: 0,
    fetchImpl: respondsIn(REPLY_AFTER, 401),
  });

  let caught: unknown;
  try {
    await api.health();
  } catch (error) {
    caught = error;
  }

  checkTrue('a refusal that arrives in time is still an ApiError', caught instanceof ApiError);
}

section('which errors are fit to show a person');

/**
 * The rule `failureMessage` exists to enforce, from both sides.
 *
 * Getting it wrong is silent either way: too permissive and a customer reads
 * `Failed to fetch`, too strict and the deliberate sentences this codebase
 * throws — `services/store.ts` alone has fifteen — are replaced by a generic
 * fallback that says less.
 */
{
  const FALLBACK = 'Could not reach FreshFold just now.';
  const shown = (error: unknown) => failureMessage(error, FALLBACK);

  // Ours, and written to be read.
  checkTrue(
    'the server’s own sentence is shown',
    shown(new ApiError('That code has already been used.', 409)) ===
      'That code has already been used.'
  );
  checkTrue(
    'so is the timeout’s',
    shown(new TimeoutError(8000)) === 'The dispatch server did not answer in time.'
  );
  checkTrue(
    'and a plain Error this codebase threw on purpose',
    shown(new Error('Sign in to use your wallet.')) === 'Sign in to use your wallet.'
  );

  // The platform describing itself. These are the ones that reached customers.
  checkTrue(
    'a dropped connection does not show `Failed to fetch`',
    shown(new TypeError('Failed to fetch')) === FALLBACK
  );
  checkTrue(
    'an abort does not show its DOMException text',
    shown(new DOMException('signal is aborted without reason', 'AbortError')) === FALLBACK
  );
  checkTrue(
    'a body that would not parse does not show a SyntaxError',
    shown(new SyntaxError('Unexpected token < in JSON at position 0')) === FALLBACK
  );

  // A subclass we did not define is still the platform's, even when its message
  // reads like a sentence — the constructor is the test, not the wording.
  class SomeLibraryError extends Error {}
  checkTrue(
    'a subclass we did not define is refused',
    shown(new SomeLibraryError('Internal adapter state invalid')) === FALLBACK
  );

  // Nothing thrown that is not an error at all.
  checkTrue('a thrown string falls back', shown('boom') === FALLBACK);
  checkTrue('a thrown null falls back', shown(null) === FALLBACK);
  checkTrue('undefined falls back', shown(undefined) === FALLBACK);

  // `err.message || fallback` used to handle this shape; the replacement has to
  // as well, or an empty message becomes an empty message on screen.
  checkTrue('an Error with no message falls back', shown(new Error('')) === FALLBACK);
}

report();

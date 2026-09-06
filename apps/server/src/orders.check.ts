/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What it costs to guess a hand-off code.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * A hand-off code is four digits and nothing counted the guesses, so ten
 * thousand requests walked the space. What that bought is easy to state
 * wrongly: it was never a way past the *gate*, because a courier can already
 * complete a hand-off without the code by supplying an `overrideReason`. It was
 * a way past the *trail*. An override writes its sentence onto the job, raises
 * "completed without a code" to the desk and tells the customer; a guessed code
 * leaves none of that behind. The thing that was unbounded was the quiet way
 * through.
 *
 * So the fix is in two halves and both are asserted here. Attempts are now
 * bounded, keyed on the job and the leg rather than on whoever is asking —
 * an address can change between guesses and the job cannot. And a refused code
 * is written into the audit trail, so that an attempt is visible at all rather
 * than only its eventual success.
 *
 * **The exemption is the assertion that matters most.** A request carrying an
 * override is never counted and never refused. Getting that wrong would be
 * worse than the bug: it would leave a courier at a doorstep, holding bags,
 * locked out of the one honest path past a code the customer cannot produce.
 * A security control that strands the work it protects will be removed, and
 * rightly.
 *
 * These drive the real router. `photo` is deliberately not an image, so every
 * request is refused at 413 *before* the handler opens a transaction — which is
 * what lets this exercise the live middleware without a database.
 */

import express from 'express';
import { ordersRouter, matchesCode } from './routes/orders';

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

const PORT = 4614;

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);

  const server = app.listen(PORT);
  await new Promise((resolve) => server.once('listening', resolve));

  /**
   * One attempt at a hand-off. `photo` is refused by `imageProblem` before the
   * route reaches the database, so the reply says 413 when the request got
   * through the limiter and 429 when it did not.
   */
  const attempt = async (
    order: string,
    body: Record<string, unknown>
  ): Promise<number> => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/orders/${order}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: 'not-an-image', ...body }),
    });
    return res.status;
  };

  const guess = (order: string) => attempt(order, { status: 'delivered', deliveryCode: '0000' });

  // -------------------------------------------------------------------------
  section('a wrong code is a bounded number of guesses');

  const first = await guess('FFC-100001');
  check('the first attempt reaches the handler', first, 413);

  let refusedAt = 0;
  for (let n = 2; n <= 14 && refusedAt === 0; n += 1) {
    if ((await guess('FFC-100001')) === 429) refusedAt = n;
  }

  checkTrue(`guessing is cut off (attempt ${refusedAt})`, refusedAt > 0);
  checkTrue('...and not before a courier could fat-finger it twice', refusedAt > 3);

  section('...and the ceiling is per job-leg, not per caller');

  /**
   * The same caller, a different order. If this were keyed on the address the
   * bucket would already be full, and the fix would be one an attacker steps
   * around by moving while the courier it locks out cannot.
   */
  check('a different order starts fresh', await guess('FFC-100002'), 413);

  /**
   * The same order, the other leg. Exhausting the delivery code must not lock
   * the hub check-in, which is a different code held by different people.
   */
  check(
    'the other leg of a spent order starts fresh',
    await attempt('FFC-100001', { status: 'dropped_off', dropoffCode: '0000' }),
    413
  );

  section('the accountable path is never locked');

  /**
   * The exemption. `FFC-100001` is well past its ceiling by now, so every one of
   * these would be a 429 if overrides were counted — and a courier standing at a
   * door with no way to hand the bags over.
   */
  let overridesRefused = 0;
  for (let n = 0; n < 20; n += 1) {
    const status = await attempt('FFC-100001', {
      status: 'delivered',
      overrideReason: 'Customer not in, left with the concierge as agreed.',
    });
    if (status === 429) overridesRefused += 1;
  }

  check('twenty overrides on a spent order, none refused', overridesRefused, 0);

  section('and an ordinary stage change is not a guess');

  /**
   * Only the two gated transitions count. A courier driving a job through the
   * stages that carry no code must not spend the budget that protects the ones
   * that do.
   */
  let ordinaryRefused = 0;
  for (let n = 0; n < 20; n += 1) {
    if ((await attempt('FFC-100001', { status: 'picked_up' })) === 429) ordinaryRefused += 1;
  }

  check('twenty ungated stage changes, none refused', ordinaryRefused, 0);

  // -------------------------------------------------------------------------
  section('the code compare survives a wrong length');

  /**
   * `timingSafeEqual` throws when the two buffers differ in length, and a
   * guessed code is exactly where a wrong length comes from — so the naive
   * version of this turns a bad guess into a 500 and, with it, an oracle: a
   * crash means the length was wrong, a refusal means it was right.
   */
  check('the right code matches', matchesCode('4821', '4821'), true);
  check('a wrong code of the same length does not', matchesCode('4821', '4822'), false);
  check('a short guess is refused, not thrown', matchesCode('4821', '48'), false);
  check('a long guess is refused, not thrown', matchesCode('4821', '482100000'), false);
  check('an empty guess is refused', matchesCode('4821', ''), false);
  check('a job with no code on that leg never matches', matchesCode(undefined, '4821'), false);

  server.close();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

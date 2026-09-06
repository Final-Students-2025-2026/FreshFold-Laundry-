/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the hand-off codes come from.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * Both generators in `./job` drew from `Math.random`, which V8 implements as
 * xorshift128+ — not a cryptographic generator, and one whose 128-bit state is
 * recoverable from a handful of consecutive outputs. That mattered because
 * creating a single booking took four values from the one stream: the job id
 * and the three hand-off codes. The customer who booked it legitimately
 * received all four, so a few of their own orders were enough to recover the
 * state and predict the delivery code a courier was about to be read at
 * somebody else's front door.
 *
 * Two things are asserted here, and the second is the one worth having.
 *
 * The codes now come from the platform CSPRNG. And when there is no CSPRNG they
 * are *not* minted at all — `newHandoffCode` throws rather than falling back,
 * because a code quietly drawn from `Math.random` looks identical in the
 * database, on the customer's screen and in the courier's app, and nothing
 * about the running system would ever say it had happened.
 *
 * `newJobId` keeps a fallback on purpose and is asserted to keep it. A booking
 * id stopped being a credential when `resolveBookingAccess` began gating every
 * read and answering 404 to a caller with no claim, and React Native ships no
 * `crypto.getRandomValues` without a polyfill — so a customer who cannot start
 * a booking is a worse outcome than a guessable reference. The asymmetry is the
 * design, not an oversight, which is why it is written down as a test.
 */

import { check, checkTrue, report, section } from './check';
import { newHandoffCode, newJobId } from './job';

/** Runs `body` with `globalThis.crypto` removed, then puts it back. */
function withoutWebCrypto<T>(body: () => T): T {
  const host = globalThis as { crypto?: unknown };
  const saved = host.crypto;
  delete host.crypto;
  try {
    return body();
  } finally {
    host.crypto = saved;
  }
}

const DRAWS = 30_000;

// ---------------------------------------------------------------------------
section('hand-off codes are four digits');

const codes = Array.from({ length: DRAWS }, () => newHandoffCode());

checkTrue('every code is exactly four digits', codes.every((code) => /^\d{4}$/.test(code)));
checkTrue(
  'and inside 1000-9999',
  codes.every((code) => Number(code) >= 1000 && Number(code) <= 9999)
);

section('...and they are not predictable');

/**
 * The direct assertion that the CSPRNG is actually being used.
 *
 * `Math.random` is pinned to a constant for the length of this check. A
 * generator still reaching for it produces the same code every time; one
 * reaching for `crypto.getRandomValues` does not notice. This is what would
 * have failed on the old implementation, and it fails on any future edit that
 * reintroduces it.
 */
const realRandom = Math.random;
Math.random = () => 0.5;
const pinned = new Set(Array.from({ length: 500 }, () => newHandoffCode()));
Math.random = realRandom;

checkTrue('pinning Math.random does not pin the codes', pinned.size > 100);

/**
 * Coverage and uniformity, which is what the rejection sampling in `fromCsprng`
 * is for. A `value % 9000` over a 2^32 draw leans towards the low end of the
 * range; over this many draws that lean shows up as the bottom ninth of the
 * space being visibly over-represented.
 *
 * The bounds are loose on purpose. This is a random process and the suite has
 * to pass every time it runs, so what is being caught is a systematic bias — a
 * modulo, a truncation, a generator stuck in part of its range — rather than an
 * unlucky afternoon.
 */
const distinct = new Set(codes).size;
checkTrue(`most of the 9000 codes appear in ${DRAWS} draws`, distinct > 7_500);

const low = codes.filter((code) => Number(code) < 2000).length;
const share = low / DRAWS;
checkTrue(
  `the bottom ninth is not over-represented (${(share * 100).toFixed(1)}%)`,
  share > 0.09 && share < 0.13
);

section('and without a CSPRNG a code is refused rather than faked');

const outcome = withoutWebCrypto(() => {
  try {
    return { threw: false, code: newHandoffCode() };
  } catch {
    return { threw: true, code: '' };
  }
});

checkTrue('newHandoffCode throws rather than falling back', outcome.threw);
checkTrue('web crypto is back afterwards', typeof globalThis.crypto?.getRandomValues === 'function');
checkTrue('and codes are minted again', /^\d{4}$/.test(newHandoffCode()));

// ---------------------------------------------------------------------------
section('booking ids are shaped right');

const ids = Array.from({ length: 2_000 }, () => newJobId());

checkTrue('every id is FFC- and six digits', ids.every((id) => /^FFC-\d{6}$/.test(id)));
checkTrue('they are not all the same', new Set(ids).size > 1_800);

section('...and are still minted where there is no CSPRNG');

/**
 * The deliberate asymmetry. A booking id is not a secret and both React Native
 * forms call this to seed themselves, so unlike a hand-off code it must always
 * produce something.
 */
const offline = withoutWebCrypto(() => newJobId());
checkTrue('newJobId falls back rather than throwing', /^FFC-\d{6}$/.test(offline));

report();

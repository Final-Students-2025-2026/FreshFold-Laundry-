/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for the scan rules in `./scan`.
 *
 * Run with `npm run check --workspace @freshfold/mobile`. Plain assertions and
 * a non-zero exit, matching `store/workload.check.ts` — the repo has no test
 * framework and two files' worth of rules do not justify installing one.
 *
 * The manifest below is order FFC-726530's, taken from the dispatch record:
 * one bag, `FF-BAG-726530-A`, and a collection code of 3651.
 */
import { buildHandoffPayload, type LaundryBag } from '@freshfold/core';
import { classifyScan } from './scan';

const JOB = 'FFC-726530';

const bag = (qrCode: string, scanned = false): LaundryBag => ({
  id: qrCode.replace('FF-', ''),
  type: 'Washing (Machine & Hand Wash)',
  weight: '3.5kg',
  itemCount: 9,
  qrCode,
  scanned,
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${a}\n        want ${e}`}`
  );
}

/** Only the shape matters here; the bag itself is checked separately. */
const kindOf = (data: string, bags: LaundryBag[]) => classifyScan(data, bags).kind;

const manifest = [bag('FF-BAG-726530-A')];
const done = [bag('FF-BAG-726530-A', true)];

// --- the bags on this order ------------------------------------------------
check('a bag on the manifest is verified', kindOf('FF-BAG-726530-A', manifest), 'bag');
check('case and whitespace do not matter', kindOf('  ff-bag-726530-a ', manifest), 'bag');

// The regression this file exists for. The camera reads a label held in the
// frame every few hundred milliseconds, so the second read of a bag the courier
// has just verified used to be announced as an unrecognised label.
check('a bag read twice is not an error', kindOf('FF-BAG-726530-A', done), 'bag-again');
check('a bag ticked off by hand still scans', kindOf('FF-BAG-726530-A', done), 'bag-again');

// --- everything else at the door -------------------------------------------
check(
  "the customer's collection QR is named, not rejected",
  kindOf(buildHandoffPayload(JOB, 'pickup', '3651'), manifest),
  'handoff'
);
check(
  "another order's collection QR is still a hand-off code",
  kindOf(buildHandoffPayload('FFC-215014', 'pickup', '5635'), manifest),
  'handoff'
);
check('a bag from another order is unknown', kindOf('FF-BAG-215014-A', manifest), 'unknown');
check('a stray barcode is unknown', kindOf('5901234123457', manifest), 'unknown');
check('an empty read is unknown', kindOf('   ', manifest), 'unknown');

// --- the bag itself comes back, so the row can be ticked off ----------------
const hit = classifyScan('FF-BAG-726530-A', manifest);
check('the matched bag is returned', hit.kind === 'bag' && hit.bag.qrCode, 'FF-BAG-726530-A');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

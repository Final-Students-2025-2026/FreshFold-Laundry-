/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * That a checkout only ever asks to be sent back to an address this app owns.
 *
 * Run with `npm run check --workspace @freshfold/client`.
 *
 * Both checkouts handed Paystack `Linking.createURL('paystack-success', …)`.
 * That answers with whatever scheme is carrying the app, and under Expo Go it
 * is Expo Go's own — `exp://<dev-host>:8081/--/paystack-success`. The customer
 * app's `.env` points at the Render server, where `NODE_ENV` is production and
 * `callbackPolicy` drops `exp` deliberately, so `/paystack/initialize` refused
 * the checkout before creating it. Every card payment made from Expo Go died
 * there — top-up and booking alike — and what the customer read under the Pay
 * button was "that is not a return address this server will send a customer
 * to": a refusal aimed at an open redirect, shown to someone who had done
 * nothing but choose an amount.
 *
 * Two halves, because the bug had two.
 *
 *  - **The rule**, asserted against the address each way of carrying this app
 *    actually produces. `ownsAddress` is pure and takes the schemes, so a build
 *    can be stated here rather than a native module faked.
 *  - **That the screens still go through it.** The regression is somebody
 *    reaching for `Linking.createURL` at the call site again, a year from now,
 *    because that is what the line above it used to say. The rule being right
 *    is no use if the checkout stops asking it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ownsAddress } from './schemes';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`)
  );
}

const checkTrue = (label: string, actual: unknown) => check(label, actual, true);

function section(title: string): void {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 55 - title.length))}`);
}

// ---------------------------------------------------------------------------
section('what each way of carrying the app offers');

/** What `app.config.js` declares, and so what a real build registers. */
const OURS = ['freshfoldclient'];

const owns = (url: string) => ownsAddress(url, OURS);

checkTrue('a standalone build owns its deep link', owns('freshfoldclient://paystack-success?flow=wallet'));
checkTrue(
  'a development build owns one carrying the dev host',
  owns('freshfoldclient://192.168.1.42:8081paystack-success?flow=book')
);
checkTrue('case in the scheme does not matter', owns('FreshFoldClient://paystack-success'));
checkTrue(
  'the web build owns the origin it is served from',
  owns('http://localhost:8081/paystack-success?flow=wallet')
);
checkTrue('...and the deployed one', owns('https://freshfold.example/#paystack-success'));

check('Expo Go does not', owns('exp://192.168.1.42:8081/--/paystack-success?flow=wallet'), false);
check('nor Expo Go over TLS', owns('exps://192.168.1.42:8081/--/paystack-success'), false);
check('nor the rider app', owns('freshfold://paystack-success'), false);
check('nor a scheme that merely starts the same way', owns('freshfoldclientx://paystack-success'), false);
check('nor javascript:', owns('javascript:alert(1)'), false);
check('a build declaring no scheme owns nothing of its own', ownsAddress('exp://x/--/y', []), false);
check('...and an empty scheme claims nothing', ownsAddress('exp://x/--/y', ['']), false);

// ---------------------------------------------------------------------------
section('and the checkouts still ask before they send one');

/** The two screens that open a Paystack checkout. */
const SCREENS = [
  { file: path.join(APP, 'app', '(tabs)', 'wallet.tsx'), flow: 'wallet' },
  { file: path.join(APP, 'app', '(tabs)', 'book.tsx'), flow: 'book' },
];

/** A return address built at the call site instead of asked for. */
const DIRECT_LINK = /createURL\(\s*['"]paystack-success['"]/;

for (const { file, flow } of SCREENS) {
  const name = path.relative(APP, file).split(path.sep).join('/');
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  checkTrue(`${name} exists`, source.length > 0);
  checkTrue(`${name} asks paystackReturnUrl for its address`, source.includes(`paystackReturnUrl('${flow}')`));
  check(`${name} does not build one itself`, DIRECT_LINK.test(source), false);
}

/**
 * And the scan is checked against itself. A pattern that matches nothing would
 * pass the assertion above for the wrong reason and keep passing forever.
 */
checkTrue(
  'the scan can still see a hand-built address',
  DIRECT_LINK.test("callback_url: Linking.createURL('paystack-success', { queryParams: { flow } }),")
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

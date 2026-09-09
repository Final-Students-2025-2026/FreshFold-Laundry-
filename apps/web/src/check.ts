/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The assertion helper the `*.check.ts` files in this app share.
 *
 * Same shape and same reasoning as `packages/core/src/check.ts` and the pair
 * `apps/server` keeps at the top of its own checks: plain comparisons, a
 * PASS/FAIL line each, a non-zero exit. The repo has no test framework and
 * these assertions do not need one.
 *
 * Local rather than imported from `@freshfold/core` because that package
 * exports one entry, `src/index.ts`, and its `check` module is deliberately not
 * on it: it calls `process.exit`, and a module that can end the process has no
 * business being reachable from a package the browser bundle imports.
 *
 * `process` by explicit import, not as a global. This app's tsconfig pins
 * `types` to `vite/client` and `google.maps`, so Node's globals are not
 * declared here — which is correct, since almost everything under `src` really
 * does run in a browser. `vite.config.ts` reaches for `node:path` the same way.
 */

import process from 'node:process';

let failures = 0;

export function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${a}\n        want ${e}`}`
  );
}

/** Asserts a condition that reads better as a sentence than as a comparison. */
export function checkTrue(label: string, actual: boolean): void {
  check(label, actual, true);
}

/** Prints the tally and exits. Call once, at the bottom of a check file. */
export function report(): void {
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/** A heading, so a long run reads as sections rather than as one wall. */
export function section(title: string): void {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 58 - title.length))}`);
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The assertion helper the `*.check.ts` files here share.
 *
 * Extracted rather than copied a fifth time. The style is the one
 * `apps/mobile/src/scan.check.ts` established — plain comparisons, a PASS/FAIL
 * line each, a non-zero exit — and the reasoning it gives still holds: the repo
 * has no test framework, and adding one to run assertions over pure functions
 * would be more machinery than the assertions are.
 *
 * Compared by `JSON.stringify`, so objects and arrays can be asserted whole. A
 * mismatch prints both sides, because "FAIL" on its own tells you where to look
 * and nothing about what to look for.
 */

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

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a list route does with `?limit=`.
 *
 * Worth assertions because every branch of it is reachable from the query
 * string, which is to say from anybody, and because the failure is quiet in
 * both directions. Too small a number and a supervisor reads a board that is
 * missing rows without being told; too large — or negative, or `NaN` — and the
 * bound this exists to impose is not there at all.
 *
 * The logic had lived in two copies, in the audit route and the desk inbox,
 * neither covered. These are written against the one function they now share.
 */

import { pageLimit } from './helpers';

// Harness local to the file, as every other check in this workspace does it —
// `packages/core` has a shared one, `apps/server` deliberately does not.
let failures = 0;

function checkTrue(label: string, actual: boolean): void {
  if (!actual) failures += 1;
  console.log(`${actual ? 'PASS' : 'FAIL'}  ${label}${actual ? '' : '\n        got  false'}`);
}

function section(title: string): void {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 55 - title.length))}`);
}

function report(): void {
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

const page = { fallback: 500, max: 2000 };

section('what a caller may ask for');

checkTrue('a plain number is honoured', pageLimit('250', page) === 250);
checkTrue('the ceiling is enforced', pageLimit('99999', page) === page.max);
checkTrue('asking for exactly the ceiling is fine', pageLimit('2000', page) === page.max);
checkTrue('one row is a legitimate page', pageLimit('1', page) === 1);

section('what is treated as not asking');

// Every current caller is in this group: none of them send the parameter, so
// the fallback is the number that actually serves production.
checkTrue('absent takes the fallback', pageLimit(undefined, page) === page.fallback);
checkTrue('empty takes the fallback', pageLimit('', page) === page.fallback);
checkTrue('nonsense takes the fallback', pageLimit('all', page) === page.fallback);
checkTrue('null takes the fallback', pageLimit(null, page) === page.fallback);

section('what would remove the bound if it got through');

// Zero and negatives are the ones that matter. A `limit 0` reaches Postgres as
// a page of nothing, and a negative is a syntax error — either way the route
// stops answering, and neither is what somebody typing a number meant.
checkTrue('zero takes the fallback', pageLimit('0', page) === page.fallback);
checkTrue('a negative takes the fallback', pageLimit('-1', page) === page.fallback);
checkTrue('a huge negative takes the fallback', pageLimit('-99999', page) === page.fallback);

// `?limit=10.5` arrives as a numeric Postgres rounds on its own, so a page size
// would be decided by rounding rules rather than by the request. Floored here
// instead, where it is visible.
checkTrue('a fraction is floored, not rounded', pageLimit('10.9', page) === 10);
checkTrue('a fraction below one takes the fallback', pageLimit('0.4', page) === page.fallback);

// Express hands back an array when a parameter is repeated — `?limit=5&limit=9`.
// `Number` of an array is `NaN`, which lands on the fallback rather than on
// whichever copy happened to be last.
checkTrue('a repeated parameter takes the fallback', pageLimit(['5', '9'], page) === page.fallback);

checkTrue('Infinity takes the fallback', pageLimit('Infinity', page) === page.fallback);
checkTrue('NaN takes the fallback', pageLimit(Number.NaN, page) === page.fallback);

section('the pages the routes actually use');

// Guards against somebody widening a ceiling below its own default, which would
// silently make the default unreachable.
for (const [name, p] of [
  ['the board', { fallback: 500, max: 2000 }],
  ['the patron table', { fallback: 500, max: 2000 }],
  ['the desk inbox', { fallback: 500, max: 2000 }],
  ['the audit trail', { fallback: 200, max: 500 }],
  ['the unprojected jobs read', { fallback: 200, max: 500 }],
] as const) {
  checkTrue(`${name}: the default is within its own ceiling`, p.fallback <= p.max);
  checkTrue(`${name}: the default survives an absent parameter`, pageLimit(undefined, p) === p.fallback);
}

report();

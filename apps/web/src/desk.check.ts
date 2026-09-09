/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for the desk route's gate — the one that decides whether a supervisor
 * sees the form, the board, or a note that the session is being checked.
 *
 * Run with `npm run check --workspace @freshfold/web`.
 *
 * These exist because of a specific bug. The gate was `boolean | null` read as
 * two `===` comparisons, so the in-flight state matched neither and the route
 * rendered nothing at all — the marketing page showed through, which is what
 * the site looks like when the URL is wrong, so it read as "the desk is gone".
 * It survived review, a typecheck and a production deploy, because nothing in
 * this app ran any of its behaviour.
 *
 * The assertion that would have caught it is the last one in the first section:
 * every state maps to something. It is deliberately written over
 * `DESK_SESSIONS` rather than as three separate cases, so a state added to the
 * union without a surface fails here as well as at the compiler.
 */

import { check, checkTrue, report, section } from './check';
import { DESK_SESSIONS, deskSurface, sessionFrom, type DeskSession } from './desk';

section('every state puts something on screen');

// The bug, as an assertion. Not "the login shows when signed out" — that was
// never wrong — but "no state falls through", which is the property that
// failed.
checkTrue(
  'no desk session renders nothing',
  DESK_SESSIONS.every((session) => Boolean(deskSurface(session)))
);

checkTrue(
  'the three states reach three different surfaces',
  new Set(DESK_SESSIONS.map(deskSurface)).size === DESK_SESSIONS.length
);

check('DESK_SESSIONS lists every state once', [...new Set(DESK_SESSIONS)].length, 3);

section('each state, individually');

check('a check in flight is acknowledged, not ignored', deskSurface('checking'), 'pending');
check('a refused or absent session asks for a password', deskSurface('signed-out'), 'login');
check('a confirmed supervisor gets the board', deskSurface('signed-in'), 'dashboard');

section('the ledger is not shown on a guess');

// The half of the gate that is a security property rather than a usability
// one: nothing but a confirmed session reaches the dashboard. `checking` in
// particular must not, or the board would flash up before the server has
// agreed the token is still good.
checkTrue(
  'only a confirmed session reaches the dashboard',
  DESK_SESSIONS.filter((session) => deskSurface(session) === 'dashboard').join() === 'signed-in'
);

section('resolving a session check');

// `restoreAdminSession` answers with a supervisor or `null`, and folds an
// unreachable server into `null` on purpose — an unverifiable supervisor is
// not a supervisor.
check('a supervisor signs the desk in', sessionFrom({ id: 'sup_1', name: 'Ama' }), 'signed-in');
check('a refusal signs it out', sessionFrom(null), 'signed-out');
check('so does an unreachable server', sessionFrom(undefined), 'signed-out');

// Guarding the `Boolean`-ish coercion in `sessionFrom`: these are not
// supervisors, and none of them should open the board.
for (const falsy of [0, '', false, Number.NaN] as const) {
  check(
    `${String(falsy) || 'the empty string'} is not a supervisor`,
    sessionFrom(falsy satisfies unknown),
    'signed-out'
  );
}

section('the state the route starts in');

// `App` seeds `useState` with this. If it ever starts anywhere else, the desk
// either asks for a password it has not established is needed, or shows a
// board it has not established anyone is entitled to.
const INITIAL: DeskSession = 'checking';
check('the route starts by checking, not by assuming', deskSurface(INITIAL), 'pending');

report();

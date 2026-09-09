/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the desk route is showing, as a value the compiler can count.
 *
 * ## What this replaces
 *
 * The route used to be gated on `isSupervisor: boolean | null`, read at the
 * render site as two separate comparisons — `=== false` drew the login,
 * `=== true` drew the dashboard. The type had three inhabitants and the render
 * handled two of them, so while the session check was in flight the state sat
 * at `null` and *neither* branch matched: the route mounted no overlay at all
 * and the marketing page showed through. Typed into the URL bar, that is
 * indistinguishable from the desk not existing, which is how it was reported.
 *
 * Nothing in `boolean | null` made the missing case visible. A third state had
 * to be noticed by a person reading two conditionals and working out which
 * values reached neither — and the wait it happens in is invisible on a fast
 * connection, so testing it by hand does not find it either.
 *
 * ## Why a name per state, and a mapping out of them
 *
 * `DeskSession` names the three states, so the third is not the absence of the
 * other two. `deskSurface` maps each to the thing that goes on screen and is
 * `never`-checked, so adding a fourth state stops the build instead of quietly
 * rendering nothing. The switch at the render site is over `DeskSurface`, so a
 * new surface with nowhere to draw it fails to compile too.
 *
 * The mapping is one-to-one today, and the indirection is the point rather than
 * an accident of it: it is the seam that lets `desk.check.ts` assert every
 * state reaches a surface without standing up React and a DOM to do it. The
 * bug this file exists to prevent was one state reaching nothing.
 */

/** The three states the desk route can be in. */
export type DeskSession =
  /** The stored token is being re-validated with the server. Nothing is known yet. */
  | 'checking'
  /** Asked and refused, or never had a token. The sign-in form. */
  | 'signed-out'
  /** The server confirmed the token this session holds. The board. */
  | 'signed-in';

/** Every state, so a check can walk them without restating the union. */
export const DESK_SESSIONS: readonly DeskSession[] = ['checking', 'signed-out', 'signed-in'];

/** What the desk route puts on screen. */
export type DeskSurface =
  /** A quiet acknowledgement that the check is still running. */
  | 'pending'
  /** The password form. */
  | 'login'
  /** The order ledger. */
  | 'dashboard';

/**
 * Refuses to compile if `DeskSession` grows a state this file does not map.
 *
 * The throw is unreachable by construction; it exists for a build that skipped
 * typechecking, where returning `undefined` into a `switch` would put the blank
 * screen back rather than say so.
 */
function unmapped(session: never): never {
  throw new Error(`Unmapped desk session: ${String(session)}`);
}

/** The surface a session state puts on screen. Total, by construction. */
export function deskSurface(session: DeskSession): DeskSurface {
  switch (session) {
    case 'checking':
      return 'pending';
    case 'signed-out':
      return 'login';
    case 'signed-in':
      return 'dashboard';
    default:
      return unmapped(session);
  }
}

/**
 * The state a resolved session check lands on.
 *
 * `restoreAdminSession` answers with a supervisor or `null`, and both a refusal
 * and an unreachable server arrive as `null` — deliberately, since an
 * unverifiable supervisor is not a supervisor. Either way the desk is signed
 * out and the form is what it owes the person looking at it.
 */
export function sessionFrom(supervisor: unknown): DeskSession {
  return supervisor ? 'signed-in' : 'signed-out';
}

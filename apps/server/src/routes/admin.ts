/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { bearerToken, createSession, requireSupervisor, revokeSession } from '../auth';
import { hashPassword, needsRehash, verifySecret } from '../passwords';
import { credentialLimit } from '../rateLimit';
import { store, type StoredSupervisor, type SupervisorProfile } from '../store';
import { guard } from '../helpers';

/**
 * The supervisor desk.
 *
 * The dashboard behind this is the surface that can edit and delete the whole
 * ledger, and until now it was reachable by anyone who knew a URL fragment.
 * Supervisors are provisioned like couriers — there is no register route here —
 * and this session is what the roster-management endpoints require.
 */
export const adminRouter = Router();

/** How much of the trail a desk gets by default, and the most it can ask for. */
const DEFAULT_AUDIT_PAGE = 200;
const MAX_AUDIT_PAGE = 500;

/** Strips credentials so a supervisor record can be sent to the browser. */
function profile(supervisor: StoredSupervisor): SupervisorProfile {
  return { id: supervisor.id, name: supervisor.name, email: supervisor.email };
}

/**
 * Sign in to the desk.
 *
 * Limited like the other two credential checks, and it is the session with the
 * most behind it — this token edits the ledger and empties the roster. The desk
 * is a handful of people at a handful of machines, so a ceiling that would be
 * restrictive on a customer route is invisible here.
 */
adminRouter.post(
  '/login',
  ...credentialLimit({
    perIdentifier: 10,
    perAddress: 30,
    windowMs: 15 * 60 * 1000,
    field: 'email',
  }),
  guard(async (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'An email and password are required.' });
      return;
    }

    const supervisor = await store.supervisors.findByEmail(email);

    // One message whether the address is unknown or the password is wrong, so
    // the response cannot be used to discover who works here. Checked even when
    // there is no supervisor, so the two take the same time as well — see the
    // note on the customer sign-in.
    const credentialsMatch = await verifySecret(password, {
      salt: supervisor?.passwordSalt,
      hash: supervisor?.passwordHash,
    });

    if (!supervisor || !credentialsMatch) {
      res.status(401).json({ error: 'Those credentials do not match.' });
      return;
    }

    if (supervisor.active === false) {
      res.status(403).json({ error: 'This supervisor account has been closed.' });
      return;
    }

    if (needsRehash(supervisor.passwordHash)) {
      // See the note on the customer sign-in. This is the most valuable
      // credential in the system, so it is the one most worth upgrading.
      void hashPassword(password)
        .then((upgraded) => store.supervisors.setPassword(supervisor.email, upgraded))
        .catch((error: unknown) => console.error('[admin] password re-hash failed:', error));
    }

    const session = await createSession('admin', supervisor.email);
    res.json({ token: session.token, supervisor: profile(supervisor) });
  })
);

/** Re-validates a stored token on load, and says whose desk it is. */
adminRouter.get('/me', requireSupervisor, (req, res) => {
  res.json(profile(req.supervisor!));
});

/**
 * The audit trail, newest first.
 *
 * Behind a supervisor session because it names customers, amounts and the
 * colleagues who moved them. Any desk sees the whole trail, including entries
 * another supervisor wrote — that is the difference between an audit trail and
 * what this used to be, which was a private list in one browser.
 *
 * Paged rather than capped: nothing is ever pruned, so the old fifty-entry limit
 * is now a page size, and asking for more only asks for more.
 */
adminRouter.get(
  '/audit',
  requireSupervisor,
  guard(async (req, res) => {
    const asked = Number(req.query.limit);
    // Floored because `?limit=10.5` reaches Postgres as a numeric it rounds on
    // its own — a page size decided by rounding rules is not one anybody asked
    // for. Anything unparseable, negative or zero takes the default.
    const limit =
      Number.isFinite(asked) && asked >= 1
        ? Math.min(Math.floor(asked), MAX_AUDIT_PAGE)
        : DEFAULT_AUDIT_PAGE;

    res.json(await store.auditEvents.list(limit));
  })
);

adminRouter.post(
  '/logout',
  guard(async (req, res) => {
    const token = bearerToken(req);
    if (token) await revokeSession(token);
    res.json({ ok: true });
  })
);

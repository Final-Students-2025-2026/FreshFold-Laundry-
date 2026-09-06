/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { guard } from './helpers';
import {
  store,
  type SessionKind,
  type StoredAccount,
  type StoredRider,
  type StoredSession,
  type StoredSupervisor,
} from './store';

/**
 * Bearer sessions, for customers, couriers and supervisors alike.
 *
 * Hashing lives in `./passwords`, which has no store dependency; this module
 * layers sessions on top of it and is the only thing that turns a token back
 * into whoever holds it.
 *
 * One token store serves all three. `kind` decides which table `subject` points
 * into, so the expiry sweep, the revoke path and the bearer parsing are written
 * once rather than duplicated per audience.
 */

/** The digest a session is stored and looked up under. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * How long a session lives, by who is holding it.
 *
 * A week is right for the two credentials that live on a phone. A courier signs
 * in at the start of a shift and must not be asked again at a doorstep in the
 * rain; a customer opens the app fortnightly and being signed out each time is
 * the reason people stop opening an app.
 *
 * The desk is not that, and giving it the same week was the default rather than
 * a decision. Its token reads every customer's address and phone number,
 * settles any bill, refunds to any wallet and deactivates any courier — it is
 * the most valuable credential in the system by a distance, and the browser it
 * sits in is a shared machine on a counter. Twelve hours covers the longest
 * shift anyone works and expires before the next one starts, which is the
 * property worth having: a desk left signed in overnight is signed out by
 * morning without anybody remembering to do it.
 *
 * This bounds the damage rather than preventing it — see the note in the web
 * app's `readAdminToken`, and FF-03 in the security review, for the part that a
 * shorter clock does not fix.
 */
const SESSION_TTL_MS: Record<SessionKind, number> = {
  customer: 7 * 24 * 60 * 60 * 1000,
  rider: 7 * 24 * 60 * 60 * 1000,
  admin: 12 * 60 * 60 * 1000,
};

/**
 * What a sign-in gets back: the token to send, and when it stops working.
 *
 * Not a `StoredSession`, because a `StoredSession` no longer contains a token —
 * only its digest. This is the one place the raw value exists on this side of
 * the wire, and returning a distinct type is what stops a route reaching for a
 * `.token` that is really a hash.
 */
export interface MintedSession {
  token: string;
  expiresAt: string;
}

export async function createSession(
  kind: SessionKind,
  subject: string
): Promise<MintedSession> {
  const now = Date.now();

  // The token goes to the client; only its digest is written down. SHA-256
  // rather than a KDF: this is 32 bytes of `randomBytes`, so there is no
  // low-entropy secret to slow an attacker around, and a per-request KDF would
  // make every authenticated call pay for protection it does not need.
  const token = randomBytes(32).toString('hex');

  const session: StoredSession = {
    tokenHash: hashToken(token),
    kind,
    subject: kind === 'rider' ? subject : subject.toLowerCase(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS[kind]).toISOString(),
  };

  await store.sessions.insert(session);

  // Clear expired tokens while we're here — this is the only place sessions
  // accumulate, so it is the natural moment to sweep. Deliberately not awaited
  // and deliberately not fatal: a failed sweep must not fail the sign-in that
  // triggered it, and the next one will catch whatever this missed.
  void store.sessions.pruneExpired().catch((error: unknown) => {
    console.error('[auth] session sweep failed:', error);
  });

  return { token, expiresAt: session.expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await store.sessions.revoke(hashToken(token));
}

export function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** The live session behind a token, or null if absent, expired or unknown. */
async function sessionForToken(
  token: string | null,
  kind: SessionKind
): Promise<StoredSession | null> {
  if (!token) return null;
  return store.sessions.findLive(hashToken(token), kind);
}

/**
 * Resolves a bearer token to its account, or null.
 *
 * A customer blocked since they signed in resolves to null, for the reason a
 * deactivated courier does: the block is checked on every request rather than
 * only at sign-in, so suspending somebody takes effect immediately instead of
 * waiting out the week their token has left. Blocking also revokes their
 * sessions outright; this is what covers the ones minted in between.
 */
export async function accountForToken(token: string | null): Promise<StoredAccount | null> {
  const session = await sessionForToken(token, 'customer');
  if (!session) return null;

  const account = await store.accounts.find(session.subject);
  if (!account || account.blockedAt) return null;

  return account;
}

/**
 * Resolves a bearer token to its courier, or null.
 *
 * A rider deactivated since they signed in resolves to null: the roster is
 * checked on every request, not just at login, so removing someone takes effect
 * without waiting out their week-long token.
 */
export async function riderForToken(token: string | null): Promise<StoredRider | null> {
  const session = await sessionForToken(token, 'rider');
  if (!session) return null;

  const rider = await store.riders.find(session.subject);
  if (!rider || rider.active === false) return null;

  return rider;
}

/**
 * Resolves a bearer token to its supervisor, or null.
 *
 * Checked against the desk on every request for the same reason riders are:
 * revoking someone's access should not wait out their week-long token.
 */
export async function supervisorForToken(
  token: string | null
): Promise<StoredSupervisor | null> {
  const session = await sessionForToken(token, 'admin');
  if (!session) return null;

  const supervisor = await store.supervisors.findByEmail(session.subject);
  if (!supervisor || supervisor.active === false) return null;

  return supervisor;
}

declare module 'express-serve-static-core' {
  interface Request {
    account?: StoredAccount;
    rider?: StoredRider;
    supervisor?: StoredSupervisor;
  }
}

/**
 * Every guard below is wrapped in `guard`.
 *
 * Express 4 does not await a middleware, so a rejected promise inside one would
 * otherwise go nowhere and the request would hang until the client gave up.
 * Now a database that is briefly unreachable produces a 500, which is a thing
 * the apps already know how to retry.
 */

/** Rejects the request unless it carries a valid customer session. */
export const requireAuth = guard(async (req, res, next) => {
  const account = await accountForToken(bearerToken(req));
  if (!account) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }

  req.account = account;
  next();
});

/** Rejects the request unless it carries a valid courier session. */
export const requireRider = guard(async (req, res, next) => {
  const rider = await riderForToken(bearerToken(req));
  if (!rider) {
    res.status(401).json({ error: 'Sign in to the rider console to continue.' });
    return;
  }

  req.rider = rider;
  next();
});

/**
 * Rejects the request unless it carries a courier *or* a supervisor session.
 *
 * The roster is staff-facing either way: a courier reads it to see who else is
 * out, and the supervisor reads the same list to run the desk. Requiring a
 * courier session for it meant the roster console — the one screen whose whole
 * job is that list — got a 401 and rendered "nobody on the roster yet".
 */
export const requireStaff = guard(async (req, res, next) => {
  const token = bearerToken(req);
  const rider = await riderForToken(token);
  const supervisor = rider ? null : await supervisorForToken(token);

  if (!rider && !supervisor) {
    res.status(401).json({ error: 'Sign in to the rider console or the supervisor desk.' });
    return;
  }

  if (rider) req.rider = rider;
  if (supervisor) req.supervisor = supervisor;
  next();
});

/** Rejects the request unless it carries a valid supervisor session. */
export const requireSupervisor = guard(async (req, res, next) => {
  const supervisor = await supervisorForToken(bearerToken(req));
  if (!supervisor) {
    res.status(401).json({ error: 'Sign in to the supervisor desk to continue.' });
    return;
  }

  req.supervisor = supervisor;
  next();
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { samePhone, type Job } from '@freshfold/core';
import { accountForToken, bearerToken, riderForToken, supervisorForToken } from './auth';
import { store, type StoredAccount, type StoredRider, type StoredSupervisor } from './store';

/**
 * Who is allowed to see a booking, and how they proved it.
 *
 * Every read and write of a single booking goes through {@link resolveBookingAccess}.
 * Before this existed the answer was "anybody who knows the id", and the id is
 * `FFC-` plus six digits — so the whole customer table, every address and all
 * three hand-off codes were a walk of a 900,000-wide space away.
 *
 * Four ways to qualify, in the order they are checked:
 *
 *  - **A supervisor.** The desk runs the board and sees everything on it.
 *  - **The customer it belongs to.** Matched on the address *or* the number,
 *    which is how `jobs.list` scopes a history — a guest booking made under a
 *    second address on the same phone is the same person.
 *  - **The courier holding it.** Only while it is theirs; a job in the open pool
 *    is offered through `/api/orders`, not here.
 *  - **A tracking token.** The guest's grant, handed back when the booking was
 *    created. See {@link issueTrackingToken}.
 */
export type BookingAccess =
  | { kind: 'supervisor'; supervisor: StoredSupervisor }
  | { kind: 'customer'; account: StoredAccount }
  | { kind: 'rider'; rider: StoredRider }
  | { kind: 'tracking' };

/**
 * How long a tracking token stays good for.
 *
 * A month, against the setup link's week. This one is not a way into an account
 * — it reads one booking and nothing else — and the order it names outlives its
 * own delivery on the customer's history screen. Long enough that a guest who
 * booked, was delivered and came back to look is not turned away; short enough
 * that a token left in an old browser profile does not work forever.
 */
export const TRACKING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The header a tracking token arrives in.
 *
 * A header rather than a query parameter, unlike the setup and reset links.
 * Those have to survive being clicked in a mail client, so they have no choice;
 * this one is only ever sent by application code, and a token in a URL is a
 * token in browser history, in the referrer of anything the page loads, and in
 * every access log along the way.
 */
export const TRACKING_HEADER = 'x-freshfold-tracking';

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mints the grant for a booking and records its digest.
 *
 * Returns the raw token, which exists here and in the response to the request
 * that created the booking, and nowhere else. Nothing can read it back — a
 * customer who loses it signs in instead, which is what the confirmation email
 * has been inviting them to do all along.
 */
export async function issueTrackingToken(bookingId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();

  await store.trackingTokens.pruneExpired();
  await store.trackingTokens.issue({
    tokenHash: hashTrackingToken(token),
    bookingId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TRACKING_TTL_MS).toISOString(),
  });

  return token;
}

function trackingHeader(req: Request): string | null {
  const raw = req.get(TRACKING_HEADER);
  return raw?.trim() || null;
}

/** Whether this account is the customer on this job. */
export function accountOwnsJob(account: StoredAccount, job: Job): boolean {
  const jobEmail = (job.customer.email ?? '').trim().toLowerCase();
  const accountEmail = account.email.trim().toLowerCase();

  if (jobEmail && jobEmail === accountEmail) return true;
  return samePhone(job.customer.phone, account.phone);
}

/**
 * Who the caller is, with respect to this job. `null` when they are nobody.
 *
 * Deliberately takes the job rather than an id: every caller has just read it
 * — several of them under a row lock — and re-reading it here would drop that
 * work on the floor and open a gap between what was checked and what was
 * written.
 */
export async function resolveBookingAccess(
  req: Request,
  job: Job
): Promise<BookingAccess | null> {
  const token = bearerToken(req);

  if (token) {
    const supervisor = await supervisorForToken(token);
    if (supervisor) return { kind: 'supervisor', supervisor };

    const account = await accountForToken(token);
    if (account && accountOwnsJob(account, job)) return { kind: 'customer', account };

    const rider = await riderForToken(token);
    if (rider && job.dispatch.riderId === rider.id) return { kind: 'rider', rider };
  }

  const tracking = trackingHeader(req);
  if (tracking) {
    const grant = await store.trackingTokens.findLive(hashTrackingToken(tracking));
    if (grant && grant.bookingId === job.id) return { kind: 'tracking' };
  }

  return null;
}

/**
 * The same question for a whole list: is the caller the desk, one customer, or
 * nobody?
 *
 * `GET /api/bookings` answers a different query for each, and the distinction
 * cannot come from the request — it used to, as `?email=`, which is to say it
 * came from whoever was asking.
 */
export type ListerIdentity =
  | { kind: 'supervisor' }
  | { kind: 'customer'; account: StoredAccount }
  | null;

export async function resolveLister(req: Request): Promise<ListerIdentity> {
  const token = bearerToken(req);
  if (!token) return null;

  const supervisor = await supervisorForToken(token);
  if (supervisor) return { kind: 'supervisor' };

  const account = await accountForToken(token);
  if (account) return { kind: 'customer', account };

  return null;
}

/**
 * Whoever is holding the bearer token, whichever of the three they are.
 *
 * For the routes that serve all of them and scope the answer per audience —
 * the notification feed being the one that does. `null` means the token is
 * absent, expired, revoked, or belongs to somebody who has since been blocked or
 * taken off the roster; all four are the same answer to a caller.
 */
export type Caller =
  | { kind: 'supervisor'; supervisor: StoredSupervisor }
  | { kind: 'rider'; rider: StoredRider }
  | { kind: 'customer'; account: StoredAccount }
  | null;

export async function resolveCaller(req: Request): Promise<Caller> {
  const token = bearerToken(req);
  if (!token) return null;

  const supervisor = await supervisorForToken(token);
  if (supervisor) return { kind: 'supervisor', supervisor };

  const rider = await riderForToken(token);
  if (rider) return { kind: 'rider', rider };

  const account = await accountForToken(token);
  if (account) return { kind: 'customer', account };

  return null;
}

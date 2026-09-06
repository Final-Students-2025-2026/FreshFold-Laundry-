/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  jobToBooking,
  jobToOrder,
  type Booking,
  type Job,
  type Order,
  type RiderState,
} from '@freshfold/core';
import { store } from './store';

export async function findJob(id: string): Promise<Job | null> {
  return store.jobs.find(id);
}

export async function findRider(id?: string): Promise<RiderState | undefined> {
  if (!id) return undefined;
  return (await store.riders.find(id)) ?? undefined;
}

/**
 * Whoever the view is being built for.
 *
 * Structural rather than imported, so both `BookingAccess` and `ListerIdentity`
 * satisfy it without this module depending on `./booking-access` — which
 * depends on this one.
 */
export type Viewer = { kind: 'supervisor' | 'customer' | 'rider' | 'tracking' } | null | undefined;

/**
 * The customer's view of a job, with the rider's live position attached when
 * one is on it. This is the join that makes the website's dispatch map show a
 * real courier instead of an animation.
 *
 * `viewer` decides one field: the hub's drop-off code, which only the desk may
 * be shown — see `BookingViewOptions.hubCode`. Omitting the argument omits the
 * code, so a route that has no identity to hand over, or has simply not been
 * told to think about it, is safe by default. The two call sites that pass
 * nothing do it deliberately: a booking being created has no reader yet, and a
 * view built to fill in a confirmation email has no business carrying a code
 * into somebody's inbox.
 */
export async function bookingView(job: Job, viewer?: Viewer): Promise<Booking> {
  return jobToBooking(job, await findRider(job.dispatch.riderId), {
    hubCode: viewer?.kind === 'supervisor',
  });
}

/**
 * The same view for a whole list, with one query for the couriers instead of
 * one per job.
 *
 * The customer portal asks for a booking history on every poll. Resolving each
 * job's rider on its own would turn a page of twenty orders into twenty-one
 * round trips to Supabase, most of them asking about the same two couriers.
 */
export async function bookingViews(jobs: Job[], viewer?: Viewer): Promise<Booking[]> {
  const options = { hubCode: viewer?.kind === 'supervisor' };

  const riderIds = new Set(
    jobs.map((job) => job.dispatch.riderId).filter((id): id is string => Boolean(id))
  );

  if (riderIds.size === 0) return jobs.map((job) => jobToBooking(job, undefined, options));

  const riders = await store.riders.list();
  const byId = new Map(riders.map((rider) => [rider.id, rider]));

  return jobs.map((job) => jobToBooking(job, byId.get(job.dispatch.riderId ?? ''), options));
}

export function orderView(job: Job): Order {
  return jobToOrder(job);
}

/**
 * What a *write* answers with: the same view, minus the proof-of-service blobs.
 *
 * `store.jobs.find` reads a job whole, blobs and all — the mutation routes need
 * that to make their checks under the row lock. Handing the result straight
 * back means a courier who has just uploaded four digits then waits on every
 * photograph already attached to that job coming the other way: at the door
 * that is the pickup photo *and* the delivery photo, over a phone's signal.
 * When that does not finish inside the client's timeout the write is reported
 * as unreachable having already landed, and the courier is sent to redo a
 * hand-off the hub or the customer already has.
 *
 * Nothing reads these bodies — the apps have just said what changed, and their
 * next poll brings the board back anyway. Whatever draws a photograph asks the
 * `:id` route for it, which is the one place that still carries them.
 */
export function writtenOrderView(job: Job): Order {
  const {
    pickupPhoto: _pickupPhoto,
    pickupSignature: _pickupSignature,
    deliveryPhoto: _deliveryPhoto,
    deliverySignature: _deliverySignature,
    ...rest
  } = jobToOrder(job);
  return rest;
}

export function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function notFound(res: Response, what: string): Response {
  return res.status(404).json({ error: `${what} not found` });
}

/**
 * What a suspended customer is told, wherever they meet the block — signing in,
 * claiming an account, booking a pickup.
 *
 * One sentence, in one place, and deliberately not the supervisor's reason: the
 * note behind a block is written for the desk, and a customer reading it back
 * verbatim is not what anybody typing it had in mind. It says who to ask.
 */
export const ACCOUNT_BLOCKED_MESSAGE =
  'This account has been suspended. Please contact FreshFold to have it reviewed.';

/** Machine-readable companion, so an app can route to support rather than parse. */
export const ACCOUNT_BLOCKED_CODE = 'ACCOUNT_BLOCKED';

/** Answers a request from, or about, a suspended account. */
export function accountBlocked(res: Response): Response {
  return res.status(403).json({ error: ACCOUNT_BLOCKED_MESSAGE, code: ACCOUNT_BLOCKED_CODE });
}

/**
 * Wraps an async handler so a rejected promise becomes a 500 instead of a hang.
 *
 * ---
 *
 * **What comes back, and what does not.**
 *
 * This used to answer with `error.message` verbatim. Because it is the wrapper
 * on every async route in the product, that made one malformed request against
 * any of them a way to read the schema: a `postgres.js` error names the table,
 * the column, the constraint and often the offending value, and a failed
 * `fetch` names the upstream host. None of that is useful to a caller and all
 * of it is useful to somebody mapping the place out.
 *
 * So a 500 now carries a fixed sentence and a `reference` — eight hex
 * characters, logged beside the real error. A customer reporting "it said
 * something went wrong, reference 3f9a1c04" gives the desk something to grep
 * for, which is more than the raw message ever gave them: `duplicate key value
 * violates unique constraint "accounts_email_lower_idx"` is not a sentence
 * anybody reads out over the phone.
 *
 * Outside production the message is included as well. Losing it there would
 * mean every development 500 requiring a trip to the server log, which is the
 * kind of friction that gets a security control reverted.
 *
 * Note what this does *not* touch: the deliberate 4xx bodies every route writes
 * for itself. `insufficient-funds`, `reference-not-for-booking`,
 * `ACCOUNT_BLOCKED` and the rest are answers, not leaks, and they are written
 * by the route rather than caught here.
 */
export function guard(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch((error: unknown) => {
      const reference = randomBytes(4).toString('hex');

      // The method and path go in the log line: an id is only useful if the
      // entry it points at says what was being attempted.
      console.error(`[api] unhandled error ${reference} on ${req.method} ${req.originalUrl}:`, error);

      if (!res.headersSent) {
        res.status(500).json({
          error: 'Something went wrong on our end. Please try again.',
          reference,
          ...(process.env.NODE_ENV === 'production'
            ? {}
            : { detail: error instanceof Error ? error.message : String(error) }),
        });
      }
    });
  };
}

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

/**
 * How many rows a list route may return, from what the caller asked for.
 *
 * Every list route on this server is read on a five-second poll by a desk that
 * is left open all shift, so an unbounded one is not a slow query that shows up
 * under load later — it is a query whose cost grows with the ledger until the
 * poll stops finishing. The web client aborts its own request after eight
 * seconds and reports the abort as a dropped connection, so the first symptom
 * is a board that says there is no connection while the server is answering
 * perfectly well, just too slowly.
 *
 * Floored because `?limit=10.5` reaches Postgres as a numeric it rounds on its
 * own, and a page size decided by rounding rules is not one anybody asked for.
 * Anything unparseable, negative, zero or absent takes the fallback, which is
 * what every current caller relies on — none of them send this parameter.
 *
 * The audit trail and the desk inbox each grew their own copy of this, the
 * second one commented "for the same reason the audit route floors it". This is
 * that reason, written once.
 */
export function pageLimit(
  asked: unknown,
  { fallback, max }: { fallback: number; max: number }
): number {
  const n = Number(asked);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback;
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
    /**
     * Whether the caller hung up before we answered.
     *
     * `close` fires on every response, successful or not — `writableFinished`
     * is what tells the two apart. Recorded on `res.locals` so a handler that
     * is part-way through can ask; see {@link callerGone}.
     *
     * Listened for here rather than per route because this wrapper is already
     * the one thing every handler on this server passes through.
     */
    res.on('close', () => {
      if (res.writableFinished) return;
      res.locals.callerGone = true;

      // Worth a line, because this is the shape of a server being outrun rather
      // than a server being wrong. The desk polls three reads every five
      // seconds against an eight-second client timeout, so once responses start
      // arriving late the aborted ones pile up and compete with the requests
      // that replaced them. A log full of these is that feedback loop, and it
      // does not look like anything else in this file.
      console.warn(`[api] caller left before the answer: ${req.method} ${req.originalUrl}`);
    });

    handler(req, res, next).catch((error: unknown) => {
      const reference = randomBytes(4).toString('hex');

      // The method and path go in the log line: an id is only useful if the
      // entry it points at says what was being attempted.
      console.error(`[api] unhandled error ${reference} on ${req.method} ${req.originalUrl}:`, error);

      if (!res.headersSent && !callerGone(res)) {
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

/**
 * Whether there is still somebody on the other end to receive an answer.
 *
 * ## What this is for, and what it deliberately is not for
 *
 * The web client gives a request eight seconds and then aborts it, and the desk
 * re-asks for the whole board every five. Nothing here noticed: the handler ran
 * to completion, projected the rows, serialised them and wrote the result to a
 * socket with nobody behind it. On a free instance with a tenth of a CPU that
 * is not merely waste — it is the loop that sustains the problem, because the
 * work done for callers who have gone is what makes the next caller slow enough
 * to leave too.
 *
 * So **reads** check this and stop. The saving is real: `GET /api/jobs` returns
 * records whole, proof-of-service photographs included, and serialising a page
 * of those for nobody is the most expensive thing this server can be asked to
 * do.
 *
 * **Writes deliberately do not.** A supervisor confirming a wash has already
 * washed the laundry; the transaction records something that happened in the
 * world, and rolling it back because a mobile connection dropped on the way to
 * the reply would lose the fact rather than undo it. The desk is built around
 * exactly this: a confirmation that times out says the order *may well* have
 * gone through and re-reads to find out, which is only honest as long as the
 * server behaves this way. Making writes abortable would silently make that
 * message a lie, so it is a decision recorded here rather than an oversight.
 *
 * The right answer for writes is an idempotency key, so a client can retry
 * without asking a human whether it landed. That is a larger change and this is
 * not it.
 */
export function callerGone(res: Response): boolean {
  return res.locals.callerGone === true || res.destroyed;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Calling a booking off, and the rules about when that is still possible.
 *
 * Before this, cancelling was a `PATCH /bookings/:id` carrying
 * `status: 'Cancelled'` — and `status` is on that route's supervisor-only list,
 * so the field was stripped before it reached the record. The customer's app
 * showed the order cancelled because it had written that to its own mirror; the
 * next pull brought back the stage the server still held, and the order
 * reappeared as though nothing had happened. Nothing was broken enough to raise
 * an error, which is why it survived: the write succeeded, it just did not carry
 * the only field it was sent for.
 *
 * So cancelling gets a route of its own, and the decision about whether it is
 * allowed lives here rather than in that route — for the reason `./reschedule`
 * gives at the same length. Three surfaces ask this question and have to get one
 * answer: the server, which enforces it, and the two order screens, which have
 * to stop offering the button before it is pressed.
 *
 * What this deliberately does not do is move money. A cancelled booking that was
 * paid for is refunded by the desk through `POST /bookings/:id/refund`, which is
 * a supervisor act with a ledger row behind it — the same division the cancel
 * dialog has always described: "anything already paid is refunded to your wallet
 * by the concierge desk."
 */

import type { JobStatus } from './types';

/**
 * The dispatch states a customer may still call an order off from.
 *
 * One status wider than `MOVABLE` in `./reschedule`, and the difference is the
 * point: a courier standing at the door is past the moment where *moving* the
 * collection means anything, but turning them away is exactly what cancelling
 * is. The line falls where the bags do — once they are scanned onto the job the
 * laundry is holding somebody's clothes, and giving them back is a conversation
 * with the desk rather than a button.
 */
const CANCELLABLE: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'unassigned',
  'assigned',
  'navigating_to_pickup',
  'arrived_at_pickup',
]);

/** Why a booking cannot be called off, in a form a caller can branch on. */
export type CancelRefusal = 'collected' | 'delivered' | 'already-cancelled';

export interface CancelRefused {
  ok: false;
  reason: CancelRefusal;
  /** Sentence to show the customer. The server sends this one back verbatim. */
  message: string;
}

export interface CancelAllowed {
  ok: true;
}

export type CancelCheck = CancelAllowed | CancelRefused;

function refuse(reason: CancelRefusal, message: string): CancelRefused {
  return { ok: false, reason, message };
}

/**
 * Whether this order can still be called off by the customer holding it.
 *
 * Takes the dispatch status rather than the whole job, because that is the only
 * thing the answer turns on and it keeps the customer app's order screen from
 * having to build a `Job` to ask.
 *
 * The desk is not held to this — a supervisor cancelling a collected order is a
 * decision somebody is making on purpose, and they have the refund route to
 * settle what it costs. See the route.
 */
export function checkCancel(status: JobStatus): CancelCheck {
  if (status === 'cancelled') {
    return refuse('already-cancelled', 'This order has already been cancelled.');
  }

  if (status === 'delivered') {
    return refuse(
      'delivered',
      'This order has already been delivered, so there is nothing left to call off.'
    );
  }

  if (!CANCELLABLE.has(status)) {
    return refuse(
      'collected',
      'Your laundry has already been collected, so this cannot be cancelled here. ' +
        'The concierge desk can still call it off — and refund it — if you ask them.'
    );
  }

  return { ok: true };
}

/** Whether an order screen should offer the cancel button at all. */
export function canCancel(status: JobStatus): boolean {
  return checkCancel(status).ok;
}

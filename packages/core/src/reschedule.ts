/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Moving a booking, and the rules about when that is still possible.
 *
 * Before this there was no rescheduling at all. A customer who needed to move
 * Tuesday to Thursday had to cancel and rebook, which lost their reference,
 * their three hand-off codes and — if they had already paid — put their money
 * through the refund flow to come back out the other side as a new order. The
 * pieces were nearly all present: `applyBookingPatch` already wrote
 * `pickupDate` and `pickupTime`, and `PATCH /bookings/:id` already accepted
 * them. What was missing was anything that decided *whether the move was
 * allowed* — so the same PATCH that corrected a house number could also drag a
 * job the courier was standing in front of into next week.
 *
 * That decision lives here rather than in the route, because three surfaces ask
 * the same question and have to get the same answer: the server, which enforces
 * it, and the two order screens, which have to grey out the button before the
 * customer presses it. A rule enforced only on the server reads to the customer
 * as a form that lies.
 *
 * Nothing here reprices. A reschedule moves the calendar and touches nothing
 * else — same services, same quantities, same total, same hand-off codes, same
 * reference. That is the whole point of it existing.
 */

import { isIsoDate, isoPlusDays, todayIso } from './dates';
import { DELIVERY_SLOTS, PICKUP_SLOTS, findSlot, type TimeSlot } from './pricing';
import type { Job, JobStatus } from './types';

/**
 * How many times one booking may be moved.
 *
 * Finite because a window held and released repeatedly is a window nobody else
 * could book, and because a courier's day planned around an order that keeps
 * moving is a day that cannot be planned. Two is enough for "something came up"
 * twice and short of a booking used as a rolling reservation; past it the
 * customer cancels and rebooks, which is what they had to do for everything
 * before this existed.
 */
export const MAX_RESCHEDULES = 2;

/**
 * How close to a window it stops being movable, in hours.
 *
 * Two, because that is roughly when the desk commits a round: the bags a
 * courier is about to collect are on a route that was planned around them.
 * Applies to the window being left as well as the one being moved into — a
 * customer cannot slip out of a collection that is about to happen any more
 * than they can drop into one.
 */
export const RESCHEDULE_CUTOFF_HOURS = 2;

/**
 * How far ahead a booking may be moved, in days.
 *
 * The same horizon the booking forms open on. Without it a reschedule is a way
 * to park an order on the board indefinitely, which is a job the dispatch
 * screen carries and nobody ever works.
 */
export const RESCHEDULE_HORIZON_DAYS = 30;

/**
 * The dispatch states in which the bags are still at the customer's door.
 *
 * The same set both order screens already use to decide whether to show the
 * collection code, minus `arrived_at_pickup`: a courier standing at the door is
 * past the point where moving the collection means anything, and a customer who
 * wants to send them away is cancelling rather than rescheduling.
 */
const MOVABLE: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'unassigned',
  'assigned',
  'navigating_to_pickup',
]);

/** Why a booking cannot be moved, in a form a caller can branch on. */
export type RescheduleRefusal =
  | 'collected'
  | 'cancelled'
  | 'allowance-spent'
  | 'invalid-date'
  | 'unknown-slot'
  | 'in-the-past'
  | 'too-soon'
  | 'too-far'
  | 'delivery-before-pickup'
  | 'no-change';

export interface RescheduleRefused {
  ok: false;
  reason: RescheduleRefusal;
  /** Sentence to show the customer. The server sends this one back verbatim. */
  message: string;
}

export interface RescheduleAllowed {
  ok: true;
}

export type RescheduleCheck = RescheduleAllowed | RescheduleRefused;

/** What the customer is asking to change it to. */
export interface RescheduleRequest {
  pickupDate: string;
  pickupTime: string;
  /**
   * Optional: a customer moving only the collection keeps the return window
   * they already chose, and the date is re-derived from the new pickup by
   * {@link rescheduledDelivery} so it cannot end up before it.
   */
  deliveryTime?: string;
}

function refuse(reason: RescheduleRefusal, message: string): RescheduleRefused {
  return { ok: false, reason, message };
}

/**
 * The instant a window opens on a given day, as a UTC `Date`.
 *
 * UTC throughout, deliberately, and for the reason `./dates` explains at
 * length: Ghana is GMT+0, so a window's hours and its UTC hours are the same
 * number, and doing the arithmetic in the reader's local frame would make a
 * cut-off pass at a different moment depending on where the customer was
 * standing.
 */
export function slotStartsAt(date: string, slot: TimeSlot): Date | null {
  if (!isIsoDate(date)) return null;

  const [year, month, day] = date.split('-').map(Number);
  const minutes = Math.round((slot.startHour % 1) * 60);
  return new Date(Date.UTC(year, month - 1, day, Math.floor(slot.startHour), minutes));
}

/**
 * Whether this booking is still movable at all, before looking at where to.
 *
 * Split from {@link checkReschedule} because the order screens need this half on
 * its own: it is what decides whether the "Move this pickup" button appears,
 * and at that point there is no proposed date to check.
 */
export function canReschedule(job: Job, now: Date = new Date()): RescheduleCheck {
  if (job.status === 'cancelled') {
    return refuse('cancelled', 'This order was cancelled. Place a new one to book another pickup.');
  }

  if (!MOVABLE.has(job.status)) {
    return refuse(
      'collected',
      'Your laundry is already with us, so the collection cannot be moved. ' +
        'Message the desk if the return needs to change.'
    );
  }

  const used = job.schedule.rescheduleCount ?? 0;
  if (used >= MAX_RESCHEDULES) {
    return refuse(
      'allowance-spent',
      `This booking has already been moved ${used} times, which is the limit. ` +
        'Cancel and rebook if the date has to change again.'
    );
  }

  /**
   * The window it is sitting in now has to still be far enough off.
   *
   * Otherwise a customer could move out of a collection that is minutes away —
   * the courier is already routed around it, which is the same reason they
   * cannot move *into* one. Skipped when the current slot is unrecognisable,
   * which is true of records written before the slots were a fixed list: there
   * is no time to compare against, and refusing on that basis would freeze
   * every old booking.
   */
  const current = findSlot(PICKUP_SLOTS, job.schedule.pickupTime);
  const startsAt = current ? slotStartsAt(job.schedule.pickupDate, current) : null;

  if (startsAt && startsAt.getTime() - now.getTime() < RESCHEDULE_CUTOFF_HOURS * 3_600_000) {
    return refuse(
      'too-soon',
      `Your courier is already on the way for this window. Changes need at least ` +
        `${RESCHEDULE_CUTOFF_HOURS} hours' notice — call the desk if it is urgent.`
    );
  }

  return { ok: true };
}

/**
 * Whether this booking may be moved to this particular date and window.
 *
 * Capacity is deliberately not checked here: it is a question about the
 * database, and this module runs in three places, two of which have no database
 * to ask. The route checks it immediately afterwards, on a locked row, which is
 * the only place it can be checked without lying.
 */
export function checkReschedule(
  job: Job,
  request: RescheduleRequest,
  now: Date = new Date()
): RescheduleCheck {
  const movable = canReschedule(job, now);
  if (!movable.ok) return movable;

  if (!isIsoDate(request.pickupDate)) {
    return refuse('invalid-date', 'Choose a collection date.');
  }

  const slot = findSlot(PICKUP_SLOTS, request.pickupTime);
  if (!slot) {
    return refuse('unknown-slot', 'Choose one of the collection windows offered.');
  }

  if (request.deliveryTime && !findSlot(DELIVERY_SLOTS, request.deliveryTime)) {
    return refuse('unknown-slot', 'Choose one of the return windows offered.');
  }

  const startsAt = slotStartsAt(request.pickupDate, slot);
  if (!startsAt) {
    return refuse('invalid-date', 'Choose a collection date.');
  }

  if (request.pickupDate < todayIso(now)) {
    return refuse('in-the-past', 'That date has passed. Choose a day from today onwards.');
  }

  if (startsAt.getTime() - now.getTime() < RESCHEDULE_CUTOFF_HOURS * 3_600_000) {
    return refuse(
      'too-soon',
      `That window is too close to arrange. Choose one at least ` +
        `${RESCHEDULE_CUTOFF_HOURS} hours from now.`
    );
  }

  const horizon = isoPlusDays(todayIso(now), RESCHEDULE_HORIZON_DAYS);
  if (horizon && request.pickupDate > horizon) {
    return refuse(
      'too-far',
      `Collections can be booked up to ${RESCHEDULE_HORIZON_DAYS} days ahead.`
    );
  }

  /**
   * Moving it to where it already is is refused rather than accepted quietly.
   *
   * It would otherwise spend one of two allowances on a no-op — both clients
   * replay queued writes, and a customer pressing "confirm" twice on a slow
   * connection should not find they have used up their moves. The delivery
   * window counts as a change, so choosing a different return on the same day
   * is a real reschedule.
   */
  const sameDay = request.pickupDate === job.schedule.pickupDate;
  const sameSlot = request.pickupTime === job.schedule.pickupTime;
  const sameReturn =
    !request.deliveryTime || request.deliveryTime === (job.schedule.deliveryTime ?? '');

  if (sameDay && sameSlot && sameReturn) {
    return refuse('no-change', 'That is when the collection is already booked.');
  }

  return { ok: true };
}

/**
 * The return leg that goes with a collection.
 *
 * One day after, which is the turnaround the whole product is written around —
 * both booking forms had their own copy of this arithmetic, and the express
 * service is the exception the desk arranges rather than something the form
 * offers. Falls back to the pickup date only if the arithmetic cannot be done,
 * which `isoPlusDays` reserves for input that is not a date.
 */
export function rescheduledDelivery(pickupDate: string): string {
  return isoPlusDays(pickupDate, 1) ?? pickupDate;
}

/**
 * The delivery window a return may be booked into, given when it is collected.
 *
 * All three, normally. The exception is a same-day return, where the laundry
 * has to actually be back before the courier sets out with it — so a window
 * that opens before the collection window has closed is not offered. Callers
 * pass the delivery date so this stays a pure comparison of two calendar days
 * and does not have to re-derive the turnaround itself.
 */
export function deliverySlotsFor(
  pickupDate: string,
  pickupTime: string,
  deliveryDate: string
): readonly TimeSlot[] {
  if (deliveryDate !== pickupDate) return DELIVERY_SLOTS;

  const pickup = findSlot(PICKUP_SLOTS, pickupTime);
  if (!pickup) return DELIVERY_SLOTS;

  return DELIVERY_SLOTS.filter((slot) => slot.startHour >= pickup.endHour);
}

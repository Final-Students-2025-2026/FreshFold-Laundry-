/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for moving a booking, and for the return window it moves with.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * Its own file rather than a section of `money.check.ts` because nothing here
 * decides a price — a reschedule deliberately does not reprice — and rather
 * than a section of `details.check.ts` because these are rules about *whether*
 * a change is allowed rather than about whether a value is well formed.
 *
 * The clock is passed in everywhere. Every assertion below is about a
 * comparison against "now", and a check whose answer changes at 4pm is a check
 * that fails in CI on a Thursday and passes when somebody runs it by hand.
 */

import { check, checkTrue, report, section } from './check';
import { bookingToJob, jobToBooking, jobToOrder } from './job';
import {
  DELIVERY_SLOTS,
  DELIVERY_TIME_SLOTS,
  PICKUP_SLOTS,
  PICKUP_TIME_SLOTS,
  findSlot,
} from './pricing';
import { canCancel, checkCancel } from './cancellation';
import {
  MAX_RESCHEDULES,
  RESCHEDULE_CUTOFF_HOURS,
  RESCHEDULE_HORIZON_DAYS,
  canReschedule,
  checkReschedule,
  deliverySlotsFor,
  rescheduledDelivery,
  slotStartsAt,
} from './reschedule';
import type { Booking, Job, JobStatus } from './types';

const MORNING = PICKUP_TIME_SLOTS[0];
const AFTERNOON = PICKUP_TIME_SLOTS[1];
const EVENING = PICKUP_TIME_SLOTS[2];

/** Monday 24 August 2026, 09:00 UTC — mid-morning, mid-week, no month edge. */
const NOW = new Date('2026-08-24T09:00:00Z');

/**
 * A job as the reschedule rules see it.
 *
 * Only the four fields the rules read are meaningful; the rest exist because
 * `Job` requires them. Cast rather than filled out in full, because a fixture
 * that carries thirty irrelevant fields hides the four that matter.
 */
function job(over: {
  status?: JobStatus;
  pickupDate?: string;
  pickupTime?: string;
  deliveryTime?: string;
  rescheduleCount?: number;
} = {}): Job {
  return {
    id: 'FFC-000001',
    status: over.status ?? 'unassigned',
    schedule: {
      pickupDate: over.pickupDate ?? '2026-08-26',
      pickupTime: over.pickupTime ?? MORNING,
      deliveryDate: '2026-08-27',
      deliveryTime: over.deliveryTime,
      rescheduleCount: over.rescheduleCount,
    },
  } as Job;
}

/** The refusal reason, or `'ok'`. Reads better in a one-line assertion. */
function why(result: ReturnType<typeof checkReschedule>): string {
  return result.ok ? 'ok' : result.reason;
}

// ---------------------------------------------------------------------------
section('the windows are a closed, dated set');

// The slots used to be three display strings. Rescheduling needs to compare
// them against a clock, and parsing the hours back out of the marketing copy
// would make the label load-bearing.
checkTrue('every pickup label resolves to a window with hours',
  PICKUP_TIME_SLOTS.every((label) => findSlot(PICKUP_SLOTS, label) !== null));
checkTrue('every delivery label resolves to a window with hours',
  DELIVERY_TIME_SLOTS.every((label) => findSlot(DELIVERY_SLOTS, label) !== null));
checkTrue('the two lists do not share a label, so a stored value says which leg it is',
  DELIVERY_TIME_SLOTS.every((label) => !PICKUP_TIME_SLOTS.includes(label)));
checkTrue('every window ends after it starts',
  [...PICKUP_SLOTS, ...DELIVERY_SLOTS].every((slot) => slot.endHour > slot.startHour));
check('a label from neither list resolves to nothing',
  findSlot(PICKUP_SLOTS, '07:00 AM - 09:00 AM (Invented)'), null);

check('the evening window starts at 17:30 UTC',
  slotStartsAt('2026-08-24', PICKUP_SLOTS[2])?.toISOString(), '2026-08-24T17:30:00.000Z');
check('a date that is not a date has no start time',
  slotStartsAt('not-a-date', PICKUP_SLOTS[0]), null);

// ---------------------------------------------------------------------------
section('whether a booking is movable at all');

check('a fresh unassigned booking is', why(canReschedule(job(), NOW)), 'ok');
check('one a courier has accepted still is',
  why(canReschedule(job({ status: 'assigned' }), NOW)), 'ok');
check('one the courier is driving to still is',
  why(canReschedule(job({ status: 'navigating_to_pickup' }), NOW)), 'ok');

// A courier standing at the door is past the point where moving the collection
// means anything — that customer is cancelling, not rescheduling.
check('one with the courier at the door is not',
  why(canReschedule(job({ status: 'arrived_at_pickup' }), NOW)), 'collected');
check('one already collected is not',
  why(canReschedule(job({ status: 'picked_up' }), NOW)), 'collected');
check('one being washed is not',
  why(canReschedule(job({ status: 'processing' }), NOW)), 'collected');
check('a delivered one is not',
  why(canReschedule(job({ status: 'delivered' }), NOW)), 'collected');
check('a cancelled one is not, and says so distinctly',
  why(canReschedule(job({ status: 'cancelled' }), NOW)), 'cancelled');

check('the allowance runs out',
  why(canReschedule(job({ rescheduleCount: MAX_RESCHEDULES }), NOW)), 'allowance-spent');
check('...and one move short of it does not',
  why(canReschedule(job({ rescheduleCount: MAX_RESCHEDULES - 1 }), NOW)), 'ok');

// The window it is sitting in has to still be far enough off: the courier is
// already routed around a collection that is minutes away.
check('a collection inside the cut-off cannot be moved out of',
  why(canReschedule(job({ pickupDate: '2026-08-24', pickupTime: MORNING }), NOW)), 'too-soon');
check('...but a later window on the same day can',
  why(canReschedule(job({ pickupDate: '2026-08-24', pickupTime: EVENING }), NOW)), 'ok');

// Records written before the slots were a fixed list have no time to compare
// against. Refusing on that basis would freeze every old booking.
check('a booking holding an unrecognisable window is not frozen by it',
  why(canReschedule(job({ pickupDate: '2026-08-24', pickupTime: 'Whenever' }), NOW)), 'ok');

// ---------------------------------------------------------------------------
section('where it may be moved to');

const move = (over: Parameters<typeof job>[0], to: { pickupDate: string; pickupTime: string; deliveryTime?: string }) =>
  why(checkReschedule(job(over), to, NOW));

check('another day, another window', move({}, { pickupDate: '2026-08-28', pickupTime: AFTERNOON }), 'ok');
check('the same day, a different window', move({}, { pickupDate: '2026-08-26', pickupTime: EVENING }), 'ok');

check('a date that has passed', move({}, { pickupDate: '2026-08-20', pickupTime: MORNING }), 'in-the-past');
check('a date that is not a date', move({}, { pickupDate: '2026-02-31', pickupTime: MORNING }), 'invalid-date');
check('a window nobody offers', move({}, { pickupDate: '2026-08-28', pickupTime: '3am' }), 'unknown-slot');
check('a return window nobody offers',
  move({}, { pickupDate: '2026-08-28', pickupTime: MORNING, deliveryTime: 'whenever' }), 'unknown-slot');

// Today's morning window has already started; today's evening one has not.
check('into a window that has all but started', move({}, { pickupDate: '2026-08-24', pickupTime: MORNING }), 'too-soon');
check('into a later window today', move({}, { pickupDate: '2026-08-24', pickupTime: EVENING }), 'ok');

check('beyond the horizon', move({}, { pickupDate: '2026-10-30', pickupTime: MORNING }), 'too-far');
check('the last day inside it', move({}, { pickupDate: '2026-09-23', pickupTime: MORNING }), 'ok');
checkTrue('...which is the horizon the constant names', RESCHEDULE_HORIZON_DAYS === 30);
checkTrue('the cut-off is the one the constant names', RESCHEDULE_CUTOFF_HOURS === 2);

// Confirming twice must not spend one of two moves.
check('moving it to where it already is', move({}, { pickupDate: '2026-08-26', pickupTime: MORNING }), 'no-change');
check('...but changing only the return window is a real change',
  move({ deliveryTime: DELIVERY_TIME_SLOTS[0] },
    { pickupDate: '2026-08-26', pickupTime: MORNING, deliveryTime: DELIVERY_TIME_SLOTS[2] }), 'ok');

// The first gate still applies once a date is on the table.
check('a collected booking is refused before the date is even looked at',
  move({ status: 'picked_up' }, { pickupDate: '2026-08-28', pickupTime: MORNING }), 'collected');

// ---------------------------------------------------------------------------
section('the return leg');

check('comes back the day after collection', rescheduledDelivery('2026-08-26'), '2026-08-27');
check('across a month end', rescheduledDelivery('2026-08-31'), '2026-09-01');
check('a date it cannot add to comes back unchanged', rescheduledDelivery(''), '');

check('a next-day return may use any window',
  deliverySlotsFor('2026-08-26', MORNING, '2026-08-27').length, DELIVERY_SLOTS.length);

// A same-day return cannot leave before the laundry is back: the morning
// collection closes at 11:00, so the 08:00 return window is not offered.
check('a same-day return after a morning collection loses the morning window',
  deliverySlotsFor('2026-08-26', MORNING, '2026-08-26').map((slot) => slot.label).join(' | '),
  [DELIVERY_TIME_SLOTS[1], DELIVERY_TIME_SLOTS[2]].join(' | '));
check('a same-day return after an evening collection has nowhere to go',
  deliverySlotsFor('2026-08-26', EVENING, '2026-08-26').length, 0);
check('an unrecognisable collection window does not narrow the returns',
  deliverySlotsFor('2026-08-26', 'Whenever', '2026-08-26').length, DELIVERY_SLOTS.length);

// ---------------------------------------------------------------------------
section('what the courier is told to work to');

/**
 * A real job, built the way the server builds one.
 *
 * Through `bookingToJob` rather than cast like `job()` above, because these
 * assertions are about what that conversion does — and because `jobToOrder`
 * reads fields the four-field fixture does not carry.
 */
function booking(over: { deliveryTime?: string; rescheduleCount?: number } = {}): Job {
  return bookingToJob({
    id: 'FFC-000002',
    name: 'A Customer',
    email: 'customer@example.com',
    phone: '0201234567',
    serviceType: 'Washing (Machine & Hand Wash)',
    pickupDate: '2026-08-26',
    pickupTime: MORNING,
    deliveryDate: '2026-08-27',
    deliveryTime: over.deliveryTime,
    rescheduleCount: over.rescheduleCount,
    address: '12 Ayeduase Road',
    suburb: 'Ayeduase',
    status: 'Scheduled',
    createdAt: '2026-08-24T09:00:00.000Z',
  } as Booking);
}

const onLeg = (status: JobStatus, deliveryTime?: string) =>
  jobToOrder({ ...booking({ deliveryTime }), status }).deadline;

// The stored deadline is written as `Pickup <window>` when the booking is made,
// so a courier driving clean laundry back was shown the one window on the job
// that had already passed.
check('a job nobody has taken names the collection window',
  onLeg('unassigned', DELIVERY_TIME_SLOTS[1]), `Pickup ${MORNING}`);
check('a courier on the way to collect names the collection window',
  onLeg('navigating_to_pickup', DELIVERY_TIME_SLOTS[1]), `Pickup ${MORNING}`);
// The middle of the round trip is neither leg: a courier driving collected bags
// to the hub is completing the collection, not starting the return.
check('a courier taking the bags to the hub still names the collection window',
  onLeg('picked_up', DELIVERY_TIME_SLOTS[1]), `Pickup ${MORNING}`);
check('...and while it is being washed',
  onLeg('processing', DELIVERY_TIME_SLOTS[1]), `Pickup ${MORNING}`);
check('once it is ready to go back it names the return window',
  onLeg('ready_for_delivery', DELIVERY_TIME_SLOTS[1]), `Return ${DELIVERY_TIME_SLOTS[1]}`);
check('and on the way out to deliver',
  onLeg('navigating_to_delivery', DELIVERY_TIME_SLOTS[2]), `Return ${DELIVERY_TIME_SLOTS[2]}`);
check('an order with no return window keeps the collection one rather than blanking',
  onLeg('navigating_to_delivery'), `Pickup ${MORNING}`);

// ---------------------------------------------------------------------------
section('the allowance travels with the job, not with a request');

/**
 * `bookingToJob` writes whatever the booking says onto the schedule.
 *
 * That is deliberate — the server restores the count from the row it is
 * replacing, so a replayed offline create keeps the moves already spent — and
 * it is exactly why `POST /bookings` strips the field off the incoming body
 * first. These two assertions are the reason that strip has to stay: without
 * it, the number below is the client's to choose.
 */
check('a count on the booking is written straight onto the job',
  booking({ rescheduleCount: -99 }).schedule.rescheduleCount, -99);
checkTrue('...and a negative one would be unlimited moves',
  canReschedule(job({ rescheduleCount: -99 }), NOW).ok);

check('a booking that names none leaves the job with none',
  booking().schedule.rescheduleCount, undefined);
check('a spent allowance survives the round trip back out to the customer',
  jobToBooking(booking({ rescheduleCount: 2 })).rescheduleCount, 2);

// ---------------------------------------------------------------------------
section('calling an order off');

/**
 * The sibling rule to the one above, and it lives here for the same reason: it
 * decides whether a change is allowed rather than what anything costs.
 *
 * Cancelling used to be a `PATCH` carrying `status: 'Cancelled'`, which the
 * route strips for anybody but the desk — so the write succeeded, the field was
 * dropped, and the customer's app was the only place the cancellation existed.
 * The next poll put the order back at the stage it had never left.
 *
 * The line falls one status later than `MOVABLE` above, and the difference is
 * the point: a courier at the door is past the moment where *moving* the
 * collection means anything, but turning them away is exactly what cancelling
 * is. Past that the bags are somebody else's to give back.
 */
/** The refusal reason, or null when the cancellation is allowed. */
const cancelReason = (status: JobStatus): string | null => {
  const verdict = checkCancel(status);
  return verdict.ok ? null : verdict.reason;
};

checkTrue('an unassigned order can be called off', canCancel('unassigned'));
checkTrue('so can one a courier has accepted', canCancel('assigned'));
checkTrue('so can one with a courier on the way', canCancel('navigating_to_pickup'));
checkTrue('a courier at the door can still be turned away',
  canCancel('arrived_at_pickup'));

// One status wider than a reschedule, which stops at the doorstep.
checkTrue('...which is one step further than a reschedule reaches',
  !canReschedule(job({ status: 'arrived_at_pickup' }), NOW).ok &&
    canCancel('arrived_at_pickup'));

checkTrue("once the bags are scanned it is not the customer's to cancel",
  !canCancel('pickup_scanned'));
checkTrue('nor once they are on the bike', !canCancel('picked_up'));
checkTrue('nor once the laundry is being washed', !canCancel('processing'));
check('...and the refusal says where the laundry is',
  cancelReason('processing'), 'collected');

check('a delivered order has nothing left to call off',
  cancelReason('delivered'), 'delivered');
check('a cancelled one says so rather than refusing generically',
  cancelReason('cancelled'), 'already-cancelled');

/**
 * Every refusal carries a sentence, because the route sends it back verbatim
 * and the order screen shows it. A reason with no message is a 409 that reaches
 * the customer as a spinner that stopped.
 */
checkTrue('every refusal carries something to show the customer',
  (['pickup_scanned', 'picked_up', 'processing', 'delivered', 'cancelled'] as JobStatus[])
    .every((status) => {
      const verdict = checkCancel(status);
      return !verdict.ok && verdict.message.trim().length > 0;
    }));

report();

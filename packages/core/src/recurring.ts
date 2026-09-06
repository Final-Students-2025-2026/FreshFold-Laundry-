/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standing orders: working out which date a weekly pickup falls on next.
 *
 * The plans screen sells "Weekly door-side pickups — 4 a month" and has done
 * since the membership tiers were written. `includedPickups` appears in a dozen
 * places and every one of them subtracts from it — nothing has ever scheduled
 * one. The customer who bought weekly pickups rebooks by hand every Sunday, and
 * the allowance they forget expires at renewal.
 *
 * All the arithmetic here is calendar arithmetic in UTC, for the reason `./dates`
 * sets out at length: a pickup date is a day on a wall calendar rather than an
 * instant, and "every Tuesday" must not become "every Monday" for a customer
 * whose phone is west of Greenwich. Ghana is GMT+0 so neither shows up at the
 * laundry; both show up for anybody testing from elsewhere, and an off-by-one in
 * a weekday reads as somebody having chosen the wrong day.
 */

import { isIsoDate, isoPlusDays, todayIso } from './dates';
import type { RecurringPickup } from './types';

/** How many days ahead a standing order may be materialised. */
export const MAX_LEAD_DAYS = 14;

/** Sunday-first, matching `Date.prototype.getUTCDay`. */
export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** The weekday a calendar date falls on, `0` Sunday through `6` Saturday. */
export function weekdayOf(iso: string): number | null {
  if (!isIsoDate(iso)) return null;

  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The first date on or after `from` that falls on `weekday`.
 *
 * On or after, not strictly after: a standing order for Tuesday that is being
 * evaluated on a Tuesday wants today, not next week. The caller decides whether
 * today is still bookable — that is a question about the collection cut-off,
 * which `./reschedule` owns and this module deliberately does not duplicate.
 */
export function nextOccurrence(from: string, weekday: number): string | null {
  const current = weekdayOf(from);
  if (current === null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;

  return isoPlusDays(from, (weekday - current + 7) % 7);
}

/** Why a standing order produced nothing on this pass. */
export type SkipReason =
  | 'paused'
  | 'not-started'
  | 'ended'
  | 'already-booked'
  | 'beyond-lead'
  | 'invalid';

export interface DueDate {
  ok: true;
  /** The collection date to book, `YYYY-MM-DD`. */
  date: string;
}

export interface NotDue {
  ok: false;
  reason: SkipReason;
}

/**
 * Whether this standing order owes a booking, and for which date.
 *
 * The whole of the sweep's decision, in one pure function, so the thing that
 * creates real bookings on a timer can be exercised without a database or a
 * clock. That matters more here than anywhere else in this package: a bug in
 * this function does not show up as a wrong number on a screen, it shows up as a
 * courier arriving at somebody's door on the wrong day, or twice.
 *
 * `lastBookedFor` is what makes it idempotent. Two server instances running the
 * same pass produce one booking, because the second reads a row whose date has
 * already moved — the same mechanism `hub.ts` uses to make its sweep safe to run
 * in more than one process.
 */
export function nextDue(
  pickup: RecurringPickup,
  now: Date = new Date()
): DueDate | NotDue {
  if (!pickup.active) return { ok: false, reason: 'paused' };

  const today = todayIso(now);

  if (pickup.startsOn && today < pickup.startsOn) return { ok: false, reason: 'not-started' };
  if (pickup.endsOn && today > pickup.endsOn) return { ok: false, reason: 'ended' };

  /**
   * Search from the day after the last one booked, or from today.
   *
   * From the day *after* so a standing order cannot book the same date twice —
   * which is the failure that puts two collections on one doorstep and charges
   * for both.
   */
  const searchFrom =
    pickup.lastBookedFor && pickup.lastBookedFor >= today
      ? isoPlusDays(pickup.lastBookedFor, 1)
      : today;

  if (!searchFrom) return { ok: false, reason: 'invalid' };

  const date = nextOccurrence(searchFrom, pickup.weekday);
  if (!date) return { ok: false, reason: 'invalid' };

  if (pickup.endsOn && date > pickup.endsOn) return { ok: false, reason: 'ended' };

  /**
   * Only book once the date is inside the lead window.
   *
   * A booking that exists occupies a collection window and shows on the dispatch
   * board, so materialising six weeks of them would fill the board with orders
   * nobody has confirmed and make `countByPickupSlot` refuse real customers on
   * behalf of hypothetical ones.
   */
  const horizon = isoPlusDays(today, Math.min(pickup.leadDays, MAX_LEAD_DAYS));
  if (!horizon) return { ok: false, reason: 'invalid' };

  if (date > horizon) return { ok: false, reason: 'beyond-lead' };
  if (pickup.lastBookedFor && date <= pickup.lastBookedFor) {
    return { ok: false, reason: 'already-booked' };
  }

  return { ok: true, date };
}

/** "Every Tuesday, 08:00 AM - 11:00 AM (Morning Concierge)" — for the customer. */
export function describeSchedule(pickup: Pick<RecurringPickup, 'weekday' | 'pickupTime'>): string {
  const day = WEEKDAYS[pickup.weekday] ?? 'Every week';
  return `Every ${day}, ${pickup.pickupTime}`;
}

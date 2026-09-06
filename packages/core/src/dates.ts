/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Calendar dates, as `YYYY-MM-DD`.
 *
 * A pickup date is a date on a wall calendar, not an instant. Nothing about
 * "collect on the 24th" refers to a moment in time, and the arithmetic that
 * turns it into "deliver on the 25th" should not be able to land on the 24th
 * because of where the customer is standing.
 *
 * Both booking forms did exactly that, with their own copy of the same three
 * lines:
 *
 * ```
 * const next = new Date(pickupDate);      // "2026-08-24" parses as UTC midnight
 * next.setDate(next.getDate() + 1);       // ...but getDate/setDate are LOCAL
 * next.toISOString().split('T')[0];       // ...and this reads back as UTC
 * ```
 *
 * Three different frames in three consecutive lines. West of Greenwich, UTC
 * midnight is the previous evening locally, so `getDate()` returns the 23rd,
 * adding one gives the 24th, and the delivery date comes back equal to the
 * pickup date — a same-day promise nobody made. East of Greenwich the
 * `isoDaysFromNow` variant fails the other way: late in the evening, "tomorrow"
 * is already today in UTC and the form opens on a date that has passed.
 *
 * Ghana is GMT+0, so neither shows up at the laundry. Both show up for anyone
 * testing from elsewhere, and neither is the sort of thing that announces
 * itself — it is an off-by-one in a date, which reads as somebody having typed
 * the wrong thing.
 *
 * The fix is to stop involving timezones at all. `parseIso` reads the string
 * into a UTC instant, every operation below stays in UTC, and `formatIso`
 * writes it back — so the arithmetic is pure calendar arithmetic and gives the
 * same answer everywhere on earth. The one function that legitimately needs a
 * timezone is {@link todayIso}, which asks what day it is *for the person
 * looking at the screen*, and so reads the local clock deliberately.
 */

/** `2026-08-24`. Anything else is not a calendar date as far as this goes. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether this is a `YYYY-MM-DD` string naming a real day. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;

  // `2026-02-31` matches the pattern and is not a date. Round-tripping catches
  // it: `Date.UTC` rolls it over to March, which formats back differently.
  const parsed = parseIso(value);
  return parsed !== null && formatIso(parsed) === value;
}

/** The `Date` at UTC midnight on this calendar day, or null. */
function parseIso(iso: string): Date | null {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return null;

  const [year, month, day] = iso.split('-').map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  return Number.isNaN(stamp) ? null : new Date(stamp);
}

/** `YYYY-MM-DD` for the UTC calendar day this instant falls on. */
function formatIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Today, on the calendar of whoever is looking.
 *
 * The local clock on purpose, and the only function here that reads it: what a
 * customer means by "today" is the date on their own wall, so a booking form
 * opening at 11pm should not already be showing tomorrow. Built out of the
 * local getters rather than `toISOString`, which is what converts to UTC and
 * reintroduces the whole problem.
 */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `days` after `iso`, as a calendar date. Negative counts backwards.
 *
 * Returns null for anything that is not a date, rather than guessing. Callers
 * decide what to show when the field they are reading is empty or half-typed —
 * a booking form mid-keystroke is the normal case, not an error.
 */
export function isoPlusDays(iso: string, days: number): string | null {
  const parsed = parseIso(iso);
  if (!parsed || !Number.isFinite(days)) return null;

  // `setUTCDate` past the end of a month rolls over correctly, and so does
  // February in a leap year — the calendar rules are the platform's, not ours.
  parsed.setUTCDate(parsed.getUTCDate() + Math.trunc(days));
  return formatIso(parsed);
}

/** `days` from today, on the local calendar. Used for date-picker defaults. */
export function isoDaysFromNow(days: number, now: Date = new Date()): string {
  // Via `todayIso` so the starting point is the customer's day, and via
  // `isoPlusDays` so the arithmetic on it is not.
  return isoPlusDays(todayIso(now), days) ?? todayIso(now);
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import { EMAIL_SHAPE, type Booking } from '@freshfold/core';
import { bookingRescheduledMail, bookingSetupMail, sendMail } from './email';
import { store, type StoredSetupToken } from './store';

/**
 * The emailed link that turns a booking into a login.
 *
 * Shared by the two halves of that journey: `/api/bookings` mints one when it
 * confirms a guest's pickup, and `/api/auth/claim` reads and spends it when
 * they choose a password. Neither owns it, so it lives here rather than being
 * imported across route modules.
 *
 * The token is 32 random bytes and only its sha-256 is stored, which is the
 * same shape as the confirmation and reset links in `routes/auth.ts` and for
 * the same reason: a token in a URL is a token in browser history, in the
 * referrer of anything the page loads, and in every mail scanner along the way.
 */

/**
 * How long a setup link stays good for.
 *
 * A week, against the confirmation link's day and the reset link's hour. This
 * one is on the slowest clock a customer is subject to — it arrives with a
 * booking whose pickup may be days out, and the moment they actually want it is
 * usually the moment the courier calls. It is also the weakest of the three in
 * what it can do: the account it opens has no password, no history and no
 * wallet, because it does not exist until the link is spent.
 */
export const SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashSetupToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mints a link for a booking and records its digest.
 *
 * Returns the raw token, which exists here and in the email and nowhere else.
 */
export async function issueSetupToken(bookingId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();

  await store.setupTokens.pruneExpired();
  await store.setupTokens.issue({
    tokenHash: hashSetupToken(token),
    bookingId,
    email,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SETUP_TTL_MS).toISOString(),
  });

  return token;
}

/** The live link behind a raw token, without spending it. */
export async function findSetupToken(token: string): Promise<StoredSetupToken | null> {
  if (!token) return null;
  return store.setupTokens.findLive(hashSetupToken(token));
}

/** Where the app is served, without a trailing slash. */
export function appOrigin(): string {
  return (process.env.APP_URL || 'http://localhost:4000').replace(/\/$/, '');
}

/**
 * The URL that opens the password screen.
 *
 * The token is the whole of the address — no booking id beside it. The claim
 * reads the booking from the token, so a link says nothing about which order it
 * belongs to until the server is willing to say so.
 */
export function setupLink(token: string): string {
  return `${appOrigin()}/#portal?setup=${token}`;
}

/**
 * Rough enough to skip an obvious non-address; Resend judges the rest.
 *
 * Re-exported from `@freshfold/core` rather than declared here, so that the two
 * booking forms reject the same addresses this refuses to mail. The existing
 * importers of `EMAIL_SHAPE` keep working unchanged.
 */
export { EMAIL_SHAPE };

/**
 * Mails a customer their booking confirmation and the way into the portal.
 *
 * This is the whole of "access passwords are created from a link you receive
 * after booking". A guest booking has no account behind it yet, so the mail
 * carries a single-use token that `/api/auth/claim` trades for one — and that
 * token is the only thing that opens the password screen, which is why this is
 * the one channel it goes out on. Somebody who already has a login is sent to
 * the portal instead, with no token minted: there is nothing to claim.
 *
 * Best effort throughout: a booking is not worth failing over a mail that did
 * not go out. Callers get a boolean for the cases where saying so is the whole
 * job, and the failure is logged either way — that is the only place it is
 * visible.
 */
export async function mailBookingConfirmation(booking: Booking): Promise<boolean> {
  const email = booking.email?.trim();
  if (!email || !EMAIL_SHAPE.test(email)) return false;

  try {
    const account = await store.accounts.find(email);
    const hasPassword = Boolean(account?.passwordHash);

    const link = hasPassword
      ? `${appOrigin()}/#portal`
      : setupLink(await issueSetupToken(booking.id, email));

    const sent = await sendMail(
      bookingSetupMail(
        email,
        mailDetails(booking),
        link,
        hasPassword
      )
    );

    if (!sent) console.error(`[bookings] confirmation mail failed for ${booking.id}`);
    return sent;
  } catch (error) {
    console.error(`[bookings] confirmation mail failed for ${booking.id}:`, error);
    return false;
  }
}

/** The booking, as the mail templates want it. */
function mailDetails(booking: Booking) {
  return {
    id: booking.id,
    name: booking.name,
    serviceType: booking.serviceType,
    items: booking.items,
    quantity: booking.quantity,
    pickupDate: booking.pickupDate,
    pickupTime: booking.pickupTime,
    deliveryDate: booking.deliveryDate,
    deliveryTime: booking.deliveryTime,
    address: [booking.address, booking.suburb].filter(Boolean).join(', '),
  };
}

/**
 * Tells the customer their collection moved, and what it moved from.
 *
 * No setup token on this one, unlike the confirmation. Rescheduling is behind
 * `resolveBookingAccess`, so whoever asked for it was already holding either a
 * session or the tracking token — they have a way in, and minting a second
 * password-setting link every time somebody changes a date would put a live
 * credential in the mail for no reason.
 *
 * Best effort, like everything else in this file: the booking has already moved
 * by the time this runs, and a mail provider having a bad morning must not make
 * the customer think it did not.
 */
export async function mailReschedule(
  booking: Booking,
  previous: { pickupDate: string; pickupTime: string },
  movesLeft: number
): Promise<boolean> {
  const email = booking.email?.trim();
  if (!email || !EMAIL_SHAPE.test(email)) return false;

  try {
    const sent = await sendMail(bookingRescheduledMail(email, mailDetails(booking), previous, movesLeft));
    if (!sent) console.error(`[bookings] reschedule mail failed for ${booking.id}`);
    return sent;
  } catch (error) {
    console.error(`[bookings] reschedule mail failed for ${booking.id}:`, error);
    return false;
  }
}

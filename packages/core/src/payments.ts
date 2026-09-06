/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a Paystack payment is *for*, written in one place and read in three.
 *
 * ---
 *
 * **The bug this module exists to make unrepresentable.**
 *
 * A checkout used to carry a free-form `metadata` object composed by the
 * client, which `/paystack/initialize` forwarded to Paystack verbatim and
 * Paystack echoed back on both the webhook and the verify. Two settlement
 * routes then read that echo as their only evidence of what the money was for:
 *
 *   - the wallet credited a payment whose `metadata.type` was `wallet_topup`
 *   - a booking settled a payment whose `metadata.booking_id` was its own id
 *
 * Each gate was written to stop the *other* path replaying a reference, and
 * each said so in its own comment. Neither stopped one intent carrying both
 * keys, because the caller wrote them. Open a checkout with
 * `{ type: 'wallet_topup', booking_id: 'FFC-482013' }`, pay ₵200 once, credit
 * ₵200 to the wallet, then spend the same reference settling the ₵200 booking.
 * Both gates passed. And because the ledger's `upsert` conflicts on the
 * reference, the second claim overwrote the row the first had left — so the
 * statement afterwards showed a single ₵200 payment and a ₵200 balance with
 * nothing behind it.
 *
 * The fix is structural rather than another check. A payment declares one
 * `purpose` from {@link PAYMENT_PURPOSES}; the server builds the metadata from
 * it with {@link buildPaymentMetadata}, which writes `booking_id` only on the
 * branch that set `type` to `booking`; and both gates read it back through
 * {@link paymentPurpose} and {@link paymentBookingId} rather than reaching into
 * the object themselves. Two purposes, one field, no way to hold both.
 *
 * It lives in `@freshfold/core` rather than in the server because the value a
 * client declares and the value the server gates on have to be one definition.
 * They were two that agreed, which is the weaker thing that looks the same
 * until one of them moves.
 */

/** Every purpose a checkout may be opened for. */
export const PAYMENT_PURPOSES = ['wallet_topup', 'booking'] as const;

export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return typeof value === 'string' && (PAYMENT_PURPOSES as readonly string[]).includes(value);
}

/**
 * Fields carried purely so the Paystack dashboard is readable.
 *
 * Safe for a client to compose precisely because nothing gates on any of it.
 * {@link buildPaymentMetadata} nests the whole object under one key, so a
 * caller who puts `type` or `booking_id` in here is writing a field no
 * settlement path reads.
 */
export interface PaymentDisplayFields {
  customer_name?: string;
  phone?: string;
  service?: string;
}

/** What a client sends to open a checkout. */
export interface PaystackInitPayload {
  email: string;
  amount: number;
  purpose: PaymentPurpose;
  /** Required when `purpose` is `booking`; ignored otherwise. */
  bookingId?: string;
  display?: PaymentDisplayFields;
  callback_url?: string;
}

/** The metadata Paystack stores against a transaction and echoes back. */
export interface PaymentMetadata {
  type: PaymentPurpose;
  booking_id?: string;
  display: PaymentDisplayFields;
}

/** Trims a display string to something a dashboard column can hold, or drops it. */
function displayField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined;
}

/**
 * Builds the metadata for a checkout. The only thing that should ever write it.
 *
 * `booking_id` appears on the `booking` branch and nowhere else, which is the
 * whole of the fix: the two settlement gates are mutually exclusive by
 * construction rather than by two comments agreeing about a convention.
 */
export function buildPaymentMetadata(
  purpose: PaymentPurpose,
  bookingId: string | undefined,
  display: PaymentDisplayFields | undefined
): PaymentMetadata {
  return {
    type: purpose,
    ...(purpose === 'booking' && bookingId ? { booking_id: bookingId.trim() } : {}),
    display: {
      customer_name: displayField(display?.customer_name),
      phone: displayField(display?.phone),
      service: displayField(display?.service),
    },
  };
}

/**
 * What a settled payment was opened for, or null when it says nothing valid.
 *
 * Takes `unknown` because it is reading a third party's echo of our own
 * object — Paystack round-trips it as JSON, and a payment created before this
 * shape existed carries whatever the old client composed. Anything that is not
 * a purpose from the list above reads as null, and every gate refuses null.
 */
export function paymentPurpose(metadata: unknown): PaymentPurpose | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const type = (metadata as { type?: unknown }).type;
  return isPaymentPurpose(type) ? type : null;
}

/**
 * The booking a payment names, or null.
 *
 * Null unless the purpose is `booking`, so a legacy top-up that still carries a
 * stray `booking_id` at the top level cannot be used to settle an order. That
 * combination is exactly the one the old format allowed.
 */
export function paymentBookingId(metadata: unknown): string | null {
  if (paymentPurpose(metadata) !== 'booking') return null;
  const id = (metadata as { booking_id?: unknown }).booking_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

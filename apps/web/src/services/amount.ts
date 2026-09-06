/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a booking costs, for display.
 *
 * `Booking.amount` is optional, and every pane that showed it invented its own
 * answer for the case where it is missing — a different one each time. The
 * customer's order card said `amount || 45`, the payment modal beneath it said
 * `|| 35`, and the two admin panes said `?? 50`. One booking, three prices,
 * depending on which screen was open.
 *
 * All three were also wrong about ₵0. `||` treats a free order as absent, so a
 * complimentary `Fast Pickup & Delivery` — which is genuinely ₵0 — was billed
 * at ₵45 on screen.
 *
 * So: the quoted amount whenever there is one, including zero, and otherwise
 * the list price re-derived from what the booking actually says it is. Nothing
 * is guessed.
 */

import { decodeFinish, priceBreakdown } from '@freshfold/core';
import type { Booking } from '../types';

export function displayAmount(booking: Booking): number {
  if (typeof booking.amount === 'number') return booking.amount;

  /**
   * The finish from the fields, and only then from the prose.
   *
   * `scent` and `starch` are on `Booking` now, written by both forms alongside
   * the sentence. `decodeFinish` is the fallback for a record made before they
   * existed, where the choice survives only inside `specialInstructions` — and
   * for one whose instructions were typed by hand, it correctly finds nothing.
   */
  const finish = decodeFinish(booking.specialInstructions);

  return priceBreakdown({
    serviceType: booking.serviceType,
    scent: booking.scent ?? finish.scent,
    starch: booking.starch ?? finish.starch,
    addonIds: booking.specialtyAddons,
    /**
     * The lines, so a re-derived price counts what was actually ordered.
     *
     * Without these an order of three loads fell back to the price of one —
     * `bookingItems` reads whichever of the two shapes the booking carries, so
     * passing both covers a record from before line items as well as one from
     * a client that only sends `quantity`.
     */
    items: booking.items,
    quantity: booking.quantity,
  }).gross;
}

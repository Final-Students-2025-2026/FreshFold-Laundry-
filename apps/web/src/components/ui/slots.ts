import { DELIVERY_SLOTS, PICKUP_SLOTS, type TimeSlot } from '@freshfold/core';

/**
 * A collection window, as a customer would say it.
 *
 * The stored labels are `08:00 AM - 11:00 AM (Morning Concierge)` and
 * `05:30 PM - 08:30 PM (Sunset Concierge)`, and they cannot be changed: core
 * documents them as frozen, because the string *is* the value on every booking
 * ever made and renaming one would orphan the lot.
 *
 * So the string stays and the presentation moves. "Concierge" and "Sunset
 * Transit" are the house style this product has otherwise stopped using, and a
 * customer reading their own receipt does not need our word for a van round —
 * they need the hours. Those come off `startHour`/`endHour`, which are the
 * fields core says are safe to tune, so this cannot drift from the window it
 * names.
 *
 * Falls back to the raw label for anything it does not recognise: a booking
 * made against a window that has since been retired should still print
 * something true rather than nothing.
 */
const KNOWN: readonly TimeSlot[] = [...PICKUP_SLOTS, ...DELIVERY_SLOTS];

/** `17.5` is half past five. */
function clock(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour % 1) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function windowLabel(stored: string | undefined | null): string {
  if (!stored) return '';
  const slot = KNOWN.find((candidate) => candidate.label === stored);
  if (!slot) return stored;
  return `${clock(slot.startHour)} – ${clock(slot.endHour)}`;
}

/**
 * How a payment method is named to the person making it.
 *
 * `paymentMethod` is a stored enum the desk and the ledger read; "Paystack" is
 * the name of a gateway, which is our supplier's name for our plumbing. The
 * customer chose "card or mobile money".
 */
export function paymentLabel(method: string | undefined | null): string {
  switch (method) {
    case 'Paystack':
      return 'Card or mobile money';
    case 'Wallet':
      return 'FreshFold wallet';
    case 'Pay on Pickup':
      return 'Cash on pickup';
    default:
      return method || 'Cash on pickup';
  }
}

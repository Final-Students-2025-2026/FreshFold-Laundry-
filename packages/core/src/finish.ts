/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The finish on a booking, as it is written down and read back.
 *
 * A booking has no `scent` field. Both booking forms flatten the choice into
 * `specialInstructions` as `"<scent> scent, <starch> starch. <notes>"`, which is
 * a serviceable wire format and was a disaster as an unwritten one: the format
 * was encoded in two places and decoded in none.
 *
 * So the website's portal, wanting to show the scent on the order card and on
 * the receipt, had no field to read and settled for `booking.specialtyAddons` —
 * the *add-ons* — with a hardcoded "French Lavender" for bookings that had none.
 * A customer who chose fragrance-free and paid for garment shielding was told
 * "Scent Option: Garment Shielding" on the website and the truth in the app, and
 * a customer who chose neither was shown a scent that is on no menu.
 *
 * What the finish *costs* is in `./pricing`, with the rest of the money.
 */

import { isGarmentService } from './pricing';

/**
 * Flatten the finish and the customer's own notes into `specialInstructions`.
 *
 * Non-garment services get the notes alone — writing "Organic Lavender scent,
 * None starch" onto a car detail is how the website used to describe a car.
 */
export function encodeFinish(input: {
  serviceType: string;
  scent: string;
  starch: string;
  notes?: string;
}): string | undefined {
  const notes = (input.notes ?? '').trim();
  if (!isGarmentService(input.serviceType)) return notes || undefined;
  return `${input.scent} scent, ${input.starch} starch.${notes ? ` ${notes}` : ''}`;
}

export interface BookingFinish {
  /** The scent as it was chosen, or absent on a booking that carries none. */
  scent?: string;
  starch?: string;
  /** Whatever the customer typed, with the finish prefix removed. */
  notes?: string;
}

const FINISH_PREFIX = /^\s*(.+?)\s+scent,\s*(.+?)\s+starch\.\s*/i;

/**
 * Read {@link encodeFinish} back.
 *
 * A booking whose instructions do not carry the prefix — an older one, a car
 * detail, or a note typed by hand — comes back as notes with no scent, which is
 * the honest answer. Callers render the scent only when there is one, rather
 * than substituting something plausible for something true.
 */
export function decodeFinish(specialInstructions?: string | null): BookingFinish {
  const raw = (specialInstructions ?? '').trim();
  if (!raw) return {};

  const match = FINISH_PREFIX.exec(raw);
  if (!match) return { notes: raw };

  return {
    scent: match[1].trim(),
    starch: match[2].trim(),
    notes: raw.slice(match[0].length).trim() || undefined,
  };
}

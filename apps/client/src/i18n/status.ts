/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BookingStatus, JobStatus, PaymentStatus } from '@freshfold/core';
import type { Translate } from './translate';

/**
 * The dispatch vocabulary, read in the customer's language.
 *
 * These replace core's `humanizeStatus` at this app's call sites. That function
 * stays exactly where it is and keeps doing exactly what it does — turning
 * `navigating_to_pickup` into `Navigating to pickup` for the desk console and the
 * rider app, neither of which is being translated. It carries no dictionary, so it
 * could not answer in Spanish even if it wanted to, and nothing that imports it needs
 * it to.
 *
 * Each key name is built from the union type, which makes this exhaustive by
 * construction: add a sixteenth `JobStatus` in core and this file stops compiling
 * until `en.ts` has a word for it. That check is the entire reason the keys in
 * `en.ts` mirror the wire values verbatim — spaces, ampersand and all — instead of
 * being tidied into slugs. A hand-written `Record<JobStatus, TranslationKey>` would
 * buy the same safety at the cost of a second list to keep in step.
 *
 * `t` is a parameter rather than a hook call because these are functions and not
 * components — the same reason `gatewayProblem` in the wallet screen takes one.
 */
export function jobStatusLabel(t: Translate, status: JobStatus): string {
  return t(`status.job.${status}`);
}

/** The coarse customer-facing stage, as worn by the progress bar and order lists. */
export function stageLabel(t: Translate, stage: BookingStatus): string {
  return t(`status.stage.${stage}`);
}

/** The sentence under the progress bar saying what the stage means. */
export function stageCopy(t: Translate, stage: BookingStatus): string {
  return t(`status.copy.${stage}`);
}

/**
 * Whether an order is paid, pending, refunded or settling at the door.
 *
 * The payment *method* beside it is not translated: `Booking.paymentMethod` is a
 * free-form string the server writes, not a union, so it belongs with the other
 * server-written words this app renders as they arrive.
 */
export function paymentStatusLabel(t: Translate, status: PaymentStatus): string {
  return t(`status.payment.${status}`);
}

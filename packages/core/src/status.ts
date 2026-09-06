/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BookingStatus, JobStatus } from './types';

/** The seven forward stages a customer sees, in order. */
export const BOOKING_STAGE_SEQUENCE: BookingStatus[] = [
  'Scheduled',
  'Collecting',
  'In Care',
  'Ironing & Folding',
  'Quality Check',
  'Delivering',
  'Delivered',
];

/**
 * Dispatch status -> customer stage.
 *
 * Many-to-one by design: the customer does not need to know the difference
 * between "arrived at pickup" and "bags scanned", only that collection is
 * under way.
 *
 * The delivery leg used to be the lossy edge — a courier riding to the door
 * still read as Quality Check, so the bar sat at 90% while somebody was
 * actually outside. `Delivering` is that leg, and it covers the ride and the
 * arrival; Quality Check now means what it says, garments finished and waiting
 * for a courier.
 */
const TO_BOOKING_STATUS: Record<JobStatus, BookingStatus> = {
  unassigned: 'Scheduled',
  assigned: 'Scheduled',
  navigating_to_pickup: 'Collecting',
  arrived_at_pickup: 'Collecting',
  pickup_scanned: 'Collecting',
  picked_up: 'Collecting',
  navigating_to_laundry: 'Collecting',
  arrived_at_laundry: 'Collecting',
  dropped_off: 'In Care',
  processing: 'Ironing & Folding',
  ready_for_delivery: 'Quality Check',
  navigating_to_delivery: 'Delivering',
  arrived_at_delivery: 'Delivering',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function toBookingStatus(status: JobStatus): BookingStatus {
  return TO_BOOKING_STATUS[status] ?? 'Scheduled';
}

/**
 * Customer stage -> dispatch status.
 *
 * Used when an operator moves a booking by hand from the admin dashboard.
 * Because the mapping above is lossy, this picks the *earliest* dispatch
 * status in each stage — nudging a booking to "In Care" should not silently
 * claim the pressing is already done.
 */
const FROM_BOOKING_STATUS: Record<BookingStatus, JobStatus> = {
  Scheduled: 'unassigned',
  Collecting: 'navigating_to_pickup',
  'In Care': 'dropped_off',
  'Ironing & Folding': 'processing',
  'Quality Check': 'ready_for_delivery',
  Delivering: 'navigating_to_delivery',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
};

export function fromBookingStatus(
  stage: BookingStatus,
  current?: JobStatus
): JobStatus {
  const mapped = FROM_BOOKING_STATUS[stage] ?? 'unassigned';

  // Don't drop a job that already has a rider back into the unassigned pool
  // just because someone re-selected "Scheduled".
  if (mapped === 'unassigned' && current && current !== 'unassigned') {
    return 'assigned';
  }
  return mapped;
}

/** Completion percentage for the customer's progress bar. */
export function bookingProgressPercent(stage: BookingStatus): number {
  switch (stage) {
    case 'Scheduled':
      return 10;
    case 'Collecting':
      return 30;
    case 'In Care':
      return 55;
    case 'Ironing & Folding':
      return 70;
    case 'Quality Check':
      return 82;
    case 'Delivering':
      return 93;
    case 'Delivered':
      return 100;
    case 'Cancelled':
      return 0;
    default:
      return 10;
  }
}

/** True once the job is off the board — delivered or cancelled. */
export function isTerminal(status: JobStatus): boolean {
  return status === 'delivered' || status === 'cancelled';
}

/** `navigating_to_pickup` -> `Navigating to pickup` */
export function humanizeStatus(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

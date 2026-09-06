/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The rider app's domain types now live in `@freshfold/core`, shared with the
 * dispatch server and the customer website. An `Order` here and a `Booking`
 * there are two projections of the same server-side record.
 *
 * This file stays as a re-export so existing `from '../types'` imports keep
 * working; new code can import from `@freshfold/core` directly.
 */

export type {
  Coords,
  JobStatus,
  LaundryBag,
  Message,
  MessageSender,
  Notification,
  Order,
  OrderPriority,
  OrderStatus,
  RiderState,
} from '@freshfold/core';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LAUNDRY_HUB } from '@freshfold/core';
import { Message, Notification, Order, RiderState } from '../types';

/**
 * What the console holds before it has heard from anyone.
 *
 * There is no invented data here. The dispatch server is the only source of
 * jobs, messages and alerts, so a rider who has never connected sees an empty
 * board and an honest offline indicator rather than a demo that looks like
 * work waiting to be done.
 *
 * The rider record is a shell rather than an empty object because the app
 * reads its fields before the first poll: it is the shape, with no claims
 * attached. Identity is blank until the courier fills the profile in, and the
 * running totals stay at zero until the server reports real ones.
 */

/** The hub, from the one geography every surface shares. */
export const LAUNDRY_HUB_COORDS = { lat: LAUNDRY_HUB.lat, lng: LAUNDRY_HUB.lng };

export const INITIAL_RIDER: RiderState = {
  // A placeholder until the courier signs in and the server says who they are.
  id: '',
  name: '',
  employeeId: '',
  phone: '',
  avatar: '',
  vehicle: '',
  vehiclePlate: '',
  rating: 0,
  isOnline: false,
  gpsAccuracy: 0,
  speed: 0,
  heading: 0,
  // Starts at the hub. The device's own fix replaces this as soon as the
  // courier goes online and location is granted.
  coords: { ...LAUNDRY_HUB_COORDS },
  // No date, so nothing has been ridden today: the first fix the phone is
  // willing to measure against stamps today's and counts up from zero. See
  // `distanceDate` on `RiderState`.
  todayDistance: 0,
  distanceDate: '',
  todayEarnings: 0,
  completedCount: 0,
  onTimeRate: 0,
  acceptanceRate: 0,
  completionRate: 0,
};

export const INITIAL_ORDERS: Order[] = [];
export const INITIAL_MESSAGES: Message[] = [];
export const INITIAL_NOTIFICATIONS: Notification[] = [];

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isTerminal, type Order, type OrderStatus } from '@freshfold/core';

/**
 * How a courier's board is divided up.
 *
 * These are the rules behind the job strip, and they are plain functions on
 * purpose: the store is a React module that drags in the whole of React Native,
 * and rules nobody can run in isolation are rules nobody checks. `AppStore`
 * calls them and holds the state; everything decided here is decidable from an
 * array of jobs and one courier id.
 *
 * The board a phone is sent is *its own jobs plus the open pool* — see the note
 * on `Order.riderId` — so "mine" and "going spare" are the two halves of it,
 * and `riderId` is the only honest way to tell them apart.
 */

/** The states in which the courier is riding somewhere for a job. */
export const NAVIGATING_STATUSES = new Set<OrderStatus>([
  'navigating_to_pickup',
  'navigating_to_laundry',
  'navigating_to_delivery',
]);

/**
 * Ranks at or below this mean the courier is committed to that job right now —
 * on the road for it, or standing at the door. Nothing else can be started.
 */
export const RANK_COMMITTED = 1;

/**
 * How soon a job needs the courier. Lower comes first.
 *
 * This is the order a human would work in: finish what you are standing in
 * front of, then what you are riding towards, then whatever is waiting on a
 * tap. Jobs the hub is holding rank last because there is nothing to do for
 * them — the desk moves those, and dispatch files an alert when one is ready.
 */
export function attentionRank(status: OrderStatus): number {
  switch (status) {
    case 'arrived_at_pickup':
    case 'arrived_at_laundry':
    case 'arrived_at_delivery':
      return 0;
    case 'navigating_to_pickup':
    case 'navigating_to_laundry':
    case 'navigating_to_delivery':
      return 1;
    case 'assigned':
    case 'pickup_scanned':
    case 'picked_up':
    case 'ready_for_delivery':
      return 2;
    default:
      return 3;
  }
}

/**
 * Every job this courier is holding, soonest-needed first.
 *
 * This used to be a single `find` for the first non-`unassigned` job on the
 * board — correct only while exactly one job is ever in flight, and a courier
 * who accepted a second one simply could not see it. A round trip parks a job
 * at the hub for as long as the washing takes, and a courier standing idle
 * through that is the capacity the app was throwing away.
 */
export function heldBy(orders: Order[], riderId: string): Order[] {
  if (!riderId) return [];

  return orders
    .filter((o) => !!o.riderId && o.riderId === riderId && !isTerminal(o.status))
    .sort(
      (a, b) =>
        attentionRank(a.status) - attentionRank(b.status) ||
        // Within a rank the elite contract goes first — that is what the
        // priority is for — and the id keeps the order stable across polls so
        // the strip does not reshuffle under the courier's thumb.
        Number(b.priority === 'elite') - Number(a.priority === 'elite') ||
        a.id.localeCompare(b.id)
    );
}

/**
 * The leg the courier is physically committed to, if any.
 *
 * At most one, because a courier can only be in one place. Kept apart from
 * whatever the workflow sheet is *showing*: the map, the GPS tick and the
 * arrival confirmation all follow the road, and a courier glancing at another
 * job's card while riding must not switch off arrival detection for the one
 * they are actually on.
 */
export function ridingLeg(held: Order[]): Order | undefined {
  return held.find((o) => NAVIGATING_STATUSES.has(o.status));
}

/**
 * Whether the courier can be offered anything else.
 *
 * Jobs parked at the hub do not block new work — that is the whole point of
 * holding more than one. Being on the road or standing at a door does: a second
 * job accepted mid-leg is one the courier cannot start, and the offer card
 * would be asking them to divide themselves in two.
 */
export function canAcceptMore(held: Order[]): boolean {
  return !held.some((o) => attentionRank(o.status) <= RANK_COMMITTED);
}

/**
 * What is going spare — anything still running that no courier holds.
 *
 * Not just `unassigned`: a supervisor moving a booking to a courier leg from
 * the dashboard leaves it in flight with nobody on it, and keying on that one
 * status hid those jobs from the whole roster. They stayed on the customer's
 * timeline reading *Collecting* with nobody collecting.
 */
export function goingSpare(orders: Order[]): Order[] {
  return orders.filter((o) => !o.riderId && !isTerminal(o.status));
}

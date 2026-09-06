/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for the workload rules in `./workload`.
 *
 * Run with `npm run check --workspace @freshfold/mobile`. Plain assertions and
 * a non-zero exit rather than a test framework, because the repo does not have
 * one and one file's worth of rules does not justify installing it. The rules
 * live in their own module precisely so this can import them without dragging
 * in React Native.
 */
import type { Order, OrderStatus } from '@freshfold/core';
import { canAcceptMore, goingSpare, heldBy, ridingLeg } from './workload';

const ME = 'FF-R-204';

function job(id: string, status: OrderStatus, riderId?: string, elite = false): Order {
  return {
    id,
    orderNumber: id,
    customerName: id,
    customerPhone: '',
    pickupAddress: '',
    pickupCoords: { lat: 0, lng: 0 },
    deliveryAddress: '',
    deliveryCoords: { lat: 0, lng: 0 },
    laundryType: '',
    bagCount: 1,
    bags: [],
    priority: elite ? 'elite' : 'standard',
    status,
    riderId,
    distance: 0,
    price: 0,
    deadline: '',
  };
}

/** Mirrors the store's fallback: the courier's pick, else what needs them most. */
const focusedOf = (held: Order[], focusedOrderId: string | null) =>
  held.find((o) => o.id === focusedOrderId) ?? held[0];

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${a}\n        want ${e}`}`
  );
}

// --- A courier holding three jobs at different points of the round trip -----
const board: Order[] = [
  job('A-parked', 'processing', ME),
  job('B-riding', 'navigating_to_delivery', ME),
  job('C-waiting', 'ready_for_delivery', ME),
  job('D-open', 'unassigned'),
  job('E-stranded', 'navigating_to_pickup'), // desk moved it, named no courier
  job('F-someone-else', 'picked_up', 'FF-R-999'),
  job('G-done', 'delivered', ME),
];

const held = heldBy(board, ME);

check('mine only, terminal excluded, soonest first', held.map((o) => o.id), [
  'B-riding',
  'C-waiting',
  'A-parked',
]);
check("another courier's job is not mine", held.some((o) => o.id === 'F-someone-else'), false);
check('riding job is the navigating one', ridingLeg(held)?.id, 'B-riding');
check('auto-focus picks what needs me soonest', focusedOf(held, null)?.id, 'B-riding');
check('mid-leg blocks new offers', canAcceptMore(held), false);
check('backlog holds open AND stranded', goingSpare(board).map((o) => o.id), [
  'D-open',
  'E-stranded',
]);

// --- Manual focus wins, but the road does not move --------------------------
check('manual focus wins', focusedOf(held, 'A-parked')?.id, 'A-parked');
check('navigation still follows the road', ridingLeg(held)?.id, 'B-riding');

// --- Focus on a job that has left the board falls back ----------------------
check('stale focus falls back to automatic', focusedOf(held, 'G-done')?.id, 'B-riding');

// --- Everything parked at the hub: the courier is free ----------------------
const parked = heldBy([job('A', 'processing', ME), job('H', 'dropped_off', ME)], ME);
check('hub-parked jobs do not block offers', canAcceptMore(parked), true);
check('no navigation target while parked', ridingLeg(parked), undefined);

// --- Standing at a door is committed too ------------------------------------
check(
  'arrived-at-door blocks offers',
  canAcceptMore(heldBy([job('I', 'arrived_at_delivery', ME)], ME)),
  false
);

// --- Elite jumps the queue within a rank ------------------------------------
check(
  'elite first within a rank',
  heldBy([job('J-std', 'ready_for_delivery', ME), job('K-elite', 'assigned', ME, true)], ME).map(
    (o) => o.id
  ),
  ['K-elite', 'J-std']
);

// --- A signed-out console holds nothing -------------------------------------
check('no rider id means no jobs', heldBy(board, ''), []);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

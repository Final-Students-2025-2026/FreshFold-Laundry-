/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The rules for running the laundry, as against the rules for selling it.
 *
 * `pricing` decides what a customer pays and `reschedule` decides when they may
 * move a booking. This module is the other side of the counter: how many jobs
 * one courier may hold, whether they are on shift, what states a claim can move
 * between, and what a hub operator has to say before a stage will advance.
 *
 * All of it lives here for the reason the reschedule policy does — the server
 * enforces these and the two consoles have to show the same answer, and a rule
 * enforced only on the server reads to the person using it as a screen that
 * lies.
 */

import type { Claim, ClaimStatus, RiderShift } from './types';

// ---------------------------------------------------------------------------
// How much work one courier may hold
// ---------------------------------------------------------------------------

/**
 * The most jobs a courier may have open at once.
 *
 * There was no limit at all. `POST /orders/:id/accept` checked that the job was
 * not already taken and not already closed, and nothing else — so one courier
 * tapping accept down the whole board took the whole board, and the jobs sat
 * with them while every other courier saw an empty pool. The customer at the
 * end of that queue is being told a courier is on the way.
 *
 * Six because a scooter carries about that many bags on one round and because
 * it is a number a supervisor can raise. `RIDER_JOB_LIMIT` in the server's
 * environment overrides it, the same way `PICKUP_SLOT_CAPACITY` overrides the
 * collection ceiling — the desk knows its own couriers better than this
 * constant does.
 *
 * It counts *open* jobs rather than jobs accepted today: a courier who has
 * delivered four is carrying nothing, and charging them for finished work would
 * make the cap a daily quota, which is a different and worse thing.
 */
export const DEFAULT_RIDER_JOB_LIMIT = 6;

/** Why a courier may not take this job. */
export type AcceptRefusal = 'at-capacity' | 'off-shift';

export interface LoadCheck {
  ok: boolean;
  reason?: AcceptRefusal;
  message?: string;
}

/**
 * Whether a courier holding `open` jobs may take one more.
 *
 * Split from the shift check below so the rider console can grey out the accept
 * button for the right reason — "you are carrying six" and "you are not on
 * shift" are different problems with different fixes, and one combined refusal
 * would tell a courier to go home when they are simply full.
 */
export function withinJobLimit(open: number, limit = DEFAULT_RIDER_JOB_LIMIT): LoadCheck {
  if (open < limit) return { ok: true };

  return {
    ok: false,
    reason: 'at-capacity',
    message:
      `You are already carrying ${open} jobs, which is the limit. ` +
      'Complete one before taking another.',
  };
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

/**
 * Whether this shift covers this instant.
 *
 * Half-open — the start counts, the end does not. A courier whose shift ends at
 * 20:00 is not on at 20:00, and a back-to-back rota where one block ends as the
 * next begins must not read as both or neither.
 */
export function shiftCovers(shift: RiderShift, at: Date = new Date()): boolean {
  const from = Date.parse(shift.startsAt);
  const to = Date.parse(shift.endsAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;

  const now = at.getTime();
  return now >= from && now < to;
}

/** Whether any of these blocks covers this instant. */
export function onShift(shifts: readonly RiderShift[], at: Date = new Date()): boolean {
  return shifts.some((shift) => shiftCovers(shift, at));
}

/**
 * Whether two blocks overlap, which is what stops a courier being rostered
 * twice for the same hour.
 *
 * Half-open at both ends, matching {@link shiftCovers}: a block ending at 20:00
 * and one starting at 20:00 are back-to-back rather than overlapping, which is
 * how a rota is actually written.
 */
export function shiftsOverlap(
  a: { startsAt: string; endsAt: string },
  b: { startsAt: string; endsAt: string }
): boolean {
  const aFrom = Date.parse(a.startsAt);
  const aTo = Date.parse(a.endsAt);
  const bFrom = Date.parse(b.startsAt);
  const bTo = Date.parse(b.endsAt);

  if ([aFrom, aTo, bFrom, bTo].some(Number.isNaN)) return false;
  return aFrom < bTo && bFrom < aTo;
}

/** The longest a single block may run, in hours. A rota entry, not a sentence. */
export const MAX_SHIFT_HOURS = 16;

/** Why a proposed shift was refused. */
export type ShiftRefusal = 'invalid-range' | 'too-long' | 'overlaps';

export interface ShiftCheck {
  ok: boolean;
  reason?: ShiftRefusal;
  message?: string;
}

/**
 * Whether this block can be rostered, given what the courier already has.
 *
 * `existing` is that courier's other blocks — the caller passes them because
 * this module has no database. An `id` on the proposal excludes the row being
 * edited, so moving a shift by ten minutes does not collide with itself.
 */
export function checkShift(
  proposal: { id?: string; startsAt: string; endsAt: string },
  existing: readonly RiderShift[]
): ShiftCheck {
  const from = Date.parse(proposal.startsAt);
  const to = Date.parse(proposal.endsAt);

  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
    return {
      ok: false,
      reason: 'invalid-range',
      message: 'A shift needs a start and an end, and has to end after it starts.',
    };
  }

  if (to - from > MAX_SHIFT_HOURS * 3_600_000) {
    return {
      ok: false,
      reason: 'too-long',
      message: `A single shift cannot run longer than ${MAX_SHIFT_HOURS} hours.`,
    };
  }

  const clash = existing.find(
    (shift) => shift.id !== proposal.id && shiftsOverlap(proposal, shift)
  );

  if (clash) {
    return {
      ok: false,
      reason: 'overlaps',
      message: 'That overlaps a shift this courier is already rostered for.',
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/**
 * The reasons the customer app offers, and the one it falls back to.
 *
 * The same five the `IssueReporter` chips already use, so a claim raised from a
 * chip carries the chip's own value rather than a second vocabulary that has to
 * be mapped onto it.
 */
export const CLAIM_KINDS = ['stain', 'missing', 'damaged', 'finish', 'late', 'other'] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];

/**
 * Where a claim may go from where it is.
 *
 * A table rather than a chain of ifs, because the interesting property is the
 * one a table makes visible: `resolved` is reachable only from `upheld`, so the
 * laundry cannot mark a customer whole without first having agreed that
 * something was owed. And every open state can be rejected, because a claim
 * that turns out to be a misunderstanding should not have to be upheld first.
 *
 * `rejected` and `resolved` are terminal. Reopening is deliberately not a
 * transition: a customer who disagrees with a rejection raises the matter again,
 * which is a new claim with its own clock — and the pair of records is a truer
 * account of what happened than one row edited twice.
 */
const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  open: ['investigating', 'upheld', 'rejected'],
  investigating: ['upheld', 'rejected'],
  upheld: ['resolved', 'rejected'],
  rejected: [],
  resolved: [],
};

/** Whether a claim in `from` may be moved to `to`. */
export function canMoveClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The states a claim in this one may be moved to. Drives the desk's buttons. */
export function claimNextStates(from: ClaimStatus): readonly ClaimStatus[] {
  return CLAIM_TRANSITIONS[from] ?? [];
}

/** Whether this claim is finished with. */
export function isClaimClosed(status: ClaimStatus): boolean {
  return status === 'rejected' || status === 'resolved';
}

/**
 * Whether the laundry still owes this customer something.
 *
 * True exactly while a claim is upheld and not yet resolved — which is the
 * whole reason those are two states. This is the number a supervisor wants on
 * the dashboard: not "how many complaints" but "how many people are owed
 * something we have agreed to give them and have not".
 */
export function isRemedyOwed(claim: Pick<Claim, 'status'>): boolean {
  return claim.status === 'upheld';
}

/** How a claim reads on screen, in the desk's and the customer's language. */
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: 'Open',
  investigating: 'Being looked into',
  upheld: 'Upheld — remedy owed',
  rejected: 'Not upheld',
  resolved: 'Settled',
};

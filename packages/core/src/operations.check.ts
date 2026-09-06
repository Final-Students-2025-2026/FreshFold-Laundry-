/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for running the laundry: courier load, shifts and claims.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * Separate from `money.check.ts` and `reschedule.check.ts` for the same reason
 * they are separate from each other — nothing here decides a price or a date.
 * What these rules have in common is that each one replaces a policy that did
 * not exist at all: there was no cap on a courier's board, no concept of a
 * shift, and no state a complaint could be in.
 */

import { check, checkTrue, report, section } from './check';
import { bagsForJob, bookingToJob, jobToBooking, jobToOrder } from './job';
import {
  CLAIM_KINDS,
  DEFAULT_RIDER_JOB_LIMIT,
  MAX_SHIFT_HOURS,
  canMoveClaim,
  checkShift,
  claimNextStates,
  isClaimClosed,
  isRemedyOwed,
  onShift,
  shiftCovers,
  shiftsOverlap,
  withinJobLimit,
} from './operations';
import type { Booking, ClaimStatus, RiderShift } from './types';

const shift = (startsAt: string, endsAt: string, id = 'shift-1'): RiderShift => ({
  id,
  riderId: 'FF-R-101',
  startsAt,
  endsAt,
  note: '',
  createdBy: 'desk@freshfold.test',
  createdAt: '2026-08-24T00:00:00.000Z',
});

/** Monday 24 August 2026, 19:00 UTC — inside an evening shift, outside a morning one. */
const EVENING = new Date('2026-08-24T19:00:00Z');

// ---------------------------------------------------------------------------
section('bags carry no measurements until somebody takes them');

// `weight` was `2 + (charCodeAt(i) % 40) / 10` and `itemCount` was
// `3 + ((charCodeAt(i + 2) + i) % 8)` — two hashes of the job id, printed on the
// customer's manifest as measurements of their own laundry.
const manifest = bagsForJob('FFC-482913', { serviceType: 'Washing (Machine & Hand Wash)' });

checkTrue('a fresh manifest has bags on it', manifest.length >= 1);
checkTrue('none of them claims a weight',
  manifest.every((bag) => bag.weight === undefined));
checkTrue('none of them claims a count',
  manifest.every((bag) => bag.itemCount === undefined));
checkTrue('none of them claims to have been counted',
  manifest.every((bag) => bag.countedAt === undefined && bag.countedBy === undefined));
checkTrue('they still carry the things that are true: an id, a code and a type',
  manifest.every((bag) => !!bag.id && !!bag.qrCode && !!bag.type));

// The old implementation was deterministic on the id, which is what made it look
// like data. Two orders differing by one digit produced different "weights".
const other = bagsForJob('FFC-482914', { serviceType: 'Washing (Machine & Hand Wash)' });
checkTrue('two different orders no longer disagree about weights neither has',
  manifest.every((bag) => bag.weight === undefined) &&
    other.every((bag) => bag.weight === undefined));

// ---------------------------------------------------------------------------
section('how much one courier may carry');

checkTrue('an empty board leaves room', withinJobLimit(0).ok);
checkTrue('one below the limit leaves room', withinJobLimit(DEFAULT_RIDER_JOB_LIMIT - 1).ok);
checkTrue('at the limit there is none', !withinJobLimit(DEFAULT_RIDER_JOB_LIMIT).ok);
check('and it says why', withinJobLimit(DEFAULT_RIDER_JOB_LIMIT).reason, 'at-capacity');

// Somehow over — a supervisor reassigning by hand, or a limit lowered under a
// courier who was already full. Still refused rather than wrapping around.
checkTrue('over the limit is still refused', !withinJobLimit(DEFAULT_RIDER_JOB_LIMIT + 4).ok);

// The desk can raise it without a deploy, which is the point of the parameter.
checkTrue('a raised limit lets more through', withinJobLimit(8, 12).ok);
checkTrue('a lowered one refuses sooner', !withinJobLimit(3, 3).ok);

// ---------------------------------------------------------------------------
section('shifts');

const evening = shift('2026-08-24T17:00:00Z', '2026-08-24T21:00:00Z');
const morning = shift('2026-08-24T06:00:00Z', '2026-08-24T11:00:00Z', 'shift-2');

checkTrue('an evening shift covers the evening', shiftCovers(evening, EVENING));
checkTrue('a morning shift does not', !shiftCovers(morning, EVENING));
checkTrue('any of them covering is enough', onShift([morning, evening], EVENING));
checkTrue('none of them covering is not', !onShift([morning], EVENING));
checkTrue('an empty rota covers nothing', !onShift([], EVENING));

// Half-open: the start counts and the end does not, so back-to-back blocks read
// as one continuous stretch rather than as both-or-neither at the boundary.
checkTrue('the first instant of a shift is on it',
  shiftCovers(evening, new Date('2026-08-24T17:00:00Z')));
checkTrue('the last instant is not',
  !shiftCovers(evening, new Date('2026-08-24T21:00:00Z')));

// A shift that crosses midnight is an ordinary evening round, which is why these
// are instants rather than a calendar day plus two clock times.
const overnight = shift('2026-08-24T18:00:00Z', '2026-08-25T02:00:00Z');
checkTrue('an overnight shift covers the small hours',
  shiftCovers(overnight, new Date('2026-08-25T01:00:00Z')));

checkTrue('a garbled timestamp covers nothing rather than everything',
  !shiftCovers(shift('not-a-time', 'nor-this'), EVENING));

// --- overlaps ---
checkTrue('two blocks sharing an hour overlap',
  shiftsOverlap(
    { startsAt: '2026-08-24T17:00:00Z', endsAt: '2026-08-24T21:00:00Z' },
    { startsAt: '2026-08-24T20:00:00Z', endsAt: '2026-08-24T23:00:00Z' }
  ));
checkTrue('back-to-back blocks do not',
  !shiftsOverlap(
    { startsAt: '2026-08-24T17:00:00Z', endsAt: '2026-08-24T21:00:00Z' },
    { startsAt: '2026-08-24T21:00:00Z', endsAt: '2026-08-24T23:00:00Z' }
  ));
checkTrue('one block inside another overlaps',
  shiftsOverlap(
    { startsAt: '2026-08-24T17:00:00Z', endsAt: '2026-08-24T23:00:00Z' },
    { startsAt: '2026-08-24T19:00:00Z', endsAt: '2026-08-24T20:00:00Z' }
  ));

// --- rostering ---
const propose = (startsAt: string, endsAt: string, id?: string) =>
  checkShift({ id, startsAt, endsAt }, [evening]);

checkTrue('a clear evening is rosterable',
  propose('2026-08-25T17:00:00Z', '2026-08-25T21:00:00Z').ok);
check('one that collides is refused',
  propose('2026-08-24T20:00:00Z', '2026-08-24T23:00:00Z').reason, 'overlaps');
check('an end before its start is refused',
  propose('2026-08-25T21:00:00Z', '2026-08-25T17:00:00Z').reason, 'invalid-range');
check('a zero-length shift is refused',
  propose('2026-08-25T17:00:00Z', '2026-08-25T17:00:00Z').reason, 'invalid-range');
check('a garbled one is refused rather than accepted',
  propose('whenever', 'later').reason, 'invalid-range');
check('one longer than a working day is refused',
  propose('2026-08-26T00:00:00Z', '2026-08-26T23:00:00Z').reason, 'too-long');
checkTrue('...at exactly the limit it is not',
  propose('2026-08-26T00:00:00Z', `2026-08-26T${String(MAX_SHIFT_HOURS).padStart(2, '0')}:00:00Z`).ok);

// Editing a block must not collide with itself, or nothing could ever be moved
// by ten minutes.
checkTrue('a shift edited in place does not clash with itself',
  propose('2026-08-24T17:30:00Z', '2026-08-24T21:00:00Z', 'shift-1').ok);

// ---------------------------------------------------------------------------
section('claims');

checkTrue('every reason the app offers is a kind the server accepts',
  ['stain', 'missing', 'damaged', 'finish', 'late'].every((kind) =>
    CLAIM_KINDS.includes(kind as never)));
checkTrue('and there is a fallback for the ones that are not on a chip',
  CLAIM_KINDS.includes('other'));

// The transition that is the whole reason `upheld` and `resolved` are separate:
// the laundry cannot record a customer as made whole without first having agreed
// that something was owed.
checkTrue('a fresh claim cannot jump straight to settled', !canMoveClaim('open', 'resolved'));
checkTrue('nor can one being looked into', !canMoveClaim('investigating', 'resolved'));
checkTrue('an upheld one can be settled', canMoveClaim('upheld', 'resolved'));

checkTrue('an open claim can be picked up', canMoveClaim('open', 'investigating'));
checkTrue('an open claim can be upheld outright', canMoveClaim('open', 'upheld'));
checkTrue('any live claim can be rejected', canMoveClaim('investigating', 'rejected'));
checkTrue('...including one already upheld, if it turns out otherwise',
  canMoveClaim('upheld', 'rejected'));

// Terminal means terminal. A customer who disagrees raises the matter again,
// which is a new claim with its own clock.
check('a rejected claim goes nowhere', claimNextStates('rejected').length, 0);
check('a settled claim goes nowhere', claimNextStates('resolved').length, 0);
checkTrue('a settled one cannot be reopened', !canMoveClaim('resolved', 'open'));

checkTrue('rejected is closed', isClaimClosed('rejected'));
checkTrue('resolved is closed', isClaimClosed('resolved'));
checkTrue('upheld is not — that is the point of it', !isClaimClosed('upheld'));

// "How many people are owed something we agreed to give them and have not."
checkTrue('an upheld claim owes a remedy', isRemedyOwed({ status: 'upheld' }));
checkTrue('a settled one does not', !isRemedyOwed({ status: 'resolved' }));
checkTrue('a rejected one does not', !isRemedyOwed({ status: 'rejected' }));
checkTrue('an unexamined one does not yet', !isRemedyOwed({ status: 'open' }));

// Nothing may move to a state that is not on the table, however it is spelled.
checkTrue('an invented state is not reachable',
  !canMoveClaim('open', 'escalated' as ClaimStatus));

section('the hub’s drop-off code belongs to the desk');

/**
 * The middle hand-off is the one where the party holding the code is not the
 * party being served, and that is the whole of its value: the hub asserts it
 * received the bags, so a courier cannot check a load in from the roadside.
 *
 * The projection used to attach the code to every reader of a booking. Nothing
 * rendered it for a customer, which is not the same as not sending it — the
 * response body carried the four digits their own courier is challenged for,
 * and handing them over is a conversation, not an attack.
 */
const collected = bookingToJob({
  id: 'FFC-000009',
  name: 'A Customer',
  email: 'customer@example.com',
  phone: '0201234567',
  serviceType: 'Washing (Machine & Hand Wash)',
  pickupDate: '2026-08-26',
  pickupTime: '9:00 AM - 12:00 PM',
  address: '12 Ayeduase Road',
  suburb: 'Ayeduase',
  status: 'Scheduled',
  createdAt: '2026-08-24T09:00:00.000Z',
} as Booking);

checkTrue('the job is minted with one', !!collected.dispatch.dropoffOtp);

// The default is the one that matters: a call site that has not thought about
// who is reading must not be the one that decides to publish it.
check('a view built without a reader withholds it',
  jobToBooking(collected).dropoffOtp, undefined);
check('...and so does one built for a reader who is not the desk',
  jobToBooking(collected, undefined, { hubCode: false }).dropoffOtp, undefined);
check('the desk sees it',
  jobToBooking(collected, undefined, { hubCode: true }).dropoffOtp,
  collected.dispatch.dropoffOtp);

// The courier's own projection has no field to fill in, flag or no flag, so the
// phone cannot answer the challenge it is being set.
checkTrue('the courier’s projection has no such field at all',
  !('dropoffOtp' in jobToOrder(collected)));

// The collection code is the customer's and is unaffected — they are the party
// that hand-off is against.
checkTrue('the customer keeps their own collection code',
  !!jobToBooking(collected).pickupOtp);

report();

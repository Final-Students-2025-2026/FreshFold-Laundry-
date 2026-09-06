/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Memberships — prices, renewal, and what a plan is actually worth.
 *
 * This lives in core rather than in the customer app because both sides need
 * the same answers and only one of them can be trusted. The app quotes a
 * membership so the customer sees what they will pay; the server re-derives the
 * same numbers before it moves any money or grants any priority. A plan the
 * client claims to hold is a claim, not a fact.
 *
 * Three things were previously nowhere:
 *
 *  - **A price.** The plan cards carried `'₵79'` for display and a parallel
 *    `PLAN_PRICES` map for arithmetic, which is two sources of truth for one
 *    number. Here the price is a number and the string is derived.
 *  - **An end.** A subscription was written once with a `renewsOn` that nothing
 *    ever read, so one payment bought priority forever. {@link settleMembership}
 *    is the missing clock.
 *  - **A benefit.** The plan bullets promised included pickups that no code
 *    counted. {@link membershipBookingQuote} is what makes them real.
 */

export type MembershipPlanId = 'student' | 'professional' | 'family' | 'corporate';

export interface MembershipPlan {
  id: MembershipPlanId;
  name: string;
  /** Monthly fee, in cedis. The only place this number is written down. */
  price: number;
  /**
   * Bookings per billing period whose laundry fee the membership already
   * covers. Matches the "N pickups / month" bullet on the plan card.
   */
  includedPickups: number;
  /**
   * Applied to bookings once the period's included pickups are spent, and to
   * bookings the allowance does not cover at all (see `coverable` on
   * {@link membershipBookingQuote}). A fraction, e.g. `0.15` for 15% off.
   */
  overageDiscount: number;
}

/**
 * The plans, in the order they are shown.
 *
 * `includedPickups` reads straight off the marketing copy the plans screen
 * already displays — 2 a month for students, weekly for professionals, twice
 * weekly for families. Corporate's "daily pickup options" is capped at 30
 * rather than left unbounded: an uncapped allowance is not a plan, it is an
 * unpriced liability, and 30 is every day of a billing period.
 */
export const MEMBERSHIP_PLANS: MembershipPlan[] = [
  { id: 'student', name: 'Student Club Plan', price: 79, includedPickups: 2, overageDiscount: 0.1 },
  {
    id: 'professional',
    name: 'Professional Concierge',
    price: 149,
    includedPickups: 4,
    overageDiscount: 0.15,
  },
  {
    id: 'family',
    name: 'Infinite Family Plan',
    price: 289,
    includedPickups: 8,
    overageDiscount: 0.2,
  },
  {
    id: 'corporate',
    name: 'Corporate Executive',
    price: 499,
    includedPickups: 30,
    overageDiscount: 0.25,
  },
];

export function membershipPlan(id: string | undefined | null): MembershipPlan | null {
  if (!id) return null;
  return MEMBERSHIP_PLANS.find((plan) => plan.id === id) ?? null;
}

/** True for an id that names a plan that exists. Guards untrusted input. */
export function isMembershipPlanId(id: unknown): id is MembershipPlanId {
  return typeof id === 'string' && MEMBERSHIP_PLANS.some((plan) => plan.id === id);
}

/**
 * A live subscription.
 *
 * Held on the account, server-side, because it is a paid entitlement: the
 * device-local copy this replaced could be recreated by anyone willing to edit
 * their own storage, and was lost by everyone who reinstalled.
 */
export interface ActivePlan {
  planId: MembershipPlanId;
  /** When the customer first subscribed — unchanged across renewals. */
  startedAt: string;
  /** Start of the period now running. Moves on every renewal. */
  periodStart: string;
  /** When the current period ends: renewal date, or expiry if cancelled. */
  renewsOn: string;
  /** Fee locked at subscribe time, so a price change never surprises anyone. */
  price: number;
  /** Included pickups spent in the period now running. Resets on renewal. */
  pickupsUsed: number;
  /** Set by a cancellation: the plan runs to `renewsOn`, then stops. */
  cancelAtPeriodEnd?: boolean;
}

/** Cedis, rounded the way money is. */
export function roundCedis(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * One month on, clamped to the end of the target month.
 *
 * `setMonth(+1)` on 31 January lands on 2 or 3 March, which quietly gives the
 * customer a longer first period and moves every subsequent renewal. The 31st
 * of a month becomes the 28th, 29th or 30th, and stays there.
 */
export function addMonthClamped(from: Date): Date {
  const day = from.getDate();
  const next = new Date(from.getTime());

  next.setDate(1);
  next.setMonth(next.getMonth() + 1);

  const lastDayOfTarget = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDayOfTarget));

  return next;
}

/** A fresh subscription starting now. */
export function startMembership(plan: MembershipPlan, now: Date = new Date()): ActivePlan {
  return {
    planId: plan.id,
    startedAt: now.toISOString(),
    periodStart: now.toISOString(),
    renewsOn: addMonthClamped(now).toISOString(),
    price: plan.price,
    pickupsUsed: 0,
  };
}

export interface MembershipCharge {
  planId: MembershipPlanId;
  amount: number;
  /** The period this charge paid for. */
  periodStart: string;
  renewsOn: string;
}

export interface MembershipSettlement {
  /** The plan as it stands now — null if it lapsed. */
  plan: ActivePlan | null;
  /** The wallet balance after any renewals were taken. */
  balance: number;
  /** Renewals taken, in order. One per period elapsed. */
  charges: MembershipCharge[];
  /** Why the plan ended, when it did. */
  lapsed: 'cancelled' | 'insufficient-funds' | 'withdrawn' | null;
}

/**
 * Brings a subscription up to date as of `now`.
 *
 * There is no scheduler in this system, so renewal is evaluated lazily: every
 * read of an account settles it first, and a plan that should have renewed
 * three months ago renews three times or lapses at the first period it could
 * not pay for. That is the same outcome a nightly job would have produced, and
 * it needs no job.
 *
 * Callers must persist `plan`, `balance` and `charges` together — a renewal
 * taken from the wallet without its ledger entry is money the customer cannot
 * account for.
 */
export function settleMembership(
  plan: ActivePlan | null | undefined,
  balance: number,
  now: Date = new Date()
): MembershipSettlement {
  if (!plan) return { plan: null, balance, charges: [], lapsed: null };

  const definition = membershipPlan(plan.planId);
  if (!definition) {
    // A plan that no longer exists cannot be charged for. It ends rather than
    // renewing at a price nobody can look up.
    return { plan: null, balance, charges: [], lapsed: 'withdrawn' };
  }

  // Deliberately the caller's object, not a copy, until something actually
  // changes: `plan === settlement.plan` is how a caller cheaply tells "nothing
  // was due" from "this renewed", and every read of an account settles it. A
  // copy here would mean a database write on every poll from every device.
  let current: ActivePlan = plan;
  let remaining = balance;
  const charges: MembershipCharge[] = [];

  // Bounded so a corrupt far-past date cannot spin here. Twenty-four periods is
  // two years, which is well past any gap a real account will have.
  for (let guard = 0; guard < 24; guard += 1) {
    if (now.getTime() < new Date(current.renewsOn).getTime()) {
      return { plan: current, balance: remaining, charges, lapsed: null };
    }

    if (current.cancelAtPeriodEnd) {
      return { plan: null, balance: remaining, charges, lapsed: 'cancelled' };
    }

    const fee = definition.price;
    if (remaining < fee) {
      // Nothing to take, so the plan stops rather than accruing a debt. The
      // customer keeps everything they already paid for.
      return { plan: null, balance: remaining, charges, lapsed: 'insufficient-funds' };
    }

    const periodStart = new Date(current.renewsOn);
    const renewsOn = addMonthClamped(periodStart);

    remaining = roundCedis(remaining - fee);
    charges.push({
      planId: current.planId,
      amount: fee,
      periodStart: periodStart.toISOString(),
      renewsOn: renewsOn.toISOString(),
    });

    current = {
      ...current,
      price: fee,
      periodStart: periodStart.toISOString(),
      renewsOn: renewsOn.toISOString(),
      // A new period is a new allowance.
      pickupsUsed: 0,
    };
  }

  return { plan: current, balance: remaining, charges, lapsed: null };
}

export interface MembershipSwitchQuote {
  /** Unused value of the period being replaced, credited against the new fee. */
  credit: number;
  /** What the wallet is actually charged now. */
  due: number;
  /** Full monthly fee of the plan being started. */
  fee: number;
}

/**
 * What starting `next` costs somebody who already holds `current`.
 *
 * Switching used to charge a full month and overwrite the period, forfeiting
 * whatever the customer had already paid for — while the plans screen promised
 * they keep the month they paid for. The unused fraction of the running period
 * is credited instead, so the promise and the arithmetic agree.
 *
 * The credit is applied to today's charge and is not refunded beyond it: a
 * downgrade from a plan worth more than the new one costs ₵0 today rather than
 * paying the difference back. That is a deliberate limit and the plans screen
 * says so before the customer commits, because the alternative — issuing wallet
 * credit — turns a plan switch into a refund path nobody has asked for.
 */
export function membershipSwitchQuote(
  current: ActivePlan | null | undefined,
  next: MembershipPlan,
  now: Date = new Date()
): MembershipSwitchQuote {
  const fee = next.price;
  if (!current || current.planId === next.id) return { credit: 0, due: fee, fee };

  const periodStart = new Date(current.periodStart).getTime();
  const renewsOn = new Date(current.renewsOn).getTime();
  const span = renewsOn - periodStart;

  if (!Number.isFinite(span) || span <= 0) return { credit: 0, due: fee, fee };

  const unused = Math.min(Math.max(renewsOn - now.getTime(), 0), span) / span;
  const credit = Math.min(roundCedis(current.price * unused), current.price);

  return { credit, due: Math.max(0, roundCedis(fee - credit)), fee };
}

export interface MembershipBookingQuote {
  /** Whether this booking spends one of the period's included pickups. */
  covered: boolean;
  /** Laundry fee the membership absorbs. Zero unless `covered`. */
  waived: number;
  /** Member discount on what is left to pay. */
  discount: number;
  /** Included pickups still unspent, before this booking. */
  remainingPickups: number;
}

/**
 * What a member pays for one booking.
 *
 * The rule, in one sentence: while the period's included pickups last, the
 * laundry itself is already paid for and only the extras are billed; after
 * that, the member gets their plan's discount off the whole quote.
 *
 * `laundry` is the base service fee plus its finishes — the part the monthly
 * fee is for. Add-ons are deliberately outside it: a plan buys laundry, not
 * garment shielding, and billing them keeps "one monthly price" honest without
 * making the extras free.
 *
 * `coverable` is false for work no laundry plan credibly includes — car
 * detailing, office and upholstery cleaning. Those get the discount instead of
 * the allowance, so a Family member cannot spend eight included pickups on
 * ₵180 office cleans.
 */
export function membershipBookingQuote(input: {
  plan: ActivePlan | null | undefined;
  /** Full quote, add-ons included. */
  gross: number;
  /** The laundry portion: base service plus scent and starch, for every unit. */
  laundry: number;
  /**
   * One unit's laundry — what a single included pickup is worth.
   *
   * Defaults to the whole `laundry` when omitted, which is what it meant before
   * bookings could carry a quantity: one booking, one unit. Callers that know
   * the quantity pass it, and `quoteBooking` always does.
   */
  unitLaundry?: number;
  coverable: boolean;
}): MembershipBookingQuote {
  const { plan, gross, laundry, coverable } = input;
  const unitLaundry = input.unitLaundry ?? laundry;
  const none: MembershipBookingQuote = {
    covered: false,
    waived: 0,
    discount: 0,
    remainingPickups: 0,
  };

  const definition = membershipPlan(plan?.planId);
  if (!plan || !definition) return none;

  const remainingPickups = Math.max(0, definition.includedPickups - (plan.pickupsUsed ?? 0));

  if (coverable && remainingPickups > 0) {
    /**
     * One pickup, one unit.
     *
     * Four loads on an included pickup waives the first load and charges the
     * other three at the member rate — the allowance is worth a fixed, knowable
     * amount rather than however much the customer put in the bag. Letting one
     * pickup absorb an unbounded quantity would reopen exactly the hole
     * `isPlanCoverable` closes on the specialist services: a ₵79 Student plan
     * with two pickups could waive twenty loads of washing.
     *
     * Capped at `gross` as well, so a booking whose add-ons were removed cannot
     * waive more than the booking is worth.
     */
    const waived = Math.min(roundCedis(unitLaundry), roundCedis(laundry), roundCedis(gross));
    return {
      covered: true,
      waived,
      // Everything the allowance did not absorb — the other units and the
      // extras alike — is billed at the member rate.
      discount: roundCedis(Math.max(0, gross - waived) * definition.overageDiscount),
      remainingPickups,
    };
  }

  return {
    covered: false,
    waived: 0,
    discount: roundCedis(gross * definition.overageDiscount),
    remainingPickups,
  };
}

/** Spends one included pickup. Returns the plan unchanged when none are left. */
export function consumePickup(plan: ActivePlan): ActivePlan {
  const definition = membershipPlan(plan.planId);
  if (!definition) return plan;

  const used = plan.pickupsUsed ?? 0;
  if (used >= definition.includedPickups) return plan;

  return { ...plan, pickupsUsed: used + 1 };
}

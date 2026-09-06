/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a booking costs, all in.
 *
 * `./finish` owns the finish itself — which scents exist, what the surcharge is,
 * which services take one, and how the choice is flattened into
 * `specialInstructions` and read back. This module owns the arithmetic on top:
 * the add-ons, the three reductions a customer can be owed, and the one number at
 * the end.
 *
 * That number had no home. The website's `BookingModal` carried a cascade of
 * `if (service.includes(…))` branches; the customer app's catalogue carried
 * `priceBreakdown`, whose own comment said it "reproduces the website's
 * arithmetic exactly". The server carried none at all and read `amount` off the
 * request body — so the price of a wash was whatever the client claimed, and a
 * booking could arrive at ₵0.
 *
 * The two copies had already drifted, in the way two copies always do; see the
 * note on `isFragranceFree` in `./finish` for the ₵5 the website charged for
 * choosing *unscented*. This is the third time the codebase has had to
 * consolidate a table like this — `./loyalty` for the tier thresholds and
 * `./membership` for the plan prices were the first two — and the only one of the
 * three that decides what somebody is charged.
 */

import { tierForPoints } from './loyalty';
import { membershipBookingQuote, roundCedis, type ActivePlan } from './membership';
import { bookingItems, serviceByName, totalUnits } from './services';
import { DEFAULT_TAX_RATES, taxOn, type TaxBreakdown, type TaxRates } from './tax';
import type { BookingItem } from './types';

/**
 * How many collections one window can take.
 *
 * A window is a courier's morning, and there are only so many couriers. Until
 * this existed the slots were a display list and nothing more — they had no
 * references in the server at all, so every customer could book the same
 * 08:00–11:00 and the eleventh was accepted exactly like the first. A window
 * that cannot be served is worse than one that is closed: the customer is told
 * a courier is coming.
 *
 * Twelve is a starting number rather than a measured one, and it is deliberately
 * one number rather than a table — the desk can raise it when it knows better,
 * and `PICKUP_SLOT_CAPACITY` in the server's environment overrides it without a
 * deploy. Per-slot and per-day capacities are the next thing to want; a single
 * ceiling is the thing that stops the overbooking today.
 */
export const DEFAULT_SLOT_CAPACITY = 12;

/**
 * The return leg's ceiling, separately settable.
 *
 * Its own number rather than a share of the collection one because the two are
 * different work: a collection is a doorstep and a drive to the hub, a delivery
 * is a drive out with bags already sorted. They happen to be the same today.
 * `DELIVERY_SLOT_CAPACITY` in the server's environment overrides it.
 */
export const DEFAULT_DELIVERY_SLOT_CAPACITY = 12;

/**
 * A collection or delivery window, as a thing with a clock on it.
 *
 * The slots used to be three display strings and nothing else, which was enough
 * while nothing needed to *reason* about them. Rescheduling does: "you cannot
 * move an order into a window that starts in ten minutes" is a comparison
 * against a time, and deriving one by parsing `'08:00 AM - 11:00 AM (Morning
 * Concierge)'` back into hours would make the label — a piece of marketing copy
 * — load-bearing. So the hours are declared beside it.
 *
 * `startHour` and `endHour` are hours on a 24-hour clock, fractional for the
 * half hours, in Ghana's time — which is UTC, so no conversion is involved
 * anywhere. `label` remains the value stored on the booking: changing one would
 * orphan every record that holds the old string, so the labels are effectively
 * frozen and the hours beside them are what may be tuned.
 */
export interface TimeSlot {
  /** The exact string stored on the booking and submitted by both forms. */
  label: string;
  /** When the courier's window opens, as an hour on a 24-hour clock. */
  startHour: number;
  /** When it closes. */
  endHour: number;
}

export const PICKUP_SLOTS: readonly TimeSlot[] = [
  { label: '08:00 AM - 11:00 AM (Morning Concierge)', startHour: 8, endHour: 11 },
  { label: '12:00 PM - 03:00 PM (Afternoon Transit)', startHour: 12, endHour: 15 },
  { label: '05:30 PM - 08:30 PM (Sunset Concierge)', startHour: 17.5, endHour: 20.5 },
] as const;

/**
 * The return windows.
 *
 * Deliberately the same three hours as collection: it is one fleet, and a
 * courier out on a morning round is doing both legs. The labels differ so that
 * a customer reading their order sees which leg each line is about, and so that
 * a stored value is unambiguous about which list it came from.
 *
 * Before this existed the return was `pickupDate + 1` with no time on it at
 * all, so "when will it be back?" had no answer beyond a date — the customer
 * chose the hour their clothes left and had no say at all in the hour they came
 * back.
 */
export const DELIVERY_SLOTS: readonly TimeSlot[] = [
  { label: '08:00 AM - 11:00 AM (Morning Return)', startHour: 8, endHour: 11 },
  { label: '12:00 PM - 03:00 PM (Afternoon Return)', startHour: 12, endHour: 15 },
  { label: '05:30 PM - 08:30 PM (Sunset Return)', startHour: 17.5, endHour: 20.5 },
] as const;

/**
 * The labels alone, which is what the pickers render and the record stores.
 *
 * Derived rather than declared a second time. Both booking forms, the
 * availability route and the booking route all read this, and a hand-kept copy
 * beside {@link PICKUP_SLOTS} is a copy that can drift — which is the exact
 * failure that made the slots unenforceable in the first place.
 */
export const PICKUP_TIME_SLOTS: readonly string[] = PICKUP_SLOTS.map((slot) => slot.label);

export const DELIVERY_TIME_SLOTS: readonly string[] = DELIVERY_SLOTS.map((slot) => slot.label);

/** The window this stored string names, or null if it names none of them. */
export function findSlot(slots: readonly TimeSlot[], label: string): TimeSlot | null {
  return slots.find((slot) => slot.label === label) ?? null;
}

// ---------------------------------------------------------------------------
// The finish: what a customer can choose, and what it adds
// ---------------------------------------------------------------------------

export interface FinishOption {
  /** The value stored on the booking. Both surfaces submit this string. */
  id: string;
  label: string;
  surcharge: number;
}

/**
 * The scents offered, in the order they are shown.
 *
 * `surcharge` is read off the record rather than inferred from the name. Both
 * implementations this replaces worked the ₵5 out by testing the *string* — the
 * app with `startsWith('Fragrance-Free')`, the website with
 * `!== 'Fragrance-Free'` — and since every option's stored value is the
 * parenthesised long form, the website's test was true of all three. It charged
 * ₵5 for choosing unscented, and ₵5 for everything else, from a comparison that
 * could never match its own option value.
 *
 * A number on the option it belongs to cannot be got wrong by a string compare.
 */
export const SCENTS: FinishOption[] = [
  { id: 'Organic Lavender', label: 'Organic Lavender', surcharge: 5 },
  { id: 'Bespoke Eucalyptus & Tea-Tree', label: 'Eucalyptus & Tea-Tree', surcharge: 5 },
  { id: 'Fragrance-Free (Pure Hypoallergenic Soap)', label: 'Fragrance-Free', surcharge: 0 },
];

export const STARCH_LEVELS: FinishOption[] = [
  { id: 'None', label: 'None', surcharge: 0 },
  { id: 'Light', label: 'Light', surcharge: 5 },
  { id: 'Medium', label: 'Medium', surcharge: 5 },
];

export const DEFAULT_SCENT = SCENTS[0].id;
export const DEFAULT_STARCH = STARCH_LEVELS[0].id;

/**
 * The unscented option, matched by prefix.
 *
 * Kept as a named rule because a scent read back out of `specialInstructions` by
 * `decodeFinish` is a bare string that may not be in {@link SCENTS} at all —
 * older bookings predate the list. Prefix rather than equality, which is the
 * distinction the website got wrong.
 */
export function isFragranceFree(scent: string): boolean {
  return scent.trim().startsWith('Fragrance-Free');
}

/**
 * Whether scent and starch mean anything for this service.
 *
 * A car and a sofa do not take a fabric finish, so the surcharges do not apply,
 * the pickers are hidden, and `encodeFinish` leaves the sentence off the
 * courier's card. Also what decides whether a membership's included pickups can
 * cover the work — see {@link isPlanCoverable}.
 */
export function isGarmentService(serviceType: string): boolean {
  const listed = serviceByName(serviceType ?? '');
  if (listed) return listed.garment;

  // Legacy names only — see the note on LEGACY_BASE_PRICES. This was the whole
  // test, and being a blacklist it answered "garment" for anything it had not
  // heard of. `Fast Pickup & Delivery` is the one that got away: a courier run
  // advertised as complimentary, quoted at ₵5, because a scent surcharge
  // applied to it.
  const name = serviceType ?? '';
  return (
    !name.includes('Car Detailing') &&
    !name.includes('Home & Office') &&
    !name.includes('Sofa & Carpet')
  );
}

// ---------------------------------------------------------------------------
// The service itself
// ---------------------------------------------------------------------------

/**
 * Legacy base prices, matched on a substring of the name.
 *
 * This was the whole of the pricing table, and it was a second opinion: the
 * catalogue card said what a service cost and this said what it charged, and on
 * six of eleven services they disagreed. The catalogue in `./services` is now
 * the price, and this is only consulted for a `serviceType` that no longer
 * names a service in it.
 *
 * That case is real and has to keep working. `Booking.serviceType` stores the
 * free-text label the customer picked, not an id, so every booking already in
 * the ledger carries whatever the catalogue said the day it was made. Renaming
 * a service must not silently reprice the orders taken under the old name.
 *
 * First match wins, so the specific entries come before the general ones:
 * `Detailing` has to be tested before `Premium` or a "Premium Detailing" would be
 * priced as laundry.
 */
const LEGACY_BASE_PRICES: { match: string[]; price: number }[] = [
  { match: ['Car Detailing', 'Detailing'], price: 150 },
  { match: ['Home & Office', 'Office Cleaning'], price: 180 },
  { match: ['Sofa & Carpet', 'Carpet Cleaning'], price: 90 },
  { match: ['Fast Pickup', 'Pickup & Delivery'], price: 0 },
  { match: ['Washing'], price: 30 },
  { match: ['Bed Sheets', 'Linen'], price: 45 },
  { match: ['Executive', 'Pro', 'Premium'], price: 55 },
  { match: ['Express', 'Same-Day'], price: 50 },
];

/** What an unrecognised service falls back to. */
export const DEFAULT_BASE_PRICE = 25;

export function serviceBasePrice(serviceType: string): number {
  const listed = serviceByName(serviceType ?? '');
  if (listed) return listed.price;

  const name = serviceType ?? '';
  const found = LEGACY_BASE_PRICES.find((entry) =>
    entry.match.some((needle) => name.includes(needle))
  );
  return found ? found.price : DEFAULT_BASE_PRICE;
}

// ---------------------------------------------------------------------------
// Specialty add-ons
// ---------------------------------------------------------------------------

export interface SpecialtyAddon {
  id: string;
  label: string;
  description: string;
  price: number;
  iconName: string;
}

/**
 * The extras, priced individually.
 *
 * Deliberately outside the finish: a membership's included pickup covers the
 * laundry and its scent, and does not cover garment shielding. Keeping them
 * separable is what lets {@link quoteBooking} waive one and bill the other.
 */
export const SPECIALTY_ADDONS: SpecialtyAddon[] = [
  {
    id: 'Fabric Softening',
    label: 'Fabric softening',
    description: 'Plant-derived conditioner for a softer hand-feel.',
    price: 6,
    iconName: 'Feather',
  },
  {
    id: 'Laser Line Creasing',
    label: 'Laser-line creasing',
    description: 'Razor-sharp trouser and sleeve lines.',
    price: 8,
    iconName: 'Ruler',
  },
  {
    id: 'Garment Shielding',
    label: 'Garment shielding',
    description: 'Individual breathable covers on the hanger return.',
    price: 10,
    iconName: 'ShieldCheck',
  },
  {
    id: 'Delicate Hand Finish',
    label: 'Delicate hand finish',
    description: 'Silks and cashmere finished by hand, never machine-pressed.',
    price: 12,
    iconName: 'Hand',
  },
];

export function specialtyAddon(id: string): SpecialtyAddon | null {
  return SPECIALTY_ADDONS.find((addon) => addon.id === id) ?? null;
}

/**
 * Whether a membership's included pickups apply to this service.
 *
 * A laundry plan buys laundry. Car detailing, office cleaning and upholstery are
 * priced at ₵90–₵180 a visit and would otherwise let a Family member spend eight
 * included pickups on ₵1,440 of work for ₵289. Those get the member discount
 * instead. The same test as the finish, because it is the same question: is this
 * a garment?
 */
export function isPlanCoverable(serviceType: string): boolean {
  return isGarmentService(serviceType);
}

// ---------------------------------------------------------------------------
// The list price
// ---------------------------------------------------------------------------

/** What the customer chose. The only inputs to a price. */
export interface BookingSelections {
  serviceType: string;
  /** Absent means nothing was chosen, which costs nothing. */
  scent?: string;
  starch?: string;
  addonIds?: string[];
  /**
   * How many of the service's unit — four loads, two sofas, one car.
   *
   * Absent means one, which is what every booking made before this field
   * existed meant. Always 1 for a service priced per order; see
   * `clampQuantity`, which every caller runs it through.
   *
   * Describes `serviceType` only. An order with several services carries them
   * in `items` and this is the first line's count.
   */
  quantity?: number;
  /**
   * Every service on the order. Wins over `serviceType`/`quantity` when present.
   *
   * Read through `bookingItems`, never directly, so that a single-service
   * booking and a multi-line one are the same shape by the time anything prices
   * them.
   */
  items?: BookingItem[];
}

export interface PriceBreakdown {
  /** The service itself, for all of the units, before finishes. */
  base: number;
  /** Scent and starch surcharges, for all of the units. */
  finishes: number;
  /** Specialty add-ons, which a membership does not cover. Not multiplied. */
  addons: number;
  /** The laundry a membership's included pickups pay for: base + finishes. */
  laundry: number;
  /** Everything, before any discount. */
  gross: number;
  /**
   * The lines this was priced from, normalised and clamped.
   *
   * Handed back so a caller does not have to re-derive them to render a
   * summary — and so the booking that gets submitted carries exactly the lines
   * the quote was computed from.
   */
  items: BookingItem[];
  /** Total countable things across every line. */
  quantity: number;
  /**
   * The most valuable single unit on the order, among the lines a membership
   * can cover. Zero when no line is coverable.
   *
   * Carried separately because it is what a membership's included pickup
   * waives. A pickup is worth one unit, not one booking: four loads on one
   * included pickup waives one load and charges the other three at the member
   * rate. Without this the allowance would be worth whatever the customer
   * happened to put in the bag, which is the loophole `isPlanCoverable` already
   * exists to close on the specialist services.
   */
  unitLaundry: number;
}

/**
 * The surcharge for the chosen finish, tolerating one that was never chosen.
 *
 * Both fields are optional: they are new on `Booking`, so a booking replayed from
 * an older client's offline queue carries neither. Absent means nothing chosen and
 * nothing owed — the alternative is billing somebody ₵5 for a scent they were
 * never offered, since an empty string is not fragrance-free either.
 *
 * A value that is not on the menu — a scent read back out of an old booking's
 * `specialInstructions` — falls through the lookup to ₵0 rather than guessing.
 * Charging for something we cannot price is the worse failure of the two.
 */
function finishesFor(selections: BookingSelections): number {
  const { serviceType, scent, starch } = selections;
  if (!isGarmentService(serviceType)) return 0;

  const scentSurcharge = scent ? (SCENTS.find((o) => o.id === scent)?.surcharge ?? 0) : 0;
  const starchSurcharge = starch
    ? (STARCH_LEVELS.find((o) => o.id === starch)?.surcharge ?? 0)
    : 0;

  return scentSurcharge + starchSurcharge;
}

/**
 * The list price, itemised.
 *
 * Separable because a membership covers the laundry and not the extras, so the
 * quote has to say which part is which before anything can be waived.
 */
export function priceBreakdown(selections: BookingSelections): PriceBreakdown {
  // Through `bookingItems` so a single-service booking and a multi-line one
  // take the same path — the one-line case is not a special case, it is a list
  // of length one.
  const items = bookingItems(selections);

  /**
   * Each line priced on its own, then summed.
   *
   * Within a line the base and the finishes scale and the add-ons do not, which
   * is a statement about the work rather than about the arithmetic: a scent is
   * applied to each load and a starch pressed into each shirt, so three loads is
   * three times that work. Garment shielding or a laser crease is chosen once
   * for the order and billed once.
   *
   * `finishesFor` is asked per line, so a scent chosen for the order is charged
   * on the two loads of washing and not on the car detail sitting beside them.
   */
  let base = 0;
  let finishes = 0;
  let unitLaundry = 0;

  for (const item of items) {
    const unitBase = serviceBasePrice(item.serviceType);
    const unitFinishes = finishesFor({ ...selections, serviceType: item.serviceType });

    base += unitBase * item.quantity;
    finishes += unitFinishes * item.quantity;

    /**
     * The best single unit on the order, for the membership below.
     *
     * An included pickup is worth one unit, and with several services on one
     * booking somebody has to say which. The most valuable one, which is both
     * the convention anywhere else a customer is given "one free" and the only
     * choice that does not depend on the order they happened to add things in.
     * Bounded either way: it can never exceed one unit.
     */
    if (isPlanCoverable(item.serviceType)) {
      unitLaundry = Math.max(unitLaundry, unitBase + unitFinishes);
    }
  }

  const addons = (selections.addonIds ?? []).reduce(
    (total, id) => total + (specialtyAddon(id)?.price ?? 0),
    0
  );

  base = roundCedis(base);
  finishes = roundCedis(finishes);

  return {
    base,
    finishes,
    addons,
    items,
    quantity: totalUnits(items),
    unitLaundry: roundCedis(unitLaundry),
    laundry: roundCedis(base + finishes),
    gross: roundCedis(base + finishes + addons),
  };
}

// ---------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------

/** Everything that decides what one customer pays for one booking. */
export interface BookingQuote extends PriceBreakdown {
  /** Laundry fee absorbed by an included pickup. */
  waived: number;
  /** The member rate on whatever the allowance did not absorb. */
  memberDiscount: number;
  /** The loyalty tier's cut, taken after the membership. */
  tierDiscount: number;
  /**
   * A promo code's cut, taken last of all.
   *
   * Last is the only ordering that cannot produce a negative bill: applying it
   * to the gross and then taking a tier discount off the result would let two
   * reductions compound past what the booking is worth. See `./promotions`.
   */
  promoDiscount: number;
  /** The code that produced it, so a summary line can name it. */
  promoCode?: string;
  /** What the customer actually owes. */
  total: number;
  /**
   * The tax inside {@link total}, disclosed rather than added.
   *
   * Prices in this product have always been quoted to customers as the figure
   * they pay, so the default mode is inclusive and this is the extraction — see
   * `./tax`. It is derived here rather than stored on the job because it is a
   * pure function of the total and the rates: a booking's receipt recomputes it,
   * and only an *invoice* freezes it, because an invoice states what was owed on
   * the day it was issued.
   */
  tax: TaxBreakdown;
  /** True when this booking spends one of the period's included pickups. */
  coveredByPlan: boolean;
  /** Included pickups left before this booking. */
  remainingPickups: number;
}

/**
 * What this customer owes for this booking.
 *
 * Three reductions, in a fixed order, because they do not commute: the
 * membership's included pickup waives the laundry, the member rate applies to
 * whatever is left, and the loyalty tier takes its cut of *that* rather than of
 * the gross — so the two discounts can never compound into more than the booking
 * is worth. That ordering was the customer app's, and it was the only place it
 * existed.
 *
 * Every caller passes the same three things and gets the same number: the
 * website's form, the app's form, and the server that decides what the job is
 * actually worth. That last one is the point — the two forms are showing a quote,
 * only the server is setting a price.
 *
 * `plan` and `points` are the customer's as the *server* knows them. A signed-out
 * booking passes neither and gets the list price, which is what a guest pays.
 */
export function quoteBooking(input: {
  selections: BookingSelections;
  plan?: ActivePlan | null;
  points?: number;
  /**
   * A code the *server* has already validated, with what it is worth.
   *
   * Resolved rather than named, because deciding what a code is worth needs the
   * database — how many times it has been used, whether by this customer, and
   * whether this is their first order — and this function has none. See
   * `checkPromo` in `./promotions`, which the server runs first.
   *
   * A form showing a customer a quote passes what `checkPromo` told it; the
   * server passes what `checkPromo` told the server. They agree because it is
   * the same function over the same code.
   */
  promo?: { code: string; discount: number } | null;
  /** The rates in force. Defaults to the published ones. */
  taxRates?: TaxRates;
}): BookingQuote {
  const { selections, plan, points, promo } = input;
  const breakdown = priceBreakdown(selections);

  const membership = membershipBookingQuote({
    plan,
    gross: breakdown.gross,
    laundry: breakdown.laundry,
    // One included pickup is worth one unit — the most valuable coverable one
    // on the order. See the note in `membershipBookingQuote`.
    unitLaundry: breakdown.unitLaundry,
    /**
     * Coverable when *any* line is.
     *
     * `unitLaundry` is only ever set from a coverable line, so a positive value
     * is exactly that test — and asking it this way rather than re-running
     * `isPlanCoverable` on `serviceType` is what stops an order of "car detail
     * plus two loads of washing" being refused an allowance because the car
     * happened to be added first.
     */
    coverable: breakdown.unitLaundry > 0,
  });

  const afterPlan = Math.max(
    0,
    roundCedis(breakdown.gross - membership.waived - membership.discount)
  );

  // A tier discount is earned by an account. `tierForPoints(0)` is Bronze at 0%
  // anyway, but passing no points at all says "there is no customer here" more
  // plainly than relying on the first row of the table.
  const tierDiscount =
    points === undefined ? 0 : roundCedis(afterPlan * tierForPoints(points).discountRate);

  const afterTier = Math.max(0, roundCedis(afterPlan - tierDiscount));

  /**
   * The code comes off last, and never takes more than is left.
   *
   * Clamped here as well as in `checkPromo` because the two run against
   * different subtotals in one case that matters: a form quotes a code against
   * the bill it can see, and between that quote and the submission the customer
   * may have earned a tier, spent an included pickup, or changed the order. The
   * server re-runs `checkPromo` on the real figure, and this clamp is what
   * guarantees the arithmetic holds even if a caller does not.
   */
  const promoDiscount = promo ? Math.min(roundCedis(promo.discount), afterTier) : 0;
  const total = Math.max(0, roundCedis(afterTier - promoDiscount));

  return {
    ...breakdown,
    waived: membership.waived,
    memberDiscount: membership.discount,
    tierDiscount,
    promoDiscount,
    promoCode: promo && promoDiscount > 0 ? promo.code : undefined,
    total,
    tax: taxOn(total, input.taxRates ?? DEFAULT_TAX_RATES),
    coveredByPlan: membership.covered,
    remainingPickups: membership.remainingPickups,
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for everything that decides what a customer pays.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * This file covers `pricing`, `membership` and `loyalty` together because they
 * are one rule pretending to be three: `quoteBooking` composes all of them, and
 * the interesting cases are the ones where they interact. The comments in those
 * modules describe several bugs that were fixed by moving the arithmetic here
 * from the two clients — a plan discount applied by the app and not the
 * website, a tier table that disagreed between surfaces, a `setMonth(+1)` that
 * moved every subsequent renewal. Each of those now has an assertion, so the
 * fix has something holding it in place.
 *
 * Prices are read from the tables rather than hard-coded, except where the
 * number *is* the thing being checked — a test that recomputes the
 * implementation proves only that it is self-consistent.
 */

import { check, checkTrue, report, section } from './check';
import {
  DEFAULT_SLOT_CAPACITY,
  DEFAULT_STARCH,
  PICKUP_TIME_SLOTS,
  SPECIALTY_ADDONS,
  isPlanCoverable,
  priceBreakdown,
  quoteBooking,
  serviceBasePrice,
} from './pricing';
import {
  MAX_ITEMS,
  MAX_QUANTITY,
  clampQuantity,
  describeItems,
  serviceTakesQuantity,
  serviceUnit,
} from './services';
import { MAX_BAGS, PRIORITY_THRESHOLD, bagsForJob, priorityForBooking } from './job';
import {
  MEMBERSHIP_PLANS,
  addMonthClamped,
  consumePickup,
  membershipPlan,
  membershipSwitchQuote,
  roundCedis,
  settleMembership,
  startMembership,
  type ActivePlan,
} from './membership';
import { LOYALTY_TIERS, loyaltyReward, pointsForSpend, tierForPoints, tierProgress } from './loyalty';

const WASH = 'Washing (Machine & Hand Wash)';
const CAR = 'Bespoke Car Detailing';
const LAVENDER = 'Organic Lavender';
const UNSCENTED = 'Fragrance-Free (Pure Hypoallergenic Soap)';
const SHIELDING = 'Garment Shielding';
const LINEN = 'Bed Sheets & Linens Care';
const EXPRESS = 'Express Same-Day Laundry';
const IRONING = 'Ironing & Folding';

const plan = (id: string, pickupsUsed = 0): ActivePlan =>
  ({ ...startMembership(membershipPlan(id)!), pickupsUsed }) as ActivePlan;

// ---------------------------------------------------------------------------
section('the list price');

check('a wash is its listed price', serviceBasePrice(WASH), 30);
check('an unlisted service falls back to the default', serviceBasePrice('Alchemy'), 25);

/**
 * The money fields only, not the whole object.
 *
 * These two used to compare `priceBreakdown` against a literal, which meant
 * every field added to the return type broke assertions that were not about it —
 * `quantity`, `unitLaundry` and `items` each did exactly that. What they are
 * checking is the arithmetic, so that is what they name.
 */
const money = (b: ReturnType<typeof priceBreakdown>) => ({
  base: b.base,
  finishes: b.finishes,
  addons: b.addons,
  laundry: b.laundry,
  gross: b.gross,
});

check('scent and starch are itemised away from the base', money(priceBreakdown({
  serviceType: WASH,
  scent: LAVENDER,
  starch: DEFAULT_STARCH,
})), { base: 30, finishes: 5, addons: 0, laundry: 35, gross: 35 });

// The comment on SCENTS names this: a string compare once charged ₵5 for
// choosing *unscented*, which is the option that exists to cost nothing.
check('fragrance-free carries no surcharge', priceBreakdown({
  serviceType: WASH,
  scent: UNSCENTED,
  starch: DEFAULT_STARCH,
}).finishes, 0);

// `finishesFor` returns 0 for anything that is not a garment, so a scent left
// selected from a previous step cannot be billed onto a car.
check('a finish cannot be billed onto a car detail', priceBreakdown({
  serviceType: CAR,
  scent: LAVENDER,
  starch: 'Medium',
}).finishes, 0);

check('add-ons are separable from the laundry', money(priceBreakdown({
  serviceType: WASH,
  scent: UNSCENTED,
  addonIds: [SHIELDING],
})), { base: 30, finishes: 0, addons: 10, laundry: 30, gross: 40 });

check('an unknown add-on is worth nothing, not NaN', priceBreakdown({
  serviceType: WASH,
  scent: UNSCENTED,
  addonIds: ['Gold Plating'],
}).addons, 0);

// ---------------------------------------------------------------------------
section('the quote a guest gets');

check('no plan and no points is the list price', quoteBooking({
  selections: { serviceType: WASH, scent: LAVENDER, starch: DEFAULT_STARCH },
}).total, 35);

// `points === undefined` means "there is no customer here" — distinct from a
// signed-in customer who happens to have zero.
check('a guest gets no tier discount', quoteBooking({
  selections: { serviceType: WASH, scent: LAVENDER },
}).tierDiscount, 0);

check('a signed-in customer at zero points is also Bronze at 0%', quoteBooking({
  selections: { serviceType: WASH, scent: LAVENDER },
  points: 0,
}).tierDiscount, 0);

// ---------------------------------------------------------------------------
section('membership against a booking');

const student = membershipPlan('student')!;

{
  // An included pickup absorbs the laundry; the add-on is still billed, at the
  // member rate.
  const quote = quoteBooking({
    selections: { serviceType: WASH, scent: LAVENDER, addonIds: [SHIELDING] },
    plan: plan('student'),
  });
  check('an included pickup waives the laundry only', quote.waived, 35);
  checkTrue('...and the booking is marked as covered', quote.coveredByPlan);
  check('...the add-on is billed at the member rate', quote.memberDiscount, roundCedis(10 * 0.1));
  check('...leaving the extras and nothing else', quote.total, roundCedis(10 - 10 * 0.1));
}

{
  // The comment on `isPlanCoverable` names the exploit: eight included pickups
  // spent on ₵180 visits would buy ₵1,440 of work for a ₵289 plan.
  const quote = quoteBooking({ selections: { serviceType: CAR }, plan: plan('family') });
  checkTrue('a car detail is never covered by an allowance', !quote.coveredByPlan);
  check('...it gets the member discount instead', quote.waived, 0);
  check('...at the family rate', quote.memberDiscount, roundCedis(150 * 0.2));
}

{
  const spent = plan('student', student.includedPickups);
  const quote = quoteBooking({ selections: { serviceType: WASH, scent: LAVENDER }, plan: spent });
  check('a spent allowance waives nothing', quote.waived, 0);
  check('...and reports none remaining', quote.remainingPickups, 0);
  check('...but the member rate still applies', quote.memberDiscount, roundCedis(35 * 0.1));
}

// ---------------------------------------------------------------------------
section('the two discounts do not compound');

{
  // The ordering `quoteBooking` documents: allowance, then member rate, then
  // tier — the tier taking its cut of what is left rather than of the gross.
  const gold = LOYALTY_TIERS.find((tier) => tier.id === 'gold')!;
  const quote = quoteBooking({
    selections: { serviceType: CAR },
    plan: plan('family'),
    points: gold.minPoints,
  });

  const afterPlan = roundCedis(150 - 150 * 0.2);
  check('the tier discounts what the plan left, not the gross', quote.tierDiscount,
    roundCedis(afterPlan * gold.discountRate));
  check('...so the total is the two applied in order', quote.total,
    roundCedis(afterPlan - afterPlan * gold.discountRate));
  checkTrue('...and is never more than the booking was worth', quote.total <= quote.gross);
}

checkTrue(
  'no combination of plan and tier can make a booking cost less than nothing',
  MEMBERSHIP_PLANS.every((definition) =>
    LOYALTY_TIERS.every((tier) =>
      quoteBooking({
        selections: { serviceType: WASH, scent: LAVENDER, addonIds: [SHIELDING] },
        plan: plan(definition.id),
        points: tier.minPoints,
      }).total >= 0
    )
  )
);

// ---------------------------------------------------------------------------
section('how many of it');

// Every service advertises a price per something. Until quantity existed, four
// loads and one load were both billed as one load.
check('one load is the list price', priceBreakdown({ serviceType: WASH, scent: UNSCENTED }).gross, 30);
check('four loads is four times it',
  priceBreakdown({ serviceType: WASH, scent: UNSCENTED, quantity: 4 }).gross, 120);

{
  // The agreed rule: base and finishes scale because that work is done per
  // unit; add-ons are chosen once for the order and billed once.
  const three = priceBreakdown({
    serviceType: WASH,
    scent: LAVENDER,
    addonIds: [SHIELDING],
    quantity: 3,
  });
  check('the base scales', three.base, 90);
  check('the finishes scale with it', three.finishes, 15);
  check('the add-on does not', three.addons, 10);
  check('so the laundry is three units worth', three.laundry, 105);
  check('and the gross carries the add-on once', three.gross, 115);
  check('one unit is reported alongside, for the membership', three.unitLaundry, 35);
}

// A service priced per order is one order however much of it there is.
check('a per-order service ignores a quantity',
  priceBreakdown({ serviceType: 'Ironing & Folding', quantity: 5 }).gross, 25);
check('...and reports the quantity it actually used',
  priceBreakdown({ serviceType: 'Ironing & Folding', quantity: 5 }).quantity, 1);
checkTrue('a load is countable and an order is not',
  serviceTakesQuantity(WASH) && !serviceTakesQuantity('Ironing & Folding'));
check('a car detail counts by the ride', serviceUnit(CAR), 'ride');

// The number multiplies a price and arrives off the wire, so it is clamped
// before it is used — by the forms, and again by the server.
check('absent means one', priceBreakdown({ serviceType: WASH, scent: UNSCENTED }).quantity, 1);
check('zero means one', clampQuantity(0, WASH), 1);
check('negative means one', clampQuantity(-5, WASH), 1);
check('a fraction floors', clampQuantity(2.9, WASH), 2);
check('a fraction under one still means one', clampQuantity(0.0001, WASH), 1);
check('nonsense means one', clampQuantity('lots', WASH), 1);
check('NaN means one', clampQuantity(NaN, WASH), 1);
check('past the ceiling stops at it', clampQuantity(1e9, WASH), MAX_QUANTITY);
check('a per-order service is always one', clampQuantity(9, 'Ironing & Folding'), 1);

// The exploit the clamp exists to stop: a crafted quantity quoting a wash at
// nothing, or at a number `priorityForBooking` reads as elite.
checkTrue('a crafted fraction cannot quote a booking at nothing',
  priceBreakdown({ serviceType: WASH, scent: UNSCENTED, quantity: 0.0001 }).gross === 30);
checkTrue('a crafted huge quantity is bounded',
  priceBreakdown({ serviceType: WASH, scent: UNSCENTED, quantity: 1e9 }).gross === 30 * MAX_QUANTITY);

// ---------------------------------------------------------------------------
section('one included pickup is worth one unit');

{
  // Four loads on a Student plan: the first load is waived, the other three are
  // charged at the member rate. Letting one pickup absorb the lot would let a
  // ₵79 plan with two pickups waive forty loads.
  const quote = quoteBooking({
    selections: { serviceType: WASH, scent: UNSCENTED, quantity: 4 },
    plan: plan('student'),
  });
  check('the allowance waives one load', quote.waived, 30);
  checkTrue('...and the booking still counts as covered', quote.coveredByPlan);
  check('...the other three are at the member rate',
    quote.memberDiscount, roundCedis((120 - 30) * 0.1));
  check('...so the member pays for three loads less their rate',
    quote.total, roundCedis(120 - 30 - (120 - 30) * 0.1));
}

check('a single load is still fully waived',
  quoteBooking({
    selections: { serviceType: WASH, scent: UNSCENTED },
    plan: plan('student'),
  }).total, 0);

checkTrue(
  'no quantity on any plan can waive more than one unit',
  MEMBERSHIP_PLANS.every((definition) =>
    [1, 2, 10, MAX_QUANTITY].every((quantity) => {
      const quote = quoteBooking({
        selections: { serviceType: WASH, scent: LAVENDER, quantity },
        plan: plan(definition.id),
      });
      return quote.waived <= quote.unitLaundry;
    })
  )
);

// ---------------------------------------------------------------------------
section('several services on one order');

{
  // One collection, one courier, one doorstep — but two services.
  const quote = quoteBooking({
    selections: {
      serviceType: WASH,
      scent: UNSCENTED,
      items: [
        { serviceType: WASH, quantity: 2 },
        { serviceType: LINEN, quantity: 1 },
      ],
    },
  });
  check('every line is priced and summed', quote.gross, 30 * 2 + 45);
  check('...and the units are counted across them', quote.quantity, 3);
  check('...with the lines handed back', quote.items.length, 2);
}

{
  // A finish is an order-level decision applied per line: the scent is charged
  // on the loads of washing and not on the car sitting beside them.
  const quote = quoteBooking({
    selections: {
      serviceType: WASH,
      scent: LAVENDER,
      items: [
        { serviceType: WASH, quantity: 2 },
        { serviceType: CAR, quantity: 1 },
      ],
    },
  });
  check('a finish is charged only on the garment lines', quote.finishes, 5 * 2);
  check('...and the base still covers both', quote.base, 30 * 2 + 150);
}

{
  // The allowance is worth the best single unit, whatever order things were
  // added in.
  const linenFirst = quoteBooking({
    selections: {
      serviceType: LINEN,
      scent: UNSCENTED,
      items: [
        { serviceType: LINEN, quantity: 1 },
        { serviceType: WASH, quantity: 2 },
      ],
    },
    plan: plan('student'),
  });
  const washFirst = quoteBooking({
    selections: {
      serviceType: WASH,
      scent: UNSCENTED,
      items: [
        { serviceType: WASH, quantity: 2 },
        { serviceType: LINEN, quantity: 1 },
      ],
    },
    plan: plan('student'),
  });
  check('the allowance waives the most valuable unit', linenFirst.waived, 45);
  check('...regardless of the order the lines are in', washFirst.waived, 45);
  check('...and the two orders cost the same', linenFirst.total, washFirst.total);
}

{
  // A car detail is not coverable, but the washing beside it is — the order
  // must not lose its allowance because the car was added first.
  const quote = quoteBooking({
    selections: {
      serviceType: CAR,
      scent: UNSCENTED,
      items: [
        { serviceType: CAR, quantity: 1 },
        { serviceType: WASH, quantity: 1 },
      ],
    },
    plan: plan('family'),
  });
  checkTrue('an uncoverable first line does not lose the allowance', quote.coveredByPlan);
  check('...which waives the washing, not the car', quote.waived, 30);
}

check('an order of nothing but uncoverable work gets no allowance',
  quoteBooking({
    selections: { serviceType: CAR, items: [{ serviceType: CAR, quantity: 2 }] },
    plan: plan('family'),
  }).waived, 0);

// A booking from before line items existed is a list of one.
check('a single-service booking still prices',
  quoteBooking({ selections: { serviceType: WASH, scent: UNSCENTED, quantity: 3 } }).gross, 90);
check('...and reports itself as one line',
  priceBreakdown({ serviceType: WASH, quantity: 3 }).items.length, 1);
check('more lines than allowed are dropped',
  priceBreakdown({
    serviceType: WASH,
    items: Array.from({ length: MAX_ITEMS + 4 }, () => ({ serviceType: WASH, quantity: 1 })),
  }).items.length, MAX_ITEMS);
check('a line naming no service is dropped',
  priceBreakdown({
    serviceType: WASH,
    items: [{ serviceType: '  ', quantity: 2 }, { serviceType: WASH, quantity: 1 }],
  }).items.length, 1);

// ---------------------------------------------------------------------------
section('the bag manifest follows the count');

// It used to be `ceil(amount / 50)` capped at three: ten loads produced three
// bags, and a car detail produced three for a job with no bags in it.
check('one load is one bag', bagsForJob('FFC-123456', { serviceType: WASH, quantity: 1 }).length, 1);
check('four loads are four bags', bagsForJob('FFC-123456', { serviceType: WASH, quantity: 4 }).length, 4);
check('two services are the sum of their units',
  bagsForJob('FFC-123456', {
    serviceType: WASH,
    items: [
      { serviceType: WASH, quantity: 2 },
      { serviceType: LINEN, quantity: 1 },
    ],
  }).length, 3);

{
  const bags = bagsForJob('FFC-123456', {
    serviceType: WASH,
    items: [
      { serviceType: WASH, quantity: 2 },
      { serviceType: LINEN, quantity: 1 },
    ],
  });
  check('each bag is labelled with the service it belongs to',
    bags.map((bag) => bag.type), [WASH, WASH, LINEN]);
  checkTrue('every QR is distinct',
    new Set(bags.map((bag) => bag.qrCode)).size === bags.length);
  // The suffix used to be a single letter, which ran out at 26.
  check('the suffixes run past Z',
    bagsForJob('FFC-123456', {
      serviceType: WASH,
      items: [{ serviceType: WASH, quantity: 28 }],
    }).slice(26, 28).map((bag) => bag.qrCode.slice(-2)),
    ['AA', 'AB']);
}

checkTrue('the manifest is capped so it stays scannable',
  bagsForJob('FFC-123456', {
    serviceType: WASH,
    items: Array.from({ length: MAX_ITEMS }, () => ({ serviceType: WASH, quantity: MAX_QUANTITY })),
  }).length === MAX_BAGS);

checkTrue('the same booking always yields the same codes',
  JSON.stringify(bagsForJob('FFC-123456', { serviceType: WASH, quantity: 3 })) ===
    JSON.stringify(bagsForJob('FFC-123456', { serviceType: WASH, quantity: 3 })));

// ---------------------------------------------------------------------------
section('what a per-order service does not add to the manifest');

/**
 * Express Same-Day is a promise about how fast the same bags come back. It was
 * counted as a unit like any other, so it produced a bag of its own — and
 * `bagsForJob` labels each bag with the line that produced it, so the customer
 * was shown a third bag called "Express Same-Day Laundry" and the courier had a
 * third tag to look for that nobody would ever tie to anything.
 *
 * It is still priced, still described and still on the receipt. It is simply
 * not luggage. Same for ironing, stain removal and the courier's own ride.
 */
check('same-day service adds no bag of its own',
  bagsForJob('FFC-123456', {
    serviceType: WASH,
    items: [
      { serviceType: WASH, quantity: 2 },
      { serviceType: EXPRESS, quantity: 1 },
    ],
  }).length, 2);

check('...and no bag is labelled with it',
  bagsForJob('FFC-123456', {
    serviceType: WASH,
    items: [
      { serviceType: WASH, quantity: 2 },
      { serviceType: EXPRESS, quantity: 1 },
    ],
  }).map((bag) => bag.type), [WASH, WASH]);

check('...while it is still charged for', priceBreakdown({
  serviceType: WASH,
  items: [
    { serviceType: WASH, quantity: 2 },
    { serviceType: EXPRESS, quantity: 1 },
  ],
}).gross, 110);

check('ironing beside a wash adds no bag either',
  bagsForJob('FFC-123456', {
    serviceType: WASH,
    items: [
      { serviceType: WASH, quantity: 1 },
      { serviceType: IRONING, quantity: 1 },
    ],
  }).length, 1);

// A bag of clothes still turns up; it is just a bag nobody has counted.
check('an order that is only per-order work is still one bag',
  bagsForJob('FFC-123456', { serviceType: IRONING, quantity: 1 }).length, 1);
check('...labelled with the work it is for',
  bagsForJob('FFC-123456', { serviceType: IRONING, quantity: 1 })[0].type, IRONING);

// The counted units are untouched — this is a rule about `order`, not about
// everything that is not a load.
check('counted units are unaffected',
  bagsForJob('FFC-123456', {
    serviceType: WASH,
    items: [
      { serviceType: WASH, quantity: 2 },
      { serviceType: LINEN, quantity: 1 },
      { serviceType: CAR, quantity: 1 },
    ],
  }).length, 4);

// ---------------------------------------------------------------------------
section('re-deriving a price from a stored booking');

/**
 * Three screens re-derive a list price when a booking has no `amount` on it, or
 * to itemise a receipt beside the amount the server charged: `displayAmount`,
 * the desk's receipt and the patron portal's.
 *
 * All three passed `serviceType` and the finish and nothing else, so a
 * three-load order re-derived as one load. On a receipt that is worse than a
 * wrong number — the itemisation is subtracted from the real total to show what
 * a discount took off, so the missing ₵70 appeared as though the customer had
 * been given it.
 *
 * `bookingItems` reads either shape, which is why passing both `items` and
 * `quantity` covers a record from before line items as well as one from a
 * client that only sends the count.
 */
{
  const stored = {
    serviceType: WASH,
    scent: UNSCENTED,
    items: [
      { serviceType: WASH, quantity: 2 },
      { serviceType: LINEN, quantity: 1 },
    ],
    quantity: 2,
  };

  const derived = priceBreakdown(stored);
  check('re-deriving from a stored booking counts every line', derived.gross, 30 * 2 + 45);

  // What the three screens used to do.
  const serviceOnly = priceBreakdown({ serviceType: stored.serviceType, scent: UNSCENTED });
  checkTrue('...which the service name alone could not', serviceOnly.gross < derived.gross);
}

check('a booking carrying only a quantity still re-derives correctly',
  priceBreakdown({ serviceType: WASH, scent: UNSCENTED, quantity: 3 }).gross, 90);

check('a booking from before either existed is still one unit',
  priceBreakdown({ serviceType: WASH, scent: UNSCENTED }).gross, 30);

// ---------------------------------------------------------------------------
section('where a job sits in the queue');

// `elite` is what the plans screen sells. It stopped meaning anything when a
// booking could carry a quantity: `amount >= 80` put every order of three loads
// or more in the same tier as a paying member.
check('a member is elite on any order', priorityForBooking(35, 'student'), 'elite');
check('...however small', priorityForBooking(0, 'student'), 'elite');

check('one load is ordinary', priorityForBooking(35), 'standard');
check('two loads are worked first', priorityForBooking(70), 'priority');
check('a car detail is worked first', priorityForBooking(150), 'priority');

checkTrue(
  'no guest order reaches the tier a membership sells, at any size',
  [45, 105, 350, 1200, 999999].every((amount) => priorityForBooking(amount) !== 'elite')
);

check('the threshold is the boundary itself', priorityForBooking(PRIORITY_THRESHOLD), 'priority');
check('...and a penny under it is not', priorityForBooking(PRIORITY_THRESHOLD - 0.01), 'standard');

// ---------------------------------------------------------------------------
section('what the courier and the desk are told');

// Every staff surface used to print `job.service.type`, which names the *first*
// service — so a courier sent for two loads and a set of linen read "Washing".
check('a single service reads as its name alone',
  describeItems({ serviceType: WASH }), WASH);
check('...with no count on a single unit',
  describeItems({ serviceType: WASH, quantity: 1 }), WASH);
check('a counted single service says how many',
  describeItems({ serviceType: WASH, quantity: 3 }), `3 loads · ${WASH}`);
check('a per-order service never carries a count',
  describeItems({ serviceType: 'Ironing & Folding', quantity: 4 }), 'Ironing & Folding');
check('two services are both named',
  describeItems({
    serviceType: WASH,
    items: [
      { serviceType: WASH, quantity: 2 },
      { serviceType: LINEN, quantity: 1 },
    ],
  }),
  `2 loads · ${WASH} + ${LINEN}`);
check('an empty booking describes nothing rather than throwing',
  describeItems({ serviceType: '' }), '');

// ---------------------------------------------------------------------------
section('collection windows have a ceiling');

// `PICKUP_TIME_SLOTS` had no references anywhere in the server: every customer
// could book the same 08:00–11:00 and nothing refused the eleventh.
checkTrue('there is a capacity to enforce', DEFAULT_SLOT_CAPACITY >= 1);
checkTrue('the slots are a closed set the server can count against',
  PICKUP_TIME_SLOTS.length === 3 && PICKUP_TIME_SLOTS.every((slot) => slot.length > 0));
checkTrue('every slot is distinct, so counts cannot collide',
  new Set(PICKUP_TIME_SLOTS).size === PICKUP_TIME_SLOTS.length);

// ---------------------------------------------------------------------------
section('renewal dates');

// The comment on `addMonthClamped`: `setMonth(+1)` on 31 January lands in March,
// which gives a longer first period and moves every renewal after it.
check('31 January clamps to 28 February', addMonthClamped(new Date(2026, 0, 31)).getDate(), 28);
check('31 January 2028 clamps to the 29th in a leap year',
  addMonthClamped(new Date(2028, 0, 31)).getDate(), 29);
check('31 March clamps to 30 April', addMonthClamped(new Date(2026, 2, 31)).getDate(), 30);
check('the 15th stays the 15th', addMonthClamped(new Date(2026, 0, 15)).getDate(), 15);
check('December rolls into January', addMonthClamped(new Date(2026, 11, 15)).getFullYear(), 2027);

// ---------------------------------------------------------------------------
section('settling a membership');

{
  const now = new Date(2026, 0, 15);
  const active = startMembership(student, now);
  const settled = settleMembership(active, 500, new Date(2026, 0, 20));
  checkTrue('a period still running is returned untouched', settled.plan === active);
  check('...nothing is charged', settled.charges.length, 0);
  check('...and the balance is unmoved', settled.balance, 500);
}

{
  // Identity matters here: `plan === settlement.plan` is how callers avoid a
  // database write on every poll from every device.
  const active = startMembership(student, new Date(2026, 0, 15));
  const due = settleMembership(active, 500, new Date(2026, 1, 16));
  check('a period that has rolled over charges once', due.charges.length, 1);
  check('...at the plan price', due.balance, 500 - student.price);
  check('...and resets the allowance', due.plan?.pickupsUsed, 0);
  checkTrue('...returning a new object, so the caller knows to write', due.plan !== active);
}

{
  const active = startMembership(student, new Date(2026, 0, 15));
  const broke = settleMembership(active, student.price - 1, new Date(2026, 1, 16));
  check('a wallet that cannot cover the fee lapses the plan', broke.plan, null);
  check('...saying why', broke.lapsed, 'insufficient-funds');
  check('...without accruing a debt', broke.balance, student.price - 1);
}

{
  const cancelling = { ...startMembership(student, new Date(2026, 0, 15)), cancelAtPeriodEnd: true };
  const ended = settleMembership(cancelling, 5000, new Date(2026, 1, 16));
  check('a cancelled plan ends at the period boundary', ended.plan, null);
  check('...and is not charged for another month', ended.charges.length, 0);
  check('...saying why', ended.lapsed, 'cancelled');
}

{
  // Two years away. The loop is guarded at 24 periods precisely so a corrupt
  // far-past date cannot spin.
  const stale = startMembership(student, new Date(2020, 0, 15));
  const caught = settleMembership(stale, 100000, new Date(2026, 0, 15));
  checkTrue('a long-abandoned account settles without spinning', caught.charges.length <= 24);
}

// Cast through `unknown`: `planId` is a union of the four ids that exist, and
// the whole point of this case is a stored plan naming one that does not.
check('a plan id no longer offered ends rather than renewing',
  settleMembership({ ...plan('student'), planId: 'platinum' } as unknown as ActivePlan, 5000,
    new Date(2030, 0, 1)).lapsed, 'withdrawn');

// ---------------------------------------------------------------------------
section('switching plans');

{
  const family = membershipPlan('family')!;
  const now = new Date(2026, 0, 15);
  const running = startMembership(student, now);

  // Halfway through the month: half the student fee is unused and credited.
  const halfway = new Date(2026, 0, 30);
  const quote = membershipSwitchQuote(running, family, halfway);
  check('the new plan is quoted at its full fee', quote.fee, family.price);
  checkTrue('...against a credit for the unused part of the old one', quote.credit > 0);
  checkTrue('...which never exceeds what was paid', quote.credit <= student.price);
  check('...and the amount due is the difference', quote.due, roundCedis(family.price - quote.credit));
}

{
  // The documented limit: a downgrade costs ₵0 today rather than refunding.
  const corporate = membershipPlan('corporate')!;
  const running = startMembership(corporate, new Date(2026, 0, 15));
  const quote = membershipSwitchQuote(running, student, new Date(2026, 0, 16));
  check('a downgrade is never negative', quote.due, Math.max(0, quote.due));
  checkTrue('...and costs nothing today', quote.due === 0);
}

// ---------------------------------------------------------------------------
section('spending an included pickup');

{
  const fresh = plan('student');
  check('spending one increments the count', consumePickup(fresh).pickupsUsed, 1);

  const spent = plan('student', student.includedPickups);
  check('spending past the allowance changes nothing',
    consumePickup(spent).pickupsUsed, student.includedPickups);
}

// ---------------------------------------------------------------------------
section('care points');

check('a point per whole cedi', pointsForSpend(35), 35);
check('part-cedis do not round up into free points', pointsForSpend(35.99), 35);
check('...and neither does a stream of small charges', pointsForSpend(0.99), 0);
check('a negative spend earns nothing', pointsForSpend(-50), 0);

// The comment on LOYALTY_TIERS: the website said Silver at 400 and the app said
// 500, so the same customer was two different tiers depending where they looked.
check('Bronze at zero', tierForPoints(0).id, 'basic');
check('one point short of Silver is still Bronze', tierForPoints(499).id, 'basic');
check('Silver at its own threshold', tierForPoints(500).id, 'silver');
check('Gold at its own threshold', tierForPoints(1500).id, 'gold');
check('past the top tier stays at the top', tierForPoints(999999).id, 'gold');

checkTrue(
  'the tier table is ascending, which tierForPoints relies on',
  LOYALTY_TIERS.every((tier, index) => index === 0 || tier.minPoints > LOYALTY_TIERS[index - 1].minPoints)
);

{
  const progress = tierProgress(0);
  check('progress from zero points to Silver', progress.pointsToNext, 500);
  check('...at nought per cent', progress.percent, 0);

  const top = tierProgress(2000);
  check('there is nothing after Gold', top.next, null);
}

// ---------------------------------------------------------------------------
section('rewards');

checkTrue('a reward in the catalogue is found', loyaltyReward('wallet-credit-50') !== null);
check('one that is not is null, not a throw', loyaltyReward('free-house'), null);
check('and so is nothing at all', loyaltyReward(undefined), null);

checkTrue(
  'every reward costs points',
  loyaltyRewardsAllPositive()
);

function loyaltyRewardsAllPositive(): boolean {
  return ['scent-spray', 'express-dispatch', 'wallet-credit-50']
    .map((id) => loyaltyReward(id))
    .every((reward) => reward !== null && reward.cost > 0);
}

// ---------------------------------------------------------------------------
section('sanity on the tables themselves');

checkTrue('every plan has a price and an allowance',
  MEMBERSHIP_PLANS.every((p) => p.price > 0 && p.includedPickups > 0));
checkTrue('every plan discount is a fraction, not a percentage',
  MEMBERSHIP_PLANS.every((p) => p.overageDiscount > 0 && p.overageDiscount < 1));
checkTrue('every add-on is priced',
  SPECIALTY_ADDONS.every((addon) => addon.price > 0));
checkTrue('garment services are plan-coverable and premises services are not',
  isPlanCoverable(WASH) && !isPlanCoverable(CAR));

report();

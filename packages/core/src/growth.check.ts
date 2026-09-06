/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for tax, promo codes, referrals, standing orders and branches.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * The five together because each one is a rule the product previously did not
 * have at all rather than one it had wrong — a grep for `VAT`, `coupon`,
 * `referral` or `invoice` returned nothing across the whole repository, and
 * `includedPickups` was subtracted in a dozen places and scheduled in none.
 *
 * The clock is passed in everywhere, for the reason `reschedule.check.ts`
 * explains: a check whose answer changes on a Tuesday is a check that fails in
 * CI and passes by hand.
 */

import { check, checkTrue, report, section } from './check';
import { defaultHub, hubForPickup } from './geo';
import {
  DEFAULT_TAX_RATES,
  LEVIES,
  VAT_RATE,
  effectiveRate,
  ratesFromEnv,
  taxOn,
  type TaxRates,
} from './tax';
import {
  REFERRAL_REWARD,
  canClaimReferral,
  checkPromo,
  isReferralCodeShaped,
  makeReferralCode,
  normalisePromoCode,
  promoLabel,
} from './promotions';
import { nextDue, nextOccurrence, weekdayOf } from './recurring';
import { quoteBooking } from './pricing';
import type { Hub, PromoCode, RecurringPickup } from './types';

/** Monday 24 August 2026, 09:00 UTC. */
const NOW = new Date('2026-08-24T09:00:00Z');

const promo = (over: Partial<PromoCode> = {}): PromoCode => ({
  code: 'FRESHERS',
  label: 'Freshers week',
  kind: 'percent',
  value: 0.2,
  minSpend: 0,
  maxPerCustomer: 1,
  firstOrderOnly: false,
  active: true,
  createdBy: 'desk@freshfold.test',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const fresh = { total: 0, byCustomer: 0, firstOrder: true };

const why = (result: ReturnType<typeof checkPromo>) => (result.ok ? 'ok' : result.reason);
const worth = (result: ReturnType<typeof checkPromo>) => (result.ok ? result.discount : -1);

// ---------------------------------------------------------------------------
section('tax is composed, not one multiplication');

// Ghana charges flat levies on the taxable value and then VAT on the value
// *plus* those levies, so the effective rate is more than the sum of the parts.
// A hard-coded combined figure is the mistake this module exists to prevent.
const leviesTotal = LEVIES.reduce((sum, levy) => sum + levy.rate, 0);

checkTrue('the effective rate is more than the parts added up',
  effectiveRate() > leviesTotal + VAT_RATE);
check('...and is exactly levies + vat*(1+levies)',
  Number(effectiveRate().toFixed(6)),
  Number((leviesTotal + VAT_RATE * (1 + leviesTotal)).toFixed(6)));

// The default is inclusive: the customer pays what they were quoted, and the tax
// is extracted for the invoice rather than added to the bill.
check('the published mode is inclusive', DEFAULT_TAX_RATES.mode, 'inclusive');

const inclusive = taxOn(100);
check('an inclusive bill of 100 is still 100 to pay', inclusive.gross, 100);
checkTrue('...with a net below it', inclusive.net < 100 && inclusive.net > 0);
check('...and the lines add up to the tax',
  Number(inclusive.lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2)),
  inclusive.tax);
check('...and net plus tax is the gross',
  Number((inclusive.net + inclusive.tax).toFixed(2)), inclusive.gross);

// Every levy gets its own line, because each must appear separately on a VAT
// invoice — one "levies 6%" row is not an invoice a customer can check.
check('there is a line per levy, plus VAT', inclusive.lines.length, LEVIES.length + 1);
checkTrue('VAT is the last of them', inclusive.lines[inclusive.lines.length - 1].id === 'vat');

const exclusiveRates: TaxRates = { ...DEFAULT_TAX_RATES, mode: 'exclusive' };
const exclusive = taxOn(100, exclusiveRates);
check('an exclusive bill of 100 has a net of 100', exclusive.net, 100);
checkTrue('...and a gross above it', exclusive.gross > 100);

// A business below the registration threshold issues invoices with no tax lines
// at all. "VAT ₵0.00" would be a claim to be registered.
const unregistered = taxOn(100, { ...DEFAULT_TAX_RATES, registered: false });
check('an unregistered supplier charges no tax', unregistered.tax, 0);
check('...and shows no lines', unregistered.lines.length, 0);
check('...and the effective rate is zero',
  effectiveRate({ ...DEFAULT_TAX_RATES, registered: false }), 0);

check('nothing owed on nothing', taxOn(0).tax, 0);
check('a negative amount is treated as nothing', taxOn(-50).gross, 0);

// --- the environment ---
check('an empty environment gives the published rates',
  ratesFromEnv({}).vat, VAT_RATE);
check('a rate can be overridden', ratesFromEnv({ TAX_VAT_RATE: '0.125' }).vat, 0.125);
check('a nonsense rate falls back rather than throwing',
  ratesFromEnv({ TAX_VAT_RATE: 'fifteen percent' }).vat, VAT_RATE);
check('a rate above 1 falls back — it is a fraction, not a percentage',
  ratesFromEnv({ TAX_VAT_RATE: '15' }).vat, VAT_RATE);
check('the mode can be switched', ratesFromEnv({ TAX_MODE: 'exclusive' }).mode, 'exclusive');
checkTrue('registration is opt out, not opt in', ratesFromEnv({}).registered);
checkTrue('...and opting out works', !ratesFromEnv({ TAX_REGISTERED: 'false' }).registered);

// ---------------------------------------------------------------------------
section('promo codes');

check('a code is read case-insensitively', normalisePromoCode(' freshers24 '), 'FRESHERS24');

check('a live percentage code applies', why(checkPromo(promo(), 100, fresh, NOW)), 'ok');
check('...and is worth its percentage', worth(checkPromo(promo(), 100, fresh, NOW)), 20);
check('a fixed code is worth its amount',
  worth(checkPromo(promo({ kind: 'amount', value: 15 }), 100, fresh, NOW)), 15);

check('no code at all', why(checkPromo(null, 100, fresh, NOW)), 'unknown');
check('a withdrawn code', why(checkPromo(promo({ active: false }), 100, fresh, NOW)), 'withdrawn');
check('one that has not started',
  why(checkPromo(promo({ startsAt: '2026-09-01T00:00:00Z' }), 100, fresh, NOW)), 'not-started');
check('one that has expired',
  why(checkPromo(promo({ expiresAt: '2026-08-01T00:00:00Z' }), 100, fresh, NOW)), 'expired');

check('one that has been fully claimed',
  why(checkPromo(promo({ maxUses: 50 }), 100, { ...fresh, total: 50 }, NOW)), 'exhausted');
check('...and one place short of it is fine',
  why(checkPromo(promo({ maxUses: 50 }), 100, { ...fresh, total: 49 }, NOW)), 'ok');

check('one this customer has already used',
  why(checkPromo(promo(), 100, { ...fresh, byCustomer: 1 }, NOW)), 'already-used');
check('...and a code allowing three is fine on the second',
  why(checkPromo(promo({ maxPerCustomer: 3 }), 100, { ...fresh, byCustomer: 1 }, NOW)), 'ok');

check('a first-order code on a returning customer',
  why(checkPromo(promo({ firstOrderOnly: true }), 100, { ...fresh, firstOrder: false }, NOW)),
  'first-order-only');

check('an order below the minimum',
  why(checkPromo(promo({ minSpend: 50 }), 40, fresh, NOW)), 'below-minimum');
check('...and exactly at it is fine',
  why(checkPromo(promo({ minSpend: 50 }), 50, fresh, NOW)), 'ok');

// The cap is what stops "20% off everything" being an unbounded liability the
// first time somebody books a ₵180 office clean.
check('a percentage code is capped',
  worth(checkPromo(promo({ maxDiscount: 15 }), 180, fresh, NOW)), 15);
check('...and under the cap is uncapped',
  worth(checkPromo(promo({ maxDiscount: 15 }), 50, fresh, NOW)), 10);

// A ₵20 code on a ₵12 order takes ₵12 off, not ₵20. The difference is not change
// owed to the customer.
check('a code never takes more than the bill',
  worth(checkPromo(promo({ kind: 'amount', value: 20 }), 12, fresh, NOW)), 12);

check('a percentage reads as a percentage', promoLabel(promo()), '20% off');
check('an amount reads as an amount', promoLabel(promo({ kind: 'amount', value: 15 })), '₵15.00 off');

// --- and through the quote ---
const wash = { serviceType: 'Washing (Machine & Hand Wash)', items: [] };

const plain = quoteBooking({ selections: wash });
const discounted = quoteBooking({
  selections: wash,
  promo: { code: 'FRESHERS', discount: 10 },
});

check('a code comes off the total', Number((plain.total - discounted.total).toFixed(2)), 10);
check('...and is recorded on the quote', discounted.promoDiscount, 10);
check('...under the code that produced it', discounted.promoCode, 'FRESHERS');
check('no code leaves the total alone', plain.promoDiscount, 0);
check('...and names none', plain.promoCode, undefined);

// The clamp is the quote's, not the caller's: a code worth more than the bill
// cannot make a total negative however it arrives.
const overshoot = quoteBooking({
  selections: wash,
  promo: { code: 'HUGE', discount: 10_000 },
});
check('a code larger than the bill zeroes it rather than going negative', overshoot.total, 0);
checkTrue('...and the tax on nothing is nothing', overshoot.tax.tax === 0);

// ---------------------------------------------------------------------------
section('referrals');

checkTrue('a minted code is the right shape',
  isReferralCodeShaped(makeReferralCode(() => 0.5)));
checkTrue('a code from the confusable characters is rejected',
  !isReferralCodeShaped('OOIIL1'));
checkTrue('a code of the wrong length is rejected', !isReferralCodeShaped('ABC'));
checkTrue('a promo code is not a referral code', !isReferralCodeShaped('FRESHERS24'));

// The alphabet leaves out 0/O, 1/I and L: a referral code is read aloud across a
// room and typed off a screenshot, and those are the pairs that get confused.
const sample = makeReferralCode(() => 0.99);
checkTrue('no confusable characters are ever minted',
  !/[01OIL]/.test(sample));

checkTrue('a valid claim is allowed',
  canClaimReferral({ email: 'new@example.com', referrerEmail: 'old@example.com' }).ok);
check('an unknown code',
  canClaimReferral({ email: 'new@example.com', referrerEmail: null }).reason, 'unknown-code');

// The first thing anybody tries, and it costs the laundry both bonuses.
check('referring yourself',
  canClaimReferral({ email: 'me@example.com', referrerEmail: 'me@example.com' }).reason,
  'self-referral');
check('...however it is capitalised',
  canClaimReferral({ email: 'Me@Example.com', referrerEmail: 'me@example.com' }).reason,
  'self-referral');
check('claiming a second referrer',
  canClaimReferral({
    email: 'new@example.com',
    referrerEmail: 'old@example.com',
    existingReferrer: 'first@example.com',
  }).reason,
  'already-referred');

checkTrue('the reward is worth having', REFERRAL_REWARD > 0);

// ---------------------------------------------------------------------------
section('standing orders');

const standing = (over: Partial<RecurringPickup> = {}): RecurringPickup => ({
  id: 'rec-1',
  customerEmail: 'customer@example.com',
  // Tuesday.
  weekday: 2,
  pickupTime: '08:00 AM - 11:00 AM (Morning Concierge)',
  items: [],
  addons: [],
  address: '12 Ayeduase Road',
  suburb: 'Ayeduase',
  city: 'Kumasi',
  notes: '',
  active: true,
  leadDays: 3,
  startsOn: '2026-08-01',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const due = (over: Partial<RecurringPickup> = {}, now = NOW) => {
  const result = nextDue(standing(over), now);
  return result.ok ? result.date : result.reason;
};

check('Monday the 24th is a Monday', weekdayOf('2026-08-24'), 1);
check('the next Tuesday from a Monday is tomorrow',
  nextOccurrence('2026-08-24', 2), '2026-08-25');
check('the next Tuesday from a Tuesday is that day',
  nextOccurrence('2026-08-25', 2), '2026-08-25');
check('the next Monday from a Tuesday is next week',
  nextOccurrence('2026-08-25', 1), '2026-08-31');

check('a live weekly order books its next Tuesday', due(), '2026-08-25');
check('a paused one books nothing', due({ active: false }), 'paused');
check('one that has not started yet', due({ startsOn: '2026-09-01' }), 'not-started');
check('one that has ended', due({ endsOn: '2026-08-20' }), 'ended');

/**
 * The marker is what makes the sweep idempotent and stops two collections
 * landing on one doorstep.
 *
 * With this week's Tuesday already booked the search moves to the next one,
 * which on a Monday with a three-day window is still a week out — so the honest
 * answer is "not yet", not "here is next week's date". That is the behaviour
 * that keeps the board free of orders nobody has confirmed.
 */
check('one already booked for that date does not book it again',
  due({ lastBookedFor: '2026-08-25' }), 'beyond-lead');
check('...and a wide enough window reaches the following week',
  due({ lastBookedFor: '2026-08-25', leadDays: 10 }), '2026-09-01');

/**
 * A booking that exists occupies a collection window, so materialising six
 * weeks of them would refuse real customers on behalf of hypothetical ones.
 *
 * One day of lead still reaches tomorrow's Tuesday — the window is inclusive of
 * its own last day, which is what makes "book it the day before" expressible.
 * Two days short of the next occurrence is what does not.
 */
check('a one-day window still reaches tomorrow', due({ leadDays: 1 }), '2026-08-25');
check('...but not the Tuesday after',
  due({ leadDays: 1, lastBookedFor: '2026-08-25' }), 'beyond-lead');
check('a long window lets it through', due({ leadDays: 7 }), '2026-08-25');

// An order whose next date falls after its end date stops rather than booking.
check('the last week is respected', due({ endsOn: '2026-08-24' }), 'ended');

// ---------------------------------------------------------------------------
section('branches');

const hub = (id: string, lat: number, lng: number, suburbs: string[] = []): Hub => ({
  id,
  name: id,
  address: '',
  lat,
  lng,
  suburbs,
  active: true,
  isDefault: id === 'HUB-AYEDUASE',
  createdAt: '',
});

const ayeduase = hub('HUB-AYEDUASE', 6.6625, -1.552);
const bomso = hub('HUB-BOMSO', 6.6845, -1.5802);
const inBomso = { lat: 6.6845, lng: -1.5802 };

check('the default hub is the one the constant names', defaultHub().id, 'HUB-AYEDUASE');
check('one branch takes everything', hubForPickup([ayeduase], inBomso).id, 'HUB-AYEDUASE');
check('with two, the nearest wins', hubForPickup([ayeduase, bomso], inBomso).id, 'HUB-BOMSO');

// Coverage is an operational decision somebody made deliberately; overriding it
// with arithmetic would send work to a branch that declared it does not serve
// the area.
check('a stated coverage area beats distance',
  hubForPickup([hub('HUB-A', 6.6625, -1.552, ['Bomso']), bomso], inBomso, 'Bomso').id,
  'HUB-A');
check('...and is matched case-insensitively',
  hubForPickup([hub('HUB-A', 6.6625, -1.552, ['Bomso']), bomso], inBomso, 'bomso').id,
  'HUB-A');
check('a suburb nobody claims falls back to the nearest',
  hubForPickup([hub('HUB-A', 6.6625, -1.552, ['Kotei']), bomso], inBomso, 'Bomso').id,
  'HUB-BOMSO');

// A closed branch takes nothing, and an empty list still answers — a booking
// with no branch is a booking nobody collects.
check('a closed branch is skipped',
  hubForPickup([{ ...bomso, active: false }, ayeduase], inBomso).id, 'HUB-AYEDUASE');
check('an empty list still answers', hubForPickup([], inBomso).id, 'HUB-AYEDUASE');

report();

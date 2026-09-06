/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MEMBERSHIP_PLANS,
  LOYALTY_TIERS as CORE_LOYALTY_TIERS,
  SERVICE_CATALOGUE,
  nextTierAfter as coreNextTierAfter,
  priceLabel,
  tierForPoints as coreTierForPoints,
} from '@freshfold/core';
import type {
  LoyaltyTier,
  LoyaltyTierId,
  MembershipPlanId,
  ServiceCategory,
  SubscriptionPlan,
} from '@freshfold/core';

/**
 * The catalogue as a phone shows it.
 *
 * What FreshFold sells, what each thing costs and whether it can be booked at
 * all now come from `@freshfold/core`, shared with the website and the server.
 * This file used to carry its own copy of the table *and* its own pricing
 * arithmetic, which is how the app came to quote ₵5 for a courier run the
 * server records at ₵0, and to offer `Corporate Contracts` — a conversation,
 * not a price — as a ₵30 order.
 *
 * What stays here is only what a device cares about: icon names that must exist
 * in `lucide-react-native`, photographs, a short label for places the full
 * service name will not fit, and gradient stops as hex rather than Tailwind
 * class names. The same split the website makes in `apps/web/src/data.ts`.
 */

export type { ServiceCategory } from '@freshfold/core';

interface ServicePresentation {
  /** Short label for chips and the booking summary, where the full name won't fit. */
  shortName: string;
  iconName: string;
  imageUrl: string;
}

const SERVICE_PRESENTATION: Record<string, ServicePresentation> = {
  washing: {
    shortName: 'Wash & Care',
    iconName: 'Sparkles',
    imageUrl:
      'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&q=80&w=800',
  },
  drying: {
    shortName: 'Air Dry',
    iconName: 'Wind',
    imageUrl:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSPI6SKSgSeb7TRH3tohbZVtJXr9VLQq8uyyryGaMA3AQ&s=10',
  },
  'ironing-folding': {
    shortName: 'Iron & Fold',
    iconName: 'Shirt',
    imageUrl:
      'https://images.unsplash.com/photo-1489274495757-95c7c837b101?auto=format&fit=crop&q=80&w=800',
  },
  'stain-removal': {
    shortName: 'Stain Care',
    iconName: 'Droplet',
    imageUrl:
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80&w=800',
  },
  'bedding-linens': {
    shortName: 'Linens',
    iconName: 'Bed',
    imageUrl:
      'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&q=80&w=800',
  },
  'express-laundry': {
    shortName: 'Same-Day',
    iconName: 'Zap',
    imageUrl:
      'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=800',
  },
  'pickup-delivery': {
    shortName: 'Pickup Only',
    iconName: 'Truck',
    imageUrl:
      'https://images.unsplash.com/photo-1617347454431-f49d7ff5c3b1?auto=format&fit=crop&q=80&w=800',
  },
  'car-detailing': {
    shortName: 'Car Detail',
    iconName: 'Car',
    imageUrl:
      'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&q=80&w=800',
  },
  'home-office-cleaning': {
    shortName: 'Deep Clean',
    iconName: 'House',
    imageUrl:
      'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&q=80&w=800',
  },
  'sofa-carpet-cleaning': {
    shortName: 'Upholstery',
    iconName: 'Armchair',
    imageUrl:
      'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&q=80&w=800',
  },
  corporate: {
    shortName: 'Corporate',
    iconName: 'Briefcase',
    imageUrl:
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=800',
  },
};

export interface ClientService extends ServicePresentation {
  id: string;
  name: string;
  description: string;
  /**
   * The advert, derived from the charge by `priceLabel`. Never typed by hand —
   * it used to be, and said "From ₵15 / load" over a ₵30 wash.
   */
  priceInfo: string;
  /**
   * The charge and what it buys, carried through from core.
   *
   * `priceInfo` is the English advert built from these two. The customer's
   * screens rebuild the same sentence in their own language — see
   * `servicePriceLabel` — and need the parts rather than the finished string.
   */
  price: number;
  unit: string;
  priceNote?: string;
  category: ServiceCategory;
  /**
   * Whether this can be the service on a booking.
   *
   * False for work sold only alongside something else, or quoted case by case.
   * Still shown on the home screen — it is part of what the business does — but
   * the booking form does not offer it. See {@link BOOKABLE_SERVICES}.
   */
  bookable: boolean;
}

export const SERVICES: ClientService[] = SERVICE_CATALOGUE.map((service) => ({
  id: service.id,
  name: service.name,
  description: service.description,
  priceInfo: priceLabel(service),
  price: service.price,
  unit: service.unit,
  priceNote: service.priceNote,
  category: service.category,
  bookable: service.bookable,
  ...SERVICE_PRESENTATION[service.id],
}));

/** The only services the booking form may offer. */
export const BOOKABLE_SERVICES: ClientService[] = SERVICES.filter((service) => service.bookable);

export const SERVICE_CATEGORIES: { id: ServiceCategory; label: string; blurb: string }[] = [
  { id: 'core', label: 'Everyday care', blurb: 'The weekly essentials, done properly.' },
  { id: 'specialized', label: 'Specialist', blurb: 'Fabrics and spaces that need a specific hand.' },
  { id: 'express', label: 'Express', blurb: 'When it has to be back today.' },
];

/**
 * How each plan is *presented*. What it costs and what it includes is in
 * `@freshfold/core`, and the two are joined below.
 *
 * The split matters: the price used to exist twice — once as the string on the
 * card and once as a number in a `PLAN_PRICES` map — and a plan missing from
 * the map subscribed for ₵0 while showing its full price. There is now one
 * number, the server holds the same one, and the card's `₵79` is derived from
 * it rather than typed alongside it.
 */
const PLAN_PRESENTATION: Record<
  MembershipPlanId,
  Omit<SubscriptionPlan, 'id' | 'name' | 'price' | 'billing'>
> = {
  student: {
    tagline: 'Worry-free fabric care built around class schedules.',
    iconName: 'GraduationCap',
    capacity: '20 lbs / month of laundry',
    turnaround: 'Next-day turnaround standard',
    benefits: [
      '2 scheduled pickups per month, laundry included',
      'Complimentary organic hypoallergenic soap',
      '10% member rate once the two are used',
      'Digital laundry history log',
    ],
  },
  professional: {
    tagline: 'Always-pristine formal shirts, business ensembles and suits.',
    popular: true,
    iconName: 'Briefcase',
    capacity: '45 lbs / month + 10 ironed items',
    turnaround: 'Next-day turnaround standard',
    benefits: [
      'Weekly door-side pickups — 4 a month, laundry included',
      'Complimentary delicate handwashing for custom knits',
      'Boutique hanger delivery with garment shielding',
      '15% member rate on anything beyond the four',
    ],
  },
  family: {
    tagline: 'Large bulk handling with individual-level garment separation.',
    iconName: 'House',
    capacity: '100 lbs / month of heavy cycles',
    turnaround: 'Standard 24-hour delivery',
    benefits: [
      '8 pickups/month (twice per week), laundry included',
      'Strict fabric and household division rules',
      'Free plush duvet and bed sheet washing & ironing',
      '20% member rate on anything beyond the eight',
    ],
  },
  corporate: {
    tagline: 'Custom high-frequency care for premium enterprises.',
    iconName: 'Crown',
    capacity: '200 lbs / month + customizable setups',
    turnaround: 'Same-day turnaround prioritized',
    benefits: [
      'Daily pickups — 30 a month, laundry included',
      'White-glove quality assurance reports',
      'Dedicated account manager and express stain restoration',
      '25% member rate on anything beyond the thirty',
    ],
  },
};

/** A plan card: core's commercial terms joined to this app's presentation. */
export interface ClientSubscriptionPlan extends SubscriptionPlan {
  id: MembershipPlanId;
  /** The number actually charged. `price` is this, formatted. */
  monthlyPrice: number;
  includedPickups: number;
  overageDiscount: number;
}

export const SUBSCRIPTION_PLANS: ClientSubscriptionPlan[] = MEMBERSHIP_PLANS.map((plan) => ({
  ...PLAN_PRESENTATION[plan.id],
  id: plan.id,
  name: plan.name,
  price: `₵${plan.price}`,
  billing: 'billed monthly',
  monthlyPrice: plan.price,
  includedPickups: plan.includedPickups,
  overageDiscount: plan.overageDiscount,
}));

export function clientPlan(id: string | undefined | null): ClientSubscriptionPlan | null {
  if (!id) return null;
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === id) ?? null;
}

/**
 * Loyalty tiers, dressed for a phone.
 *
 * The tiers themselves — names, thresholds, discounts, benefits — come from
 * `@freshfold/core` and are shared with the website and the server. This file
 * used to declare its own array, which is how the app came to put Silver at 500
 * points while the website's client portal put it at 400: the same customer,
 * two tiers, depending on which screen they were looking at.
 *
 * What stays local is only presentation. The website expresses a card's
 * gradient as Tailwind class names, which mean nothing to React Native, so the
 * same visual intent is a pair of hex stops here.
 */
interface TierPalette {
  gradient: [string, string];
  textColor: string;
  accent: string;
}

const TIER_PALETTE: Record<LoyaltyTierId, TierPalette> = {
  basic: { gradient: ['#2E2B26', '#171613'], textColor: '#D6D1C7', accent: '#8C8577' },
  silver: { gradient: ['#4A4E55', '#1E2024'], textColor: '#F1F1EE', accent: '#B9BEC4' },
  gold: { gradient: ['#8A6A2E', '#312410'], textColor: '#F6EBD6', accent: '#E2C489' },
};

export type ClientLoyaltyTier = LoyaltyTier & TierPalette;

function dress(tier: LoyaltyTier): ClientLoyaltyTier {
  return { ...tier, ...TIER_PALETTE[tier.id] };
}

export const LOYALTY_TIERS: ClientLoyaltyTier[] = CORE_LOYALTY_TIERS.map(dress);

/** The highest tier the given lifetime points qualify for. */
export function tierForPoints(points: number): ClientLoyaltyTier {
  return dress(coreTierForPoints(points));
}

/** The next tier up, or `null` at the top. */
export function nextTierAfter(tier: ClientLoyaltyTier): ClientLoyaltyTier | null {
  const next = coreNextTierAfter(tier);
  return next ? dress(next) : null;
}

/*
 * `TESTIMONIALS` used to be here, and is gone.
 *
 * Three invented people — Seraphina Kensington, Jonathan Reynolds of "Reynolds
 * Asset Management", Aurelia Vance — with five stars each and stock Unsplash
 * portraits of real strangers standing in as their photographs. One of them
 * praised a "locker drop" the shop has never offered; another described Italian
 * cottons being sanitised with natural scenting, which is not a service in
 * `./services`.
 *
 * `PRODUCT.md` names the invented testimonial roster as an anti-reference and
 * requires that nothing be claimed the business cannot substantiate. The web
 * landing was cleaned of it; this file was missed, and the entries were then
 * translated into Spanish and French, which made the fiction more expensive to
 * keep rather than less.
 *
 * Nothing replaces it until there are real quotes from real customers who
 * agreed to be quoted. A section with three honest sentences beats one with
 * nine invented ones, and an empty space beats both.
 */

// ---------------------------------------------------------------------------
// Booking options
// ---------------------------------------------------------------------------

/**
 * The finish, the add-ons and the arithmetic, straight from core.
 *
 * All of this was declared here and it was a second opinion on what a booking
 * costs. The local `priceBreakdown` decided the base price from a cascade of
 * `serviceName.includes(…)` tests and the finish surcharge from a blacklist of
 * three service names, so anything it had not heard of was treated as a garment
 * — `Fast Pickup & Delivery` was quoted at ₵5 for a scent, against the ₵0 the
 * server records for it. Re-exported rather than removed so the screens keep
 * importing the catalogue for catalogue things.
 */
export {
  DEFAULT_SCENT,
  DEFAULT_STARCH,
  DELIVERY_TIME_SLOTS,
  PICKUP_TIME_SLOTS,
  SCENTS,
  SPECIALTY_ADDONS,
  STARCH_LEVELS,
  deliverySlotsFor,
  isGarmentService,
  taxOn,
  isPlanCoverable,
  priceBreakdown,
  rescheduledDelivery,
} from '@freshfold/core';

export type {
  BookingSelections,
  FinishOption,
  PriceBreakdown,
  SpecialtyAddon,
} from '@freshfold/core';

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export type PaymentChoice =
  | 'Paystack'
  | 'MTN MoMo'
  | 'Telecel Cash'
  | 'AT Money'
  | 'Card'
  | 'Wallet'
  | 'Pay on Pickup';

export const PAYMENT_METHODS: {
  id: PaymentChoice;
  label: string;
  blurb: string;
  iconName: string;
}[] = [
  {
    id: 'Paystack',
    label: 'Paystack checkout',
    blurb: 'Card, bank or mobile money via the secure hosted page.',
    iconName: 'ShieldCheck',
  },
  {
    id: 'Wallet',
    label: 'FreshFold wallet',
    blurb: 'Settle instantly from your stored balance.',
    iconName: 'Wallet',
  },
  {
    id: 'Pay on Pickup',
    label: 'Pay on pickup',
    blurb: 'Settle with the courier at the door.',
    iconName: 'Banknote',
  },
];

/** Networks that mean "send a mobile-money prompt", and the tag stored on the job. */
export const MOMO_NETWORKS: Partial<Record<PaymentChoice, 'MTN' | 'Telecel' | 'AT'>> = {
  'MTN MoMo': 'MTN',
  'Telecel Cash': 'Telecel',
  'AT Money': 'AT',
};

// ---------------------------------------------------------------------------
// Static marketing copy
// ---------------------------------------------------------------------------

export const HOW_IT_WORKS = [
  {
    id: 'schedule',
    title: 'Schedule',
    body: 'Pick a service, a window and an address. A quote is priced before you commit.',
    iconName: 'CalendarClock',
  },
  {
    id: 'collect',
    title: 'We collect',
    body: 'A courier arrives in your window, scans each bag onto the manifest and heads for the hub.',
    iconName: 'Bike',
  },
  {
    id: 'care',
    title: 'Artisan care',
    body: 'Sorted, treated, washed at fabric-appropriate temperatures, then hand-pressed.',
    iconName: 'Sparkles',
  },
  {
    id: 'return',
    title: 'Returned',
    body: 'Back at your door, folded or on hangers, with proof of delivery in the app.',
    iconName: 'PackageCheck',
  },
];

export const WHY_CHOOSE_US = [
  {
    id: 'tracking',
    title: 'Watch it happen',
    body: 'The courier’s real position, the stage your garments are in, the exact minute of arrival.',
    iconName: 'Radar',
  },
  {
    id: 'fabric',
    title: 'Fabric-first',
    body: 'Temperature, agitation and finish chosen per garment, not per load.',
    iconName: 'Shirt',
  },
  {
    id: 'eco',
    title: 'Gentle chemistry',
    body: 'Enzyme stain treatment and plant-derived detergents. Hypoallergenic on request.',
    iconName: 'Leaf',
  },
  {
    id: 'guarantee',
    title: 'Care guarantee',
    body: 'Anything not right gets re-treated at our cost. Report it from the order screen.',
    iconName: 'BadgeCheck',
  },
];

export const CUSTOMER_SEGMENTS = [
  {
    id: 'students',
    title: 'Students',
    body: 'Hostel pickups across Ayeduase, Kotei and campus halls, priced for a term budget.',
    serviceId: 'washing',
    iconName: 'GraduationCap',
  },
  {
    id: 'executives',
    title: 'Executives',
    body: 'Shirts pressed to a standard you can wear into a board room, back by morning.',
    serviceId: 'ironing-folding',
    iconName: 'Briefcase',
  },
  {
    id: 'homes',
    title: 'Homes & families',
    body: 'Bulk cycles with household separation, plus linens, upholstery and deep cleans.',
    serviceId: 'bedding-linens',
    iconName: 'House',
  },
  {
    id: 'business',
    title: 'Hotels & spas',
    body: 'Contract volumes with a named account manager and quality-assurance reporting.',
    serviceId: 'corporate',
    iconName: 'Building2',
  },
];

export const CONTACT = {
  phone: '+233 200957165',
  // Unused while the WhatsApp entry points are hidden; kept so they can be
  // switched back on without hunting for the number again.
  whatsapp: '233200957165',
  email: 'laundry.freshfold1@gmail.com',
  hours: 'Mon–Sat 07:00–21:00 · Sun 10:00–18:00',
  address: 'Wagyingo Opal, Ayeduase-Kotei, beside the Benab filling station',
};

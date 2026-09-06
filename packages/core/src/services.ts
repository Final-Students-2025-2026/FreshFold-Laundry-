/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What FreshFold sells, and what each thing costs.
 *
 * The price used to be written twice per service and the two were not the same
 * number. A marketing string sat on the catalogue card — `'From ₵15 / load'` —
 * and the charge came from a separate cascade of `serviceType.includes(…)`
 * branches in the pricing module. Six of the eleven services disagreed:
 *
 *  - Washing advertised ₵15 and charged ₵30.
 *  - Ironing & Folding advertised ₵3.50 an item and charged ₵25 an order.
 *  - Bed Sheets & Linens advertised ₵25 and charged ₵45.
 *  - Gentle Air drying advertised *"Included with Wash"* and charged ₵25 to
 *    anyone who booked it on its own.
 *  - Corporate Contracts advertised "Custom Enterprise Quotes" and charged ₵25,
 *    which is not what an enterprise contract costs and never was.
 *
 * The last two were not mispriced so much as not bookable: drying is part of a
 * wash and a corporate contract is a conversation. Both are `bookable: false`
 * here and neither appears in a booking form, because a ₵25 order for work
 * nobody agreed to do is worse than an advert that is merely wrong.
 *
 * One number per service now, and {@link priceLabel} derives the advert from
 * it, so the card and the checkout cannot drift apart again.
 *
 * Presentation is deliberately absent — no icons, no images. Those differ per
 * surface (`lucide-react` against `lucide-react-native`, hex against Tailwind)
 * and each app joins its own to this table.
 */

import type { BookingItem } from './types';

export type ServiceCategory = 'core' | 'specialized' | 'express';

export interface ServiceDefinition {
  id: string;
  /**
   * The label the customer picks, and the exact string a booking stores in
   * `serviceType`. Changing it changes what every existing booking is worth —
   * see the legacy note on `basePriceFor`.
   */
  name: string;
  description: string;
  category: ServiceCategory;
  /**
   * What a booking for this service is charged, before finishes and add-ons.
   * The one place this number is written down.
   */
  price: number;
  /** What that price buys: a load, a set, a ride. Builds the advert. */
  unit: string;
  /**
   * Whether a fabric finish — scent, starch — means anything here.
   *
   * A car, a sofa and an office do not take one. Neither does a bare courier
   * run: `Fast Pickup & Delivery` advertises "Complimentary" and was quoting ₵5,
   * because the finish pickers applied to anything that was not on the old
   * blacklist of three, and moving a bag is not garment care. Stated per service
   * rather than inferred from the name, which is how that was missed.
   */
  garment: boolean;
  /**
   * Whether this can be the service on a booking.
   *
   * False for work that is only ever sold alongside something else, or that is
   * quoted rather than priced. A non-bookable service is still shown on the
   * marketing pages — it is part of what the business does — it just cannot be
   * turned into an order at a price nobody quoted.
   */
  bookable: boolean;
  /**
   * Replaces the derived advert where a number is the wrong answer: work that
   * is bundled into another service, or quoted case by case.
   */
  priceNote?: string;
}

export const SERVICE_CATALOGUE: ServiceDefinition[] = [
  {
    id: 'washing',
    garment: true,
    name: 'Washing (Machine & Hand Wash)',
    description:
      'Machine or hand wash, whichever the fabric asks for. Sorted by colour and weight, and your load runs on its own.',
    category: 'core',
    price: 30,
    unit: 'load',
    bookable: true,
  },
  {
    id: 'drying',
    garment: true,
    name: 'Gentle Air drying',
    description:
      'Low heat, so nothing shrinks and nothing sets. Part of every wash rather than a line you pay for.',
    category: 'core',
    price: 0,
    unit: 'load',
    bookable: false,
    priceNote: 'Included with Wash',
  },
  {
    id: 'ironing-folding',
    garment: true,
    name: 'Ironing & Folding',
    description:
      'Pressed and folded flat, or returned on hangers if you say so. Shirts, trousers, uniforms and dresses.',
    category: 'core',
    price: 25,
    unit: 'order',
    bookable: true,
  },
  {
    id: 'stain-removal',
    garment: true,
    name: 'Advanced Stain Removal',
    description:
      'Spot treatment for oil, ink, sweat marks and drink stains. If it does not lift first time it goes back through.',
    category: 'specialized',
    price: 25,
    unit: 'order',
    bookable: true,
  },
  {
    id: 'bedding-linens',
    garment: true,
    name: 'Bed Sheets & Linens Care',
    description:
      'Sheets, duvet covers, pillowcases and towels washed hot and pressed. Priced by the set, not by the item.',
    category: 'specialized',
    price: 45,
    unit: 'set',
    bookable: true,
  },
  {
    id: 'express-laundry',
    garment: true,
    name: 'Express Same-Day Laundry',
    description:
      'Collected by 9:00 in the morning, back at your door by 19:30 the same evening. For when the next day is too late.',
    category: 'express',
    price: 50,
    unit: 'order',
    bookable: true,
  },
  {
    id: 'pickup-delivery',
    garment: false,
    name: 'Fast Pickup & Delivery',
    description:
      'A rider comes to your door and brings it back to your door, in the window you picked. Free on every order.',
    category: 'express',
    price: 0,
    unit: 'order',
    bookable: true,
    priceNote: 'Complimentary',
  },
  {
    id: 'car-detailing',
    garment: false,
    name: 'Bespoke Car Detailing',
    description:
      'Washed, waxed and sealed outside; seats, mats and dashboard cleaned inside. Priced per vehicle.',
    category: 'specialized',
    price: 150,
    unit: 'ride',
    bookable: true,
  },
  {
    id: 'home-office-cleaning',
    garment: false,
    name: 'Home & Office Cleaning',
    description:
      'A full clean of a room, a flat or an office — floors, surfaces, bathroom and kitchen. Priced per space.',
    category: 'specialized',
    price: 180,
    unit: 'space',
    bookable: true,
  },
  {
    id: 'sofa-carpet-cleaning',
    garment: false,
    name: 'Sofa & Carpet Cleaning',
    description:
      'Hot-water extraction for sofas, armchairs and rugs. Lifts the stain and the smell that came with it.',
    category: 'specialized',
    price: 90,
    unit: 'unit',
    bookable: true,
  },
  {
    id: 'corporate',
    garment: false,
    name: 'Corporate Contracts',
    description:
      'Standing collections for salons, guest houses, gyms, clinics and offices. Quoted against what you actually go through in a week.',
    category: 'specialized',
    price: 0,
    unit: 'contract',
    bookable: false,
    priceNote: 'Custom Enterprise Quotes',
  },
];

/** The services a booking form may offer. */
export const BOOKABLE_SERVICES = SERVICE_CATALOGUE.filter((service) => service.bookable);

export function serviceById(id: string): ServiceDefinition | null {
  return SERVICE_CATALOGUE.find((service) => service.id === id) ?? null;
}

/** By the exact `serviceType` string a booking carries. */
export function serviceByName(name: string): ServiceDefinition | null {
  const wanted = (name ?? '').trim();
  return SERVICE_CATALOGUE.find((service) => service.name === wanted) ?? null;
}

/**
 * The advert, derived from the charge.
 *
 * Every card on every surface renders this rather than a string somebody typed
 * next to the price, which is the whole point of the table.
 */
/**
 * Units that mean "one order however much there is of it".
 *
 * The counted units — load, set, ride, space, unit — each name a thing the
 * customer can have several of, and the price is per one of them. These two do
 * not: an order is the order, and a contract is negotiated rather than counted.
 *
 * Stated as the *exclusions* deliberately. A service added tomorrow with a unit
 * nobody has thought about — `basket`, `rug`, `visit` — is countable by default,
 * so the booking form asks how many and the customer is billed for what they
 * have. The opposite default fails silently and in the laundry's favour, which
 * is the bug this whole mechanism exists to fix: eleven services advertised
 * "from ₵30 / load" and every one of them billed a single load however many
 * turned up at the door.
 */
const UNCOUNTED_UNITS = new Set(['order', 'contract']);

/**
 * The most of one service a booking may ask for.
 *
 * A ceiling rather than a limit anybody will meet: forty loads is a hall of
 * residence, not a customer, and past that it is a conversation with the desk
 * rather than a form. It exists because the number arrives off the wire and
 * multiplies a price — without it, a crafted request quotes a booking at
 * whatever it likes, and `priorityForBooking` reads that number too.
 */
export const MAX_QUANTITY = 40;

/**
 * What one of this service buys, as a word: `load`, `set`, `ride`.
 *
 * Falls back to `order` for a name we do not recognise, which pairs with
 * `serviceTakesQuantity` returning false for the same input — an unknown service
 * is one order of something, and the form does not offer to count it.
 */
export function serviceUnit(serviceType: string): string {
  return serviceByName(serviceType ?? '')?.unit ?? 'order';
}

/** Whether this service is priced per countable thing. */
export function isCountableUnit(unit: string): boolean {
  return !UNCOUNTED_UNITS.has(unit.trim().toLowerCase());
}

/**
 * Whether the booking forms should ask "how many?" for this service.
 *
 * Takes the service *name*, which is what a booking stores, so callers do not
 * have to resolve the definition first. A name we do not recognise is not
 * countable — an unknown service is already falling back to `DEFAULT_BASE_PRICE`
 * and multiplying a guess is worse than charging it once.
 */
export function serviceTakesQuantity(serviceType: string): boolean {
  const service = serviceByName(serviceType ?? '');
  return service ? isCountableUnit(service.unit) : false;
}

/**
 * A quantity that can be trusted: a whole number, at least one, at most
 * {@link MAX_QUANTITY}, and always 1 for a service that is not counted.
 *
 * Every path that prices a booking runs the incoming number through this — the
 * two forms so the customer cannot type their way past the ceiling, and the
 * server because the forms are not the only thing that can post a booking.
 */
export function clampQuantity(quantity: unknown, serviceType: string): number {
  if (!serviceTakesQuantity(serviceType)) return 1;
  const n = typeof quantity === 'number' ? quantity : Number(quantity);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, Math.floor(n)));
}

/**
 * The most services one order may carry.
 *
 * A collection is one courier at one door with one vehicle. Six lines is
 * already more than the menu has garment services on it, and an order past that
 * is a contract rather than a booking.
 */
export const MAX_ITEMS = 6;

/**
 * The lines on a booking, whichever shape it arrived in.
 *
 * Every caller that prices, counts or displays an order goes through this
 * instead of reading `items` directly. Two shapes reach it and both are normal:
 * a booking with `items`, and one from before line items existed — or from a
 * client that has not been updated — which is a single line described by
 * `serviceType` and `quantity`.
 *
 * Quantities are clamped on the way out, so nothing downstream has to decide
 * what a line asking for 0.5 loads means.
 */
export function bookingItems(
  booking: { items?: BookingItem[]; serviceType?: string; quantity?: number }
): BookingItem[] {
  const listed = (booking.items ?? [])
    .filter((item) => item && typeof item.serviceType === 'string' && item.serviceType.trim())
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      serviceType: item.serviceType,
      quantity: clampQuantity(item.quantity, item.serviceType),
    }));

  if (listed.length > 0) return listed;

  const serviceType = booking.serviceType ?? '';
  if (!serviceType.trim()) return [];

  return [{ serviceType, quantity: clampQuantity(booking.quantity, serviceType) }];
}

/**
 * How many countable things an order is for, across every line.
 *
 * A per-order line counts as one: an ironing order is one thing to collect even
 * though nobody counted it.
 *
 * The bag manifest does *not* follow this — it follows {@link baggedUnits},
 * which leaves those lines out. The difference is the one between what an order
 * is worth and what turns up at the door.
 */
export function totalUnits(items: BookingItem[]): number {
  return items.reduce((total, item) => total + Math.max(1, item.quantity), 0);
}

/**
 * How many bags an order's lines actually put on the courier's manifest.
 *
 * Deliberately not {@link totalUnits}, which counts a per-order line as one
 * thing to collect. That is right for pricing and wrong for luggage: a per-order
 * service is work done *to* the laundry rather than a parcel handed over beside
 * it. Express Same-Day is a turnaround promise about bags that already exist,
 * ironing is work performed on the clothes inside one, and Fast Pickup &
 * Delivery is the courier's own ride.
 *
 * Counting them produced a phantom bag and then labelled it with the service
 * that caused it — so a customer who added same-day service to two loads of
 * washing was shown a three-bag manifest with a bag called "Express Same-Day
 * Laundry" on it, and a courier at the door had a third tag to look for that was
 * never going to exist. The charge belongs on the bill, which is where
 * `priceBreakdown` has always put it, and where it stays.
 *
 * Never zero. An order whose only line is per-order — ironing on its own — is
 * still a bag of clothes arriving; it is just a bag nobody has counted yet.
 */
export function baggedUnits(items: BookingItem[]): number {
  const counted = items
    .filter((item) => isCountableUnit(serviceUnit(item.serviceType)))
    .reduce((total, item) => total + Math.max(1, item.quantity), 0);

  return Math.max(1, counted);
}

/**
 * The order's services in one line: `2 loads · Washing + 1 set · Bed Sheets`.
 *
 * Every staff-facing surface needs this same sentence and each of them was
 * writing `job.service.type` instead — which names the *first* service. A
 * courier sent for two loads of washing and a set of bed linen read "Washing
 * (Machine & Hand Wash), 3 bags": the count was right and the description named
 * half the job, which is the kind of wrong that only shows up at the door.
 *
 * English, deliberately. The rider console, the desk board and the confirmation
 * email are all English surfaces — the customer app translates its own copy
 * through `unitLabel` instead, because that is the one place a customer reads
 * it.
 *
 * A single-service order comes back as just its name, with no count, so the
 * ordinary case reads exactly as it did before this existed.
 */
export function describeItems(
  booking: { items?: BookingItem[]; serviceType?: string; quantity?: number }
): string {
  const items = bookingItems(booking);
  if (items.length === 0) return '';

  const parts = items.map((item) => {
    // A per-order service has no count worth printing — "1 order · Ironing" is
    // noise where "Ironing" is the whole fact.
    if (!isCountableUnit(serviceUnit(item.serviceType)) || item.quantity <= 1) {
      return item.serviceType;
    }
    return `${item.quantity} ${pluraliseUnit(serviceUnit(item.serviceType), item.quantity)} · ${item.serviceType}`;
  });

  return parts.join(' + ');
}

/** `load` -> `loads`. Naive on purpose: every unit we ship takes a plain `s`. */
export function pluraliseUnit(unit: string, quantity: number): string {
  return quantity === 1 ? unit : `${unit}s`;
}

export function priceLabel(service: ServiceDefinition): string {
  if (service.priceNote) return service.priceNote;
  return `From ₵${service.price} / ${service.unit}`;
}

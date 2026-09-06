/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LAUNDRY_HUB,
  LAUNDRY_HUB_ADDRESS,
  coordsForAddress,
  distanceKm,
  isOutsideServiceArea,
} from './geo';
import { baggedUnits, bookingItems, describeItems, isCountableUnit, serviceUnit } from './services';
import { fromBookingStatus, toBookingStatus } from './status';
import type {
  Booking,
  BookingItem,
  BookingRiderView,
  Coords,
  Job,
  JobStatus,
  LaundryBag,
  Order,
  OrderPriority,
  RiderState,
} from './types';

/**
 * Projections between the canonical {@link Job} and the two views the apps
 * already speak. Everything crossing the wire between web, server and rider
 * app goes through one of these functions, so the two products can keep their
 * own vocabulary without the data drifting apart.
 */

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/**
 * The Web Crypto global, or undefined where there isn't one.
 *
 * `crypto.getRandomValues` rather than `node:crypto`'s `randomInt`, which is
 * the obvious reach and the wrong one here: this module is bundled into the
 * website and both React Native apps as well as the server, and a `node:`
 * import fails to resolve in Vite and Metro whether or not the function behind
 * it is ever called. The Web Crypto global is present in Node 20 — which this
 * repo already requires — and in every browser, and is the one spelling that
 * satisfies all three without a build alias.
 *
 * Typed by hand because this package compiles with `lib: ["ES2022"]` and no
 * DOM. Declaring the single method used is narrower than pulling the whole DOM
 * lib in for it.
 */
type WebCrypto = { getRandomValues?: <T extends Uint32Array>(array: T) => T };

/**
 * Looked up per call rather than captured once at module load.
 *
 * A React Native polyfill is installed by an import, and module initialisation
 * order decides whether it has run by the time this file is evaluated. Reading
 * the global when the value is actually wanted means a polyfill that lands
 * later still counts, instead of this module having decided at startup that
 * there was no CSPRNG and quietly meaning it forever. The cost is one property
 * access against a function that is already doing real work.
 */
function webCrypto(): WebCrypto | undefined {
  return (globalThis as { crypto?: WebCrypto }).crypto;
}

/**
 * A uniform integer in `[min, max)` from the platform CSPRNG, or null if there
 * isn't one.
 *
 * Rejection sampling rather than `value % range`. A modulo leans towards the
 * low end of the range whenever the range does not divide 2^32 evenly, and for
 * a four-digit code that lean is measurable — which would undo most of the
 * point of drawing the code from a CSPRNG in the first place. Anything at or
 * above the largest clean multiple is thrown away and redrawn; the expected
 * number of extra draws is far below one.
 */
function fromCsprng(min: number, max: number): number | null {
  const source = webCrypto();
  if (!source?.getRandomValues) return null;

  const range = max - min;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buffer = new Uint32Array(1);

  let value: number;
  do {
    source.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);

  return min + (value % range);
}

/**
 * For values that are secrets. Refuses to run without a CSPRNG.
 *
 * There is deliberately no fallback. A hand-off code quietly minted from
 * `Math.random` is the bug this replaced — it looks identical in the database,
 * on the customer's screen and in the courier's app, and nothing about the
 * system would tell anybody it had happened. Failing loudly is the only
 * behaviour that cannot be mistaken for working.
 *
 * The throw is unreachable on the only path that calls it: hand-off codes are
 * minted by `bookingToJob` and `orderToJob`, and both are server-only.
 */
function secretInt(min: number, max: number): number {
  const value = fromCsprng(min, max);

  if (value === null) {
    throw new Error(
      'No secure random source on this platform. @freshfold/core mints hand-off codes here and ' +
        'will not fall back to Math.random for them — install a crypto.getRandomValues polyfill.'
    );
  }

  return value;
}

/**
 * For values that are not secrets, and must never fail to produce one.
 *
 * The distinction from {@link secretInt} is the whole design. A booking id is
 * not a credential — it stopped being one when `resolveBookingAccess` started
 * gating every read of a booking and answering 404 to a caller with no claim —
 * so the cost of an unpredictable id is collision resistance rather than
 * secrecy, and a customer who cannot start a booking because their phone has no
 * Web Crypto is a worse outcome than a guessable reference.
 *
 * React Native is why that branch exists: the booking forms in both apps call
 * `newJobId` to seed a form, and RN 0.81 ships no `crypto.getRandomValues`
 * without a polyfill. This uses the real thing on the server and in the
 * browser, and the fallback only where there is nothing better.
 */
function looseInt(min: number, max: number): number {
  return fromCsprng(min, max) ?? min + Math.floor(Math.random() * (max - min));
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export function newJobId(): string {
  return `FFC-${looseInt(100000, 1000000)}`;
}

// ---------------------------------------------------------------------------
// Hand-off codes
// ---------------------------------------------------------------------------

/**
 * Hand-off codes, one for every point the bags change hands.
 *
 * Three legs, three codes: the customer's door on the way out, the laundry hub
 * in the middle, the customer's door on the way back. The party *receiving*
 * the bags holds the code and the party delivering them has to produce it,
 * which is what makes each one worth checking.
 *
 * The customer's screens show a four-digit code; the courier scans or types it
 * before the bags change hands. It proves two things at once — that the
 * courier is at the right door, and that the person handing the bags over is
 * the one who booked the job.
 *
 * Unlike the bag manifest, this is *not* derived from the job id. A code you
 * can compute from a reference printed on a bag tag would verify nothing, so
 * it is minted randomly when the job is created and kept for the job's life.
 *
 * The delivery code used to be the constant `7809` for every job in the
 * system, which is the same as having no code: the courier's app knew it, the
 * "request OTP" button sent it to the customer, and the error message printed
 * it. Both ends are minted the same way now.
 *
 * And that way is a CSPRNG. This drew from `Math.random` until recently, which
 * V8 implements as xorshift128+ — not a cryptographic generator, and one whose
 * 128-bit state is recoverable from a handful of consecutive outputs. Creating
 * one booking took four values from that stream, one job id and these three
 * codes, and the customer who booked it legitimately received all four: book a
 * few orders, recover the state, and predict the delivery code a courier is
 * about to be read at somebody else's front door. The id no longer shares the
 * stream either — see {@link looseInt}.
 */
export function newHandoffCode(): string {
  return String(secretInt(1000, 10000));
}

/** Bumped if the payload shape ever changes, so old QRs fail loudly. */
export const HANDOFF_PAYLOAD_VERSION = 'FFH1';

export type HandoffLeg = 'pickup' | 'dropoff' | 'delivery';

export interface HandoffPayload {
  jobId: string;
  leg: HandoffLeg;
  code: string;
}

/**
 * What the QR encodes: `FFH1|FFC-780145|pickup|4821`.
 *
 * The job id travels with the code deliberately. Without it a courier could
 * scan the QR of whoever happened to be standing nearby and have it accepted
 * against the job they are actually on.
 */
export function buildHandoffPayload(jobId: string, leg: HandoffLeg, code: string): string {
  return [HANDOFF_PAYLOAD_VERSION, jobId, leg, code].join('|');
}

/** Returns `null` for anything that is not one of our hand-off QRs. */
export function parseHandoffPayload(text: string): HandoffPayload | null {
  const parts = text.trim().split('|');
  if (parts.length !== 4) return null;

  const [version, jobId, leg, code] = parts;
  if (version !== HANDOFF_PAYLOAD_VERSION) return null;
  if (leg !== 'pickup' && leg !== 'dropoff' && leg !== 'delivery') return null;
  if (!jobId || !code) return null;

  return { jobId, leg, code };
}

/**
 * Whether what the courier scanned or typed unlocks this job's collection.
 *
 * Accepts either the bare digits (typed by hand when a camera will not
 * cooperate) or a full scanned payload, and in the payload case insists the
 * job id matches — see {@link buildHandoffPayload}.
 */
export function verifyHandoff(
  input: string,
  expected: { jobId: string; leg: HandoffLeg; code?: string }
): boolean {
  if (!expected.code) return false;

  const scanned = parseHandoffPayload(input);
  if (scanned) {
    return (
      scanned.jobId === expected.jobId &&
      scanned.leg === expected.leg &&
      scanned.code === expected.code
    );
  }

  return input.trim() === expected.code;
}

/** `FFC-882049` + elite -> `FF-882049-ELITE` */
export function referenceFor(id: string, priority: OrderPriority): string {
  const digits = id.replace(/\D/g, '') || '000000';
  return `FF-${digits}-${priority.toUpperCase()}`;
}

/**
 * The manifest the courier checks off, one bag per thing the customer ordered.
 *
 * It used to be `Math.ceil(amount / 50)` capped at three — the order's *value*
 * standing in for a count, because a booking had no count to give. That made
 * the manifest wrong in both directions: a ₵180 office clean produced three
 * bags for a job with no bags in it, and ten loads of washing produced three
 * as well, so a courier checked off three, found ten at the door, and had
 * nothing to scan the rest against.
 *
 * Now the lines say. One bag per counted unit — a load is roughly a bag of
 * laundry, which is what makes the mapping honest — summed across the services
 * that are actually carried, so "two loads and a set of linen" is three bags.
 *
 * Services sold per *order* are not carried and do not appear here; see
 * `baggedUnits`. Express Same-Day is the clearest case: it is a promise about
 * how fast the same bags come back, and counting it produced a fourth bag
 * labelled with the promise.
 *
 * Still deterministic from the job id, so the same booking always yields the
 * same codes and a replayed offline write does not invalidate a tag the courier
 * is already holding.
 *
 * `MAX_BAGS` is a ceiling on the manifest rather than on the order: past it the
 * job is still priced for everything, the courier just gets a list they can
 * realistically scan. It sits above what `MAX_QUANTITY` allows on one line, so
 * only a genuinely large multi-service order reaches it.
 */
export const MAX_BAGS = 40;

export function bagsForJob(
  id: string,
  booking: { items?: BookingItem[]; serviceType?: string; quantity?: number },
  /**
   * The service to label the first bag with, when the caller has one to hand.
   * Defaults to the first line's, which is what it always is in practice.
   */
  serviceType?: string
): LaundryBag[] {
  const digits = id.replace(/\D/g, '') || '000000';
  const items = bookingItems(booking);
  const count = Math.min(MAX_BAGS, baggedUnits(items));

  // Which service each bag belongs to, so a mixed order's manifest says which
  // bag is the bed linen rather than calling everything "Premium Textiles".
  //
  // Per-order lines are skipped here on the same rule `baggedUnits` counts by,
  // and skipping them is the visible half of it: they produced no bag, so there
  // is no bag for them to name. An order of two loads plus same-day service is
  // two bags of washing, not three bags one of which is a promise.
  const labels: string[] = [];
  for (const item of items) {
    if (!isCountableUnit(serviceUnit(item.serviceType))) continue;
    for (let n = 0; n < item.quantity && labels.length < count; n += 1) {
      labels.push(item.serviceType);
    }
  }

  return Array.from({ length: count }, (_, i) => {
    // A, B … Z, then AA, AB — the old single letter ran out at 26.
    const suffix = bagSuffix(i);
    return {
      id: `BAG-${digits}-${suffix}`,
      type: labels[i] || serviceType || items[0]?.serviceType || 'Premium Textiles',
      /**
       * No weight and no count. Both used to be here, and both were fiction.
       *
       * `weight` was `2 + (charCodeAt(i) % 40) / 10` and `itemCount` was
       * `3 + ((charCodeAt(i + 2) + i) % 8)` — two hashes of the job id, dressed
       * as measurements and shown to the customer on their bag manifest. A
       * customer disputing a missing garment was arguing against a number
       * derived from their own reference number.
       *
       * A bag is a label until somebody at the hub weighs and counts it; see
       * `POST /orders/:id/intake`. Leaving these undefined is what lets every
       * surface say "not counted yet" rather than print a number nobody stands
       * behind.
       */
      qrCode: `FF-BAG-${digits}-${suffix}`,
      scanned: false,
    };
  });
}

/** `0` -> `A`, `25` -> `Z`, `26` -> `AA`. Spreadsheet columns, essentially. */
function bagSuffix(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * What a booking is worth, at ₵45, above which a guest order is worked before
 * the ordinary ones.
 *
 * One load of washing with a scent is ₵35 and lands below it; two loads, or any
 * of the specialist services, land above. That split was chosen when a booking
 * was a single unit and it still holds, because it is a question about the size
 * of one job rather than about the range of them.
 */
export const PRIORITY_THRESHOLD = 45;

/**
 * Where a job sits in the queue.
 *
 * **`elite` is a membership benefit and nothing else buys it.** The plans screen
 * sells "included pickups and elite priority", and for a while a guest reached
 * the same tier by ordering three loads: `amount >= 80` was written when a
 * booking was one unit and ₵80 meant a large single job, but once an order could
 * carry a quantity, three loads of ordinary washing came to ₵105 and every
 * multi-unit order in the system was elite. A tier everybody is in is not a
 * tier, and a paid entitlement everybody gets for free is not an entitlement.
 *
 * So value still orders guests against each other — a ₵150 car detail is worked
 * before a ₵35 wash — but it stops at `priority`. The consequence is worth
 * stating: a very large guest order now sits behind a member's single load.
 * That is the membership doing what it is sold as doing.
 */
export function priorityForBooking(amount: number, planId?: string): OrderPriority {
  if (planId) return 'elite';
  if (amount >= PRIORITY_THRESHOLD) return 'priority';
  return 'standard';
}

// ---------------------------------------------------------------------------
// Booking (web) -> Job
// ---------------------------------------------------------------------------

/**
 * Where the courier is actually sent.
 *
 * A pin the customer placed themselves wins. Everything else falls back to
 * `coordsForAddress`, which hashes the typed address into a stable offset from
 * the suburb's anchor — the same point on every screen, but not a point
 * anybody lives at: "Evandy Hostel, Room 12" lands some 400 m from Evandy
 * Hostel, and dropping the comma moves it 300 m again. Fine as a placeholder
 * on a map, useless as a doorstep, which is why the customer's own pin exists.
 *
 * A pin outside the Kumasi service area is not a pin, it is a bad fix or a
 * bad caller, and the derived point is the safer answer.
 */
export function pickupPinFor(
  booking: Pick<Booking, 'address' | 'suburb' | 'pickupCoords'>
): Coords {
  const pinned = booking.pickupCoords;
  if (pinned && !isOutsideServiceArea(pinned)) return { lat: pinned.lat, lng: pinned.lng };
  return coordsForAddress(booking.address, booking.suburb);
}

/**
 * Builds the canonical record from a booking submitted on the website. The
 * dispatch half — coordinates, bags, distance, priority — is derived here
 * rather than asked of the customer, which is what lets a booking show up on
 * the rider's board without anybody re-keying it.
 */
export function bookingToJob(
  booking: Booking,
  now = new Date().toISOString(),
  /**
   * The branch this collection goes to.
   *
   * Defaults to `LAUNDRY_HUB`, which is what every job in the ledger was
   * measured against and what a single-branch laundry still measures against —
   * so a caller that does not pass one gets exactly the behaviour that existed
   * before hubs were a table. The server passes the hub `hubForPickup` chose.
   *
   * It matters because `distanceKm` here feeds `priorityForBooking` and the
   * courier's job card: measuring a Bomso collection against an Ayeduase hub
   * once there are two branches would misprice the ride and mis-sort the board.
   */
  hub: Coords = LAUNDRY_HUB
): Job {
  const id = booking.id || newJobId();
  const amount = booking.amount ?? 0;
  const priority = priorityForBooking(amount, booking.planId);
  const pickupCoords = pickupPinFor(booking);
  const distance = distanceKm(hub, pickupCoords);

  return {
    id,
    reference: referenceFor(id, priority),
    status: fromBookingStatus(booking.status ?? 'Scheduled'),
    createdAt: booking.createdAt || now,
    updatedAt: now,
    customer: {
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
    },
    service: {
      type: booking.serviceType,
      quantity: booking.quantity,
      // Normalised on the way in, so a job always carries a usable list even
      // when the booking that made it described a single service the old way.
      items: bookingItems(booking),
      planId: booking.planId,
      specialtyAddons: booking.specialtyAddons,
      specialInstructions: booking.specialInstructions,
      riderNote: booking.riderNote,
      notes: booking.notes,
    },
    schedule: {
      pickupDate: booking.pickupDate,
      pickupTime: booking.pickupTime,
      deliveryDate: booking.deliveryDate,
      deliveryTime: booking.deliveryTime,
      deadline: booking.pickupTime ? `Pickup ${booking.pickupTime}` : undefined,
      /**
       * Carried, but never from a request.
       *
       * `POST /bookings` strips this off the incoming body and re-reads it from
       * the row it is replacing, because both clients replay queued creates: a
       * booking that was rescheduled and then had its original create re-sent
       * would otherwise come back with its allowance refilled. And a body that
       * simply *named* a number would set one — `rescheduleCount: -99` is
       * unlimited moves.
       */
      rescheduleCount: booking.rescheduleCount,
    },
    location: {
      address: booking.address,
      suburb: booking.suburb,
      city: booking.city,
      pickupCoords,
      // Back to where it was collected from. A round trip: the customer's
      // door, the hub, the customer's door.
      deliveryAddress: [booking.address, booking.suburb].filter(Boolean).join(', '),
      deliveryCoords: { ...pickupCoords },
    },
    dispatch: {
      priority,
      bags: bagsForJob(id, booking, booking.serviceType),
      distanceKm: Number(distance.toFixed(2)),
      pickupOtp: newHandoffCode(),
      dropoffOtp: newHandoffCode(),
      deliveryOtp: newHandoffCode(),
      proof: {},
    },
    hubId: booking.hubId,
    payment: {
      amount,
      status: booking.paymentStatus ?? 'Pending',
      promoCode: booking.promoCode,
      promoDiscount: booking.promoDiscount,
      method: booking.paymentMethod,
      momoNumber: booking.momoNumber,
      momoNetwork: booking.momoNetwork,
      transactionRef: booking.transactionRef,
      paidAt: booking.paidAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Job -> Booking (web)
// ---------------------------------------------------------------------------

/** What the reader of a `Booking` is allowed to be shown. */
export interface BookingViewOptions {
  /**
   * Whether to attach the hub's drop-off code.
   *
   * **Off unless the caller says otherwise, and the caller has to be the desk.**
   * This field used to ride on every projection of every job, which meant the
   * customer's own `GET /bookings/:id` — and a guest's, on a tracking token —
   * answered with the four digits the hub desk exists to hold. Nothing rendered
   * them, and that was the whole of the protection: a customer reading their own
   * response body could hand the code to the courier at their door, and the
   * courier could then check a load in from the roadside. The gate stopping the
   * courier's phone from answering its own challenge was still shut, and the
   * bags had simply gone round it.
   *
   * `Order` carries no equivalent for the same reason, and does not need a flag
   * to say so — it has no field at all. This one does, because the desk reads
   * `Booking` and the desk is the party the code belongs to.
   */
  hubCode?: boolean;
}

export function jobToBooking(
  job: Job,
  rider?: RiderState,
  options: BookingViewOptions = {}
): Booking {
  return {
    id: job.id,
    name: job.customer.name,
    email: job.customer.email,
    phone: job.customer.phone,
    serviceType: job.service.type,
    quantity: job.service.quantity,
    items: job.service.items,
    planId: job.service.planId,
    pickupDate: job.schedule.pickupDate,
    pickupTime: job.schedule.pickupTime,
    deliveryDate: job.schedule.deliveryDate,
    deliveryTime: job.schedule.deliveryTime,
    rescheduleCount: job.schedule.rescheduleCount,
    promoCode: job.payment.promoCode,
    promoDiscount: job.payment.promoDiscount,
    hubId: job.hubId,
    specialInstructions: job.service.specialInstructions,
    specialtyAddons: job.service.specialtyAddons,
    riderNote: job.service.riderNote,
    notes: job.service.notes,
    address: job.location.address,
    city: job.location.city,
    suburb: job.location.suburb,
    status: toBookingStatus(job.status),
    createdAt: job.createdAt,
    paymentStatus: job.payment.status,
    paymentMethod: job.payment.method,
    amount: job.payment.amount,
    momoNumber: job.payment.momoNumber,
    momoNetwork: job.payment.momoNetwork,
    transactionRef: job.payment.transactionRef,
    paidAt: job.payment.paidAt,
    pickupCoords: job.location.pickupCoords,
    rider: rider ? riderViewFor(job, rider) : undefined,
    proof: { ...job.dispatch.proof },
    pickupOtp: job.dispatch.pickupOtp,
    // The customer holds both codes: one to hand the bags over, one to take
    // them back.
    deliveryOtp: job.dispatch.deliveryOtp,
    // The hub's, not the customer's, and withheld unless the reader is the
    // desk — see `BookingViewOptions.hubCode`. It travels on this projection
    // at all only because the admin dashboard reads `Booking`.
    dropoffOtp: options.hubCode ? job.dispatch.dropoffOtp : undefined,
  };
}

/**
 * The subset of rider telemetry the customer's live map is allowed to render.
 *
 * No arrival time. This used to work out which leg the courier was riding, take
 * the straight-line distance to the end of it and divide by 18 km/h — a number
 * that ignored roads, traffic and which way the one-way street ran, presented to
 * the customer as "8 min away". The minute count on a live map now comes from
 * the `RouteLeg` that map already fetches from `/api/directions`, and a surface
 * without one shows `jobStatus`.
 */
export function riderViewFor(job: Job, rider: RiderState): BookingRiderView {
  return {
    id: rider.id,
    name: rider.name,
    vehicle: rider.vehicle,
    vehiclePlate: rider.vehiclePlate,
    rating: rider.rating,
    coords: rider.coords,
    jobStatus: job.status,
  };
}

// ---------------------------------------------------------------------------
// Job -> Order (rider app)
// ---------------------------------------------------------------------------

export function jobToOrder(job: Job): Order {
  return {
    id: job.id,
    orderNumber: job.reference,
    customerName: job.customer.name,
    customerPhone: job.customer.phone,
    pickupAddress: [job.location.address, job.location.suburb].filter(Boolean).join(', '),
    pickupCoords: job.location.pickupCoords,
    deliveryAddress: job.location.deliveryAddress,
    deliveryCoords: job.location.deliveryCoords,
    /**
     * Every service on the job, not just the first.
     *
     * This is the line the courier's job card and the offer sheet print. It
     * used to be `job.service.type`, which names the primary service — so a
     * courier sent for two loads of washing and a set of bed linen was told
     * "Washing (Machine & Hand Wash)" and found something else in the third bag.
     */
    laundryType:
      describeItems({
        items: job.service.items,
        serviceType: job.service.type,
        quantity: job.service.quantity,
      }) || job.service.type,
    bagCount: job.dispatch.bags.length,
    bags: job.dispatch.bags,
    priority: job.dispatch.priority,
    status: job.status,
    riderId: job.dispatch.riderId,
    distance: job.dispatch.distanceKm,
    price: job.payment.amount,
    /**
     * The window the courier is working to, on whichever leg they are on.
     *
     * The collection window until the bags are collected, and the return window
     * afterwards. Before the return had an hour on it there was nothing to
     * switch to, so this said "Pickup 08:00 AM …" to a courier driving clean
     * laundry back — the one window that had already passed.
     *
     * `schedule.deadline` still wins when it is set, because the desk writes it
     * by hand for the jobs that need something neither window describes.
     */
    deadline: deadlineFor(job),
    specialInstructions: [job.service.specialInstructions, job.service.riderNote]
      .filter(Boolean)
      .join(' • ') || undefined,
    pickupPhoto: job.dispatch.proof.pickupPhoto,
    pickupSignature: job.dispatch.proof.pickupSignature,
    deliveryPhoto: job.dispatch.proof.deliveryPhoto,
    deliverySignature: job.dispatch.proof.deliverySignature,
    // The collection code travels to the phone because the courier *scans* it:
    // a QR is verified against something, and that has to work in a stairwell
    // with no signal. The delivery and drop-off codes do not, because somebody
    // else reads them out — the customer at the door, the desk at the hub —
    // and the server is the one that checks them. A code the courier's own app
    // is holding is not a code the courier has been told.
    //
    // The hub is the one place on the round trip with a screen, a desk and
    // mains power, so requiring the network there costs nothing.
    pickupOtp: job.dispatch.pickupOtp,
    assignedAt: job.dispatch.assignedAt,
    pickedUpAt: job.dispatch.pickedUpAt,
    deliveredAt: job.dispatch.deliveredAt,
  };
}

// ---------------------------------------------------------------------------
// Carrying proof across a list refresh
// ---------------------------------------------------------------------------

/**
 * Why these exist.
 *
 * List endpoints answer without the proof-of-service blobs — see the projection
 * in the server's job store. Both apps refresh by *replacing* their copy of the
 * board with what the poll returned, so without this a photograph taken thirty
 * seconds ago would disappear from the screen on the next tick: the courier's
 * workflow would ask for the delivery photo a second time, having already sent
 * the first one.
 *
 * A missing field means "not included in this response", never "cleared" —
 * nothing in the API deletes a proof once it is recorded, so keeping what we
 * already hold cannot mask a real deletion.
 */
export function orderWithKnownProof(incoming: Order, previous?: Order): Order {
  if (!previous) return incoming;
  return {
    ...incoming,
    pickupPhoto: incoming.pickupPhoto ?? previous.pickupPhoto,
    pickupSignature: incoming.pickupSignature ?? previous.pickupSignature,
    deliveryPhoto: incoming.deliveryPhoto ?? previous.deliveryPhoto,
    deliverySignature: incoming.deliverySignature ?? previous.deliverySignature,
  };
}

/** The same carry-forward for the customer's view of a job. */
export function bookingWithKnownProof(incoming: Booking, previous?: Booking): Booking {
  if (!previous?.proof) return incoming;
  return {
    ...incoming,
    proof: {
      // The list still carries the override reasons, so the incoming copy wins
      // on those; only the blobs it left behind are filled in from what we had.
      ...previous.proof,
      ...incoming.proof,
      pickupPhoto: incoming.proof?.pickupPhoto ?? previous.proof.pickupPhoto,
      pickupSignature: incoming.proof?.pickupSignature ?? previous.proof.pickupSignature,
      deliveryPhoto: incoming.proof?.deliveryPhoto ?? previous.proof.deliveryPhoto,
      deliverySignature: incoming.proof?.deliverySignature ?? previous.proof.deliverySignature,
    },
  };
}

/** An `Order` the rider app invented locally, folded back into a `Job`. */
export function orderToJob(order: Order, now = new Date().toISOString()): Job {
  return {
    id: order.id,
    reference: order.orderNumber,
    status: order.status,
    createdAt: now,
    updatedAt: now,
    customer: {
      name: order.customerName,
      email: '',
      phone: order.customerPhone,
    },
    service: {
      type: order.laundryType,
      specialInstructions: order.specialInstructions,
    },
    schedule: {
      pickupDate: now.split('T')[0],
      pickupTime: '',
      deliveryDate: now.split('T')[0],
      deadline: order.deadline,
    },
    location: {
      address: order.pickupAddress,
      suburb: '',
      pickupCoords: order.pickupCoords,
      deliveryAddress: order.deliveryAddress,
      deliveryCoords: order.deliveryCoords,
    },
    dispatch: {
      priority: order.priority,
      bags: order.bags,
      riderId: order.riderId,
      distanceKm: order.distance,
      pickupOtp: order.pickupOtp ?? newHandoffCode(),
      // The rider's view never carried either of these, so folding an order
      // back into a job mints fresh ones rather than inventing a shared
      // constant.
      dropoffOtp: newHandoffCode(),
      deliveryOtp: newHandoffCode(),
      assignedAt: order.assignedAt,
      pickedUpAt: order.pickedUpAt,
      deliveredAt: order.deliveredAt,
      proof: {
        pickupPhoto: order.pickupPhoto,
        pickupSignature: order.pickupSignature,
        deliveryPhoto: order.deliveryPhoto,
        deliverySignature: order.deliverySignature,
      },
    },
    payment: {
      amount: order.price,
      status: 'Pending',
    },
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface JobStatusPatch {
  status: JobStatus;
  riderId?: string;
  photo?: string;
  signature?: string;
  bags?: LaundryBag[];
}

/**
 * The single place a job's status changes. Timestamps and proof-of-service
 * attachments are stamped here so the rider app, the admin dashboard and the
 * server all record a transition the same way.
 */
export function applyStatus(job: Job, patch: JobStatusPatch, now = new Date().toISOString()): Job {
  const next: Job = {
    ...job,
    status: patch.status,
    updatedAt: now,
    dispatch: { ...job.dispatch, proof: { ...job.dispatch.proof } },
  };

  if (patch.riderId !== undefined) next.dispatch.riderId = patch.riderId;
  if (patch.bags) next.dispatch.bags = patch.bags;

  if (patch.photo) {
    if (isPickupLeg(patch.status)) next.dispatch.proof.pickupPhoto = patch.photo;
    else next.dispatch.proof.deliveryPhoto = patch.photo;
  }

  if (patch.signature) {
    if (isPickupLeg(patch.status)) next.dispatch.proof.pickupSignature = patch.signature;
    else next.dispatch.proof.deliverySignature = patch.signature;
  }

  // Stamped when a courier first takes the job, not when the status reads
  // `assigned`. A job a supervisor had already moved down the board is claimed
  // where it stands and never passes through that status, so keying on it left
  // the courier's own job card with no start time.
  if (patch.riderId && !next.dispatch.assignedAt) next.dispatch.assignedAt = now;
  if (patch.status === 'picked_up') next.dispatch.pickedUpAt = now;
  if (patch.status === 'delivered') next.dispatch.deliveredAt = now;
  if (patch.status === 'unassigned') next.dispatch.riderId = undefined;

  return next;
}

/**
 * The window the courier is working to, on whichever leg they are on.
 *
 * `schedule.deadline` is written as `Pickup <window>` when the booking is made,
 * so a courier driving clean laundry back was shown the collection window — the
 * one window on the job that had already passed. Once the bags are collected the
 * return window is the deadline that means anything, so it wins from that point
 * on.
 *
 * The stored deadline still stands on the pickup leg, and on a delivery leg for
 * an order with no return window: records written before customers could choose
 * one have no hour to show, and the collection window is at least a true thing
 * about the job.
 */
function deadlineFor(job: Job): string {
  if (isDeliveryLeg(job.status) && job.schedule.deliveryTime) {
    return `Return ${job.schedule.deliveryTime}`;
  }

  return job.schedule.deadline ?? `Pickup ${job.schedule.pickupTime}`;
}

/**
 * The states in which the courier is working towards the customer's door.
 *
 * Listed rather than derived as "not the pickup leg", because the middle of the
 * round trip is neither: between `picked_up` and `processing` the courier is
 * driving to the hub, and the deadline that means anything to them there is the
 * collection they are completing rather than a return that has not been washed
 * yet.
 */
function isDeliveryLeg(status: JobStatus): boolean {
  return (
    status === 'ready_for_delivery' ||
    status === 'navigating_to_delivery' ||
    status === 'arrived_at_delivery' ||
    status === 'delivered'
  );
}

function isPickupLeg(status: JobStatus): boolean {
  return (
    status === 'arrived_at_pickup' ||
    status === 'pickup_scanned' ||
    status === 'picked_up' ||
    status === 'navigating_to_pickup'
  );
}

/**
 * Folds an edit made on the website (admin dashboard or client portal) back
 * into the canonical record. Dispatch-owned fields are deliberately not
 * writable from here — the rider app is the authority on those.
 */
export function applyBookingPatch(
  job: Job,
  patch: Partial<Booking>,
  now = new Date().toISOString(),
  /** The branch to re-measure against when the pin moves. See `bookingToJob`. */
  hub: Coords = LAUNDRY_HUB
): Job {
  const next: Job = {
    ...job,
    updatedAt: now,
    customer: { ...job.customer },
    service: { ...job.service },
    schedule: { ...job.schedule },
    location: { ...job.location },
    dispatch: { ...job.dispatch, proof: { ...job.dispatch.proof } },
    payment: { ...job.payment },
  };

  if (patch.name !== undefined) next.customer.name = patch.name;
  if (patch.email !== undefined) next.customer.email = patch.email;
  if (patch.phone !== undefined) next.customer.phone = patch.phone;

  if (patch.serviceType !== undefined) next.service.type = patch.serviceType;
  /**
   * `quantity` is deliberately absent from this list.
   *
   * It multiplies the price, and this function does not reprice — `amount` is
   * the server's, written once by `POST /bookings` and moved only by the payment
   * route. Accepting a new quantity here would leave a job saying "four loads"
   * beside a total quoted for one, which is worse than not being able to edit
   * it. Correcting a quantity means cancelling and rebooking, which is also
   * what correcting the service itself effectively means today.
   */
  if (patch.planId !== undefined) next.service.planId = patch.planId;
  if (patch.specialtyAddons !== undefined) next.service.specialtyAddons = patch.specialtyAddons;
  if (patch.specialInstructions !== undefined) {
    next.service.specialInstructions = patch.specialInstructions;
  }
  if (patch.riderNote !== undefined) next.service.riderNote = patch.riderNote;
  if (patch.notes !== undefined) next.service.notes = patch.notes;

  if (patch.pickupDate !== undefined) next.schedule.pickupDate = patch.pickupDate;
  if (patch.pickupTime !== undefined) {
    next.schedule.pickupTime = patch.pickupTime;
    next.schedule.deadline = `Pickup ${patch.pickupTime}`;
  }
  if (patch.deliveryDate !== undefined) next.schedule.deliveryDate = patch.deliveryDate;
  if (patch.deliveryTime !== undefined) next.schedule.deliveryTime = patch.deliveryTime;
  /**
   * `rescheduleCount` is deliberately absent, for the reason `quantity` is.
   *
   * It is the allowance that limits how often a booking may be moved, so a
   * patch that could write it is a patch that could refill it — and the website
   * echoes whole records into patches, so a stale tab would put an old count
   * back. `POST /bookings/:id/reschedule` is the only thing that moves it.
   */

  // Re-pin the job if the customer moved it. A patch that carries a pin is the
  // customer having dragged it somewhere better, which outranks a re-derive
  // from the address — so the pin is fed back through the same resolver the
  // booking used rather than being ignored the way it used to be.
  if (
    patch.address !== undefined ||
    patch.suburb !== undefined ||
    patch.pickupCoords !== undefined
  ) {
    next.location.address = patch.address ?? job.location.address;
    next.location.suburb = patch.suburb ?? job.location.suburb;
    next.location.pickupCoords = pickupPinFor({
      address: next.location.address,
      suburb: next.location.suburb,
      // An address edit with no new pin re-derives; the old pin was placed
      // against the old address and may be nowhere near the new one.
      pickupCoords: patch.pickupCoords,
    });
    // The clean laundry goes back to the same door, so moving the pin moves
    // both ends of the round trip.
    next.location.deliveryAddress = [next.location.address, next.location.suburb]
      .filter(Boolean)
      .join(', ');
    next.location.deliveryCoords = { ...next.location.pickupCoords };

    next.dispatch.distanceKm = Number(
      distanceKm(hub, next.location.pickupCoords).toFixed(2)
    );
  }
  if (patch.city !== undefined) next.location.city = patch.city;

  if (patch.amount !== undefined) next.payment.amount = patch.amount;
  if (patch.paymentStatus !== undefined) next.payment.status = patch.paymentStatus;
  if (patch.paymentMethod !== undefined) next.payment.method = patch.paymentMethod;
  if (patch.momoNumber !== undefined) next.payment.momoNumber = patch.momoNumber;
  if (patch.momoNetwork !== undefined) next.payment.momoNetwork = patch.momoNetwork;
  if (patch.transactionRef !== undefined) next.payment.transactionRef = patch.transactionRef;
  if (patch.paidAt !== undefined) next.payment.paidAt = patch.paidAt;

  // A coarse stage picked in the dashboard only moves the job if it actually
  // means a different dispatch state — otherwise round-tripping a booking
  // through the UI would rewind the rider's progress.
  if (patch.status !== undefined && toBookingStatus(job.status) !== patch.status) {
    next.status = fromBookingStatus(patch.status, job.status);
    if (next.status === 'delivered' && !next.dispatch.deliveredAt) {
      next.dispatch.deliveredAt = now;
    }
  }

  return next;
}

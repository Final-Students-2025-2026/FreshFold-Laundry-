/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The domain model shared by every FreshFold surface.
 *
 * A single piece of work — one customer's laundry, from booking to doorstep —
 * is a {@link Job}. The customer-facing web app has always called it a
 * `Booking`; the rider app has always called it an `Order`. Those are both real
 * and both useful, so neither is thrown away: they are *projections* of the
 * same `Job` record, produced by `jobToBooking` / `jobToOrder` in `./job`.
 *
 * The server stores `Job`. Everything else is a view.
 */

import type { ActivePlan } from './membership';

export interface Coords {
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The canonical lifecycle, at dispatch granularity.
 *
 * This is deliberately the *finer* of the two vocabularies: every customer-
 * facing stage can be derived from it, but not the reverse. `./status` holds
 * the mapping in both directions.
 */
export type JobStatus =
  | 'unassigned'
  | 'assigned'
  | 'navigating_to_pickup'
  | 'arrived_at_pickup'
  | 'pickup_scanned'
  | 'picked_up'
  | 'navigating_to_laundry'
  | 'arrived_at_laundry'
  | 'dropped_off'
  | 'processing'
  | 'ready_for_delivery'
  | 'navigating_to_delivery'
  | 'arrived_at_delivery'
  | 'delivered'
  | 'cancelled';

/** What the customer sees on the progress bar in the client portal. */
export type BookingStatus =
  | 'Scheduled'
  | 'Collecting'
  | 'In Care'
  | 'Ironing & Folding'
  | 'Quality Check'
  | 'Delivering'
  | 'Delivered'
  | 'Cancelled';

export type OrderPriority = 'standard' | 'priority' | 'elite';

export type PaymentStatus = 'Pending' | 'Paid' | 'Pay on Pickup' | 'Refunded';

export type MomoNetwork = 'MTN' | 'Telecel' | 'AT';

// ---------------------------------------------------------------------------
// Job — the canonical record
// ---------------------------------------------------------------------------

export interface LaundryBag {
  id: string;
  type: string;
  /**
   * What the bag actually weighs, once somebody has put it on a scale.
   *
   * Optional, and that is the whole point of the change that made it so. This
   * used to be a string every bag carried from the moment the booking was made,
   * derived in `bagsForJob` from the digits of the job id:
   *
   * ```
   * weight: `${(2 + ((digits.charCodeAt(i % digits.length) % 40) / 10)).toFixed(1)}kg`
   * ```
   *
   * — which is to say it was a hash of the reference number, formatted to one
   * decimal place and shown to the customer as a measurement. Nobody weighed
   * anything. The courier's scanner printed it, the customer's manifest printed
   * it, and the hub console added them up.
   *
   * Absent now until the hub records one. A field that is missing says "not
   * weighed yet", which is true; a field that is present says "2.7kg", which is
   * then also true.
   */
  weight?: string;
  /**
   * How many garments are in it, counted by a person at the hub.
   *
   * Optional for the same reason as {@link weight}, and it mattered more: this
   * was the number behind "12 items" on a customer's manifest, and it was
   * `3 + ((digits.charCodeAt((i + 2) % digits.length) + i) % 8)`. A dispute
   * about a missing garment was being argued against a number derived from the
   * booking reference.
   */
  itemCount?: number;
  /** When the count and weight were taken, ISO. Absent until they are. */
  countedAt?: string;
  /** Who took them — the hub operator's name, for the same reason. */
  countedBy?: string;
  qrCode: string;
  scanned: boolean;
}

export interface JobCustomer {
  name: string;
  email: string;
  phone: string;
}

export interface JobService {
  /** Free-text service name, e.g. "Boutique Wash & Press". */
  type: string;
  /**
   * How many of the service's unit this job is for.
   *
   * On the job rather than only on the booking because it is dispatch
   * information: four loads is a different vehicle from one, and the courier's
   * job card and the desk's board both need to say so. Absent means one.
   *
   * Mirrors `items[0]`, like `type` above.
   */
  quantity?: number;
  /**
   * Every service on the job, when it has more than one.
   *
   * `type` and `quantity` name the first; this is the whole list, and it is what
   * the bag manifest was built from.
   */
  items?: BookingItem[];
  /** Subscription plan this job was booked under, if any. */
  planId?: string;
  /**
   * The garment finishes, as the customer chose them.
   *
   * Structured, and not only prose. Both forms compose these into
   * `specialInstructions` for the courier to read — "Organic Lavender scent,
   * None starch." — and for a while that sentence was the only record of them,
   * which meant the server could not price a booking without parsing English.
   * These are what `quoteBooking` reads.
   */
  scent?: string;
  starch?: string;
  specialtyAddons?: string[];
  specialInstructions?: string;
  /** Short note the customer left specifically for the rider. */
  riderNote?: string;
  notes?: string;
}

export interface JobSchedule {
  pickupDate: string;
  pickupTime: string;
  deliveryDate: string;
  /**
   * The window the clean laundry comes back in, as a `DELIVERY_TIME_SLOTS`
   * label.
   *
   * Optional because every order placed before it existed has no answer to give
   * — the return was `pickupDate + 1` with no hour on it, so an old record
   * genuinely does not know. Surfaces show the date alone when it is missing
   * rather than inventing a window nobody promised.
   */
  deliveryTime?: string;
  /** Human deadline shown on the rider's job card, e.g. "Pickup by 19:30". */
  deadline?: string;
  /**
   * How many times the customer has moved this booking.
   *
   * Counted because the allowance is finite — see `MAX_RESCHEDULES`. Absent on
   * an order nobody has moved, which is the same thing as zero and is written
   * that way so the field only appears on records it says something about.
   */
  rescheduleCount?: number;
  /** When it was last moved, ISO. */
  rescheduledAt?: string;
}

export interface JobLocation {
  /** Customer's pickup address — free text as typed into the booking form. */
  address: string;
  suburb: string;
  city?: string;
  pickupCoords: Coords;
  /**
   * Where the clean laundry goes back to — the customer's own door.
   *
   * This used to hold the hub, which is where the bags go *first*. That leg
   * has its own destination in the rider console (`LAUNDRY_HUB_COORDS`), so
   * naming the hub here meant the final delivery leg pointed the courier back
   * to the laundry with the customer's clean clothes on the seat.
   */
  deliveryAddress: string;
  deliveryCoords: Coords;
}

export interface JobProof {
  pickupPhoto?: string;
  pickupSignature?: string;
  deliveryPhoto?: string;
  deliverySignature?: string;
  /**
   * Set when a delivery completed without the customer's code — nobody in, a
   * neighbour took it, the concierge desk signed for it. The courier has to
   * say which, and the job carries that sentence for the rest of its life:
   * it is the difference between a documented exception and a courier
   * marking their own homework.
   */
  deliveryOverrideReason?: string;
  deliveryOverrideAt?: string;
  /**
   * The same escape hatch one leg earlier: bags left at a hub whose desk was
   * unattended, or whose screen nobody could get to. Recorded for the same
   * reason — the alternative is a courier deciding on their own that the
   * handover happened.
   */
  dropoffOverrideReason?: string;
  dropoffOverrideAt?: string;
}

export interface JobDispatch {
  priority: OrderPriority;
  bags: LaundryBag[];
  /** Pickup distance from the hub, in km. */
  distanceKm: number;
  riderId?: string;
  assignedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  /**
   * The code the customer shows — as digits or a QR — for the courier to check
   * before taking the bags. Minted once when the job is created and never
   * regenerated, so the code the customer is looking at stays the one the
   * courier will accept.
   */
  pickupOtp?: string;
  /**
   * The hub's code, shown on the dispatch desk's screen when the courier
   * arrives with the bags.
   *
   * The middle leg used to have no check at all: the courier tapped through a
   * bag manifest their own phone had generated and the job moved to
   * `dropped_off` on nobody's word but theirs. This is the hub asserting it
   * actually received the load, which is the only party in a position to.
   */
  dropoffOtp?: string;
  deliveryOtp?: string;
  proof: JobProof;
}

export interface JobPayment {
  amount: number;
  status: PaymentStatus;
  method?: string;
  momoNumber?: string;
  momoNetwork?: MomoNetwork;
  transactionRef?: string;
  paidAt?: string;
  /**
   * The promo code applied, and what it took off.
   *
   * On the payment rather than the service because it is a fact about the money:
   * `amount` is already net of it, and without these two the desk looking at a
   * ₵24 wash has no way to tell a discount from a mispriced order.
   */
  promoCode?: string;
  promoDiscount?: number;
}

export interface Job {
  /**
   * Shared identity. Formatted `FFC-######` — the same string the customer sees
   * as their booking reference and the rider sees on the job card, so a support
   * conversation can name one id and mean one thing.
   */
  id: string;
  /** Display reference on the rider console, e.g. `FF-882049-ELITE`. */
  reference: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  customer: JobCustomer;
  service: JobService;
  schedule: JobSchedule;
  location: JobLocation;
  dispatch: JobDispatch;
  payment: JobPayment;
  /**
   * Which branch handled it.
   *
   * Optional, and read through a fallback to the default hub rather than
   * backfilled. Every job written before there was more than one went to the
   * only hub there was, so the fallback is not a guess — and the absence is
   * honest about the difference between a branch that was recorded and one that
   * was inferred, which matters the first time somebody audits a mis-sorted bag.
   */
  hubId?: string;
}

// ---------------------------------------------------------------------------
// Booking — the customer-facing projection (apps/web)
// ---------------------------------------------------------------------------

/**
 * One service on an order, and how many of it.
 *
 * A booking used to be one service, which is most of them — but "two loads of
 * washing and a set of bed linen" is one collection, one courier and one
 * doorstep, and making the customer book it twice produced two jobs for one
 * visit.
 */
export interface BookingItem {
  serviceType: string;
  /** How many of the service's unit. Always 1 for a per-order service. */
  quantity: number;
}

export interface Booking {
  id: string;
  name: string;
  email: string;
  phone: string;
  /**
   * Every service on this order, in the order the customer added them.
   *
   * The authoritative list. `serviceType` and `quantity` below mirror the first
   * line and are what the rider app, the desk console, the confirmation email
   * and every other existing reader still use — an order is *mostly* its first
   * service, and rewriting eighty read sites to say `items[0]` would have been a
   * worse change than keeping the pair in step.
   *
   * Absent on every booking made before line items existed, and on any client
   * that has not been updated. Read it through `bookingItems`, which returns the
   * single-line equivalent when it is missing rather than making each caller
   * remember to.
   *
   * Finishes are deliberately *not* per line: scent and starch are one decision
   * about how the customer's laundry should come back, applied to whichever
   * lines are garment services. Add-ons are order-level for the same reason.
   */
  items?: BookingItem[];
  serviceType: string;
  /**
   * How many of the service's unit: four loads, two sofas, one car.
   *
   * Optional because every booking made before this field existed means one,
   * and a `Booking` is parsed straight off the wire from clients that may not
   * send it. The server clamps whatever arrives — see `clampQuantity` — and
   * `quoteBooking` prices from the clamped value, never from this one directly.
   *
   * Always 1 for a service priced per order rather than per countable thing.
   */
  quantity?: number;
  planId?: string;
  pickupDate: string;
  pickupTime: string;
  deliveryDate: string;
  /** The return window, as a `DELIVERY_TIME_SLOTS` label. See `JobSchedule`. */
  deliveryTime?: string;
  /**
   * A promo code the customer typed.
   *
   * Sent by the form and *validated by the server*, which is the whole of the
   * contract: what arrives here is a string somebody typed, and what it is worth
   * is decided by `checkPromo` against the database. A booking that named a code
   * the server refuses is created without it rather than rejected — the customer
   * wanted the wash more than they wanted the discount, and the response says
   * which code did not apply.
   */
  promoCode?: string;
  /** What it actually took off. The server's number, never the client's. */
  promoDiscount?: number;
  /** Which branch took this collection. See `Hub`. */
  hubId?: string;
  /**
   * How many times this booking has been moved. Read-only on the wire — the
   * server owns it, and `POST /bookings/:id/reschedule` is the only thing that
   * increments it.
   */
  rescheduleCount?: number;
  specialInstructions?: string;
  /**
   * The garment finishes chosen on the form. Priced by `quoteBooking` on the
   * server, which is the only thing that decides what this booking costs.
   */
  scent?: string;
  starch?: string;
  specialtyAddons?: string[];
  riderNote?: string;
  notes?: string;
  address: string;
  city?: string;
  suburb: string;
  status: BookingStatus;
  createdAt: string;
  paymentStatus?: PaymentStatus;
  paymentMethod?: string;
  amount?: number;
  momoNumber?: string;
  momoNetwork?: MomoNetwork;
  transactionRef?: string;
  paidAt?: string;
  /**
   * The pin the rider is actually navigating to.
   *
   * Sent by the customer when they placed one themselves — the app asks for
   * the doorstep rather than guessing at it, because "Evandy Hostel, Room 12"
   * is not a coordinate and the courier has to end up somewhere real. Omitted,
   * the server derives a pin from the address so a booking made anywhere else
   * still lands on the map.
   *
   * Either way it comes back on every read, so the customer's map and the
   * rider's map show the same point rather than each resolving the address
   * their own way.
   */
  pickupCoords?: Coords;
  /**
   * Live dispatch detail, present once a rider is on the job. Read-only from
   * the web app's point of view — the rider app owns these.
   */
  rider?: BookingRiderView;
  /**
   * Proof-of-service captured during the job. Read-only here for the same
   * reason as `rider`: the handover surfaces write it, the customer's screens
   * only display it. `applyBookingPatch` ignores it, so echoing a booking back
   * in a PATCH cannot overwrite what was actually captured at the door.
   */
  proof?: JobProof;
  /**
   * The collection code, so the customer's screens can render it as digits and
   * a QR. Read-only here as well — the server mints it.
   */
  pickupOtp?: string;
  /**
   * The delivery code, to read out to the courier at the door before taking
   * the clean laundry back. The courier's own app never receives this one:
   * they type what they are told and the server checks it.
   */
  deliveryOtp?: string;
  /**
   * The hub's drop-off code. Rendered on the desk's Hub board and its pipeline
   * row, not on any customer screen — the customer is not at the hub and this
   * is not their handover. It rides on `Booking` because that is the projection
   * the admin dashboard reads; `Order` deliberately has no equivalent, so the
   * courier's phone cannot answer its own challenge.
   *
   * **Absent unless the reader is the desk.** Not rendering it was never the
   * same as not sending it: it used to be on every projection, so the customer's
   * own response body carried the code their courier is challenged for. See
   * `BookingViewOptions.hubCode`, which is off by default so a new call site
   * leaks nothing by forgetting to think about it.
   */
  dropoffOtp?: string;
}

/** The slice of rider telemetry the customer is allowed to see. */
export interface BookingRiderView {
  id: string;
  name: string;
  vehicle: string;
  vehiclePlate: string;
  rating: number;
  /**
   * How many ratings that average is made of.
   *
   * Beside the average because the average alone misleads in the direction that
   * matters: 5.0 from one delighted customer and 4.6 from ninety are not the
   * same claim, and a supervisor deciding who to send to a difficult address
   * needs to know which they are looking at.
   */
  ratingCount?: number;
  coords: Coords;
  /**
   * Dispatch-granularity status, for the live map's stage readout.
   *
   * There is deliberately no `etaMinutes` beside it. What used to be here was
   * the straight-line distance from these coords to the destination divided by
   * an assumed 18 km/h — every arrival time the product showed. A minute count
   * now comes from a `RouteLeg` the routing engine answered, or from nowhere,
   * and a surface with no route shows this field instead.
   */
  jobStatus: JobStatus;
}

// ---------------------------------------------------------------------------
// Order — the dispatch projection (apps/mobile)
// ---------------------------------------------------------------------------

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  pickupCoords: Coords;
  deliveryAddress: string;
  deliveryCoords: Coords;
  laundryType: string;
  bagCount: number;
  bags: LaundryBag[];
  priority: OrderPriority;
  status: JobStatus;
  /**
   * The courier who holds this job, absent while nobody does.
   *
   * The board a phone is sent is *its own jobs plus the open pool*, so without
   * this the app could not tell the two apart — and it did not: the workflow
   * sheet took the first non-`unassigned` job it found, which on a board with
   * more than one job in flight is somebody else's. It is only ever this
   * courier's id or nothing, because the server never sends a job that belongs
   * to a third party.
   */
  riderId?: string;
  /** Hub-to-pickup, in km, measured when the job was booked. */
  distance: number;
  price: number;
  deadline: string;
  specialInstructions?: string;
  pickupPhoto?: string;
  pickupSignature?: string;
  deliveryPhoto?: string;
  deliverySignature?: string;
  /**
   * Checked against what the customer shows before the bags change hands.
   * There is no `deliveryOtp` or `dropoffOtp` here on purpose — see
   * `jobToOrder`.
   */
  pickupOtp?: string;
  assignedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
}

/**
 * Retained so existing rider-app code that imports `OrderStatus` keeps
 * compiling. `JobStatus` is the name to prefer in new code.
 */
export type OrderStatus = JobStatus;

// ---------------------------------------------------------------------------
// Rider
// ---------------------------------------------------------------------------

export interface RiderState {
  id: string;
  name: string;
  /**
   * Assigned by the server when a supervisor adds the courier, and fixed from
   * then on. It is a sign-in identifier, so neither the supervisor nor the
   * courier gets to type it.
   */
  employeeId: string;
  /**
   * Contact number on the employment record. Doubles as an alternative
   * sign-in identifier — a courier who has forgotten their employee ID has
   * not forgotten their own number.
   */
  phone: string;
  avatar: string;
  /**
   * The vehicle this courier rides and the plate on it. Company property, so
   * both are assigned by a supervisor from the roster console rather than
   * typed in by the courier — the customer is shown them at the door, and a
   * plate nobody checked is worth nothing there.
   */
  vehicle: string;
  vehiclePlate: string;
  rating: number;
  /** How many ratings that average is made of. See `BookingRiderView`. */
  ratingCount?: number;
  isOnline: boolean;
  /** in meters */
  gpsAccuracy: number;
  /** in km/h */
  speed: number;
  /** in degrees */
  heading: number;
  coords: Coords;
  /**
   * Kilometres ridden today, measured, and the device-local date they were
   * measured on.
   *
   * The phone is the only thing that knows how far the scooter actually went,
   * so it adds up the gaps between its own GPS fixes and reports the running
   * total. What this held before was two guesses: a flat `2.1` credited by the
   * courier's phone on every pickup signature, and the straight-line hub-to-
   * pickup distance frozen at booking time credited by the server on every
   * delivery — a chord instead of a road, and one leg instead of the ride back.
   *
   * `distanceDate` is what makes "today" true. Nothing ever reset this figure,
   * so it was a lifetime total under a label that said otherwise. The count
   * restarts when the device's own calendar date moves on, because a courier's
   * day ends at midnight where they are standing rather than in UTC.
   *
   * It is a floor rather than a total: the location watch is a foreground one,
   * so kilometres ridden with the console closed are not counted. Counting them
   * needs a background location task, which the courier app does not have —
   * until it does, this understates the ride rather than inventing the rest of
   * it.
   */
  todayDistance: number;
  /** `YYYY-MM-DD`, device-local, or `''` for a courier who has ridden nowhere. */
  distanceDate: string;
  /**
   * Cedis earned. Server-authored from jobs it saw completed, and — unlike the
   * distance above — never reset, so this is a running total rather than one
   * day's. Resetting it is a payroll decision, not a display one.
   */
  todayEarnings: number;
  completedCount: number;
  onTimeRate: number;
  acceptanceRate: number;
  completionRate: number;
  /**
   * True while the courier is still on the temporary PIN a supervisor issued.
   * The console blocks everything until it is replaced. Not a credential —
   * just the fact that one is still provisional.
   */
  mustChangePin?: boolean;
}

/**
 * Telemetry the rider app pushes to the server on a timer.
 *
 * Only what the phone can honestly claim about itself: where it is, how fast,
 * how far it has ridden today, whose name is on it. The vehicle and its plate
 * are company property assigned by a supervisor, and the employee ID is a
 * sign-in identifier — none of those are a courier's to declare, so none of them
 * are in here.
 *
 * `todayDistance` is, and `todayEarnings` is not. That is not an inconsistency:
 * distance is a measurement only this phone is in a position to make, and
 * earnings are money the server works out from jobs it saw completed. A phone
 * can overstate its own mileage — which a supervisor can see against the jobs
 * on the board — but it cannot pay itself.
 */
export type RiderTelemetry = Partial<
  Pick<
    RiderState,
    | 'name'
    | 'isOnline'
    | 'coords'
    | 'speed'
    | 'heading'
    | 'gpsAccuracy'
    | 'todayDistance'
    | 'distanceDate'
  >
>;

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export type MessageSender = 'rider' | 'customer' | 'dispatcher' | 'laundry_center';

export interface Message {
  id: string;
  sender: MessageSender;
  text: string;
  timestamp: string;
  /** Job id this message belongs to. */
  orderId?: string;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  type: 'order' | 'system' | 'message' | 'alert';
  orderId?: string;
  read: boolean;
}

// ---------------------------------------------------------------------------
// Accounts & payments
// ---------------------------------------------------------------------------

/**
 * A doorstep the customer has saved, so they do not retype it every order.
 *
 * Part of the account rather than of a device, and that is the whole point of
 * it living here. The customer app kept this array in AsyncStorage under
 * `freshfold_addresses`, which meant a book saved on a phone was invisible to
 * the same person on the website, invisible on their second handset, and gone
 * on reinstall — while the patron portal showed three address fields above a
 * Save button that wrote nowhere at all, because there was nowhere to write.
 * Both surfaces read `UserAccount` off a poll already, so putting the book on
 * the account is what makes an address saved in one place appear in the other.
 *
 * A signed-out visitor still books, and still gets a book — theirs stays on the
 * device until they register, and is merged up on the first save afterwards.
 */
export interface SavedAddress {
  /**
   * Stable across edits, and generated by whichever surface first saved it.
   *
   * The array is rewritten whole on every save — see `normaliseAddresses` — so
   * this is what lets an edit made on the website land on the same entry the
   * app is showing rather than appending a near-duplicate beside it.
   */
  id: string;
  /** What the customer calls it: "Home", "Mum's", "Hall 7". */
  label: string;
  /** The street line, or the landmark that stands in for one. */
  address: string;
  suburb: string;
  city?: string;
  /**
   * The doorstep the customer pinned, when they have pinned one. Optional
   * because addresses saved before pins existed do not have one, and because
   * the website's form has no map — those fall back to the point derived from
   * the suburb until somebody drops a pin in the app and saves again.
   */
  coords?: Coords;
  /**
   * The one offered first at booking. Exactly one entry carries it: the
   * normaliser enforces that rather than trusting a client, because two
   * surfaces writing the book at once is precisely how a customer ends up with
   * two defaults and no way to tell which one dispatch will use.
   */
  isDefault?: boolean;
}

/**
 * A customer account as it travels over the wire.
 *
 * Deliberately has no credential field. Passwords are hashed on the server and
 * never leave it — not in a list response, not in a login response. Anything
 * that needs to check a password calls `/api/auth/login`, which does the
 * comparison server-side.
 */
export interface UserAccount {
  email: string;
  phone: string;
  name: string;
  createdAt: string;
  points?: number;
  walletBalance?: number;
  /**
   * The code this customer hands out. Minted lazily, the first time they look.
   *
   * Not minted at registration because every account that already exists has
   * none, and a backfill would issue codes to accounts that will never ask for
   * one.
   */
  referralCode?: string;
  /**
   * Who introduced them — the referrer's address, not their code, because a
   * code could in principle be reissued and the relationship is between people.
   *
   * Written once and never rewritten, which is what stops a customer collecting
   * a second welcome by claiming a second referrer.
   */
  referredBy?: string;
  /** When the referrer's reward was paid, so it is paid once. */
  referralRewardedAt?: string;
  /**
   * The customer's saved pickup addresses.
   *
   * The one part of this record a customer writes wholesale: `PUT /api/accounts`
   * takes the array as given, normalises it and replaces what was there. Absent
   * on an account that has never saved one — distinct from `[]`, which is a book
   * the customer emptied — so a client should read it as `?? []`.
   */
  addresses?: SavedAddress[];
  /** Whether a password has been set, so the UI can offer setup vs. sign-in. */
  hasPassword?: boolean;
  /**
   * Whether the address has been confirmed by clicking the emailed link.
   *
   * Customers only. Couriers and supervisors are provisioned rather than
   * self-registered, never pass through `/api/auth`, and have no equivalent
   * field. A booking made from a signed-in but unconfirmed account is refused
   * by the server, so the portal reads this to explain that up front rather
   * than letting the customer fill in a whole form first.
   */
  emailVerified?: boolean;
  /**
   * The membership this account holds, settled as of the moment it was read.
   *
   * Server-owned: it is a paid entitlement, and `/api/accounts` will not write
   * it. Subscribing and cancelling go through `/api/accounts/plan`, which is
   * the only path that can move the wallet and the plan together.
   */
  plan?: ActivePlan | null;
  /**
   * When a supervisor suspended this account, or absent while it is in good
   * standing.
   *
   * Supervisor-owned, like the plan: only `/api/accounts/:email/blocked` writes
   * it. A blocked account cannot sign in, cannot book, and resolves to nobody
   * on every request — so a token issued before the block stops working at once
   * rather than at the end of its week.
   */
  blockedAt?: string;
  /**
   * Why, in the supervisor's words.
   *
   * Present only on the response to the request that set it, which is behind a
   * supervisor session. `sanitize` strips it everywhere else — `GET /accounts`
   * answers anyone, and a private note about a customer is not for publishing.
   */
  blockedReason?: string;
}

/** A signed-in session: the account plus the bearer token that proves it. */
export interface AuthSession {
  token: string;
  account: UserAccount;
}

/**
 * A signed-in courier. The rider equivalent of {@link AuthSession}.
 *
 * `RiderState` carries no credential field for the same reason `UserAccount`
 * does not: the PIN is hashed on the server and never leaves it.
 */
export interface RiderSession {
  token: string;
  rider: RiderState;
}

/** A supervisor as the dashboard sees them. No credentials, by construction. */
export interface SupervisorProfile {
  id: string;
  name: string;
  email: string;
}

/** A signed-in supervisor. */
export interface AdminSession {
  token: string;
  supervisor: SupervisorProfile;
}

export interface PaymentTransaction {
  id: string;
  bookingId?: string;
  userEmail?: string;
  amount: number;
  method: string;
  status: 'Successful' | 'Pending' | 'Failed';
  reference: string;
  timestamp: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** What kind of thing happened, for the desk to scan by. */
export type AuditEventType =
  /** An order moved between stages by hand, or the hub confirmed a stage. */
  | 'stage'
  /** An order was created or deleted from the desk. */
  | 'order'
  /** A settlement or its reversal. */
  | 'payment'
  /** A loyalty balance was adjusted. */
  | 'points'
  /** A customer account was suspended, restored or deleted. */
  | 'account'
  /** A courier was hired, reassigned or deactivated. */
  | 'roster'
  /** Nobody did it — the hub cycle advanced a stage on a timer. */
  | 'system';

/**
 * One thing that was done to the ledger, and who did it.
 *
 * Written by the server inside the route that performs the action, in the same
 * transaction, so an action that rolls back leaves no entry and one that
 * commits always has one. This used to be an array in `localStorage`, which
 * meant the record of a payment override lived in the browser that made it,
 * capped at fifty entries, and vanished with the site data.
 *
 * Append-only: there is no route that edits or deletes one.
 */
export interface AuditEvent {
  id: string;
  /** ISO instant from the database clock, not the browser's. */
  at: string;
  /** The supervisor's email, or `system` when the hub cycle did it. */
  actor: string;
  /** Who to name on screen. */
  actorName: string;
  /** Short label — "Stage advance", "Payment settlement". */
  action: string;
  /** What happened, in a sentence, with the amounts and names in it. */
  details: string;
  type: AuditEventType;
  /** The order this concerns, when it concerns one. */
  orderId?: string;
  /** The patron email or courier id this concerns, when it concerns one. */
  subject?: string;
}

// ---------------------------------------------------------------------------
// Marketing catalogue (web only, but typed here so the server can validate it)
// ---------------------------------------------------------------------------

export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  priceInfo: string;
  iconName: string;
  category: 'core' | 'specialized' | 'express';
  imageUrl: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  tagline: string;
  price: string;
  billing: string;
  popular?: boolean;
  benefits: string[];
  capacity: string;
  turnaround: string;
  iconName: string;
}

/**
 * `LoyaltyTier` lives in `./loyalty` now, alongside the one table of tiers and
 * the rules for reading it. It was declared here as well, and the website, the
 * customer app and the client portal each carried their own array against it —
 * which is how the portal came to put Silver at 400 points while the app put it
 * at 500, and how the same customer read as two different tiers.
 *
 * The three presentation fields that used to hang off it (`colorFrom`,
 * `colorTo`, `textColor`) are gone with it: they were Tailwind class names that
 * meant nothing to React Native, and nothing rendered them.
 */

export interface StatItem {
  id: string;
  title: string;
  value: string;
  description: string;
}

/*
 * `Testimonial` was here, and went with the roster that was its only use.
 *
 * Kept as a note rather than an empty interface: the shape is easy to bring
 * back, and what matters is that it not come back carrying invented people. A
 * testimonial needs a customer who said the thing and agreed to be named, which
 * is a business record, not a type. See the note in the customer app's
 * `src/data/catalogue.ts`.
 */

// ---------------------------------------------------------------------------
// The laundry itself — what happened to the garments, and what went wrong
// ---------------------------------------------------------------------------

/**
 * One garment, recorded at the hub as a bag is emptied.
 *
 * Not every garment: see the note on `job_garments` in the migration. The
 * per-bag count is the number always taken; a row here is for the items worth
 * naming — the ones a customer would notice, the ones that arrive already
 * marked, and the ones somebody says are missing.
 */
export interface Garment {
  id: string;
  jobId: string;
  /** Which bag it came out of, when that is known. */
  bagId?: string;
  description: string;
  /** How it arrived — a stain noted at intake is a stain that was already there. */
  condition: string;
  /** True once a claim names it: reported missing, or returned damaged. */
  flagged: boolean;
  recordedBy: string;
  createdAt: string;
}

/** The steps a load passes through at the hub, as `HubEvent.stage` records them. */
export const HUB_STAGES = ['intake', 'wash', 'finish', 'quality_check'] as const;

export type HubStage = (typeof HUB_STAGES)[number];

/**
 * One thing that physically happened to a load.
 *
 * The audit trail records that a supervisor *confirmed* a stage; this records
 * the work. Which machine, which batch, whose hands — the three facts that make
 * a fault traceable sideways when four customers report the same discolouration
 * and the only thing they have in common is Washer 3 on Tuesday.
 */
export interface HubEvent {
  id: string;
  jobId: string;
  stage: string;
  /** "Washer 3", "Press 1". Empty for steps that do not happen on a machine. */
  machine: string;
  /** Which load it went in with. Empty when it went through on its own. */
  batch: string;
  operator: string;
  operatorName: string;
  notes: string;
  createdAt: string;
}

/**
 * Where a claim has got to.
 *
 * `upheld` and `resolved` are deliberately distinct. Agreeing that a shirt was
 * ruined and actually making the customer whole are two events that can be days
 * apart, and one "closed" state would let the first be mistaken for the second.
 */
export type ClaimStatus = 'open' | 'investigating' | 'upheld' | 'rejected' | 'resolved';

/**
 * A problem the customer has raised, tracked to an outcome.
 *
 * `IssueReporter` used to file a message into the courier thread and stop. The
 * conversation is still the right place to talk to somebody; this is the half a
 * conversation cannot do — a state, an owner and an ending.
 */
export interface Claim {
  id: string;
  jobId: string;
  customerEmail: string;
  /** One of `CLAIM_KINDS`, or `other`. */
  kind: string;
  description: string;
  photo?: string;
  status: ClaimStatus;
  /** What the laundry decided, written for the customer to read. */
  resolution: string;
  /** Cedis paid back. Zero is a real answer — a re-treatment costs them nothing. */
  compensation: number;
  /** The wallet movement that paid it, when one was made. */
  transactionRef?: string;
  /** Whether a re-treatment was authorised — the thing the care copy promises. */
  retreatment: boolean;
  handledBy: string;
  handledByName: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

/**
 * A stretch of time a courier is working.
 *
 * Instants rather than a calendar day plus two clock times, because "18:00 to
 * 02:00" is an ordinary evening shift and storing it as a date would make the
 * normal case the awkward one.
 */
export interface RiderShift {
  id: string;
  riderId: string;
  startsAt: string;
  endsAt: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// The front desk — what somebody who is not a customer yet sent in
// ---------------------------------------------------------------------------

/**
 * A message from the website's contact form.
 *
 * The only record in this file written by somebody with no account, no booking
 * and no session — which is precisely who a contact form is for. It carries no
 * status, no owner and no reference the sender ever sees: an enquiry is a
 * message with a name on it, and `Claim` already exists for the kind that needs
 * to be tracked to an outcome.
 *
 * It exists at all because the form used to build a `mailto:` link instead of
 * sending anything, which reaches the laundry only if the visitor's browser has
 * a mail client wired up — and tells them it worked either way.
 */
export interface Enquiry {
  id: string;
  name: string;
  /** Optional on the form. Empty when they did not leave one. */
  email: string;
  message: string;
  /**
   * Whether the desk's copy reached the mail provider.
   *
   * Not whether the enquiry was received: the row is written first and is the
   * record. This marks the ones nobody was emailed about, so they are a list to
   * work through rather than a silence.
   */
  delivered: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Growing the business — codes, standing orders, invoices and branches
// ---------------------------------------------------------------------------

/**
 * One line on the tax section of an invoice.
 *
 * Declared here rather than in `./tax` beside the arithmetic, because `Invoice`
 * below stores a frozen array of these and `./tax` imports `roundCedis` from
 * `./membership`, which imports this file — so putting it there would close a
 * cycle. The rates and the composition rule stay in `./tax`; only the shape
 * lives here.
 */
export interface TaxLine {
  id: string;
  label: string;
  /** A fraction: `0.15` is 15%. */
  rate: number;
  amount: number;
}

/** Whether a code takes a share off the bill or a fixed number of cedis. */
export type PromoKind = 'percent' | 'amount';

/**
 * A promo code, voucher or launch offer.
 *
 * Loyalty tiers and membership plans reward somebody for already being a
 * customer. This is the only thing in the product aimed at somebody who is not
 * one yet — and for a laundry whose market is a university campus, word of mouth
 * in a hall of residence is the whole marketing channel.
 */
export interface PromoCode {
  /** The code as typed, upper-cased. Its own primary key. */
  code: string;
  /** What the desk calls it internally. Never shown to the customer. */
  label: string;
  kind: PromoKind;
  /** A fraction for `percent` (0.15 is 15%), cedis for `amount`. */
  value: number;
  /**
   * The most a percentage code may take off one booking.
   *
   * Absent for no ceiling — which is a liability nobody has costed the first
   * time somebody books a ₵180 office clean with "20% off everything".
   */
  maxDiscount?: number;
  /** The smallest order it applies to. Zero for none. */
  minSpend: number;
  startsAt?: string;
  expiresAt?: string;
  /** Total redemptions across everybody. Absent for unlimited. */
  maxUses?: number;
  /** Redemptions per customer. One unless somebody says otherwise. */
  maxPerCustomer: number;
  firstOrderOnly: boolean;
  active: boolean;
  createdBy: string;
  createdAt: string;
  /** How many times it has been redeemed. Filled in by the desk's list. */
  uses?: number;
}

export interface PromoRedemption {
  id: string;
  code: string;
  jobId: string;
  customerEmail: string;
  /** What it actually took off, after the cap and the floor. */
  discount: number;
  createdAt: string;
}

/**
 * A standing order: the thing every membership plan already sells.
 *
 * The plans screen advertises "Weekly door-side pickups — 4 a month" and
 * `includedPickups` was only ever *consumed* — nothing scheduled one. The
 * customer who bought weekly pickups rebooked by hand every Sunday, and the
 * allowance they forgot to use expired at renewal.
 *
 * The bookings this produces are ordinary bookings. It schedules them and gets
 * out of the way, so one can be rescheduled, cancelled or complained about like
 * any other.
 */
export interface RecurringPickup {
  id: string;
  customerEmail: string;
  /** `0` Sunday through `6` Saturday. A weekday, not an interval in days. */
  weekday: number;
  /** A `PICKUP_TIME_SLOTS` label, so generated bookings count against capacity. */
  pickupTime: string;
  /** A `DELIVERY_TIME_SLOTS` label. */
  deliveryTime?: string;
  items: BookingItem[];
  scent?: string;
  starch?: string;
  addons: string[];
  address: string;
  suburb: string;
  city: string;
  pickupCoords?: Coords;
  notes: string;
  active: boolean;
  /** How many days ahead the sweep books. */
  leadDays: number;
  /** The last date this produced a booking for, `YYYY-MM-DD`. */
  lastBookedFor?: string;
  startsOn: string;
  endsOn?: string;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  /** The order this bills for, when it bills for one. */
  jobId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  position: number;
}

/**
 * A bill for a month of collections, rather than for one bag.
 *
 * "Corporate Contracts" has always been in the catalogue, marked `bookable:
 * false` with the note "Custom Enterprise Quotes" — so the marketing site sold
 * to hotels and the software could not bill one. Every payment path settled a
 * single booking at the moment it happened.
 *
 * The money is stored rather than recomputed: an invoice states what was owed on
 * the day it was issued, and a document that recomputed itself would quietly
 * restate a bill somebody had already paid.
 */
export interface Invoice {
  id: string;
  /** The human reference — `INV-2026-0007` — that an accounts department quotes. */
  number: string;
  billToEmail: string;
  billToName: string;
  billToOrg: string;
  billToAddress: string;
  /** Their own tax number, which a business needs to reclaim anything. */
  billToTin: string;
  periodStart?: string;
  periodEnd?: string;
  net: number;
  tax: number;
  total: number;
  /** The levy-by-levy working, frozen with the rates that produced it. */
  taxLines: TaxLine[];
  paid: number;
  status: InvoiceStatus;
  dueOn?: string;
  issuedAt?: string;
  paidAt?: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lines?: InvoiceLine[];
}

/**
 * A branch.
 *
 * `LAUNDRY_HUB` was one pair of coordinates that roughly twenty call sites read,
 * so a second branch was a refactor rather than a row. This is the row. The
 * constant seeds the first one, so nothing that reads it changes behaviour.
 */
export interface Hub {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Suburbs this branch collects from. Empty means no stated area. */
  suburbs: string[];
  active: boolean;
  isDefault: boolean;
  createdAt: string;
}

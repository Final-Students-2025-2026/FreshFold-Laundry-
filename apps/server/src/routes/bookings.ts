/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  DEFAULT_DELIVERY_SLOT_CAPACITY,
  DEFAULT_SLOT_CAPACITY,
  DELIVERY_TIME_SLOTS,
  MAX_RESCHEDULES,
  PHONE_LENGTH_MESSAGE,
  PICKUP_TIME_SLOTS,
  applyBookingPatch,
  bookingItems,
  bookingToJob,
  checkCancel,
  checkPromo,
  checkReschedule,
  defaultHub,
  deliverySlotsFor,
  describeItems,
  isCompletePhone,
  isIsoDate,
  isOutsideServiceArea,
  isTerminal,
  hubCoords,
  hubForPickup,
  newJobId,
  normalisePromoCode,
  paymentBookingId,
  paymentPurpose,
  phoneDigits,
  phoneKey,
  pickupPinFor,
  quoteBooking,
  ratesFromEnv,
  rescheduledDelivery,
  toBookingStatus,
  type Booking,
  type Job,
} from '@freshfold/core';
import { recordAudit } from '../audit';
import { accountForToken, bearerToken } from '../auth';
import { issueTrackingToken, resolveBookingAccess, resolveLister } from '../booking-access';
import { consumeIncludedPickup, settleAccountByEmail } from '../membership';
import { mailBookingConfirmation, mailReschedule } from '../setup-links';
import { store } from '../store';
import { charge, refund } from '../wallet';
import { BOOKING_PURPOSE, verifyPaystackTransaction } from './integrations';
import { accountBlocked, bookingView, bookingViews, guard, notFound } from '../helpers';
import { rateLimit } from '../rateLimit';

/**
 * The customer-facing half of the API — what the website reads and writes.
 *
 * Creating a booking here is the moment a marketing-site form submission
 * becomes a dispatchable job: `bookingToJob` derives the pickup pin, bag
 * manifest, priority and distance, and the record lands in the same pool the
 * rider app pulls from.
 *
 * Everything except that creation is now behind an identity. This whole file
 * used to be open: `GET /:id` handed out a stranger's address and all three
 * hand-off codes to anybody who could count to `FFC-999999`, and `PATCH` and
 * `DELETE` let them rewrite or remove the order afterwards. See
 * `../booking-access` for who qualifies as whom.
 */
export const bookingsRouter = Router();

/**
 * How many collections one window can take.
 *
 * `PICKUP_SLOT_CAPACITY` in the environment wins, so the desk can widen a busy
 * Saturday without a deploy. Anything unparseable or below one falls back to
 * core's number rather than to zero — a misconfigured variable that closed every
 * window would take bookings offline entirely, which is a worse failure than one
 * that lets a window run a little full.
 */
function slotCapacity(): number {
  return envCapacity(process.env.PICKUP_SLOT_CAPACITY, DEFAULT_SLOT_CAPACITY);
}

/** The same, for the return leg. `DELIVERY_SLOT_CAPACITY` overrides it. */
function deliveryCapacity(): number {
  return envCapacity(process.env.DELIVERY_SLOT_CAPACITY, DEFAULT_DELIVERY_SLOT_CAPACITY);
}

function envCapacity(value: string | undefined, fallback: number): number {
  const configured = Number(value);
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : fallback;
}

/**
 * Whether a window on a day still has room, and the shape both callers answer with.
 *
 * `exclude` is a job id whose own place in the window does not count against
 * it. That is what makes a replayed create safe — both apps re-send queued
 * writes, and a booking already holding a place must not be refused for
 * occupying it — and it is what makes a reschedule that only changes the return
 * window work, where the collection is being "moved" to where it already is.
 */
async function windowState(
  leg: 'pickup' | 'delivery',
  date: string,
  slot: string,
  exclude?: string
): Promise<{ booked: number; capacity: number; full: boolean }> {
  const capacity = leg === 'pickup' ? slotCapacity() : deliveryCapacity();
  const taken =
    leg === 'pickup'
      ? await store.jobs.countByPickupSlot(date)
      : await store.jobs.countByDeliverySlot(date);

  const held = exclude ? await store.jobs.find(exclude) : null;
  const holdsThis =
    !!held &&
    held.status !== 'cancelled' &&
    (leg === 'pickup'
      ? held.schedule.pickupDate === date && held.schedule.pickupTime === slot
      : held.schedule.deliveryDate === date && held.schedule.deliveryTime === slot);

  const booked = Math.max(0, (taken[slot] ?? 0) - (holdsThis ? 1 : 0));
  return { booked, capacity, full: booked >= capacity };
}

/**
 * What is left in each window on a day.
 *
 * Answered for any caller, with no session: this is the booking form's own
 * question and the form is open to strangers — that is what a booking form is.
 * It leaks how busy a day is and nothing else; no customer, no address, no
 * order id.
 */
bookingsRouter.get(
  '/availability',
  guard(async (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : '';

    if (!isIsoDate(date)) {
      res.status(400).json({ error: 'A date in YYYY-MM-DD form is required.' });
      return;
    }

    /**
     * The booking id whose own place is discounted, when one is offered.
     *
     * A customer on the reschedule screen is looking at the day their order is
     * already booked into, and without this the window they currently hold
     * reads as one place fuller than it is — which on a nearly-full morning
     * shows them their own collection as unavailable.
     *
     * Safe to take from the query string: it can only ever *free* a place in a
     * window the named booking already occupies, and the count is not a secret.
     */
    const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : undefined;

    const capacity = slotCapacity();
    const taken = await store.jobs.countByPickupSlot(date);

    /**
     * The return day, and what is left in its windows.
     *
     * Asked for separately rather than derived here, because the form knows the
     * turnaround it is offering and this route should not have to guess at it.
     * Omitted from the response when the caller does not ask, so the marketing
     * site's existing call is unchanged.
     */
    const deliveryDate =
      typeof req.query.deliveryDate === 'string' && isIsoDate(req.query.deliveryDate)
        ? req.query.deliveryDate
        : null;

    const held = exclude ? await store.jobs.find(exclude) : null;
    const holdsPickup = (slot: string) =>
      !!held &&
      held.status !== 'cancelled' &&
      held.schedule.pickupDate === date &&
      held.schedule.pickupTime === slot;

    const deliveryCap = deliveryCapacity();
    const takenBack = deliveryDate ? await store.jobs.countByDeliverySlot(deliveryDate) : {};
    const holdsDelivery = (slot: string) =>
      !!held &&
      held.status !== 'cancelled' &&
      held.schedule.deliveryDate === deliveryDate &&
      held.schedule.deliveryTime === slot;

    res.json({
      date,
      capacity,
      slots: PICKUP_TIME_SLOTS.map((slot) => {
        const booked = Math.max(0, (taken[slot] ?? 0) - (holdsPickup(slot) ? 1 : 0));
        return { slot, booked, remaining: Math.max(0, capacity - booked), full: booked >= capacity };
      }),
      ...(deliveryDate
        ? {
            deliveryDate,
            deliveryCapacity: deliveryCap,
            deliverySlots: DELIVERY_TIME_SLOTS.map((slot) => {
              const booked = Math.max(0, (takenBack[slot] ?? 0) - (holdsDelivery(slot) ? 1 : 0));
              return {
                slot,
                booked,
                remaining: Math.max(0, deliveryCap - booked),
                full: booked >= deliveryCap,
              };
            }),
          }
        : {}),
    });
  })
);

/**
 * One customer's orders, or the whole board.
 *
 * Which of the two you get is decided by the token, not by the request. It used
 * to be decided by `?email=`, which is to say by whoever was asking: the address
 * was read straight off the query string, so this route answered any customer's
 * history to anyone who knew their email — and answered the entire ledger to a
 * caller who passed nothing at all, which is what the marketing site did on a
 * five-second timer for every visitor.
 *
 * A customer's own scope still matches the number on their account as well as
 * the address, so a booking placed as a guest under a second address on the same
 * phone is in their history. That part was always right; it is the *source* of
 * the address that was wrong.
 */
bookingsRouter.get(
  '/',
  guard(async (req, res) => {
    const lister = await resolveLister(req);

    if (!lister) {
      res.status(401).json({ error: 'Sign in to see your orders.' });
      return;
    }

    const jobs =
      lister.kind === 'supervisor'
        ? await store.jobs.list()
        : await store.jobs.list({
            email: lister.account.email,
            phone: lister.account.phone ?? null,
          });

    res.json(await bookingViews(jobs, lister));
  })
);

bookingsRouter.get(
  '/:id',
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    // 404 rather than 403 for a caller with no claim on it. A 403 confirms the
    // order exists, which is half of what walking the id space was after.
    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    // Held rather than discarded now: three of the four readers this route
    // admits may not see the hub's code, and the answer to which one is asking
    // was already in hand.
    res.json(await bookingView(job, access));
  })
);

/**
 * How many bookings one phone number may create in an hour.
 *
 * Generous against real use — a household booking a wash, then remembering the
 * bedsheets, then booking for a flatmate is three — and useless as a way to
 * fill the board.
 *
 * This route is deliberately open: a guest books without an account, which is
 * the whole of the front counter working. But it was also the only public write
 * in the system with nothing in front of it, and it does two expensive things
 * per call — writes a job and, at the bottom of the handler, sends a
 * confirmation email. So an unmetered loop here is not just junk rows on the
 * desk's board; it is our Brevo quota and our sending reputation, spent by
 * somebody else. `POST /contact` has been limited for exactly this reason
 * while the higher-value route beside it was not.
 *
 * Bucketed on the number rather than the address because the number is the one
 * field this route cannot proceed without — it is refused a few lines down for
 * being the wrong length, and the courier calls it from the doorstep.
 *
 * `phoneKey` rather than `phoneDigits`, which is the difference between a
 * bucket and a bypass: the two are the same function until somebody writes the
 * same number as `+233 24 …` instead of `024 …`, at which point `phoneDigits`
 * hands out a second allowance for one phone. `phoneKey` is what `samePhone`
 * compares on, so a caller cannot buy more attempts by changing format.
 */
const bookingLimit = rateLimit({
  max: 6,
  windowMs: 60 * 60 * 1000,
  message: 'That is several bookings from this number in an hour. Call the shop to add more.',
  key: (req) => {
    const key = phoneKey((req.body as Booking | undefined)?.phone ?? '');
    // Nothing usable to bucket on — the same nine-digit test `samePhone` makes
    // before it trusts a match. The handler refuses the request a moment later
    // for the same reason, and `bookingBurst` below still counts it against the
    // address.
    return key.length === 9 ? key : null;
  },
});

/**
 * And the same question asked of the address, which is what catches a script
 * that varies the number.
 *
 * Two limiters rather than one, following the three credential routes: per
 * account and per address, because either alone leaves the other as the bypass.
 * Sized well above a shared NAT — a hall of students on one university
 * connection is the normal case here, not the attack.
 */
const bookingBurst = rateLimit({
  max: 40,
  windowMs: 60 * 60 * 1000,
  message: 'Too many bookings from this connection in an hour. Try again shortly.',
});

bookingsRouter.post(
  '/',
  bookingLimit,
  bookingBurst,
  guard(async (req, res) => {
    const incoming = req.body as Booking;
    if (!incoming || !incoming.name || !incoming.phone) {
      res.status(400).json({ error: 'A booking needs at least a name and a phone number.' });
      return;
    }

    // The courier calls this number from the doorstep, so a short one is worse
    // than no booking at all.
    if (!isCompletePhone(incoming.phone)) {
      res.status(400).json({ error: PHONE_LENGTH_MESSAGE });
      return;
    }

    // A pin the customer placed is what the courier navigates to, so one that
    // lands outside Kumasi is refused rather than quietly swapped for a derived
    // point the customer never saw — they placed it, they should be told.
    if (incoming.pickupCoords && isOutsideServiceArea(incoming.pickupCoords)) {
      res.status(400).json({ error: 'That pickup pin is outside the FreshFold service area.' });
      return;
    }

    /**
     * A suspended customer cannot book.
     *
     * Matched on the contact details in the form rather than on the session,
     * which is the only thing that works: a blocked account's token resolves to
     * nobody, so checking `holder` below would leave "sign out and book as a
     * guest" as the whole of the bypass. Email or phone, because a new address
     * on the same number is the other obvious way round.
     *
     * Somebody determined can still book under a number FreshFold has never
     * seen — as any stranger can, that being what a booking form is. What this
     * stops is a blocked account walking back in with its history, its saved
     * details and its dispatch priority attached.
     */
    const contact = await store.accounts.findByEmailOrPhone(incoming.email ?? '', incoming.phone);

    if (contact?.blockedAt) {
      accountBlocked(res);
      return;
    }

    // The membership is read off the session, never off the body.
    //
    // `planId` used to arrive from the client and go straight into the job,
    // where `priorityForBooking` turns any non-empty value into `elite`. That
    // made the top dispatch priority free for anyone who could edit a request —
    // and a paying member who booked from a signed-out device got nothing. The
    // token decides, and an unauthenticated booking simply has no plan.
    const holder = await accountForToken(bearerToken(req));

    /**
     * A signed-in customer must have confirmed their address.
     *
     * Scoped to `holder` on purpose. Booking is open to guests — the website's
     * whole funnel is a stranger filling in a form — so there is no account to
     * check when no token arrives, and requiring one here would turn a
     * verification feature into a registration wall.
     *
     * The consequence is worth stating plainly: an unconfirmed customer can
     * still book by signing out first. What this actually buys is that the
     * benefits attached to an account — the membership priority resolved just
     * below, the order history, the saved addresses — cannot be reached from an
     * address nobody has proven they own.
     */
    if (holder && !holder.emailVerified) {
      res.status(403).json({
        error:
          'Confirm your email address before booking. Check your inbox for the link, ' +
          'or request a new one from your account.',
        code: 'EMAIL_UNVERIFIED',
      });
      return;
    }

    const member = holder ? await settleAccountByEmail(holder.email) : null;

    /**
     * What this booking costs, decided here.
     *
     * `amount` used to arrive in the body and go straight onto the job. The price
     * of a wash was therefore whatever the client said it was: a booking could be
     * submitted at ₵0 and land on the board as free work, and since
     * `priorityForBooking` reads the same number, one submitted at ₵999 bought
     * elite dispatch for nothing.
     *
     * The arithmetic is `quoteBooking` in `@freshfold/core` — the same function
     * both booking forms call to show the customer a quote, so the number they
     * approved and the number recorded are the same number, and neither surface
     * can drift from the other again.
     *
     * The plan and the points come off the settled account rather than the
     * request. A membership discount is a paid entitlement and a tier discount is
     * earned; both were previously applied by whichever client bothered — the app
     * did, the website did not, so the same member paid two different prices for
     * the same order depending on where they booked it.
     */
    /**
     * How many of the service's unit, decided here rather than trusted.
     *
     * `clampQuantity` forces a whole number between 1 and `MAX_QUANTITY`, and
     * forces 1 for a service priced per order. It matters that this happens on
     * the server and not only in the forms: the number multiplies the price, so
     * a request carrying `quantity: 0.0001` would quote a wash at nothing, and
     * one carrying `1e9` would quote it at a number `priorityForBooking` reads
     * as elite dispatch.
     */
    const items = bookingItems(incoming);

    if (items.length === 0) {
      res.status(400).json({ error: 'A booking needs at least one service.' });
      return;
    }

    /**
     * The collection window has to have room in it.
     *
     * Checked here rather than only in the forms, because the forms are not the
     * only thing that can post a booking — and because two customers filling in
     * the same form at the same time both saw room a moment ago.
     *
     * `existing` is what makes a replay safe: both apps queue writes while
     * offline and re-send them on reconnect, and a booking that already holds a
     * place in this window must not be refused for occupying it. Its own count
     * is discounted before the comparison.
     *
     * There is a race left, and it is worth naming: two bookings landing in the
     * same millisecond can both read a window with one place free and both take
     * it. Closing it properly means a lock on the window rather than on the job,
     * which is a table this schema does not have. The consequence is a window
     * that occasionally runs one over, which the desk can see and absorb — as
     * against the unbounded overbooking that was there before.
     */
    if (incoming.pickupTime) {
      const window = await windowState(
        'pickup',
        incoming.pickupDate ?? '',
        incoming.pickupTime,
        incoming.id
      );

      if (window.full) {
        res.status(409).json({
          error:
            'That collection window is full. Choose another window, or another day — ' +
            'the booking form shows which are still open.',
          reason: 'slot-full',
          slot: incoming.pickupTime,
          date: incoming.pickupDate,
        });
        return;
      }
    }

    /**
     * The return window, checked the same way and for the same reason.
     *
     * A return is a courier's afternoon exactly as a collection is a courier's
     * morning, so a window customers can choose is a window that can be
     * oversold — the failure gap #2 named for collections, arriving on the
     * other leg. Only checked when one was chosen: the field is optional, and a
     * booking that names no return window is asking for the day rather than the
     * hour, which is what every booking did before this existed.
     */
    if (incoming.deliveryTime) {
      if (!DELIVERY_TIME_SLOTS.includes(incoming.deliveryTime)) {
        res.status(400).json({
          error: 'Choose one of the return windows offered.',
          reason: 'unknown-slot',
        });
        return;
      }

      /**
       * A same-day return cannot leave before the collection is back.
       *
       * `deliverySlotsFor` drops the windows that open before the collection
       * window closes, so an express order collected at 5:30pm cannot be
       * promised back at 8am the same morning.
       */
      const offered = deliverySlotsFor(
        incoming.pickupDate ?? '',
        incoming.pickupTime ?? '',
        incoming.deliveryDate ?? ''
      );

      if (!offered.some((slot) => slot.label === incoming.deliveryTime)) {
        res.status(400).json({
          error: 'That return window is before your laundry would be back. Choose a later one.',
          reason: 'delivery-before-pickup',
        });
        return;
      }

      const window = await windowState(
        'delivery',
        incoming.deliveryDate ?? '',
        incoming.deliveryTime,
        incoming.id
      );

      if (window.full) {
        res.status(409).json({
          error: 'That return window is full. Choose another — the form shows which are open.',
          reason: 'delivery-slot-full',
          slot: incoming.deliveryTime,
          date: incoming.deliveryDate,
        });
        return;
      }
    }

    /**
     * The bill before any promo code, so the code can be checked against it.
     *
     * Quoted twice, deliberately. A promo code's minimum spend and its
     * percentage both apply to what the customer *actually* owes — after the
     * membership's waived pickup, the member rate and the loyalty tier — so
     * there is no way to know what a code is worth without first working out the
     * bill without it. The second quote below is the one that counts.
     */
    const undiscounted = quoteBooking({
      selections: {
        serviceType: incoming.serviceType,
        scent: incoming.scent,
        starch: incoming.starch,
        addonIds: incoming.specialtyAddons,
        items,
      },
      plan: member?.plan ?? null,
      // `undefined` rather than 0 for a guest: no account, so no tier.
      points: member ? (member.points ?? 0) : undefined,
    });

    /**
     * What the code the customer typed is actually worth.
     *
     * Decided here and nowhere else. The forms run the same `checkPromo` to show
     * a customer what to expect, but they run it against a code record they
     * fetched and a usage count that was true a moment ago — only the server,
     * holding the row, can say whether the last redemption of a limited code was
     * somebody else's.
     *
     * A refused code does not fail the booking. Somebody typing `FRESHERS24`
     * wrongly wants the wash more than they want the discount, and losing the
     * pickup over a typo would be the wrong trade; the response says which code
     * did not apply and why, and the form shows it.
     */
    const typed = normalisePromoCode(incoming.promoCode ?? '');
    let promoApplied: { code: string; discount: number } | null = null;
    let promoRefusal: { code: string; error: string; reason: string } | null = null;

    if (typed) {
      const record = await store.promos.find(typed);
      const usage = await store.promos.usage(typed, incoming.email ?? '');

      /**
       * "First order" is asked of the bookings already on the ledger.
       *
       * Counted rather than inferred from the account's age, because a customer
       * who booked as a guest and registered afterwards has a history the
       * account does not know about — and a first-order code that fired for them
       * a second time is the campaign paying twice for one acquisition.
       */
      const history = incoming.email
        ? await store.jobs.list({ email: incoming.email, phone: incoming.phone ?? null })
        : [];

      const verdict = checkPromo(record, undiscounted.total, {
        ...usage,
        firstOrder: history.filter((job) => job.id !== incoming.id).length === 0,
      });

      if (verdict.ok) promoApplied = { code: verdict.code, discount: verdict.discount };
      else promoRefusal = { code: typed, error: verdict.message, reason: verdict.reason };
    }

    const quote = quoteBooking({
      selections: {
        serviceType: incoming.serviceType,
        scent: incoming.scent,
        starch: incoming.starch,
        addonIds: incoming.specialtyAddons,
        items,
      },
      plan: member?.plan ?? null,
      points: member ? (member.points ?? 0) : undefined,
      promo: promoApplied,
      taxRates: ratesFromEnv(process.env),
    });

    /**
     * Which branch takes this collection.
     *
     * Read from the `hubs` table rather than from `LAUNDRY_HUB`, so a second
     * branch is a row rather than a deploy. Falls back to the constant when the
     * table is empty, which is true of a database that has not run the migration
     * — a booking that could not be assigned a branch is a booking nobody
     * collects, and that is a worse failure than one sent to the only branch
     * there is.
     */
    const hubs = await store.hubs.list().catch(() => []);
    const pin = pickupPinFor({
      address: incoming.address,
      suburb: incoming.suburb,
      pickupCoords: incoming.pickupCoords,
    });
    const hub = hubs.length > 0 ? hubForPickup(hubs, pin, incoming.suburb) : defaultHub();

    const booking: Booking = {
      ...incoming,
      id: incoming.id || newJobId(),
      /**
       * The normalised lines, not the ones that arrived, so the record and the
       * price it was quoted at cannot disagree.
       *
       * `serviceType` and `quantity` are rewritten from the first line for the
       * same reason: the rider app, the desk board and the confirmation email
       * all read those two, and a booking whose primary service says one thing
       * while `items[0]` says another is a bug waiting for whichever surface
       * reads the wrong one.
       */
      items: quote.items,
      serviceType: quote.items[0].serviceType,
      quantity: quote.items[0].quantity,
      phone: phoneDigits(incoming.phone),
      momoNumber: incoming.momoNumber ? phoneDigits(incoming.momoNumber) : incoming.momoNumber,
      planId: member?.plan?.planId,
      amount: quote.total,
      /**
       * The code and what it took off, both the server's numbers.
       *
       * `promoDiscount` is `quote.promoDiscount` rather than the figure
       * `checkPromo` returned, because the quote clamps it to what is actually
       * left on the bill — a ₵20 code on a ₵12 order takes ₵12 off, and the
       * difference is not change owed to the customer.
       */
      promoCode: quote.promoCode,
      promoDiscount: quote.promoDiscount || undefined,
      /** Which branch it goes to. See `hubForPickup`. */
      hubId: hub.id,
      /**
       * Nothing is paid at the moment it is booked.
       *
       * The client used to send `paymentStatus: 'Paid'` along with a
       * `transactionRef` it had invented — `'TXN-' + Math.random()` on the website
       * — after verifying a Paystack payment in the browser. So a booking arrived
       * settled on the strength of the browser's own say-so, with a reference that
       * matched nothing in the ledger.
       *
       * The method is an intent and is honoured; the *status* is the server's, and
       * only `POST /:id/payment` below can move it to `Paid`.
       */
      paymentStatus: incoming.paymentMethod === 'Pay on Pickup' ? 'Pay on Pickup' : 'Pending',
      paidAt: undefined,
      transactionRef: undefined,
      /**
       * The reschedule allowance is not the client's to state.
       *
       * `bookingToJob` writes whatever this says onto the job, so a body
       * carrying `rescheduleCount: -99` would buy unlimited moves — the same
       * shape of claim `amount` and `paymentStatus` above are stripped for.
       * Restored from the existing row inside the transaction, so a replayed
       * offline create does not refill a spent allowance either.
       */
      rescheduleCount: undefined,
    };

    const { job, replayed } = await store.tx(async (t) => {
      // POSTing an id that already exists is an upsert rather than an error:
      // the web app replays its offline queue on reconnect.
      const existing = await t.jobs.find(booking.id, { lock: true });
      // Measured against the branch this collection is going to, which is what
      // `priorityForBooking` and the courier's job card both read.
      const created = bookingToJob(booking, undefined, hubCoords(hub));

      // `bookingToJob` mints fresh hand-off codes every time it runs. On a
      // replay that would invalidate the code the customer is already looking
      // at — and which the courier is about to be shown — so the originals
      // stand. The job's identity owns the codes, not the request that
      // happened to arrive last.
      //
      // All three, not just the collection one: a replayed offline write used
      // to roll the delivery code out from under a customer who had the order
      // screen open, and the hub code has exactly the same problem.
      if (existing) {
        created.dispatch.pickupOtp = existing.dispatch.pickupOtp;
        created.dispatch.dropoffOtp = existing.dispatch.dropoffOtp;
        created.dispatch.deliveryOtp = existing.dispatch.deliveryOtp;

        // And the moves already spent, for the same reason: a replay is the
        // *original* create arriving late, so it must not hand a booking that
        // has since been rescheduled a fresh allowance.
        created.schedule.rescheduleCount = existing.schedule.rescheduleCount;
      }

      const saved = await t.jobs.upsert(created);

      /**
       * A new booking spends an included pickup only if one was actually applied.
       *
       * `quote.coveredByPlan` is the same decision that waived the laundry fee a
       * few lines above, so the allowance and the discount cannot disagree. It
       * used to fire on `member?.plan` alone, which spent a pickup on work no
       * plan covers — a Family member booking a ₵180 office clean was billed the
       * member rate *and* charged one of their eight monthly pickups for it.
       *
       * Still guarded by `existing`, so a replayed offline write does not spend
       * the allowance twice for one job.
       */
      if (!existing && quote.coveredByPlan && member) {
        await consumeIncludedPickup(t, member);
      }

      /**
       * The redemption, in the same transaction as the booking it discounted.
       *
       * Which is the whole point of it being here rather than after the
       * response: a discount granted with no redemption recorded is a limited
       * code with no limit, and a customer who could make the write fail after
       * the booking committed would have an unlimited one.
       *
       * `redeem` is a no-op on conflict against `(code, job_id)`, so a replayed
       * offline booking files one redemption rather than burning a second of the
       * customer's one.
       */
      if (quote.promoCode && quote.promoDiscount > 0) {
        await t.promos.redeem({
          id: `redeem-${saved.id}-${quote.promoCode}`,
          code: quote.promoCode,
          jobId: saved.id,
          customerEmail: saved.customer.email,
          discount: quote.promoDiscount,
        });
      }

      // After the job, never before: the notification carries a foreign key
      // back to it.
      await t.notifications.insert({
        id: `notif-${saved.id}`,
        title: 'New Pickup Request',
        body: `${saved.customer.name} booked ${describeItems({ items: saved.service.items, serviceType: saved.service.type, quantity: saved.service.quantity }) || saved.service.type} in ${saved.location.suburb}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'order',
        orderId: saved.id,
        read: false,
      });

      return { job: saved, replayed: Boolean(existing) };
    });

    // No viewer, so no hub code. A booking that has just been made is not on
    // the hub leg and the caller here is whoever filled in the form — which on
    // this one route may be a stranger.
    const view = await bookingView(job);

    /**
     * The grant that lets the caller read this booking back.
     *
     * Booking is the one route here that is open to a stranger — that being what
     * a booking form is — so a stranger has to leave with something, or they
     * could not watch the courier they have just summoned. Minted on a replay
     * too: a replayed write is one whose first response never arrived, so the
     * client is holding no token and needs the one it finally gets.
     *
     * Best effort. A booking is on the board and dispatchable at this point, and
     * failing the 201 over the token would lose the pickup to save the tracking
     * of it. A customer who ends up without one signs in instead, which is what
     * the confirmation email is for.
     */
    let trackingToken: string | undefined;
    try {
      trackingToken = await issueTrackingToken(job.id);
    } catch (error) {
      console.error(`[bookings] could not issue a tracking token for ${job.id}:`, error);
    }

    res.status(201).json({
      ...view,
      trackingToken,
      /**
       * The code that did not apply, if one did not.
       *
       * On a 201 rather than as an error, because the booking succeeded — see
       * the note beside `promoRefusal`. The form shows the sentence beside the
       * total so the customer learns their code was refused at the moment they
       * would otherwise be wondering why the price is what it is.
       */
      promoRefused: promoRefusal ?? undefined,
    });

    // After the response, and never on a replay.
    //
    // Sent afterwards for the reason `/auth/register` sends its confirmation
    // there: the booking is already saved and dispatchable, and putting
    // Resend's ten-second budget in front of the 201 would risk a customer
    // being told their pickup failed when it is on the board. Skipped on a
    // replay because the offline queue re-POSTs a booking the customer has
    // already been mailed about, and a second copy of the same confirmation
    // reads like a second pickup.
    if (!replayed) void mailBookingConfirmation(view);
  })
);

/**
 * What only the desk may write through a patch.
 *
 * `status` is the dispatch stage: the courier and the hub own it, and a customer
 * echoing their own record back must not move it. `amount` is on the list too: it
 * is derived by `quoteBooking` at creation, and a patch that rewrote it would undo
 * that on the next address correction.
 *
 * Dropped rather than refused, which is the treatment `planId` already gets and
 * for a practical reason: the website diffs its whole ledger into per-id patches,
 * so every edit it sends carries every field of the record. Refusing would fail an
 * address correction because it mentioned a price it was not changing.
 */
const SUPERVISOR_ONLY_FIELDS = ['status', 'amount'] as const;

/**
 * The schedule. Stripped from a customer's patch, and only from theirs.
 *
 * `applyBookingPatch` has always written these, and `PATCH /:id` has always
 * accepted them — which meant the route that corrects a house number was also
 * the route that could drag a collection the courier was standing in front of
 * into next week, with no capacity check on where it landed and no limit on how
 * often. `POST /:id/reschedule` is where a customer moves a booking now; it is
 * the only path that asks whether the move is allowed and whether the new
 * window has room.
 *
 * The desk keeps them. A supervisor moving an order is doing dispatch — they
 * are the ones who know a courier called in sick — and the dashboard's
 * whole-record echoes carry the schedule on every unrelated edit, so refusing
 * would break an address correction for mentioning a date it was not changing.
 */
const SCHEDULE_FIELDS = ['pickupDate', 'pickupTime', 'deliveryDate', 'deliveryTime'] as const;

/**
 * The money. Stripped from every patch, whoever is asking.
 *
 * `POST /:id/payment` owns these four, and it is the only thing that writes them
 * — it takes the money, or verifies that somebody else did, before it stamps
 * anything. A patch cannot do either, so a patch that carries `paymentStatus:
 * 'Paid'` is only ever a claim about a payment.
 *
 * Both clients used to make exactly that claim with a reference they had generated
 * locally, and the desk did it last: `TXN-ADMIN-` plus six random digits, written
 * straight into the ledger because a supervisor token skipped the list above. The
 * desk now settles cash through the payment route like everybody else.
 *
 * `paymentMethod` is here despite being a label rather than a state. It is written
 * once at creation and never deliberately patched, so the only patches that carry
 * it are whole-record echoes — and one from a browser tab holding a stale mirror
 * would put `Pay on Pickup` back on a booking the desk had settled in cash, which
 * reads as a bill that was never collected.
 */
const PAYMENT_LEDGER_FIELDS = [
  'paymentStatus',
  'paymentMethod',
  'paidAt',
  'transactionRef',
] as const;

bookingsRouter.patch(
  '/:id',
  guard(async (req, res) => {
    // `planId` is dropped for the same reason POST derives it rather than
    // accepting it: `applyBookingPatch` would write it onto the job, and a job
    // with a plan is dispatched at elite priority. Membership is granted by
    // /api/accounts/plan and nowhere else, so editing a booking cannot confer
    // one on an order that was not booked under it.
    const { planId: _ignored, ...body } = req.body as Partial<Booking>;

    const outcome = await store.tx(async (t) => {
      const existing = await t.jobs.find(req.params.id, { lock: true });
      if (!existing) return { kind: 'missing' } as const;

      const access = await resolveBookingAccess(req, existing);
      if (!access) return { kind: 'missing' } as const;

      const patch = { ...body };
      for (const field of PAYMENT_LEDGER_FIELDS) delete patch[field];
      if (access.kind !== 'supervisor') {
        for (const field of SUPERVISOR_ONLY_FIELDS) delete patch[field];
        for (const field of SCHEDULE_FIELDS) delete patch[field];
      }

      // Nobody patches the allowance — see the note beside it in
      // `applyBookingPatch`. Deleted here as well as ignored there so a supervisor
      // echo cannot refill a customer's moves either.
      delete patch.rescheduleCount;

      const job = await t.jobs.upsert(applyBookingPatch(existing, patch));

      /**
       * The two supervisor-only fields are the two worth a trail entry.
       *
       * Compared after the patch was applied rather than taken from the request
       * body, because the website sends whole-record echoes: every address
       * correction it makes mentions the stage and the price it is not changing,
       * and an audit trail full of "stage advance: In Care → In Care" is a trail
       * nobody reads. A customer's own edit is not recorded here — they are not
       * the party this pane holds to account, and their changes are theirs.
       */
      if (access.kind === 'supervisor') {
        if (existing.status !== job.status) {
          await recordAudit(t, {
            actor: access.supervisor.email,
            actorName: access.supervisor.name,
            action: 'Stage advance',
            details:
              `Moved order ${job.id} from ${toBookingStatus(existing.status)} to ` +
              `${toBookingStatus(job.status)} by hand`,
            type: 'stage',
            orderId: job.id,
            subject: job.customer.email,
          });
        }

        if (existing.payment.amount !== job.payment.amount) {
          await recordAudit(t, {
            actor: access.supervisor.email,
            actorName: access.supervisor.name,
            action: 'Amount changed',
            details:
              `Changed the bill on order ${job.id} from ` +
              `GHS ${existing.payment.amount.toFixed(2)} to GHS ${job.payment.amount.toFixed(2)}`,
            type: 'payment',
            orderId: job.id,
            subject: job.customer.email,
          });
        }
      }

      // The reader comes back out with the row. This route resolves access
      // inside the transaction — it needs the locked job to decide it — and the
      // response has to know who it is answering to leave the hub's code off.
      return { kind: 'ok', job, viewer: access } as const;
    });

    if (outcome.kind === 'missing') {
      notFound(res, 'Booking');
      return;
    }
    res.json(await bookingView(outcome.job, outcome.viewer));
  })
);

/**
 * Moves a booking to another day or another window.
 *
 * Its own route rather than a field on `PATCH /:id`, because rescheduling is
 * four things a patch cannot do: it asks whether the booking is still movable,
 * it checks the window it is moving *into* for room, it spends one of a finite
 * allowance, and it tells the customer it happened. A patch that wrote
 * `pickupDate` did none of those — and it could do it to a job whose courier was
 * already at the door.
 *
 * What it deliberately does not do is reprice. Same services, same total, same
 * reference, same three hand-off codes: the customer keeps everything except the
 * date. That is the difference between this and the cancel-and-rebook they had
 * to do before, which lost all four.
 *
 * Open to whoever can already read the booking — a session, or the tracking
 * token a guest left with. A guest who booked from the website has no account to
 * sign into and is exactly the customer most likely to need this.
 */
bookingsRouter.post(
  '/:id/reschedule',
  guard(async (req, res) => {
    const { pickupDate, pickupTime, deliveryTime } = (req.body ?? {}) as {
      pickupDate?: string;
      pickupTime?: string;
      deliveryTime?: string;
    };

    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    // A courier is not a party to when the customer wants their laundry
    // collected. They move a job's *status*, through the rider routes.
    if (access.kind === 'rider') {
      res.status(403).json({ error: 'Only the customer or the desk can move a booking.' });
      return;
    }

    const request = {
      pickupDate: pickupDate ?? '',
      pickupTime: pickupTime ?? '',
      deliveryTime,
    };

    /**
     * The policy, from core — the same function both order screens call to
     * decide whether to offer the button at all.
     *
     * The desk is held to it too, with one exception below. A supervisor moving
     * a booking is still moving it into a window that has to exist and has to
     * have room, and still onto a date that has not passed; what they may
     * ignore is the customer's *allowance*, which is a rule about how often a
     * customer may change their mind rather than one about dispatch.
     */
    const verdict = checkReschedule(job, request);

    if (!verdict.ok && !(access.kind === 'supervisor' && verdict.reason === 'allowance-spent')) {
      // `no-change` is the customer having confirmed twice, which is a replay
      // rather than a mistake: hand back the booking as it stands instead of an
      // error the client would have to special-case.
      if (verdict.reason === 'no-change') {
        res.json(await bookingView(job, access));
        return;
      }

      res.status(409).json({ error: verdict.message, reason: verdict.reason });
      return;
    }

    const nextDelivery = rescheduledDelivery(request.pickupDate);
    const nextDeliveryTime = deliveryTime ?? job.schedule.deliveryTime;

    /**
     * Room in the window it is moving into, checked here for the reason the
     * create route checks it: `checkReschedule` runs in three places, two of
     * which have no database to ask.
     *
     * The job's own place is discounted, so a customer changing only their
     * return window is not refused the collection they already hold.
     */
    const pickupWindow = await windowState(
      'pickup',
      request.pickupDate,
      request.pickupTime,
      job.id
    );

    if (pickupWindow.full) {
      res.status(409).json({
        error: 'That collection window filled up. Choose another window, or another day.',
        reason: 'slot-full',
        slot: request.pickupTime,
        date: request.pickupDate,
      });
      return;
    }

    if (nextDeliveryTime) {
      /**
       * The return has to still be reachable from the new collection.
       *
       * A customer who moves a Tuesday morning pickup to Tuesday evening has
       * not touched their return window, but a same-day return that was fine
       * before it moved may now fall before the laundry is back. Refused rather
       * than silently dropped: telling them to pick a later one is better than
       * quietly leaving them without a window at all.
       */
      const offered = deliverySlotsFor(request.pickupDate, request.pickupTime, nextDelivery);

      if (!offered.some((slot) => slot.label === nextDeliveryTime)) {
        res.status(409).json({
          error:
            'Your return window is now before your laundry would be back. ' +
            'Choose a later one along with the new collection.',
          reason: 'delivery-before-pickup',
        });
        return;
      }

      const deliveryWindow = await windowState('delivery', nextDelivery, nextDeliveryTime, job.id);

      if (deliveryWindow.full) {
        res.status(409).json({
          error: 'That return window is full. Choose another.',
          reason: 'delivery-slot-full',
          slot: nextDeliveryTime,
          date: nextDelivery,
        });
        return;
      }
    }

    const previous = { pickupDate: job.schedule.pickupDate, pickupTime: job.schedule.pickupTime };

    const outcome = await store.tx(async (t) => {
      /**
       * Re-read under a lock, and re-check.
       *
       * Everything above ran against a row nobody was holding, and the thing
       * most likely to have happened in between is the one that matters most: a
       * courier accepting the job. Re-running the policy on the locked row is
       * what stops a booking being moved out from under a courier who took it
       * while the customer was choosing a date.
       */
      const current = await t.jobs.find(job.id, { lock: true });
      if (!current) return { kind: 'missing' } as const;

      const recheck = checkReschedule(current, request);
      if (
        !recheck.ok &&
        recheck.reason !== 'no-change' &&
        !(access.kind === 'supervisor' && recheck.reason === 'allowance-spent')
      ) {
        return { kind: 'refused', verdict: recheck } as const;
      }

      const moved = applyBookingPatch(current, {
        pickupDate: request.pickupDate,
        pickupTime: request.pickupTime,
        deliveryDate: nextDelivery,
        deliveryTime: nextDeliveryTime,
      });

      /**
       * The allowance is spent by the customer, not by the desk.
       *
       * A supervisor moving an order is doing dispatch — a courier called in
       * sick, a van broke down — and charging that to the customer's two moves
       * would mean the laundry's own problem cost them the ability to solve
       * theirs.
       */
      if (access.kind !== 'supervisor') {
        moved.schedule.rescheduleCount = (current.schedule.rescheduleCount ?? 0) + 1;
      }
      moved.schedule.rescheduledAt = new Date().toISOString();

      const saved = await t.jobs.upsert(moved);

      if (access.kind === 'supervisor') {
        await recordAudit(t, {
          actor: access.supervisor.email,
          actorName: access.supervisor.name,
          action: 'Booking rescheduled',
          details:
            `Moved order ${saved.id} from ${previous.pickupDate} ${previous.pickupTime} ` +
            `to ${saved.schedule.pickupDate} ${saved.schedule.pickupTime}`,
          type: 'stage',
          orderId: saved.id,
          subject: saved.customer.email,
        });
      }

      /**
       * The desk finds out either way.
       *
       * A collection that moved is a round that has to be re-planned, and the
       * board is where that gets noticed. Keyed `notif-reschedule-` plus the id
       * rather than the id alone, so it does not collide with the `notif-` row
       * the create route wrote for the same booking.
       */
      await t.notifications.insert({
        id: `notif-reschedule-${saved.id}`,
        title: 'Pickup Rescheduled',
        body:
          `${saved.customer.name} moved ${saved.id} from ${previous.pickupDate}, ` +
          `${previous.pickupTime} to ${saved.schedule.pickupDate}, ${saved.schedule.pickupTime}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'order',
        orderId: saved.id,
        read: false,
      });

      return { kind: 'ok', job: saved } as const;
    });

    if (outcome.kind === 'missing') {
      notFound(res, 'Booking');
      return;
    }

    if (outcome.kind === 'refused') {
      res.status(409).json({ error: outcome.verdict.message, reason: outcome.verdict.reason });
      return;
    }

    const view = await bookingView(outcome.job, access);
    res.json(view);

    // After the response, for the reason the confirmation is sent after the 201:
    // the booking has already moved, and a mail provider's bad morning must not
    // read to the customer as a change that did not take.
    void mailReschedule(
      view,
      previous,
      Math.max(0, MAX_RESCHEDULES - (outcome.job.schedule.rescheduleCount ?? 0))
    );
  })
);

/**
 * Calls a booking off.
 *
 * Its own route because the thing it does was, until now, impossible: the
 * customer app cancelled by sending `PATCH /:id` with `status: 'Cancelled'`,
 * and `status` is on `SUPERVISOR_ONLY_FIELDS`. The patch was accepted, the field
 * was dropped on the way in, and the response came back carrying the stage the
 * job still had. The app had already written `Cancelled` to its own mirror, so
 * the cancellation looked like it took — until the next pull replaced the mirror
 * and the order came back to the stage it had never left.
 *
 * The rules are `checkCancel` in core, which the customer's order screen reads
 * too so the button stops being offered before it is pressed. The desk is not
 * held to them: a supervisor calling off a load that is already in the building
 * is a decision somebody is making on purpose, and they have `POST /:id/refund`
 * to settle what it costs.
 *
 * Deliberately does not touch the money. A paid booking stays `Paid` here, and
 * the refund is a separate supervisor act with a ledger row behind it — which is
 * what the cancel dialog has always promised: "anything already paid is refunded
 * to your wallet by the concierge desk." Silently reversing a payment from a
 * customer-facing route would be a balance moving with nobody's name on it.
 *
 * Idempotent, because the offline queue replays: a booking that is already
 * cancelled answers with itself rather than a 409, so a write that reaches the
 * server twice is the right answer arriving twice.
 */
bookingsRouter.post(
  '/:id/cancel',
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    // A courier is not a party to whether the customer still wants their
    // laundry collected. They move a job's *status* through the rider routes,
    // and a job they cannot service goes back to the pool rather than off it.
    if (access.kind === 'rider') {
      res.status(403).json({
        error: 'Only the customer or the desk can cancel a booking.',
        reason: 'cancel-not-yours',
      });
      return;
    }

    const outcome = await store.tx(async (t) => {
      const current = await t.jobs.find(job.id, { lock: true });
      if (!current) return { kind: 'missing' } as const;

      // Re-read under the lock, because the courier may have collected the bags
      // between the read above and here — which is the one change that turns an
      // allowed cancellation into a refused one.
      const verdict = checkCancel(current.status);

      // Idempotent: the offline queue replays, and a cancellation that arrives
      // twice is the right answer arriving twice rather than a conflict.
      if (!verdict.ok && verdict.reason === 'already-cancelled') {
        return { kind: 'ok', job: current } as const;
      }

      /**
       * The desk is exempt from the policy about where the bags are, not from
       * the arrow of time. A supervisor may call off a load that is already in
       * the building — that is a decision somebody is making on purpose, and
       * `POST /:id/refund` is how they settle it — but a delivered order has
       * nothing left to call off, whoever is asking.
       */
      if (!verdict.ok && (access.kind !== 'supervisor' || verdict.reason === 'delivered')) {
        return { kind: 'refused', verdict } as const;
      }

      const cancelled = await t.jobs.upsert({
        ...current,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });

      if (access.kind === 'supervisor') {
        await recordAudit(t, {
          actor: access.supervisor.email,
          actorName: access.supervisor.name,
          action: 'Booking cancelled',
          details:
            `Called off order ${cancelled.id} from ${toBookingStatus(current.status)}` +
            (cancelled.payment.status === 'Paid'
              ? `; the GHS ${cancelled.payment.amount.toFixed(2)} already paid still needs refunding`
              : ''),
          type: 'stage',
          orderId: cancelled.id,
          subject: cancelled.customer.email,
        });
      }

      /**
       * The desk finds out either way.
       *
       * A cancelled collection is a window that just came free and a round that
       * has to be re-planned, and the board is where that gets noticed. Keyed
       * `notif-cancel-` plus the id so it does not collide with the `notif-` row
       * the create route wrote for the same booking, or the reschedule one.
       */
      await t.notifications.insert({
        id: `notif-cancel-${cancelled.id}`,
        title: 'Booking Cancelled',
        body:
          `${cancelled.customer.name} called off ${cancelled.id} ` +
          `(${cancelled.schedule.pickupDate}, ${cancelled.schedule.pickupTime})` +
          (cancelled.payment.status === 'Paid'
            ? ` — GHS ${cancelled.payment.amount.toFixed(2)} is paid and needs refunding.`
            : '.'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'order',
        orderId: cancelled.id,
        read: false,
      });

      return { kind: 'ok', job: cancelled } as const;
    });

    if (outcome.kind === 'missing') {
      notFound(res, 'Booking');
      return;
    }

    if (outcome.kind === 'refused') {
      res.status(409).json({ error: outcome.verdict.message, reason: outcome.verdict.reason });
      return;
    }

    // No viewer, so no hub code — deliberately, and not only because it keeps
    // this route independent of who is reading. A called-off load is never
    // checked in at the hub, so the drop-off code on a cancellation is a number
    // for a hand-off that is not going to happen.
    res.json(await bookingView(outcome.job));
  })
);

/**
 * Settles a booking's bill. The only path to `Paid`, and now the only one in fact
 * as well as in this sentence — `PATCH /:id` no longer writes payment fields for
 * anybody, including the desk.
 *
 * Both clients used to do this themselves: verify a Paystack reference in the
 * browser, then PATCH the booking with `paymentStatus: 'Paid'` and a reference
 * they had generated locally. Three things were wrong with that. The browser was
 * the only thing asserting the payment happened; the amount settled was the
 * client's own figure rather than the job's; and the website's wallet path never
 * debited a wallet at all — it subtracted from a React state variable that was
 * hardcoded to zero.
 *
 * Here the amount is read off the job, which is where `quoteBooking` put it. The
 * caller chooses *how* to pay and proves it; they do not get to say what it cost
 * or whether it worked. There are three ways to prove it:
 *
 *  - **Wallet** — the balance moves, in `charge`, on a locked account row.
 *  - **Paystack** — the reference is verified against Paystack, and checked to be
 *    for this booking and for enough.
 *  - **Cash** — a supervisor states that the money was handed over. There is no
 *    third party to verify, so the record says who at the desk recorded it, and
 *    `DELETE /:id/payment` can take it back. This is the honest form of what the
 *    dashboard used to do by inventing a `TXN-ADMIN-` reference.
 */
bookingsRouter.post(
  '/:id/payment',
  guard(async (req, res) => {
    const { method, reference } = (req.body ?? {}) as { method?: string; reference?: string };

    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    if (job.payment.status === 'Paid') {
      // Idempotent: both clients replay queued writes, and a second attempt on a
      // settled bill is the right answer arriving twice rather than an error.
      res.json(await bookingView(job, access));
      return;
    }

    const owed = job.payment.amount;
    if (!(owed > 0)) {
      res.status(409).json({ error: 'There is nothing to pay on this booking.' });
      return;
    }

    if (method === 'Wallet') {
      /**
       * The wallet debit and the points it earns happen in `charge`, on a locked
       * account row, with its ledger entry in the same transaction. It is the only
       * thing that moves a balance, and it refuses when the balance cannot cover
       * the bill — which is what makes this a payment rather than a claim.
       *
       * Requires a session: a tracking token identifies a booking, not a wallet.
       */
      if (access.kind !== 'customer') {
        res.status(403).json({
          error: 'Sign in to pay from your FreshFold wallet.',
          reason: 'wallet-needs-session',
        });
        return;
      }

      const outcome = await charge({
        email: access.account.email,
        amount: owed,
        description: `Booking ${job.id} — ${job.service.type}`,
        bookingId: job.id,
        // Deterministic, so a replayed request settles once. The job can only be
        // paid from a wallet once, so the id is the whole of the identity.
        reference: `TXN-BOOKING-${job.id}`,
      });

      if (!outcome.ok) {
        res.status(outcome.reason === 'insufficient-funds' ? 409 : 400).json({
          error:
            outcome.reason === 'insufficient-funds'
              ? `Top up ₵${(outcome.shortfall ?? 0).toFixed(2)} to cover this booking.`
              : 'That payment could not be taken.',
          reason: outcome.reason,
          shortfall: outcome.shortfall,
        });
        return;
      }

      const settled = await markPaid(job.id, 'Wallet', outcome.transaction?.reference);
      res.json(settled ? await bookingView(settled, access) : await bookingView(job, access));
      return;
    }

    if (method === 'Paystack') {
      if (!reference?.trim()) {
        res.status(400).json({
          error: 'A card or mobile-money payment needs its Paystack reference.',
          reason: 'reference-required',
        });
        return;
      }

      const verified = await verifyPaystackTransaction(reference);
      if (!verified.ok) {
        res.status(verified.status).json({ error: verified.error, reason: 'verify-failed' });
        return;
      }

      const payment = verified.verification;

      if (!payment.paid) {
        res.status(402).json({
          error: `Paystack says this payment is ${payment.status}. Complete the checkout and try again.`,
          reason: 'payment-not-settled',
          paystackStatus: payment.status,
        });
        return;
      }

      /**
       * The payment has to have been opened as a payment for *this* booking,
       * and for enough.
       *
       * Three checks, and the first one is newer than the other two. Without the
       * booking check a customer could pay for one ₵30 wash and quote its
       * reference against every other booking they hold — the ledger's
       * idempotency would then make each one look settled. Without the amount
       * check, a ₵5 payment settles a ₵180 office clean.
       *
       * Those two were not sufficient together, which is what the purpose check
       * is for. `metadata` used to be forwarded to Paystack straight from the
       * checkout request, so a customer composed it: an intent carrying both
       * `type: 'wallet_topup'` and this booking's `booking_id` satisfied the
       * wallet route's gate *and* this one. Pay ₵200 once, credit ₵200 to the
       * wallet, then spend the same reference here — and because
       * `transactions.upsert` conflicts on the reference, this write overwrote
       * the top-up's ledger row rather than sitting beside it. The statement
       * afterwards showed a single ₵200 payment against a ₵200 balance that
       * nothing explained.
       *
       * `/paystack/initialize` now writes the purpose itself, from a fixed list,
       * and writes `booking_id` only on the branch that set it to `booking`. So
       * the two purposes are mutually exclusive at the point the intent is
       * created, and this check is what makes that exclusivity load-bearing here
       * rather than merely true upstream.
       */
      if (paymentPurpose(payment.metadata) !== BOOKING_PURPOSE) {
        res.status(403).json({
          error: 'That payment was not opened as a payment for a booking.',
          reason: 'reference-not-for-booking',
        });
        return;
      }

      // `paymentBookingId` answers null unless the purpose is `booking`, so a
      // top-up carrying a stray `booking_id` — the shape the old format let a
      // customer compose — names nothing here even if it reached this line.
      if (paymentBookingId(payment.metadata) !== job.id) {
        res.status(403).json({
          error: 'That payment was not made for this booking.',
          reason: 'reference-not-for-booking',
        });
        return;
      }

      if (payment.amount + 0.01 < owed) {
        res.status(402).json({
          error: `That payment covers ₵${payment.amount.toFixed(2)} of ₵${owed.toFixed(2)}.`,
          reason: 'amount-short',
        });
        return;
      }

      /**
       * One reference settles one thing.
       *
       * Belt to the braces above: even with the purpose written server-side, a
       * reference that is already in the ledger against something else must not
       * be re-pointed at this booking. `transactions.upsert` conflicts on
       * `reference` and updates in place, so without this check a second claim
       * does not fail loudly — it silently rewrites the row the first claim
       * left, taking the evidence of the double settlement with it.
       *
       * A replay of *this* booking's own payment finds its own row and passes,
       * which is what keeps the route idempotent for the offline queues.
       */
      const claimed = await store.transactions.findByReference(reference.trim());
      if (claimed && claimed.bookingId !== job.id) {
        res.status(409).json({
          error: claimed.bookingId
            ? 'That payment has already been recorded against another order.'
            : 'That payment has already been recorded against your wallet.',
          reason: 'reference-already-claimed',
        });
        return;
      }

      // Recorded against the customer when we know who they are. A guest paying
      // with a tracking token has no account to file a statement under.
      if (access.kind === 'customer') {
        await store.transactions.upsert({
          id: `txn-booking-${job.id}`,
          bookingId: job.id,
          userEmail: access.account.email,
          amount: payment.amount,
          method: 'Paystack',
          status: 'Successful',
          reference: reference.trim(),
          timestamp: new Date().toISOString(),
          description: `Booking ${job.id} — ${job.service.type}`,
        });
      }

      const settled = await markPaid(job.id, 'Paystack', reference.trim());
      res.json(settled ? await bookingView(settled, access) : await bookingView(job, access));
      return;
    }

    if (method === 'Cash') {
      /**
       * Money handed to a courier at the door.
       *
       * Nothing external can confirm this — there is no gateway and no balance to
       * move, only somebody at the desk saying the cash arrived. So the record
       * carries who said it, and the reversal below exists because a statement
       * keyed in by hand is a statement that can be keyed in wrongly.
       *
       * Supervisor only, for the same reason: a customer marking their own bill
       * settled in cash is the claim this whole route was written to stop.
       */
      if (access.kind !== 'supervisor') {
        res.status(403).json({
          error: 'Only the desk can record a cash collection.',
          reason: 'cash-needs-supervisor',
        });
        return;
      }

      await store.transactions.upsert({
        id: `txn-booking-${job.id}`,
        bookingId: job.id,
        // The customer's statement, when the booking carries an address that has
        // an account behind it. A guest's does not, and `transactions.list` only
        // ever answers for a signed-in address, so this is harmless either way.
        userEmail: job.customer.email,
        amount: owed,
        method: 'Cash',
        status: 'Successful',
        // Deterministic, and `upsert` conflicts on the reference, so a replayed
        // request records the collection once. Not a gateway reference and not
        // shaped like one: nothing outside this database knows it.
        reference: `CASH-${job.id}`,
        timestamp: new Date().toISOString(),
        description: `Booking ${job.id} — cash collected, recorded by ${access.supervisor.email}`,
      });

      // No reference on the booking itself. The desk's word is what settled this,
      // and a reference in that field would read as a payment some processor had
      // confirmed. The receipt and the ledger show the method instead.
      const settled = await markPaid(job.id, 'Cash', undefined);

      // Filed outside a transaction because this settlement is not one either —
      // the statement row and `markPaid` are already separate round trips. The
      // entry names the amount and the desk, which for a cash collection is the
      // whole of the evidence that it happened.
      await recordAudit(store, {
        actor: access.supervisor.email,
        actorName: access.supervisor.name,
        action: 'Payment settlement',
        details: `Recorded GHS ${owed.toFixed(2)} collected in cash on order ${job.id}`,
        type: 'payment',
        orderId: job.id,
        subject: job.customer.email,
      });

      res.json(settled ? await bookingView(settled, access) : await bookingView(job, access));
      return;
    }

    res.status(400).json({
      error: 'A payment needs a method of Wallet, Paystack or Cash.',
    });
  })
);

/**
 * Takes back a cash settlement. Supervisor only.
 *
 * Only cash: it is the one payment nothing outside this database recorded, so it
 * is the one a supervisor can withdraw by saying so. A wallet debit moved a
 * balance and a Paystack payment moved somebody's money, and neither is undone by
 * changing a status — those need a refund, which is a different act with a
 * different record.
 *
 * The booking goes back to `Pay on Pickup` rather than `Pending`, because that is
 * what it is: an unpaid order whose bill is collected at the door.
 */
bookingsRouter.delete(
  '/:id/payment',
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    if (access.kind !== 'supervisor') {
      res.status(403).json({
        error: 'Only the desk can reverse a settlement.',
        reason: 'reversal-needs-supervisor',
      });
      return;
    }

    if (job.payment.status !== 'Paid') {
      // Idempotent, like the settle path: a replayed reversal is the right answer
      // arriving twice.
      res.json(await bookingView(job, access));
      return;
    }

    if (job.payment.method !== 'Cash') {
      res.status(409).json({
        error:
          `This booking was paid by ${job.payment.method ?? 'another method'}. ` +
          'That money has actually moved, so it needs a refund rather than a change of status.',
        reason: 'not-a-cash-settlement',
      });
      return;
    }

    const amount = job.payment.amount;

    const reversed = await store.tx(async (t) => {
      const current = await t.jobs.find(job.id, { lock: true });
      if (!current) return null;

      // Re-checked under the lock: a refund or a second desk may have moved this
      // between the read above and here.
      if (current.payment.status !== 'Paid' || current.payment.method !== 'Cash') return current;

      return t.jobs.upsert({
        ...current,
        updatedAt: new Date().toISOString(),
        payment: {
          ...current.payment,
          status: 'Pay on Pickup',
          method: undefined,
          transactionRef: undefined,
          paidAt: undefined,
        },
      });
    });

    if (!reversed) {
      notFound(res, 'Booking');
      return;
    }

    /**
     * An offsetting line rather than a deletion of the original.
     *
     * The customer was told the money was received; if that is being taken back,
     * their statement should say so rather than quietly losing the entry. Nothing
     * sums this list — the wallet balance lives on the account and the statement is
     * a display of movements — so this is an audit line, not an accounting entry.
     */
    await store.transactions.upsert({
      id: `txn-booking-${job.id}-reversal`,
      bookingId: job.id,
      userEmail: job.customer.email,
      amount,
      method: 'Cash reversal',
      status: 'Successful',
      reference: `CASH-${job.id}-REVERSAL`,
      timestamp: new Date().toISOString(),
      description: `Booking ${job.id} — cash settlement reversed by ${access.supervisor.email}`,
    });

    // A reversal is the entry most worth having: the desk is withdrawing a claim
    // it made itself, and the customer has already been told the money arrived.
    await recordAudit(store, {
      actor: access.supervisor.email,
      actorName: access.supervisor.name,
      action: 'Payment reversal',
      details:
        `Took back the GHS ${amount.toFixed(2)} cash settlement on order ${job.id}; ` +
        'the bill is collectable at the door again',
      type: 'payment',
      orderId: job.id,
      subject: job.customer.email,
    });

    res.json(await bookingView(reversed, access));
  })
);

/**
 * Refunds a settled booking to the customer's wallet. Supervisor only.
 *
 * The act the reversal above kept pointing at and could not perform. Until now
 * `Refunded` was a `PaymentStatus` value that no route ever set: a customer who
 * paid ₵105 for a pickup the laundry then cancelled had their money recorded as
 * received and no way to get it back, and the desk's only option was to leave
 * the order marked `Paid` or lie about it with a status change.
 *
 * **To the wallet.** Not back down the rail it came in on — that is a separate
 * Paystack API with its own settlement delay — and the cancel dialog has been
 * promising exactly this all along: "anything already paid is refunded to your
 * wallet by the concierge desk." The customer gets a balance they can spend
 * today rather than a card refund in five working days.
 *
 * Three things make it safe to click twice. The reference is the booking's, so
 * `refund` finds its own ledger row and returns it rather than crediting again.
 * The job is re-read under its row lock before the status moves. And the status
 * check is `Paid`, so a booking already refunded answers with itself.
 *
 * Deliberately no partial refunds. A part-refund is a negotiation — a stained
 * shirt, a late delivery — and it wants a reason, an amount somebody agreed and
 * a record of who agreed it. That is a bigger feature than this, and a field
 * that silently accepted any number would be the wrong half of it. What this
 * does is the whole bill or nothing.
 */
bookingsRouter.post(
  '/:id/refund',
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    if (access.kind !== 'supervisor') {
      res.status(403).json({
        error: 'Only the desk can refund a booking.',
        reason: 'refund-needs-supervisor',
      });
      return;
    }

    // Idempotent, like the settle and reversal paths: a booking already refunded
    // answers with itself rather than crediting a second time.
    if (job.payment.status === 'Refunded') {
      res.json(await bookingView(job, access));
      return;
    }

    if (job.payment.status !== 'Paid') {
      res.status(409).json({
        error: 'Only a settled booking can be refunded.',
        reason: 'not-settled',
      });
      return;
    }

    const amount = job.payment.amount;
    if (!(amount > 0)) {
      res.status(409).json({
        error: 'There is nothing to refund on this booking.',
        reason: 'nothing-to-refund',
      });
      return;
    }

    /**
     * The money moves before the status does.
     *
     * If the credit fails the booking stays `Paid`, which is true — nothing was
     * returned — and the desk can try again. The other order would leave a
     * booking marked `Refunded` with the customer no better off, which is the
     * failure that cannot be seen from either end.
     */
    const outcome = await refund({
      email: job.customer.email,
      amount,
      description: `Booking ${job.id} — refunded by ${access.supervisor.email}`,
      bookingId: job.id,
      reference: `REFUND-${job.id}`,
    });

    if (!outcome.ok) {
      // `no-account` is the realistic one: a guest booking has no wallet to
      // credit, and the desk has to settle that outside the app.
      res.status(outcome.reason === 'no-account' ? 409 : 400).json({
        error:
          outcome.reason === 'no-account'
            ? 'This booking has no FreshFold account behind it, so there is no wallet to refund to. ' +
              'Return the money directly and reverse it from the ledger.'
            : 'That refund could not be applied.',
        reason: outcome.reason,
      });
      return;
    }

    const refunded = await store.tx(async (t) => {
      const current = await t.jobs.find(job.id, { lock: true });
      if (!current) return null;

      // Re-checked under the lock. The credit above is idempotent on the
      // reference, so a second desk arriving here has already been a no-op in
      // the ledger and only needs the status to agree.
      if (current.payment.status === 'Refunded') return current;

      return t.jobs.upsert({
        ...current,
        updatedAt: new Date().toISOString(),
        payment: { ...current.payment, status: 'Refunded' },
      });
    });

    if (!refunded) {
      notFound(res, 'Booking');
      return;
    }

    await recordAudit(store, {
      actor: access.supervisor.email,
      actorName: access.supervisor.name,
      action: 'Payment refund',
      details:
        `Refunded GHS ${amount.toFixed(2)} on order ${job.id} to ` +
        `${job.customer.email}'s wallet`,
      type: 'payment',
      orderId: job.id,
      subject: job.customer.email,
    });

    res.json(await bookingView(refunded, access));
  })
);

/**
 * Rates the courier who carried a delivery.
 *
 * The write path for `riders.rating`, which has sat at zero since the schema was
 * written — and which the concierge chatbot has been telling customers they can
 * move. The column existed, the seed comment explained why it was not
 * pre-filled, and nothing ever wrote to it.
 *
 * Four gates, and each is a way the number could otherwise be made meaningless:
 *
 *  - **The customer whose order it is.** `resolveBookingAccess` already answers
 *    this; the rating is refused for a courier or a supervisor, who are the two
 *    parties with a reason to move it.
 *  - **Delivered only.** A rating before the work is done is a rating of
 *    something that has not happened. It is also how a courier could be marked
 *    down for a delay the laundry caused.
 *  - **A courier to rate.** A job delivered with no `riderId` on it — a desk
 *    completion, a reassignment gone wrong — has nobody to attribute this to.
 *  - **One per job**, enforced by the primary key rather than by a check that
 *    could race. A revision overwrites; it does not stack.
 *
 * The stars are clamped rather than rejected at the edges, because a slider that
 * emits 6 is a client bug and refusing it loses a real opinion; a value that is
 * not a number at all is refused, because that is not an opinion.
 *
 * **No loyalty points.** Foldie's script promised them and this does not pay
 * them — a point-per-rating is farmable by anybody willing to press one star on
 * every order, and defending it needs its own story about thresholds and
 * clawbacks. The chatbot's line has been corrected to describe what actually
 * happens instead of what did not.
 */
bookingsRouter.post(
  '/:id/rating',
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    if (access.kind !== 'customer' && access.kind !== 'tracking') {
      res.status(403).json({
        error: 'Only the customer on an order can rate its courier.',
        reason: 'rating-is-the-customers',
      });
      return;
    }

    if (job.status !== 'delivered') {
      res.status(409).json({
        error: 'This order has not been delivered yet.',
        reason: 'not-delivered',
      });
      return;
    }

    const riderId = job.dispatch.riderId;
    if (!riderId) {
      res.status(409).json({
        error: 'No courier is recorded on this order, so there is nobody to rate.',
        reason: 'no-courier',
      });
      return;
    }

    const body = (req.body ?? {}) as { stars?: unknown; comment?: unknown };
    const raw = typeof body.stars === 'number' ? body.stars : Number(body.stars);

    if (!Number.isFinite(raw)) {
      res.status(400).json({ error: 'A rating is a number of stars from 1 to 5.' });
      return;
    }

    const stars = Math.min(5, Math.max(1, Math.round(raw)));
    const comment =
      typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : '';

    const { average, count } = await store.ratings.record({
      jobId: job.id,
      riderId,
      customerEmail: job.customer.email,
      stars,
      comment,
    });

    res.json({ jobId: job.id, stars, comment, riderRating: average, riderRatingCount: count });
  })
);

/**
 * Stamps a job as settled, under the row lock.
 *
 * Re-read inside the transaction rather than patching the copy the route is
 * holding: the debit above is a round trip of its own, and the job may have moved
 * on in between.
 */
async function markPaid(
  id: string,
  method: string,
  reference: string | undefined
): Promise<Job | null> {
  return store.tx(async (t) => {
    const job = await t.jobs.find(id, { lock: true });
    if (!job) return null;
    if (job.payment.status === 'Paid') return job;

    return t.jobs.upsert({
      ...job,
      updatedAt: new Date().toISOString(),
      payment: {
        ...job.payment,
        status: 'Paid',
        method,
        transactionRef: reference,
        paidAt: new Date().toISOString(),
      },
    });
  });
}

bookingsRouter.delete(
  '/:id',
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Booking');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Booking');
      return;
    }

    /**
     * A customer clearing their history cannot delete a live pickup.
     *
     * The portal's "remove order from your account history" is this route, and
     * it deletes the job outright rather than hiding a row — so on an order in
     * flight it takes the pickup off the courier's board while they are riding
     * to the door, and takes the desk's record of it with them. Tidying a
     * history is a reasonable thing to want; doing it to a job somebody is
     * currently carrying is not what anybody pressing that button means.
     *
     * The desk is not held to this. A supervisor removing a live order is a
     * decision somebody is making on purpose.
     */
    if (access.kind !== 'supervisor' && !isTerminal(job.status)) {
      res.status(409).json({
        error:
          'This pickup is still in progress, so it cannot be removed yet. ' +
          'Contact the concierge desk if you need it cancelled.',
        code: 'BOOKING_IN_PROGRESS',
      });
      return;
    }

    // The conversation and the desk notifications hang off the job by foreign
    // key, so Postgres takes them with it rather than leaving messages
    // addressed to an order that no longer exists.
    const removed = await store.jobs.remove(req.params.id);

    if (!removed) {
      notFound(res, 'Booking');
      return;
    }

    /**
     * Written after the delete, and on purpose outside it.
     *
     * `audit_events.order_id` carries no foreign key, so this row outlives the
     * job it names — which is the point: a cascade would mean deleting an order
     * also deletes the record of somebody deleting it. The details come from the
     * copy read at the top of this route, because there is nothing left to read
     * them from now. Only the desk's deletions are recorded; a customer clearing
     * their own history is theirs to clear.
     */
    if (access.kind === 'supervisor') {
      await recordAudit(store, {
        actor: access.supervisor.email,
        actorName: access.supervisor.name,
        action: 'Order deleted',
        details:
          `Deleted order ${job.id} for ${job.customer.name} ` +
          `(${job.service.type}, GHS ${job.payment.amount.toFixed(2)}, ` +
          `${toBookingStatus(job.status)})`,
        type: 'order',
        orderId: job.id,
        subject: job.customer.email,
      });
    }

    res.json({ ok: true });
  })
);

/**
 * There is deliberately no bulk-replace route. The admin dashboard edits the
 * ledger as one array, but a client's copy of it is never guaranteed complete —
 * it may not have synced, and riders create jobs of their own. The web app
 * diffs the array into the per-id writes above instead, so a stale tab can only
 * remove records it actually knew about.
 */

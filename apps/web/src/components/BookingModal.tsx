import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  X,
  Check,
  Wallet,
  Banknote,
  ArrowLeft,
  ArrowRight,
  Minus,
  Plus,
  AlertCircle,
} from 'lucide-react';
import {
  DEFAULT_SCENT,
  DEFAULT_STARCH,
  DELIVERY_TIME_SLOTS,
  PHONE_DIGITS,
  PHONE_LENGTH_MESSAGE,
  PICKUP_TIME_SLOTS,
  SCENTS,
  STARCH_LEVELS,
  deliverySlotsFor,
  encodeFinish,
  isCompletePhone,
  isGarmentService,
  isoDaysFromNow,
  isoPlusDays,
  limitPhoneInput,
  newJobId,
  describeItems,
  quoteBooking,
  samePhone,
  serviceTakesQuantity,
  serviceUnit,
  clampQuantity,
  pluraliseUnit,
  MAX_ITEMS,
  MAX_QUANTITY,
  type BookingItem,
  deriveSuburb,
  type Coords,
  type UserAccount,
} from '@freshfold/core';
import { ApiError } from '@freshfold/core';
import { Booking } from '../types';
import * as store from '../services/store';
import { BOOKABLE_SERVICE_ITEMS } from '../data';
import { useIntent } from '../intent';
import AddressAutocomplete from './AddressAutocomplete';
import PickupPinField, { type PinOrigin } from './PickupPinField';
import { openCheckoutWindow, usePaystackReturn } from './PaystackReturn';
import { paymentLabel, windowLabel } from './ui/slots';
import PaystackMark from './ui/PaystackMark';
import { useDialog } from './ui/useDialog';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookingCreated: (booking: Booking) => void;
}

/**
 * The three questions a collection actually needs answered.
 *
 * This was one 80vh scroll containing every field the form has — contact
 * details, an address, a map, three time pickers, scents, starch, a promo box
 * and four payment panels — and on a phone that is roughly nine screenfuls
 * between "Book a pickup" and a button that books one. A form that long reads
 * as an application rather than an order, and the reader cannot see how much of
 * it is left, which is the specific thing that makes people abandon.
 *
 * Split the way a counter conversation splits: what are we washing, where and
 * when do we fetch it, how are you paying. Each step fits a phone screen, the
 * price stays pinned at the bottom throughout, and the header says which of the
 * three you are on — so the end is always in sight.
 */
const STEPS = [
  { id: 'order', label: 'Your order' },
  { id: 'when', label: 'Where & when' },
  { id: 'pay', label: 'Payment' },
] as const;

/** Which step a given field lives on, so a failed submit lands on it. */
const FIELD_STEP: Record<string, number> = {
  name: 1,
  phone: 1,
  email: 1,
  address: 1,
  pickupDate: 1,
  wallet: 2,
};

/** One field style for the whole form, from the site's tokens. */
const FIELD =
  'w-full rounded-md border border-white/15 bg-brand-charcoal px-4 py-3 text-[15px] text-white placeholder:text-brand-text-muted transition-colors duration-200 focus:border-brand-gold focus:outline-none';
const LABEL = 'block text-[13px] font-medium text-brand-text-light';

/** Money, once, everywhere. */
const cedis = (amount: number) => `₵${amount.toFixed(2)}`;

export default function BookingModal({
  isOpen,
  onClose,
  onBookingCreated,
}: BookingModalProps) {
  /**
   * What the landing page already knows, rather than two preselection props.
   *
   * The form used to be handed a service name and a count, which was everything
   * `App` had to give it. The marketing page now collects a whole order and a
   * collection zone before anyone reaches this form, and re-asking for what has
   * already been said is the friction this modal exists to remove.
   */
  const { intent, clearItems } = useIntent();

  const [step, setStep] = useState(0);
  /**
   * What is wrong, per field, rather than in a browser dialog.
   *
   * This form reported every validation failure through `alert()` — four of
   * them in `handleSubmit` and two more around the card payment. `Contact.tsx`
   * had already written down why that is wrong and fixed it there: an alert
   * steals focus, cannot be styled, cannot be associated with the field it is
   * about, and on some mobile browsers arrives after the keyboard has closed
   * over the answer. It also cannot say *which* of four fields is the problem
   * without spelling it out in prose.
   */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  /**
   * The doorstep, when the customer places one. Left null the dispatch server
   * derives a pin from the typed address, which lands in the right suburb and
   * the wrong street.
   */
  const [pickupPin, setPickupPin] = useState<Coords | null>(null);
  /** How that pin came to be, so the field can say so under the map. */
  const [pinOrigin, setPinOrigin] = useState<PinOrigin>(null);

  /**
   * The collection zone this booking is filed under.
   *
   * Derived, never typed. The dispatch board still groups by suburb and the
   * supervisor still filters on it, but it is a fact about where the pin is,
   * not a separate answer the customer can get wrong — and they routinely did,
   * because "Ayeduase" and a pin on campus were both accepted and nothing
   * reconciled them.
   */
  const suburb = useMemo(() => deriveSuburb(pickupPin, address), [pickupPin, address]);

  /**
   * The services on this order, and how many of each.
   *
   * A list rather than a single service: "two loads of washing and a set of bed
   * linen" is one collection, one courier and one doorstep, and making the
   * customer book it twice produced two jobs for one visit. The first line is
   * the order's primary service — it is what `serviceType` is submitted as, and
   * what the rider app and the desk board display.
   *
   * Quantities are clamped on the way in here and again by `quoteBooking` and
   * the server: this is a form, and a form is not the only thing that can post
   * a booking.
   */
  const [items, setItems] = useState<BookingItem[]>(() => [
    { serviceType: BOOKABLE_SERVICE_ITEMS[0]?.name || 'Washing (Machine & Hand Wash)', quantity: 1 },
  ]);

  /** The primary line, which the rest of the form still speaks in terms of. */
  const service = items[0]?.serviceType ?? '';

  const setItemService = (index: number, next: string) =>
    setItems((current) =>
      current.map((item, i) =>
        // A new service starts at one: four loads of washing is not four car
        // details, and carrying the count across would quote ₵600 for a change
        // of mind.
        i === index ? { serviceType: next, quantity: 1 } : item
      )
    );

  const setItemQuantity = (index: number, next: number) =>
    setItems((current) =>
      current.map((item, i) =>
        i === index ? { ...item, quantity: clampQuantity(next, item.serviceType) } : item
      )
    );

  const addItem = () =>
    setItems((current) =>
      current.length >= MAX_ITEMS
        ? current
        : [
            ...current,
            {
              // The first service they have not already added, so a second line
              // does not open as a duplicate of the first.
              serviceType:
                BOOKABLE_SERVICE_ITEMS.find(
                  (candidate) => !current.some((item) => item.serviceType === candidate.name)
                )?.name ?? BOOKABLE_SERVICE_ITEMS[0].name,
              quantity: 1,
            },
          ]
    );

  // Never below one line: an order with no service is not an order.
  const removeItem = (index: number) =>
    setItems((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));

  const [pickupDate, setPickupDate] = useState('');
  const [pickupTimeSlot, setPickupTimeSlot] = useState<string>(PICKUP_TIME_SLOTS[0]);

  /**
   * How full each window is on the chosen day.
   *
   * Advisory: the booking route enforces the same ceiling regardless, so a form
   * working from a stale answer is refused rather than allowed to overbook. What
   * this buys is the customer finding out *before* they fill in the rest of the
   * form rather than after they press Confirm.
   *
   * Empty while it loads and on any failure — an unreachable server should not
   * grey out every window and make the form look broken.
   */
  const [slotState, setSlotState] = useState<Record<string, { remaining: number; full: boolean }>>({});

  /**
   * The return leg, and the window the customer wants it in.
   *
   * Until this existed the return was `pickupDate + 1` with no time on it and
   * nothing the customer could say about it — they chose the hour their clothes
   * left and had no say at all in the hour they came back.
   *
   * The date is still derived rather than chosen: a standard 24-hour turnaround
   * is what the whole product is written around, and the express service is the
   * exception the desk arranges. What is new is the hour.
   */
  const deliveryDate = useMemo(
    () => isoPlusDays(pickupDate, 1) ?? isoDaysFromNow(2),
    [pickupDate]
  );

  const returnOptions = useMemo(
    () => deliverySlotsFor(pickupDate, pickupTimeSlot, deliveryDate),
    [pickupDate, pickupTimeSlot, deliveryDate]
  );

  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState<string>(DELIVERY_TIME_SLOTS[0]);
  const [deliveryState, setDeliveryState] = useState<
    Record<string, { remaining: number; full: boolean }>
  >({});

  useEffect(() => {
    if (!isOpen || !pickupDate) return;

    let cancelled = false;
    store.api
      .slotAvailability(pickupDate, { deliveryDate })
      .then((answer) => {
        if (cancelled) return;
        const next: Record<string, { remaining: number; full: boolean }> = {};
        for (const row of answer.slots) next[row.slot] = { remaining: row.remaining, full: row.full };
        setSlotState(next);

        const back: Record<string, { remaining: number; full: boolean }> = {};
        for (const row of answer.deliverySlots ?? []) {
          back[row.slot] = { remaining: row.remaining, full: row.full };
        }
        setDeliveryState(back);
      })
      .catch(() => {
        if (cancelled) return;
        setSlotState({});
        setDeliveryState({});
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, pickupDate, deliveryDate]);

  /**
   * Keep the return on a window the collection can actually reach.
   *
   * Two ways it stops being reachable — it fills up, or the customer moves the
   * collection later and a same-day return now falls before the laundry is back.
   * `returnOptions` already accounts for the second, so both are one check.
   */
  useEffect(() => {
    const reachable = returnOptions.some((slot) => slot.label === deliveryTimeSlot);
    if (reachable && !deliveryState[deliveryTimeSlot]?.full) return;

    const open = returnOptions.find((slot) => !deliveryState[slot.label]?.full);
    if (open) setDeliveryTimeSlot(open.label);
  }, [returnOptions, deliveryState, deliveryTimeSlot]);

  /**
   * Move off a window that filled up while the form was open.
   *
   * Without this the customer keeps a selection the server will refuse, and
   * finds out at the end. Falls back to leaving it alone when every window is
   * full — there is nowhere to move them to, and the error on submit is then
   * the honest answer.
   */
  useEffect(() => {
    if (!slotState[pickupTimeSlot]?.full) return;
    const open = PICKUP_TIME_SLOTS.find((slot) => !slotState[slot]?.full);
    if (open) setPickupTimeSlot(open);
  }, [slotState, pickupTimeSlot]);

  const [specialScent, setSpecialScent] = useState(DEFAULT_SCENT);
  const [starchLevel, setStarchLevel] = useState(DEFAULT_STARCH);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [riderNote, setRiderNote] = useState('');

  /**
   * The booking's id, allocated before anything is paid.
   *
   * It used to be minted at the bottom of `handleSubmit`, which was too late:
   * Paystack checkout happens *before* the form is submitted, and the server will
   * only settle a payment whose `metadata.booking_id` names the booking it is
   * settling. Without that binding a customer could pay for one ₵30 wash and quote
   * its reference against every other booking they hold.
   *
   * So the id exists from the moment the form opens and travels into the checkout.
   * A fresh one per booking — see the reset in the `isOpen` effect.
   */
  const [bookingId, setBookingId] = useState(() => newJobId());

  // Payment states
  const [paymentMethod, setPaymentMethod] = useState<'Paystack' | 'Wallet' | 'Pay on Pickup'>('Paystack');
  /**
   * Whether Paystack has confirmed the money arrived.
   *
   * A gate on *offering* to submit, and no longer a claim that gets written down:
   * the booking's `paymentStatus` is the server's, settled through
   * `store.payForBooking`. This used to be set by selecting the wallet tab and by
   * a "Mark Paid" button, and then sent as `paymentStatus: 'Paid'` — so the record
   * said settled because the browser said so.
   */
  const [isPaid, setIsPaid] = useState(false);
  const [transactionRef, setTransactionRef] = useState('');
  /** Where the settle call's failure is reported, so it is never silent. */
  const [settleError, setSettleError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Paystack states
  const [paystackLoading, setPaystackLoading] = useState(false);
  const [paystackAuthUrl, setPaystackAuthUrl] = useState('');
  const [paystackRef, setPaystackRef] = useState('');
  const [paystackError, setPaystackError] = useState('');
  /**
   * What the last verify came back with, said on the panel rather than popped.
   *
   * "Still pending" is a real answer to a question the customer just asked, and
   * it used to arrive as an `alert()` — a modal dialog on top of a modal form,
   * which on a phone lands after the keyboard has closed and cannot be read by
   * anything pointing at the panel it is about.
   */
  const [paystackNotice, setPaystackNotice] = useState('');

  const handlePaystackInit = async () => {
    // Claimed in the same tick as the click, before anything is awaited. See
    // `openCheckoutWindow`: a pop-up opened after a round trip is opened by a
    // script as far as the browser is concerned, and is blocked without a word.
    const checkout = openCheckoutWindow();

    setPaystackLoading(true);
    setPaystackError('');
    setPaystackNotice('');
    try {
      // No invented fallback. This ran with `'patron@freshfold.com'` when the
      // form and the session were both blank, and that address is wrong twice
      // over: Paystack mails the receipt to it, and `/accounts/wallet` matches
      // the payer against the session before it credits anything — so a
      // customer who paid under the placeholder is refused their own money with
      // `reference-not-yours`. Asked for here rather than discovered there.
      const userEmail = email.trim() || loggedInUser?.email || '';
      if (!userEmail) {
        throw new Error('Add your email address on the previous step — the receipt is sent there.');
      }
      const res = await fetch('/api/paystack/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          amount: estimatedPrice,
          // Where Paystack sends the customer back to. This page knows its own
          // origin; the server's APP_URL is a single fixed guess that is wrong
          // for everyone not running the site on the machine it names.
          callback_url: `${window.location.origin}/#paystack-success`,
          // What this payment is for. The server writes Paystack's metadata
          // from these two fields rather than taking an object from here — a
          // checkout that named itself both a top-up and a booking payment
          // used to satisfy both settlement routes, so one payment settled the
          // bill *and* funded the wallet.
          purpose: 'booking',
          // What binds this payment to this booking. The server refuses to
          // settle a bill with a reference that names a different one, so
          // without this the payment cannot be applied at all.
          bookingId,
          // Dashboard-only. Nothing is gated on anything in here.
          display: {
            customer_name: name || 'Patron',
            phone: phone,
            service: service,
          }
        })
      });
      const data = await res.json();
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Failed to initialize Paystack checkout.');
      }
      setPaystackAuthUrl(data.authorization_url);
      setPaystackRef(data.reference);
      setTransactionRef(data.reference);

      // The transaction exists either way; a browser that refuses pop-ups
      // outright just needs the customer sent to the link below instead.
      if (!checkout.send(data.authorization_url)) {
        setPaystackNotice(
          'Your browser blocked the checkout window. Open it with the link below — the payment is ready and waiting.'
        );
      }
    } catch (err: any) {
      // Nothing to pay for, so the window that was held for it goes away rather
      // than sitting there saying "Opening the Paystack checkout…" forever.
      checkout.cancel();
      setPaystackError(err.message || 'Error connecting to Paystack payment gateway.');
    } finally {
      setPaystackLoading(false);
    }
  };

  /**
   * Asks the server what became of the reference this screen opened.
   *
   * `announce` is what separates the two callers. The button below is a
   * question the customer just asked, so every outcome deserves an answer —
   * including "still pending", which is the one that tells them the checkout is
   * not finished. The automatic call from `usePaystackReturn` is not a
   * question: the redirect fires for an abandoned checkout as readily as a paid
   * one, so a pending result there is the ordinary case and announcing it would
   * be scolding somebody for closing a window.
   */
  const runPaystackVerify = async (announce: boolean) => {
    if (!paystackRef) return;
    setPaystackLoading(true);
    setPaystackError('');
    setPaystackNotice('');
    try {
      const res = await fetch(`/api/paystack/verify/${encodeURIComponent(paystackRef)}`);
      const data = await res.json();
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Paystack payment verification failed.');
      }
      if (data.data && data.data.status === 'success') {
        setIsPaid(true);
        setTransactionRef(data.data.reference || paystackRef);
        if (announce) setPaystackNotice('Payment confirmed.');
      } else if (announce) {
        setPaystackNotice(
          `Paystack says this payment is ${data.data?.status || 'pending'}. Finish it in the checkout window, then check again.`
        );
      }
    } catch (err: any) {
      // Surfaced on the panel either way — it is the one outcome the customer
      // cannot act on without being told.
      setPaystackError(err.message || 'Error verifying Paystack payment.');
    } finally {
      setPaystackLoading(false);
    }
  };

  const handlePaystackVerify = () => runPaystackVerify(true);

  // The checkout popup coming back is as good a moment to check as the button.
  // Gated on there being a reference at all, so this window is not listening
  // for messages before it has opened anything.
  usePaystackReturn(useCallback(() => void runPaystackVerify(false), [paystackRef]), !!paystackRef);

  const [isSuccess, setIsSuccess] = useState(false);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  /**
   * The signed-in customer, kept in step with the store.
   *
   * Typed, and subscribed rather than read once. The wallet balance below comes
   * off this: it used to be a `useState(0)` that nothing ever wrote to, so the
   * wallet tab advertised "Bal: ₵0.00" to every customer regardless of what they
   * actually held, and the guard in `handleSubmit` rejected every wallet payment
   * for any service that cost anything. A top-up made in the customer app now
   * lands here on the next poll.
   */
  const [loggedInUser, setLoggedInUser] = useState<UserAccount | null>(null);

  useEffect(() => {
    const sync = () => setLoggedInUser(store.readCurrentUser());
    sync();
    return store.subscribe(sync);
  }, []);

  /** The real balance, from the account. Never a local subtraction. */
  const walletBalance = loggedInUser?.walletBalance ?? 0;

  /**
   * Whether the booking on the confirmation screen has reached the server yet.
   *
   * A write that cannot be sent is kept in a queue and retried, and the screen
   * used to promise an email regardless — so a booking made while the dispatch
   * server was unreachable sat in this browser claiming a receipt was on its
   * way. It stays subscribed rather than reading once, because the queue
   * usually drains a moment later and the panel should stop warning by itself.
   */
  const [awaitingServer, setAwaitingServer] = useState(false);

  useEffect(() => {
    if (!createdBooking) return;
    const check = () => setAwaitingServer(store.isBookingPending(createdBooking.id));
    check();
    return store.subscribe(check);
  }, [createdBooking]);

  // Check for active logged in session on open and pre-fill credentials & logistics
  useEffect(() => {
    if (isOpen) {
      // A fresh id per booking, and the payment state that hangs off it. Without
      // the reset a second booking in the same session would carry the first
      // one's id and its Paystack reference.
      setBookingId(newJobId());
      setIsPaid(false);
      setTransactionRef('');
      setPaystackRef('');
      setPaystackAuthUrl('');
      setSettleError('');
      setPaystackNotice('');
      setStep(0);
      setErrors({});

      try {
        const user = store.readCurrentUser();
        if (user) {
          setLoggedInUser(user);
          setName(user.name || '');
          setEmail(user.email || '');
          setPhone(user.phone || '');

          // Look for past bookings under this email or phone to pre-fill address, city, suburb
          const allBookings: Booking[] = store.readBookings();
          const matched = allBookings.filter(
            b =>
              (b.email && user.email && b.email.toLowerCase() === user.email.toLowerCase()) ||
              samePhone(b.phone, user.phone)
          );
          if (matched.length > 0) {
            // Sort by createdAt descending to get the most recent one
            matched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            const latest = matched[0];
            if (latest.address) setAddress(latest.address);
            if (latest.city) setCity(latest.city);
            // The pin travels with the address it was placed for. A patron
            // booking the same pickup again should not have to aim it twice.
            setPickupPin(latest.pickupCoords ?? null);
            setPinOrigin(latest.pickupCoords ? 'map' : null);
          } else {
            setPickupPin(null);
            setPinOrigin(null);
          }
        } else {
          setLoggedInUser(null);
          setName('');
          setEmail('');
          setPhone('');
          setAddress('');
          setCity('');
          setPickupPin(null);
          setPinOrigin(null);
        }
      } catch (e) {
        console.warn('Could not read existing session state for booking prefill', e);
      }
    }
  }, [isOpen]);

  /**
   * Open on the order the visitor built upstairs.
   *
   * Whole lines, not a service and a count: someone who priced two loads, a
   * duvet and a press has said all of that already, and the old single
   * preselection could only carry the first third of it.
   *
   * Clamped on the way in even though `intent` clamps on the way out — this is
   * a form, and a form is not the only thing that can put a line on an order.
   * An empty basket leaves the default line alone, which is what opening the
   * form from the header or the portal means.
   *
   * Read when the form opens rather than on every change to `intent`, so that
   * editing lines *inside* the form is not fought by the basket outside it.
   */
  useEffect(() => {
    if (!isOpen || intent.items.length === 0) return;

    setItems(
      intent.items.slice(0, MAX_ITEMS).map((item) => ({
        serviceType: item.serviceType,
        quantity: clampQuantity(item.quantity, item.serviceType),
      }))
    );
    // `intent.items` is deliberately not a dependency: this seeds the form on
    // open and then gets out of the way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * And in the zone the area check confirmed, when nothing better is known.
   *
   * Functional rather than a plain `setCity`, because the account prefill above
   * runs in the same commit and a stored address is the better answer — this
   * only fills a blank. The suburb the booking is actually filed under is still
   * derived from the pin and the typed address; this is a starting point, not
   * the record.
   */
  useEffect(() => {
    if (!isOpen || !intent.suburb) return;
    setCity((current) => current || intent.suburb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * A promo code the customer has typed, and what the server said it is worth.
   *
   * The *server's* answer, never this form's arithmetic. `checkPromoCode` runs
   * the same `checkPromo` the booking route runs, against the same row and the
   * same redemption counts — a form that worked out its own discount would
   * promise 20% where the server gives 20% capped at ₵15, and be wrong for
   * exactly the length of one checkout.
   */
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; discount: number; label: string } | null>(
    null
  );
  const [promoError, setPromoError] = useState('');
  const [promoChecking, setPromoChecking] = useState(false);

  /**
   * What this booking costs, from the shared table.
   *
   * `quoteBooking` rather than `priceBreakdown`, and with the same two arguments
   * the server passes: this showed the list price while the server recorded the
   * discounted total, so a member was quoted one number and billed another. It
   * was not only cosmetic — `handlePaystackInit` sends this figure to Paystack,
   * so a member paying by card was charged the gross for a booking the ledger
   * had already marked down.
   *
   * The plan and the points come off the signed-in account, which is where the
   * server reads them too. Signed out, neither is passed and the answer is the
   * list price, which is what a guest pays.
   */
  const estimate = useMemo(
    () =>
      quoteBooking({
        selections: {
          serviceType: service,
          scent: specialScent,
          starch: starchLevel,
          items,
        },
        plan: loggedInUser?.plan ?? null,
        points: loggedInUser ? (loggedInUser.points ?? 0) : undefined,
        promo,
      }),
    [service, specialScent, starchLevel, items, loggedInUser, promo]
  );
  const estimatedPrice = estimate.total;

  /**
   * Re-checks a held code whenever the order changes.
   *
   * A code with a minimum spend, or a percentage one, is worth a different
   * amount on a different basket — and a customer who applied a code and then
   * removed a service would otherwise carry a discount the server is about to
   * refuse. Dropped rather than recomputed locally, for the reason above.
   */
  const applyPromo = useCallback(
    async (code: string) => {
      const typed = code.trim();
      if (!typed) {
        setPromo(null);
        setPromoError('');
        return;
      }

      setPromoChecking(true);
      setPromoError('');

      try {
        // Checked against the bill *before* any code, which is what the server
        // checks it against too.
        const bill = quoteBooking({
          selections: { serviceType: service, scent: specialScent, starch: starchLevel, items },
          plan: loggedInUser?.plan ?? null,
          points: loggedInUser ? (loggedInUser.points ?? 0) : undefined,
        }).total;

        const answer = await store.api.checkPromoCode({
          code: typed,
          subtotal: bill,
          email: email.trim() || undefined,
        });

        if (answer.ok) {
          setPromo({ code: answer.code, discount: answer.discount, label: answer.label });
        } else {
          setPromo(null);
          setPromoError(answer.error);
        }
      } catch {
        setPromo(null);
        setPromoError('Could not check that code. You can still book without it.');
      } finally {
        setPromoChecking(false);
      }
    },
    [service, specialScent, starchLevel, items, loggedInUser, email]
  );

  /**
   * Opens on tomorrow.
   *
   * Through `isoDaysFromNow` rather than `new Date()` + `setDate` +
   * `toISOString`, which was three timezone frames in three lines and landed on
   * the wrong day either side of Greenwich: on a phone in Tokyo it offered
   * *today* all morning, and on one in Los Angeles it skipped to the day after
   * tomorrow from six in the evening. Correct in Accra at every hour, which is
   * why nothing here ever saw it.
   */
  useEffect(() => {
    setPickupDate(isoDaysFromNow(1));
  }, [isOpen]);

  const body = useRef<HTMLDivElement | null>(null);

  /**
   * Escape, the focus trap, the scroll lock and giving the keyboard back.
   *
   * This was written out here, and it had a bug that the shared hook is shaped
   * to prevent. The effect listed `onClose` in its dependencies, and `onClose`
   * is an inline arrow in `App` — a new function on every render, and `App`
   * re-renders on every store poll, five seconds apart. So the effect tore
   * down and re-ran constantly, and its cleanup ended with:
   *
   *     restoreTo?.focus?.();
   *
   * `restoreTo` was whatever had focus when the effect last ran — on the first
   * re-run, the "Book a pickup" button *behind* the modal. So a few seconds
   * after the form opened, the keyboard was silently thrown out of the dialog
   * and back onto the page underneath it, and every re-run after that
   * re-anchored it there. Someone filling in the form with a keyboard was put
   * outside it before they reached the second field.
   *
   * `useDialog` keeps `onClose` in a ref and depends only on `open`, so the
   * effect runs once per opening and the restore happens on the way out, which
   * is the only time it means anything. See ui/useDialog.
   */
  const dialog = useDialog<HTMLDivElement>({ open: isOpen, onClose });

  // A new step is a new screenful; start it at the top rather than wherever the
  // last one was scrolled to.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [step]);

  /**
   * Everything the collection cannot go ahead without.
   *
   * Returned as a map rather than thrown one at a time, so a reader who left
   * three fields blank is told about three fields instead of discovering them
   * one alert at a time.
   */
  const checkDetails = useCallback((): Record<string, string> => {
    const found: Record<string, string> = {};

    if (!name.trim()) found.name = 'We need a name for the courier to ask for.';

    if (!phone.trim()) found.phone = 'The courier rings this from your door.';
    // A partial number is worse than none: it looks like a contact and reaches
    // nobody.
    else if (!isCompletePhone(phone)) found.phone = PHONE_LENGTH_MESSAGE;

    // The confirmation — and with it the link that sets the portal password —
    // is emailed, so a booking without an address to send it to leaves the
    // customer with no way into their own tracking page.
    if (!email.trim()) found.email = 'Your receipt and portal link are sent here.';

    if (!address.trim()) found.address = 'Tell us where to collect from.';
    if (!pickupDate) found.pickupDate = 'Pick a day for the collection.';

    return found;
  }, [name, phone, email, address, pickupDate]);

  /** Puts the cursor on the first thing that is wrong. */
  const focusFirstError = (found: Record<string, string>) => {
    const first = Object.keys(found)[0];
    if (!first) return;
    window.setTimeout(() => document.getElementById(`booking-${first}`)?.focus(), 60);
  };

  const goToStep = (next: number) => {
    // Forward past the details step is the only move that has to be earned.
    if (next > 1 && step <= 1) {
      const found = checkDetails();
      setErrors(found);
      if (Object.keys(found).length > 0) {
        setStep(1);
        focusFirstError(found);
        return;
      }
    }
    setErrors({});
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const found = checkDetails();

    /**
     * A wallet that cannot cover it is worth saying up front.
     *
     * Advisory only — the server checks the balance again when it takes the
     * money, on a locked row, against the price it worked out itself. This is
     * here so the customer is told before they commit rather than after.
     */
    if (paymentMethod === 'Wallet' && walletBalance < estimatedPrice) {
      found.wallet =
        `Your wallet holds ${cedis(walletBalance)} and this comes to ${cedis(estimatedPrice)}. ` +
        'Top up from your order page, or pay by card or on pickup.';
    }

    if (Object.keys(found).length > 0) {
      setErrors(found);
      // The earliest step carrying a fault, so the reader is put in front of
      // the first thing to fix rather than the last.
      setStep(Math.min(...Object.keys(found).map((field) => FIELD_STEP[field] ?? 1)));
      focusFirstError(found);
      return;
    }

    setErrors({});

    const newBooking: Booking = {
      id: bookingId,
      name,
      email: email.trim(),
      phone,
      // The lines the quote was computed from, and the primary pair derived
      // from the first of them — the server rewrites both the same way.
      items: estimate.items,
      serviceType: estimate.items[0].serviceType,
      quantity: estimate.items[0].quantity,
      pickupDate,
      pickupTime: pickupTimeSlot,
      /**
       * Standard 24h turnaround, as calendar arithmetic with no timezone in it.
       *
       * `isoPlusDays` replaced three lines that added one *local* day to a UTC
       * midnight. That happened to agree everywhere, but it was right by
       * cancellation rather than by construction and sat one edit from not
       * being. The fallback covers a blank or half-typed date, which
       * `handleSubmit` has already refused above.
       */
      deliveryDate,
      // Left off when the collection leaves no room for one — an evening
      // collection has no same-day return to offer — rather than sent and
      // refused, which would lose the whole booking over the return window.
      deliveryTime: returnOptions.some((slot) => slot.label === deliveryTimeSlot)
        ? deliveryTimeSlot
        : undefined,
      /**
       * The code as typed, not the discount.
       *
       * What it is worth is the server's to decide — a client that sent an
       * amount would be stating its own price, which is the mistake `amount`
       * and `paymentStatus` are already stripped for.
       */
      promoCode: promo?.code,
      specialInstructions: encodeFinish({
        serviceType: service,
        scent: specialScent,
        starch: starchLevel,
        notes: specialInstructions,
      }),
      riderNote: riderNote.trim() || undefined,
      address,
      /**
       * The town, and `Kumasi` when nobody said otherwise.
       *
       * This defaulted to `'Boutique Care District'`, which is not a place. It
       * was written onto the record, printed on the courier's card and shown
       * back to the customer on their own order — an invented address component
       * on a real booking. The shop is in Kumasi and every collection zone is
       * inside it, so that is the honest default.
       */
      city: city.trim() || 'Kumasi',
      suburb,
      // Optional by design. The server falls back to a pin derived from the
      // address when there is none, and refuses one outside the service area.
      pickupCoords: pickupPin ?? undefined,
      status: 'Scheduled',
      createdAt: new Date().toISOString(),
      /**
       * How they intend to pay. Not whether they have.
       *
       * `paymentStatus`, `amount`, `paidAt` and `transactionRef` are all the
       * server's now and are dropped from anything sent here — it prices the
       * booking with `quoteBooking` and will not mark one `Paid` outside
       * `POST /bookings/:id/payment`. This screen used to send
       * `paymentStatus: 'Paid'` with a reference it had generated locally
       * (`'TXN-' + Math.random()`), which is a record of a payment that never
       * happened anywhere.
       */
      paymentMethod,
    };

    // Hand the booking to the dispatch server. It derives the pickup pin, bag
    // manifest, priority and price, and the job appears on the rider app's board.
    store.createBooking(newBooking);

    onBookingCreated(newBooking);
    setCreatedBooking(newBooking);
    setIsSuccess(true);

    // The basket has become an order. Leaving it filled would reopen the form
    // on a duplicate of the booking that was just placed.
    clearItems();

    /**
     * Now settle it, if anything is owed up front.
     *
     * After the optimistic create rather than before, so the confirmation screen
     * appears immediately and the pickup is never lost to a payment that failed —
     * the booking is real and dispatchable either way, and an unpaid one reads
     * `Pending` to the desk, which is true.
     *
     * `payForBooking` drains the write queue first, so the booking is on the
     * server before anything tries to pay for it.
     */
    if (paymentMethod === 'Pay on Pickup') return;
    if (paymentMethod === 'Paystack' && !isPaid) return;

    setSubmitting(true);
    setSettleError('');

    try {
      const settled = await store.payForBooking(
        newBooking.id,
        paymentMethod,
        paymentMethod === 'Paystack' ? (transactionRef || paystackRef) : undefined
      );
      setCreatedBooking(settled);
    } catch (error) {
      // Said out loud on the confirmation screen. The pickup stands; the bill
      // does not, and the customer needs to know which.
      setSettleError(
        error instanceof ApiError
          ? error.message
          : 'Your pickup is booked, but we could not take the payment just now. Settle it from your order page.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  /** One field-level error, under the field it is about. */
  const Fault = ({ field }: { field: string }) =>
    errors[field] ? (
      <p id={`booking-${field}-error`} className="mt-1.5 flex items-start gap-1.5 text-body text-brand-gold">
        <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{errors[field]}</span>
      </p>
    ) : null;

  const faulted = (field: string) =>
    errors[field]
      ? { 'aria-invalid': true, 'aria-describedby': `booking-${field}-error`, className: `${FIELD} border-brand-gold` }
      : { className: FIELD };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-brand-charcoal/90 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        className="relative z-10 flex max-h-[94svh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-brand-card text-left font-ui shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] focus:outline-none sm:max-h-[92svh] sm:max-w-3xl sm:rounded-2xl"
      >
        {/*
          The swap between the form and the confirmation, in CSS.

          This was `AnimatePresence mode="wait"`, which holds the incoming panel
          back until the outgoing one's tween has finished — and that tween runs
          on `requestAnimationFrame`. Throttle the frames (a backgrounded tab, a
          busy main thread, a mid-range Android under load) and the exit never
          completes, so the confirmation never arrives: the booking is created,
          the payment is taken, and the customer is still looking at the form
          they just submitted. The obvious thing to do next is press Confirm
          again, which is a second real booking.

          `index.css` already carries this lesson for the marketing page's
          panels, and `Reveal` carries it for the section entrances. The rule
          both follow applies here most of all — **the resting state is the
          visible one**. `panel-swap` animates *from* transparent, so a frame
          budget of zero still leaves the right panel on screen; `key` is what
          makes React remount and restart it.
        */}
          {!isSuccess ? (
            <form
              key="booking-form"
              onSubmit={handleSubmit}
              /*
                Enter moves to the next step rather than doing nothing.
                
                A three-step form inside one `<form>` has a submit button only
                on the last step, so on the first two Enter is swallowed and the
                keyboard user is stranded — they have to reach for the mouse to
                get past a screen they have finished typing into. Textareas keep
                Enter, because there it means a new line.
              */
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                if (step >= STEPS.length - 1) return;
                const target = event.target as HTMLElement;
                if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
                event.preventDefault();
                goToStep(step + 1);
              }}
              noValidate
              className="panel-swap flex min-h-0 flex-1 flex-col"
            >
              {/* Header, with the end in sight. */}
              <div className="shrink-0 border-b border-white/10 px-5 py-4 sm:px-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="booking-title" className="font-display text-[25px] font-medium leading-tight text-white">
                      Book a pickup
                    </h2>
                    <p className="mt-0.5 text-body text-brand-text-muted">
                      Step {step + 1} of {STEPS.length} &middot; {STEPS[step].label}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="-mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-md text-brand-text-muted transition-colors duration-200 hover:bg-white/5 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* The three stages, as a row you can walk back through. */}
                <ol className="mt-4 flex gap-1.5">
                  {STEPS.map((entry, index) => {
                    const done = index < step;
                    const here = index === step;
                    return (
                      <li key={entry.id} className="flex-1">
                        <button
                          type="button"
                          onClick={() => goToStep(index)}
                          aria-current={here ? 'step' : undefined}
                          className="w-full text-left"
                        >
                          <span
                            className={`block h-1 rounded-full transition-colors duration-300 ${
                              here ? 'bg-brand-gold' : done ? 'bg-brand-sage-light' : 'bg-white/15'
                            }`}
                          />
                          <span
                            className={`mt-2 block text-[13px] font-medium transition-colors duration-200 ${
                              here ? 'text-white' : 'text-brand-text-muted'
                            }`}
                          >
                            {entry.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* The step itself. */}
              <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
                {step === 0 && (
                  <div className="space-y-7">
                    <section>
                      <h3 className="text-[13px] font-medium text-brand-text-light">
                        What are we washing?
                      </h3>

                      <ul className="mt-3 space-y-3">
                        {items.map((item, index) => {
                          const itemUnit = serviceUnit(item.serviceType);
                          const itemCountable = serviceTakesQuantity(item.serviceType);

                          return (
                            <li
                              key={index}
                              className="rounded-md border border-white/10 bg-brand-charcoal/60 p-3"
                            >
                              <div className="flex items-center gap-2">
                                <label htmlFor={`booking-service-${index}`} className="sr-only">
                                  {index === 0 ? 'Service' : `Service ${index + 1}`}
                                </label>
                                <select
                                  id={`booking-service-${index}`}
                                  value={item.serviceType}
                                  onChange={(e) => setItemService(index, e.target.value)}
                                  className={`${FIELD} flex-1`}
                                >
                                  {BOOKABLE_SERVICE_ITEMS.map((srv) => (
                                    <option key={srv.id} value={srv.name}>
                                      {srv.name} ({srv.priceInfo})
                                    </option>
                                  ))}
                                </select>

                                {/* Never on the first row: an order needs a service. */}
                                {items.length > 1 && index > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => removeItem(index)}
                                    aria-label={`Remove ${item.serviceType}`}
                                    className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/15 text-brand-text-muted transition-colors duration-200 hover:border-white/30 hover:text-white"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                )}
                              </div>

                              {/* The stepper, only for a service priced per
                                  countable thing — an order is one order however
                                  much of it there is. */}
                              {itemCountable ? (
                                <div className="mt-3 flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setItemQuantity(index, item.quantity - 1)}
                                    disabled={item.quantity <= 1}
                                    aria-label={`One fewer ${itemUnit}`}
                                    className="grid h-10 w-10 place-items-center rounded-md border border-white/15 text-white transition-colors duration-200 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
                                  >
                                    <Minus className="h-4 w-4" />
                                  </button>
                                  <span
                                    aria-live="polite"
                                    className="min-w-[6rem] text-center text-[15px] text-white tnum"
                                  >
                                    {item.quantity} {pluraliseUnit(itemUnit, item.quantity)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setItemQuantity(index, item.quantity + 1)}
                                    disabled={item.quantity >= MAX_QUANTITY}
                                    aria-label={`One more ${itemUnit}`}
                                    className="grid h-10 w-10 place-items-center rounded-md border border-white/15 text-white transition-colors duration-200 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : (
                                <p className="mt-2 text-body text-brand-text-muted">
                                  Priced per order
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>

                      {items.length < MAX_ITEMS && (
                        <button
                          type="button"
                          onClick={addItem}
                          className="mt-3 rounded-md border border-white/25 px-4 py-2.5 text-[15px] font-medium text-white transition-colors duration-200 hover:border-brand-gold hover:text-brand-gold"
                        >
                          Add another service
                        </button>
                      )}
                    </section>

                    {/*
                      A car detail and an office clean take no fabric finish, and
                      the app hides these pickers for them. The website used to
                      show them, charge for them, and write "Organic Lavender
                      scent, None starch" onto the courier's card for a car.
                    */}
                    {isGarmentService(service) && (
                      <section className="space-y-5 border-t border-white/10 pt-6">
                        <h3 className="text-[13px] font-medium text-brand-text-light">
                          How would you like it finished?
                        </h3>

                        <div>
                          <label htmlFor="booking-scent" className={LABEL}>
                            Scent
                          </label>
                          <select
                            id="booking-scent"
                            value={specialScent}
                            onChange={(e) => setSpecialScent(e.target.value)}
                            className={`${FIELD} mt-2`}
                          >
                            {SCENTS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                                {option.surcharge > 0
                                  ? ` — +${cedis(option.surcharge)} a unit`
                                  : ' — no charge'}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <span className={LABEL}>Starch, on anything ironed</span>
                          <div className="mt-2 flex gap-2">
                            {STARCH_LEVELS.map((level) => (
                              <button
                                type="button"
                                key={level.id}
                                onClick={() => setStarchLevel(level.id)}
                                aria-pressed={starchLevel === level.id}
                                className={`flex-1 rounded-md border px-3 py-3 text-[15px] transition-colors duration-200 ${
                                  starchLevel === level.id
                                    ? 'border-brand-sage-light bg-brand-sage text-white'
                                    : 'border-white/15 text-brand-text-muted hover:border-white/30 hover:text-white'
                                }`}
                              >
                                {level.label}
                                {level.surcharge > 0 && (
                                  <span className="mt-0.5 block text-body text-white/70 tnum">
                                    +{cedis(level.surcharge)}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </section>
                    )}

                    <section className="border-t border-white/10 pt-6">
                      <label htmlFor="booking-instructions" className={LABEL}>
                        Anything we should know? <span className="text-brand-text-muted">(optional)</span>
                      </label>
                      <input
                        id="booking-instructions"
                        type="text"
                        value={specialInstructions}
                        onChange={(e) => setSpecialInstructions(e.target.value)}
                        placeholder="The white shirt has an ink stain on the cuff"
                        className={`${FIELD} mt-2`}
                      />
                    </section>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-7">
                    <section>
                      <h3 className="text-[13px] font-medium text-brand-text-light">
                        Who is the courier meeting?
                      </h3>

                      {loggedInUser ? (
                        <div className="mt-3 flex items-start gap-3 rounded-md border border-brand-sage-light/40 bg-brand-charcoal/60 p-4">
                          <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-sage-light" />
                          <div className="min-w-0">
                            <p className="text-[15px] font-medium text-white">{loggedInUser.name}</p>
                            <p className="mt-0.5 break-words text-body text-brand-text-muted">
                              {loggedInUser.email} &middot; {loggedInUser.phone}
                            </p>
                            <p className="mt-1.5 text-body text-brand-text-muted">
                              Signed in, so this order goes onto your account.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-5">
                          <div className="grid gap-5 sm:grid-cols-2">
                            <div>
                              <label htmlFor="booking-name" className={LABEL}>
                                Your name
                              </label>
                              <input
                                id="booking-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Paapa Cobbold"
                                {...faulted('name')}
                                className={`${faulted('name').className} mt-2`}
                              />
                              <Fault field="name" />
                            </div>
                            <div>
                              <label htmlFor="booking-phone" className={LABEL}>
                                Phone
                              </label>
                              <input
                                id="booking-phone"
                                type="tel"
                                inputMode="numeric"
                                maxLength={PHONE_DIGITS}
                                value={phone}
                                onChange={(e) => setPhone(limitPhoneInput(e.target.value))}
                                placeholder="0244000000"
                                {...faulted('phone')}
                                className={`${faulted('phone').className} mt-2`}
                              />
                              <Fault field="phone" />
                            </div>
                          </div>
                          <div>
                            <label htmlFor="booking-email" className={LABEL}>
                              Email
                            </label>
                            <input
                              id="booking-email"
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="you@example.com"
                              {...faulted('email')}
                              className={`${faulted('email').className} mt-2`}
                            />
                            <Fault field="email" />
                            <p className="mt-1.5 text-body text-brand-text-muted">
                              Your receipt goes here, with a link for setting up order tracking.
                            </p>
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="space-y-5 border-t border-white/10 pt-6">
                      <h3 className="text-[13px] font-medium text-brand-text-light">
                        Where are we collecting from?
                      </h3>

                      <div>
                        <label htmlFor="booking-address" className={LABEL}>
                          Address
                        </label>
                        {/* Choosing a suggestion places the pin on the building, so
                            the room number gets typed onto an address that is
                            already in the right place. Typing straight past the list
                            still works — it is a text field first. */}
                        <div className="mt-2">
                          <AddressAutocomplete
                            id="booking-address"
                            value={address}
                            onChange={setAddress}
                            onPlaceSelected={(detail) => {
                              setAddress(detail.address);
                              setPickupPin(detail.coords);
                              setPinOrigin('place');
                            }}
                            placeholder="Victory Towers Hostel, room 4B"
                            className={faulted('address').className}
                          />
                        </div>
                        <Fault field="address" />
                      </div>

                      {/* The suburb used to be a required box here. It is derived
                          from the pin now — see `suburb` above — because a customer
                          who has chosen a building or dropped a pin has already said
                          where they are, and asking them to also sort it into a
                          collection zone was asking them to do our filing. */}
                      <div>
                        <label htmlFor="booking-city" className={LABEL}>
                          Town <span className="text-brand-text-muted">(optional)</span>
                        </label>
                        <input
                          id="booking-city"
                          type="text"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Kumasi"
                          className={`${FIELD} mt-2`}
                        />
                      </div>

                      {/* The doorstep itself, which the typed address above cannot
                          give us: a hostel block and room number is something no
                          geocoder knows. */}
                      <PickupPinField
                        value={pickupPin}
                        onChange={setPickupPin}
                        suburb={suburb}
                        address={address}
                        origin={pinOrigin}
                        onOriginChange={setPinOrigin}
                      />

                      <div>
                        <label htmlFor="booking-rider-note" className={LABEL}>
                          A note for the courier{' '}
                          <span className="text-brand-text-muted">(optional)</span>
                        </label>
                        <textarea
                          id="booking-rider-note"
                          rows={2}
                          value={riderNote}
                          onChange={(e) => setRiderNote(e.target.value)}
                          placeholder="Call when you reach the hostel gate and ask for Kwame."
                          className={`${FIELD} mt-2 resize-none`}
                        />
                      </div>
                    </section>

                    <section className="space-y-5 border-t border-white/10 pt-6">
                      <h3 className="text-[13px] font-medium text-brand-text-light">
                        When suits you?
                      </h3>

                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <label htmlFor="booking-pickupDate" className={LABEL}>
                            Collection day
                          </label>
                          <input
                            id="booking-pickupDate"
                            type="date"
                            min={isoDaysFromNow(1)}
                            value={pickupDate}
                            onChange={(e) => setPickupDate(e.target.value)}
                            {...faulted('pickupDate')}
                            className={`${faulted('pickupDate').className} mt-2`}
                          />
                          <Fault field="pickupDate" />
                        </div>
                        <div>
                          <label htmlFor="booking-pickup-slot" className={LABEL}>
                            Collection window
                          </label>
                          <select
                            id="booking-pickup-slot"
                            value={pickupTimeSlot}
                            onChange={(e) => setPickupTimeSlot(e.target.value)}
                            className={`${FIELD} mt-2`}
                          >
                            {PICKUP_TIME_SLOTS.map((slot) => {
                              const state = slotState[slot];
                              return (
                                <option key={slot} value={slot} disabled={state?.full}>
                                  {windowLabel(slot)}
                                  {state?.full
                                    ? ' — full'
                                    : state && state.remaining <= 3
                                      ? ` — ${state.remaining} left`
                                      : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="booking-return-slot" className={LABEL}>
                          Return window
                          {pickupDate && (
                            <span className="ml-1.5 font-normal text-brand-text-muted">
                              — back to you on {deliveryDate}
                            </span>
                          )}
                        </label>
                        <select
                          id="booking-return-slot"
                          value={deliveryTimeSlot}
                          onChange={(e) => setDeliveryTimeSlot(e.target.value)}
                          className={`${FIELD} mt-2`}
                        >
                          {DELIVERY_TIME_SLOTS.map((slot) => {
                            const state = deliveryState[slot];
                            // Unreachable and full are different refusals, and
                            // saying which is more use than one word for both.
                            const reachable = returnOptions.some((option) => option.label === slot);

                            return (
                              <option key={slot} value={slot} disabled={!reachable || state?.full}>
                                {windowLabel(slot)}
                                {!reachable
                                  ? ' — too early'
                                  : state?.full
                                    ? ' — full'
                                    : state && state.remaining <= 3
                                      ? ` — ${state.remaining} left`
                                      : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </section>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-7">
                    <section>
                      <h3 className="text-[13px] font-medium text-brand-text-light">
                        How would you like to pay?
                      </h3>

                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {([
                          {
                            id: 'Paystack' as const,
                            // Paystack's own mark rather than a generic card
                            // glyph: this is the option that hands the customer
                            // to Paystack's checkout on Paystack's domain, and
                            // seeing the same mark on both sides of that jump is
                            // what makes it read as one flow rather than as a
                            // redirect somewhere unexpected.
                            icon: null,
                            title: 'Card or mobile money',
                            note: 'MTN, Telecel, AT and cards',
                          },
                          {
                            id: 'Wallet' as const,
                            icon: Wallet as typeof Wallet | null,
                            title: 'Your wallet',
                            note: `${cedis(walletBalance)} available`,
                          },
                          {
                            id: 'Pay on Pickup' as const,
                            icon: Banknote,
                            title: 'Cash on pickup',
                            note: 'Pay the courier at the door',
                          },
                        ]).map((option) => {
                          const chosen = paymentMethod === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setPaymentMethod(option.id);
                                setIsPaid(false);
                                setErrors(({ wallet, ...rest }) => rest);
                              }}
                              aria-pressed={chosen}
                              className={`rounded-md border p-4 text-left transition-colors duration-200 ${
                                chosen
                                  ? 'border-brand-gold bg-brand-gold/10'
                                  : 'border-white/15 hover:border-white/30'
                              }`}
                            >
                              {option.icon ? (
                                <option.icon
                                  aria-hidden="true"
                                  className={`h-4 w-4 ${chosen ? 'text-brand-gold' : 'text-brand-text-muted'}`}
                                />
                              ) : (
                                <PaystackMark className="h-4 w-4" />
                              )}
                              <p className="mt-2.5 text-[15px] font-medium text-white">{option.title}</p>
                              <p className="mt-0.5 text-body text-brand-text-muted">{option.note}</p>
                            </button>
                          );
                        })}
                      </div>
                      <Fault field="wallet" />
                    </section>

                    {paymentMethod === 'Paystack' && (
                      <section className="rounded-md border border-white/10 bg-brand-charcoal/60 p-4">
                        {isPaid ? (
                          <p className="flex items-start gap-2 text-[15px] text-white">
                            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-sage-light" />
                            <span>
                              Paid — {cedis(estimatedPrice)}.{' '}
                              <span className="text-brand-text-muted">Reference {transactionRef}</span>
                            </span>
                          </p>
                        ) : (
                          <>
                            <p className="text-body text-brand-text-muted">
                              You can pay now, or leave this and pay the courier — the pickup is
                              booked either way.
                            </p>
                            <button
                              type="button"
                              onClick={handlePaystackInit}
                              disabled={paystackLoading}
                              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light disabled:opacity-60"
                            >
                              {/* Monochrome here: the button is already brass,
                                  and a cyan mark on it is two brands shouting.
                                  The colour version sits on the option above,
                                  where the choice is actually made. */}
                              <PaystackMark className="h-4 w-4" monochrome />
                              {paystackLoading ? 'Opening checkout…' : `Pay ${cedis(estimatedPrice)} now`}
                            </button>

                            {paystackAuthUrl && (
                              <div className="mt-3 space-y-2 rounded-md border border-white/10 p-3">
                                <p className="text-body text-brand-text-muted">
                                  {/* Was "The checkout opened in another window" — which is
                                      exactly what has not happened in the one case this panel
                                      exists for. */}
                                  The checkout opens in a separate window. If you cannot see it,
                                  open it here:
                                </p>
                                <a
                                  href={paystackAuthUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 break-all text-body text-brand-gold underline decoration-brand-gold/40 underline-offset-4"
                                >
                                  <PaystackMark className="h-3.5 w-3.5 shrink-0" />
                                  Open the Paystack checkout
                                </a>
                                {/*
                                  "Check" asks Paystack. There used to be a
                                  "Mark Paid" button beside it that simply set
                                  the flag, and the flag went out as
                                  `paymentStatus: 'Paid'` — a settled booking on
                                  nobody's word at all. Asking is the only
                                  option now, and the server asks again before
                                  it takes anything.
                                */}
                                <button
                                  type="button"
                                  onClick={handlePaystackVerify}
                                  disabled={paystackLoading}
                                  className="w-full rounded-md border border-white/25 px-4 py-2.5 text-[15px] font-medium text-white transition-colors duration-200 hover:border-brand-gold hover:text-brand-gold disabled:opacity-60"
                                >
                                  {paystackLoading ? 'Checking…' : "I've paid — check"}
                                </button>
                              </div>
                            )}
                          </>
                        )}

                        <div aria-live="polite">
                          {paystackNotice && (
                            <p className="mt-3 text-body text-brand-text-light">{paystackNotice}</p>
                          )}
                          {paystackError && (
                            <p className="mt-3 flex items-start gap-1.5 text-body text-brand-gold">
                              <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{paystackError}</span>
                            </p>
                          )}
                        </div>
                      </section>
                    )}

                    {paymentMethod === 'Wallet' && (
                      <section className="rounded-md border border-white/10 bg-brand-charcoal/60 p-4">
                        <div className="flex items-baseline justify-between gap-4 text-[15px]">
                          <span className="text-brand-text-muted">Your wallet</span>
                          <span className="text-white tnum">{cedis(walletBalance)}</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-white/10 pt-2 text-[15px]">
                          <span className="text-brand-text-muted">This order</span>
                          <span className="text-white tnum">&minus;{cedis(estimatedPrice)}</span>
                        </div>
                        <p className="mt-2.5 text-body text-brand-text-muted">
                          Taken from your wallet once the booking is confirmed.
                        </p>
                      </section>
                    )}

                    {/* ------------------------------------------------ promo code */}
                    <section className="border-t border-white/10 pt-6">
                      <label htmlFor="booking-promo" className={LABEL}>
                        Promo or referral code{' '}
                        <span className="text-brand-text-muted">(optional)</span>
                      </label>
                      <div className="mt-2 flex gap-2">
                        <input
                          id="booking-promo"
                          type="text"
                          value={promoInput}
                          onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                          placeholder="FRESHERS24"
                          className={`${FIELD} flex-1 uppercase`}
                        />
                        {promo ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPromo(null);
                              setPromoInput('');
                              setPromoError('');
                            }}
                            className="shrink-0 rounded-md border border-white/25 px-5 text-[15px] font-medium text-white transition-colors duration-200 hover:border-white/40"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={promoChecking || !promoInput.trim()}
                            onClick={() => void applyPromo(promoInput)}
                            className="shrink-0 rounded-md border border-white/25 px-5 text-[15px] font-medium text-white transition-colors duration-200 hover:border-brand-gold hover:text-brand-gold disabled:opacity-40 disabled:hover:border-white/25 disabled:hover:text-white"
                          >
                            {promoChecking ? 'Checking…' : 'Apply'}
                          </button>
                        )}
                      </div>
                      <div aria-live="polite">
                        {promo && (
                          <p className="mt-2 text-body text-brand-sage-light">
                            {promo.code} applied — {promo.label}, {cedis(estimate.promoDiscount)} off.
                          </p>
                        )}
                        {!!promoError && <p className="mt-2 text-body text-brand-gold">{promoError}</p>}
                      </div>
                    </section>

                    {/* The receipt, before it is a receipt. */}
                    <section className="border-t border-white/10 pt-6">
                      <h3 className="text-[13px] font-medium text-brand-text-light">
                        What you are booking
                      </h3>
                      <dl className="mt-3 space-y-2 text-[15px]">
                        <div className="flex items-baseline justify-between gap-4">
                          <dt className="text-brand-text-muted">
                            {describeItems({ items: estimate.items, serviceType: service })}
                          </dt>
                          <dd className="shrink-0 text-white tnum">{cedis(estimate.gross)}</dd>
                        </div>

                        {/*
                          The reductions, named. A member used to see a smaller
                          total than the price list with nothing on screen to say
                          why — the quote has carried these three figures all
                          along and the form showed none of them.
                        */}
                        {estimate.waived > 0 && (
                          <div className="flex items-baseline justify-between gap-4">
                            <dt className="text-brand-sage-light">
                              Covered by your plan
                              {estimate.remainingPickups > 0 && (
                                <span className="text-brand-text-muted">
                                  {' '}
                                  ({estimate.remainingPickups} left this month)
                                </span>
                              )}
                            </dt>
                            <dd className="shrink-0 text-brand-sage-light tnum">
                              &minus;{cedis(estimate.waived)}
                            </dd>
                          </div>
                        )}
                        {estimate.memberDiscount > 0 && (
                          <div className="flex items-baseline justify-between gap-4">
                            <dt className="text-brand-sage-light">Member rate</dt>
                            <dd className="shrink-0 text-brand-sage-light tnum">
                              &minus;{cedis(estimate.memberDiscount)}
                            </dd>
                          </div>
                        )}
                        {estimate.tierDiscount > 0 && (
                          <div className="flex items-baseline justify-between gap-4">
                            <dt className="text-brand-sage-light">Loyalty discount</dt>
                            <dd className="shrink-0 text-brand-sage-light tnum">
                              &minus;{cedis(estimate.tierDiscount)}
                            </dd>
                          </div>
                        )}
                        {estimate.promoDiscount > 0 && (
                          <div className="flex items-baseline justify-between gap-4">
                            <dt className="text-brand-sage-light">{estimate.promoCode}</dt>
                            <dd className="shrink-0 text-brand-sage-light tnum">
                              &minus;{cedis(estimate.promoDiscount)}
                            </dd>
                          </div>
                        )}

                        <div className="flex items-baseline justify-between gap-4">
                          <dt className="text-brand-text-muted">Pickup and delivery</dt>
                          <dd className="shrink-0 text-brand-text-muted">Free</dd>
                        </div>

                        <div className="flex items-baseline justify-between gap-4 border-t border-white/15 pt-3">
                          <dt className="font-medium text-white">Total</dt>
                          <dd className="shrink-0 text-[19px] font-semibold text-brand-gold tnum">
                            {cedis(estimatedPrice)}
                          </dd>
                        </div>

                        {/*
                          The tax already inside that figure.

                          Disclosed rather than added: prices in this product
                          have always been quoted to customers as the number they
                          pay, so the default mode is inclusive and this is the
                          extraction.
                        */}
                        {estimate.tax.tax > 0 && (
                          <p className="text-body text-brand-text-muted">
                            Includes {cedis(estimate.tax.tax)} tax (
                            {estimate.tax.lines.map((line) => line.label).join(' + ')})
                          </p>
                        )}
                      </dl>
                    </section>
                  </div>
                )}
              </div>

              {/*
                The total, and the way forward — pinned.

                The price used to sit in a panel near the bottom of a very long
                scroll, so for most of the form the reader could not see what
                they were agreeing to. It is the number the whole screen is
                about; it belongs where it is always visible.
              */}
              <div className="shrink-0 border-t border-white/10 bg-brand-card px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
                <div className="flex items-center gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] text-brand-text-muted">
                      {step === 2 ? 'You pay' : 'So far'}
                    </p>
                    <p className="text-[21px] font-semibold leading-none text-brand-gold tnum fs-semi">
                      {cedis(estimatedPrice)}
                    </p>
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {step > 0 && (
                      <button
                        type="button"
                        onClick={() => goToStep(step - 1)}
                        className="flex items-center gap-1.5 rounded-md border border-white/25 px-4 py-3 text-[15px] font-medium text-white transition-colors duration-200 hover:border-white/40"
                      >
                        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                        <span className="hidden sm:inline">Back</span>
                      </button>
                    )}

                    {step < STEPS.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => goToStep(step + 1)}
                        className="flex items-center gap-2 rounded-md bg-brand-gold px-6 py-3 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
                      >
                        Continue
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="rounded-md bg-brand-gold px-6 py-3 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
                      >
                        Confirm the pickup
                      </button>
                    )}
                  </div>
                </div>

                {/* One live region for whatever went wrong, so a failed submit
                    is announced rather than only drawn three steps away. */}
                <div aria-live="polite">
                  {Object.keys(errors).length > 0 && (
                    <p className="mt-2.5 text-body text-brand-gold">
                      {Object.keys(errors).length === 1
                        ? 'One thing needs fixing before we can book this.'
                        : `${Object.keys(errors).length} things need fixing before we can book this.`}
                    </p>
                  )}
                </div>
              </div>
            </form>
          ) : (
            <div key="booking-success" className="panel-swap flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-7">
                <div className="mx-auto max-w-lg">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-sage">
                    <Check aria-hidden="true" className="h-5 w-5 text-white" />
                  </span>

                  <h2 className="mt-5 font-display text-[29px] font-medium leading-tight text-white">
                    Booked. We will see you {createdBooking?.pickupDate}.
                  </h2>
                  <p className="mt-3 text-lead text-brand-text-muted">
                    Your order number is{' '}
                    <span className="font-medium text-brand-gold tnum">{createdBooking?.id}</span>.
                    Keep it — it is how you track the bag.
                  </p>

                  {/* The receipt */}
                  <dl className="mt-7 border-t border-white/15">
                    {[
                      { label: 'Name', value: createdBooking?.name },
                      {
                        label: 'What we are washing',
                        value: (createdBooking && describeItems(createdBooking)) || createdBooking?.serviceType,
                      },
                      {
                        label: 'Collection',
                        value: `${createdBooking?.pickupDate} · ${windowLabel(createdBooking?.pickupTime)}`,
                      },
                      {
                        label: 'Back to you',
                        value: createdBooking?.deliveryTime
                          ? `${createdBooking?.deliveryDate} · ${windowLabel(createdBooking.deliveryTime)}`
                          : createdBooking?.deliveryDate,
                      },
                      { label: 'Address', value: createdBooking?.address },
                      ...(createdBooking?.riderNote
                        ? [{ label: 'Note for the courier', value: createdBooking.riderNote }]
                        : []),
                      { label: 'Paying by', value: paymentLabel(createdBooking?.paymentMethod) },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-baseline justify-between gap-6 border-b border-white/10 py-3"
                      >
                        <dt className="shrink-0 text-body text-brand-text-muted">{row.label}</dt>
                        <dd className="text-right text-[15px] text-white">{row.value}</dd>
                      </div>
                    ))}

                    <div className="flex items-baseline justify-between gap-6 border-b border-white/10 py-3">
                      <dt className="shrink-0 text-body text-brand-text-muted">Payment</dt>
                      {/*
                        Read off the record the server returned, not off what this
                        form intended. It used to say PAID whenever the browser had
                        set its own flag, and anything else was labelled
                        "PAY ON PICKUP" — including a card payment that was still
                        pending, and a wallet debit that had never happened.
                      */}
                      <dd
                        className={`text-right text-[15px] ${
                          createdBooking?.paymentStatus === 'Paid'
                            ? 'text-brand-sage-light'
                            : 'text-brand-gold'
                        }`}
                      >
                        {submitting
                          ? 'Taking payment…'
                          : createdBooking?.paymentStatus === 'Paid'
                            ? `Paid${createdBooking.transactionRef ? ` · ${createdBooking.transactionRef}` : ''}`
                            : 'Due on pickup'}
                      </dd>
                    </div>

                    <div className="flex items-baseline justify-between gap-6 py-4">
                      <dt className="shrink-0 font-medium text-white">Total</dt>
                      {/*
                        The server's figure once it has answered. `estimatedPrice`
                        is this form's arithmetic, and the two agree — same
                        `quoteBooking` — but only one of them is what the customer
                        owes, and a member's discount is applied server-side.
                      */}
                      <dd className="text-[21px] font-semibold text-brand-gold tnum">
                        {cedis(createdBooking?.amount ?? estimatedPrice)}
                      </dd>
                    </div>
                  </dl>

                  {settleError && (
                    <div className="mt-5 rounded-md border border-brand-gold/40 bg-brand-gold/5 p-4">
                      <p className="text-[15px] font-medium text-brand-gold">
                        Pickup booked — the payment did not go through
                      </p>
                      <p className="mt-1.5 text-body text-brand-text-light">{settleError}</p>
                    </div>
                  )}

                  <div className="mt-6 rounded-md border border-white/10 bg-brand-charcoal/60 p-4">
                    {awaitingServer ? (
                      /* The email is sent by the dispatch server once it has the
                         booking, so while the write is still queued there is
                         nothing in any inbox to look for. Saying "check your
                         email" here sends the customer hunting for a message that
                         was never sent. */
                      <p className="text-body text-brand-text-light">
                        Saved on this device, but we have not reached FreshFold yet — so{' '}
                        <strong className="font-medium text-brand-gold">no email has gone out</strong>.
                        Keep this tab open and it will send itself when the connection is back. Your
                        booking is not lost.
                      </p>
                    ) : loggedInUser ? (
                      <p className="text-body text-brand-text-light">
                        This order is on your account. You can follow the courier from your order
                        page.
                      </p>
                    ) : (
                      /* No shortcut into the password screen from here: the link
                         in the email carries a single-use token, and it is the
                         only thing that opens one. A button on this panel could
                         only be a booking id in a URL, which is what anybody
                         could have typed. */
                      <p className="text-body text-brand-text-light">
                        Your receipt is on its way to{' '}
                        <strong className="font-medium text-white">{createdBooking?.email}</strong>,
                        with a link for setting a password. Open it to follow the courier live.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-white/10 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
                <div className="mx-auto flex max-w-lg flex-col gap-2 sm:flex-row-reverse">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSuccess(false);
                      onClose();
                      window.location.hash = '#portal';
                    }}
                    className="w-full rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light sm:w-auto"
                  >
                    {loggedInUser ? 'Go to my orders' : 'Open order tracking'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSuccess(false);
                      onClose();
                    }}
                    className="w-full rounded-md border border-white/25 px-6 py-3.5 text-[15px] font-medium text-white transition-colors duration-200 hover:border-white/40 sm:w-auto"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

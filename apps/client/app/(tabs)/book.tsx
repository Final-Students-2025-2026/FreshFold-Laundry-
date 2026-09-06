/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bookmark,
  Calendar,
  Check,
  ChevronRight,
  CircleAlert,
  MapPin,
  Sparkles,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiError,
  MAX_SAVED_ADDRESSES,
  PHONE_DIGITS,
  deriveSuburb,
  encodeFinish,
  isCompletePhone,
  MAX_ITEMS,
  MAX_QUANTITY,
  clampQuantity,
  isEmailShaped,
  isoDaysFromNow,
  isoPlusDays,
  limitPhoneInput,
  membershipBookingQuote,
  membershipPlan,
  newJobId,
  serviceBasePrice,
  serviceTakesQuantity,
  serviceUnit,
  type Booking,
  type BookingItem,
  type Coords,
  type PaymentStatus,
} from '@freshfold/core';
import AddressAutocomplete from '../../src/components/AddressAutocomplete';
import { Icon } from '../../src/components/Icon';
import { KeyboardAvoider } from '../../src/components/KeyboardAvoider';
import type { PinOrigin } from '../../src/components/PickupPinPanel';
import PickupPinPicker from '../../src/components/PickupPinPicker';
import {
  Badge,
  Button,
  Card,
  Divider,
  Field,
  OptionRow,
  ProgressBar,
  ScrollSheet,
  SectionLabel,
  Sheet,
} from '../../src/components/ui';
import {
  BOOKABLE_SERVICES,
  DEFAULT_SCENT,
  DEFAULT_STARCH,
  DELIVERY_TIME_SLOTS,
  PAYMENT_METHODS,
  PICKUP_TIME_SLOTS,
  SCENTS,
  SPECIALTY_ADDONS,
  STARCH_LEVELS,
  deliverySlotsFor,
  isGarmentService,
  isPlanCoverable,
  priceBreakdown,
  taxOn,
  tierForPoints,
  type PaymentChoice,
} from '../../src/data/catalogue';
import { intlTag, servicePriceLabel, unitLabel, useT, type TranslationKey } from '../../src/i18n';
import { api } from '../../src/services/api';
import { paystackReturnUrl } from '../../src/services/checkout';
import { useClient } from '../../src/store/ClientStore';
import { useSession } from '../../src/store/SessionStore';
import { colors, formatCedis, formatDate, radius, shadow, tints } from '../../src/theme';

/**
 * The booking flow.
 *
 * The website does this in one long modal; on a phone that is a wall, so it is
 * five steps with a running quote pinned to the bottom. The quote comes from
 * `priceBreakdown` in `@freshfold/core` — the same table the website's form and
 * the server's `quoteBooking` read, so the number shown here, the number shown
 * there and the number charged are one number. This screen used to carry its own
 * copy of the arithmetic and it had already drifted from both. It is itemised so
 * a membership can cover the laundry without also making the add-ons free.
 *
 * Only `BOOKABLE_SERVICES` are offered. Two entries in the catalogue are not
 * bookable — air drying is part of a wash, a corporate contract is a
 * conversation — and this screen used to list all eleven and put a price on
 * both.
 *
 * A booking does not require an account. Signed in, the contact step is
 * pre-filled and skippable; signed out, it is where the details are collected.
 */

type Step = 0 | 1 | 2 | 3 | 4;

/**
 * The five steps, named by key rather than by word.
 *
 * Module scope, so it cannot translate anything itself — the screen looks up the
 * key it picks. Keeping all five in one list is also what stops a part-written
 * dictionary from producing a strip that reads "Step 4 of 5 · Finishing" after
 * three translated names: a language either carries the set or falls back to
 * English across the whole row.
 */
const STEP_TITLE_KEYS: readonly TranslationKey[] = [
  'book.step.service',
  'book.step.schedule',
  'book.step.address',
  'book.step.finishing',
  'book.step.payment',
];

/**
 * A service id this form can actually take an order for.
 *
 * The home screen links every catalogue card here, and two of them are not
 * bookable — air drying is part of a wash, a corporate contract is quoted. An id
 * for one of those falls back to the first bookable service rather than leaving
 * the form pointed at something it cannot price.
 */
function bookableServiceId(id: string | undefined): string {
  return BOOKABLE_SERVICES.find((service) => service.id === id)?.id ?? BOOKABLE_SERVICES[0].id;
}

export default function BookScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ serviceId?: string; planId?: string }>();
  const { account, isAuthenticated } = useSession();
  const {
    createBooking,
    payForBooking,
    walletBalance,
    points,
    addresses,
    defaultAddress,
    saveAddress,
    plan,
  } = useClient();
  const { t, locale, c } = useT();

  const [step, setStep] = useState<Step>(0);

  // -- selections ----------------------------------------------------------
  const [serviceId, setServiceId] = useState(() => bookableServiceId(params.serviceId));
  /**
   * How many of the service's unit.
   *
   * Every service advertises a price per something — ₵30 a load, ₵90 a sofa —
   * and there was nowhere to say how many, so four loads billed as one. Reset to
   * 1 whenever the service changes: four loads of washing is not four car
   * details, and carrying the number across would quote ₵600 for a change of
   * mind.
   */
  const [quantity, setQuantity] = useState(1);
  const [pickupDate, setPickupDate] = useState(() => isoDaysFromNow(1));
  const [timeSlot, setTimeSlot] = useState<string>(PICKUP_TIME_SLOTS[0]);

  /**
   * How full each collection window is on the chosen day.
   *
   * Advisory only — the booking route enforces the same ceiling, so a phone
   * working from a stale answer is refused rather than allowed to overbook. What
   * it buys is the customer seeing a full window before they walk through four
   * more steps to reach it.
   *
   * Empty on any failure, which is the important half: this screen has to work
   * on a phone that cannot reach the server, and greying out every window would
   * make an offline form look broken rather than optimistic.
   */
  const [slotState, setSlotState] = useState<
    Record<string, { remaining: number; full: boolean }>
  >({});

  /**
   * When the clean laundry comes back.
   *
   * The customer used to choose the hour their clothes left and have no say at
   * all in the hour they came back — the return was `pickupDate + 1` with no
   * time on it, so "when will it be back?" had no answer beyond a date.
   *
   * Defaults to the first window that the collection leaves time for rather
   * than to `DELIVERY_TIME_SLOTS[0]`, because the two are not the same on a
   * same-day return.
   */
  const deliveryDate = useMemo(() => isoDaysAfter(pickupDate, 1), [pickupDate]);

  const returnOptions = useMemo(
    () => deliverySlotsFor(pickupDate, timeSlot, deliveryDate),
    [pickupDate, timeSlot, deliveryDate]
  );

  const [deliverySlot, setDeliverySlot] = useState<string>(DELIVERY_TIME_SLOTS[0]);
  const [deliveryState, setDeliveryState] = useState<
    Record<string, { remaining: number; full: boolean }>
  >({});

  useEffect(() => {
    if (!pickupDate) return;

    let cancelled = false;
    api
      .slotAvailability(pickupDate, { deliveryDate })
      .then((answer) => {
        if (cancelled) return;
        const next: Record<string, { remaining: number; full: boolean }> = {};
        for (const row of answer.slots) {
          next[row.slot] = { remaining: row.remaining, full: row.full };
        }
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
  }, [pickupDate, deliveryDate]);

  // Move off a window that filled while the screen was open, unless every one
  // has — in which case the refusal on submit is the honest answer.
  useEffect(() => {
    if (!slotState[timeSlot]?.full) return;
    const open = PICKUP_TIME_SLOTS.find((slot) => !slotState[slot]?.full);
    if (open) setTimeSlot(open);
  }, [slotState, timeSlot]);

  /**
   * Keep the return window on something the collection can actually reach.
   *
   * Two ways it stops being reachable: it fills up, or the customer moves the
   * collection later in the day and a same-day return that was fine is now
   * before the laundry is back. `returnOptions` already accounts for the second,
   * so both are one check.
   */
  useEffect(() => {
    const reachable = returnOptions.some((slot) => slot.label === deliverySlot);
    if (reachable && !deliveryState[deliverySlot]?.full) return;

    const open = returnOptions.find((slot) => !deliveryState[slot.label]?.full);
    if (open) setDeliverySlot(open.label);
  }, [returnOptions, deliveryState, deliverySlot]);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Kumasi');
  /**
   * The doorstep, as the customer placed it. Null until they do — the booking
   * carries it so the courier navigates to a real point rather than to a pin
   * the server derived from the words they typed.
   */
  const [pickupPin, setPickupPin] = useState<Coords | null>(null);
  /** How that pin came to be, so the picker can say so under the map. */
  const [pinOrigin, setPinOrigin] = useState<PinOrigin>(null);

  /**
   * The collection zone this booking is filed under.
   *
   * Derived, never chosen. The dispatch board still groups by suburb, but it
   * is a fact about where the pin is rather than a separate answer the
   * customer can get wrong — and they could, because a sheet defaulting to
   * Bomso and a pin in Kotei were both accepted and nothing reconciled them.
   */
  const suburb = useMemo(() => deriveSuburb(pickupPin, address), [pickupPin, address]);
  const [saveThisAddress, setSaveThisAddress] = useState(false);

  /**
   * The book has a ceiling, and `withAddress` enforces it by dropping the
   * overflow. So a full book has to disable the tick rather than take it and
   * lose the address on the way to the account.
   */
  const bookIsFull = addresses.length >= MAX_SAVED_ADDRESSES;
  const [scent, setScent] = useState<string>(DEFAULT_SCENT);
  const [starch, setStarch] = useState<string>(DEFAULT_STARCH);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const [riderNote, setRiderNote] = useState('');

  // -- contact -------------------------------------------------------------
  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [phone, setPhone] = useState(account?.phone ?? '');

  // -- payment -------------------------------------------------------------
  const [method, setMethod] = useState<PaymentChoice>('Paystack');
  const [paystackRef, setPaystackRef] = useState('');
  const [isPaid, setIsPaid] = useState(false);

  /**
   * The booking's id, allocated before anything is paid.
   *
   * It used to be minted inside `submit`, which is too late: Paystack checkout
   * happens on the payment step, before the form is submitted, and the server will
   * only settle a payment whose `metadata.booking_id` names the booking it is
   * settling. Without that binding one ₵30 wash's reference could be quoted
   * against every other booking the customer holds.
   */
  const [bookingId, setBookingId] = useState(() => newJobId());
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState('');

  // -- ui ------------------------------------------------------------------
  /**
   * Which line the service sheet is choosing for: 0 is the primary service
   * card, 1+ an extra line, `null` closed.
   *
   * One sheet rather than one per line — it is the same list of services either
   * way, and the only thing that differs is where the answer goes.
   */
  const [servicePickerFor, setServicePickerFor] = useState<number | null>(null);
  const servicePickerOpen = servicePickerFor !== null;

  /**
   * Services beyond the first.
   *
   * The primary service keeps its own card, its picker and its quantity — it is
   * the hero of this screen and the thing the home tab links into. Anything the
   * customer adds after that lives here, and `items` below is the two joined.
   * "Two loads and a set of linen" is one collection, one courier and one
   * doorstep; booking it twice produced two jobs for one visit.
   */
  const [extras, setExtras] = useState<BookingItem[]>([]);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Booking | null>(null);

  /** Always one of {@link BOOKABLE_SERVICES} — see {@link bookableServiceId}. */
  const service = useMemo(
    () => BOOKABLE_SERVICES.find((candidate) => candidate.id === serviceId) ?? BOOKABLE_SERVICES[0],
    [serviceId]
  );

  const tier = useMemo(() => tierForPoints(points), [points]);

  const items = useMemo<BookingItem[]>(
    () => [{ serviceType: service.name, quantity }, ...extras],
    [service.name, quantity, extras]
  );

  const setLineService = (index: number, next: string) => {
    // A new service starts at one, per line.
    if (index === 0) {
      const chosen = BOOKABLE_SERVICES.find((candidate) => candidate.name === next);
      if (chosen) setServiceId(chosen.id);
      return;
    }
    setExtras((current) =>
      current.map((item, i) => (i === index - 1 ? { serviceType: next, quantity: 1 } : item))
    );
  };

  const setLineQuantity = (index: number, next: number) => {
    if (index === 0) {
      setQuantity(clampQuantity(next, service.name));
      return;
    }
    setExtras((current) =>
      current.map((item, i) =>
        i === index - 1 ? { ...item, quantity: clampQuantity(next, item.serviceType) } : item
      )
    );
  };

  const addLine = () =>
    setExtras((current) => {
      if (current.length + 1 >= MAX_ITEMS) return current;
      // The first service not already on the order, so a new line does not open
      // as a duplicate of one above it.
      const taken = [service.name, ...current.map((item) => item.serviceType)];
      const next =
        BOOKABLE_SERVICES.find((candidate) => !taken.includes(candidate.name)) ??
        BOOKABLE_SERVICES[0];
      return [...current, { serviceType: next.name, quantity: 1 }];
    });

  const removeLine = (index: number) =>
    setExtras((current) => current.filter((_, i) => i !== index - 1));

  const unit = useMemo(() => serviceUnit(service.name), [service.name]);
  const countable = useMemo(() => serviceTakesQuantity(service.name), [service.name]);

  // A new service starts at one. See the note on `quantity` above.
  useEffect(() => {
    setQuantity(1);
  }, [service.name]);

  const quote = useMemo(
    () => priceBreakdown({ serviceType: service.name, scent, starch, addonIds, items }),
    [service.name, scent, starch, addonIds, items]
  );
  const gross = quote.gross;

  /**
   * What the membership takes off this booking.
   *
   * A plan used to buy nothing at the till: the monthly fee bought an `elite`
   * tag and the member still paid the full catalogue price, while the plans
   * screen said "Regular laundry, one monthly price". While the period's
   * included pickups last, the laundry is already paid for and only the extras
   * are billed; after that the member rate applies to the whole quote.
   */
  const planDefinition = useMemo(() => membershipPlan(plan?.planId), [plan?.planId]);

  const membership = useMemo(
    () =>
      membershipBookingQuote({
        plan: isAuthenticated ? plan : null,
        gross,
        laundry: quote.laundry,
        // One included pickup waives one unit, not the whole booking.
        unitLaundry: quote.unitLaundry,
        coverable: isPlanCoverable(service.name),
      }),
    [isAuthenticated, plan, gross, quote.laundry, quote.unitLaundry, service.name]
  );

  /**
   * The loyalty discount is applied to the quote rather than shown as a
   * post-hoc credit, so the number the customer approves is the number charged.
   *
   * It is taken on what is left after the membership rather than on the gross,
   * so the two never compound into more than the booking is worth.
   */
  const afterPlan = Math.max(0, Number((gross - membership.waived - membership.discount).toFixed(2)));
  const discount = useMemo(
    () => (isAuthenticated ? Number((afterPlan * tier.discountRate).toFixed(2)) : 0),
    [afterPlan, tier.discountRate, isAuthenticated]
  );
  const afterTier = Math.max(0, Number((afterPlan - discount).toFixed(2)));

  /**
   * A promo code, and what the *server* said it is worth.
   *
   * Never this screen's arithmetic. `checkPromoCode` runs the same `checkPromo`
   * the booking route runs, against the same row and the same redemption counts
   * — a form working out its own discount would promise 20% where the server
   * gives 20% capped at ₵15, and be wrong for exactly the length of one
   * checkout.
   */
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; discount: number; label: string } | null>(
    null
  );
  const [promoError, setPromoError] = useState('');
  const [promoChecking, setPromoChecking] = useState(false);

  // Never more than is left on the bill, whatever the server said a moment ago:
  // the order can change after a code is applied.
  const promoDiscount = promo ? Math.min(promo.discount, afterTier) : 0;
  const total = Math.max(0, Number((afterTier - promoDiscount).toFixed(2)));

  /** The tax already inside that total. Disclosed rather than added — see `./tax`. */
  const taxLine = useMemo(() => taxOn(total), [total]);

  const applyPromo = useCallback(async () => {
    const typed = promoInput.trim();
    if (!typed) {
      setPromo(null);
      setPromoError('');
      return;
    }

    setPromoChecking(true);
    setPromoError('');

    try {
      const answer = await api.checkPromoCode({
        code: typed,
        // The bill before any code, which is what the server checks against.
        subtotal: afterTier,
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
      setPromoError(t('book.promo.unreachable'));
    } finally {
      setPromoChecking(false);
    }
  }, [promoInput, afterTier, email, t]);


  // Prefill from the account and the default saved address once they load.
  useEffect(() => {
    if (account) {
      setName((current) => current || account.name);
      setEmail((current) => current || account.email);
      setPhone((current) => current || account.phone);
    }
  }, [account]);

  /**
   * The saved address fills the form once, when it arrives.
   *
   * It used to depend on `address` and run whenever `address` was empty, which
   * made clearing the field the very thing that refilled it: blank the box,
   * the effect re-runs, the guard passes, and the saved address is written
   * straight back. There was no way to end up with an empty address field
   * while a default existed.
   *
   * So: once per saved address, and only into a form nobody has typed into.
   * `address` is read through a ref to keep that second guard without making
   * the customer's own edits a trigger.
   */
  const addressRef = useRef(address);
  addressRef.current = address;
  const prefilledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!defaultAddress) return;
    if (prefilledFor.current === defaultAddress.id) return;
    if (addressRef.current.trim()) return;

    prefilledFor.current = defaultAddress.id;
    setAddress(defaultAddress.address);
    if (defaultAddress.city) setCity(defaultAddress.city);
    if (defaultAddress.coords) {
      setPickupPin({ ...defaultAddress.coords });
      // A saved pin was placed deliberately last time, so it outranks the
      // landmark match — otherwise restoring a saved address would move the
      // pin off the gate the customer chose and back to the building.
      setPinOrigin('map');
    }
  }, [defaultAddress]);

  // Arriving from a service card or a segment tile preselects the service.
  useEffect(() => {
    if (params.serviceId) setServiceId(bookableServiceId(params.serviceId));
  }, [params.serviceId]);

  const stepValid = useCallback(
    (candidate: Step): string | null => {
      switch (candidate) {
        case 0:
          return null; // A service is always selected.
        case 1:
          return pickupDate ? null : t('book.error.date');
        case 2:
          if (!address.trim()) return t('book.error.address');
          if (!pickupPin) return t('book.error.pin');
          if (!name.trim()) return t('book.error.name');
          if (!phone.trim()) return t('book.error.phone');
          // The rule lives in `@freshfold/core` and the wording lives here.
          // `PHONE_LENGTH_MESSAGE` is the same sentence in English, but it is
          // shared with the rider and web apps, which are not translated — so
          // this screen says it in the customer's language and core keeps
          // deciding what counts as a complete number.
          if (!isCompletePhone(phone)) {
            return t('settings.details.phoneLength', { digits: PHONE_DIGITS });
          }
          return null;
        case 3:
          return null; // Finishing choices all have defaults.
        case 4:
          if (method === 'Wallet' && !isAuthenticated) {
            return t('book.error.walletSignIn');
          }
          if (method === 'Wallet' && walletBalance < total) {
            return t('book.error.walletShort', { amount: formatCedis(walletBalance, locale) });
          }
          // Paying online is the one choice an email is not optional for.
          // Paystack sends the receipt there, and `/accounts/wallet` matches
          // that address against the session before it credits anything — so a
          // payment made without one is collected and then refused. Asked for
          // here, before the checkout opens, rather than after the money moves.
          if (method === 'Paystack' && !isEmailShaped(email)) {
            return t('book.error.paystackEmail');
          }
          return null;
      }
    },
    [
      pickupDate,
      address,
      pickupPin,
      name,
      phone,
      email,
      method,
      isAuthenticated,
      walletBalance,
      total,
      t,
      locale,
    ]
  );

  const advance = useCallback(() => {
    const problem = stepValid(step);
    if (problem) {
      setError(problem);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    setError('');
    Haptics.selectionAsync().catch(() => {});
    setStep((current) => Math.min(4, current + 1) as Step);
  }, [step, stepValid]);

  const retreat = useCallback(() => {
    setError('');
    if (step === 0) router.back();
    else setStep((current) => Math.max(0, current - 1) as Step);
  }, [step, router]);

  // ------------------------------------------------------------- payments

  const startPaystack = useCallback(async () => {
    setPaymentBusy(true);
    setPaymentNotice('');

    /**
     * Two things can fail here and they are not the same thing.
     *
     * Creating the transaction is the gateway; opening the checkout page is
     * this device's browser. Both used to land in one catch that said "could
     * not reach the payment gateway, try another method" — so a blocked popup
     * sent the customer off to pay by another route while a perfectly good
     * Paystack transaction sat there waiting for them.
     */
    let checkout: { reference: string; authorization_url: string };

    try {
      checkout = await api.initializePayment({
        // `stepValid(4)` has already refused this method without a real address,
        // so there is nothing to fall back to and nothing to invent.
        email: email.trim(),
        amount: total,
        // Back into this app, not to a website. Without it Paystack follows
        // the server's `APP_URL` and drops a phone on a localhost page that
        // does not exist on that phone. `flow` is only read if the app was
        // killed while the browser had the screen — see `paystack-success`.
        // Left unset under Expo Go, whose address is not ours to hand out —
        // see `paystackReturnUrl`.
        callback_url: paystackReturnUrl('book'),
        // What this payment is for. The server writes Paystack's metadata from
        // this and `bookingId` rather than taking an object from here — a
        // checkout that declared itself both a top-up and a booking payment
        // used to satisfy both settlement routes, so one payment settled the
        // bill and funded the wallet.
        purpose: 'booking',
        // Binds this payment to this booking. The server refuses to settle a
        // bill with a reference that names a different one.
        bookingId,
        // Dashboard-only. No settlement path reads anything in here.
        display: {
          customer_name: name || 'Patron',
          phone,
          service: service.name,
        },
      });
    } catch (err) {
      setPaymentBusy(false);
      // The server says why when it knows why — no key configured, Paystack
      // refused the amount — and that is worth more than a generic line.
      setPaymentNotice(
        err instanceof ApiError
          ? t('book.pay.gateway', { message: err.message })
          : t('book.pay.gatewayUnreachable')
      );
      return;
    }

    setPaystackRef(checkout.reference);

    try {
      await WebBrowser.openBrowserAsync(checkout.authorization_url);
      setPaymentNotice(t('book.pay.finishOnPage'));
    } catch {
      setPaymentNotice(t('book.pay.browserFailed', { reference: checkout.reference }));
    } finally {
      setPaymentBusy(false);
    }
    // `bookingId` belongs on this list. It is state, and `reset` mints a fresh
    // one for the next booking of the session — so a callback that closed over
    // the old one would open a checkout bound to the previous order, and the
    // server refuses to settle a bill with a reference naming a different
    // booking. That is the binding this id exists for.
  }, [bookingId, email, total, name, phone, service.name, t]);

  const verifyPaystack = useCallback(async () => {
    if (!paystackRef) return;
    setPaymentBusy(true);

    try {
      const result = await api.verifyPayment(paystackRef);
      const status = (result.data as { status?: string } | undefined)?.status;

      if (result.status && status === 'success') {
        setIsPaid(true);
        setPaymentNotice(t('book.pay.confirmed'));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        // The gateway's own state word, which it gives in English. Only the
        // stand-in for a missing one is translated.
        setPaymentNotice(
          t('book.pay.pending', { status: status ?? t('book.pay.pendingStatus') })
        );
      }
    } catch (err) {
      // The reference is kept either way, so none of these is a dead end — and
      // that is why none of them sends the customer to the desk any more. The
      // server says why when it knows why, and one of the things it now says is
      // that a gateway timeout left the money safe and is worth another tap;
      // that read as "verification failed, go and complain" before.
      setPaymentNotice(
        err instanceof ApiError
          ? t('book.pay.gateway', { message: err.message })
          : t('book.pay.verifyUnreachable')
      );
    } finally {
      setPaymentBusy(false);
    }
  }, [paystackRef, t]);

  // --------------------------------------------------------------- submit

  const submit = useCallback(async () => {
    const problem = stepValid(4);
    if (problem) {
      setError(problem);
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const id = bookingId;

      const booking: Booking = {
        id,
        name: name.trim(),
        /**
         * Blank when the customer left it blank, which the hint above says is
         * allowed.
         *
         * It used to fall back to `'patron@freshfold.com'`, and that address is
         * not inert — it is what the job is filed under. `jobs.list` scopes a
         * customer's history with `customer_email = <their address>`, so every
         * guest booking made from this screen without an email was filed under
         * one shared address, and anyone who registered it would have been
         * handed the lot by `GET /api/bookings`: names, addresses, phone
         * numbers and the `pickupOtp` a courier is asked for at the door.
         *
         * An empty string cannot be registered — `/auth/register` requires an
         * address — so it matches no account and nothing collects under it.
         */
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        // The lines the quote was computed from, with the primary pair derived
        // from the first — the server rewrites both the same way.
        items: quote.items,
        serviceType: quote.items[0].serviceType,
        quantity: quote.items[0].quantity,
        // No `planId` here on purpose. The server reads the membership off the
        // session and writes it onto the job itself — a plan sent from the app
        // was a claim it had no way to check, and `elite` priority for anyone
        // who set the field.
        pickupDate,
        pickupTime: timeSlot,
        deliveryDate,
        // The window the customer chose for the return, not just the day. Left
        // off entirely when the collection leaves no room for one — a same-day
        // return booked after the evening collection has nowhere to go, and
        // sending a window the server would refuse loses the whole booking.
        deliveryTime: returnOptions.some((slot) => slot.label === deliverySlot)
          ? deliverySlot
          : undefined,
        // The code as typed. What it is worth is the server's to decide.
        promoCode: promo?.code,
        // `encodeFinish` is the one writer of this format, shared with the
        // website, so the rider's job card and the admin dashboard read
        // identically whichever surface booked it. It drops the finish prefix on
        // a service that cannot take one — writing "Organic Lavender scent, None
        // starch" onto a car detail is noise on the courier's card.
        specialInstructions: encodeFinish({
          serviceType: service.name,
          scent,
          starch,
          notes: instructions,
        }),
        // Structured as well as composed into the sentence above, because the
        // server prices the booking from these rather than parsing English.
        scent: isGarmentService(service.name) ? scent : undefined,
        starch: isGarmentService(service.name) ? starch : undefined,
        specialtyAddons: addonIds.length > 0 ? addonIds : undefined,
        riderNote: riderNote.trim() || undefined,
        address: address.trim(),
        city: city.trim() || 'Kumasi',
        suburb,
        // Where the courier is actually sent. Without it the server falls back
        // to hashing the address, which is a point in the right suburb and the
        // wrong street.
        pickupCoords: pickupPin ?? undefined,
        status: 'Scheduled',
        createdAt: new Date().toISOString(),
        /**
         * How they mean to pay. Not whether they have, and not what it costs.
         *
         * `amount`, `paymentStatus`, `paidAt` and `transactionRef` are the
         * server's: it prices the booking with `quoteBooking` and will only mark
         * one `Paid` through `POST /bookings/:id/payment`. This screen used to
         * debit the wallet itself, set `paymentStatus: 'Paid'` and invent a
         * `TXN-…` reference — and once the server stopped honouring that, the
         * money left the wallet while the booking still read `Pending`.
         */
        paymentMethod: method,
      };

      const saved = await createBooking(booking);

      /**
       * Settle it, against the price the server worked out.
       *
       * After the booking rather than before: the pickup is real and dispatchable
       * either way, and one that could not be paid for reads `Pending` to the
       * desk, which is true. The wallet debit, its ledger row and the points it
       * earns all happen inside the route, on a locked account row — so there is
       * no separate `recordTransaction` here any more, and no way for the two to
       * disagree about what was taken.
       */
      let settled = saved;
      if (method !== 'Pay on Pickup' && (method === 'Wallet' || isPaid)) {
        /**
         * Two ways to settle, whatever the customer called it.
         *
         * `PaymentChoice` still lists 'MTN MoMo', 'Telecel Cash', 'AT Money' and
         * 'Card' from an earlier design; `PAYMENT_METHODS` offers none of them, and
         * every one of them would go through the Paystack checkout if it did. So
         * anything that is not the wallet is a Paystack settlement.
         */
        const settleAs = method === 'Wallet' ? 'Wallet' : 'Paystack';

        try {
          settled = await payForBooking(
            saved.id,
            settleAs,
            settleAs === 'Paystack' ? paystackRef : undefined
          );
        } catch (failure) {
          setPaymentNotice(
            failure instanceof ApiError
              ? t('book.pay.bookedThen', { message: failure.message })
              : t('book.pay.bookedUnsettled')
          );
        }
      }

      if (saveThisAddress && !bookIsFull) {
        saveAddress({
          id: `addr-${Date.now()}`,
          label: suburb,
          address: address.trim(),
          suburb,
          city: city.trim(),
          // The pin is the useful half of a saved address: next time the
          // customer picks it, the courier goes to the same doorstep rather
          // than to wherever the text hashes to.
          coords: pickupPin ?? undefined,
          isDefault: addresses.length === 0,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCreated(settled);
    } catch {
      setError(t('book.error.save'));
    } finally {
      setSubmitting(false);
    }
  }, [
    stepValid,
    isPaid,
    paystackRef,
    method,
    bookingId,
    payForBooking,
    service.name,
    name,
    email,
    phone,
    plan?.planId,
    pickupDate,
    timeSlot,
    scent,
    starch,
    instructions,
    addonIds,
    riderNote,
    address,
    city,
    suburb,
    pickupPin,
    createBooking,
    saveThisAddress,
    saveAddress,
    addresses.length,
    bookIsFull,
    t,
  ]);

  const reset = useCallback(() => {
    setCreated(null);
    setStep(0);
    setIsPaid(false);
    setPaystackRef('');
    setPaymentNotice('');
    setInstructions('');
    setRiderNote('');
    setAddonIds([]);
    // A fresh id for the next booking. Without this the second pickup of a
    // session would carry the first one's id and its Paystack reference.
    setBookingId(newJobId());
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={retreat} hitSlop={10} style={styles.back}>
          <ArrowLeft size={17} color={colors.textCharcoal} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('book.title')}</Text>
          <Text style={styles.headerStep}>
            {t('book.stepOf', {
              current: step + 1,
              total: 5,
              name: t(STEP_TITLE_KEYS[step]),
            })}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <ProgressBar percent={((step + 1) / 5) * 100} height={4} />
      </View>

      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 0 && (
            <View style={{ gap: 14 }}>
              <SectionLabel>{t('book.service.prompt')}</SectionLabel>

              <Pressable onPress={() => setServicePickerFor(0)}>
                <Card tone="sage" style={styles.selectedService}>
                  <View style={styles.serviceIcon}>
                    <Icon name={service.iconName} size={20} color={colors.brandSage} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedServiceName}>{service.name}</Text>
                    <Text style={styles.selectedServiceBody} numberOfLines={3}>
                      {c(`service.${service.id}.desc`, service.description)}
                    </Text>
                    <Badge
                      label={servicePriceLabel(t, c, locale, service)}
                      tone="sage"
                      style={{ marginTop: 7 }}
                    />
                  </View>
                  <ChevronRight size={16} color={colors.brandSage} />
                </Card>
              </Pressable>

              <Text style={styles.helper}>{t('book.service.helper')}</Text>

              {/*
                How many. Only for a service priced per countable thing — an
                order is one order however much of it there is, and a stepper
                beside "₵25 / order" asks a question with no answer.
              */}
              {countable && (
                <Card style={styles.quantityCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quantityLabel}>
                      {t('book.quantity.title', { unit: unitLabel(t, unit, 2) })}
                    </Text>
                    <Text style={styles.quantityHint}>
                      {/* This line's own price, not `base / quantity` — that
                          averages across every line on the order, so adding a
                          ₵25 service made a ₵30 load advertise itself at
                          ₵27.50. */}
                      {t('book.quantity.each', {
                        amount: formatCedis(serviceBasePrice(service.name), locale),
                        unit: unitLabel(t, unit, 1),
                      })}
                    </Text>
                  </View>

                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => setQuantity((n) => Math.max(1, n - 1))}
                      disabled={quantity <= 1}
                      hitSlop={8}
                      accessibilityLabel={t('book.quantity.fewer')}
                      style={[styles.stepperButton, quantity <= 1 && styles.stepperButtonOff]}
                    >
                      <Text style={[styles.stepperGlyph, quantity <= 1 && styles.stepperGlyphOff]}>
                        −
                      </Text>
                    </Pressable>

                    <Text style={styles.stepperValue}>{quantity}</Text>

                    <Pressable
                      onPress={() => setQuantity((n) => clampQuantity(n + 1, service.name))}
                      disabled={quantity >= MAX_QUANTITY}
                      hitSlop={8}
                      accessibilityLabel={t('book.quantity.more')}
                      style={[
                        styles.stepperButton,
                        quantity >= MAX_QUANTITY && styles.stepperButtonOff,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepperGlyph,
                          quantity >= MAX_QUANTITY && styles.stepperGlyphOff,
                        ]}
                      >
                        +
                      </Text>
                    </Pressable>
                  </View>
                </Card>
              )}

              {/*
                Anything beyond the first service. Each row is its own picker
                and its own stepper: a customer sending two loads of washing and
                a set of bed linen is one collection, and used to have to book
                it as two.
              */}
              {extras.map((item, i) => {
                const index = i + 1;
                const rowUnit = serviceUnit(item.serviceType);
                const rowCountable = serviceTakesQuantity(item.serviceType);

                return (
                  <Card key={index} style={{ gap: 10 }}>
                    <View style={styles.extraHead}>
                      <Pressable
                        onPress={() => setServicePickerFor(index)}
                        style={{ flex: 1 }}
                        accessibilityLabel={t('book.extra.change')}
                      >
                        <Text style={styles.extraName}>{item.serviceType}</Text>
                        <Text style={styles.extraChange}>{t('book.extra.change')}</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => removeLine(index)}
                        hitSlop={10}
                        accessibilityLabel={t('book.extra.remove')}
                        style={styles.extraRemove}
                      >
                        <Text style={styles.extraRemoveGlyph}>×</Text>
                      </Pressable>
                    </View>

                    {rowCountable && (
                      <View style={styles.quantityCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.quantityLabel}>
                            {t('book.quantity.title', { unit: unitLabel(t, rowUnit, 2) })}
                          </Text>
                        </View>

                        <View style={styles.stepper}>
                          <Pressable
                            onPress={() => setLineQuantity(index, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            hitSlop={8}
                            accessibilityLabel={t('book.quantity.fewer')}
                            style={[
                              styles.stepperButton,
                              item.quantity <= 1 && styles.stepperButtonOff,
                            ]}
                          >
                            <Text
                              style={[
                                styles.stepperGlyph,
                                item.quantity <= 1 && styles.stepperGlyphOff,
                              ]}
                            >
                              −
                            </Text>
                          </Pressable>

                          <Text style={styles.stepperValue}>{item.quantity}</Text>

                          <Pressable
                            onPress={() => setLineQuantity(index, item.quantity + 1)}
                            disabled={item.quantity >= MAX_QUANTITY}
                            hitSlop={8}
                            accessibilityLabel={t('book.quantity.more')}
                            style={[
                              styles.stepperButton,
                              item.quantity >= MAX_QUANTITY && styles.stepperButtonOff,
                            ]}
                          >
                            <Text
                              style={[
                                styles.stepperGlyph,
                                item.quantity >= MAX_QUANTITY && styles.stepperGlyphOff,
                              ]}
                            >
                              +
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </Card>
                );
              })}

              {items.length < MAX_ITEMS && (
                <Pressable onPress={addLine} accessibilityRole="button">
                  <Text style={styles.addService}>{t('book.extra.add')}</Text>
                </Pressable>
              )}

              {!!plan && (
                <Card tone="gold" style={{ gap: 4 }}>
                  <Text style={styles.planTitle}>
                    {membership.covered ? t('book.plan.coveredTitle') : t('book.plan.title')}
                  </Text>
                  <Text style={styles.planBody}>
                    {membership.covered
                      ? t('book.plan.coveredBody', {
                          left: membership.remainingPickups,
                          total: planDefinition?.includedPickups ?? 0,
                        })
                      : membership.discount > 0
                        ? t('book.plan.rateBody', {
                            date: new Date(plan.renewsOn).toLocaleDateString(intlTag(locale)),
                          })
                        : t('book.plan.priorityBody')}
                  </Text>
                </Card>
              )}
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: 18 }}>
              <View style={{ gap: 10 }}>
                <SectionLabel>{t('book.date.title')}</SectionLabel>
                <View style={styles.dateRow}>
                  {[0, 1, 2, 3, 4].map((offset) => {
                    const iso = isoDaysFromNow(offset);
                    const date = new Date(iso);
                    const active = iso === pickupDate;

                    return (
                      <Pressable
                        key={iso}
                        onPress={() => setPickupDate(iso)}
                        style={[styles.dateCell, active && styles.dateCellActive]}
                      >
                        <Text style={[styles.dateDow, active && styles.dateTextActive]}>
                          {/* The first two cells are named; the rest are the
                              weekday, which Intl already knows how to say in
                              the customer's language. */}
                          {offset === 0
                            ? t('book.date.today')
                            : offset === 1
                              ? t('book.date.tomorrow')
                              : date.toLocaleDateString(intlTag(locale), { weekday: 'short' })}
                        </Text>
                        <Text style={[styles.dateNum, active && styles.dateTextActive]}>
                          {date.getDate()}
                        </Text>
                        <Text style={[styles.dateMon, active && styles.dateTextActive]}>
                          {date.toLocaleDateString(intlTag(locale), { month: 'short' })}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Field
                  label={t('book.date.field')}
                  value={pickupDate}
                  onChangeText={setPickupDate}
                  placeholder={t('book.date.placeholder')}
                  icon={<Calendar size={15} color={colors.textMuted} />}
                  hint={t('book.date.hint')}
                />
              </View>

              <View style={{ gap: 9 }}>
                <SectionLabel>{t('book.window.title')}</SectionLabel>
                {PICKUP_TIME_SLOTS.map((slot) => {
                  const state = slotState[slot];
                  const window = slot.match(/\((.*)\)/)?.[1];

                  return (
                    <OptionRow
                      key={slot}
                      title={slot.split(' (')[0]}
                      subtitle={
                        state?.full
                          ? t('book.window.full')
                          : state && state.remaining <= 3
                            ? t('book.window.remaining', { count: state.remaining })
                            : window
                      }
                      // A full window cannot be chosen. Left visible rather than
                      // hidden: "that one is full" is information, and a list
                      // that silently shortens looks like a bug.
                      disabled={state?.full}
                      selected={timeSlot === slot}
                      onPress={() => {
                        if (!state?.full) setTimeSlot(slot);
                      }}
                      trailing={
                        timeSlot === slot ? <Check size={16} color={colors.brandSage} /> : undefined
                      }
                    />
                  );
                })}
              </View>

              {/* ------------------------------------------------- the return */}
              <View style={{ gap: 9 }}>
                <SectionLabel>{t('book.return.title')}</SectionLabel>
                <Text style={styles.returnDay}>
                  {t('book.return.day', { date: formatDate(deliveryDate, locale) })}
                </Text>

                {DELIVERY_TIME_SLOTS.map((slot) => {
                  const state = deliveryState[slot];
                  const window = slot.match(/\((.*)\)/)?.[1];
                  // Unreachable is not the same as full: a same-day return
                  // cannot leave before the laundry is back, and saying so is
                  // more use than a generic "unavailable".
                  const reachable = returnOptions.some((option) => option.label === slot);
                  const blocked = !reachable || !!state?.full;

                  return (
                    <OptionRow
                      key={slot}
                      title={slot.split(' (')[0]}
                      subtitle={
                        !reachable
                          ? t('book.return.tooEarly')
                          : state?.full
                            ? t('book.window.full')
                            : state && state.remaining <= 3
                              ? t('book.window.remaining', { count: state.remaining })
                              : window
                      }
                      disabled={blocked}
                      selected={deliverySlot === slot}
                      onPress={() => {
                        if (!blocked) setDeliverySlot(slot);
                      }}
                      trailing={
                        deliverySlot === slot ? (
                          <Check size={16} color={colors.brandSage} />
                        ) : undefined
                      }
                    />
                  );
                })}
              </View>
            </View>
          )}

          {step === 2 && (
            <View style={{ gap: 16 }}>
              {addresses.length > 0 && (
                <Pressable onPress={() => setAddressPickerOpen(true)}>
                  <Card tone="sunken" style={styles.savedRow}>
                    <Bookmark size={15} color={colors.brandSage} />
                    <Text style={styles.savedLabel}>{t('book.address.saved')}</Text>
                    <ChevronRight size={15} color={colors.textMuted} />
                  </Card>
                </Pressable>
              )}

              {/* Choosing a suggestion puts the pin on the building, so the
                  block and room get typed onto an address already in the right
                  place. Typing straight past the list still works. */}
              <AddressAutocomplete
                value={address}
                onChangeText={setAddress}
                onPlaceSelected={(detail) => {
                  setAddress(detail.address);
                  setPickupPin(detail.coords);
                  setPinOrigin('place');
                }}
                placeholder={t('address.addressPlaceholder')}
                hint={t('book.address.hint')}
              />

              {/* The suburb sheet used to sit here. It is derived from the pin
                  now — a customer who has dropped one has already said where
                  they are, and picking a collection zone as well was asking
                  them to do our filing.

                  The label and its example town are the address sheet's own
                  keys: it is the same field, so it is not worded twice. */}
              <Field
                label={t('address.city')}
                value={city}
                onChangeText={setCity}
                placeholder={t('address.cityPlaceholder')}
              />

              <View style={{ gap: 8 }}>
                <SectionLabel>{t('book.pin.title')}</SectionLabel>
                <Text style={styles.pinIntro}>{t('book.pin.intro')}</Text>
                <PickupPinPicker
                  value={pickupPin}
                  onChange={setPickupPin}
                  suburb={suburb}
                  address={address}
                  origin={pinOrigin}
                  onOriginChange={setPinOrigin}
                  onAddressSuggested={setAddress}
                />
              </View>

              <Pressable
                onPress={() => setSaveThisAddress((current) => !current)}
                disabled={bookIsFull}
                style={styles.checkRow}
              >
                <View
                  style={[
                    styles.checkbox,
                    saveThisAddress && !bookIsFull && styles.checkboxOn,
                    bookIsFull && styles.checkboxOff,
                  ]}
                >
                  {saveThisAddress && !bookIsFull && (
                    <Check size={11} color="#FFFFFF" strokeWidth={3} />
                  )}
                </View>
                <Text style={[styles.checkLabel, bookIsFull && styles.checkLabelOff]}>
                  {/* `MAX_SAVED_ADDRESSES` is the server's ceiling, passed in
                      rather than written into three dictionaries. */}
                  {bookIsFull
                    ? t('addresses.full', { max: MAX_SAVED_ADDRESSES })
                    : t('book.address.save')}
                </Text>
              </Pressable>

              <Divider />

              <SectionLabel>{t('book.contact.title')}</SectionLabel>
              <Field
                label={t('book.contact.name')}
                value={name}
                onChangeText={setName}
                placeholder={t('book.contact.namePlaceholder')}
              />
              <Field
                label={t('settings.details.phone')}
                value={phone}
                onChangeText={(next) => setPhone(limitPhoneInput(next))}
                placeholder={t('settings.details.phonePlaceholder', { digits: PHONE_DIGITS })}
                keyboardType="phone-pad"
                maxLength={PHONE_DIGITS}
              />
              <Field
                label={t('settings.details.email')}
                value={email}
                onChangeText={setEmail}
                placeholder={t('book.contact.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                hint={isAuthenticated ? undefined : t('book.contact.emailHint')}
              />
            </View>
          )}

          {step === 3 && (
            <View style={{ gap: 18 }}>
              {isGarmentService(service.name) ? (
                <>
                  <View style={{ gap: 9 }}>
                    <SectionLabel>{t('book.scent.title')}</SectionLabel>
                    {SCENTS.map((option) => (
                      <OptionRow
                        key={option.id}
                        title={c(`pay.${option.id}.label`, option.label)}
                        subtitle={
                          option.surcharge > 0
                            ? `+ ${formatCedis(option.surcharge, locale)}`
                            : t('book.scent.noSurcharge')
                        }
                        selected={scent === option.id}
                        onPress={() => setScent(option.id)}
                        trailing={
                          scent === option.id ? <Check size={16} color={colors.brandSage} /> : undefined
                        }
                      />
                    ))}
                  </View>

                  <View style={{ gap: 9 }}>
                    <SectionLabel>{t('book.starch.title')}</SectionLabel>
                    <View style={styles.starchRow}>
                      {STARCH_LEVELS.map((option) => (
                        <Pressable
                          key={option.id}
                          onPress={() => setStarch(option.id)}
                          style={[
                            styles.starchCell,
                            starch === option.id && styles.starchCellActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.starchLabel,
                              starch === option.id && styles.starchLabelActive,
                            ]}
                          >
                            {c(`pay.${option.id}.label`, option.label)}
                          </Text>
                          {option.surcharge > 0 && (
                            <Text
                              style={[
                                styles.starchMeta,
                                starch === option.id && { color: 'rgba(255,255,255,0.75)' },
                              ]}
                            >
                              + {formatCedis(option.surcharge, locale)}
                            </Text>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </>
              ) : (
                <Card tone="sunken" style={{ gap: 4 }}>
                  <Text style={styles.planTitle}>{t('book.finish.noneTitle')}</Text>
                  <Text style={styles.planBody}>
                    {t('book.finish.noneBody', {
                      service: c(`service.${service.id}.short`, service.shortName),
                    })}
                  </Text>
                </Card>
              )}

              <View style={{ gap: 9 }}>
                <SectionLabel>{t('book.addons.title')}</SectionLabel>
                {SPECIALTY_ADDONS.map((addon) => {
                  const on = addonIds.includes(addon.id);
                  return (
                    <OptionRow
                      key={addon.id}
                      title={addon.label}
                      subtitle={`${addon.description} · ${formatCedis(addon.price, locale)}`}
                      icon={<Icon name={addon.iconName} size={15} color={colors.brandSage} />}
                      selected={on}
                      onPress={() =>
                        setAddonIds((current) =>
                          on ? current.filter((id) => id !== addon.id) : [...current, addon.id]
                        )
                      }
                      trailing={on ? <Check size={16} color={colors.brandSage} /> : undefined}
                    />
                  );
                })}
              </View>

              <Field
                label={t('book.instructions.label')}
                value={instructions}
                onChangeText={setInstructions}
                placeholder={t('book.instructions.placeholder')}
                multiline
              />
              <Field
                label={t('book.riderNote.label')}
                value={riderNote}
                onChangeText={setRiderNote}
                placeholder={t('book.riderNote.placeholder')}
                multiline
                hint={t('book.riderNote.hint')}
              />
            </View>
          )}

          {step === 4 && (
            <View style={{ gap: 16 }}>
              <Card style={{ gap: 10 }}>
                <SectionLabel>{t('book.summary.title')}</SectionLabel>
                <SummaryRow label={t('book.summary.service')} value={service.name} />
                <SummaryRow
                  label={t('book.summary.pickup')}
                  value={`${pickupDate} · ${timeSlot.split(' (')[0]}`}
                />
                <SummaryRow
                  label={t('book.summary.address')}
                  value={[address, suburb].filter(Boolean).join(', ') || t('common.blank')}
                />
                <SummaryRow
                  label={t('book.summary.pin')}
                  value={
                    pickupPin
                      ? `${pickupPin.lat.toFixed(5)}° N, ${Math.abs(pickupPin.lng).toFixed(5)}° W`
                      : t('book.summary.pinUnset')
                  }
                />
                {isGarmentService(service.name) && (
                  <SummaryRow
                    label={t('book.summary.finish')}
                    value={t('book.summary.finishValue', { scent, starch })}
                  />
                )}
                {addonIds.length > 0 && (
                  <SummaryRow label={t('book.summary.addons')} value={addonIds.join(', ')} />
                )}

                <Divider style={{ marginVertical: 4 }} />

                <SummaryRow label={t('book.summary.subtotal')} value={formatCedis(gross, locale)} />
                {membership.waived > 0 && (
                  <SummaryRow
                    label={t('book.summary.planIncluded', {
                      plan: planDefinition?.name ?? t('book.summary.planFallback'),
                    })}
                    value={t('book.summary.less', {
                      amount: formatCedis(membership.waived, locale),
                    })}
                    tone="success"
                  />
                )}
                {membership.discount > 0 && (
                  <SummaryRow
                    label={t('book.summary.memberRate')}
                    value={t('book.summary.less', {
                      amount: formatCedis(membership.discount, locale),
                    })}
                    tone="success"
                  />
                )}
                {discount > 0 && (
                  <SummaryRow
                    label={t('book.summary.tierDiscount', { tier: tier.name })}
                    value={t('book.summary.less', { amount: formatCedis(discount, locale) })}
                    tone="success"
                  />
                )}
                {promoDiscount > 0 && promo && (
                  <SummaryRow
                    label={t('book.summary.promo', { code: promo.code })}
                    value={t('book.summary.less', {
                      amount: formatCedis(promoDiscount, locale),
                    })}
                    tone="success"
                  />
                )}
                <SummaryRow
                  label={t('book.summary.total')}
                  value={formatCedis(total, locale)}
                  emphasis
                />
                {/* The tax already inside that number. No price anywhere in the
                    product carried a tax line before this. */}
                {taxLine.tax > 0 && (
                  <SummaryRow
                    label={t('book.summary.taxIncluded')}
                    value={formatCedis(taxLine.tax, locale)}
                  />
                )}
              </Card>

              <View style={{ gap: 8 }}>
                <SectionLabel>{t('book.promo.title')}</SectionLabel>
                <View style={styles.promoRow}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label=""
                      value={promoInput}
                      onChangeText={(value) => setPromoInput(value.toUpperCase())}
                      placeholder={t('book.promo.placeholder')}
                      autoCapitalize="characters"
                    />
                  </View>
                  <Button
                    label={
                      promo
                        ? t('common.remove')
                        : promoChecking
                          ? t('book.promo.checking')
                          : t('book.promo.apply')
                    }
                    variant={promo ? 'ghost' : 'outline'}
                    size="sm"
                    disabled={promoChecking || (!promo && !promoInput.trim())}
                    onPress={() => {
                      if (promo) {
                        setPromo(null);
                        setPromoInput('');
                        setPromoError('');
                      } else {
                        void applyPromo();
                      }
                    }}
                  />
                </View>
                {!!promo && (
                  <Text style={styles.promoOk}>
                    {t('book.promo.applied', {
                      code: promo.code,
                      amount: formatCedis(promoDiscount, locale),
                    })}
                  </Text>
                )}
                {!!promoError && <Text style={styles.promoError}>{promoError}</Text>}
              </View>

              <View style={{ gap: 9 }}>
                <SectionLabel>{t('book.pay.title')}</SectionLabel>
                {PAYMENT_METHODS.map((option) => {
                  const walletShort = option.id === 'Wallet' && walletBalance < total;
                  return (
                    <OptionRow
                      key={option.id}
                      title={c(`pay.${option.id}.label`, option.label)}
                      subtitle={
                        option.id === 'Wallet'
                          ? walletShort
                            ? t('book.pay.walletShort', {
                                amount: formatCedis(walletBalance, locale),
                              })
                            : t('book.pay.walletBalance', {
                                amount: formatCedis(walletBalance, locale),
                              })
                          : c(`pay.${option.id}.blurb`, option.blurb)
                      }
                      icon={<Icon name={option.iconName} size={15} color={colors.brandSage} />}
                      selected={method === option.id}
                      onPress={() => {
                        setMethod(option.id);
                        setIsPaid(false);
                        setPaymentNotice('');
                        setError('');
                      }}
                      disabled={option.id === 'Wallet' && !isAuthenticated}
                      trailing={
                        method === option.id ? <Check size={16} color={colors.brandSage} /> : undefined
                      }
                    />
                  );
                })}
              </View>

              {/* Method-specific detail */}
              {method === 'Paystack' && (
                <Card style={{ gap: 10 }}>
                  <Text style={styles.payTitle}>{t('book.pay.paystackTitle')}</Text>
                  <Text style={styles.payBody}>{t('book.pay.paystackBody')}</Text>
                  <Button
                    label={paystackRef ? t('book.pay.reopen') : t('book.pay.open')}
                    variant="outline"
                    onPress={startPaystack}
                    loading={paymentBusy}
                  />
                  {!!paystackRef && !isPaid && (
                    <Button
                      label={t('book.pay.verify')}
                      onPress={verifyPaystack}
                      loading={paymentBusy}
                    />
                  )}
                </Card>
              )}

              {method === 'Pay on Pickup' && (
                <Card tone="sunken" style={{ gap: 4 }}>
                  <Text style={styles.payTitle}>{t('book.pay.doorTitle')}</Text>
                  <Text style={styles.payBody}>{t('book.pay.doorBody')}</Text>
                </Card>
              )}

              {!!paymentNotice && (
                <View style={styles.notice}>
                  <Sparkles size={13} color={colors.brandSage} />
                  <Text style={styles.noticeText}>{paymentNotice}</Text>
                </View>
              )}
            </View>
          )}

          {!!error && (
            <View style={styles.errorBox}>
              <CircleAlert size={14} color={colors.statusError} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* ------------------------------------------------------ quote bar */}
        <View style={styles.quoteBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.quoteLabel}>
              {step === 4 ? t('book.quote.due') : t('book.quote.running')}
            </Text>
            <Text style={styles.quoteValue}>{formatCedis(total, locale)}</Text>
            {total < gross && (
              <Text style={styles.quoteStrike}>
                {/* The reason is a phrase inside the sentence rather than a
                    fragment glued onto it, so a language can put the
                    possessive where its own grammar wants it. */}
                {t('book.quote.before', {
                  amount: formatCedis(gross, locale),
                  reason:
                    membership.waived > 0
                      ? t('book.quote.reasonIncluded')
                      : membership.discount > 0 && discount > 0
                        ? t('book.quote.reasonBoth')
                        : membership.discount > 0
                          ? t('book.quote.reasonMember')
                          : t('book.quote.reasonTier'),
                })}
              </Text>
            )}
          </View>

          {step < 4 ? (
            <Button
              label={t('book.continue')}
              onPress={advance}
              size="lg"
              iconRight={<ArrowRight size={15} color="#FFFFFF" />}
              style={{ minWidth: 148 }}
            />
          ) : (
            <Button
              label={t('book.confirm')}
              onPress={submit}
              loading={submitting}
              size="lg"
              style={{ minWidth: 158 }}
            />
          )}
        </View>
      </KeyboardAvoider>

      {/* ---------------------------------------------------------- pickers */}
      <ScrollSheet
        visible={servicePickerOpen}
        onClose={() => setServicePickerFor(null)}
        title={t('book.picker.service')}
      >
        {BOOKABLE_SERVICES.map((option) => (
          <OptionRow
            key={option.id}
            title={option.name}
            subtitle={`${servicePriceLabel(t, c, locale, option)} · ${c(`service.${option.id}.desc`, option.description)}`}
            icon={<Icon name={option.iconName} size={15} color={colors.brandSage} />}
            selected={option.name === items[servicePickerFor ?? 0]?.serviceType}
            onPress={() => {
              setLineService(servicePickerFor ?? 0, option.name);
              setServicePickerFor(null);
            }}
          />
        ))}
      </ScrollSheet>

      <ScrollSheet
        visible={addressPickerOpen}
        onClose={() => setAddressPickerOpen(false)}
        title={t('book.picker.addresses')}
      >
        {addresses.map((saved) => (
          <OptionRow
            key={saved.id}
            title={saved.label}
            subtitle={[saved.address, saved.suburb].filter(Boolean).join(', ')}
            icon={<MapPin size={15} color={colors.brandSage} />}
            onPress={() => {
              setAddress(saved.address);
              if (saved.city) setCity(saved.city);
              // Addresses saved before pins existed have none; the customer
              // places one and this address learns it on the next save.
              setPickupPin(saved.coords ? { ...saved.coords } : null);
              // A saved pin was aimed deliberately last time, so it outranks
              // the landmark match the address would otherwise trigger.
              setPinOrigin(saved.coords ? 'map' : null);
              setAddressPickerOpen(false);
            }}
          />
        ))}
      </ScrollSheet>

      {/* ----------------------------------------------------- confirmation */}
      <Sheet visible={!!created} onClose={reset}>
        {!!created && (
          <View style={styles.confirm}>
            <View style={styles.confirmMark}>
              <Check size={26} color="#FFFFFF" strokeWidth={3} />
            </View>
            <Text style={styles.confirmTitle}>{t('book.done.title')}</Text>
            <Text style={styles.confirmBody}>
              {/* Two keys around a bold reference, rather than one sentence with
                  markup in it. */}
              {t('book.done.bodyBefore')} <Text style={styles.confirmRef}>{created.id}</Text>{' '}
              {t('book.done.bodyAfter')}
            </Text>

            <Card tone="sunken" style={{ width: '100%', gap: 8, marginTop: 4 }}>
              <SummaryRow
                label={t('book.done.collection')}
                value={`${created.pickupDate} · ${timeSlot.split(' (')[0]}`}
              />
              <SummaryRow label={t('book.done.return')} value={created.deliveryDate} />
              {/* The status word is the server's vocabulary, not this app's — it
                  arrives in English and the same word appears on the dispatch
                  board and in the desk's mail. A `status.*` block can translate
                  the set once, with the order screens. */}
              <SummaryRow label={t('book.done.paid')} value={created.paymentStatus ?? 'Pending'} />
              <SummaryRow
                label={t('book.summary.total')}
                value={formatCedis(created.amount ?? 0, locale)}
                emphasis
              />
            </Card>

            <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 }}>
              <Button
                label={t('book.done.another')}
                variant="ghost"
                onPress={reset}
                style={{ flex: 1 }}
              />
              <Button
                label={t('book.done.track')}
                onPress={() => {
                  const id = created.id;
                  reset();
                  router.push({ pathname: '/order/[id]', params: { id } });
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: 'success';
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          emphasis && styles.summaryValueStrong,
          tone === 'success' && { color: colors.statusSuccess },
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}


/**
 * `days` after a pickup date, falling back when the field is not a date yet.
 *
 * The arithmetic moved to `@freshfold/core` — the website's booking form had
 * its own copy of these two, and a delivery date computed one way here and
 * another way there is exactly the drift that package exists to stop. What is
 * left is the fallback, which is this screen's business: `isoPlusDays` returns
 * null for a half-typed date rather than guessing, and what to show instead is
 * a question about this form.
 */
function isoDaysAfter(iso: string, days: number): string {
  return isoPlusDays(iso, days) ?? isoDaysFromNow(days + 1);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },

  returnDay: { fontSize: 12, color: colors.textMuted, marginTop: -3 },

  promoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  promoOk: { fontSize: 11.5, color: colors.statusSuccess },
  promoError: { fontSize: 11.5, color: colors.statusError },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.3 },
  headerStep: { fontSize: 10.5, color: colors.textSlate, marginTop: 2 },

  scroll: { padding: 20, paddingTop: 14, paddingBottom: 30 },

  selectedService: { flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  serviceIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.cardPure,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedServiceName: { fontSize: 14, fontWeight: '800', color: colors.textCharcoal },
  selectedServiceBody: { fontSize: 11, color: colors.textSlate, marginTop: 4, lineHeight: 15.5 },
  helper: { fontSize: 11, color: colors.textMuted, lineHeight: 15.5 },

  extraHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  extraName: { fontSize: 13, fontWeight: '800', color: colors.textCharcoal },
  extraChange: { fontSize: 11, color: colors.brandSage, marginTop: 2, fontWeight: '700' },
  extraRemove: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgLinen,
  },
  extraRemoveGlyph: { fontSize: 17, lineHeight: 20, color: colors.textSlate, fontWeight: '700' },
  addService: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.brandSage,
    paddingVertical: 6,
  },

  quantityCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quantityLabel: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  quantityHint: { fontSize: 11, color: colors.textSlate, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // 40pt, so each control clears the minimum touch target on its own without
  // relying on the `hitSlop` — a stepper is tapped repeatedly and in a hurry.
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgLinen,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  stepperButtonOff: { opacity: 0.4 },
  stepperGlyph: { fontSize: 20, fontWeight: '700', color: colors.textCharcoal, lineHeight: 24 },
  stepperGlyphOff: { color: colors.textMuted },
  stepperValue: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: colors.textCharcoal,
    fontVariant: ['tabular-nums'],
  },
  planTitle: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  planBody: { fontSize: 11, color: colors.textSlate, lineHeight: 15.5 },

  dateRow: { flexDirection: 'row', gap: 7 },
  dateCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
    gap: 1,
  },
  dateCellActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  dateDow: { fontSize: 8.5, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  dateNum: { fontSize: 16, fontWeight: '800', color: colors.textCharcoal },
  dateMon: { fontSize: 8.5, color: colors.textMuted },
  dateTextActive: { color: '#FFFFFF' },

  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13 },
  savedLabel: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textCharcoal },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.brandStone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  checkboxOff: { opacity: 0.45 },
  checkLabel: { fontSize: 11.5, color: colors.textCharcoal },
  checkLabelOff: { color: colors.textSlate },
  pinIntro: { fontSize: 10.5, color: colors.textSlate, lineHeight: 14.5 },

  starchRow: { flexDirection: 'row', gap: 8 },
  starchCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
    gap: 2,
  },
  starchCellActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  starchLabel: { fontSize: 12, fontWeight: '700', color: colors.textCharcoal },
  starchLabelActive: { color: '#FFFFFF' },
  starchMeta: { fontSize: 9, color: colors.textMuted },

  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  summaryLabel: { width: 92, fontSize: 10.5, color: colors.textMuted },
  summaryValue: { flex: 1, fontSize: 11.5, color: colors.textCharcoal, textAlign: 'right' },
  summaryValueStrong: { fontSize: 14, fontWeight: '800' },

  payTitle: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  payBody: { fontSize: 11, color: colors.textSlate, lineHeight: 15.5 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: tints.sage05,
    borderWidth: 1,
    borderColor: tints.sage18,
    borderRadius: radius.md,
    padding: 11,
  },
  noticeText: { flex: 1, fontSize: 11, color: colors.textCharcoal, lineHeight: 15 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: tints.error08,
    borderWidth: 1,
    borderColor: tints.error25,
    borderRadius: radius.md,
    padding: 11,
    marginTop: 16,
  },
  errorText: { flex: 1, fontSize: 11, color: colors.statusError, lineHeight: 15 },

  quoteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.cardPure,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingHorizontal: 20,
    paddingVertical: 13,
    ...shadow.lg,
  },
  quoteLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  quoteValue: {
    fontSize: 21,
    fontWeight: '800',
    color: colors.textCharcoal,
    letterSpacing: -0.5,
    marginTop: 1,
  },
  quoteStrike: { fontSize: 9.5, color: colors.textMuted, marginTop: 1 },

  confirm: { alignItems: 'center', gap: 10, padding: 24, paddingTop: 12 },
  confirmMark: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.statusSuccess,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: { fontSize: 21, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.4 },
  confirmBody: {
    fontSize: 11.5,
    color: colors.textSlate,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 8,
  },
  confirmRef: { fontWeight: '800', color: colors.brandSage },
});

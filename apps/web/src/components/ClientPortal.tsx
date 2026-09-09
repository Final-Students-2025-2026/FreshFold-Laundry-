import React, { useState, useEffect, useCallback } from 'react';
import { Booking, UserAccount } from '../types';
import * as store from '../services/store';
import { displayAmount } from '../services/amount';
import {
  passwordProblem,
  ADDRESS_LIMIT_MESSAGE,
  ApiError,
  BOOKING_STAGE_SEQUENCE,
  LOYALTY_REWARDS,
  MAX_SAVED_ADDRESSES,
  PHONE_DIGITS,
  PHONE_LENGTH_MESSAGE,
  SERVICE_SUBURBS,
  bookingProgressPercent,
  canReschedule,
  decodeFinish,
  isCompletePhone,
  limitPhoneInput,
  describeItems,
  membershipPlan,
  priceBreakdown,
  samePhone,
  tierForPoints,
  tierProgress,
  withAddress,
  withoutAddress,
  type Job,
  type JobStatus,
  type LoyaltyTierId,
  type Message,
  type SavedAddress,
} from '@freshfold/core';
import { failureMessage } from '@freshfold/core';
import {
  X, Lock, Mail, User, LogOut, MapPin, Clock, ChevronRight,
  Check, Plus, Send, AlertTriangle, AlertCircle, Wallet, Receipt,
  MessageSquare, Trash2, Pencil, CalendarClock, ArrowLeft, Package,
} from 'lucide-react';
import LiveDispatchMap from './LiveDispatchMap';
import HandoffCode from './HandoffCode';
import RescheduleDrawer from './RescheduleDrawer';
import AddressAutocomplete from './AddressAutocomplete';
import { openCheckoutWindow, usePaystackReturn } from './PaystackReturn';
import PaystackMark from './ui/PaystackMark';
import { paymentLabel, windowLabel } from './ui/slots';

/**
 * Dispatch states in which the bags are still with the customer, and the
 * collection code is therefore worth showing.
 */
const COLLECTION_PENDING = new Set<JobStatus>([
  'unassigned',
  'assigned',
  'navigating_to_pickup',
  'arrived_at_pickup',
]);

/**
 * And the states in which the clean laundry is on its way back, so the
 * delivery code is the one worth showing. It appears as the courier sets off
 * rather than when they knock — a customer who has to hunt for it with
 * somebody waiting at the door will just read out whatever is nearest.
 */
const DELIVERY_PENDING = new Set<JobStatus>([
  'ready_for_delivery',
  'navigating_to_delivery',
  'arrived_at_delivery',
]);


/**
 * Who a message is from, in the customer's language. The wire values are the
 * dispatch team's own vocabulary, and "laundry_center" on a bubble helps
 * nobody.
 *
 * Plain job titles rather than the house style this product has stopped using:
 * "Wagyingo Opal Atelier" was the shop calling itself an atelier on a message
 * bubble, to a customer who is asking which gate to come to.
 */
const SENDER_LABELS: Record<Message['sender'], string> = {
  rider: 'Your rider',
  customer: 'You',
  dispatcher: 'The desk',
  laundry_center: 'The shop',
};

/**
 * The one ink each loyalty tier is written in.
 *
 * The tiers themselves — names, thresholds, discounts, benefits — come from
 * `@freshfold/core` and are shared with the customer app and the server. This
 * portal used to carry its own table inline, with Silver starting at 400 points
 * and Gold at 700 against 500 and 1500 everywhere else, so the same customer
 * read as Gold on the website and Silver in the app.
 *
 * What is left here is a colour, and it is the same colour the landing's
 * membership section paints each tier in, so a customer sees one Silver across
 * both. Sage-light rather than sage: `--color-brand-sage` is 2.4:1 on charcoal
 * and is a fill that carries white text, never an ink.
 */
const TIER_INK: Record<LoyaltyTierId, string> = {
  gold: 'text-brand-gold',
  silver: 'text-brand-sage-light',
  basic: 'text-white',
};

import {
  AS_MONEY,
  AS_PRIMARY,
  AS_QUIET,
  Banner,
  BTN,
  FIELD,
  LABEL,
  Modal,
  Panel,
  PanelHead,
  PaymentPill,
  Row,
  SIZE_MD,
  SIZE_SM,
  whenLine,
} from './ui/portal';

/**
 * The three places there are to be.
 *
 * There were four, and the fourth was the problem: a "Dashboard & Live Map"
 * tab beside a "My Orders" tab, which meant the answer to "where is my
 * laundry" and the answer to "what have I ordered" were two different screens
 * that each showed half of both. The wallet then appeared on all three — in
 * the tab's own label, as a card on the dashboard, and again on the wallet
 * page — so the same balance was on screen three times and none of them was
 * the place to go and change it.
 *
 * Orders is where an order is. Wallet is where money is. Account is where you
 * are. Nothing appears in two of them.
 */
const NAV_ITEMS = [
  { id: 'orders', label: 'Orders', icon: Package },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'account', label: 'Account', icon: User },
] as const;

type PortalTab = (typeof NAV_ITEMS)[number]['id'];

/** What `GET /api/auth/claim` hands back for a live setup link. */
interface SetupBooking {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface ClientPortalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingIdParam: string | null;
  /** The token from an emailed setup link, or null when this is a plain visit. */
  setupTokenParam: string | null;
  activeBookings: Booking[];
  onUpdateBookings: (bookings: Booking[]) => void;
  onOpenBooking: () => void;
}

/**
 * An order with nowhere left to go.
 *
 * Both terminal stages, which is the rest of the product's definition —
 * `App`'s tracking notifier, both of the desk's live counts, and the client
 * app's own active/history split all read "done" as delivered *or* cancelled.
 * This screen used to be the one place that read it as delivered alone, and it
 * did so in three separate expressions, so a cancelled order sat in the tab
 * labelled "In progress", never appeared under the one labelled "Delivered",
 * and carried a Track button offering to follow an order that had been called
 * off. The same file's `liveOrders` already excluded it, so the tracking card
 * and the list underneath disagreed about the same order on the same screen.
 *
 * One predicate rather than three comparisons, because three comparisons is
 * exactly how those drifted apart.
 */
function isClosed(booking: Booking): boolean {
  return booking.status === 'Delivered' || booking.status === 'Cancelled';
}

export default function ClientPortal({
  isOpen,
  onClose,
  bookingIdParam,
  setupTokenParam,
  activeBookings,
  onUpdateBookings,
  onOpenBooking
}: ClientPortalProps) {
  // Authentication states
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [inputIdentifier, setInputIdentifier] = useState(''); // Email or Phone
  const [inputPassword, setInputPassword] = useState('');
  
  // Setup Password states
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  /**
   * The booking a setup link opens, as the server describes it.
   *
   * Not a full `Booking`: the token buys the contact details this screen shows
   * and nothing else — no address, no payment, no hand-off codes. What the
   * order is doing is the tracking terminal's business, once there is a login.
   */
  const [setupBooking, setSetupBooking] = useState<SetupBooking | null>(null);
  const [setupError, setSetupError] = useState('');
  const [loginError, setLoginError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // The unconfirmed-email notice. `verifyNotice` carries whatever the server
  // last said — a cooldown message is more useful to show than to swallow.
  const [verifySending, setVerifySending] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string>('');

  // The reset request is in flight. Its outcome rides on the existing
  // success/error banners rather than a third one — the sign-in card already
  // has two places to look, and a locked-out customer does not need a fourth.
  const [resetSending, setResetSending] = useState(false);

  // And the same for "send my setup link again", which shares those banners.
  const [setupSending, setSetupSending] = useState(false);

  // Active User Data states
  const [userBookings, setUserBookings] = useState<Booking[]>([]);
  const [activeTrackingId, setActiveTrackingId] = useState<string | null>(null);
  /** The booking whose reschedule drawer is open, if any. */
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  // Portal Payment Modal states
  const [payModalBooking, setPayModalBooking] = useState<Booking | null>(null);
  /**
   * How the customer is settling. Two methods, because two are what can
   * actually take money.
   *
   * This union used to carry `'MTN MoMo' | 'Telecel Cash' | 'AT Money' | 'Card'`
   * as well. None of them had a gateway behind them — picking one only changed
   * the prefix of a reference this screen invented for itself. All four are
   * Paystack channels and always were, which is what the badge on that panel
   * says.
   */
  const [payMethod, setPayMethod] = useState<'Paystack' | 'Wallet'>('Paystack');
  const [paying, setPaying] = useState(false);

  // Paystack portal states
  const [paystackLoading, setPaystackLoading] = useState(false);
  const [paystackAuthUrl, setPaystackAuthUrl] = useState('');
  const [paystackRef, setPaystackRef] = useState('');
  const [paystackError, setPaystackError] = useState('');

  const handlePortalPaystackInit = async () => {
    if (!payModalBooking) return;

    // Claimed in the same tick as the click. See `openCheckoutWindow` — opened
    // after the round trip, as this used to be, it is silently blocked.
    const checkout = openCheckoutWindow();

    setPaystackLoading(true);
    setPaystackError('');
    try {
      // The receipt address Paystack will use. No invented fallback: this ran
      // with `'patron@freshfold.com'` when both were blank, which sent a real
      // customer's receipt to an address nobody reads.
      const userEmail = currentUser?.email || payModalBooking.email;
      if (!userEmail) {
        throw new Error('Add an email address to your account before paying online.');
      }
      const res = await fetch('/api/paystack/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          amount: displayAmount(payModalBooking),
          // See the note on the booking form's copy of this call: the server
          // builds Paystack's metadata from `purpose` and `bookingId`, so a
          // checkout cannot claim to be two kinds of payment at once.
          purpose: 'booking',
          bookingId: payModalBooking.id,
          display: {
            customer_name: currentUser?.name || payModalBooking.name,
          }
        })
      });
      const data = await res.json();
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Failed to initialize Paystack checkout.');
      }
      setPaystackAuthUrl(data.authorization_url);
      setPaystackRef(data.reference);

      // The transaction is created either way, so a blocked window is a
      // redirection rather than a failure — the link below is the way through.
      if (!checkout.send(data.authorization_url)) {
        setPaystackError(
          'Your browser blocked the checkout window. Open it with the link below — the payment is ready and waiting.'
        );
      }
    } catch (err: any) {
      checkout.cancel();
      setPaystackError(failureMessage(err, 'Error connecting to Paystack.'));
    } finally {
      setPaystackLoading(false);
    }
  };

  /**
   * Settles the order against the Paystack reference this screen opened.
   *
   * The browser used to be the thing that decided a payment had happened: it
   * called `/api/paystack/verify` itself, and on `success` marked the booking
   * paid locally. Nothing checked that the reference belonged to this booking,
   * or that it was for the right amount, and the "Mark Paid" button beside it
   * skipped even that.
   *
   * `payForBooking` hands the reference to the server, which re-verifies it
   * with Paystack, checks it was made for this job, and reads the amount off
   * the job rather than off this screen. A 402 comes back while the customer
   * is still mid-checkout, which is the "not settled yet" case and reads as
   * such.
   */
  const handlePortalPaystackVerify = async () => {
    if (!paystackRef || !payModalBooking) return;
    setPaystackLoading(true);
    setPaystackError('');
    try {
      await settleBooking(payModalBooking.id, 'Paystack', paystackRef);
    } finally {
      setPaystackLoading(false);
    }
  };

  // Wallet top-up states
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('100');
  const [topUpPaystackLoading, setTopUpPaystackLoading] = useState(false);
  const [topUpPaystackAuthUrl, setTopUpPaystackAuthUrl] = useState('');
  const [topUpPaystackRef, setTopUpPaystackRef] = useState('');
  const [topUpPaystackError, setTopUpPaystackError] = useState('');

  const handleWalletPaystackInit = async () => {
    const amt = parseFloat(topUpAmount) || 0;
    if (amt <= 0) {
      setTopUpPaystackError('Please specify a valid top-up amount.');
      return;
    }

    // Claimed before the await, like the two above it.
    const checkout = openCheckoutWindow();

    setTopUpPaystackLoading(true);
    setTopUpPaystackError('');
    try {
      // Same rule as the booking path above, and it bites harder here: the
      // top-up route matches Paystack's payer against the session before it
      // credits, so a payment made under an invented address is collected and
      // then refused as `reference-not-yours`.
      const userEmail = currentUser?.email;
      if (!userEmail) {
        throw new Error('Sign in again before topping up — we could not read your account.');
      }
      const res = await fetch('/api/paystack/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          amount: amt,
          // A top-up names no booking, and now cannot: the server writes
          // `booking_id` only for `purpose: 'booking'`, so this reference can
          // never also be spent settling an order.
          purpose: 'wallet_topup',
          display: {
            customer_name: currentUser?.name || 'FreshFold customer',
          }
        })
      });
      const data = await res.json();
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Failed to initialize Paystack checkout.');
      }
      setTopUpPaystackAuthUrl(data.authorization_url);
      setTopUpPaystackRef(data.reference);

      if (!checkout.send(data.authorization_url)) {
        setTopUpPaystackError(
          'Your browser blocked the checkout window. Open it with the link below — the top-up is ready and waiting.'
        );
      }
    } catch (err: any) {
      checkout.cancel();
      setTopUpPaystackError(failureMessage(err, 'Error connecting to Paystack.'));
    } finally {
      setTopUpPaystackLoading(false);
    }
  };

  /**
   * `announce` separates the button from the automatic call, for the reason
   * given on the booking form's copy of this: the redirect fires for an
   * abandoned checkout too, so "still pending" is an answer worth giving
   * somebody who asked and worth swallowing for somebody who just closed a
   * window.
   */
  const runWalletVerify = async (announce: boolean) => {
    if (!topUpPaystackRef) return;
    setTopUpPaystackLoading(true);
    setTopUpPaystackError('');
    try {
      const res = await fetch(`/api/paystack/verify/${encodeURIComponent(topUpPaystackRef)}`);
      const data = await res.json();
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Payment verification failed.');
      }
      if (data.data && data.data.status === 'success') {
        // Credited by the server, which verifies this reference with Paystack
        // again and credits what Paystack says was collected — this call sends
        // no amount. Keyed on the reference, so the verify running twice, in
        // two tabs or after a retry, credits once.
        const account = await store.topUpWallet('Paystack', topUpPaystackRef);

        setTopUpModalOpen(false);
        setTopUpPaystackAuthUrl('');
        setTopUpPaystackRef('');
        setSuccessMsg(
          `Wallet topped up. Balance: ₵${(account.walletBalance ?? 0).toFixed(2)}.`
        );
      } else if (announce) {
        // Into the sheet's own banner rather than a `window.alert`, which
        // blocks the page, cannot be styled, and on a phone covers the
        // checkout window it is telling the customer to go back to.
        setTopUpPaystackError(
          `Paystack says this payment is ${data.data?.status || 'still pending'}. ` +
            'Finish it in the checkout window, then check again.'
        );
      }
    } catch (err: any) {
      setTopUpPaystackError(failureMessage(err, 'Error verifying Paystack transaction.'));
    } finally {
      setTopUpPaystackLoading(false);
    }
  };

  const handleWalletPaystackVerify = () => runWalletVerify(true);

  /**
   * The checkout popup coming back, routed to whichever checkout opened it.
   *
   * Two can be in flight from this screen — settling a bill and topping up —
   * but only one at a time: each is a modal, and opening either closes the
   * other. The top-up is checked first because it is the one whose modal sits
   * on top when both have a stale reference behind them.
   */
  usePaystackReturn(
    useCallback(() => {
      if (topUpPaystackRef) void runWalletVerify(false);
      else if (paystackRef && payModalBooking) void handlePortalPaystackVerify();
    }, [topUpPaystackRef, paystackRef, payModalBooking]),
    !!topUpPaystackRef || !!paystackRef
  );

  // Filter & Concierge states
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [conciergeText, setConciergeText] = useState('');
  const [conciergeSuccess, setConciergeSuccess] = useState('');

  /**
   * The order thread, mirrored from the dispatch server.
   *
   * The same conversation the rider sees in the companion app, so a courier
   * asking which buzzer to press gets an answer here rather than nowhere. The
   * subscription covers both directions: our own sends notify synchronously,
   * and the five-second poll brings the rider's replies in.
   */
  const [messages, setMessages] = useState<Message[]>(() => store.readMessages());
  useEffect(() => {
    return store.subscribe(() => setMessages(store.readMessages()));
  }, []);

  const threadOrderId = activeTrackingId ?? userBookings[0]?.id ?? null;
  const thread = threadOrderId
    ? messages.filter((message) => message.orderId === threadOrderId)
    : [];

  // Which of the three pages is showing. See NAV_ITEMS for why there are
  // three of them and not the four this had.
  const [activePortalTab, setActivePortalTab] = useState<PortalTab>('orders');
  const [receiptModalBooking, setReceiptModalBooking] = useState<Booking | null>(null);

  /**
   * The settings tab's form state.
   *
   * What was here printed "Settings updated successfully!" from a `setTimeout`
   * and wrote nothing at all: three delivery fields seeded with "KNUST Gaza
   * Hostel, Room 304" — one invented address shown to every patron as though it
   * were theirs — over a button that touched no store and no server. Now the
   * name and the number go to `/api/accounts` and the book to
   * `/api/accounts/addresses`, which is the same pair of routes the customer app
   * writes, so an edit made here shows up on the phone within a poll and an edit
   * made on the phone shows up here within one.
   */
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savedSettingsMsg, setSavedSettingsMsg] = useState('');

  const [addressDraft, setAddressDraft] = useState<SavedAddress | null>(null);
  const [addressError, setAddressError] = useState('');
  const [addressSaving, setAddressSaving] = useState(false);

  const savedAddresses = currentUser?.addresses ?? [];

  /**
   * Seeded from the account, and re-seeded only on a *different* account.
   *
   * Keyed on the email rather than on `currentUser`, for the reason the customer
   * app's settings screen is: `pullAccount` re-applies the profile every five
   * seconds, and re-seeding on that would wipe out whatever was half-typed at
   * the moment a poll landed.
   */
  useEffect(() => {
    setProfileName(currentUser?.name ?? '');
    setProfilePhone(limitPhoneInput(currentUser?.phone ?? ''));
    setProfileError('');
    setSavedSettingsMsg('');
  }, [currentUser?.email]);

  // Both sides through `limitPhoneInput`, so a stored `+233 24 456 7801` and a
  // typed `0244567801` compare equal rather than reading as an edit.
  const profileDirty =
    profileName.trim() !== (currentUser?.name ?? '').trim() ||
    profilePhone !== limitPhoneInput(currentUser?.phone ?? '');

  const saveProfileDetails = async () => {
    const trimmed = profileName.trim();
    setProfileError('');
    setSavedSettingsMsg('');

    if (!trimmed) {
      setProfileError('Tell us who to ask for at the door.');
      return;
    }
    if (!isCompletePhone(profilePhone)) {
      setProfileError(PHONE_LENGTH_MESSAGE);
      return;
    }

    // Whether the number moved, worked out before the save — afterwards the
    // account has already been replaced with the one we just wrote.
    const numberChanged = !samePhone(profilePhone, currentUser?.phone ?? '');

    setProfileSaving(true);
    try {
      await store.saveProfile({ name: trimmed, phone: profilePhone });
      setSavedSettingsMsg(
        numberChanged
          ? // Worth saying plainly: dispatch finds a visitor's orders by the
            // number they booked on, so moving the number moves which of them
            // this account can see.
            'Details saved. Orders booked on your old number will no longer appear here.'
          : 'Details saved.'
      );
    } catch (error) {
      // The server's own sentence where it has one — for a number already in
      // use it names that specifically, which a generic message would lose.
      setProfileError(
        error instanceof ApiError ? error.message : 'Could not save that just now.'
      );
    } finally {
      setProfileSaving(false);
    }
  };

  /**
   * Writes the address book back, whole.
   *
   * The whole array rather than the entry that changed, because that is what
   * `PUT /accounts/addresses` replaces — and because it makes the write
   * idempotent, which matters against a five-second poll. `withAddress` and
   * `withoutAddress` from core do the merging, so the ids, the ordering and the
   * single default behave the same here as in the app.
   */
  const commitAddresses = async (next: SavedAddress[], onDone?: () => void) => {
    setAddressError('');
    setAddressSaving(true);
    try {
      await store.saveAddresses(next);
      onDone?.();
    } catch (error) {
      setAddressError(
        error instanceof ApiError ? error.message : 'Could not save your addresses just now.'
      );
    } finally {
      setAddressSaving(false);
    }
  };

  const saveAddressDraft = async () => {
    if (!addressDraft) return;

    const address = addressDraft.address.trim();
    const suburb = addressDraft.suburb.trim();

    setAddressError('');
    if (!address) {
      setAddressError('We need an address to collect from.');
      return;
    }
    if (!suburb) {
      setAddressError('Choose the suburb this address is in.');
      return;
    }

    const entry: SavedAddress = {
      ...addressDraft,
      address,
      suburb,
      // The suburb stands in for a label nobody typed, which is what
      // `normaliseAddresses` would do anyway — done here so the field the
      // customer sees and the one that gets stored agree.
      label: addressDraft.label.trim() || suburb,
    };

    await commitAddresses(withAddress(savedAddresses, entry), () => setAddressDraft(null));
  };

  /**
   * Opens the sheet on a new entry.
   *
   * The id is minted here rather than by the server so that saving an edit
   * lands on the same entry the phone is showing instead of appending a
   * near-duplicate beside it. First entry claims the default; after that the
   * customer chooses.
   */
  const startNewAddress = () => {
    setAddressError('');
    setAddressDraft({
      id: `addr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: '',
      address: '',
      suburb: SERVICE_SUBURBS[0] ?? '',
      isDefault: savedAddresses.length === 0,
    });
  };

  const [redeemedRewardMsg, setRedeemedRewardMsg] = useState('');

  /**
   * The balance and the points, straight off the account.
   *
   * Both were invented here until now: the wallet was a `useState(150)` that
   * only reloaded when the signed-in user changed, and the points fell back to
   * 750 for anybody whose account had none. A customer saw ₵150 and 750 points
   * in this portal and ₵0 and 0 in the app, for the same account, on the same
   * day. There is nothing to fall back to — the server owns both, `pull()`
   * re-reads them every five seconds, and every movement goes through
   * `/api/accounts/wallet` and comes back as a new account.
   */
  const walletBalance = currentUser?.walletBalance ?? 0;
  const patronPoints = currentUser?.points ?? 0;

  const tier = tierForPoints(patronPoints);
  const { next: nextTier, pointsToNext, percent: tierPercent } = tierProgress(patronPoints);

  /**
   * The membership the customer is actually paying for, as opposed to the tier
   * their points have earned. The portal had no notion of one at all, while the
   * app read it off `account.plan` — so a paid subscription was invisible here.
   */
  const activePlan = currentUser?.plan ?? null;
  const activePlanDefinition = membershipPlan(activePlan?.planId);

  /**
   * Who is signed in, and everything that hangs off them.
   *
   * The subscription is the change that matters: this used to read the profile
   * once on mount and never again, so a top-up made in the customer app, a
   * membership renewal the server settled, or points earned on an order all sat
   * invisible here until the next sign-in. `pull()` now re-reads `/auth/me` on
   * every poll and notifies, so the balance on this screen is the balance.
   */
  useEffect(() => {
    // Show the cached profile immediately, then check the token is still good.
    // An expired or revoked session resolves to null and signs the patron out
    // rather than leaving the portal looking authenticated when it isn't.
    setCurrentUser(store.readCurrentUser());

    const unsubscribe = store.subscribe(() => setCurrentUser(store.readCurrentUser()));

    let cancelled = false;
    store.restoreSession().then((account) => {
      if (!cancelled) setCurrentUser(account);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /**
   * This customer's orders, scoped by the server.
   *
   * The portal used to pull the entire ledger — every customer's orders, to
   * every browser that opened this panel — and filter it here on `email OR
   * samePhone`. The app asked the server for one customer's history instead,
   * which matched on email alone, so the two surfaces disagreed about which
   * orders belonged to whom. `GET /api/bookings?email=` now covers both: it
   * matches the address *and* the number on that account, and it is the only
   * list either surface reads.
   */
  useEffect(() => {
    if (!currentUser) {
      setUserBookings([]);
      setActiveTrackingId(null);
      return;
    }

    let cancelled = false;

    const load = () => {
      store.readUserBookings()
        .then((matched) => {
          if (cancelled) return;
          setUserBookings(matched);
          setActiveTrackingId((current) => current ?? matched[0]?.id ?? null);
        })
        .catch(() => {
          // Offline. Whatever the last load produced stays on screen.
        });
    };

    load();
    const unsubscribe = store.subscribe(load);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentUser?.email, activeBookings]);

  // Resolve the emailed setup link into the booking it opens
  useEffect(() => {
    if (!setupTokenParam) {
      setSetupBooking(null);
      return;
    }

    // Asked of the server, never read out of the URL or the local mirror. The
    // token is the only claim this browser has to the order — it arrived in the
    // customer's inbox — and the server is the only thing that can say whether
    // it is still good. A link opened on a phone that has never seen this site
    // works for exactly the same reason.
    let cancelled = false;
    setSetupError('');

    store
      .readSetupLink(setupTokenParam)
      .then((booking) => {
        if (cancelled) return;
        setSetupBooking(booking);
        setInputIdentifier(booking.email); // Pre-fill email
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSetupBooking(null);
        setSetupError(
          e instanceof ApiError
            ? e.message
            : 'Could not open this setup link. Check your connection and try again.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [setupTokenParam]);

  // Handle setting/creating a new secure password
  const handleSetupPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError('');
    setSuccessMsg('');

    if (!setupTokenParam || !setupBooking) {
      setSetupError('This link is not attached to a booking.');
      return;
    }

    // The shared rule, so this form refuses exactly what the server refuses.
    // It used to carry its own copy — five characters, with its own sentence —
    // while the server said five and the customer app said six.
    const weak = passwordProblem(setupPassword);
    if (weak) {
      setSetupError(weak);
      return;
    }

    if (setupPassword !== setupConfirmPassword) {
      setSetupError('Confirmation password does not match.');
      return;
    }

    try {
      // Which account this opens is decided by the token, not by the fields on
      // screen — those are shown so the customer can see what they are claiming,
      // and are not sent. The password goes to the server and is hashed there;
      // it is never held in this browser.
      const account = await store.claimBooking(setupTokenParam, setupPassword);

      // The spent token leaves the URL in the same beat the account opens.
      //
      // These used to be 1.5 seconds apart, which put the setup card and the
      // signed-in portal on screen together — the overlap the note on
      // `AnimatePresence` in the render is about. There is also nothing left to
      // read on the card by then: the account exists and is the answer.
      setCurrentUser(account);
      window.location.hash = '#portal';
      setSuccessMsg('Account created. Welcome to FreshFold.');

    } catch (e) {
      // Two refusals mean the same thing to the customer: this link cannot set
      // a password, and pressing the button again will not change that. A 409 is
      // an account that already has one; a spent link is usually a previous
      // attempt that reached the server and lost only its response, leaving an
      // account the customer was told had failed. Both end at sign-in, with the
      // address already filled in, rather than at a refusal they cannot act on.
      const spent =
        e instanceof ApiError &&
        (e.status === 409 ||
          (typeof e.body === 'object' &&
            e.body !== null &&
            (e.body as { code?: string }).code === 'SETUP_LINK_INVALID'));

      if (spent) {
        setInputIdentifier(setupBooking.email);
        setLoginError(
          'This contact already has a password — your account may have been created on an earlier attempt. Sign in below, or use the reset link if you do not have the password.'
        );
        window.location.hash = '#portal';
        return;
      }

      setSetupError(failureMessage(e, 'Could not create your credentials. Please try again.'));
    }
  };

  /**
   * Sign in.
   *
   * The password is posted to the server and compared there. This component
   * never sees a stored credential — which is the point: the account list it
   * can read carries no password material at all.
   */
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setSuccessMsg('');

    if (!inputIdentifier || !inputPassword) {
      setLoginError('Enter your email or phone number and your password.');
      return;
    }

    try {
      const account = await store.login(inputIdentifier, inputPassword);
      setCurrentUser(account);
      setInputPassword('');
    } catch (e) {
      const fallback = failureMessage(
        e,
        'We could not sign you in with those details. Check them, or book a pickup to get started.'
      );

      /**
       * Why this asks the server rather than reading the ledger.
       *
       * This used to search `readBookings()` for the address and, on a hit,
       * announce that the booking had "no password set for it yet" — and then
       * send the customer to "Send my setup link again". Every step of that is
       * wrong for the customer it fired on most often.
       *
       * `readBookings()` is the whole ledger, not this person's account: it
       * says a booking exists, which is not the same claim and cannot support
       * one about credentials. So somebody who opened an account in the
       * customer app, set a password there, and then mistyped it here was told
       * their password did not exist. The one control that would have helped —
       * "Forgotten it?" — is the one the message steered them away from, and
       * the one it steered them *towards* is a documented no-op for an account
       * that has a password: `/auth/resend-setup` deliberately does nothing and
       * answers `{ ok: true }` anyway, so the promised email never comes and
       * the loop has no exit.
       *
       * `/auth/status` is the only thing that knows, and it is the question the
       * customer app has always asked before offering the same choice. Its note
       * in `routes/auth.ts` records that this wrapper had no caller; it has one
       * now, and the route's fate is tied to both surfaces rather than to the
       * app alone.
       */
      const wrongCredentials = e instanceof ApiError && e.status === 401;

      if (!wrongCredentials) {
        // A 429, a 5xx or a dead connection. The server's own words, because
        // none of these are anything the setup story would explain.
        setLoginError(fallback);
        return;
      }

      let status: { exists: boolean; hasPassword: boolean } | null = null;
      try {
        status = await store.authStatus(inputIdentifier.trim());
      } catch {
        // Offline, or past the lookup limiter. Nothing is known, so nothing is
        // claimed — the sign-in failure stands on its own.
      }

      if (status?.exists && !status.hasPassword) {
        setLoginError(
          'That contact has a booking but no password yet. Open the setup link in your ' +
            'confirmation email, or press "Send my setup link again" below.'
        );
        return;
      }

      setLoginError(
        status?.hasPassword
          ? 'That password does not match the one on this account. Check it, or use ' +
              '"Forgotten it?" above to set a new one.'
          : fallback
      );
    }
  };

  /**
   * Asks for a password-reset link.
   *
   * This control was a dead `<a>` with no handler and a `cursor-not-allowed`
   * class — it looked live and did nothing, which is worse than not offering
   * it, because the customer it is aimed at is already locked out.
   *
   * The confirmation says the same thing whether or not that contact has an
   * account. The server refuses to distinguish them so that this endpoint
   * cannot be used to find out who banks here, and a message that varied would
   * hand back precisely what the server withheld.
   */
  const handleForgotPassword = async () => {
    const identifier = inputIdentifier.trim();

    if (!identifier) {
      setLoginError('Enter your email or phone number above first, then press Reset Password.');
      return;
    }

    setLoginError('');
    setSuccessMsg('');
    setResetSending(true);

    try {
      await store.requestPasswordReset(identifier);
      setSuccessMsg(
        `If ${identifier} has a FreshFold account, a reset link is on its way. It is good for one hour — check your spam folder too.`
      );
    } catch (error) {
      setLoginError(
        failureMessage(error, 'Could not reach FreshFold just now. Please try again shortly.')
      );
    } finally {
      setResetSending(false);
    }
  };

  /**
   * Asks for the setup link to be sent again.
   *
   * For the patron who booked as a guest and no longer has the confirmation
   * email. Reset Password cannot help them — there is no account to reset until
   * a setup link has been spent — so this is the only way back to a password
   * for a booking, and the sign-in card offers both side by side.
   *
   * Says the same thing whatever the *booking* half of the server's answer was,
   * for the reason the reset confirmation does. The one case it does not paper
   * over is an account that already holds a password: `/auth/resend-setup`
   * refuses those on purpose — a setup link for somebody who has credentials
   * would be a way to mail an existing customer on demand — and it refuses them
   * silently, with the same `{ ok: true }` it gives everybody. Announcing that a
   * link is on its way is then simply false, and it is false for exactly the
   * person pressing this button hardest: the one who cannot get in and has been
   * told this is the way out. They are sent to Forgotten it? instead.
   *
   * No enumeration is given away that the caller did not bring: they typed this
   * address into a sign-in form a moment ago, and `/auth/status` is the same
   * question the customer app asks before offering the same two doors.
   */
  const handleResendSetupLink = async () => {
    const identifier = inputIdentifier.trim();

    if (!identifier) {
      setLoginError('Enter the email address you booked with above first.');
      return;
    }

    setLoginError('');
    setSuccessMsg('');
    setSetupSending(true);

    try {
      // A failed lookup is not fatal: fall through to the request, which is
      // what this did unconditionally before.
      const status = await store.authStatus(identifier).catch(() => null);

      if (status?.hasPassword) {
        setLoginError(
          'This contact already has a password, so a setup link cannot be sent for it. ' +
            'Use "Forgotten it?" above to set a new one.'
        );
        return;
      }

      await store.requestSetupLink(identifier);
      setSuccessMsg(
        `If ${identifier} has a booking with no password yet, a setup link is on its way — check your spam folder too.`
      );
    } catch (error) {
      setLoginError(
        failureMessage(error, 'Could not reach FreshFold just now. Please try again shortly.')
      );
    } finally {
      setSetupSending(false);
    }
  };

  /**
   * Asks for another confirmation link.
   *
   * The server's message is shown as-is rather than replaced with a generic
   * one: "try again in 41 seconds" is the answer to the question the customer
   * is about to ask, and a bland failure would have them pressing the button
   * again.
   */
  const handleResendVerification = async () => {
    setVerifySending(true);
    setVerifyNotice('');
    try {
      await store.resendVerification();
      setVerifyNotice('Sent. Check your inbox — and your spam folder.');
    } catch (error) {
      setVerifyNotice(
        failureMessage(error, 'Could not send the link. Try again shortly.')
      );
    } finally {
      setVerifySending(false);
    }
  };

  // Log currently active session out, revoking the token server-side too.
  const handleSignOut = () => {
    void store.logout();
    setCurrentUser(null);
    setInputPassword('');
    setInputIdentifier('');
    setSuccessMsg('Signed out.');
    window.location.hash = '#portal';
  };

  /**
   * Settles an outstanding order. The only path to `Paid` on this screen.
   *
   * What used to be here invented a reference — `'TXN-' + payMethod.slice(0,3)
   * + Math.random()` — wrote `paymentStatus: 'Paid'` into the local ledger and
   * announced "Payment confirmed. Ref: TXN-MTN-483920". For every method but
   * the wallet, no money moved anywhere: the reference was decoration on a
   * payment that had not happened. It did not even survive, because the server
   * drops `paymentStatus`, `paidAt` and `transactionRef` from any patch that is
   * not a supervisor's — so the customer saw a settled bill until they
   * refreshed, and the desk saw an unpaid one throughout.
   *
   * `payForBooking` is `POST /bookings/:id/payment`, the one route that can
   * mark a booking paid. It reads the amount off the job rather than off this
   * screen, debits the wallet server-side or re-verifies the Paystack
   * reference, and returns the settled booking with the reference the payment
   * actually carried. A failure leaves the bill standing and says why, which is
   * the honest outcome for a customer who is about to try again.
   */
  const settleBooking = async (
    bookingId: string,
    method: 'Paystack' | 'Wallet',
    reference?: string
  ) => {
    setPaying(true);
    setPaystackError('');
    try {
      const settled = await store.payForBooking(bookingId, method, reference);

      onUpdateBookings(store.readBookings());
      // A wallet payment moved the balance and earned the points the spend is
      // worth; `payForBooking` has already pulled the account down.
      setCurrentUser(store.readCurrentUser());

      setPayModalBooking(null);
      setPaystackAuthUrl('');
      setPaystackRef('');
      setSuccessMsg(
        `Paid ₵${(settled.amount ?? 0).toFixed(2)} by ${paymentLabel(method).toLowerCase()}.` +
          (settled.transactionRef ? ` Reference ${settled.transactionRef}.` : '')
      );
      setTimeout(() => setSuccessMsg(''), 6000);
    } catch (error) {
      setSuccessMsg('');
      setPaystackError(
        error instanceof ApiError
          ? error.message
          : 'Could not reach FreshFold to take the payment. Your order is unpaid — try again in a moment.'
      );
    } finally {
      setPaying(false);
    }
  };

  /**
   * Spends care points on a reward.
   *
   * These buttons used to check the balance, print "Successfully redeemed" and
   * deduct nothing — the same 1000-point voucher could be claimed forever, and
   * the ₵50 credit added money to a React state hook no other surface could
   * see. The points come off on the server now, and the wallet credit with
   * them.
   */
  const [redeemingReward, setRedeemingReward] = useState<string | null>(null);

  const handleRedeem = async (rewardId: string) => {
    setRedeemingReward(rewardId);
    setRedeemedRewardMsg('');
    try {
      const account = await store.redeemReward(rewardId);
      const reward = LOYALTY_REWARDS.find((candidate) => candidate.id === rewardId);
      setRedeemedRewardMsg(
        `Redeemed ${reward?.name ?? 'your reward'}. ${(account.points ?? 0).toLocaleString()} care points left.`
      );
      setTimeout(() => setRedeemedRewardMsg(''), 5000);
    } catch (error) {
      setRedeemedRewardMsg(
        error instanceof ApiError
          ? error.message
          : 'Could not reach FreshFold. Your points are unchanged — try again in a moment.'
      );
      setTimeout(() => setRedeemedRewardMsg(''), 5000);
    } finally {
      setRedeemingReward(null);
    }
  };

  // Progress percentage, from the shared stage model so the bar and the
  // rider's dispatch status can never disagree about how far along a job is.
  const getStatusPercent = bookingProgressPercent;

  if (!isOpen) return null;

  /* ---------------------------------------------------------------- render */

  const signedIn = !!currentUser;

  /** Orders that still have somewhere to go. */
  const liveOrders = userBookings.filter((candidate) => !isClosed(candidate));

  /**
   * The order the tracking panel is showing.
   *
   * `activeTrackingId` is seeded from the whole list, so it can land on a
   * delivered order — which is fine, and is what the Track button on a past
   * order does deliberately.
   */
  const tracked = userBookings.find((candidate) => candidate.id === activeTrackingId) ?? null;

  const shownOrders = userBookings.filter((candidate) => {
    if (orderFilter === 'active') return !isClosed(candidate);
    if (orderFilter === 'closed') return isClosed(candidate);
    return true;
  });

  const firstName = (currentUser?.name ?? '').trim().split(/\s+/)[0] || 'there';

  return (
    /*
      `portal` scopes this surface's focus ring and its reduced-motion escape —
      see index.css, where `.ff` does the same for the landing.

      The portal is its own screen now rather than a sheet laid over the
      marketing page. It used to sit at `z-50` with `pt-[72px]` reserved for
      the site header showing above it, which meant a customer reading their
      delivery window still had "Book a pickup" and the section nav overhead —
      a shopfront bolted to the top of an account. App.tsx takes the marketing
      chrome down while this is open, and the bar below is the whole of the
      navigation.
    */
    <div className="portal below-banner fixed inset-0 z-[var(--z-modal)] flex flex-col bg-brand-charcoal font-ui text-[15px] text-white antialiased selection:bg-brand-gold selection:text-brand-charcoal">

      {/* ------------------------------------------------------------- bar */}
      <header className="shrink-0 border-b border-white/10 bg-brand-charcoal">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to the FreshFold site"
            className="group flex shrink-0 items-center gap-2 rounded-md py-1 pr-2 text-white transition-colors duration-200 hover:text-brand-gold"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4 text-brand-text-muted transition-colors duration-200 group-hover:text-brand-gold" />
            <span className="font-display text-[23px] font-medium leading-none">FreshFold</span>
          </button>

          {signedIn && (
            <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Your account">
              {NAV_ITEMS.map((item) => {
                const isActive = activePortalTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActivePortalTab(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative rounded-md px-3 py-2 text-[14px] font-medium transition-colors duration-200 ${
                      isActive ? 'text-white' : 'text-brand-text-muted hover:text-white'
                    }`}
                  >
                    {item.label}
                    {/* Brass, two pixels, the same mark the site header uses for
                        the section you are reading. Sage cannot do this job: at
                        2.4:1 on charcoal a rule in it is simply not there. */}
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-3 -bottom-0.5 h-0.5 origin-left rounded-full bg-brand-gold transition-transform duration-300 ${
                        isActive ? 'scale-x-100' : 'scale-x-0'
                      }`}
                    />
                  </button>
                );
              })}
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {signedIn ? (
              <>
                <button
                  type="button"
                  onClick={onOpenBooking}
                  className={`${BTN} ${AS_PRIMARY} ${SIZE_MD} hidden sm:inline-flex`}
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  Book a pickup
                </button>
                <span
                  aria-hidden="true"
                  className="hidden h-9 w-9 place-items-center rounded-md border border-white/12 font-display text-[18px] font-medium text-brand-gold sm:grid"
                >
                  {currentUser.name.charAt(0).toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                >
                  <LogOut aria-hidden="true" className="h-4 w-4" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            ) : (
              <button type="button" onClick={onClose} className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}>
                Back to the site
              </button>
            )}
          </div>
        </div>

        {/* The same three destinations on a phone, as a row under the bar
            rather than a hamburger: there are three of them, and a menu that
            hides three things is a menu for the sake of having one. */}
        {signedIn && (
          <nav className="flex border-t border-white/10 md:hidden" aria-label="Your account">
            {NAV_ITEMS.map((item) => {
              const isActive = activePortalTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActivePortalTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex flex-1 items-center justify-center gap-2 py-3 text-[14px] font-medium transition-colors duration-200 ${
                    isActive ? 'text-white' : 'text-brand-text-muted'
                  }`}
                >
                  <item.icon aria-hidden="true" className="h-4 w-4" />
                  {item.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-4 bottom-0 h-0.5 origin-center rounded-full bg-brand-gold transition-transform duration-300 ${
                      isActive ? 'scale-x-100' : 'scale-x-0'
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {/* --------------------------------------------------------- content */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {/*
          Not `AnimatePresence`, in either mode.

          These three are the whole screen, one at a time, and they were
          crossfading through it. `mode="wait"` makes the entering panel wait on
          the leaving one's exit *animation*, and where animations do not run —
          a backgrounded tab is the ordinary case, since browsers stop
          requestAnimationFrame there — that exit never finishes and the
          entering panel never mounts at all. The default mode has the failure
          this actually shipped with: signing in left the sign-in card mounted
          at `opacity: 0` and still in flow, so the account screen rendered
          under 600px of invisible form. An exit animation that does not
          complete does not unmount its child, and nothing on the page said so.

          `.panel-swap` in index.css is the idiom this codebase already settled
          on for a panel that changes under a control: a CSS animation with no
          fill mode, keyed so React restarts it. Outside the 320ms it is
          running the element is at its ordinary style — visible, in flow — so
          a swap that never animates is a swap that simply happened. There is
          no state in which one of these can hold the screen open.
        */}

          {/* ------------------------------------------- 1. choose a password
              `!currentUser` because a claimed link has nothing left to set —
              the account below is what that customer wants, and overlapping
              panels are what the note above is about. */}
          {setupTokenParam && !currentUser && (
            <div
              key="setup-view"
              className="panel-swap mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-16"
            >
              <h1 className="font-display text-[32px] font-medium leading-tight text-white">
                Choose a password
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-brand-text-muted">
                {setupBooking ? (
                  <>
                    We found booking <span className="tnum font-medium text-white">{setupBooking.id}</span>.
                    Set a password and you can follow it from here.
                  </>
                ) : setupError ? (
                  <>This link could not be opened.</>
                ) : (
                  <>Checking your link…</>
                )}
              </p>

              <div className="mt-6 space-y-4">
                {setupBooking && (
                  <Panel className="px-5 py-4">
                    <div className="space-y-2.5">
                      <Row label="Name">{setupBooking.name}</Row>
                      <Row label="Phone"><span className="tnum">{setupBooking.phone}</span></Row>
                      <Row label="Email">{setupBooking.email}</Row>
                    </div>
                  </Panel>
                )}

                {setupError && <Banner tone="bad">{setupError}</Banner>}
                {successMsg && <Banner tone="ok">{successMsg}</Banner>}

                {/* Only once the server has said what this link opens. A dead
                    or spent link gets the way out below and no password fields
                    — there is nothing they could be submitted to. */}
                <form
                  onSubmit={handleSetupPasswordSubmit}
                  className={`space-y-4 ${setupBooking ? '' : 'hidden'}`}
                >
                  <div className="space-y-1.5">
                    <label htmlFor="setup-password" className={LABEL}>New password</label>
                    <input
                      id="setup-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      placeholder="At least 5 characters"
                      className={FIELD}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="setup-confirm" className={LABEL}>Type it again</label>
                    <input
                      id="setup-confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={setupConfirmPassword}
                      onChange={(e) => setSetupConfirmPassword(e.target.value)}
                      placeholder="The same password"
                      className={FIELD}
                    />
                  </div>

                  <button type="submit" className={`${BTN} ${AS_PRIMARY} ${SIZE_MD} w-full`}>
                    Create my account
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = '#portal';
                  }}
                  className="w-full py-2 text-[14px] font-medium text-brand-text-muted transition-colors duration-200 hover:text-white"
                >
                  I already have a password — sign in
                </button>
              </div>
            </div>
          )}

          {/* --------------------------------------------------- 2. sign in */}
          {!currentUser && !setupTokenParam && (
            <div
              key="login-view"
              className="panel-swap mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-16"
            >
              <h1 className="font-display text-[32px] font-medium leading-tight text-white">
                Sign in
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-brand-text-muted">
                Follow an order, pay a bill and keep your collection addresses in one place.
              </p>

              <div className="mt-6 space-y-4">
                {loginError && <Banner tone="bad">{loginError}</Banner>}
                {successMsg && <Banner tone="ok">{successMsg}</Banner>}

                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="login-id" className={LABEL}>Email or phone number</label>
                    <div className="relative">
                      <Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted" />
                      <input
                        id="login-id"
                        type="text"
                        autoComplete="username"
                        required
                        value={inputIdentifier}
                        onChange={(e) => setInputIdentifier(e.target.value)}
                        placeholder="ama@example.com or 0244123456"
                        className={`${FIELD} pl-10`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor="login-password" className={LABEL}>Password</label>
                      {/* `type="button"` matters: this sits inside the sign-in
                          form, and a bare <button> would submit it. */}
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={resetSending}
                        className="text-[13px] font-medium text-brand-gold transition-colors duration-200 hover:text-brand-gold-light disabled:text-brand-text-muted"
                      >
                        {resetSending ? 'Sending…' : 'Forgotten it?'}
                      </button>
                    </div>
                    <div className="relative">
                      <Lock aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted" />
                      <input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={inputPassword}
                        onChange={(e) => setInputPassword(e.target.value)}
                        placeholder="Your password"
                        className={`${FIELD} pl-10`}
                      />
                    </div>
                  </div>

                  <button type="submit" className={`${BTN} ${AS_PRIMARY} ${SIZE_MD} w-full`}>
                    Sign in
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </form>

                <div className="space-y-3 border-t border-white/10 pt-5">
                  <p className="text-[14px] leading-relaxed text-brand-text-muted">
                    Booking for the first time? You do not need an account. We email you a link to
                    set a password once your first order is in.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onOpenBooking}
                      className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                    >
                      Book a pickup
                    </button>
                    {/* The way back for a guest who lost that email. Forgotten
                        it? above cannot help them: there is no account to reset
                        until a setup link has been spent. */}
                    <button
                      type="button"
                      onClick={handleResendSetupLink}
                      disabled={setupSending}
                      className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                    >
                      {setupSending ? 'Sending…' : 'Send my setup link again'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ 3. the account */}
          {currentUser && (
            <div
              key="portal-main-view"
              className="panel-swap mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10"
            >
              {/*
                Above everything else, because the server refuses a booking from
                an unconfirmed account — finding that out at checkout, after
                filling in the whole form, is the version of this that generates
                support calls.
              */}
              {currentUser.emailVerified === false && (
                <div className="mb-6">
                  <Banner tone="note">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span>
                        {verifyNotice || (
                          <>
                            Confirm your email before you book again — we sent a link to{' '}
                            <strong className="font-semibold text-white">{currentUser.email}</strong>.
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleResendVerification()}
                        disabled={verifySending}
                        className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                      >
                        {verifySending ? 'Sending…' : 'Send it again'}
                      </button>
                    </span>
                  </Banner>
                </div>
              )}

              {successMsg && (
                <div className="mb-6">
                  <Banner tone="ok">{successMsg}</Banner>
                </div>
              )}

              {/* ======================================== ORDERS ========== */}
              {activePortalTab === 'orders' && (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <h1 className="font-display text-[32px] font-medium leading-tight text-white">
                        Welcome back, {firstName}
                      </h1>
                      <p className="mt-1 text-[15px] text-brand-text-muted">
                        {liveOrders.length === 0
                          ? 'Nothing with us right now.'
                          : liveOrders.length === 1
                            ? 'One order with us.'
                            : `${liveOrders.length} orders with us.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenBooking}
                      className={`${BTN} ${AS_PRIMARY} ${SIZE_MD} sm:hidden`}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      Book a pickup
                    </button>
                  </div>

                  {/* ------------------------------------------ tracking */}
                  {!tracked ? (
                    <Panel className="px-6 py-14 text-center">
                      <Package aria-hidden="true" className="mx-auto h-8 w-8 text-brand-text-muted" />
                      <h2 className="mt-4 text-[19px] font-medium text-white">Nothing to track yet</h2>
                      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-brand-text-muted">
                        Book a pickup and a rider will collect it the same day. You can watch them
                        on the map from here.
                      </p>
                      <button
                        type="button"
                        onClick={onOpenBooking}
                        className={`${BTN} ${AS_PRIMARY} ${SIZE_MD} mt-6`}
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        Book a pickup
                      </button>
                    </Panel>
                  ) : (
                    (() => {
                      const percent = getStatusPercent(tracked.status);
                      const jobStatus = tracked.rider?.jobStatus ?? 'unassigned';
                      const movable = canReschedule({
                        status: tracked.status === 'Cancelled' ? 'cancelled' : jobStatus,
                        schedule: {
                          pickupDate: tracked.pickupDate,
                          pickupTime: tracked.pickupTime,
                          deliveryDate: tracked.deliveryDate,
                          deliveryTime: tracked.deliveryTime,
                          rescheduleCount: tracked.rescheduleCount,
                        },
                      } as Job).ok;

                      return (
                        <Panel>
                          <PanelHead
                            title="Where your laundry is"
                            note={describeItems(tracked) || tracked.serviceType}
                          >
                            {/* Only when there is a choice to make. One order
                                does not need a switcher for itself. */}
                            {liveOrders.length > 1 && (
                              <div className="flex flex-wrap gap-1.5">
                                {liveOrders.map((candidate) => (
                                  <button
                                    key={candidate.id}
                                    type="button"
                                    onClick={() => setActiveTrackingId(candidate.id)}
                                    aria-pressed={activeTrackingId === candidate.id}
                                    className={`tnum rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ${
                                      activeTrackingId === candidate.id
                                        ? 'bg-brand-sage text-white'
                                        : 'border border-white/12 text-brand-text-muted hover:text-white'
                                    }`}
                                  >
                                    {candidate.id}
                                  </button>
                                ))}
                              </div>
                            )}
                          </PanelHead>

                          <div className="space-y-6 px-5 py-5">
                            {/* The two things a customer opened this page to
                                read, at the top and at the size of a headline. */}
                            <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
                              <div>
                                <p className="text-[13px] text-brand-text-muted">Order</p>
                                <p className="tnum mt-1 text-[21px] font-semibold leading-none text-white">
                                  {tracked.id}
                                </p>
                              </div>
                              <div className="sm:text-right">
                                <p className="text-[13px] text-brand-text-muted">Back to you</p>
                                <p className="mt-1 text-[21px] font-semibold leading-none text-white">
                                  {whenLine(tracked.deliveryDate, tracked.deliveryTime) || 'We will confirm'}
                                </p>
                              </div>
                            </div>

                            <div>
                              <div className="flex items-baseline justify-between gap-4">
                                <span className="text-[15px] font-medium text-white">{tracked.status}</span>
                                <span className="tnum text-[14px] text-brand-text-muted">{percent}%</span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                {/* Sage-light rather than sage. The fill has to
                                    read against the track behind it, and #5A5A40
                                    at this height on `white/10` does not. */}
                                <div
                                  className="h-full rounded-full bg-brand-sage-light transition-[width] duration-700 ease-out"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>

                              {/*
                                The stages, off BOOKING_STAGE_SEQUENCE.
                                Hand-listing them here is how this strip ended up
                                one stage behind the rest of the product;
                                deriving it means a stage added in core arrives
                                here for free.

                                Two columns on a phone and four on a desktop:
                                the old version was one grid of six at every
                                width, which on a 360px screen gave each stage
                                55px and an 8px type size to fit it in — and
                                which, since the sequence is seven long, left
                                the last stage standing on a row of its own.
                              */}
                              <ol className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                                {BOOKING_STAGE_SEQUENCE.map((stageName, stageIndex) => {
                                  const done = percent >= bookingProgressPercent(stageName);
                                  return (
                                    <li
                                      key={stageName}
                                      className={`flex items-start gap-2 text-[13px] leading-snug ${
                                        done ? 'text-white' : 'text-brand-text-muted'
                                      }`}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                                          done ? 'bg-brand-sage-light text-brand-charcoal' : 'border border-white/20'
                                        }`}
                                      >
                                        {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                                      </span>
                                      <span>
                                        <span className="sr-only">
                                          Stage {stageIndex + 1}, {done ? 'done' : 'not yet'}:{' '}
                                        </span>
                                        {stageName}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ol>
                            </div>

                            <dl className="grid gap-x-8 gap-y-4 border-t border-white/10 pt-5 sm:grid-cols-3">
                              <div>
                                <dt className="flex items-center gap-1.5 text-[13px] text-brand-text-muted">
                                  <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                                  Collecting from
                                </dt>
                                <dd className="mt-1 text-[14px] leading-snug text-white">
                                  {[tracked.address, tracked.suburb].filter(Boolean).join(', ')}
                                </dd>
                              </div>
                              <div>
                                <dt className="flex items-center gap-1.5 text-[13px] text-brand-text-muted">
                                  <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                                  Pickup window
                                </dt>
                                <dd className="mt-1 text-[14px] leading-snug text-white">
                                  {whenLine(tracked.pickupDate, tracked.pickupTime) || '—'}
                                </dd>
                              </div>
                              <div>
                                <dt className="flex items-center gap-1.5 text-[13px] text-brand-text-muted">
                                  <Receipt aria-hidden="true" className="h-3.5 w-3.5" />
                                  {tracked.paymentStatus === 'Paid' ? 'Paid' : 'To pay'}
                                </dt>
                                <dd className="tnum mt-1 text-[14px] leading-snug text-white">
                                  ₵{displayAmount(tracked).toFixed(2)}
                                  <span className="ml-1.5 text-brand-text-muted">
                                    {paymentLabel(tracked.paymentMethod)}
                                  </span>
                                </dd>
                              </div>
                            </dl>

                            <div className="flex flex-wrap gap-2">
                              {tracked.paymentStatus !== 'Paid' && (
                                <button
                                  type="button"
                                  onClick={() => setPayModalBooking(tracked)}
                                  className={`${BTN} ${AS_MONEY} ${SIZE_MD}`}
                                >
                                  Pay ₵{displayAmount(tracked).toFixed(2)}
                                </button>
                              )}
                              {/* Offered only while the rules would accept it — a
                                  button whose every option the server refuses is
                                  worse than no button. The verdict is core's
                                  `canReschedule`, the same one the route runs. */}
                              {movable && (
                                <button
                                  type="button"
                                  onClick={() => setReschedulingId(tracked.id)}
                                  className={`${BTN} ${AS_QUIET} ${SIZE_MD}`}
                                >
                                  <CalendarClock aria-hidden="true" className="h-4 w-4" />
                                  Move this pickup
                                </button>
                              )}
                              {/* The message thread, put where the order is. It
                                  used to be a button called "Artisan Concierge
                                  Desk" in a sidebar two panels away from the
                                  order it was about. */}
                              <button
                                type="button"
                                onClick={() => setConciergeOpen(true)}
                                className={`${BTN} ${AS_QUIET} ${SIZE_MD}`}
                              >
                                <MessageSquare aria-hidden="true" className="h-4 w-4" />
                                Message the shop
                                {thread.length > 0 && (
                                  <span className="tnum text-brand-text-muted">{thread.length}</span>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setReceiptModalBooking(tracked)}
                                className={`${BTN} ${AS_QUIET} ${SIZE_MD}`}
                              >
                                Receipt
                              </button>
                            </div>

                            {/* Collection hand-off — only while the bags are
                                still here. Once the rider has them the code has
                                done its job. */}
                            {COLLECTION_PENDING.has(jobStatus) && <HandoffCode booking={tracked} />}

                            {/* And the other end of the round trip: the code the
                                rider needs before the clean laundry changes
                                hands back. */}
                            {DELIVERY_PENDING.has(jobStatus) && (
                              <HandoffCode booking={tracked} leg="delivery" />
                            )}
                          </div>

                          {/* Full-bleed inside the panel. The map is the one
                              thing here that is worth its own edge-to-edge
                              block, and boxing it inside a second border was
                              what made it read as one more card. */}
                          <div className="border-t border-white/10">
                            <LiveDispatchMap
                              clientSuburb={tracked.suburb}
                              clientAddress={tracked.address}
                              bookingStatus={tracked.status}
                              bookingId={tracked.id}
                              clientName={tracked.name}
                              clientCoords={tracked.pickupCoords}
                              rider={tracked.rider}
                            />
                          </div>
                        </Panel>
                      );
                    })()
                  )}

                  {/* --------------------------------------- every order */}
                  {userBookings.length > 0 && (
                    <Panel>
                      <PanelHead title="All orders">
                        <div
                          className="flex gap-1 rounded-md border border-white/12 p-1"
                          role="group"
                          aria-label="Filter orders"
                        >
                          {([
                            ['all', `All ${userBookings.length}`],
                            ['active', 'In progress'],
                            // "Closed", not "Delivered": it holds cancelled
                            // orders too, and a cancelled one has to live
                            // somewhere a customer would think to look.
                            ['closed', 'Closed'],
                          ] as const).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setOrderFilter(id)}
                              aria-pressed={orderFilter === id}
                              className={`rounded px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ${
                                orderFilter === id
                                  ? 'bg-white/10 text-white'
                                  : 'text-brand-text-muted hover:text-white'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </PanelHead>

                      {shownOrders.length === 0 ? (
                        <p className="px-5 py-8 text-center text-[14px] text-brand-text-muted">
                          No orders under that filter.
                        </p>
                      ) : (
                        <ul className="divide-y divide-white/10">
                          {shownOrders.map((booking) => {
                            const finish = decodeFinish(booking.specialInstructions);
                            return (
                              <li
                                key={booking.id}
                                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                                    <span className="tnum text-[15px] font-semibold text-white">
                                      {booking.id}
                                    </span>
                                    <span className="text-[14px] text-white">
                                      {describeItems(booking) || booking.serviceType}
                                    </span>
                                    <PaymentPill booking={booking} />
                                  </div>
                                  <p className="mt-1 text-[13px] leading-relaxed text-brand-text-muted">
                                    {[
                                      whenLine(booking.pickupDate, booking.pickupTime),
                                      booking.suburb,
                                      finish.scent,
                                      booking.status,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </p>
                                </div>

                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                  <span className="tnum mr-1 text-[16px] font-semibold text-white">
                                    ₵{displayAmount(booking).toFixed(2)}
                                  </span>
                                  {!isClosed(booking) && booking.id !== activeTrackingId && (
                                    <button
                                      type="button"
                                      onClick={() => setActiveTrackingId(booking.id)}
                                      className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                                    >
                                      Track
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setReceiptModalBooking(booking)}
                                    className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                                  >
                                    Receipt
                                  </button>
                                  {booking.paymentStatus !== 'Paid' && (
                                    <button
                                      type="button"
                                      onClick={() => setPayModalBooking(booking)}
                                      className={`${BTN} ${AS_MONEY} ${SIZE_SM}`}
                                    >
                                      Pay
                                    </button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </Panel>
                  )}
                </div>
              )}

              {/* ======================================== WALLET ========== */}
              {activePortalTab === 'wallet' && (
                <div className="space-y-6">
                  <div>
                    <h1 className="font-display text-[32px] font-medium leading-tight text-white">
                      Wallet
                    </h1>
                    <p className="mt-1 text-[15px] text-brand-text-muted">
                      Money and points, both in one place.
                    </p>
                  </div>

                  {redeemedRewardMsg && <Banner tone="ok">{redeemedRewardMsg}</Banner>}

                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* ------------------------------------ the balance */}
                    <Panel className="flex flex-col">
                      <PanelHead title="Balance" note="Pay for an order in one tap, with no checkout." />
                      <div className="flex flex-1 flex-col justify-between gap-6 px-5 py-5">
                        <p className="tnum text-[40px] font-semibold leading-none tracking-[-0.03em] text-white">
                          ₵{walletBalance.toFixed(2)}
                        </p>
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={() => setTopUpModalOpen(true)}
                            className={`${BTN} ${AS_MONEY} ${SIZE_MD} w-full`}
                          >
                            <Plus aria-hidden="true" className="h-4 w-4" />
                            Top up
                          </button>
                          {/* The three coloured boxes that were here — one
                              yellow, one red, one blue — were three network
                              brands painted in their own colours on a surface
                              whose palette means something. It is a sentence. */}
                          <p className="text-[13px] leading-relaxed text-brand-text-muted">
                            Top up with MTN MoMo, Telecel Cash, AT Money or a card. Handled by
                            Paystack.
                          </p>
                        </div>
                      </div>
                    </Panel>

                    {/* -------------------------------------- the points */}
                    <Panel className="flex flex-col">
                      <PanelHead
                        title="Care points"
                        note="A point for every cedi you spend. The tier is earned, not bought."
                      />
                      <div className="flex flex-1 flex-col justify-between gap-6 px-5 py-5">
                        <div>
                          <p className={`tnum text-[40px] font-semibold leading-none tracking-[-0.03em] ${TIER_INK[tier.id]}`}>
                            {patronPoints.toLocaleString()}
                            <span className="ml-2 text-[15px] font-medium tracking-normal text-brand-text-muted">
                              points
                            </span>
                          </p>
                          <p className="mt-2 text-[15px] text-white">
                            <span className="font-semibold">{tier.name}</span>
                            {tier.discountRate > 0 && (
                              <span className="text-brand-text-muted">
                                {' '}· {Math.round(tier.discountRate * 100)}% off everything
                              </span>
                            )}
                          </p>
                          <p className="mt-2 text-[14px] leading-relaxed text-brand-text-muted">
                            {tier.description}
                          </p>
                        </div>

                        {nextTier && (
                          <div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-brand-gold transition-[width] duration-700 ease-out"
                                style={{ width: `${tierPercent}%` }}
                              />
                            </div>
                            <p className="mt-2 text-[13px] text-brand-text-muted">
                              <span className="tnum">{pointsToNext.toLocaleString()}</span> points to{' '}
                              {nextTier.name}
                            </p>
                          </div>
                        )}
                      </div>
                    </Panel>
                  </div>

                  {/*
                    The membership the customer pays for, which this portal had
                    no notion of — the app read it off `account.plan` while the
                    website showed only the points tier, so a paid subscription
                    was invisible on one of the two surfaces.
                  */}
                  {activePlan && activePlanDefinition && (
                    <Panel>
                      <PanelHead title="Your plan" />
                      <div className="space-y-2.5 px-5 py-5">
                        <Row label="Plan" strong>{activePlanDefinition.name}</Row>
                        <Row label="Pickups left">
                          <span className="tnum">
                            {Math.max(0, activePlanDefinition.includedPickups - (activePlan.pickupsUsed ?? 0))}
                          </span>{' '}
                          of <span className="tnum">{activePlanDefinition.includedPickups}</span>
                        </Row>
                        <Row label={activePlan.cancelAtPeriodEnd ? 'Ends' : 'Renews'}>
                          {new Date(activePlan.renewsOn).toLocaleDateString()}
                        </Row>
                      </div>
                    </Panel>
                  )}

                  {/* ------------------------------------------- rewards */}
                  <Panel>
                    <PanelHead title="Spend your points" />
                    {/*
                      One list, from `@freshfold/core`, so the customer app's
                      wallet screen offers exactly these rewards at exactly these
                      prices. Each button posts to the server, which is what
                      takes the points — these used to check the balance, say
                      "Successfully redeemed" and deduct nothing at all.
                    */}
                    <ul className="divide-y divide-white/10">
                      {LOYALTY_REWARDS.map((reward) => {
                        const affordable = patronPoints >= reward.cost;
                        const busy = redeemingReward === reward.id;

                        return (
                          <li
                            key={reward.id}
                            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                          >
                            <div className="min-w-0">
                              <p className="text-[15px] font-medium text-white">{reward.name}</p>
                              <p className="mt-0.5 text-[13px] leading-relaxed text-brand-text-muted">
                                {reward.description}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={!affordable || busy}
                              onClick={() => handleRedeem(reward.id)}
                              className={`${BTN} ${AS_MONEY} ${SIZE_SM} shrink-0`}
                            >
                              {busy ? 'Redeeming…' : (
                                <>
                                  <span className="tnum">{reward.cost.toLocaleString()}</span> points
                                </>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </Panel>
                </div>
              )}

              {/* ======================================= ACCOUNT ========== */}
              {activePortalTab === 'account' && (
                <div className="mx-auto max-w-2xl space-y-6">
                  <div>
                    <h1 className="font-display text-[32px] font-medium leading-tight text-white">
                      Account
                    </h1>
                    <p className="mt-1 text-[15px] text-brand-text-muted">
                      Signed in as {currentUser.email}.
                    </p>
                  </div>

                  {/* --------------------------------------- your details */}
                  <Panel>
                    <PanelHead
                      title="Your details"
                      note="The name your rider asks for at the door, and the number they call from it."
                    />
                    <div className="space-y-4 px-5 py-5">
                      {savedSettingsMsg && !profileDirty && <Banner tone="ok">{savedSettingsMsg}</Banner>}
                      {profileError && <Banner tone="bad">{profileError}</Banner>}

                      <div className="space-y-1.5">
                        <label htmlFor="patron-name" className={LABEL}>Name</label>
                        <input
                          id="patron-name"
                          type="text"
                          autoComplete="name"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          placeholder="Ama Mensah"
                          className={FIELD}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="patron-phone" className={LABEL}>Phone</label>
                        <input
                          id="patron-phone"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          value={profilePhone}
                          /* Through `limitPhoneInput`, so the eleventh digit
                             simply never lands rather than being rejected under
                             a full box afterwards. */
                          onChange={(e) => setProfilePhone(limitPhoneInput(e.target.value))}
                          placeholder={`${PHONE_DIGITS} digits — e.g. 0550001234`}
                          className={`${FIELD} tnum`}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="patron-email" className={LABEL}>Email</label>
                        <input
                          id="patron-email"
                          type="text"
                          disabled
                          value={currentUser.email}
                          className={FIELD}
                        />
                        <p className="text-[13px] leading-relaxed text-brand-text-muted">
                          Your email is your sign-in. Call the shop if you need to change it.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={saveProfileDetails}
                        disabled={!profileDirty || profileSaving}
                        className={`${BTN} ${AS_PRIMARY} ${SIZE_MD}`}
                      >
                        {profileSaving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </Panel>

                  {/* -------------------------------------- address book */}
                  <Panel>
                    <PanelHead
                      title="Collection addresses"
                      note="Kept in step with the FreshFold app — an address added on your phone appears here."
                    >
                      {savedAddresses.length < MAX_SAVED_ADDRESSES && !addressDraft && (
                        <button
                          type="button"
                          onClick={startNewAddress}
                          className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                        >
                          <Plus aria-hidden="true" className="h-4 w-4" />
                          Add
                        </button>
                      )}
                    </PanelHead>

                    {addressError && (
                      <div className="px-5 pt-5">
                        <Banner tone="bad">{addressError}</Banner>
                      </div>
                    )}

                    {savedAddresses.length === 0 && !addressDraft ? (
                      <p className="px-5 py-6 text-[14px] leading-relaxed text-brand-text-muted">
                        No addresses saved yet. Add one and it will be offered the next time you book.
                      </p>
                    ) : (
                      <ul className="divide-y divide-white/10">
                        {savedAddresses.map((saved) => (
                          <li
                            key={saved.id}
                            className="flex items-start justify-between gap-4 px-5 py-4"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[15px] font-medium text-white">{saved.label}</span>
                                {saved.isDefault && (
                                  <span className="rounded border border-white/15 px-1.5 py-0.5 text-[12px] font-medium text-brand-sage-light">
                                    Default
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 break-words text-[14px] leading-relaxed text-brand-text-muted">
                                {saved.address}, {saved.suburb}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              {!saved.isDefault && (
                                <button
                                  type="button"
                                  disabled={addressSaving}
                                  /* `withAddress` clears the flag from everyone
                                     else when the incoming entry claims it, so
                                     this is the whole of "make default". */
                                  onClick={() =>
                                    commitAddresses(
                                      withAddress(savedAddresses, { ...saved, isDefault: true })
                                    )
                                  }
                                  aria-label={`Collect from ${saved.label} by default`}
                                  className="grid h-9 w-9 place-items-center rounded-md text-brand-text-muted transition-colors duration-200 hover:bg-white/5 hover:text-brand-sage-light disabled:cursor-not-allowed"
                                >
                                  <Check aria-hidden="true" className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={addressSaving}
                                onClick={() => {
                                  setAddressDraft(saved);
                                  setAddressError('');
                                }}
                                aria-label={`Edit ${saved.label}`}
                                className="grid h-9 w-9 place-items-center rounded-md text-brand-text-muted transition-colors duration-200 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed"
                              >
                                <Pencil aria-hidden="true" className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                disabled={addressSaving}
                                onClick={() => commitAddresses(withoutAddress(savedAddresses, saved.id))}
                                aria-label={`Remove ${saved.label}`}
                                className="grid h-9 w-9 place-items-center rounded-md text-brand-text-muted transition-colors duration-200 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed"
                              >
                                <Trash2 aria-hidden="true" className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {savedAddresses.length >= MAX_SAVED_ADDRESSES && !addressDraft && (
                      <p className="border-t border-white/10 px-5 py-4 text-[13px] text-brand-text-muted">
                        {ADDRESS_LIMIT_MESSAGE}
                      </p>
                    )}

                    {addressDraft && (
                      <div className="space-y-4 border-t border-white/10 px-5 py-5">
                        <h4 className="text-[15px] font-medium text-white">
                          {savedAddresses.some((saved) => saved.id === addressDraft.id)
                            ? 'Edit this address'
                            : 'New address'}
                        </h4>

                        <div className="space-y-1.5">
                          <label htmlFor="addr-label" className={LABEL}>Name it</label>
                          <input
                            id="addr-label"
                            type="text"
                            value={addressDraft.label}
                            onChange={(e) => setAddressDraft({ ...addressDraft, label: e.target.value })}
                            placeholder="Home, hostel, office…"
                            className={FIELD}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="addr-line" className={LABEL}>Address or landmark</label>
                          {/* The same lookup the booking form uses. Choosing a
                              suggestion also carries the coordinate across, so an
                              address saved here arrives with a pin rather than
                              falling back to the middle of its suburb. */}
                          <AddressAutocomplete
                            id="addr-line"
                            value={addressDraft.address}
                            onChange={(next) => setAddressDraft({ ...addressDraft, address: next })}
                            onPlaceSelected={(detail) =>
                              setAddressDraft({
                                ...addressDraft,
                                address: detail.address,
                                coords: detail.coords,
                              })
                            }
                            placeholder="Evandy Hostel, Block B, Room 304"
                            className={FIELD}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="addr-suburb" className={LABEL}>Suburb</label>
                          <select
                            id="addr-suburb"
                            value={addressDraft.suburb}
                            onChange={(e) => setAddressDraft({ ...addressDraft, suburb: e.target.value })}
                            className={FIELD}
                          >
                            {/* From core, so this list and the one the rider's
                                distances are computed against cannot drift. */}
                            {SERVICE_SUBURBS.map((suburb) => (
                              <option key={suburb} value={suburb}>{suburb}</option>
                            ))}
                          </select>
                        </div>

                        <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-white">
                          <input
                            type="checkbox"
                            checked={addressDraft.isDefault}
                            onChange={(e) => setAddressDraft({ ...addressDraft, isDefault: e.target.checked })}
                            className="h-4 w-4 cursor-pointer accent-brand-sage"
                          />
                          Collect from here by default
                        </label>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={saveAddressDraft}
                            disabled={addressSaving}
                            className={`${BTN} ${AS_PRIMARY} ${SIZE_MD}`}
                          >
                            {addressSaving ? 'Saving…' : 'Save address'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddressDraft(null);
                              setAddressError('');
                            }}
                            disabled={addressSaving}
                            className={`${BTN} ${AS_QUIET} ${SIZE_MD}`}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </Panel>

                  {/* The way out, at the bottom of the page it belongs to as
                      well as in the bar — this is where somebody goes looking
                      for it. */}
                  <Panel className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <p className="text-[14px] text-brand-text-muted">
                      Signed in on this device.
                    </p>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className={`${BTN} ${AS_QUIET} ${SIZE_SM}`}
                    >
                      <LogOut aria-hidden="true" className="h-4 w-4" />
                      Sign out
                    </button>
                  </Panel>
                </div>
              )}

            </div>
          )}
      </main>

      {/* ------------------------------------------------------------ move */}
      {/* Mounted beside the payment sheet rather than in the tracking card, so
          it overlays the portal instead of scrolling inside a panel. Like the
          sheets below it, it is a plain conditional render — see the note on
          `.overlay-in` in index.css for what `AnimatePresence` was doing to
          these. */}
        {reschedulingId &&
          (() => {
            const booking = userBookings.find((candidate) => candidate.id === reschedulingId);
            if (!booking) return null;

            return (
              <RescheduleDrawer
                key={booking.id}
                booking={booking}
                onClose={() => setReschedulingId(null)}
              />
            );
          })()}

      {/* ------------------------------------------------------------- pay */}
        {payModalBooking && (
          <Modal
            title={`Pay for ${payModalBooking.id}`}
            note={`₵${displayAmount(payModalBooking).toFixed(2)} due`}
            onClose={() => setPayModalBooking(null)}
          >
            <div className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPayMethod('Paystack')}
                  aria-pressed={payMethod === 'Paystack'}
                  className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-200 ${
                    payMethod === 'Paystack'
                      ? 'border-brand-gold bg-brand-gold/10'
                      : 'border-white/12 hover:border-white/25'
                  }`}
                >
                  <span className="flex items-center gap-2 text-[14px] font-medium text-white">
                    <PaystackMark className="h-4 w-4 shrink-0" />
                    Card or mobile money
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setPayMethod('Wallet')}
                  aria-pressed={payMethod === 'Wallet'}
                  className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-200 ${
                    payMethod === 'Wallet'
                      ? 'border-brand-gold bg-brand-gold/10'
                      : 'border-white/12 hover:border-white/25'
                  }`}
                >
                  <span className="flex items-center gap-2 text-[14px] font-medium text-white">
                    <Wallet aria-hidden="true" className="h-4 w-4 shrink-0" />
                    FreshFold wallet
                  </span>
                  <span className="tnum text-[13px] text-brand-text-muted">
                    ₵{walletBalance.toFixed(2)}
                  </span>
                </button>
              </div>

              {/* A refused payment — a short balance, a gateway that could not
                  be reached — says so here rather than nowhere. */}
              {paystackError && <Banner tone="bad">{paystackError}</Banner>}

              {payMethod === 'Paystack' && (
                <div className="space-y-3">
                  <p className="text-[14px] leading-relaxed text-brand-text-muted">
                    MTN MoMo, Telecel Cash, AT Money, Visa and Mastercard. Paystack takes the
                    payment; we never see your card.
                  </p>
                  <button
                    type="button"
                    onClick={handlePortalPaystackInit}
                    disabled={paystackLoading}
                    className={`${BTN} ${AS_MONEY} ${SIZE_MD} w-full`}
                  >
                    <Lock aria-hidden="true" className="h-4 w-4" />
                    {paystackLoading
                      ? 'Opening Paystack…'
                      : `Pay ₵${displayAmount(payModalBooking).toFixed(2)}`}
                  </button>

                  {paystackAuthUrl && (
                    <div className="space-y-3 border-t border-white/10 pt-4">
                      <a
                        href={paystackAuthUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-brand-gold underline transition-colors duration-200 hover:text-brand-gold-light"
                      >
                        Reopen the Paystack window
                      </a>
                      {/*
                        One button, because there is one way to settle this. A
                        "Mark Paid" sat beside this one and skipped the gateway
                        entirely — a customer could clear their own bill by
                        clicking it.
                      */}
                      <button
                        type="button"
                        onClick={handlePortalPaystackVerify}
                        disabled={paystackLoading || paying}
                        className={`${BTN} ${AS_QUIET} ${SIZE_MD} w-full`}
                      >
                        {paystackLoading || paying ? 'Checking with Paystack…' : "I've paid — check"}
                      </button>
                      <p className="text-[13px] leading-relaxed text-brand-text-muted">
                        Finish in the Paystack window first. We confirm it with Paystack before
                        the order is marked paid.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {payMethod === 'Wallet' && (
                <div className="space-y-3">
                  {walletBalance < displayAmount(payModalBooking) ? (
                    <>
                      <p className="text-[14px] leading-relaxed text-brand-text-muted">
                        Your balance is ₵{walletBalance.toFixed(2)} and this order is ₵
                        {displayAmount(payModalBooking).toFixed(2)}. Top up first, or pay by card
                        or mobile money.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPayModalBooking(null);
                          setTopUpModalOpen(true);
                        }}
                        className={`${BTN} ${AS_MONEY} ${SIZE_MD} w-full`}
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        Top up the wallet
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-[14px] leading-relaxed text-brand-text-muted">
                        ₵{(walletBalance - displayAmount(payModalBooking)).toFixed(2)} left afterwards.
                      </p>
                      <button
                        type="button"
                        disabled={paying}
                        onClick={() => settleBooking(payModalBooking.id, 'Wallet')}
                        className={`${BTN} ${AS_MONEY} ${SIZE_MD} w-full`}
                      >
                        {paying
                          ? 'Taking payment…'
                          : `Pay ₵${displayAmount(payModalBooking).toFixed(2)} from the wallet`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </Modal>
        )}

      {/* ---------------------------------------------------------- top up */}
        {topUpModalOpen && (
          <Modal
            title="Top up your wallet"
            note={`₵${walletBalance.toFixed(2)} on it now`}
            onClose={() => {
              setTopUpModalOpen(false);
              setTopUpPaystackAuthUrl('');
              setTopUpPaystackError('');
            }}
          >
            <div className="space-y-5">
              <fieldset className="space-y-2">
                <legend className={LABEL}>How much?</legend>
                <div className="grid grid-cols-4 gap-2">
                  {['50', '100', '200', '500'].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setTopUpAmount(amount)}
                      aria-pressed={topUpAmount === amount}
                      className={`tnum rounded-md border py-2.5 text-[14px] font-medium transition-colors duration-200 ${
                        topUpAmount === amount
                          ? 'border-brand-gold bg-brand-gold/10 text-white'
                          : 'border-white/12 text-brand-text-muted hover:border-white/25 hover:text-white'
                      }`}
                    >
                      ₵{amount}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  aria-label="Another amount in cedis"
                  placeholder="Another amount"
                  className={`${FIELD} tnum`}
                />
              </fieldset>

              <p className="text-[14px] leading-relaxed text-brand-text-muted">
                MTN MoMo, Telecel Cash, AT Money, Visa and Mastercard. Paystack takes the payment;
                we never see your card.
              </p>

              {topUpPaystackError && <Banner tone="bad">{topUpPaystackError}</Banner>}

              <button
                type="button"
                onClick={handleWalletPaystackInit}
                disabled={topUpPaystackLoading}
                className={`${BTN} ${AS_MONEY} ${SIZE_MD} w-full`}
              >
                <Lock aria-hidden="true" className="h-4 w-4" />
                {topUpPaystackLoading ? 'Opening Paystack…' : `Add ₵${topUpAmount || '0'}`}
              </button>

              {topUpPaystackAuthUrl && (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <a
                    href={topUpPaystackAuthUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[14px] font-medium text-brand-gold underline transition-colors duration-200 hover:text-brand-gold-light"
                  >
                    Reopen the Paystack window
                  </a>
                  <button
                    type="button"
                    onClick={handleWalletPaystackVerify}
                    disabled={topUpPaystackLoading}
                    className={`${BTN} ${AS_QUIET} ${SIZE_MD} w-full`}
                  >
                    {topUpPaystackLoading ? 'Checking with Paystack…' : "I've paid — check"}
                  </button>
                </div>
              )}
            </div>
          </Modal>
        )}

      {/* -------------------------------------------------------- messages */}
        {conciergeOpen && (
          <Modal
            title="Message the shop"
            note={
              threadOrderId ? (
                <>
                  Your rider and the desk, on order{' '}
                  <span className="tnum font-medium text-white">{threadOrderId}</span>.
                </>
              ) : (
                <>Book a pickup to open a thread. The shop is on the phone below in the meantime.</>
              )
            }
            onClose={() => {
              setConciergeOpen(false);
              setConciergeSuccess('');
            }}
            wide
          >
            <div className="flex h-full flex-col gap-4">
              {conciergeSuccess && <Banner tone="ok">{conciergeSuccess}</Banner>}

              {threadOrderId && (
                <div className="min-h-[160px] flex-1 space-y-3 overflow-y-auto rounded-md border border-white/10 bg-black/30 p-3">
                  {thread.length === 0 ? (
                    <p className="py-10 text-center text-[14px] text-brand-text-muted">
                      No messages yet. Send the first one.
                    </p>
                  ) : (
                    thread.map((message) => {
                      const mine = message.sender === 'customer';
                      return (
                        <div
                          key={message.id}
                          className={`flex max-w-[85%] flex-col ${mine ? 'ml-auto items-end' : 'items-start'}`}
                        >
                          <span className="mb-1 text-[13px] text-brand-text-muted">
                            {mine ? 'You' : SENDER_LABELS[message.sender]} · {message.timestamp}
                          </span>
                          <div
                            className={`rounded-md px-3 py-2 text-[14px] leading-relaxed ${
                              mine
                                ? 'bg-brand-sage text-white'
                                : 'border border-white/10 bg-brand-card-light text-white'
                            }`}
                          >
                            {message.text}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="concierge-note" className={LABEL}>Your message</label>
                <textarea
                  id="concierge-note"
                  rows={3}
                  value={conciergeText}
                  onChange={(e) => setConciergeText(e.target.value)}
                  placeholder="The gate code, a stain to watch for, a change of plan…"
                  className={FIELD}
                />
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={!threadOrderId || !conciergeText.trim()}
                  onClick={() => {
                    const text = conciergeText.trim();
                    if (!text || !threadOrderId) return;

                    store.sendMessage(text, threadOrderId);
                    setConciergeText('');
                    setConciergeSuccess(
                      store.isOnline()
                        ? 'Sent to your rider and the desk.'
                        : 'Saved — it will send as soon as you are back online.'
                    );
                    setTimeout(() => setConciergeSuccess(''), 4000);
                  }}
                  className={`${BTN} ${AS_PRIMARY} ${SIZE_MD} w-full`}
                >
                  <Send aria-hidden="true" className="h-4 w-4" />
                  {threadOrderId ? 'Send' : 'No order to send about'}
                </button>

                <a
                  href="tel:+233200957165"
                  className={`${BTN} ${AS_QUIET} ${SIZE_MD} w-full`}
                >
                  Call the shop
                </a>
              </div>
            </div>
          </Modal>
        )}

      {/* --------------------------------------------------------- receipt */}
        {receiptModalBooking && (
          <Modal
            title="Receipt"
            note={
              <>
                Order <span className="tnum font-medium text-white">{receiptModalBooking.id}</span>{' '}
                · FreshFold, Kumasi
              </>
            }
            onClose={() => setReceiptModalBooking(null)}
          >
            {/*
              Itemised from the booking itself. This block used to print a "Base
              Care Package" of the total minus ten and an "Express Dispatch Fee"
              of exactly ₵10.00 on every order — a split that described no
              booking and no fee this business charges. The lines below are the
              ones the quote was actually built from.
            */}
            {(() => {
              const finish = decodeFinish(receiptModalBooking.specialInstructions);
              // See the note on the desk's copy of this: without the lines, a
              // three-load order itemises as one and the arithmetic on the
              // receipt stops adding up.
              const lines = priceBreakdown({
                serviceType: receiptModalBooking.serviceType,
                scent: finish.scent,
                starch: finish.starch,
                addonIds: receiptModalBooking.specialtyAddons,
                items: receiptModalBooking.items,
                quantity: receiptModalBooking.quantity,
              });
              const total = displayAmount(receiptModalBooking);
              // Charged below list price: an included pickup, the member rate
              // or a loyalty tier took its cut. Shown as its own line rather
              // than folded silently into the base.
              const reduction = Math.max(0, lines.gross - total);

              return (
                <div className="space-y-5">
                  <div className="space-y-2.5">
                    <Row label="Service">
                      {describeItems(receiptModalBooking) || receiptModalBooking.serviceType}
                    </Row>
                    <Row label="Collected from">
                      {receiptModalBooking.address}, {receiptModalBooking.suburb}
                    </Row>
                    <Row label="Picked up">
                      {whenLine(receiptModalBooking.pickupDate, receiptModalBooking.pickupTime) || '—'}
                    </Row>
                    {finish.scent && <Row label="Scent">{finish.scent}</Row>}
                    {!!receiptModalBooking.specialtyAddons?.length && (
                      <Row label="Extras">{receiptModalBooking.specialtyAddons.join(', ')}</Row>
                    )}
                  </div>

                  <div className="space-y-2.5 border-t border-white/10 pt-4">
                    <Row label="Wash"><span className="tnum">₵{lines.base.toFixed(2)}</span></Row>
                    {lines.finishes > 0 && (
                      <Row label="Scent and starch">
                        <span className="tnum">₵{lines.finishes.toFixed(2)}</span>
                      </Row>
                    )}
                    {lines.addons > 0 && (
                      <Row label="Extras">
                        <span className="tnum">₵{lines.addons.toFixed(2)}</span>
                      </Row>
                    )}
                    {reduction > 0 && (
                      <div className="flex items-baseline justify-between gap-6 text-[14px]">
                        <span className="text-brand-text-muted">Plan and points</span>
                        <span className="tnum text-emerald-300">−₵{reduction.toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-baseline justify-between gap-6 border-t border-white/10 pt-4">
                    <span className="text-[15px] font-medium text-white">Total</span>
                    <span className="tnum text-[21px] font-semibold text-brand-gold">
                      ₵{total.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                    <span className="text-[14px] text-brand-text-muted">
                      {paymentLabel(receiptModalBooking.paymentMethod)}
                    </span>
                    <PaymentPill booking={receiptModalBooking} />
                  </div>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className={`${BTN} ${AS_QUIET} ${SIZE_MD} w-full`}
                  >
                    <Receipt aria-hidden="true" className="h-4 w-4" />
                    Print or save as PDF
                  </button>
                </div>
              );
            })()}
          </Modal>
        )}

    </div>
  );
}

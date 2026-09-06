/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ApiError,
  bookingProgressPercent,
  bookingWithKnownProof,
  defaultAddress as firstAddress,
  isTerminal,
  membershipPlan,
  newJobId,
  sameAddresses,
  withAddress,
  withoutAddress,
  type ActivePlan,
  type Booking,
  type BookingAuth,
  type Claim,
  type ClaimKind,
  type RecurringPickup,
  type JobStatus,
  type LaundryBag,
  type Message,
  type Notification,
  type PaymentTransaction,
  type SavedAddress,
  type UserAccount,
} from '@freshfold/core';
import { api } from '../services/api';
import { STORAGE_KEYS, readJson, remove, writeJson } from '../services/storage';
import { usePreferences } from './PreferencesStore';
import { useSession } from './SessionStore';

/**
 * The customer app's data layer.
 *
 * Modelled on `apps/web/src/services/store.ts` and subject to the same three
 * rules, adapted for a device:
 *
 *  1. **Reads are synchronous.** The mirror is hydrated from AsyncStorage once
 *     at startup — `hydrated` gates the first paint — and every read after that
 *     comes out of memory.
 *  2. **Writes are write-through.** They land in the mirror and in storage
 *     immediately, then go to the server in the background. A failed write is
 *     queued in order, not lost.
 *  3. **The server pushes back by polling.** A rider's progress on the road
 *     arrives here within a few seconds.
 *
 * With the server unreachable the app still books, still shows history and
 * still queues its writes — it just cannot see the courier move.
 */

const POLL_INTERVAL_MS = 4000;

/**
 * Whether a failed write is worth retrying.
 *
 * A dropped connection is temporary and the write should wait. A rejection is
 * not: the commonest case is a booking deleted from the supervisor ledger while
 * an edit for it sat in the queue, and that write can never succeed. Timeouts
 * and rate limits are the two 4xx codes that *do* clear on their own.
 */
function isPermanentFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 408 || error.status === 429) return false;
  return error.status >= 400 && error.status < 500;
}

/**
 * Why a paid action could not be attempted, in words a customer or a developer
 * can act on.
 *
 * "Check your connection and try again" was the answer to three different
 * failures, and only one of them was the connection. The address is in the
 * message because on a phone it is a LAN address derived from the Expo dev host
 * — so a device on cellular, or one loaded from a different network than the
 * dispatch server runs on, reads as a phone problem when it is a setup one. The
 * wallet tab already says it this way; the membership and rewards paths did not.
 *
 * The timeout deliberately promises nothing about the money. Both callers here
 * move a balance server-side, and an abort at eight seconds says only that *this
 * app* stopped waiting — the transaction may well have committed. Telling
 * somebody "nothing was charged" and then showing them a debit is worse than
 * telling them to look.
 */
function unreachableMessage(error: unknown): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'FreshFold took too long to answer, so this may or may not have gone through. Check the Wallet tab before trying again.';
  }
  return `Could not reach FreshFold at ${api.baseUrl}. Check that the dispatch server is running and that this device can see it.`;
}

/**
 * A visitor's book folded into the account's.
 *
 * Somebody books before they register: they save an address as a guest, it goes
 * to this device's storage because there is no account to put it on, and then
 * they sign up. Their addresses have to survive that, so both books are read as
 * one from the moment there is a session — and the first write after it sends
 * the result, which is what actually moves them onto the account.
 *
 * The account's default wins when it has one. The customer chose it on a
 * surface that knew about their account; a flag on an address saved before they
 * had one is not a preference about their account at all.
 */
function mergedBook(
  accountBook: SavedAddress[] | undefined,
  localBook: SavedAddress[]
): SavedAddress[] {
  if (localBook.length === 0) return accountBook ?? [];

  /**
   * Which entry the account says is the default, so a local copy of that entry
   * can carry the flag through the replacement below.
   *
   * Clearing the flag from every local entry alike was not enough. `withAddress`
   * overwrites the whole entry it matches by id, so a device copy of the
   * account's *own* default replaced it with a version claiming nothing — the
   * book came out with no claimant at all and the normaliser promoted whichever
   * address happened to be first. The customer's choice moved to another
   * address, on a render, with nothing having been tapped.
   */
  const claimed = accountBook?.find((address) => address.isDefault)?.id;

  const local = accountBook?.length
    ? localBook.map((address) => ({ ...address, isDefault: address.id === claimed }))
    : localBook;

  // `withAddress` one at a time rather than concatenating: it is what settles
  // the single default and the ceiling, and an id already on the account is an
  // edit of that entry rather than a second copy of it.
  return local.reduce((book, address) => withAddress(book, address), accountBook ?? []);
}

/**
 * The saved address book moved onto the account, and so did its type.
 *
 * This was declared here, and the book was kept in AsyncStorage — so it
 * belonged to a handset rather than to a person, and the same customer on the
 * website or on a second phone saw none of it. `SavedAddress` now comes from
 * `@freshfold/core` and travels on `UserAccount`, and is re-exported here so the
 * screens importing it from this module keep working, exactly as `ActivePlan`
 * below is.
 *
 * A signed-out visitor still gets a book: theirs stays on the device, and is
 * merged into the account on the first save after they sign in.
 */
export type { SavedAddress };

/**
 * The membership lives on the account now, not on the device.
 *
 * `ActivePlan` moved to `@freshfold/core` and is re-exported here so the
 * screens that import it from this module keep working. What changed is where
 * the value comes from: it is read off `account.plan`, which the server owns
 * and settles, rather than out of AsyncStorage where anyone could write one and
 * where a reinstall threw a paid plan away.
 */
export type { ActivePlan };

type PendingWrite =
  | { kind: 'booking:create'; booking: Booking }
  | { kind: 'booking:patch'; id: string; patch: Partial<Booking> }
  | { kind: 'booking:delete'; id: string }
  | { kind: 'message:post'; message: Message }
  | { kind: 'notification:read'; id: string }
  /**
   * The whole book, not the entry that changed.
   *
   * `PUT /accounts/addresses` replaces the array outright, so what has to
   * survive a queue is the book as it should end up rather than the edit that
   * produced it. That also makes a queued save idempotent, and lets `enqueue`
   * collapse several — a customer who adds three addresses on a plane sends one
   * write when the plane lands, not three that each overwrite the last.
   */
  | { kind: 'addresses:save'; addresses: SavedAddress[] }
  | {
      kind: 'order:status';
      id: string;
      patch: {
        status: JobStatus;
        signature?: string;
        photo?: string;
        bags?: LaundryBag[];
        /** Proves the customer accepted the handover themselves. */
        deliveryCode?: string;
      };
    };

interface Mirror {
  bookings: Booking[];
  messages: Message[];
  notifications: Notification[];
  transactions: PaymentTransaction[];
  addresses: SavedAddress[];
  /** Ids booked on this device, so a signed-out visitor can still track them. */
  localIds: string[];
  /** Bag manifests the customer has personally verified, per job. */
  verifiedBags: Record<string, string[]>;
}

const EMPTY_MIRROR: Mirror = {
  bookings: [],
  messages: [],
  notifications: [],
  transactions: [],
  addresses: [],
  localIds: [],
  verifiedBags: {},
};

/** What a subscribe attempt did, so the sheet can say something specific. */
export type SubscribeResult =
  | { ok: true; charged: number; credit: number }
  | { ok: false; reason: 'signed-out' | 'insufficient-funds' | 'offline' | 'rejected'; shortfall?: number; message: string };

/** What a redemption did. `shortfall` is in points, not cedis. */
export type RedeemResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'signed-out' | 'insufficient-points' | 'offline' | 'rejected';
      shortfall?: number;
      message: string;
    };

interface ClientState extends Mirror {
  hydrated: boolean;
  online: boolean;
  /**
   * False until the first poll has come back, either way.
   *
   * `online` alone cannot express "we have not asked yet", and it starts false —
   * so anything reading it during startup concluded the server was down when
   * nothing had been tried. Screens showing a connection indicator wait for
   * this before believing a negative.
   */
  probed: boolean;
  /** Bookings still in flight, newest first. */
  activeBookings: Booking[];
  /** Delivered or cancelled, newest first. */
  pastBookings: Booking[];
  /** The one the home screen and the tracking tab focus on. */
  primaryBooking: Booking | null;
  unreadCount: number;
  walletBalance: number;
  points: number;

  /** The membership on the account, as the server last settled it. */
  plan: ActivePlan | null;
  /** Included pickups left in the period now running. */
  includedPickupsLeft: number;
  /** True once cancelled: the plan runs to `plan.renewsOn` and then stops. */
  planEndsOn: string | null;

  createBooking: (booking: Booking) => Promise<Booking>;
  /**
   * Settles a booking's bill against the server's own price. The only path to
   * `Paid`. Throws — `ApiError` carries `{ reason: 'insufficient-funds', shortfall }`
   * when the wallet is short.
   */
  payForBooking: (
    id: string,
    method: 'Wallet' | 'Paystack',
    reference?: string
  ) => Promise<Booking>;
  patchBooking: (id: string, patch: Partial<Booking>) => void;
  /**
   * Calls an order off.
   *
   * Awaited rather than queued, unlike most writes here, and for the reason
   * `payForBooking` is: the server can refuse it — the courier may already have
   * the bags — and a refusal the customer never sees is exactly the bug this
   * replaced. Throws `ApiError` carrying a `reason` from `CancelRefusal`.
   */
  cancelBooking: (id: string) => Promise<Booking>;
  /**
   * Rates the courier on a delivered order.
   *
   * Awaited rather than queued, unlike most writes here. A rating is a thing
   * somebody is pressing and watching: the star fills under their thumb and has
   * to go back if the server refuses, and there is no version of this worth
   * replaying days later against an order whose courier may since have been
   * reassigned.
   */
  rateBooking: (id: string, stars: number) => Promise<void>;
  /**
   * Moves a booking to another day or window.
   *
   * Not queued and not optimistic, unlike `patchBooking`. The server decides
   * whether the move is allowed at all — the window may have filled, a courier
   * may have accepted the job while the customer was choosing — so writing the
   * new date into the mirror first would show them a change that is about to be
   * refused. Rejects with the `ApiError` so the sheet can show the sentence the
   * server wrote.
   */
  /** The problems this customer has reported, newest first. */
  claims: Claim[];
  /** Standing orders — the weekly pickups every membership plan sells. */
  recurring: RecurringPickup[];
  loadRecurring: () => Promise<void>;
  saveRecurring: (
    id: string,
    pickup: Parameters<typeof api.saveRecurring>[1]
  ) => Promise<void>;
  deleteRecurring: (id: string) => Promise<void>;
  /** The customer's own referral code, and how it is doing. */
  referral: { code: string; reward: number; welcome: number; invited: number; rewarded: number } | null;
  loadReferral: () => Promise<void>;
  claimReferral: (code: string) => Promise<void>;
  /** Re-reads them. The order screen calls it when it opens. */
  loadClaims: () => Promise<void>;
  rescheduleBooking: (
    id: string,
    change: { pickupDate: string; pickupTime: string; deliveryTime?: string }
  ) => Promise<void>;
  bookingById: (id: string) => Booking | undefined;
  /**
   * Fetches one order in full, which is the only way to get its proof-of-service
   * photographs — the polled list leaves them behind so it stays small enough to
   * ask for every four seconds. Safe to call repeatedly; the order screen calls
   * it on open.
   */
  loadBookingProof: (id: string) => Promise<void>;
  messagesFor: (orderId: string) => Message[];

  sendMessage: (orderId: string, text: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  /** Records the customer's own scan-through of their bag manifest. */
  verifyBags: (orderId: string, bags: LaundryBag[]) => void;
  /** Signature + handover code at the door. Returns false on a wrong code. */
  confirmDelivery: (orderId: string, signature: string, code: string) => Promise<boolean>;
  /** Attaches a photo and a note to the job's conversation. */
  /**
   * Reports a problem, and files a claim for it.
   *
   * Two acts, deliberately. The message goes into the courier thread because
   * somebody with a ruined shirt wants to talk to a person, and that is where
   * that conversation lives. The claim is the half a conversation cannot do —
   * a state, an owner and an ending — and before it existed the report reached
   * the thread and stopped there.
   *
   * The claim is best effort and the message is not: if the claim route refuses
   * — past the fortnight, or ten already open — the customer has still reached
   * the desk, which is what they were trying to do.
   */
  reportIssue: (orderId: string, note: string, photoUri?: string, kind?: ClaimKind) => void;

  /**
   * Credits the wallet against a settled Paystack payment, named by its
   * reference. The server re-verifies the reference with Paystack and credits
   * what was collected — the device proposes no amount, and cannot.
   */
  topUpWallet: (method: string, reference: string) => Promise<void>;
  /**
   * Debits the wallet and earns the point-per-cedi that spend is worth.
   * Resolves false when the balance will not cover it.
   */
  chargeWallet: (amount: number, description: string, bookingId?: string) => Promise<boolean>;
  /** Spends care points on a reward from the shared catalogue. */
  redeemReward: (rewardId: string) => Promise<RedeemResult>;
  /**
   * Starts or switches a plan. The server prices it — including the credit for
   * an unused part of a running plan — debits the wallet once and writes the
   * one ledger entry.
   */
  subscribeToPlan: (planId: string) => Promise<SubscribeResult>;
  /** Cancels at the end of the paid period. Returns the date it ends. */
  cancelPlan: () => Promise<string | null>;
  /** Reverses a pending cancellation while the period is still running. */
  resumePlan: () => Promise<boolean>;

  /**
   * Writes the customer's own name or phone number to their account, and waits
   * for the answer.
   *
   * Not queued, for the reason `payForBooking` gives above: a rejection has to
   * reach the person who pressed Save. A queued profile write would meet
   * `isPermanentFailure` on the 409 the server returns for a number already in
   * use, be dropped without a word, and leave the device showing a phone number
   * the account does not have.
   *
   * Throws. `ApiError.message` is the server's own sentence, and its `body`
   * carries `reason: 'phone-taken'` for the number clash specifically.
   */
  saveProfile: (patch: { name?: string; phone?: string }) => Promise<void>;

  saveAddress: (address: SavedAddress) => void;
  removeAddress: (id: string) => void;
  defaultAddress: SavedAddress | null;

  /**
   * Drops everything this device is holding — orders, messages, alerts,
   * statement, addresses, tracking grants and any write still queued.
   *
   * For account deletion, which is the one case where leaving the mirror in
   * place is wrong: signing out keeps it deliberately (a guest-booked order is
   * still readable through its tracking grant), but here the account is gone and
   * the orders are not the device's to show. Clearing storage alone would not
   * do — the mirror is held in memory and the next `commit` would write it
   * straight back.
   *
   * Session teardown is `useSession().deleteAccount`, which owns the token and
   * the profile. This owns the seven keys those two do not.
   */
  forgetLocalData: () => Promise<void>;

  refresh: () => Promise<void>;
}

const ClientContext = createContext<ClientState | null>(null);

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const { account, isAuthenticated, applyAccount, token } = useSession();
  const { allowsAlert } = usePreferences();

  const [mirror, setMirror] = useState<Mirror>(EMPTY_MIRROR);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(false);
  const [probed, setProbed] = useState(false);

  const queueRef = useRef<PendingWrite[]>([]);
  const drainingRef = useRef(false);
  /** Non-zero while a write is on the wire, so a poll can't clobber a fresh edit. */
  const inFlightRef = useRef(0);
  const emailRef = useRef<string | undefined>(undefined);
  const tokenRef = useRef<string | null>(null);

  emailRef.current = account?.email;
  tokenRef.current = token;

  /**
   * The device's own address book, for the poll and the queue to read.
   *
   * A ref beside the state it shadows, because `pull` has to see the current
   * value and cannot take it as a dependency: the poll timer is keyed on
   * `pull`'s identity, so rebuilding it whenever an address changed would
   * restart the interval on every edit.
   */
  const localBookRef = useRef<SavedAddress[]>([]);
  localBookRef.current = mirror.addresses;

  /**
   * The per-booking grants this device holds, by booking id.
   *
   * A ref rather than mirror state: it is a set of credentials, nothing renders
   * it, and the queue needs to read the latest value from inside a callback that
   * was created before the token arrived.
   */
  const trackingRef = useRef<Record<string, string>>({});

  const rememberTracking = useCallback((bookingId: string, value: string | undefined) => {
    if (!value || trackingRef.current[bookingId] === value) return;
    trackingRef.current = { ...trackingRef.current, [bookingId]: value };
    void writeJson(STORAGE_KEYS.trackingTokens, trackingRef.current);
  }, []);

  const forgetTracking = useCallback((bookingId: string) => {
    if (!(bookingId in trackingRef.current)) return;
    const { [bookingId]: _spent, ...rest } = trackingRef.current;
    trackingRef.current = rest;
    void writeJson(STORAGE_KEYS.trackingTokens, trackingRef.current);
  }, []);

  /**
   * How this device proves it may touch one booking: the session if there is
   * one, the booking's own grant if there is not, and both when it holds both —
   * the server takes the first that works.
   */
  const bookingAuth = useCallback(
    (bookingId?: string): BookingAuth => ({
      token: tokenRef.current,
      trackingToken: bookingId ? trackingRef.current[bookingId] : undefined,
    }),
    []
  );

  // Held in refs so `send` — memoised once, with no dependencies, because the
  // drain loop must not be rebuilt mid-flight — always calls the current one.
  const bookingAuthRef = useRef(bookingAuth);
  const forgetTrackingRef = useRef(forgetTracking);
  const rememberTrackingRef = useRef(rememberTracking);
  const applyAccountRef = useRef(applyAccount);

  bookingAuthRef.current = bookingAuth;
  forgetTrackingRef.current = forgetTracking;
  rememberTrackingRef.current = rememberTracking;
  applyAccountRef.current = applyAccount;

  /** Mutate the mirror and persist the slices that changed. */
  const commit = useCallback((update: (current: Mirror) => Mirror) => {
    setMirror((current) => {
      const next = update(current);
      if (next === current) return current;

      if (next.bookings !== current.bookings) void writeJson(STORAGE_KEYS.bookings, next.bookings);
      if (next.messages !== current.messages) void writeJson(STORAGE_KEYS.messages, next.messages);
      if (next.notifications !== current.notifications) {
        void writeJson(STORAGE_KEYS.notifications, next.notifications);
      }
      if (next.transactions !== current.transactions) {
        void writeJson(STORAGE_KEYS.transactions, next.transactions);
      }
      if (next.addresses !== current.addresses) {
        void writeJson(STORAGE_KEYS.addresses, next.addresses);
      }

      return next;
    });
  }, []);

  /**
   * Retires the device's copy of the address book.
   *
   * Called when the server has accepted a book, and only then. The device copy
   * exists for a visitor with no account to put addresses on; once the account
   * holds them it is a second, older copy of the same list, and leaving it there
   * would mean `mergedBook` folding it back in on the next poll — resurrecting
   * an address the customer had since deleted on the website.
   */
  const clearLocalBook = useCallback(() => {
    commit((current) => (current.addresses.length === 0 ? current : { ...current, addresses: [] }));
  }, [commit]);

  // Read through a ref for the reason the block above gives: `send` is built
  // once, and must not be rebuilt while the drain loop is working through it.
  const clearLocalBookRef = useRef(clearLocalBook);
  clearLocalBookRef.current = clearLocalBook;

  // ------------------------------------------------------------------ queue

  const send = useCallback(async (write: PendingWrite): Promise<void> => {
    switch (write.kind) {
      case 'booking:create': {
        // Sent with the session when there is one: the server reads the
        // customer's membership off the token to decide dispatch priority and
        // to spend an included pickup. A queued booking replayed after a
        // sign-out simply goes up as a visitor's.
        const created = await api.createBooking(write.booking, tokenRef.current);

        // The grant that lets this device read the order back without an account.
        rememberTrackingRef.current(created.id, created.trackingToken);
        return;
      }
      case 'booking:patch':
        await api.updateBooking(write.id, write.patch, bookingAuthRef.current(write.id));
        return;
      case 'booking:delete':
        await api.deleteBooking(write.id, bookingAuthRef.current(write.id));
        forgetTrackingRef.current(write.id);
        return;
      case 'message:post':
        await api.postMessage(
          {
            text: write.message.text,
            orderId: write.message.orderId!,
            id: write.message.id,
          },
          bookingAuthRef.current(write.message.orderId)
        );
        return;
      case 'notification:read':
        // The feed is per-session, so there is nothing to mark without one.
        if (!tokenRef.current) return;
        await api.markNotificationRead(write.id, tokenRef.current);
        return;
      case 'order:status':
        await api.updateOrderStatus(write.id, write.patch, bookingAuthRef.current(write.id));
        return;
      case 'addresses:save': {
        // Nothing to write without a session: a signed-out visitor's book is
        // the device copy, which `saveAddress` has already kept. A write left
        // over from before a sign-out is dropped rather than replayed onto
        // whoever signed in next, like `notification:read` above.
        if (!tokenRef.current) return;

        // The book the server settled, applied over the optimistic one — it
        // decides the single default, and it is what the next poll would bring
        // back anyway.
        const saved = await api.saveAddresses(write.addresses, tokenRef.current);
        applyAccountRef.current(saved);

        // Only now, once it is on the account: a device copy dropped when the
        // write was worked out would have taken the addresses with it if the
        // write never landed.
        clearLocalBookRef.current();
        return;
      }
    }
  }, []);

  const drain = useCallback(async (): Promise<void> => {
    if (drainingRef.current || queueRef.current.length === 0) return;
    drainingRef.current = true;
    inFlightRef.current += 1;

    try {
      while (queueRef.current.length > 0) {
        const [next] = queueRef.current;
        try {
          await send(next);
        } catch (error) {
          if (isPermanentFailure(error)) {
            // The server will never accept this one — most often because the
            // order was deleted from the supervisor ledger while this write sat
            // in the queue. Retrying forever would wedge the queue and block
            // every later write from this device, so it is dropped and we carry
            // on. We are still online; this was a rejection, not a timeout.
            setOnline(true);
            queueRef.current = queueRef.current.slice(1);
            void writeJson(STORAGE_KEYS.queue, queueRef.current);
            continue;
          }

          // Server unreachable. Keep the write for the next attempt and stop —
          // order matters, so we don't skip ahead.
          setOnline(false);
          return;
        }
        queueRef.current = queueRef.current.slice(1);
        void writeJson(STORAGE_KEYS.queue, queueRef.current);
      }
      setOnline(true);
    } finally {
      drainingRef.current = false;
      inFlightRef.current -= 1;
    }
  }, [send]);

  const enqueue = useCallback(
    (write: PendingWrite) => {
      /**
       * A queued book replaces the one queued before it.
       *
       * `PUT /accounts/addresses` writes the whole array, so an earlier queued
       * save is not history — it is a strictly older copy of the same column,
       * and sending it first only to overwrite it a moment later is two
       * requests to reach one outcome. Someone who adds three addresses with no
       * signal sends one write when the signal returns.
       *
       * The head of the queue is left alone. `drain` sends `queueRef.current[0]`
       * and then drops it by position, so removing that entry underneath an
       * in-flight send would drop somebody else's write instead.
       */
      const queued =
        write.kind === 'addresses:save'
          ? queueRef.current.filter((earlier, at) => at === 0 || earlier.kind !== 'addresses:save')
          : queueRef.current;

      queueRef.current = [...queued, write];
      void writeJson(STORAGE_KEYS.queue, queueRef.current);
      void drain();
    },
    [drain]
  );

  // --------------------------------------------------------------- hydrate

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [bookings, messages, notifications, transactions, addresses, queue, tracking] =
        await Promise.all([
          readJson<Booking[]>(STORAGE_KEYS.bookings, []),
          readJson<Message[]>(STORAGE_KEYS.messages, []),
          readJson<Notification[]>(STORAGE_KEYS.notifications, []),
          readJson<PaymentTransaction[]>(STORAGE_KEYS.transactions, []),
          readJson<SavedAddress[]>(STORAGE_KEYS.addresses, []),
          readJson<PendingWrite[]>(STORAGE_KEYS.queue, []),
          readJson<Record<string, string>>(STORAGE_KEYS.trackingTokens, {}),
        ]);

      if (cancelled) return;

      // Before the first poll: the guest read path is driven entirely off these,
      // so a pull that ran without them would find nothing and clear the mirror.
      trackingRef.current = tracking;

      // The device-local membership this build replaced. Dropping it is the
      // point: the account carries the real one, and a leftover here would show
      // a plan the server will not honour.
      void remove(STORAGE_KEYS.legacyPlan);

      queueRef.current = queue;
      setMirror({
        ...EMPTY_MIRROR,
        bookings,
        messages,
        notifications,
        transactions,
        addresses,
        localIds: bookings.map((booking) => booking.id),
      });
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------------ pull

  /** Ids we already know about, readable from inside `pull` without a re-bind. */
  const mirrorIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    mirrorIdsRef.current = new Set(mirror.localIds);
  }, [mirror.localIds]);

  /**
   * The bookings a signed-out device can still see: the ones it holds a grant for.
   *
   * One request each, which is fine — this is the orders booked on this phone, so
   * it is a handful. A grant the server no longer honours is an order the desk has
   * removed or a token past its month; it is forgotten rather than re-asked every
   * four seconds forever.
   */
  const readTrackedBookings = useCallback(async (): Promise<Booking[]> => {
    const held = Object.keys(trackingRef.current);
    if (held.length === 0) return [];

    const results = await Promise.all(
      held.map((id) =>
        api.getBooking(id, { trackingToken: trackingRef.current[id] }).catch((error: unknown) => {
          if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
            forgetTracking(id);
          }
          return null;
        })
      )
    );

    return results.filter((booking): booking is Booking => booking !== null);
  }, [forgetTracking]);

  const pull = useCallback(async (): Promise<void> => {
    if (inFlightRef.current > 0) return;

    const bearer = tokenRef.current;

    try {
      /**
       * Two ways to read a board, and they no longer overlap.
       *
       * Signed in, the server scopes the list to this customer — address and
       * number both — and one request brings the lot. Signed out, there is no list
       * to scope, so each booking made on this device is read by id with the grant
       * that came back when it was created.
       *
       * The guest path used to be the same unscoped list, filtered against
       * `localIds` here. That meant a device with one pickup on it downloaded
       * every order in the ledger every four seconds to find it — and the filter
       * that hid the rest ran after they had already arrived.
       *
       * The courier roster is deliberately not fetched either way. Everything the
       * customer is allowed to know about their rider — name, vehicle, plate,
       * rating, position, ETA — already rides on `booking.rider`, and pulling the
       * staff list every four seconds to look up something already in hand is how
       * a roster leaks to every customer device.
       */
      const bookings = bearer
        ? await api.listBookings(bearer)
        : await readTrackedBookings();

      // Notifications need a session — a guest has no feed, and the desk's is not
      // theirs to read. Scoped to their own orders server-side.
      const notifications = bearer
        ? await api.listNotifications(bearer).catch(() => null)
        : null;

      if (inFlightRef.current > 0) return;

      commit((current) => {
        // The list answers without proof photographs, so anything already
        // fetched for the order screen is carried across the refresh rather
        // than blinking out every four seconds.
        const held = new Map(current.bookings.map((booking) => [booking.id, booking]));

        return {
          ...current,
          bookings: bookings.map((booking) =>
            bookingWithKnownProof(booking, held.get(booking.id))
          ),
          notifications: notifications ?? current.notifications,
          localIds: Array.from(new Set([...current.localIds, ...bookings.map((b) => b.id)])),
        };
      });

      setOnline(true);

      // The conversation and the ledger ride a second round-trip: a thread is
      // readable only by a party to its job, so there is one request per order.
      if (bookings.length > 0) {
        const threads = await Promise.all(
          bookings.map((booking) =>
            api
              .listMessages(booking.id, bookingAuth(booking.id))
              .catch(() => [] as Message[])
          )
        );
        if (inFlightRef.current > 0) return;
        commit((current) => ({ ...current, messages: threads.flat() }));
      }

      if (bearer) {
        const transactions = await api.listTransactions(bearer).catch(() => null);
        if (transactions && inFlightRef.current === 0) {
          commit((current) => ({ ...current, transactions }));
        }
      }

      // Re-reading the account is what makes a membership renew.
      //
      // There is no scheduler on the server: `/auth/me` settles the plan before
      // it answers, so the month rolling over — or the wallet running dry and
      // the plan lapsing — lands here on the next poll rather than whenever
      // somebody happens to open the plans sheet. It carries the wallet balance
      // the renewal left behind, too.
      //
      // It carries the saved address book as well, which is what makes an
      // address added on the website appear here — and, the other way round,
      // what brings back the book this device wrote a moment ago.
      if (bearer && inFlightRef.current === 0) {
        const fresh = await api.me(bearer).catch(() => null);
        if (fresh && inFlightRef.current === 0) {
          applyAccount(fresh);

          /**
           * A visitor's addresses, moved onto the account they now have.
           *
           * Here rather than in a sign-in effect because this is the first place
           * the account's real book is known: `account` is restored from storage
           * at launch, so an effect keyed on signing in could merge into a copy
           * that predates the last write from another device and hand the server
           * back a book missing whatever that device added.
           *
           * Runs on every poll while the device copy is non-empty, which is
           * harmless — `enqueue` collapses the repeats, and `send` clears the
           * copy once the write lands. `mergedBook` is what the screens are
           * already showing, so nothing here changes what the customer sees.
           */
          const promoted = mergedBook(fresh.addresses, localBookRef.current);
          if (!sameAddresses(promoted, fresh.addresses)) {
            enqueue({ kind: 'addresses:save', addresses: promoted });
          }
        }
      }
    } catch {
      // The server is down or we're offline. The mirror stands.
      setOnline(false);
    } finally {
      // Asked and answered, either way — so a negative now means something.
      setProbed(true);
    }
  }, [commit, applyAccount, enqueue]);

  useEffect(() => {
    if (!hydrated) return;

    void drain();
    void pull();

    const timer = setInterval(() => {
      void drain();
      void pull();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [hydrated, drain, pull]);

  // Signing in or out changes which jobs are ours, so re-pull immediately
  // rather than waiting out the poll interval.
  useEffect(() => {
    if (hydrated) void pull();
  }, [isAuthenticated, account?.email, hydrated, pull]);

  // --------------------------------------------------------------- actions

  const createBooking = useCallback<ClientState['createBooking']>(
    async (booking) => {
      const withId: Booking = { ...booking, id: booking.id || newJobId() };

      commit((current) => ({
        ...current,
        bookings: [withId, ...current.bookings.filter((b) => b.id !== withId.id)],
        localIds: Array.from(new Set([withId.id, ...current.localIds])),
      }));

      enqueue({ kind: 'booking:create', booking: withId });
      return withId;
    },
    [commit, enqueue]
  );

  /**
   * Pays a booking's bill, and waits for the answer.
   *
   * Deliberately not queued, unlike `createBooking` above. A booking is worth
   * showing optimistically — it is real the moment it is made and reaches the
   * server a round trip later — but a payment must not be applied twice or applied
   * late from a stale figure, and "did that go through" is a question somebody is
   * standing there asking. It throws, and the caller says so.
   *
   * The queue is drained first because there is nothing to settle until the
   * booking is actually on the server.
   *
   * The amount is not a parameter. This screen used to call `chargeWallet(total)`
   * with its own arithmetic and then declare the booking `Paid`; the server prices
   * the job itself now, and takes what the job says is owed.
   */
  const payForBooking = useCallback<ClientState['payForBooking']>(
    async (id, method, reference) => {
      await drain();

      const settled = await api.payForBooking(
        id,
        { method, reference },
        bookingAuthRef.current(id)
      );

      commit((current) => ({
        ...current,
        bookings: current.bookings.map((booking) => (booking.id === id ? settled : booking)),
      }));

      // A wallet payment moved the balance and earned points, so the account this
      // device is holding is a version behind.
      if (method === 'Wallet' && tokenRef.current) {
        const fresh = await api.me(tokenRef.current).catch(() => null);
        if (fresh) applyAccount(fresh);
      }

      return settled;
    },
    [drain, commit, applyAccount]
  );

  const patchBooking = useCallback<ClientState['patchBooking']>(
    (id, patch) => {
      commit((current) => ({
        ...current,
        bookings: current.bookings.map((booking) =>
          booking.id === id ? { ...booking, ...patch } : booking
        ),
      }));
      enqueue({ kind: 'booking:patch', id, patch });
    },
    [commit, enqueue]
  );

  /**
   * Cancelling keeps the record. The website's admin dashboard and the
   * customer's own history both need to see that an order existed and was
   * called off, which a delete would erase.
   *
   * `POST /bookings/:id/cancel`, not a patch. This used to be
   * `patchBooking(id, { status: 'Cancelled' })`, and `status` is on the patch
   * route's supervisor-only list — so the write went up, the field was dropped
   * on the way in, and the mirror written here was the only place the
   * cancellation existed. The next poll replaced the mirror and the order came
   * back to the stage it had never left.
   *
   * Awaited rather than queued for the reason `payForBooking` is. The server can
   * refuse this — a courier who already has the bags is past the point where the
   * customer can stand them down — and a refusal that vanished into a background
   * queue is the same silence in a different place.
   */
  const cancelBooking = useCallback<ClientState['cancelBooking']>(
    async (id) => {
      // Drained first, like `rescheduleBooking`: an order made offline has to
      // exist on the server before it can be called off on it.
      await drain();
      const cancelled = await api.cancelBooking(id, bookingAuthRef.current(id));

      commit((current) => ({
        ...current,
        bookings: current.bookings.map((booking) => (booking.id === id ? cancelled : booking)),
      }));

      return cancelled;
    },
    [drain, commit]
  );

  const sendMessage = useCallback<ClientState['sendMessage']>(
    (orderId, text) => {
      const message: Message = {
        id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        sender: 'customer',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        orderId,
      };

      commit((current) => ({ ...current, messages: [...current.messages, message] }));
      enqueue({ kind: 'message:post', message });
    },
    [commit, enqueue]
  );

  const markNotificationRead = useCallback<ClientState['markNotificationRead']>(
    (id) => {
      commit((current) => ({
        ...current,
        notifications: current.notifications.map((notification) =>
          notification.id === id ? { ...notification, read: true } : notification
        ),
      }));
      enqueue({ kind: 'notification:read', id });
    },
    [commit, enqueue]
  );

  /**
   * Clears the badge for the alerts the customer can see.
   *
   * Kinds they have switched off are left unread on purpose: "mark all read"
   * answers for what was on screen, and a silenced kind switched back on should
   * still be able to say something arrived.
   */
  const markAllNotificationsRead = useCallback(() => {
    const unread = mirror.notifications.filter(
      (notification) => !notification.read && allowsAlert(notification.type)
    );
    commit((current) => ({
      ...current,
      notifications: current.notifications.map((notification) =>
        allowsAlert(notification.type) ? { ...notification, read: true } : notification
      ),
    }));
    for (const notification of unread) enqueue({ kind: 'notification:read', id: notification.id });
  }, [mirror.notifications, allowsAlert, commit, enqueue]);

  /**
   * The customer's own pass over the bag manifest.
   *
   * Deliberately not a dispatch write: the rider owns `bags` on the job record,
   * and two surfaces writing the same field would race. What the customer's
   * scan produces is a note in the shared conversation — visible to the rider
   * and to dispatch — plus a local record of which codes they checked.
   */
  const verifyBags = useCallback<ClientState['verifyBags']>(
    (orderId, bags) => {
      const scanned = bags.filter((bag) => bag.scanned);

      commit((current) => ({
        ...current,
        verifiedBags: { ...current.verifiedBags, [orderId]: scanned.map((bag) => bag.qrCode) },
      }));

      sendMessage(
        orderId,
        `Bag manifest verified on my side: ${scanned.map((bag) => bag.qrCode).join(', ')} (${scanned.length}/${bags.length}).`
      );
    },
    [commit, sendMessage]
  );

  const confirmDelivery = useCallback<ClientState['confirmDelivery']>(
    async (orderId, signature, code) => {
      // This order's own code, not a constant every order in the system
      // shares. The server checks it again on the way through.
      const booking = mirror.bookings.find((candidate) => candidate.id === orderId);
      if (!booking?.deliveryOtp || code.trim() !== booking.deliveryOtp) return false;

      // The signature is the customer's to give, so this transition is theirs
      // to make. `applyStatus` on the server stamps it as the delivery proof
      // and narrates the completion into the conversation.
      commit((current) => ({
        ...current,
        bookings: current.bookings.map((entry) =>
          entry.id === orderId ? { ...entry, status: 'Delivered' } : entry
        ),
      }));

      enqueue({
        kind: 'order:status',
        id: orderId,
        patch: { status: 'delivered', signature, deliveryCode: code.trim() },
      });
      return true;
    },
    [commit, enqueue, mirror.bookings]
  );

  const rateBooking = useCallback<ClientState['rateBooking']>(
    async (id, stars) => {
      // Drained first, like `payForBooking`: an order created offline has to
      // exist on the server before anything can be attached to it.
      await drain();
      await api.rateBooking(id, { stars }, bookingAuthRef.current(id));
    },
    [drain]
  );

  /**
   * The claims this customer has raised.
   *
   * Held outside the booking mirror rather than folded onto each booking. A
   * claim outlives the order it is about — it can still be open a fortnight
   * after delivery — and the mirror is pruned and replaced wholesale on every
   * pull, which would take the claims with it.
   *
   * Not queued and not written offline: a claim is only ever created by the
   * server, and a list that invented rows would show a customer a complaint
   * nobody had received.
   */
  const [claims, setClaims] = useState<Claim[]>([]);

  /**
   * Standing orders and the referral code.
   *
   * Both held outside the booking mirror and neither queued offline. A standing
   * order is a scheduling instruction the server acts on — writing one locally
   * and syncing later would mean a customer believing they had a weekly pickup
   * that nothing was going to book — and a referral code is minted by the
   * server, so a locally invented one would name nobody.
   */
  const [recurring, setRecurring] = useState<RecurringPickup[]>([]);
  const [referral, setReferral] = useState<ClientState['referral']>(null);

  const loadRecurring = useCallback<ClientState['loadRecurring']>(async () => {
    const token = tokenRef.current;
    if (!token) {
      setRecurring([]);
      return;
    }

    try {
      setRecurring(await api.listRecurring(token));
    } catch {
      // Best effort, like the claims below: this screen is worth showing with
      // what it already has rather than failing whole.
    }
  }, []);

  const saveRecurring = useCallback<ClientState['saveRecurring']>(
    async (id, pickup) => {
      const token = tokenRef.current;
      if (!token) throw new Error('Sign in to set up a standing order.');

      await api.saveRecurring(id, pickup, token);
      await loadRecurring();
    },
    [loadRecurring]
  );

  const deleteRecurring = useCallback<ClientState['deleteRecurring']>(
    async (id) => {
      const token = tokenRef.current;
      if (!token) return;

      await api.deleteRecurring(id, token);
      await loadRecurring();
    },
    [loadRecurring]
  );

  const loadReferral = useCallback<ClientState['loadReferral']>(async () => {
    const token = tokenRef.current;
    if (!token) {
      setReferral(null);
      return;
    }

    try {
      setReferral(await api.myReferral(token));
    } catch {
      // The code is minted on this call, so a failure means they simply do not
      // have one yet — which the screen renders as "not available", not as an
      // error.
    }
  }, []);

  const claimReferral = useCallback<ClientState['claimReferral']>(
    async (code) => {
      const token = tokenRef.current;
      if (!token) throw new Error('Sign in to use a referral code.');

      await api.claimReferral(code, token);
      await loadReferral();
    },
    [loadReferral]
  );

  const loadClaims = useCallback<ClientState['loadClaims']>(async () => {
    const token = tokenRef.current;
    if (!token) {
      // A guest holding only a tracking token has no cross-order view to load;
      // their claims are read per-order by whoever can read the order.
      setClaims([]);
      return;
    }

    try {
      setClaims(await api.myClaims(token));
    } catch {
      // Best effort. The order screen shows the reports it knows about and says
      // nothing about the ones it could not fetch, which is better than an
      // error on a screen the customer opened to track a courier.
    }
  }, []);

  const rescheduleBooking = useCallback<ClientState['rescheduleBooking']>(
    async (id, change) => {
      // Drained first, like `rateBooking`: a booking made offline has to exist
      // on the server before it can be moved on it.
      await drain();
      const moved = await api.rescheduleBooking(id, change, bookingAuthRef.current(id));

      // The server's answer, not the request: it derives the return date from
      // the new collection and may have kept a return window the request did
      // not mention, so the record it sends back is the only accurate one.
      commit((current) => ({
        ...current,
        bookings: current.bookings.map((booking) => (booking.id === id ? moved : booking)),
      }));
    },
    [drain, commit]
  );

  const reportIssue = useCallback<ClientState['reportIssue']>(
    (orderId, note, photoUri, kind) => {
      sendMessage(orderId, photoUri ? `${note}\n\nPhoto attached: ${photoUri}` : note);

      /**
       * And a claim beside it, so the report has somewhere to end up.
       *
       * Fired without awaiting, and its failure swallowed on purpose. The
       * message above has already reached the desk, and a customer who has just
       * photographed a ruined shirt should not be shown an error because their
       * order fell outside a fortnight — the thread still works, and the desk
       * can still act on it.
       */
      void (async () => {
        try {
          await drain();
          await api.raiseClaim(
            orderId,
            { kind: kind ?? 'other', description: note, photo: photoUri },
            bookingAuthRef.current(orderId)
          );
          await loadClaims();
        } catch {
          // Deliberately silent: this is the customer's screen, and the thing
          // they actually asked for has happened.
        }
      })();

      // The photo is also attached to the job itself, so it sits beside the
      // rider's own proof shots rather than only in the chat log. The dispatch
      // route needs a status to attach to, and the only safe one to name is the
      // status the job is *already* in — naming any other would rewind or
      // fast-forward the rider's progress. Without live telemetry we don't know
      // it, so the photo stays in the conversation alone.
      const live = mirror.bookings.find((booking) => booking.id === orderId)?.rider?.jobStatus;
      if (photoUri && live && !isTerminal(live)) {
        enqueue({ kind: 'order:status', id: orderId, patch: { status: live, photo: photoUri } });
      }
    },
    [sendMessage, enqueue, mirror.bookings, drain, loadClaims]
  );

  // ---------------------------------------------------------------- wallet

  const walletBalance = account?.walletBalance ?? 0;
  const points = account?.points ?? 0;

  /**
   * Files the row a wallet movement produced into the local statement.
   *
   * The server wrote it already — this only saves the wallet tab waiting out a
   * poll to show what just happened.
   */
  const mergeTransaction = useCallback(
    (transaction: PaymentTransaction | null) => {
      if (!transaction) return;
      commit((current) => ({
        ...current,
        transactions: [
          transaction,
          ...current.transactions.filter((t) => t.reference !== transaction.reference),
        ],
      }));
    },
    [commit]
  );

  /**
   * Money and points move on the server, in one transaction with their ledger
   * entry.
   *
   * This used to be local arithmetic followed by a queued `account:upsert`
   * carrying an absolute balance — which meant a membership renewal the server
   * had just debited was silently restored by the next write from this device,
   * and that the app and the website each awarded loyalty points by their own
   * rules. `/api/accounts/wallet` decides both now, and hands back the account
   * to apply.
   *
   * Nothing here is queued for offline replay, for the reason `subscribeToPlan`
   * is not: a balance applied late, from a number that was already stale when
   * it was computed, is worse than a movement that failed and was retried.
   */
  const topUpWallet = useCallback<ClientState['topUpWallet']>(
    async (method, reference) => {
      const bearer = tokenRef.current;
      if (!bearer) return;

      const result = await api.topUpWallet({ method, reference }, bearer);
      applyAccount(result.account);
      mergeTransaction(result.transaction);
    },
    [applyAccount, mergeTransaction]
  );

  const chargeWallet = useCallback<ClientState['chargeWallet']>(
    async (amount, description, bookingId) => {
      const bearer = tokenRef.current;
      if (!bearer) return false;

      try {
        // One point per whole cedi is awarded server-side, by the same rule the
        // website's portal now goes through — see `pointsForSpend` in core.
        const result = await api.chargeWallet(
          { amount, description, bookingId },
          bearer
        );
        applyAccount(result.account);
        mergeTransaction(result.transaction);
        return true;
      } catch {
        // Not enough in the wallet, or the server is unreachable. Either way
        // the charge did not happen and the caller offers another method.
        return false;
      }
    },
    [applyAccount, mergeTransaction]
  );

  /** Spends care points on a reward from the shared catalogue. */
  const redeemReward = useCallback<ClientState['redeemReward']>(
    async (rewardId) => {
      const bearer = tokenRef.current;
      if (!bearer) {
        return { ok: false, reason: 'signed-out', message: 'Sign in to redeem a reward.' };
      }

      try {
        const result = await api.redeemReward({ rewardId }, bearer);
        applyAccount(result.account);
        mergeTransaction(result.transaction);
        return { ok: true };
      } catch (error) {
        if (error instanceof ApiError) {
          const body = error.body as { reason?: string; shortfall?: number } | undefined;
          return {
            ok: false,
            reason: body?.reason === 'insufficient-points' ? 'insufficient-points' : 'rejected',
            shortfall: body?.shortfall,
            message: error.message,
          };
        }
        return { ok: false, reason: 'offline', message: unreachableMessage(error) };
      }
    },
    [applyAccount, mergeTransaction]
  );

  // ----------------------------------------------------------- membership

  const plan = account?.plan ?? null;

  const includedPickupsLeft = useMemo(() => {
    const definition = membershipPlan(plan?.planId);
    if (!plan || !definition) return 0;
    return Math.max(0, definition.includedPickups - (plan.pickupsUsed ?? 0));
  }, [plan]);

  const planEndsOn = plan?.cancelAtPeriodEnd ? plan.renewsOn : null;

  /**
   * Subscribing is a server call, not a local write.
   *
   * The old path charged the wallet from the app and then wrote the plan to
   * this device — which meant one payment produced two ledger entries, awarded
   * loyalty points for buying a membership, and left the entitlement somewhere
   * the server could not see. All of that moves behind `/api/accounts/plan`,
   * which does the debit, the ledger and the plan as one transaction and hands
   * back the account it produced.
   *
   * There is deliberately no offline queueing here: a membership taken now and
   * priced whenever the connection returns is a bill the customer did not agree
   * to. It fails, and they retry.
   */
  const subscribeToPlan = useCallback<ClientState['subscribeToPlan']>(
    async (planId) => {
      if (!token) {
        return { ok: false, reason: 'signed-out', message: 'Sign in to start a membership.' };
      }

      try {
        const result = await api.subscribeToPlan(planId, token);
        applyAccount(result.account);

        // The debit and its ledger row were written server-side; pull the
        // statement so the wallet tab shows them without waiting for a poll.
        // Scoped by the token, so it is this customer's by construction.
        void api
          .listTransactions(token)
          .then((transactions) => commit((current) => ({ ...current, transactions })))
          .catch(() => {});

        return { ok: true, charged: result.charged, credit: result.credit };
      } catch (error) {
        if (error instanceof ApiError) {
          const body = error.body as { reason?: string; shortfall?: number } | undefined;
          if (body?.reason === 'insufficient-funds') {
            return {
              ok: false,
              reason: 'insufficient-funds',
              shortfall: body.shortfall,
              message: error.message,
            };
          }
          return { ok: false, reason: 'rejected', message: error.message };
        }
        return { ok: false, reason: 'offline', message: unreachableMessage(error) };
      }
    },
    [token, applyAccount, commit]
  );

  /**
   * Cancels at the end of the period already paid for.
   *
   * Nothing is refunded and nothing stops today — which is what the plans
   * screen has always promised, and what the old immediate delete contradicted.
   */
  const cancelPlan = useCallback<ClientState['cancelPlan']>(async () => {
    if (!token) return null;

    try {
      const result = await api.cancelPlan(token);
      applyAccount(result.account);
      return result.activeUntil;
    } catch {
      return null;
    }
  }, [token, applyAccount]);

  const resumePlan = useCallback<ClientState['resumePlan']>(async () => {
    if (!token) return false;

    try {
      const result = await api.resumePlan(token);
      applyAccount(result.account);
      return true;
    } catch {
      return false;
    }
  }, [token, applyAccount]);

  // ---------------------------------------------------------------- profile

  const saveProfile = useCallback<ClientState['saveProfile']>(
    async (patch) => {
      if (!token || !account) throw new Error('Sign in to change your details.');

      // `PUT /api/accounts` takes the whole record and writes the three fields
      // it allows, so the current account is the base — sending only the patch
      // would blank the rest.
      const saved = await api.upsertAccount({ ...account, ...patch }, token);
      applyAccount(saved);
    },
    [token, account, applyAccount]
  );

  // -------------------------------------------------------------- addresses

  /**
   * The book the screens read, whoever is looking.
   *
   * Signed in, it is the account's — the same array the website's patron portal
   * shows, arriving on the `/auth/me` poll — with anything still sitting in this
   * device's copy folded in, so a guest who registers does not watch their
   * addresses vanish while the promoting write is in flight.
   *
   * Signed out, it is the device's copy and nothing else. A visitor with no
   * account has nowhere else for it to live, and the settings screen is usable
   * signed out precisely so they can keep one.
   */
  const addresses = useMemo(
    () => (account ? mergedBook(account.addresses, mirror.addresses) : mirror.addresses),
    [account, mirror.addresses]
  );

  /**
   * Saves an address, or edits the one it shares an id with.
   *
   * Optimistic on the account rather than through `commit` when there is a
   * session, because the account is where the book is read from then — the
   * server's answer arrives on the queue a moment later and replaces it. Still
   * synchronous: the callers are toggles and sheet buttons, and a book of a
   * dozen entries is not something to put a spinner on.
   *
   * Does nothing when the book is full and this would be a new entry. Every
   * caller checks `MAX_SAVED_ADDRESSES` first and says so, which is a better
   * answer than a Save button that silently declines.
   */
  const saveAddress = useCallback<ClientState['saveAddress']>(
    (address) => {
      const next = withAddress(addresses, address);
      if (sameAddresses(next, addresses)) return;

      if (!account) {
        commit((current) => ({ ...current, addresses: next }));
        return;
      }

      applyAccount({ ...account, addresses: next });
      /**
       * And in the device copy, if that is where this entry still lives.
       *
       * The copy is not cleared until the server has taken the book, and
       * `mergedBook` folds it back over the account's on every render — so
       * editing an address the server has not seen yet wrote the change onto the
       * account and then had the older copy of it laid straight back on top. The
       * sheet closed and the room number was unchanged, with nothing on screen
       * saying why.
       *
       * Only entries already in the copy are touched. Putting a new one there
       * would add an address the server is not missing to the list of addresses
       * the server is missing, and that list is the only reason the copy exists.
       */
      commit((current) =>
        current.addresses.some((saved) => saved.id === address.id)
          ? { ...current, addresses: withAddress(current.addresses, address) }
          : current
      );
      enqueue({ kind: 'addresses:save', addresses: next });
    },
    [account, addresses, applyAccount, commit, enqueue]
  );

  /** Deletes an address. The default passes to whatever is left. */
  const removeAddress = useCallback<ClientState['removeAddress']>(
    (id) => {
      const next = withoutAddress(addresses, id);
      if (sameAddresses(next, addresses)) return;

      if (!account) {
        commit((current) => ({ ...current, addresses: next }));
        return;
      }

      applyAccount({ ...account, addresses: next });
      // Out of the device copy as well, for the reason `saveAddress` gives just
      // above: a copy still holding it has `mergedBook` put it straight back,
      // and the bin then looks like it did nothing at all.
      commit((current) =>
        current.addresses.some((saved) => saved.id === id)
          ? { ...current, addresses: withoutAddress(current.addresses, id) }
          : current
      );
      enqueue({ kind: 'addresses:save', addresses: next });
    },
    [account, addresses, applyAccount, commit, enqueue]
  );

  // ------------------------------------------------------- leaving for good

  const forgetLocalData = useCallback<ClientState['forgetLocalData']>(async () => {
    // The queue first, and by assignment rather than by draining: a pending
    // write replayed against a deleted account is a request that can only fail,
    // and `send` reads this ref rather than a captured copy, so emptying it here
    // stops a drain already in progress from finding anything more to send.
    queueRef.current = [];
    trackingRef.current = {};

    // `setMirror`, not `commit` — commit's whole job is to persist what changed,
    // which is the opposite of what is wanted here. The keys go in one call
    // below instead.
    setMirror(EMPTY_MIRROR);

    await remove(
      STORAGE_KEYS.bookings,
      STORAGE_KEYS.messages,
      STORAGE_KEYS.notifications,
      STORAGE_KEYS.transactions,
      STORAGE_KEYS.addresses,
      STORAGE_KEYS.queue,
      STORAGE_KEYS.trackingTokens
    );
  }, []);

  // -------------------------------------------------------------- selectors

  const activeBookings = useMemo(
    () =>
      mirror.bookings
        .filter((booking) => booking.status !== 'Delivered' && booking.status !== 'Cancelled')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [mirror.bookings]
  );

  const pastBookings = useMemo(
    () =>
      mirror.bookings
        .filter((booking) => booking.status === 'Delivered' || booking.status === 'Cancelled')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [mirror.bookings]
  );

  /**
   * The booking the app leads with: the one furthest along that is still
   * running, because that is the one about to need the customer's attention.
   */
  const primaryBooking = useMemo(() => {
    if (activeBookings.length === 0) return null;
    return [...activeBookings].sort(
      (a, b) => bookingProgressPercent(b.status) - bookingProgressPercent(a.status)
    )[0];
  }, [activeBookings]);

  /**
   * The alerts the customer actually wants, newest kept in place.
   *
   * Filtered here rather than at the point of display so the feed and the bell
   * badge cannot disagree, and filtered rather than deleted so switching a kind
   * back on brings its history with it — the records stay in the mirror and on
   * the server either way.
   */
  const notifications = useMemo(
    () => mirror.notifications.filter((notification) => allowsAlert(notification.type)),
    [mirror.notifications, allowsAlert]
  );

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications]
  );

  const defaultAddress = useMemo(() => firstAddress(addresses), [addresses]);

  const bookingById = useCallback(
    (id: string) => mirror.bookings.find((booking) => booking.id === id),
    [mirror.bookings]
  );

  /**
   * Pulls one order's proof-of-service into the mirror.
   *
   * Failure is silent on purpose: this runs when an order screen opens, often
   * on a phone that has just gone through a tunnel, and the screen it serves
   * renders perfectly well without the photographs. The next call gets them.
   */
  const loadBookingProof = useCallback(async (id: string) => {
    try {
      const full = await api.getBooking(id, bookingAuth(id));
      commit((current) => ({
        ...current,
        bookings: current.bookings.map((booking) =>
          booking.id === id ? bookingWithKnownProof(booking, full) : booking
        ),
      }));
    } catch {
      // Offline, or the order is gone. The poll will say which.
    }
    // Both are stable — `commit` and `bookingAuth` are memoised with no
    // dependencies of their own and read through refs.
  }, [bookingAuth, commit]);

  const messagesFor = useCallback(
    (orderId: string) => mirror.messages.filter((message) => message.orderId === orderId),
    [mirror.messages]
  );

  const refresh = useCallback(async () => {
    await drain();
    await pull();
  }, [drain, pull]);

  const value = useMemo<ClientState>(
    () => ({
      ...mirror,
      // After the spread: the filtered feed, not the stored one.
      notifications,
      // After the spread too: the account's book when there is a session, not
      // this device's copy of it.
      addresses,
      hydrated,
      online,
      probed,
      activeBookings,
      pastBookings,
      primaryBooking,
      unreadCount,
      walletBalance,
      points,
      plan,
      includedPickupsLeft,
      planEndsOn,
      createBooking,
      payForBooking,
      patchBooking,
      cancelBooking,
      rateBooking,
      rescheduleBooking,
      claims,
      loadClaims,
      recurring,
      loadRecurring,
      saveRecurring,
      deleteRecurring,
      referral,
      loadReferral,
      claimReferral,
      bookingById,
      loadBookingProof,
      messagesFor,
      sendMessage,
      markNotificationRead,
      markAllNotificationsRead,
      verifyBags,
      confirmDelivery,
      reportIssue,
      topUpWallet,
      chargeWallet,
      redeemReward,
      subscribeToPlan,
      cancelPlan,
      resumePlan,
      saveProfile,
      saveAddress,
      removeAddress,
      defaultAddress,
      forgetLocalData,
      refresh,
    }),
    [
      mirror,
      notifications,
      addresses,
      hydrated,
      online,
      probed,
      activeBookings,
      pastBookings,
      primaryBooking,
      unreadCount,
      walletBalance,
      points,
      plan,
      includedPickupsLeft,
      planEndsOn,
      createBooking,
      payForBooking,
      patchBooking,
      cancelBooking,
      rateBooking,
      rescheduleBooking,
      claims,
      loadClaims,
      recurring,
      loadRecurring,
      saveRecurring,
      deleteRecurring,
      referral,
      loadReferral,
      claimReferral,
      bookingById,
      loadBookingProof,
      messagesFor,
      sendMessage,
      markNotificationRead,
      markAllNotificationsRead,
      verifyBags,
      confirmDelivery,
      reportIssue,
      topUpWallet,
      chargeWallet,
      redeemReward,
      subscribeToPlan,
      cancelPlan,
      resumePlan,
      saveProfile,
      saveAddress,
      removeAddress,
      defaultAddress,
      forgetLocalData,
      refresh,
    ]
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient(): ClientState {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient must be used inside <ClientProvider>');
  return ctx;
}

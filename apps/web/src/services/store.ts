/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApiError,
  COLD_START_TIMEOUT_MS,
  createClient,
  isUnreachable,
  samePhone,
  type AuthSession,
  type Booking,
  type BookingAuth,
  type Message,
  type PaymentTransaction,
  type SavedAddress,
  type SupervisorProfile,
  type UserAccount,
} from '@freshfold/core';

/**
 * The website's data layer.
 *
 * The dispatch server owns the ledger; this module is the browser's view of
 * it. Three things make that workable without rewriting every screen:
 *
 *  1. **Reads are synchronous.** An in-memory mirror is hydrated from
 *     `localStorage` before React ever renders, so `readBookings()` returns an
 *     array immediately — exactly like the `JSON.parse(localStorage.getItem(…))`
 *     calls it replaced.
 *  2. **Writes are write-through.** They land in the mirror and in
 *     `localStorage` synchronously, then go to the server in the background.
 *     A failed request is queued, not lost.
 *  3. **The server pushes back by polling.** Anything a rider changes on the
 *     road — a status transition, a live position — arrives here within a few
 *     seconds and notifies subscribers.
 *
 * Offline, everything still works against the local mirror; the app degrades
 * to exactly the behaviour it had before there was a server.
 */

const KEYS = {
  bookings: 'freshfold_bookings',
  accounts: 'freshfold_accounts',
  messages: 'freshfold_messages',
  currentUser: 'freshfold_current_user',
  authToken: 'freshfold_auth_token',
  adminToken: 'freshfold_admin_token',
  adminSupervisor: 'freshfold_admin_supervisor',
  queue: 'freshfold_pending_writes',
  localIds: 'freshfold_local_booking_ids',
  trackingTokens: 'freshfold_tracking_tokens',
} as const;

const POLL_INTERVAL_MS = 5000;

/**
 * Same-origin: Vite proxies `/api` to the dispatch server in dev, and in
 * production Vercel rewrites it to the Render service — see `vercel.json` —
 * or the server serves this bundle itself, where it is deployed that way.
 *
 * The cold-start budget has to be asked for by name here, where neither app
 * has to. `createClient` works out on its own whether a host can sleep by
 * reading its hostname, and an empty base has no hostname to read: what sits on
 * the other end of `/api` is a rewrite rule this bundle cannot see. In a
 * production build it is the Render service, which sleeps after fifteen idle
 * minutes and takes about fifty seconds to wake — so a customer opening the
 * site cold was told it was unreachable while it was still starting up.
 *
 * Dev opts out rather than inheriting the minute. There `/api` is a Vite proxy
 * to localhost, which cannot sleep, and the only thing a long budget would buy
 * is a dev server that is simply not running taking a minute to say so.
 */
export const api = createClient({
  baseUrl: '',
  coldStartMs: import.meta.env.DEV ? 0 : COLD_START_TIMEOUT_MS,
});

type Listener = () => void;

interface Mirror {
  bookings: Booking[];
  accounts: UserAccount[];
  messages: Message[];
  /** The signed-in customer, refreshed from `/auth/me` on every poll. */
  currentUser: UserAccount | null;
  /**
   * Ids booked from *this* browser.
   *
   * `bookings` above is the whole ledger — the supervisor dashboard needs it,
   * so the poll fetches it unscoped. That makes it the wrong thing to ask "does
   * the person looking at this page have an order on the go", because the
   * answer was always yes for whoever booked last, anywhere. This is the same
   * device-local list the customer app keeps (`localIds` in its ClientStore)
   * and it is what a signed-out visitor is entitled to see.
   */
  localIds: string[];
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — the mirror is still authoritative
    // for this session, so carry on rather than breaking the page.
  }
}

const mirror: Mirror = {
  bookings: readLocal<Booking[]>(KEYS.bookings, []),
  accounts: readLocal<UserAccount[]>(KEYS.accounts, []),
  messages: readLocal<Message[]>(KEYS.messages, []),
  currentUser: readLocal<UserAccount | null>(KEYS.currentUser, null),
  localIds: readLocal<string[]>(KEYS.localIds, []),
};

/**
 * The audit trail used to hydrate here, and no longer does.
 *
 * This file owned it: an `AuditLog[]` in the mirror above, written by
 * `AdminDashboard` from whichever browser performed the action, capped at fifty
 * by an array `slice`, and described in this very file as "never leaves the
 * browser". Which meant the record of every payment override, points grant and
 * deletion was visible only to the machine that made it, gone when somebody
 * cleared site data, and — being one client's note about that client's own
 * claim — evidence of nothing.
 *
 * `audit_events` on the server replaces it. Each entry is written by the route
 * that performs the action, in the same transaction, and read back through
 * `api.listAuditEvents(token)` by any desk that asks.
 *
 * The old key is removed rather than left alone: a browser that ran an earlier
 * build still holds a private copy of a record we now say lives on the server,
 * and two answers to that question is worse than one.
 *
 * Guarded like `readLocal` and `writeLocal` are, and for the same reason — this
 * runs at import, and storage that throws on access would take the whole page
 * with it rather than one stale key.
 */
try {
  localStorage.removeItem('freshfold_audit_logs');
} catch {
  // Storage disabled. Nothing reads that key any more either way.
}

const listeners = new Set<Listener>();
let online = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * How many attempts in a row have to fail before this browser calls itself
 * offline.
 *
 * One is too few, and that is not a theoretical worry: this site is used over
 * Kumasi mobile data, where a single request stalling past its budget is an
 * ordinary event on a working connection. The desk's poll is three requests at
 * once, so it only takes the slowest of the three. Flipping on the first miss
 * put "No connection" over a board that was about to refresh perfectly well,
 * and the strip went back to being something people learn to ignore.
 *
 * Two, rather than more, because the other error is just as real: a supervisor
 * confirming a wash against a server that is genuinely gone needs to know
 * before they have confirmed six of them. At a five-second poll that is about
 * ten seconds to be sure, and a connection this browser knows is down — see
 * `navigator.onLine` in {@link connectionState} — does not wait at all.
 */
const OFFLINE_AFTER_MISSES = 2;

/** Consecutive failed attempts. Reset by anything that reaches the server. */
let misses = 0;

/**
 * Whether any attempt has produced an outcome yet, either way.
 *
 * The flag `online` cannot express this. It starts `false`, which reads as
 * "offline" but means "nobody has asked yet", and everything rendering it
 * treated the two the same — so every visitor was told the connection was gone
 * for as long as the first request took, which on a slow link is longer than it
 * sounds. {@link connectionState} keeps them apart.
 */
let settled = false;

/**
 * Whether the last failure came from the gateway rather than from the network.
 *
 * A 502/503/504 is Render's router saying the process behind it did not answer
 * — which on the free plan is nearly always a service waking from its
 * fifteen-minute sleep, taking about fifty seconds about it. That is worth
 * different words from a dead connection: it is going to fix itself, and the
 * one useful instruction is to wait rather than to go looking for signal.
 */
let wakingUp = false;

/**
 * What this browser currently believes about the connection.
 *
 * Three answers, because "not known yet" is a real state and rendering it as
 * "offline" is what made the strip lie.
 */
export function connectionState(): 'unknown' | 'online' | 'offline' | 'waking' {
  // The browser knows about its own interface before any request can find out.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (!settled) return 'unknown';
  if (misses < OFFLINE_AFTER_MISSES) return 'online';
  return wakingUp ? 'waking' : 'offline';
}

/**
 * Record that the server answered — with anything at all.
 *
 * A refusal counts. `isUnreachable` already draws that line; by the time either
 * of these is called the decision has been made.
 */
function markReachable(): void {
  misses = 0;
  wakingUp = false;
  online = true;
  settled = true;
}

/** Record that an attempt got no answer. Only sustained silence means offline. */
function markMissed(gateway: boolean): void {
  misses += 1;
  wakingUp = gateway;
  settled = true;
  if (misses >= OFFLINE_AFTER_MISSES) online = false;
}

/**
 * Set when the desk’s token is refused rather than merely unanswered.
 *
 * The desk session lasts twelve hours and `App` re-validates it only when the
 * admin route is entered, so a board left open across that boundary polls a
 * dead token indefinitely. `pull` cannot navigate, and reaching for the router
 * from the data layer would put a UI concern in the one module that has none —
 * so it records the fact and notifies, and `App` reads it off the subscription
 * that already feeds every other screen.
 */
let adminSessionExpired = false;

/** Whether the desk’s session was ended by the server rather than by its user. */
export function isAdminSessionExpired(): boolean {
  return adminSessionExpired;
}

// ---------------------------------------------------------------------------
// Tracking grants
// ---------------------------------------------------------------------------

/**
 * The per-booking tokens this browser holds, by booking id.
 *
 * A visitor books without an account, so a session is not what entitles them to
 * read the order back — this is. The server hands one over with the 201 and it is
 * the only claim a guest has on their own pickup until they set a password from
 * the emailed link.
 *
 * Kept alongside `localIds` rather than inside the mirror: it is a credential,
 * not display state, and nothing renders it.
 */
let trackingTokens: Record<string, string> = readLocal<Record<string, string>>(
  KEYS.trackingTokens,
  {}
);

function rememberTracking(bookingId: string, token: string | undefined): void {
  if (!token || trackingTokens[bookingId] === token) return;
  trackingTokens = { ...trackingTokens, [bookingId]: token };
  writeLocal(KEYS.trackingTokens, trackingTokens);
}

function forgetTracking(bookingId: string): void {
  if (!(bookingId in trackingTokens)) return;
  const { [bookingId]: _spent, ...rest } = trackingTokens;
  trackingTokens = rest;
  writeLocal(KEYS.trackingTokens, trackingTokens);
}

/**
 * How this browser proves it may touch one booking.
 *
 * Both grants when it holds both: the desk's token reads anything, a customer's
 * reads their own, and the tracking token covers the case neither does — a guest,
 * or a customer who booked before signing in. The server takes the first that
 * works.
 */
function bookingAuth(bookingId?: string): BookingAuth {
  return {
    token: readAdminToken() ?? readAuthToken(),
    trackingToken: bookingId ? trackingTokens[bookingId] : undefined,
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to any change — local write or server poll. Returns an unsubscribe. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isOnline(): boolean {
  return online;
}

/**
 * When the mirror last came back from the server.
 *
 * Exposed for the supervisor desk, which puts it on screen. A board that is
 * read all shift needs to say how old it is — and the desk had no way to know,
 * so its one refresh control was wired to a function that re-read `localStorage`
 * and its panes each invented a freshness story of their own.
 *
 * Null until the first successful pull, which is not the same as "a moment ago":
 * a desk opened offline has a mirror full of yesterday's board and must not
 * imply otherwise.
 */
let lastPulled: number | null = null;

export function lastSyncedAt(): Date | null {
  return lastPulled === null ? null : new Date(lastPulled);
}

// ---------------------------------------------------------------------------
// Offline write queue
// ---------------------------------------------------------------------------

type PendingWrite =
  | { kind: 'booking:create'; booking: Booking }
  | { kind: 'booking:patch'; id: string; patch: Partial<Booking> }
  | { kind: 'booking:delete'; id: string }
  | { kind: 'account:upsert'; account: UserAccount }
  | { kind: 'message:send'; message: Message };

let queue: PendingWrite[] = readLocal<PendingWrite[]>(KEYS.queue, []);
/** Non-zero while a write is in flight, so a poll can't clobber a fresh edit. */
let inFlight = 0;

function enqueue(write: PendingWrite): void {
  queue.push(write);
  writeLocal(KEYS.queue, queue);
  void drain();
}

async function send(write: PendingWrite): Promise<void> {
  switch (write.kind) {
    case 'booking:create': {
      /**
       * Sent with the session when there is one.
       *
       * The token is how the server knows whether this booking is under a
       * membership: it reads the plan off the account behind it to decide
       * dispatch priority and to spend one of the period's included pickups.
       * This call passed no token at all, so every booking made on the website
       * went up as a stranger's — a paying member got no priority, no included
       * pickup was counted, and the email-confirmation gate never fired. The
       * customer app has always passed it.
       */
      const created = await api.createBooking(write.booking, readAuthToken());

      // The grant that lets this browser read the order back without an
      // account. Stored against the id the server actually saved it under.
      rememberTracking(created.id, created.trackingToken);
      return;
    }
    case 'booking:patch':
      await api.updateBooking(write.id, write.patch, bookingAuth(write.id));
      return;
    case 'booking:delete':
      await api.deleteBooking(write.id, bookingAuth(write.id));
      forgetTracking(write.id);
      return;
    case 'account:upsert': {
      // A profile save is the signed-in customer's own. Without a session there
      // is nothing to save it against, and the server would refuse it — so it is
      // dropped here rather than retried forever against a 401.
      const token = readAuthToken();
      if (!token) return;
      await api.upsertAccount(write.account, token);
      return;
    }
    case 'message:send':
      await api.postMessage(
        { text: write.message.text, orderId: write.message.orderId!, id: write.message.id },
        bookingAuth(write.message.orderId)
      );
      return;
  }
}

/**
 * A write the server refused over who sent it, rather than what it said.
 *
 * Checked before {@link isPermanentFailure} and handled separately, because it
 * is the one 4xx that says nothing about the write at all — the same body sent
 * again with a live token would be accepted. It is also not a connection
 * failure: the server answered, and answered quickly.
 */
function isAuthFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Whether the reply came from the proxy in front of the server, not the server.
 *
 * The three statuses `apps/server` never writes. On this deployment they mean
 * the Render service is asleep or restarting, which is a wait rather than a
 * fault — {@link connectionState} reports it as `waking` so the strip can say
 * the useful thing instead of blaming the connection.
 */
function isGatewayFailure(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 502 || error.status === 503 || error.status === 504)
  );
}

/**
 * Whether a failed write is worth retrying.
 *
 * A dropped connection is temporary and the write should wait. A rejection is
 * not: the commonest case is a booking deleted from the supervisor ledger while
 * an edit for it sat in the queue, and that write can never succeed. Timeouts
 * and rate limits are the two 4xx codes that *do* clear on their own.
 *
 * 401 is excluded and is the one this used to get wrong. It counted an expired
 * session as the server’s final word and threw the write away — so a supervisor
 * whose twelve-hour session ran out mid-edit lost it, silently, while the strip
 * at the top of the page was still promising the change was saved on this
 * device and would be sent. See {@link isAuthFailure} and `queueBlockedOnAuth`.
 */
function isPermanentFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401 || error.status === 408 || error.status === 429) return false;
  return error.status >= 400 && error.status < 500;
}

/**
 * Set when the queue stops because the credential behind it was refused.
 *
 * Distinct from being offline, and it has to be: the writes are intact, the
 * server is reachable, and the one thing that would move them is a sign-in.
 * Retrying on the poll would not help — `startSync` drains every five seconds,
 * so a held 401 would become a request a second time a minute against a token
 * already known to be dead — so `drain` refuses to start while this is set and
 * `unblockQueue` is what lifts it.
 */
let queueBlockedOnAuth = false;

/** Whether the queue is holding writes that need somebody to sign in again. */
export function isQueueBlockedOnAuth(): boolean {
  return queueBlockedOnAuth;
}

/**
 * A credential has arrived, so the held writes are worth another try.
 *
 * Called from both sign-ins. Nothing else can change the answer: the queue is
 * blocked on a token, and a token is the only thing that unblocks it.
 */
function unblockQueue(): void {
  if (!queueBlockedOnAuth) return;
  queueBlockedOnAuth = false;
  void drain();
}

let draining = false;

async function drain(): Promise<void> {
  if (draining || queue.length === 0 || queueBlockedOnAuth) return;
  draining = true;
  inFlight += 1;

  // The reported state, not the raw flag: a first miss moves the strip from
  // "nothing known yet" to "online" without `online` itself changing, and the
  // second one is what finally flips it. Comparing the flag would sit on both.
  const stateBefore = connectionState();
  const queuedBefore = queue.length;
  const blockedBefore = queueBlockedOnAuth;

  try {
    while (queue.length > 0) {
      const [next] = queue;
      try {
        await send(next);
      } catch (error) {
        if (isAuthFailure(error)) {
          // The session behind this write expired while it sat here. The write
          // is still good and the server is plainly reachable — it just refused
          // the token. So it is kept, in order, and draining stops until
          // somebody signs in; the banner says as much rather than spinning on
          // “sending” against a credential that will never be accepted.
          queueBlockedOnAuth = true;
          markReachable();
          return;
        }

        if (isPermanentFailure(error)) {
          // The server will never accept this one — most often because the
          // order was deleted from the supervisor ledger while this write sat
          // in the queue. Retrying forever would wedge the queue and block
          // every later write from this browser, so it is dropped and we carry
          // on. We are still online; this was a rejection, not a timeout.
          markReachable();
          queue.shift();
          writeLocal(KEYS.queue, queue);
          continue;
        }

        // Server unreachable. Keep the write for the next attempt and stop
        // draining — order matters, so we don't skip ahead.
        markMissed(isGatewayFailure(error));
        return;
      }
      queue.shift();
      writeLocal(KEYS.queue, queue);
    }
    markReachable();
  } finally {
    draining = false;
    inFlight -= 1;

    // Both `online` and the queue length can have moved, and anything showing
    // either — the booking confirmation, most of all — is subscribed to this.
    // Without a nudge the UI keeps whatever it read on first render, which is
    // how a queued booking goes on claiming it was sent.
    //
    // Only when something actually moved, though. `draining` is already false
    // by this point, so a listener that re-enters here would be let straight
    // back in; notifying unconditionally turned one failed write into a retry
    // storm — dozens of POSTs in the same millisecond against a server that was
    // down. Gating on a real change bounds it: the second pass has nothing new
    // to report and stops.
    if (
      connectionState() !== stateBefore ||
      queue.length !== queuedBefore ||
      queueBlockedOnAuth !== blockedBefore
    ) {
      notify();
    }
  }
}

/** How many writes are still waiting to reach the server. */
export function pendingWriteCount(): number {
  return queue.length;
}

/**
 * Whether this booking is still sitting in the queue.
 *
 * The confirmation screen asks, because "we have your booking" and "the server
 * has your booking" are different claims and only the second one comes with an
 * email.
 */
export function isBookingPending(id: string): boolean {
  return queue.some((write) => write.kind === 'booking:create' && write.booking.id === id);
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export function readBookings(): Booking[] {
  return mirror.bookings;
}

export function readBooking(id: string): Booking | undefined {
  return mirror.bookings.find((booking) => booking.id === id);
}

/**
 * The signed-in customer's orders, scoped by the server rather than filtered here.
 *
 * The portal used to take the whole ledger out of the mirror and match
 * `email OR samePhone(phone)` in the browser, while the customer app asked
 * `GET /api/bookings?email=` — which matched on the address alone. Same
 * customer, two different histories. This is the app's call, so the two lists
 * are the same list; the server matches the number on the account as well, so
 * nothing the browser-side filter used to find has been lost.
 *
 * It no longer takes an address. The one it was given was the signed-in
 * customer's, but nothing made that so — the server read the query string, so the
 * route would answer for any address handed to it. The token decides now.
 *
 * Async, unlike the reads above, because it is a request rather than a mirror
 * lookup. Callers keep their last result when it rejects.
 */
export async function readUserBookings(): Promise<Booking[]> {
  const token = readAuthToken();
  if (!token) return [];
  return api.listBookings(token);
}

/**
 * The orders the person at this browser is entitled to see, newest first.
 *
 * Two ways to qualify: the order was booked here — which is the only claim a
 * signed-out visitor has — or it belongs to whoever is signed in, matched on
 * the address or the number exactly as `GET /api/bookings?email=` matches it
 * server-side.
 *
 * This exists because `readBookings()` is the whole ledger. The floating
 * "Track Order" notifier used to read `readBookings()[0]`, so every visitor to
 * the marketing site was shown the order id of the last booking made by
 * anybody. Synchronous, off the mirror, because it decides whether to render a
 * button rather than what to put in an order history.
 */
export function readOwnBookings(): Booking[] {
  const own = new Set(mirror.localIds);
  const user = mirror.currentUser;

  return mirror.bookings.filter(
    (booking) =>
      own.has(booking.id) ||
      (user !== null &&
        (booking.email.toLowerCase() === user.email.toLowerCase() ||
          samePhone(booking.phone, user.phone)))
  );
}

/**
 * Replace the whole ledger. Several screens already work this way — they build
 * a new array and hand it over — so this keeps that shape.
 *
 * The array is diffed into per-booking writes rather than sent as a wholesale
 * replacement. That matters: this browser's mirror is not necessarily the whole
 * ledger (it may not have synced yet, or the server may hold jobs a rider
 * created), and a blind replace would delete records this tab had never seen.
 * Deleting by omission only ever removes something we knew about.
 */
export function writeBookings(next: Booking[]): void {
  const before = new Map(mirror.bookings.map((booking) => [booking.id, booking]));
  const after = new Map(next.map((booking) => [booking.id, booking]));

  // Always a new array. Callers routinely mutate the array they got back from
  // `readBookings()` and hand it straight back; without the copy the reference
  // would be unchanged and React would skip the re-render.
  mirror.bookings = [...next];
  writeLocal(KEYS.bookings, mirror.bookings);

  for (const [id, booking] of after) {
    const previous = before.get(id);
    if (!previous) enqueue({ kind: 'booking:create', booking });
    else if (JSON.stringify(previous) !== JSON.stringify(booking)) {
      enqueue({ kind: 'booking:patch', id, patch: booking });
    }
  }

  for (const id of before.keys()) {
    if (!after.has(id)) enqueue({ kind: 'booking:delete', id });
  }

  notify();
}

export function createBooking(booking: Booking): void {
  mirror.bookings = [booking, ...mirror.bookings.filter((b) => b.id !== booking.id)];
  writeLocal(KEYS.bookings, mirror.bookings);

  // Remember it as ours. A visitor books without signing in, so this id is the
  // only claim this browser has to the order afterwards.
  mirror.localIds = Array.from(new Set([booking.id, ...mirror.localIds]));
  writeLocal(KEYS.localIds, mirror.localIds);

  enqueue({ kind: 'booking:create', booking });
  notify();
}

/**
 * Pays a booking's bill, and waits for the answer.
 *
 * Deliberately not queued, like the wallet movements below and for the same
 * reason: a payment must not be applied twice or applied late from a stale
 * number, and "did that go through" is a question the customer is standing there
 * asking. It fails in front of them, and the booking stays `Pending` — which is
 * true, and is what the desk will see.
 *
 * The queue is drained first because the booking itself is optimistic: it exists
 * in this browser the moment it is made and on the server a round trip later, and
 * there is nothing to settle until it is there.
 */
export async function payForBooking(
  id: string,
  method: 'Wallet' | 'Paystack' | 'Cash',
  reference?: string
): Promise<Booking> {
  await drain();

  const settled = await api.payForBooking(id, { method, reference }, bookingAuth(id));

  mirror.bookings = mirror.bookings.map((booking) => (booking.id === id ? settled : booking));
  writeLocal(KEYS.bookings, mirror.bookings);
  notify();

  // A wallet payment moved the balance and earned points, so the profile the
  // portal is showing is now a version behind.
  if (method === 'Wallet') await pullAccount();

  return settled;
}

/**
 * Takes back a cash settlement the desk recorded. Supervisor only, cash only.
 *
 * Not queued, for the reason above: whether the ledger now says a bill is unpaid
 * is a question somebody is standing at the desk asking, and the server may refuse
 * — a Paystack payment needs a refund, not a reversal. `bookingAuth` supplies the
 * admin token when there is one.
 */
export async function reverseCashPayment(id: string): Promise<Booking> {
  await drain();

  const reversed = await api.reverseCashPayment(id, bookingAuth(id));

  mirror.bookings = mirror.bookings.map((booking) => (booking.id === id ? reversed : booking));
  writeLocal(KEYS.bookings, mirror.bookings);
  notify();

  return reversed;
}

/**
 * Refunds a settled booking to the customer's wallet. Supervisor only.
 *
 * Not queued, like the reversal above and for the same reason: money is moving
 * and somebody is standing at the desk waiting to hear whether it did. The
 * server may refuse — an unsettled booking, or a guest with no wallet — and a
 * queued write would swallow that.
 *
 * The account is re-pulled afterwards because the balance on screen has just
 * changed for whoever is signed in; without it the desk's own wallet figure
 * would sit stale until the next poll.
 */
export async function refundBooking(id: string): Promise<Booking> {
  await drain();

  const refunded = await api.refundBooking(id, bookingAuth(id));

  mirror.bookings = mirror.bookings.map((booking) => (booking.id === id ? refunded : booking));
  writeLocal(KEYS.bookings, mirror.bookings);
  notify();

  return refunded;
}

/**
 * Moves a booking to another day or window.
 *
 * Not queued and not optimistic, unlike `patchBooking` below. The server owns
 * this decision — the window may have filled while the customer was choosing, a
 * courier may have accepted the job, the allowance may be spent — so writing the
 * new date into the mirror first would show a change that is about to be
 * refused. Rejects with the `ApiError`, whose `message` is a sentence written
 * for the customer.
 *
 * `PATCH /bookings/:id` no longer writes schedule fields for anybody but the
 * desk, so this is the only path a customer has to a new date.
 */
export async function rescheduleBooking(
  id: string,
  change: { pickupDate: string; pickupTime: string; deliveryTime?: string }
): Promise<Booking> {
  await drain();

  const moved = await api.rescheduleBooking(id, change, bookingAuth(id));

  // The server's answer rather than the request: it derives the return date
  // from the new collection, and may have kept a return window the request
  // never mentioned.
  mirror.bookings = mirror.bookings.map((booking) => (booking.id === id ? moved : booking));
  writeLocal(KEYS.bookings, mirror.bookings);
  notify();

  return moved;
}

/**
 * Land a record the server has already accepted.
 *
 * The desk's server-first handlers need this and had nothing to call. Their
 * only option was `writeBookings(next)`, which diffs the array and enqueues a
 * `booking:patch` for anything that changed — so every payment settled, every
 * refund and every stage confirmed went to the server twice: once as the
 * request that made it true, and again as a queued patch echoing the response
 * back at it.
 *
 * This is the other half of the split the desk is built on. `patchBooking`
 * above is optimistic — change it here, tell the server later, which is right
 * for something only this browser cares about. This one is for the opposite
 * case: the server has already said yes, and the mirror is catching up to a
 * fact rather than proposing one. No queue entry, because there is nothing left
 * to send.
 *
 * A record for an order this browser has never seen is inserted rather than
 * dropped — the desk holds a supervisor token and may well be told about a job
 * a courier created since the last pull.
 */
export function applyBooking(booking: Booking): void {
  const known = mirror.bookings.some((existing) => existing.id === booking.id);

  mirror.bookings = known
    ? mirror.bookings.map((existing) => (existing.id === booking.id ? booking : existing))
    : [...mirror.bookings, booking];

  writeLocal(KEYS.bookings, mirror.bookings);
  notify();
}

/** Drop a record the server has already deleted. No queue entry, same reasoning. */
export function forgetBooking(id: string): void {
  mirror.bookings = mirror.bookings.filter((booking) => booking.id !== id);
  writeLocal(KEYS.bookings, mirror.bookings);
  notify();
}

export function patchBooking(id: string, patch: Partial<Booking>): void {
  mirror.bookings = mirror.bookings.map((booking) =>
    booking.id === id ? { ...booking, ...patch } : booking
  );
  writeLocal(KEYS.bookings, mirror.bookings);
  enqueue({ kind: 'booking:patch', id, patch });
  notify();
}

export function deleteBooking(id: string): void {
  mirror.bookings = mirror.bookings.filter((booking) => booking.id !== id);
  writeLocal(KEYS.bookings, mirror.bookings);
  enqueue({ kind: 'booking:delete', id });
  notify();
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function readAccounts(): UserAccount[] {
  return mirror.accounts;
}

/**
 * Same diffing rationale as `writeBookings`, minus the deletions: no screen
 * removes an account, so an id missing from the array means "this tab hasn't
 * seen it", never "delete it".
 */
export function writeAccounts(next: UserAccount[]): void {
  const before = new Map(
    mirror.accounts.map((account) => [account.email.toLowerCase(), account])
  );

  mirror.accounts = [...next];
  writeLocal(KEYS.accounts, mirror.accounts);

  for (const account of next) {
    const previous = before.get(account.email.toLowerCase());
    if (!previous || JSON.stringify(previous) !== JSON.stringify(account)) {
      enqueue({ kind: 'account:upsert', account });
    }
  }

  notify();
}

/**
 * Suspends a customer, or lifts the suspension. Supervisor desk only.
 *
 * Unlike the writes above this one is not queued: it carries the desk's token,
 * which the offline queue has no way to attach, and a block replayed out of
 * order hours later is not something anybody asked for. It goes to the server
 * or it fails in front of the supervisor who pressed the button — the mirror is
 * only updated once the server has agreed.
 */
export async function setAccountBlocked(
  email: string,
  blocked: boolean,
  reason?: string
): Promise<UserAccount> {
  const token = readAdminToken();
  if (!token) throw new Error('Sign in to the supervisor desk to change an account.');

  const updated = await api.setAccountBlocked(email, { blocked, reason }, token);

  mirror.accounts = mirror.accounts.map((account) =>
    account.email.toLowerCase() === email.toLowerCase()
      ? // The reason stays on the desk that set it and out of the mirror, which
        // is written to localStorage and shared with every other pane.
        { ...account, ...updated, blockedReason: undefined }
      : account
  );
  writeLocal(KEYS.accounts, mirror.accounts);
  notify();

  return updated;
}

/**
 * Awards or deducts care points. Supervisor desk only.
 *
 * Not queued, for the same reason `setAccountBlocked` is not: it carries the
 * desk's token, and a grant replayed hours later out of order is not something
 * anybody asked for. Sent as a delta so the server applies it to the balance as
 * it actually stands — the dashboard used to compute the new total from its own
 * copy of the account and write that, which lost one of two adjustments made at
 * the same time and let the desk overwrite points a customer had just earned.
 */
export async function adjustPatronPoints(
  email: string,
  delta: number,
  reason?: string
): Promise<UserAccount> {
  const token = readAdminToken();
  if (!token) throw new Error('Sign in to the supervisor desk to adjust points.');

  const updated = await api.adjustAccountPoints(email, { delta, reason }, token);

  mirror.accounts = mirror.accounts.map((account) =>
    account.email.toLowerCase() === email.toLowerCase() ? { ...account, ...updated } : account
  );
  writeLocal(KEYS.accounts, mirror.accounts);

  // The desk and the portal can be the same browser, so keep the signed-in
  // profile in step rather than letting it disagree with the table beside it.
  if (mirror.currentUser?.email.toLowerCase() === email.toLowerCase()) {
    applyAccount({ ...mirror.currentUser, ...updated });
  } else {
    notify();
  }

  return updated;
}

/**
 * Erases a customer account. Supervisor desk only.
 *
 * Any queued write for that address is dropped first. Without that, an upsert
 * still sitting in the queue — a points adjustment made a moment earlier, say —
 * would drain afterwards and recreate the row that was just deleted.
 */
export async function deleteAccount(email: string): Promise<void> {
  const token = readAdminToken();
  if (!token) throw new Error('Sign in to the supervisor desk to delete an account.');

  await api.deleteAccount(email, token);

  queue = queue.filter(
    (write) =>
      write.kind !== 'account:upsert' ||
      write.account.email.toLowerCase() !== email.toLowerCase()
  );
  writeLocal(KEYS.queue, queue);

  mirror.accounts = mirror.accounts.filter(
    (account) => account.email.toLowerCase() !== email.toLowerCase()
  );
  writeLocal(KEYS.accounts, mirror.accounts);
  notify();
}

export function upsertAccount(account: UserAccount): void {
  const index = mirror.accounts.findIndex(
    (candidate) => candidate.email.toLowerCase() === account.email.toLowerCase()
  );

  if (index >= 0) mirror.accounts[index] = { ...mirror.accounts[index], ...account };
  else mirror.accounts.push(account);

  mirror.accounts = [...mirror.accounts];
  writeLocal(KEYS.accounts, mirror.accounts);
  enqueue({ kind: 'account:upsert', account });
  notify();
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

/**
 * The order thread, as this browser knows it.
 *
 * One conversation per job, shared with the rider app and the dispatch desk.
 * Reads are synchronous off the mirror like everything else here; the poll in
 * `pull()` is what brings the rider's side of it in.
 */
export function readMessages(orderId?: string): Message[] {
  if (!orderId) return mirror.messages;
  return mirror.messages.filter((message) => message.orderId === orderId);
}

/**
 * Post to a job's thread as the customer.
 *
 * The id is minted here rather than by the server so the bubble can appear the
 * instant it is typed. The server's insert is `on conflict do nothing`, so a
 * queued resend after a dropped connection lands as the same message rather
 * than a duplicate.
 */
export function sendMessage(text: string, orderId: string): Message {
  const message: Message = {
    id: `msg-customer-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    sender: 'customer',
    text,
    timestamp: nowLabel(),
    orderId,
  };

  mirror.messages = [...mirror.messages, message];
  writeLocal(KEYS.messages, mirror.messages);
  enqueue({ kind: 'message:send', message });
  notify();

  return message;
}

/** Same clock label the rider app and the server stamp messages with. */
function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Wallet and care points
// ---------------------------------------------------------------------------

/**
 * Money and points move on the server, never here.
 *
 * The portal used to hold the balance in a React state hook seeded with ₵150,
 * add or subtract locally and PUT the result — so a top-up made in the customer
 * app was invisible until the next sign-in, a membership renewal debited by the
 * server was overwritten by the next profile save, and the reward buttons
 * deducted no points at all. All three go through `/api/accounts/wallet`, which
 * does the arithmetic, writes the ledger entry and hands back the account.
 *
 * Deliberately not queued for offline replay. A balance is the one thing that
 * must not be applied twice or applied late from a stale number — these fail in
 * front of the customer who pressed the button, and they retry.
 */

async function moveWallet(
  move: (token: string) => Promise<{ account: UserAccount; transaction: PaymentTransaction | null }>
): Promise<UserAccount> {
  const token = readAuthToken();
  if (!token) throw new Error('Sign in to use your wallet.');

  const { account } = await move(token);
  applyAccount(account);
  return account;
}

/**
 * Credits the wallet against a settled Paystack payment. Earns no points.
 *
 * The amount is not ours to choose — the server verifies `reference` with
 * Paystack and credits what was actually collected.
 */
export async function topUpWallet(method: string, reference: string): Promise<UserAccount> {
  return moveWallet((token) => api.topUpWallet({ method, reference }, token));
}

/**
 * Debits the wallet and earns the point-per-cedi that spend is worth.
 *
 * Throws an `ApiError` carrying `{ reason: 'insufficient-funds', shortfall }`
 * when the balance is short, which the caller shows rather than guessing at.
 */
export async function chargeWallet(payload: {
  amount: number;
  description: string;
  bookingId?: string;
  reference?: string;
}): Promise<UserAccount> {
  return moveWallet((token) => api.chargeWallet(payload, token));
}

/** Spends care points on a reward from the shared catalogue. */
export async function redeemReward(rewardId: string): Promise<UserAccount> {
  return moveWallet((token) => api.redeemReward({ rewardId }, token));
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Passwords are never held here.
 *
 * The portal used to pull the whole account table into the browser and compare
 * the password locally, which meant the server had to hand every visitor every
 * credential. Now the password goes to `/api/auth/*` and comes back as a bearer
 * token; the only things this module keeps are that token and the signed-in
 * profile, both scoped to this browser.
 */

/**
 * Who is signed in on *this* browser.
 *
 * Part of the mirror rather than a bare `localStorage` read, so that a poll
 * bringing back a fresh wallet balance or a renewed membership notifies
 * subscribers like every other change does. Reading it stayed synchronous,
 * which is what the screens calling it expect.
 */
export function readCurrentUser(): UserAccount | null {
  return mirror.currentUser;
}

/**
 * Replaces the signed-in profile with the one the server just gave us.
 *
 * Every path that learns something new about the account goes through here —
 * sign-in, the poll's `/auth/me`, and each wallet movement — so there is one
 * place the balance, the points and the plan can come from.
 */
export function applyAccount(account: UserAccount): void {
  // The poll re-reads the account every five seconds and it is almost always
  // identical. Notifying anyway would re-render every subscriber on a timer —
  // and the portal answers a change by re-fetching its order list, so an
  // unconditional notify here turns one poll into two requests.
  if (JSON.stringify(mirror.currentUser) === JSON.stringify(account)) return;

  mirror.currentUser = account;
  writeLocal(KEYS.currentUser, account);

  // Keep the shared account list in step too: the portal's tier badge and the
  // supervisor desk's patron table both read it, and a stale row there would
  // contradict the profile we just wrote.
  const index = mirror.accounts.findIndex(
    (candidate) => candidate.email.toLowerCase() === account.email.toLowerCase()
  );
  if (index >= 0) {
    mirror.accounts = mirror.accounts.map((candidate, at) =>
      at === index ? { ...candidate, ...account } : candidate
    );
    writeLocal(KEYS.accounts, mirror.accounts);
  }

  notify();
}

/** @deprecated Prefer {@link applyAccount}; kept for the dashboard's session restore. */
export function writeCurrentUser(account: UserAccount): void {
  applyAccount(account);
}

/**
 * Saves the signed-in patron's own profile and keeps the answer.
 *
 * Deliberately not {@link upsertAccount}: that one hands the write to the
 * offline queue, which means it resolves before the server has seen it, never
 * touches `currentUser`, and drops the reply on the floor. The two things a
 * settings form needs are the two things it throws away — the saved row,
 * because the server is what normalises the phone and the only thing that knows
 * the account's money, points and plan; and the failure, because a number
 * already on somebody else's account comes back as a 409 the patron has to be
 * told about rather than a silent no-op.
 *
 * `inFlight` is held across the round trip so the five-second poll cannot
 * answer with the pre-edit account while this is still on the wire.
 */
export async function saveProfile(patch: Partial<UserAccount>): Promise<UserAccount> {
  const token = readAuthToken();
  const current = mirror.currentUser;
  if (!token || !current) throw new Error('Sign in to change your details.');

  inFlight += 1;
  try {
    const saved = await api.upsertAccount({ ...current, ...patch }, token);
    applyAccount(saved);
    return saved;
  } finally {
    inFlight -= 1;
  }
}

/**
 * Replaces the patron's saved address book.
 *
 * Sends the whole book rather than the entry that changed, because that is what
 * the route replaces — and because it makes the write idempotent, which matters
 * when the customer app is polling the same account every four seconds. The
 * caller passes the book it just derived; the server's normalised answer is what
 * gets applied, so the ids, the ordering and the single default all come back
 * from one place.
 */
export async function saveAddresses(addresses: SavedAddress[]): Promise<UserAccount> {
  const token = readAuthToken();
  if (!token || !mirror.currentUser) throw new Error('Sign in to change your addresses.');

  inFlight += 1;
  try {
    const saved = await api.saveAddresses(addresses, token);
    applyAccount(saved);
    return saved;
  } finally {
    inFlight -= 1;
  }
}

export function readAuthToken(): string | null {
  return localStorage.getItem(KEYS.authToken);
}

function writeSession(session: AuthSession): UserAccount {
  try {
    localStorage.setItem(KEYS.authToken, session.token);
  } catch {
    /* see writeLocal */
  }
  applyAccount(session.account);

  // Anything this customer wrote before the session lapsed can go now.
  unblockQueue();

  return session.account;
}

export async function register(payload: {
  email: string;
  phone: string;
  name: string;
  password: string;
}): Promise<UserAccount> {
  return writeSession(await api.register(payload));
}

export async function login(identifier: string, password: string): Promise<UserAccount> {
  return writeSession(await api.login({ identifier, password }));
}

/**
 * The booking an emailed setup link belongs to.
 *
 * Read from the server rather than from the local mirror, and not by booking
 * id: the token is what names the order, and it is also the only thing that
 * proves the person holding it is the customer the confirmation went to.
 * Throws on a link that is spent, expired or invented.
 */
export async function readSetupLink(
  token: string
): Promise<{ id: string; name: string; email: string; phone: string }> {
  return (await api.setupLinkBooking(token)).booking;
}

/** Spends a setup link, setting the account's first password and signing in. */
export async function claimBooking(token: string, password: string): Promise<UserAccount> {
  return writeSession(await api.claimBooking({ token, password }));
}

/**
 * Mails the setup link again to the address on a booking.
 *
 * Unable to report whether it found anything, for the reason
 * `requestPasswordReset` is: the server answers a contact it has never seen
 * exactly as it answers a real one. Throws only when the request could not be
 * made at all.
 */
export async function requestSetupLink(identifier: string): Promise<void> {
  await api.requestSetupLink(identifier);
}

/** Whether a contact already has a login, so the UI can offer the right path. */
export async function authStatus(
  identifier: string
): Promise<{ exists: boolean; hasPassword: boolean }> {
  return api.authStatus(identifier);
}

/**
 * Asks for another email-confirmation link.
 *
 * Throws when there is no session, when the address is already confirmed, or
 * when pressed inside the server's cooldown — the caller shows the message.
 */
export async function resendVerification(): Promise<void> {
  const token = readAuthToken();
  if (!token) throw new Error('Sign in to request a new link.');
  await api.resendVerification(token);
}

/**
 * Mails a password-reset link to whatever address is on the account.
 *
 * Deliberately not authenticated, and deliberately unable to report whether it
 * found anything: somebody who cannot sign in is the only caller, and the
 * server answers a contact it has never seen exactly as it answers a real one.
 * Throws only when the request could not be made at all.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  await api.requestPasswordReset(identifier);
}

export async function logout(): Promise<void> {
  const token = readAuthToken();
  clearCurrentUser();
  if (token) {
    try {
      await api.logout(token);
    } catch {
      // Already signed out locally; a failed revoke just leaves a token to
      // expire on its own.
    }
  }
}

/**
 * Re-validates the stored token on load. A token the server no longer honours
 * means the cached profile is stale, so the session is dropped rather than
 * leaving the portal showing someone who is not really signed in.
 */
export async function restoreSession(): Promise<UserAccount | null> {
  const token = readAuthToken();
  if (!token) return null;

  try {
    const account = await api.me(token);
    applyAccount(account);
    return account;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearCurrentUser();
      return null;
    }
    // Server unreachable — keep the cached profile rather than signing the
    // customer out every time their connection drops.
    return readCurrentUser();
  }
}

export function clearCurrentUser(): void {
  mirror.currentUser = null;
  localStorage.removeItem(KEYS.currentUser);
  localStorage.removeItem(KEYS.authToken);
  notify();
}

// ---------------------------------------------------------------------------
// Supervisor desk
// ---------------------------------------------------------------------------

/**
 * The dashboard's own session, kept apart from the customer one.
 *
 * A browser can legitimately be both — a supervisor who is also a customer —
 * so the two tokens live under different keys rather than overwriting each
 * other. `kind` on the server keeps them from being used interchangeably.
 *
 * ---
 *
 * **Why this one is in `sessionStorage` and the customer's is not.**
 *
 * `sessionStorage` is scoped to the tab: it does not survive the tab closing,
 * and a second tab starts without it. For a customer that would be wrong — the
 * whole point of staying signed in is not signing in again — but the desk is a
 * different thing. It is a shared machine on a counter, and this token reads
 * every customer's address and phone number, settles any bill, refunds to any
 * wallet and deactivates any courier. Closing the tab should end that, and now
 * does; the server gives it twelve hours rather than a week on top.
 *
 * What this does **not** fix, stated plainly rather than left to be discovered:
 * `sessionStorage` is still readable by any script running on this origin, so
 * it is a smaller window rather than a closed door. The control that actually
 * governs that risk is the Content-Security-Policy — see
 * `apps/server/src/headers.ts` and the `headers` block in `vercel.json`, which
 * refuse inline script and every script host but our own.
 *
 * Moving this to an `HttpOnly` cookie is the real fix and is deliberately not
 * done here: the desk token is sent as a bearer to `/api/bookings`,
 * `/api/accounts` and `/api/messages` as well as to `/api/admin/*`, so a cookie
 * would have to be accepted across the whole API and would put CSRF on every
 * write in the product. That is a change worth making on its own, with its own
 * review, not as a rider on this one.
 */
export function readAdminToken(): string | null {
  // Guarded like every other reader in this file. Storage is not always there
  // to be read — a locked-down browser throws on the *access*, not on the value
  // — and an exception here is thrown from the one call that decides whether the
  // desk route can draw anything at all. `restoreAdminSession` is `async`, so
  // today that lands in `App`'s `.catch` and shows the sign-in form, which is
  // the right screen by luck rather than by intent. Returning `null` says the
  // same thing deliberately: no token we can read is no session.
  try {
    return sessionStorage.getItem(KEYS.adminToken);
  } catch {
    /* see writeLocal */
    return null;
  }
}

export function readAdminSupervisor(): SupervisorProfile | null {
  try {
    const raw = sessionStorage.getItem(KEYS.adminSupervisor);
    return raw ? (JSON.parse(raw) as SupervisorProfile) : null;
  } catch {
    return null;
  }
}

/** The profile beside the token, and in the same tab-scoped place. */
function writeAdminSupervisor(supervisor: SupervisorProfile): void {
  try {
    sessionStorage.setItem(KEYS.adminSupervisor, JSON.stringify(supervisor));
  } catch {
    /* see writeLocal */
  }
}

export async function adminLogin(
  email: string,
  password: string
): Promise<SupervisorProfile> {
  const session = await api.adminLogin({ email, password });

  try {
    sessionStorage.setItem(KEYS.adminToken, session.token);
  } catch {
    /* see writeLocal */
  }
  writeAdminSupervisor(session.supervisor);

  // A live desk session again, so whatever ended the last one is no longer the
  // reason anybody is looking at the sign-in form.
  adminSessionExpired = false;

  // And any desk write held back when the last one lapsed can go now.
  unblockQueue();

  return session.supervisor;
}

/**
 * Re-validates the stored desk token on load. A token the server no longer
 * honours means the dashboard must not open, so unlike the customer session
 * this does *not* fall back to the cached profile when the server is
 * unreachable — an unverifiable supervisor is not a supervisor.
 */
export async function restoreAdminSession(): Promise<SupervisorProfile | null> {
  const token = readAdminToken();
  if (!token) return null;

  try {
    const supervisor = await api.adminMe(token);
    writeAdminSupervisor(supervisor);
    return supervisor;
  } catch {
    clearAdminSession();
    return null;
  }
}

export async function adminLogout(): Promise<void> {
  const token = readAdminToken();
  clearAdminSession();
  if (token) {
    try {
      await api.adminLogout(token);
    } catch {
      /* Already signed out locally; the token expires on its own. */
    }
  }
}

export function clearAdminSession(): void {
  // Reset here as well as set in `pull`, so a deliberate sign-out does not
  // leave the login form claiming a shift session ran out. `pull` sets the flag
  // *after* calling this, which is the one order that serves both callers.
  adminSessionExpired = false;

  sessionStorage.removeItem(KEYS.adminToken);
  sessionStorage.removeItem(KEYS.adminSupervisor);

  // Sessions written by an earlier build of this app, before the desk moved to
  // tab-scoped storage. Cleared on the way past so a token cannot outlive the
  // sign-out that was supposed to end it — a browser that has been open since
  // before this change still has one sitting there.
  localStorage.removeItem(KEYS.adminToken);
  localStorage.removeItem(KEYS.adminSupervisor);
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Pull the server's view into the mirror.
 *
 * Skipped while a write is in flight: the response would predate the edit that
 * is still on the wire, and applying it would make the UI flicker backwards.
 *
 * What gets pulled depends entirely on who is looking, which it did not used to.
 * This fetched the whole booking ledger, every customer account and every message
 * in the system, unconditionally, every five seconds — and `startSync()` runs from
 * `App.tsx` on the public marketing page. So an anonymous visitor reading about
 * laundry prices downloaded FreshFold's entire customer database on a timer and
 * wrote it to `localStorage`, where it outlived the tab.
 *
 * Three cases now. The desk polls the board it administers. A signed-in customer
 * polls their own orders. Everybody else polls nothing — a visitor with a booking
 * on this device reads it by id with the grant they were given, and a visitor
 * without one has no business here at all.
 */
export async function pull(): Promise<void> {
  if (inFlight > 0) return;

  const adminToken = readAdminToken();
  const authToken = readAuthToken();

  try {
    if (adminToken) await pullAsSupervisor(adminToken);
    else if (authToken) await pullAsCustomer(authToken);
    else await pullAsVisitor();

    markReachable();
    lastPulled = Date.now();
    await pullAccount();
  } catch (error) {
    // A refusal is not a dropped connection. `ApiError` is only built from a
    // reply that arrived, so the server saying “no” — an aged-out desk token, a
    // scope it will not grant, a fault of its own — means the connection is
    // working and something else is wrong. Reading those as offline is what put
    // a permanent “no connection” banner over a board whose only problem was a
    // session that had run out. The mirror stands either way.
    // One miss is not a verdict. A request that stalls past its budget is an
    // ordinary event on a mobile connection, and the desk's pull is three of
    // them at once — see {@link OFFLINE_AFTER_MISSES}.
    if (isUnreachable(error)) markMissed(isGatewayFailure(error));
    else markReachable();

    // The desk’s token specifically. Nothing re-checks it once the route is
    // open, so without this the board polls a token the server has already
    // rejected every five seconds until somebody thinks to reload the page.
    //
    // `clearAdminSession` resets the flag, so it is set after — see the note
    // there. The next pull takes the visitor branch, which is right: this
    // browser no longer holds a desk session.
    if (adminToken && error instanceof ApiError && error.status === 401) {
      clearAdminSession();
      adminSessionExpired = true;

      // Hold whatever that token queued, rather than letting the next drain
      // send it with no credential at all. `bookingAuth` would fall through to
      // a customer token this desk does not have, and the routes deliberately
      // refuse to distinguish “not yours” from “not there” — so the reply would
      // be a 404 and the queue would read a good write as permanently rejected,
      // which is the whole failure this was meant to end.
      if (queue.length > 0) queueBlockedOnAuth = true;
    }
  }

  // Both outcomes, so a screen showing the sync state learns about the failure
  // as well as the success. `lastPulled` deliberately keeps its old value on a
  // failure: the data on screen really did come back at that moment, and what
  // has changed is only that it is now known to be stale.
  notify();
}

/** The desk: the whole board, the patron table and every conversation. */
async function pullAsSupervisor(token: string): Promise<void> {
  const [bookings, accounts, messages] = await Promise.all([
    api.listBookings(token),
    api.listAccounts(token),
    api.listAllMessages(token),
  ]);

  if (inFlight > 0) return;

  mirror.bookings = bookings;
  mirror.accounts = accounts;
  mirror.messages = messages;
  writeLocal(KEYS.bookings, bookings);
  writeLocal(KEYS.accounts, accounts);
  writeLocal(KEYS.messages, messages);
  notify();
}

/**
 * A signed-in customer: their own orders, and the threads on them.
 *
 * The account list is not fetched at all. The portal's tier badge reads
 * `currentUser`, which `pullAccount` keeps fresh, and the patron table it used to
 * share is the supervisor's screen.
 */
async function pullAsCustomer(token: string): Promise<void> {
  const bookings = await api.listBookings(token);
  if (inFlight > 0) return;

  mirror.bookings = bookings;
  writeLocal(KEYS.bookings, bookings);

  // Remember them as ours, so the notifier keeps working after a sign-out.
  mirror.localIds = Array.from(new Set([...mirror.localIds, ...bookings.map((b) => b.id)]));
  writeLocal(KEYS.localIds, mirror.localIds);
  notify();

  await pullThreads(bookings, () => ({ token }));
}

/**
 * A visitor: the bookings made on this device, one request each.
 *
 * By id rather than as a list, because there is no session to scope a list by —
 * and the grant is per booking. Only the ones this browser actually holds a token
 * for, which is what stops the old behaviour of reading the ledger and filtering
 * afterwards.
 */
async function pullAsVisitor(): Promise<void> {
  const held = mirror.localIds.filter((id) => trackingTokens[id]);

  if (held.length === 0) {
    // Nothing to sync, but "is the server there" is still worth an answer: the
    // booking form shows whether a write is queued.
    await api.health();
    return;
  }

  const results = await Promise.all(
    held.map((id) =>
      api
        .getBooking(id, { trackingToken: trackingTokens[id] })
        .catch((error: unknown) => {
          // A grant the server no longer honours is a booking the desk has
          // removed, or a token past its month. Forget it rather than asking
          // again every five seconds forever.
          if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
            forgetTracking(id);
          }
          return null;
        })
    )
  );

  if (inFlight > 0) return;

  const found = results.filter((booking): booking is Booking => booking !== null);

  mirror.bookings = found;
  writeLocal(KEYS.bookings, found);
  notify();

  await pullThreads(found, (id) => ({ trackingToken: trackingTokens[id] }));
}

/**
 * The conversations on a set of orders, one request per thread.
 *
 * A thread is only readable by a party to its job now, so there is no single
 * request that fetches "my messages" — the customer app has always done it this
 * way for the same reason. Bounded by how many orders the caller actually has,
 * which is a handful.
 */
async function pullThreads(
  bookings: Booking[],
  authFor: (bookingId: string) => BookingAuth
): Promise<void> {
  if (bookings.length === 0) {
    mirror.messages = [];
    writeLocal(KEYS.messages, mirror.messages);
    return;
  }

  /**
   * `null` for a thread that could not be read, which is not the same answer
   * as an empty one.
   *
   * This used to be `.catch(() => [])`, and the empty array went straight into
   * the flattened result that *replaces* `mirror.messages` — so one failed
   * request silently deleted that conversation from the mirror and then wrote
   * the gap to `localStorage`, where it outlived the tab. The list did not look
   * broken; it looked complete and one thread shorter, which is the version of
   * this failure nobody notices. A customer chasing a late order is exactly who
   * is on a connection flaky enough to drop one request, and exactly who should
   * not watch their conversation with the desk disappear.
   */
  const threads = await Promise.all(
    bookings.map((booking) =>
      api
        .listMessages(booking.id, authFor(booking.id))
        .then((messages) => ({ id: booking.id, messages }))
        .catch(() => ({ id: booking.id, messages: null as Message[] | null }))
    )
  );

  if (inFlight > 0) return;

  // A thread that answered replaces what we held; one that did not keeps it.
  // Rebuilt per booking rather than by patching the old array, so a thread that
  // came back genuinely empty — the desk deleted its messages — still empties.
  //
  // `previous` is captured rather than read through `mirror` inside the
  // callback: the right-hand side happens to finish before the assignment, so
  // reading it there works today, and it is one refactor away from quietly
  // filtering the array it is halfway through replacing.
  const previous = mirror.messages;

  mirror.messages = threads.flatMap(
    (thread) => thread.messages ?? previous.filter((message) => message.orderId === thread.id)
  );

  writeLocal(KEYS.messages, mirror.messages);
  notify();
}

/**
 * Re-reads the signed-in account, which is what makes a membership renew.
 *
 * There is no scheduler on the server: `/auth/me` settles the plan before it
 * answers, so a month rolling over — or the wallet running dry and the plan
 * lapsing — lands here on the next poll. It carries the balance and the points
 * that settlement left behind, which is how a top-up made in the customer app
 * shows up in this browser without a sign-out.
 *
 * The portal used to do this once, on mount, and never again. That single call
 * is the reason a wallet could read ₵150 here and ₵0 in the app.
 */
async function pullAccount(): Promise<void> {
  const token = readAuthToken();
  if (!token || inFlight > 0) return;

  try {
    applyAccount(await api.me(token));
  } catch (error) {
    // An expired or revoked session signs this browser out; anything else is
    // the connection, and the cached profile stands.
    if (error instanceof ApiError && error.status === 401) clearCurrentUser();
  }
}

/**
 * Starts polling. Safe to call more than once. Returns a stop function.
 *
 * ## Why it stops when the tab is hidden
 *
 * This used to be an unconditional `setInterval` at {@link POLL_INTERVAL_MS},
 * started on mount and running for as long as the tab existed. That is 720
 * requests an hour, per tab, and it kept running when:
 *
 *  - the tab was backgrounded, or the phone was in someone's pocket;
 *  - the visitor was on the marketing page with no account and no order, so
 *    every response was the same ledger they had no use for.
 *
 * On the metered mobile connections most of this site is used over, that is
 * somebody's data spent on answers nobody is looking at — and on the dispatch
 * server it is the bulk of its traffic arriving from tabs nobody is reading.
 *
 * A hidden tab does not need fresh data: it has nothing on screen. It needs
 * fresh data *the moment it comes back*, which is what the immediate
 * `resume()` below does — so returning to a tab is, if anything, faster than
 * it was, because a visible tab now polls on a schedule that has just been
 * restarted rather than one that could be 4.9 seconds stale.
 *
 * `visibilitychange` rather than `blur`/`focus`: blur fires when a window
 * merely loses focus to another window on the same screen, which on a desktop
 * is somebody glancing at the desk board in a second window and expecting it
 * to keep moving.
 */
export function startSync(): () => void {
  /**
   * One poll at a time.
   *
   * The clock does not stop while a read is out, and a read can now be out for
   * a while: a request that has to wake the Render service waits out the cold
   * start rather than failing in eight seconds, which is what
   * `COLD_START_TIMEOUT_MS` is for. Unguarded, a fifty-second wake queues ten
   * more ticks behind the one already waiting — and a supervisor's pull is
   * three requests, so the booting server is met with thirty of them arriving
   * the moment it opens the port.
   *
   * Only the clock is held back. An explicit `pull()` — the Refresh beside the
   * desk's timestamp, and every handler that asks for the board again after a
   * write — is one deliberate request and goes through as it always has.
   */
  let polling = false;

  const tick = () => {
    void drain();
    if (polling) return;
    polling = true;
    void pull().finally(() => {
      polling = false;
    });
  };

  const resume = () => {
    if (pollTimer) return;
    // Immediately, then on the interval — a tab coming back should not wait
    // out a full period before it shows anything that moved while it was away.
    tick();
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  };

  const pause = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') pause();
    else resume();
  };

  // A tab that is already hidden at mount — restored by the browser in the
  // background, or opened in a background tab — should not start polling until
  // somebody looks at it.
  if (document.visibilityState === 'hidden') {
    // The queue is a different matter: a write made before the tab was
    // backgrounded should still reach the server.
    void drain();
  } else {
    resume();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    pause();
  };
}

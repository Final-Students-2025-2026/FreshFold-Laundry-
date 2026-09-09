/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActivePlan } from './membership';
import type { PaystackInitPayload } from './payments';
import type { PlaceDetail, PlaceSuggestion } from './places';
import type { RouteLeg } from './route';
import type {
  AdminSession,
  AuditEvent,
  AuthSession,
  Booking,
  BookingItem,
  Claim,
  ClaimStatus,
  Coords,
  Enquiry,
  Garment,
  Hub,
  HubEvent,
  Invoice,
  InvoiceStatus,
  JobStatus,
  LaundryBag,
  Message,
  Notification,
  Order,
  PaymentTransaction,
  PromoCode,
  PromoRedemption,
  RecurringPickup,
  RiderSession,
  RiderShift,
  RiderState,
  RiderTelemetry,
  SavedAddress,
  SupervisorProfile,
  UserAccount,
} from './types';

/**
 * The one HTTP client both apps use.
 *
 * Written against bare `fetch` with no platform imports so the same file runs
 * under Vite, Metro and Node. Every method returns a plain promise and throws
 * an {@link ApiError} on a non-2xx response; callers decide whether that means
 * "show an error" or "fall back to the local cache".
 */

export const API_PREFIX = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * This client's own budget ran out before anything answered.
 *
 * Its whole reason for existing is the message. Aborting a `fetch` rejects with
 * whatever the platform decided to call it — Chrome says `signal is aborted
 * without reason`, which is a true statement about an `AbortController` and a
 * baffling one to a supervisor at a desk. That string reached people, because
 * nearly every screen in `apps/web` renders `error.message` directly and
 * `DOMException` passes an `instanceof Error` check as readily as anything we
 * wrote ourselves.
 *
 * So the platform's error is caught at the one place it can be recognised — the
 * timer that caused it — and replaced with a sentence. What it deliberately
 * does *not* say is that nothing happened: the server does not check whether
 * the caller is still listening, so a write that timed out on the way back has
 * very likely landed. Callers that changed something say so in their own words;
 * see `HubPanel`.
 *
 * Not an {@link ApiError}, and it must never become one: nothing answered, so
 * {@link isUnreachable} has to keep reading it as a dropped connection.
 */
export class TimeoutError extends Error {
  constructor(readonly waitedMs: number) {
    super('The dispatch server did not answer in time.');
    this.name = 'TimeoutError';
  }
}

/**
 * Whether a rejection is an abort, from any of the runtimes this file runs in.
 *
 * Duck-typed rather than `instanceof DOMException`, because the same module is
 * loaded under Vite, Metro and Node, and only one of those has always had that
 * global.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export interface ClientOptions {
  /** Origin of the dispatch server, e.g. `http://192.168.1.42:4000`. */
  baseUrl: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Abort a request after this long. Defaults to 8s. */
  timeoutMs?: number;
  /**
   * Budget for a request that may have to wake the host, rather than merely be
   * served by it. Defaults to {@link COLD_START_TIMEOUT_MS}.
   *
   * Only spent while the server is unproven — see {@link createClient}. Pass 0
   * to opt out and hold every request to `timeoutMs`.
   *
   * Passing this explicitly also overrides the guess about whether the host can
   * sleep at all, which is what a same-origin caller behind a proxy needs:
   * `apps/web` builds its client with `baseUrl: ''`, so there is no hostname to
   * read, but on Vercel those `/api` calls are rewritten to the same Render
   * service that does sleep.
   */
  coldStartMs?: number;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * How long to wait on a request that may have to wake a sleeping host.
 *
 * Render's free plan spins a service down after 15 minutes with no inbound
 * request, and the cold start that follows takes around 50 seconds: the process
 * boots, `start()` checks the database and seeds the roster, and only then does
 * the port open. Every second of that is spent before our request is read, so
 * the 8s that is generous for a served request is not close to enough — the
 * first tap after an idle spell aborted roughly 40 seconds early, every time,
 * and told the customer to check a connection that was fine.
 *
 * 60s rather than 50 because the published figure is a typical cold start, not
 * a bound, and because the alternative to waiting is an error that blames the
 * customer's phone for our hosting plan.
 */
export const COLD_START_TIMEOUT_MS = 60_000;

/**
 * How long a proven server may sit unheard-from before it is doubted again.
 *
 * Deliberately shorter than the 15 minutes Render waits before sleeping. The
 * two costs here are not symmetric: doubting a server that is in fact awake
 * spends nothing, because a warm reply arrives in well under a second and the
 * larger budget goes unused, while trusting one that has gone to sleep spends a
 * failed request and shows somebody the unreachable message. So the doubt
 * starts early.
 */
export const COLD_AFTER_IDLE_MS = 10 * 60_000;

/**
 * Hosts that answer from this network, and therefore never have to be woken.
 *
 * Loopback, the three private IPv4 ranges and link-local. A LAN dispatch server
 * is either listening or it is not: connecting to a machine that is up but has
 * nothing on the port fails immediately with a refusal rather than by timing
 * out, so the cold-start budget would not buy a dev anything. It would only be
 * spent on the case the guess is really protecting — a phone on cellular, or on
 * a different Wi-Fi from the laptop — where it turns a wrong-network mistake
 * that reports itself in 8 seconds into one that takes a minute.
 */
const LOCAL_HOST = /^(localhost|\[?::1\]?|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Whether `origin` names a host that might have to be woken up. */
function mayNeedWaking(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    // Bonjour/mDNS — another name for a machine on this network.
    if (hostname.endsWith('.local')) return false;
    return !LOCAL_HOST.test(hostname);
  } catch {
    // A relative base (`apps/web`) has no hostname to judge. Callers that know
    // they sit in front of something sleepy pass `coldStartMs` explicitly.
    return false;
  }
}

/**
 * Statuses that come from something in front of the server rather than from it.
 *
 * None of the three is ever written by `apps/server`: they are Render's router
 * and Vercel's proxy reporting that the process behind them is asleep,
 * restarting, or did not answer inside the gateway's own patience. The reply
 * carries an HTML page or nothing at all, so there is no `error` field to
 * quote.
 */
const GATEWAY_STATUS = new Set([502, 503, 504]);

/**
 * What a caller is told when one of those answers instead of the server.
 *
 * Without this the fallback below ran, and the sentence a supervisor read on
 * the desk's sign-in form was `POST /admin/login failed (502)` — true about the
 * plumbing, useless about what to do, and indistinguishable to them from a
 * rejected password. Every screen in `apps/web` renders `ApiError.message`
 * directly when it has no better wording of its own, so the trace surfaced
 * everywhere at once.
 *
 * The reading is nearly always the same one. The free plan sleeps after fifteen
 * idle minutes and takes around fifty seconds to wake — see
 * {@link COLD_START_TIMEOUT_MS} — which is longer than the proxy in front of it
 * will hold the request, so the first tap after an idle spell can be answered
 * by the gateway while the server is still booting perfectly well. The request
 * is lost; the service is not. "Try again in a moment" is the whole of the
 * advice, and it is right for a restart and a deploy too.
 *
 * Note that this cannot swallow the server's own 503 — `/health` answering that
 * Postgres is unreachable — because that one carries an `error` field and
 * `stated` wins.
 */
const GATEWAY_MESSAGE =
  'The dispatch server is not answering just now. It may be starting back up — try again in a moment.';

/**
 * Whether a failed request means the server was never reached.
 *
 * The distinction the offline mirror in `apps/web` turns on, and the one it
 * used to get wrong: every rejection was read as a dropped connection, so a
 * desk whose twelve-hour session had aged out was told “no connection” by a
 * server that had answered its 401 in under a second — and told it again every
 * five seconds, over a board it could no longer refresh.
 *
 * An {@link ApiError} is only ever built from a reply that arrived, so the
 * server answered and the connection is fine. The exception is
 * {@link GATEWAY_STATUS}: those come from the proxy in front of a process that
 * did not answer *it*, which is what unreachable looks like from out here.
 *
 * Anything else is `fetch` itself rejecting — no network, no DNS, refused, or
 * this client’s own `AbortController` firing on the timeout, which arrives as
 * a {@link TimeoutError} — and none of those got an answer either.
 */
export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError ? GATEWAY_STATUS.has(error.status) : true;
}

export interface PaystackInitResult {
  status: boolean;
  authorization_url: string;
  access_code: string;
  reference: string;
}

// What a checkout is opened with — `PaystackInitPayload`, and the purpose it
// declares — lives in `./payments`, beside the builder the server writes the
// metadata with and the readers both settlement gates use.

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The header a per-booking tracking grant travels in.
 *
 * Must match `TRACKING_HEADER` on the server. A header rather than a query
 * parameter: this is only ever sent by application code, and a token in a URL is
 * a token in browser history, in the referrer of anything the page loads, and in
 * every access log between here and Supabase.
 */
export const TRACKING_HEADER = 'X-FreshFold-Tracking';

/**
 * How a caller proves it may see a booking.
 *
 * Either a session — customer, courier or supervisor, the server works out which
 * — or the tracking token handed back when the booking was created. A guest who
 * booked without an account has only the second; a signed-in customer has the
 * first; the desk has the first and sees everything.
 *
 * Both optional so a caller can pass whichever it holds, and both sent when it
 * holds both: the server takes the first one that grants access, so a customer
 * who also has a stale tracking token for the same order is not penalised for it.
 */
export interface BookingAuth {
  token?: string | null;
  trackingToken?: string | null;
}

/**
 * How full one window is, on whichever leg was asked about.
 *
 * `remaining` and `full` are both sent rather than left for the caller to
 * derive: two booking forms and a reschedule sheet render this, and three
 * copies of `booked >= capacity` is three chances to write one of them as `>`.
 */
export interface SlotState {
  slot: string;
  booked: number;
  remaining: number;
  full: boolean;
}

/** What `POST /bookings` answers with: the booking, plus the guest's grant. */
export type BookingCreated = Booking & {
  /**
   * The right to read this booking back without an account. Absent when the
   * server could not mint one, which is not fatal — a signed-in customer never
   * needed it, and a guest can ask for the setup link instead.
   */
  trackingToken?: string;
};

/**
 * What a wallet movement produced: the account as the server now has it, and
 * the statement row it wrote. Callers apply the account rather than computing
 * their own — that is the whole point of the route.
 */
export interface WalletMovement {
  account: UserAccount;
  transaction: PaymentTransaction | null;
}

export function createClient(options: ClientOptions) {
  const {
    baseUrl,
    fetchImpl,
    timeoutMs = 8000,
    coldStartMs = COLD_START_TIMEOUT_MS,
    now = Date.now,
  } = options;
  const root = baseUrl.replace(/\/$/, '');
  const doFetch: typeof fetch = fetchImpl ?? ((...args) => fetch(...args));

  // Whether this client ever spends the cold-start budget. An explicit
  // `coldStartMs` is taken as the caller knowing better than the hostname does.
  const canSleep =
    options.coldStartMs !== undefined ? coldStartMs > 0 : mayNeedWaking(root);

  /**
   * When the server last proved it was running, or 0 if it never has.
   *
   * Set from any reply the server itself sent, not just a successful one: a
   * 401 on a wrong password is as good a proof of a woken process as a 200,
   * and holding out for `response.ok` would keep spending the long budget on a
   * customer who is simply mistyping. A reply from the gateway in front of it
   * proves the opposite, and is excluded where it is recorded below.
   */
  let lastReplyAt = 0;

  /**
   * How long to let this request run.
   *
   * Not a per-launch flag but a per-idle one, because the app outlives the
   * server: a customer who books in the morning and opens the app again after
   * lunch is talking to a process that went to sleep in between, and treating
   * only the very first request of a session as cold would leave that afternoon
   * tap to fail exactly the way this is meant to stop.
   */
  function budgetMs(): number {
    if (!canSleep) return timeoutMs;
    const proven = lastReplyAt !== 0 && now() - lastReplyAt < COLD_AFTER_IDLE_MS;
    return proven ? timeoutMs : Math.max(timeoutMs, coldStartMs);
  }

  async function request<T>(
    path: string,
    init: RequestInit & { query?: Record<string, string | undefined> } = {}
  ): Promise<T> {
    const { query, ...rest } = init;

    let url = `${root}${API_PREFIX}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, value);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const controller = new AbortController();
    const waited = budgetMs();
    // Which of the two things that can abort this request actually did. The
    // caller's own signal aborts the same way, and that one is a cancellation
    // rather than a failure — nobody should be shown a sentence about it.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, waited);

    try {
      const response = await doFetch(url, {
        ...rest,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(rest.headers ?? {}),
        },
      });

      // Something answered. Recorded before the body is read: a slow or
      // truncated body says nothing about whether the server had to be woken,
      // and the next request should not be made to wait a minute again on
      // account of it.
      //
      // A gateway status is the exception, and it is the exact case the long
      // budget exists for. None of the three is ever written by our server —
      // see {@link GATEWAY_STATUS} — so a 502 is Render's router reporting
      // that the process behind it did not answer, which is what a service
      // that has gone to sleep looks like from out here. It also comes back in
      // half a second rather than hanging, so counting it as proof inverted
      // the whole mechanism: the request that woke the server marked it awake,
      // and every request for the next ten minutes was then held to
      // `timeoutMs` and aborted eight seconds into a fifty-second boot. The
      // minute went to the one request that could not use it, and was withheld
      // from all the ones that could.
      if (!GATEWAY_STATUS.has(response.status)) lastReplyAt = now();

      const text = await response.text();
      const body = text ? safeJson(text) : undefined;

      if (!response.ok) {
        // What the server said, when it was the server that answered.
        const stated =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : null;

        const message =
          stated ??
          (GATEWAY_STATUS.has(response.status)
            ? GATEWAY_MESSAGE
            : `${rest.method ?? 'GET'} ${path} failed (${response.status})`);

        throw new ApiError(message, response.status, body);
      }

      return body as T;
    } catch (error) {
      // Only our own timer, and only when the rejection really is the abort it
      // caused. Without the second half, a reply that arrived in the same tick
      // the budget expired — a 401, say — would have its sentence replaced by
      // one about a timeout, which is the opposite of what happened.
      if (timedOut && isAbortError(error)) throw new TimeoutError(waited);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const json = (method: string, payload?: unknown) => ({
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Whichever of the two grants the caller is holding, as headers. */
  const authHeaders = (auth: BookingAuth): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
    if (auth.trackingToken) headers[TRACKING_HEADER] = auth.trackingToken;
    return headers;
  };

  return {
    baseUrl: root,

    /**
     * Cheap reachability probe — both apps use it to decide online/offline.
     *
     * The body carries nothing but that. It used to include live job and rider
     * counts, which no caller here has ever read: every one of them awaits this
     * to find out whether the server answered and throws the result away.
     */
    health: () => request<{ ok: true; version: string }>('/health'),

    // -- Bookings: the customer's view ------------------------------------
    //
    // The list is a summary: it carries everything a board or a history screen
    // draws, but not the proof-of-service photographs, which are megabytes that
    // no list renders. `getBooking` is the full record, and is what a surface
    // calls when it is about to show the proof for one order.

    /**
     * The caller's own orders, or the whole board for a supervisor's token.
     *
     * There is no `email` parameter any more. It used to scope this, which meant
     * the scope was whatever the caller typed — so the route answered anybody's
     * history to anybody, and the whole ledger to a caller who passed nothing.
     * The server reads the address off the token instead.
     */
    /**
     * `limit` applies to a supervisor's whole-board read, which is the only
     * scope here that grows without bound. A customer's own orders are not
     * paged and the parameter is ignored for them. Omitted, the server's own
     * page size applies — every caller today omits it.
     */
    listBookings: (token: string, limit?: number) =>
      request<Booking[]>('/bookings', {
        query: { limit: limit === undefined ? undefined : String(limit) },
        headers: bearer(token),
      }),

    getBooking: (id: string, auth: BookingAuth) =>
      request<Booking>(`/bookings/${encodeURIComponent(id)}`, { headers: authHeaders(auth) }),

    /**
     * Books a job.
     *
     * The token is optional because a visitor can book — but a signed-in
     * customer should send it, because that is how the server knows whether
     * this booking is under a membership. `planId` in the body is ignored:
     * dispatch priority is decided from the account, not from the request.
     *
     * The response carries a `trackingToken`: the right to read this one booking
     * back without an account. Store it — for a guest it is the only claim they
     * have on the order until they set a password from the emailed link.
     */
    createBooking: (booking: Booking, token?: string | null) =>
      request<BookingCreated>('/bookings', {
        ...json('POST', booking),
        headers: token ? bearer(token) : undefined,
      }),

    /**
     * Settles a booking's bill. The only way it becomes `Paid`.
     *
     * The amount is not a parameter: the server reads what is owed off the job,
     * where its own quote put it. `Wallet` needs a customer session and debits the
     * balance server-side; `Paystack` needs the reference, which the server
     * re-verifies and checks was made for this booking; `Cash` needs a supervisor
     * token, and records that the desk says the money was handed over — there is
     * nothing external to verify, so the ledger notes who recorded it.
     *
     * Throws `ApiError` 409 with `{ reason: 'insufficient-funds', shortfall }` when
     * the wallet cannot cover it, 402 when Paystack says the payment has not
     * settled, and 403 `{ reason: 'cash-needs-supervisor' }` for a cash settlement
     * from anyone but the desk.
     */
    payForBooking: (
      id: string,
      payload: { method: 'Wallet' | 'Paystack' | 'Cash'; reference?: string },
      auth: BookingAuth
    ) =>
      request<Booking>(`/bookings/${encodeURIComponent(id)}/payment`, {
        ...json('POST', payload),
        headers: authHeaders(auth),
      }),

    /**
     * Takes back a cash settlement, returning the booking to `Pay on Pickup`.
     *
     * Supervisor only, and cash only. A wallet or Paystack payment moved real
     * money and cannot be undone by changing a status — that needs a refund — so
     * this throws `ApiError` 409 `{ reason: 'not-a-cash-settlement' }` on one.
     */
    reverseCashPayment: (id: string, auth: BookingAuth) =>
      request<Booking>(`/bookings/${encodeURIComponent(id)}/payment`, {
        ...json('DELETE'),
        headers: authHeaders(auth),
      }),

    /**
     * Rates the courier who carried a delivered order.
     *
     * The customer's alone — a courier or a supervisor calling this gets 403.
     * One rating per order, revisable: sending it again overwrites rather than
     * stacks. Returns the courier's recomputed average.
     *
     * Throws `ApiError` 409 `{ reason: 'not-delivered' }` before the work is
     * done, and `{ reason: 'no-courier' }` for an order nobody is recorded
     * against.
     */
    rateBooking: (
      id: string,
      rating: { stars: number; comment?: string },
      auth: BookingAuth
    ) =>
      request<{
        jobId: string;
        stars: number;
        comment: string;
        riderRating: number;
        riderRatingCount: number;
      }>(`/bookings/${encodeURIComponent(id)}/rating`, {
        ...json('POST', rating),
        headers: authHeaders(auth),
      }),

    /**
     * How full each collection window is on a day.
     *
     * Open, with no session — the booking form is a stranger filling in a form,
     * and this says only how busy a day is. The booking route enforces the same
     * ceiling regardless, so a form working from a stale answer is refused
     * rather than overbooking.
     */
    slotAvailability: (
      date: string,
      options: {
        /** Ask for the return windows on this day as well. */
        deliveryDate?: string;
        /**
         * A booking whose own place should not count against the windows it
         * holds — the reschedule screen, looking at the day its order is
         * already booked into.
         */
        exclude?: string;
      } = {}
    ) => {
      const query = new URLSearchParams({ date });
      if (options.deliveryDate) query.set('deliveryDate', options.deliveryDate);
      if (options.exclude) query.set('exclude', options.exclude);

      return request<{
        date: string;
        capacity: number;
        slots: SlotState[];
        /** Present only when `deliveryDate` was asked for. */
        deliveryDate?: string;
        deliveryCapacity?: number;
        deliverySlots?: SlotState[];
      }>(`/bookings/availability?${query.toString()}`);
    },

    /**
     * Moves a booking to another day or window.
     *
     * Not a patch: `PATCH /bookings/:id` no longer writes schedule fields for
     * anybody but the desk, because moving a booking has to ask whether it is
     * still movable, whether the new window has room, and whether the customer
     * has moves left. Nothing is repriced — same services, same total, same
     * reference, same hand-off codes.
     *
     * `deliveryTime` is optional: leave it out to keep the return window the
     * order already has, and the return *date* follows the new collection
     * either way.
     *
     * Throws `ApiError` 409 with a `reason` from `RescheduleRefusal`, plus
     * `'slot-full'` and `'delivery-slot-full'` for a window that has no room.
     * The `error` on it is a sentence written for the customer.
     */
    rescheduleBooking: (
      id: string,
      change: { pickupDate: string; pickupTime: string; deliveryTime?: string },
      auth: BookingAuth
    ) =>
      request<Booking>(`/bookings/${encodeURIComponent(id)}/reschedule`, {
        ...json('POST', change),
        headers: authHeaders(auth),
      }),

    /**
     * Calls a booking off.
     *
     * Not a patch. `PATCH /bookings/:id` keeps `status` on its supervisor-only
     * list, so a customer's cancellation used to be stripped on the way in — the
     * request succeeded, the field was dropped, and the order came back at the
     * stage it had never left on the next pull.
     *
     * Nothing is refunded here. A paid booking stays `Paid`, and the money is
     * returned by the desk through {@link refundBooking} — which is what the
     * cancel dialog has always said it would do.
     *
     * Idempotent: an order that is already cancelled comes back as itself, so a
     * replayed offline write is the right answer arriving twice.
     *
     * Throws `ApiError` 409 with a `reason` from `CancelRefusal` — `'collected'`
     * once the bags are on the courier, `'delivered'` once the round trip is
     * done. The `error` on it is a sentence written for the customer.
     */
    cancelBooking: (id: string, auth: BookingAuth) =>
      request<Booking>(`/bookings/${encodeURIComponent(id)}/cancel`, {
        ...json('POST', {}),
        headers: authHeaders(auth),
      }),

    /**
     * Refunds a settled booking to the customer's wallet. Supervisor only.
     *
     * The act `reverseCashPayment` refuses and points at. Whole-bill only, and
     * idempotent on the booking's own reference — clicking twice refunds once.
     *
     * Throws `ApiError` 409 `{ reason: 'not-settled' }` for a booking that was
     * never paid, and `{ reason: 'no-account' }` for a guest booking with no
     * wallet behind it.
     */
    refundBooking: (id: string, auth: BookingAuth) =>
      request<Booking>(`/bookings/${encodeURIComponent(id)}/refund`, {
        ...json('POST', {}),
        headers: authHeaders(auth),
      }),

    updateBooking: (id: string, patch: Partial<Booking>, auth: BookingAuth) =>
      request<Booking>(`/bookings/${encodeURIComponent(id)}`, {
        ...json('PATCH', patch),
        headers: authHeaders(auth),
      }),

    deleteBooking: (id: string, auth: BookingAuth) =>
      request<{ ok: true }>(`/bookings/${encodeURIComponent(id)}`, {
        ...json('DELETE'),
        headers: authHeaders(auth),
      }),

    // -- Orders: the rider's view -----------------------------------------
    //
    // Staff only, and every courier id is taken from the token rather than sent.
    // `riderId` used to be a query parameter and a body field, which is to say
    // the caller chose whose board they saw and who a job was assigned to.

    /** The courier's own board plus the open pool, or everything for the desk. */
    listOrders: (token: string) => request<Order[]>('/orders', { headers: bearer(token) }),

    /** One order with its proof photographs, which the list leaves behind. */
    getOrder: (id: string, token: string) =>
      request<Order>(`/orders/${encodeURIComponent(id)}`, { headers: bearer(token) }),

    /** Injects a job with no booking behind it. Supervisor only. */
    createOrder: (order: Order, token: string) =>
      request<Order>('/orders', { ...json('POST', order), headers: bearer(token) }),

    acceptOrder: (id: string, token: string) =>
      request<Order>(`/orders/${encodeURIComponent(id)}/accept`, {
        ...json('POST'),
        headers: bearer(token),
      }),

    declineOrder: (id: string, token: string) =>
      request<Order>(`/orders/${encodeURIComponent(id)}/decline`, {
        ...json('POST'),
        headers: bearer(token),
      }),

    /**
     * Advances a job.
     *
     * Takes a {@link BookingAuth} rather than a bare rider token because the
     * customer's own app uses this too — it completes the delivery leg with their
     * signature and code, and attaches a photo when reporting a problem. The
     * server applies a tighter rule set to a customer than to the courier holding
     * the job: no override, no bag manifest, and no stage but those two.
     */
    updateOrderStatus: (
      id: string,
      patch: {
        status: JobStatus;
        photo?: string;
        signature?: string;
        bags?: LaundryBag[];
        /**
         * The four digits the customer read out at the door. Required to
         * complete a delivery — the server checks it, and rejects the
         * transition without either this or `overrideReason`.
         */
        deliveryCode?: string;
        /**
         * The four digits on the hub desk's screen. Required to check a load
         * in — the server checks it, and rejects `dropped_off` without either
         * this or `overrideReason`.
         */
        dropoffCode?: string;
        /**
         * Why a hand-off completed without the other party's code. Applies to
         * whichever leg the `status` names.
         */
        overrideReason?: string;
        /**
         * What actually happened to the load, when the desk confirms a hub
         * stage. Recorded in `hub_events` beside the audit line: the trail
         * answers who confirmed the wash, this answers which machine ran it.
         */
        hub?: { machine?: string; batch?: string; notes?: string };
      },
      auth: BookingAuth
    ) =>
      request<Order>(`/orders/${encodeURIComponent(id)}/status`, {
        ...json('PATCH', patch),
        headers: authHeaders(auth),
      }),

    // -- The laundry itself ------------------------------------------------

    /**
     * Checks a load in at the hub: what is in each bag, and what it weighs.
     *
     * Supervisor only. This is where `LaundryBag.itemCount` and `weight` come
     * from — before it existed they were minted with the booking from the digits
     * of the job id and shown to the customer as measurements.
     *
     * Idempotent per bag: re-checking one overwrites its count rather than
     * adding to it, because somebody recounting is correcting themselves.
     */
    checkInLoad: (
      id: string,
      payload: {
        bags: { id: string; itemCount?: number; weight?: string }[];
        /** The garments worth naming. Not every sock — see `job_garments`. */
        garments?: { bagId?: string; description: string; condition?: string }[];
        machine?: string;
        batch?: string;
        notes?: string;
      },
      token: string
    ) =>
      request<Order>(`/orders/${encodeURIComponent(id)}/intake`, {
        ...json('POST', payload),
        headers: bearer(token),
      }),

    /** What happened to this order at the hub, and what was in it. Staff only. */
    orderProduction: (id: string, token: string) =>
      request<{ events: HubEvent[]; garments: Garment[] }>(
        `/orders/${encodeURIComponent(id)}/production`,
        { headers: bearer(token) }
      ),

    // -- Claims ------------------------------------------------------------

    /**
     * Raises a problem against an order.
     *
     * Open to whoever can read the booking, so a guest holding a tracking token
     * can report one. The courier is refused — they are frequently the subject.
     *
     * Throws `ApiError` 409 `{ reason: 'window-closed' }` past the fortnight,
     * and `{ reason: 'too-many' }` for an order already carrying ten.
     */
    raiseClaim: (
      jobId: string,
      claim: { kind: string; description: string; photo?: string },
      auth: BookingAuth
    ) =>
      request<Claim>(`/claims/job/${encodeURIComponent(jobId)}`, {
        ...json('POST', claim),
        headers: authHeaders(auth),
      }),

    /** Every claim on one order. Whoever can read the order can read these. */
    claimsForJob: (jobId: string, auth: BookingAuth) =>
      request<Claim[]>(`/claims/job/${encodeURIComponent(jobId)}`, {
        headers: authHeaders(auth),
      }),

    /** The customer's own claims across every order. */
    myClaims: (token: string) => request<Claim[]>('/claims/mine', { headers: bearer(token) }),

    /** The desk's queue. Open ones by default; `all` for the settled history. */
    listClaims: (token: string, options: { all?: boolean } = {}) =>
      request<Claim[]>(`/claims${options.all ? '?all=1' : ''}`, { headers: bearer(token) }),

    /**
     * Moves a claim on. Supervisor only.
     *
     * `resolved` is reachable only from `upheld` — the laundry cannot record a
     * customer as made whole without first agreeing something was owed. A
     * compensation on the move to `resolved` is credited to their wallet before
     * the row is written, keyed on the claim id so clicking twice pays once.
     */
    updateClaim: (
      id: string,
      patch: {
        status?: ClaimStatus;
        resolution?: string;
        compensation?: number;
        retreatment?: boolean;
        /** The garment this is about, flagged on the intake record. */
        garmentId?: string;
      },
      token: string
    ) =>
      request<Claim>(`/claims/${encodeURIComponent(id)}`, {
        ...json('PATCH', patch),
        headers: bearer(token),
      }),

    // -- Enquiries ---------------------------------------------------------

    /**
     * Sends the website's contact form.
     *
     * No token: a contact form behind a sign-in is not a contact form, and the
     * people it exists for are the ones with no account yet.
     *
     * `delivered` in the response is not "we have it" — the 201 is that, and
     * the enquiry is on the server's table before this resolves. It says
     * whether the desk's copy reached the mail provider, so a form can tell
     * somebody their message is waiting rather than claiming it has landed in
     * an inbox it cannot see.
     */
    sendEnquiry: (enquiry: { name: string; email?: string; message: string }) =>
      request<{ ok: true; delivered: boolean }>('/contact', json('POST', enquiry)),

    /**
     * What has come in through it. Supervisor only.
     *
     * `undelivered` narrows it to the enquiries nobody was emailed about, which
     * is the list to check when somebody says they wrote in and heard nothing.
     */
    listEnquiries: (token: string, options: { undelivered?: boolean } = {}) =>
      request<Enquiry[]>('/contact', {
        headers: bearer(token),
        query: { undelivered: options.undelivered ? '1' : undefined },
      }),

    // -- Shifts ------------------------------------------------------------

    /** The rota across the fleet for a window. Defaults to the coming week. */
    rosterShifts: (token: string, window: { from?: string; to?: string } = {}) => {
      const query = new URLSearchParams();
      if (window.from) query.set('from', window.from);
      if (window.to) query.set('to', window.to);
      const suffix = query.toString();

      return request<RiderShift[]>(`/riders/shifts${suffix ? `?${suffix}` : ''}`, {
        headers: bearer(token),
      });
    },

    /** One courier's blocks. Staff only. */
    riderShifts: (riderId: string, token: string) =>
      request<RiderShift[]>(`/riders/${encodeURIComponent(riderId)}/shifts`, {
        headers: bearer(token),
      }),

    /**
     * The courier's own rota, keyed on their session.
     *
     * A courier refused a job for being off shift needs to see when they are on
     * without asking the desk.
     */
    myShifts: (token: string) =>
      request<RiderShift[]>('/riders/me/shifts', { headers: bearer(token) }),

    /**
     * Rosters a courier. Supervisor only.
     *
     * Throws `ApiError` 409 `{ reason: 'overlaps' }` when it collides with a
     * block they already have, `'too-long'` past `MAX_SHIFT_HOURS`, and
     * `'invalid-range'` for an end that is not after its start.
     */
    createShift: (
      riderId: string,
      shift: { startsAt: string; endsAt: string; note?: string },
      token: string
    ) =>
      request<RiderShift>(`/riders/${encodeURIComponent(riderId)}/shifts`, {
        ...json('POST', shift),
        headers: bearer(token),
      }),

    deleteShift: (shiftId: string, token: string) =>
      request<{ ok: true }>(`/riders/shifts/${encodeURIComponent(shiftId)}`, {
        ...json('DELETE'),
        headers: bearer(token),
      }),

    // -- Promo codes and referrals -----------------------------------------

    /**
     * What a code is worth on a bill, before committing to the order.
     *
     * Advisory. `POST /bookings` re-runs the same check against the row it is
     * holding, because the last redemption of a limited code may be somebody
     * else's and may land between this call and that one. Never throws for a
     * refused code — it answers `{ ok: false, reason }`, because "that code has
     * expired" is an answer rather than an error.
     */
    checkPromoCode: (input: { code: string; subtotal: number; email?: string }) =>
      request<
        | { ok: true; code: string; discount: number; label: string }
        | { ok: false; reason: string; error: string }
      >('/promotions/check', json('POST', input)),

    /** Every code, with what it has cost. Supervisor only. */
    listPromoCodes: (token: string) =>
      request<PromoCode[]>('/promotions', { headers: bearer(token) }),

    /** One code's redemptions — the campaign report. */
    promoRedemptions: (code: string, token: string) =>
      request<PromoRedemption[]>(`/promotions/${encodeURIComponent(code)}/redemptions`, {
        headers: bearer(token),
      }),

    /** Creates or edits a code. Supervisor only. An upsert: the code is the key. */
    savePromoCode: (
      code: string,
      promo: {
        label?: string;
        kind: 'percent' | 'amount';
        /** A fraction for `percent` — 0.2 is 20% — and cedis for `amount`. */
        value: number;
        maxDiscount?: number;
        minSpend?: number;
        startsAt?: string;
        expiresAt?: string;
        maxUses?: number;
        maxPerCustomer?: number;
        firstOrderOnly?: boolean;
        active?: boolean;
      },
      token: string
    ) =>
      request<PromoCode>(`/promotions/${encodeURIComponent(code)}`, {
        ...json('PUT', promo),
        headers: bearer(token),
      }),

    /** The customer's own referral code, minting one if they have none. */
    myReferral: (token: string) =>
      request<{
        code: string;
        reward: number;
        welcome: number;
        invited: number;
        rewarded: number;
      }>('/promotions/referral/mine', { headers: bearer(token) }),

    /**
     * Claims somebody else's referral code.
     *
     * Nothing is paid here — the referrer earns when this customer's first order
     * completes, because rewarding a registration rewards making accounts.
     *
     * Throws `ApiError` 409 `{ reason: 'self-referral' }` and
     * `{ reason: 'already-referred' }`.
     */
    claimReferral: (code: string, token: string) =>
      request<{ ok: true; referredBy: string; welcome: number }>('/promotions/referral/claim', {
        ...json('POST', { code }),
        headers: bearer(token),
      }),

    // -- Standing orders ---------------------------------------------------

    listRecurring: (token: string) =>
      request<RecurringPickup[]>('/recurring', { headers: bearer(token) }),

    /**
     * Creates or edits a standing order.
     *
     * A `PUT` with a client-supplied id, so a replayed offline write lands on
     * the same row rather than making a second weekly pickup nobody asked for —
     * which would be a courier at somebody's door every week for a wash they are
     * not expecting and will be charged for.
     */
    saveRecurring: (
      id: string,
      pickup: {
        weekday: number;
        pickupTime: string;
        deliveryTime?: string;
        items: BookingItem[];
        scent?: string;
        starch?: string;
        addons?: string[];
        address: string;
        suburb: string;
        city?: string;
        pickupCoords?: Coords;
        notes?: string;
        active?: boolean;
        leadDays?: number;
        startsOn?: string;
        endsOn?: string;
      },
      token: string
    ) =>
      request<RecurringPickup>(`/recurring/${encodeURIComponent(id)}`, {
        ...json('PUT', pickup),
        headers: bearer(token),
      }),

    deleteRecurring: (id: string, token: string) =>
      request<{ ok: true }>(`/recurring/${encodeURIComponent(id)}`, {
        ...json('DELETE'),
        headers: bearer(token),
      }),

    // -- Invoices ----------------------------------------------------------

    listInvoices: (token: string, options: { outstanding?: boolean } = {}) =>
      request<Invoice[]>(`/invoices${options.outstanding ? '?outstanding=1' : ''}`, {
        headers: bearer(token),
      }),

    /** The signed-in customer's own. */
    myInvoices: (token: string) =>
      request<Invoice[]>('/invoices/mine', { headers: bearer(token) }),

    getInvoice: (id: string, token: string) =>
      request<Invoice>(`/invoices/${encodeURIComponent(id)}`, { headers: bearer(token) }),

    createInvoice: (
      invoice: {
        billToEmail: string;
        billToName?: string;
        billToOrg?: string;
        billToAddress?: string;
        billToTin?: string;
        periodStart?: string;
        periodEnd?: string;
        dueOn?: string;
        notes?: string;
      },
      token: string
    ) => request<Invoice>('/invoices', { ...json('POST', invoice), headers: bearer(token) }),

    /**
     * Adds a line to a draft.
     *
     * Naming a `jobId` fills the description and price from the order and
     * refuses one that is already on another invoice — a collection appearing on
     * two documents is the mistake that costs a corporate relationship.
     */
    addInvoiceLine: (
      id: string,
      line: { jobId?: string; description?: string; quantity?: number; unitPrice?: number },
      token: string
    ) =>
      request<Invoice>(`/invoices/${encodeURIComponent(id)}/lines`, {
        ...json('POST', line),
        headers: bearer(token),
      }),

    removeInvoiceLine: (id: string, lineId: string, token: string) =>
      request<Invoice>(
        `/invoices/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
        { ...json('DELETE'), headers: bearer(token) }
      ),

    /**
     * Issues, settles or voids one.
     *
     * `issued` freezes the numbers — from that point the totals are never
     * recomputed, because an invoice states what was owed on the day it was
     * issued. Going back to `draft` is refused for the same reason.
     */
    updateInvoice: (
      id: string,
      patch: { status?: InvoiceStatus; paid?: number; dueOn?: string },
      token: string
    ) =>
      request<Invoice>(`/invoices/${encodeURIComponent(id)}`, {
        ...json('PATCH', patch),
        headers: bearer(token),
      }),

    // -- Branches ----------------------------------------------------------

    /** Every branch. Staff only. Falls back to the seeded one. */
    listHubs: (token: string) => request<Hub[]>('/hubs', { headers: bearer(token) }),

    saveHub: (
      id: string,
      hub: {
        name: string;
        address?: string;
        lat: number;
        lng: number;
        /** Must be names from `SERVICE_SUBURBS` — `hubForPickup` matches exactly. */
        suburbs?: string[];
        active?: boolean;
      },
      token: string
    ) =>
      request<Hub>(`/hubs/${encodeURIComponent(id)}`, {
        ...json('PUT', hub),
        headers: bearer(token),
      }),

    // -- Auth --------------------------------------------------------------
    //
    // The password is sent here and compared here. It is never stored in, or
    // returned to, the browser.

    register: (payload: {
      email: string;
      phone: string;
      name: string;
      password: string;
    }) => request<AuthSession>('/auth/register', json('POST', payload)),

    /** `identifier` is an email address or a phone number. */
    login: (payload: { identifier: string; password: string }) =>
      request<AuthSession>('/auth/login', json('POST', payload)),

    /**
     * Sends another email-confirmation link to the signed-in account.
     *
     * Throws a 429 with a human message when pressed twice in quick succession,
     * and a 409 once the address is already confirmed — both worth showing the
     * customer verbatim rather than mapping to a generic failure.
     */
    resendVerification: (token: string) =>
      request<{ ok: true }>('/auth/resend-verification', {
        method: 'POST',
        headers: bearer(token),
      }),

    /**
     * Asks for a password-reset link.
     *
     * `identifier` is an email address or a phone number — whichever the
     * customer remembers. Always resolves `{ ok: true }` when the request was
     * well-formed, whether or not an account exists and whether or not the mail
     * went out: the server will not confirm who banks here, so there is nothing
     * for a caller to branch on. The UI says "if that address has an account,
     * a link is on its way" and means it.
     */
    requestPasswordReset: (identifier: string) =>
      request<{ ok: true }>('/auth/forgot', json('POST', { identifier })),

    /**
     * Spends a reset link and sets the new password.
     *
     * The emailed page calls this itself, so the apps do not have to — it is
     * here for a surface that wants to collect the password in-app instead.
     * Every existing session for the account is revoked on success, including
     * the caller's own.
     */
    resetPassword: (payload: { token: string; password: string }) =>
      request<{ ok: true }>('/auth/reset', json('POST', payload)),

    /**
     * The booking behind an emailed setup link.
     *
     * `token` is the one in the link and nothing else identifies the order, so
     * a 400 here means the link is spent, expired or never existed — the server
     * does not say which.
     */
    setupLinkBooking: (token: string) =>
      request<{ booking: { id: string; name: string; email: string; phone: string } }>(
        '/auth/claim',
        { query: { token } }
      ),

    /**
     * Spends a setup link: sets the first password on the booking's account and
     * returns a session for it.
     *
     * The counterpart to `register` for somebody who booked as a guest. Which
     * account it opens is decided by the token, never by the caller — there is
     * deliberately no email or phone in this payload.
     */
    claimBooking: (payload: { token: string; password: string }) =>
      request<AuthSession>('/auth/claim', json('POST', payload)),

    /**
     * Asks for the setup link to be sent again.
     *
     * For a customer who booked as a guest and lost the confirmation email —
     * `requestPasswordReset` cannot help them, because there is no account to
     * reset. Always resolves `{ ok: true }` for a well-formed request, whatever
     * the server found: it will not confirm who has booked with FreshFold.
     */
    requestSetupLink: (identifier: string) =>
      request<{ ok: true }>('/auth/resend-setup', json('POST', { identifier })),

    /** Does this contact already have a login? Returns booleans only. */
    authStatus: (identifier: string) =>
      request<{ exists: boolean; hasPassword: boolean }>('/auth/status', json('POST', { identifier })),

    logout: (token: string) =>
      request<{ ok: true }>('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),

    /** Re-validates a stored token on load; throws 401 once it has expired. */
    me: (token: string) =>
      request<UserAccount>('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),

    // -- Supervisor desk ---------------------------------------------------
    //
    // Supervisors are provisioned, so there is no register call. This session
    // is what the roster-management endpoints require.

    adminLogin: (payload: { email: string; password: string }) =>
      request<AdminSession>('/admin/login', json('POST', payload)),

    adminMe: (token: string) =>
      request<SupervisorProfile>('/admin/me', { headers: bearer(token) }),

    adminLogout: (token: string) =>
      request<{ ok: true }>('/admin/logout', { method: 'POST', headers: bearer(token) }),

    /**
     * The desk's audit trail, newest first.
     *
     * Server-owned and shared: there is no write counterpart here, because an
     * entry is filed by the route that performs the action rather than claimed
     * by the browser that asked for it. Nothing is pruned server-side, so
     * `limit` is a page size — 200 by default, 500 at most.
     */
    listAuditEvents: (token: string, limit?: number) =>
      request<AuditEvent[]>(
        limit ? `/admin/audit?limit=${limit}` : '/admin/audit',
        { headers: bearer(token) }
      ),

    // -- Riders ------------------------------------------------------------
    //
    // Couriers are provisioned, never self-registered, so there is no register
    // call here. Everything below the login needs the token it returns: the
    // roster is staff data, and a position update is a claim about where a
    // named person is.

    /** `identifier` is an employee ID or the courier's phone number. */
    riderLogin: (payload: { identifier: string; pin: string }) =>
      request<RiderSession>('/riders/login', json('POST', payload)),

    /** Re-validates a stored token on launch; throws 401 once it has expired. */
    riderMe: (token: string) =>
      request<RiderState>('/riders/me', { headers: bearer(token) }),

    riderLogout: (token: string) =>
      request<{ ok: true }>('/riders/logout', { method: 'POST', headers: bearer(token) }),

    /**
     * Puts a courier on the roster. Supervisor only.
     *
     * The employee ID is assigned by the server and read off the returned
     * rider. The temporary PIN comes back exactly once, in this response — it
     * is hashed on the way in and cannot be read again. Losing it means issuing
     * another.
     */
    createRider: (
      payload: { name?: string; phone: string; vehicle: string; vehiclePlate: string },
      token: string
    ) =>
      request<{ rider: RiderState; temporaryPin: string; pinExpiresAt: string }>(
        '/riders',
        { ...json('POST', payload), headers: bearer(token) }
      ),

    /**
     * Reassigns the vehicle a courier rides. Supervisor only.
     *
     * Vehicles move between couriers — a scooter goes in for repair and its
     * rider takes another — so this exists as well as the field on creation.
     * The courier's own app cannot write either value.
     */
    setRiderVehicle: (
      id: string,
      payload: { vehicle: string; vehiclePlate: string },
      token: string
    ) =>
      request<RiderState>(`/riders/${encodeURIComponent(id)}/vehicle`, {
        ...json('PATCH', payload),
        headers: bearer(token),
      }),

    /** Takes a courier off the roster, or puts them back. Supervisor only. */
    setRiderActive: (id: string, active: boolean, token: string) =>
      request<RiderState>(`/riders/${encodeURIComponent(id)}/active`, {
        ...json('PATCH', { active }),
        headers: bearer(token),
      }),

    /**
     * Replaces a temporary PIN with one only the courier knows.
     *
     * Answers with a **replacement token**, and the caller has to adopt it.
     * Changing a PIN revokes every session that was signed in on the old one —
     * which is the point of changing it, and includes the one making this call.
     * Keeping the old token would mean the next request 401ing on a phone whose
     * owner had just done the right thing.
     */
    changeRiderPin: (payload: { currentPin: string; newPin: string }, token: string) =>
      request<{ ok: true; token: string }>('/riders/change-pin', {
        ...json('POST', payload),
        headers: bearer(token),
      }),

    /**
     * The road route between two points, as the courier would ride it.
     *
     * Computed by the dispatch server so the routing key stays out of every
     * client bundle and one answer is shared by all three apps. Falls back to
     * a straight line — flagged as such in `source` — when routing is
     * unavailable, so callers never have to handle an error to draw a map.
     */
    getDirections: (from: Coords, to: Coords) =>
      request<RouteLeg>(
        `/directions?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`
      ),

    /**
     * Addresses matching what the customer has typed so far.
     *
     * `sessionToken` groups the keystrokes of one lookup with the detail call
     * that ends it, which is how Google bills a search as one search rather
     * than as eight autocompletes. Mint one per lookup and discard it after
     * `getPlace`.
     */
    searchPlaces: (query: string, sessionToken: string) =>
      request<PlaceSuggestion[]>(
        `/places/search?q=${encodeURIComponent(query)}&session=${encodeURIComponent(sessionToken)}`
      ),

    /** Turns a chosen suggestion into an address and a coordinate. */
    getPlace: (id: string, sessionToken: string) =>
      request<PlaceDetail>(
        `/places/${encodeURIComponent(id)}?session=${encodeURIComponent(sessionToken)}`
      ),

    listRiders: (token: string) => request<RiderState[]>('/riders', { headers: bearer(token) }),

    getRider: (id: string, token: string) =>
      request<RiderState>(`/riders/${encodeURIComponent(id)}`, { headers: bearer(token) }),

    updateRider: (id: string, telemetry: RiderTelemetry, token: string) =>
      request<RiderState>(`/riders/${encodeURIComponent(id)}`, {
        ...json('PATCH', telemetry),
        headers: bearer(token),
      }),

    // -- Messaging ---------------------------------------------------------
    //
    // A thread belongs to a job, and reading or writing one means being a party
    // to that job. `orderId` is required for everything but a supervisor's
    // whole-ledger read: an unscoped list used to answer anybody with every
    // conversation in the system.

    /** One job's thread. Any party to the job may read it. */
    listMessages: (orderId: string, auth: BookingAuth) =>
      request<Message[]>('/messages', {
        query: { orderId },
        headers: authHeaders(auth),
      }),

    /**
     * Every thread, newest traffic first. Supervisor only.
     *
     * Paged rather than capped: the server answers the most recent `limit`
     * messages across the whole ledger, oldest-first within that page. This
     * table gets a line for every status change on every job, so the desk's
     * inbox asks for a page of it rather than all of history.
     */
    listAllMessages: (token: string, limit?: number) =>
      request<Message[]>('/messages', {
        query: { limit: limit === undefined ? undefined : String(limit) },
        headers: bearer(token),
      }),

    /**
     * Writes into a job's thread.
     *
     * `sender` is no longer part of this: the server derives it from the token,
     * because a client that declares its own could write to a customer as
     * `dispatcher` — which is the voice they read as FreshFold's.
     */
    postMessage: (
      message: Omit<Message, 'id' | 'timestamp' | 'sender'> & { orderId: string } & Partial<Message>,
      auth: BookingAuth
    ) => request<Message>('/messages', { ...json('POST', message), headers: authHeaders(auth) }),

    /**
     * The caller's notifications: the desk's whole feed, a courier's board, or a
     * customer's own orders. Scoped server-side per audience.
     */
    listNotifications: (token: string) =>
      request<Notification[]>('/notifications', { headers: bearer(token) }),

    postNotification: (
      notification: Omit<Notification, 'id' | 'timestamp'> & Partial<Notification>,
      token: string
    ) =>
      request<Notification>('/notifications', {
        ...json('POST', notification),
        headers: bearer(token),
      }),

    markNotificationRead: (id: string, token: string) =>
      request<Notification>(`/notifications/${encodeURIComponent(id)}/read`, {
        ...json('POST'),
        headers: bearer(token),
      }),

    // -- Accounts ----------------------------------------------------------
    //
    // Profile data only. Credentials are not readable or writable here; see
    // the auth routes above.

    /** The patron table, oldest first. Supervisor only, and paged. */
    listAccounts: (token: string, limit?: number) =>
      request<UserAccount[]>('/accounts', {
        query: { limit: limit === undefined ? undefined : String(limit) },
        headers: bearer(token),
      }),

    /**
     * Saves the signed-in customer's own profile.
     *
     * The address comes off the token server-side, so this cannot be pointed at
     * somebody else's account — which is what it was for, before there was a
     * token to read.
     */
    upsertAccount: (account: UserAccount, token: string) =>
      request<UserAccount>('/accounts', { ...json('PUT', account), headers: bearer(token) }),

    /**
     * Replaces the signed-in customer's saved address book.
     *
     * Its own call rather than a field on `upsertAccount`, and for the reason
     * the wallet has its own: that route takes a whole account object, so both
     * apps send every field they are holding whenever a name or a number
     * changes. A book carried along on those writes would be the book as that
     * device last saw it — which is how saving a name on a phone that had not
     * polled in the last few seconds would delete an address added on the
     * website. Nothing but this call moves the book, so nothing else can lose
     * it.
     *
     * The whole array, not a delta. One entry is the default and the server
     * decides which, so a change to any entry is a statement about all of them;
     * sending the book is what lets that be settled in one round trip. Build the
     * array with `withAddress` / `withoutAddress` so the client's copy and the
     * server's agree on the outcome.
     *
     * Returns the saved account, with the book the server actually stored —
     * capped at `MAX_SAVED_ADDRESSES` and normalised. Apply the response rather
     * than the array that was sent.
     */
    saveAddresses: (addresses: SavedAddress[], token: string) =>
      request<UserAccount>('/accounts/addresses', {
        ...json('PUT', { addresses }),
        headers: bearer(token),
      }),

    /**
     * Awards or deducts care points. Supervisor only.
     *
     * A delta, not a total: the server applies it to whatever the balance is
     * when it gets there, so two grants made at once cannot lose one another.
     * A deduction below zero clamps at zero.
     */
    adjustAccountPoints: (
      email: string,
      payload: { delta: number; reason?: string },
      token: string
    ) =>
      request<UserAccount>(`/accounts/${encodeURIComponent(email)}/points`, {
        ...json('PATCH', payload),
        headers: bearer(token),
      }),

    /**
     * Suspends a customer, or lifts the suspension. Supervisor only.
     *
     * The reason is for the desk's record and comes back on this response; it
     * is not published on the account list, and the customer is never shown it.
     */
    setAccountBlocked: (
      email: string,
      payload: { blocked: boolean; reason?: string },
      token: string
    ) =>
      request<UserAccount>(`/accounts/${encodeURIComponent(email)}/blocked`, {
        ...json('PATCH', payload),
        headers: bearer(token),
      }),

    /**
     * Erases a customer account. Supervisor only, and refused while they still
     * have a job on the board — blocking is what stops somebody mid-flight.
     *
     * Their past orders stay in the ledger: a job carries its own copy of the
     * customer's details and is not joined back to the account.
     */
    deleteAccount: (email: string, token: string) =>
      request<{ ok: true }>(`/accounts/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: bearer(token),
      }),

    /**
     * Closes the signed-in customer's own account.
     *
     * The address comes off the token, like `upsertAccount` above, so there is
     * no email to pass and no way to point this at anybody else. Refused with
     * 409 `{ code: 'ACCOUNT_HAS_LIVE_ORDERS', orders }` while a pickup is still
     * out — deleting the account would not call it back, it would only remove
     * the person the courier rings from the gate.
     *
     * On success every session for the account is revoked, this one included, so
     * the token in hand is dead the moment it resolves. Their past orders stay
     * in the ledger, for the reason `deleteAccount` gives. A wallet balance or a
     * running plan is forfeited — there is no refund path — so ask before
     * calling this, and say so in the asking.
     */
    deleteOwnAccount: (token: string) =>
      request<{ ok: true }>('/accounts/me', { method: 'DELETE', headers: bearer(token) }),

    // -- Membership --------------------------------------------------------
    //
    // A plan is a paid entitlement, so every call here carries the customer's
    // token and the server decides what the plan costs and when it ends. The
    // app cannot write a membership any other way — `upsertAccount` above will
    // not accept one.

    /** The membership as the server has it, with any due renewal settled. */
    getPlan: (token: string) =>
      request<{ plan: ActivePlan | null; account: UserAccount | null }>('/accounts/plan', {
        headers: bearer(token),
      }),

    /**
     * Starts a plan, or switches to one.
     *
     * The wallet is debited by the server for the prorated amount, and the
     * ledger entry is written in the same transaction — which is why there is
     * no separate `chargeWallet` call on this path. A switch returns the
     * `credit` applied from the plan being replaced.
     *
     * Throws `ApiError` 409 with `{ reason: 'insufficient-funds', shortfall }`
     * when the wallet cannot cover it.
     */
    subscribeToPlan: (planId: string, token: string) =>
      request<{ account: UserAccount; plan: ActivePlan; charged: number; credit: number }>(
        '/accounts/plan',
        { ...json('POST', { planId }), headers: bearer(token) }
      ),

    /** Ends the plan when the paid period runs out — never mid-period. */
    cancelPlan: (token: string) =>
      request<{ account: UserAccount; plan: ActivePlan | null; activeUntil: string }>(
        '/accounts/plan',
        { method: 'DELETE', headers: bearer(token) }
      ),

    /** Undoes a pending cancellation while the period is still running. */
    resumePlan: (token: string) =>
      request<{ account: UserAccount; plan: ActivePlan | null; activeUntil: string }>(
        '/accounts/plan',
        { method: 'DELETE', headers: bearer(token), query: { resume: 'true' } }
      ),

    // -- Wallet and care points --------------------------------------------
    //
    // The one path that moves a balance or a points total, and the reason
    // neither app computes either any more: `upsertAccount` will not write them.
    // The server debits, credits, awards the point-per-cedi and writes the
    // ledger entry as one transaction, then hands back the account it produced.
    //
    // `reference` is optional and makes the movement idempotent — pass one from
    // an offline queue so a replayed write does not move the balance twice.

    /**
     * Credits the wallet against a settled Paystack payment. Earns no points.
     *
     * `reference` is Paystack's, and is required: the server re-verifies it and
     * credits the amount Paystack reports collecting. There is deliberately no
     * `amount` parameter — the caller does not get to name the figure.
     */
    topUpWallet: (payload: { method: string; reference: string }, token: string) =>
      request<WalletMovement>('/accounts/wallet', {
        ...json('POST', { action: 'topup', ...payload }),
        headers: bearer(token),
      }),

    /**
     * Debits the wallet and awards the points that spend is worth.
     *
     * Throws `ApiError` 409 with `{ reason: 'insufficient-funds', shortfall }`
     * when the balance cannot cover it.
     */
    chargeWallet: (
      payload: { amount: number; description: string; bookingId?: string; reference?: string },
      token: string
    ) =>
      request<WalletMovement>('/accounts/wallet', {
        ...json('POST', { action: 'charge', ...payload }),
        headers: bearer(token),
      }),

    /**
     * Spends care points on a reward from the shared catalogue.
     *
     * Throws `ApiError` 409 with `{ reason: 'insufficient-points', shortfall }`
     * when the balance is short.
     */
    redeemReward: (payload: { rewardId: string; reference?: string }, token: string) =>
      request<WalletMovement>('/accounts/wallet', {
        ...json('POST', { action: 'redeem', ...payload }),
        headers: bearer(token),
      }),

    // -- Payment ledger ----------------------------------------------------
    //
    // Scoped by the token: a customer's own statement, or the whole ledger for a
    // supervisor. It used to be scoped by `?email=`, so it answered any
    // customer's payments to anyone who knew their address.

    listTransactions: (token: string) =>
      request<PaymentTransaction[]>('/transactions', { headers: bearer(token) }),

    // -- Integrations ------------------------------------------------------
    chat: (history: ChatMessage[]) =>
      request<{ reply: string }>('/chat', json('POST', { history })),

    initializePayment: (payload: PaystackInitPayload) =>
      request<PaystackInitResult>('/paystack/initialize', json('POST', payload)),

    verifyPayment: (reference: string) =>
      request<{ status: boolean; data: Record<string, unknown> }>(
        `/paystack/verify/${encodeURIComponent(reference)}`
      ),
  };
}

export type FreshFoldClient = ReturnType<typeof createClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

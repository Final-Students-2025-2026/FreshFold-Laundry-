/**
 * What happened on the page, and what broke.
 *
 * ## Why this exists
 *
 * Nothing on this site could answer "where do people stop booking?". The
 * booking form is six steps, the last of which hands the customer to Paystack,
 * and if everybody were abandoning it at the address field there was no way to
 * find out — the first anyone would know is a quiet week.
 *
 * ## What it is not
 *
 * Not a third-party tag. The site's CSP is `connect-src 'self'` and its
 * `script-src` is `'self'`, so a Google Analytics or Segment snippet would be
 * blocked outright — and rightly: this page collects addresses and phone
 * numbers, and the fix for not knowing your funnel is not to hand a customer
 * list to an ad network.
 *
 * Events go to this site's own origin or nowhere at all.
 *
 * ## Turning it on
 *
 * Off unless `VITE_ANALYTICS_PATH` is set — there is no endpoint on the
 * dispatch server yet, and a module that posts into the void on every click
 * would be worse than one that does nothing. Set it to a same-origin path
 * (`/api/events`) once the server has somewhere to put them. The call sites
 * are already in place, so that is the whole change.
 *
 * In development, events are logged instead, which is what makes the
 * instrumentation checkable without a backend.
 */

/**
 * The events this site records.
 *
 * A closed union rather than free strings: the point of a funnel is to compare
 * the same step over time, which does not survive somebody writing
 * `booking_step` in one place and `bookingStep` in another.
 */
export type EventName =
  | 'booking_opened'
  | 'booking_step'
  | 'booking_submitted'
  | 'booking_confirmed'
  | 'booking_failed'
  | 'booking_abandoned'
  | 'payment_started'
  | 'payment_returned'
  | 'portal_opened'
  | 'order_tracked'
  | 'estimator_used'
  | 'area_checked'
  | 'contact_sent'
  | 'chunk_load_failed'
  | 'render_error'
  | 'unhandled_error';

export interface AnalyticsEvent {
  name: EventName;
  /**
   * Anything that helps read the event later. Keep it to counts, ids, service
   * names and error messages — see `scrub` below, which is the backstop rather
   * than the policy.
   */
  props?: Record<string, string | number | boolean | null | undefined>;
  at: number;
}

const ENDPOINT = import.meta.env.VITE_ANALYTICS_PATH ?? '';
const DEV = import.meta.env.DEV;

/**
 * Honour Do Not Track, and the Global Privacy Control with it.
 *
 * There is no legal obligation here and the data is first-party, which is
 * exactly why it is worth doing: somebody who has set this has said what they
 * want, and the cost of listening is a slightly smaller sample.
 */
function optedOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const dnt =
    navigator.doNotTrack ??
    (window as unknown as { doNotTrack?: string }).doNotTrack ??
    (navigator as unknown as { msDoNotTrack?: string }).msDoNotTrack;
  if (dnt === '1' || dnt === 'yes') return true;
  return (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/**
 * Keys that must never leave the browser on an event, whatever a call site
 * passes.
 *
 * This is a laundry site: the booking form holds a name, a phone number, a
 * delivery address and a pin on a map. None of that tells you anything about a
 * funnel that a step number does not, and all of it is the kind of thing that
 * ends up in a log by accident — somebody spreads the whole form state into
 * `props` while debugging and it ships. Dropping them here means that mistake
 * is not one deploy away from being a leak.
 */
const FORBIDDEN = /email|phone|address|name|password|token|pin|lat|lng|coords|note/i;

function scrub(props: AnalyticsEvent['props']): AnalyticsEvent['props'] {
  if (!props) return undefined;
  const safe: Record<string, string | number | boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN.test(key)) {
      if (DEV) {
        console.warn(`[analytics] dropped "${key}" — see FORBIDDEN in services/analytics.ts`);
      }
      continue;
    }
    // Long strings are free-text by definition, and free text is where a
    // customer's message ends up.
    safe[key] = typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  return safe;
}

/**
 * Events wait here until the page is being left, then go in one request.
 *
 * A request per click is the wrong shape on a metered mobile connection, which
 * is what most of this site's traffic is on. `sendBeacon` is what makes the
 * flush survive the navigation that triggers it.
 */
let queue: AnalyticsEvent[] = [];
let installed = false;

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];

  if (!ENDPOINT) {
    if (DEV) console.debug('[analytics]', batch);
    return;
  }

  const body = JSON.stringify({ events: batch, sentAt: Date.now() });
  const blob = new Blob([body], { type: 'application/json' });

  // `sendBeacon` is the only transport that reliably completes while the page
  // is unloading. A `fetch` here is cancelled by the navigation about half the
  // time, which loses exactly the events that say somebody left.
  if (navigator.sendBeacon?.(ENDPOINT, blob)) return;

  void fetch(ENDPOINT, { method: 'POST', body: blob, keepalive: true }).catch(() => {
    // An event that cannot be delivered is dropped. It is telemetry: retrying
    // it is not worth a second request on a connection that just failed.
  });
}

/**
 * Record something that happened.
 *
 * Never throws and never blocks — a call site should be able to drop this in
 * without thinking about what happens when it fails, or analytics becomes a
 * thing that can break a booking.
 */
export function track(name: EventName, props?: AnalyticsEvent['props']): void {
  try {
    if (optedOut()) return;
    queue.push({ name, props: scrub(props), at: Date.now() });
    // Errors are worth a request of their own; the rest can wait for the page
    // to be left or backgrounded.
    if (queue.length >= 24 || name.endsWith('_error') || name.endsWith('_failed')) flush();
  } catch {
    // Telemetry never takes the page down with it.
  }
}

/**
 * Report a thrown error.
 *
 * Deliberately only the message, the name and where it came from. A stack
 * trace off a minified bundle is a list of one-letter function names that
 * means nothing without a sourcemap this site does not publish, and stacks are
 * the most reliable way to get a customer's data into a log by accident.
 */
export function reportError(error: unknown, context: string): void {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
  track('render_error', { context, message, kind: error instanceof Error ? error.name : typeof error });
  if (DEV) console.error(`[${context}]`, error);
}

/**
 * Starts the page-level listeners. Called once, from main.tsx.
 *
 * `visibilitychange` rather than `unload`: mobile Safari and Chrome on Android
 * frequently never fire `unload` at all — a backgrounded tab is discarded
 * instead — so an unload flush loses most of a phone's session.
 */
export function installReporting(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // Resource load failures arrive here too and are not exceptions; they have
    // no `error` and their target is the element that failed.
    if (!event.error) return;
    track('unhandled_error', { message: String(event.message).slice(0, 200), source: 'window' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    track('unhandled_error', {
      message: (reason instanceof Error ? reason.message : String(reason)).slice(0, 200),
      source: 'promise',
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

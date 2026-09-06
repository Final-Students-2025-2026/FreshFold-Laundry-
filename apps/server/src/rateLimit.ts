/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RequestHandler } from 'express';

/**
 * The most buckets one limiter will hold.
 *
 * Measured at about 250 bytes an entry, so ten thousand is roughly 2.5 MB per
 * limiter — a handful of megabytes across all of them, on an instance with 512.
 * Comfortably above any honest population: the per-address limiters bucket on
 * client IPs, and a laundry in Kumasi does not have ten thousand of those in a
 * quarter of an hour.
 */
const MAX_BUCKETS = 10_000;

/**
 * A limiter, plus a way to ask how much it is holding.
 *
 * `buckets()` exists for `rateLimit.check.ts`. The bound it reports is the
 * whole of the fix for an unbounded map, and a bound nothing can observe is a
 * bound nobody will notice breaking.
 */
export interface RateLimiter extends RequestHandler {
  buckets: () => number;
}

/**
 * A ceiling on what one caller can spend.
 *
 * Both Google proxies — directions and places — are open by necessity: a
 * customer tracking an order has no session, and a booking form is a stranger
 * filling in a form. Neither can require auth without breaking the thing it is
 * for, so what guards the bill is the service area, the cache, and this.
 *
 * In-memory, so it is per-instance: two servers behind a load balancer allow
 * twice the stated rate between them. That is the honest limitation of not
 * having Redis here, and it still turns an unbounded bill into a bounded one.
 *
 * Keyed on `req.ip` by default, which behind a reverse proxy is the proxy unless
 * `TRUST_PROXY` is set — see the note in `index.ts`. Pass `key` to bucket on
 * something else; {@link credentialLimit} uses it to count attempts against the
 * account being guessed at rather than against the address doing the guessing.
 */
export function rateLimit(options: {
  /** Requests allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** What the caller is told when they exceed it. */
  message: string;
  /**
   * What to count against. Defaults to `req.ip`.
   *
   * Returning `null` skips the limiter for that request — a body with no
   * identifier in it has nothing to bucket on, and such a request is refused by
   * the route itself a line later.
   */
  key?: (req: Parameters<RequestHandler>[0]) => string | null;
}): RateLimiter {
  const callers = new Map<string, { count: number; windowStart: number }>();

  /**
   * When the last sweep ran.
   *
   * The sweep used to fire on every request that opened a bucket, once the map
   * held more than five thousand. That is fine while the keys are addresses and
   * catastrophic once they are anything a caller picks: every entry is younger
   * than the window because the attacker has just made it, so the sweep deletes
   * nothing, and then runs again in full on the next request. The cost of a
   * request becomes proportional to the number of requests already made —
   * measured at 610,000 a second under five thousand buckets and 508 a second
   * at two hundred thousand.
   *
   * Once per window instead. Anything the sweep now misses is caught by the
   * ceiling below, which is the real bound.
   */
  let sweptAt = 0;

  const handler: RateLimiter = (req, res, next) => {
    const bucket = options.key ? options.key(req) : (req.ip ?? 'unknown');
    if (bucket === null) return next();

    const now = Date.now();
    const seen = callers.get(bucket);

    if (!seen || now - seen.windowStart > options.windowMs) {
      if (now - sweptAt > options.windowMs) {
        sweptAt = now;
        for (const [key, entry] of callers) {
          if (now - entry.windowStart > options.windowMs) callers.delete(key);
        }
      }

      /**
       * The ceiling, and the thing that actually makes this safe.
       *
       * Three of these limiters bucket on a value the caller chooses — an email,
       * a phone number, a job id in a URL — so without a hard cap the map is
       * whatever an anonymous caller wants it to be. `MAX_BUCKETS` bounds it at
       * a few megabytes whatever arrives.
       *
       * Oldest first, which `Map` gives for nothing: keys come back in insertion
       * order, and the refresh below re-inserts, so the front of the map is the
       * bucket whose window started longest ago — the one closest to expiring
       * anyway.
       *
       * **Evicting forgives.** A caller whose bucket is dropped starts again
       * with a full allowance, so somebody willing to spend `MAX_BUCKETS`
       * requests can clear their own entry and buy another window. That is the
       * deliberate half of this trade: the alternative is refusing new buckets
       * when the map is full, which hands the same attacker a way to lock every
       * honest caller out of signing in. Amnesia is the right way for a limiter
       * to fail, and ten thousand requests to win back fifteen sign-in attempts
       * is a poor exchange for anybody buying it.
       */
      while (callers.size >= MAX_BUCKETS) {
        const oldest = callers.keys().next();
        if (oldest.done) break;
        callers.delete(oldest.value);
      }

      // Deleted before it is set so the key moves to the back of the insertion
      // order. Without this a refreshed bucket keeps its original position and
      // the eviction above would reach for entries that are still live.
      callers.delete(bucket);
      callers.set(bucket, { count: 1, windowStart: now });
      return next();
    }

    seen.count += 1;
    if (seen.count > options.max) {
      res.status(429).json({ error: options.message });
      return;
    }

    next();
  };

  handler.buckets = () => callers.size;
  return handler;
}

/**
 * The two limiters every credential check needs, as one middleware pair.
 *
 * A single limiter cannot cover both shapes of guessing attack, because they
 * are keyed on opposite things:
 *
 *  - **One attacker, one account.** Someone walking a courier's 10,000 PINs
 *    from a laptop. The per-IP bucket stops that.
 *  - **Many addresses, one account.** The same walk spread over a botnet, or
 *    over a mobile network that re-issues addresses freely. Every request comes
 *    from a fresh IP, so the per-IP bucket never fills — what has to be counted
 *    is attempts *against the account*, whoever is making them.
 *
 * So both are applied. The per-identifier window is the tight one, since a real
 * person mistyping their own PIN needs a handful of tries and an attacker needs
 * thousands.
 *
 * The identifier is lowercased and trimmed so `Ama@X.com`, ` ama@x.com ` and
 * `ama@x.com` share a bucket rather than buying three.
 *
 * Two consequences worth stating rather than discovering. Locking is on the
 * *attempt*, not the account: a successful sign-in is counted too, so a courier
 * who signs in ten times in ten minutes is asked to wait — which is why the
 * windows below are sized well above real use. And this is in-memory, so it
 * resets on deploy and is per-instance; it raises the cost of guessing by
 * orders of magnitude rather than making it impossible, which is the honest
 * description of any limiter without Redis behind it.
 */
export function credentialLimit(options: {
  /** Attempts allowed per window against one account. */
  perIdentifier: number;
  /** Attempts allowed per window from one address, across all accounts. */
  perAddress: number;
  /** Window length in milliseconds, shared by both. */
  windowMs: number;
  /** Which body field names the account: `identifier`, `email`… */
  field: string;
  /**
   * What the caller is told, when "sign-in attempts" is the wrong noun.
   *
   * `/auth/register` uses the same two buckets for a reason that is not
   * guessing — see the note there — and telling somebody creating an account
   * that they have made too many sign-in attempts is a message about a thing
   * they were not doing.
   */
  message?: string;
}): RequestHandler[] {
  const wait =
    options.message ??
    `Too many sign-in attempts. Try again in ${Math.round(options.windowMs / 60_000)} minutes.`;

  return [
    rateLimit({
      max: options.perIdentifier,
      windowMs: options.windowMs,
      message: wait,
      key: (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const value = body[options.field];
        if (typeof value !== 'string' || !value.trim()) return null;
        return `id:${value.trim().toLowerCase()}`;
      },
    }),
    rateLimit({
      max: options.perAddress,
      windowMs: options.windowMs,
      message: wait,
    }),
  ];
}

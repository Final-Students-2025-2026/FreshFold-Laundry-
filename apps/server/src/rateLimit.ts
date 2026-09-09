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

/** An IPv6 address at its longest. What a claimed client is truncated to. */
const IP_MAX_LENGTH = 45;

/**
 * How many distinct clients may sit behind one trusted address.
 *
 * **The problem this exists for.** `req.ip` is only as good as `TRUST_PROXY`,
 * and one hop count cannot describe two ingress paths. The customer apps reach
 * Render directly — one proxy in front, so `TRUST_PROXY=1` resolves the
 * handset's own address and every phone gets its own bucket. The website does
 * not: `vercel.json` rewrites `/api` to the same service, so those requests
 * arrive browser → Vercel edge → Render, and one trusted hop resolves to the
 * *Vercel edge*. Every visitor to the site then shares a single bucket. At
 * `/auth/status`'s ten per quarter-hour that is ten lookups for the whole
 * website, and the eleventh honest customer is refused.
 *
 * **Why not just raise `TRUST_PROXY` to 2.** Because the service answers the
 * mobile apps directly on the same hostname, so the second hop is only a proxy
 * on one of the two paths. On the other it is whatever the caller put in
 * `X-Forwarded-For`, and trusting it would hand him a fresh bucket per
 * request — a limiter that stops only the honest. There is no hop count that
 * is right for both paths, and no way to tell the paths apart without either
 * Vercel's egress ranges (not published) or a shared secret (a Vercel
 * middleware, and a second place for a deployment to be wrong).
 *
 * **What this assumes about Render, and what happens if it is wrong.** That its
 * proxy *appends* the peer it saw rather than replacing the header, which is
 * what leaves Vercel's record of the browser in the chain for `claimedClient`
 * to find. If some proxy in front replaces instead, the surplus this looks for
 * is simply not there, nothing is claimed, and every bucket stays keyed on
 * `req.ip` exactly as it is today — the collapse would go unfixed, but nothing
 * here misbehaves. It fails closed, and that is why it is safe to ship without
 * being able to observe the deployed chain from outside.
 *
 * **So the rule here is that a forgeable claim may subdivide a bucket and may
 * never escape one.** With this set above 1, a request carrying more forwarded
 * addresses than `trust proxy` accepted is counted twice: once against
 * `address|claimed-client`, at the limiter's stated ceiling, and once against
 * `address` alone at that ceiling times this number. Honest website visitors
 * stop spending each other's allowance; somebody forging the header buys
 * himself this multiple and no more, whatever he invents.
 *
 * That multiple is the whole of the trade, and it is a real one: it is also
 * what a direct caller gains by forging a header, so `/auth/status`'s ten
 * becomes ten each for twenty-five visitors and two hundred and fifty for one
 * attacker. Worth it, for two reasons. The bound it loosens was never
 * absolute — anybody with a phone tethering, never mind a proxy pool, already
 * had a fresh address whenever they wanted one — while the availability bug it
 * fixes is total. And the buckets that actually protect an account do not go
 * through here at all: {@link credentialLimit}'s tight tier keys on the
 * identifier being guessed at, and no amount of forged addressing touches it.
 *
 * Left at 1 — the default, and correct for a service nothing is in front of
 * but its own load balancer — none of this engages and the key stays `req.ip`.
 */
const SHARED_PROXY_CLIENTS = (() => {
  const asked = Number(process.env.SHARED_PROXY_CLIENTS);
  if (!Number.isInteger(asked) || asked < 1) return 1;
  // A thousand honest clients behind one address is already generous; beyond
  // that the aggregate ceiling has stopped meaning anything.
  return Math.min(asked, 1000);
})();

/**
 * The client this request claims to be from, when something untrusted said so.
 *
 * Everything `trust proxy` accepted is already in `req.ip` and `req.ips`;
 * anything to the left of that in the raw header was written by a caller we
 * have no reason to believe. That surplus is what this returns — the far end
 * of the chain, which on the Vercel path is the browser and on a forged one is
 * whatever the forger typed. The caller treats it as a subdivision and never
 * as an identity; see {@link SHARED_PROXY_CLIENTS}.
 *
 * Truncated because it becomes a map key and arrives from outside.
 */
function claimedClient(req: Parameters<RequestHandler>[0], fanout: number): string | null {
  if (fanout === 1) return null;

  const header = req.headers?.['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  // `req.ips` holds the hops `trust proxy` was willing to believe. No surplus
  // means nothing untrusted is being claimed — the direct path, and the shape
  // every request has when `TRUST_PROXY` describes the deployment correctly.
  if (forwarded.length <= (req.ips?.length ?? 0)) return null;

  return forwarded[0].slice(0, IP_MAX_LENGTH);
}

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
 * One map of windowed counts, and the bounds that keep it from becoming the
 * attack it exists to stop.
 *
 * Split out of {@link rateLimit} so the aggregate tier described on
 * {@link SHARED_PROXY_CLIENTS} can have its own counts without a second copy
 * of the sweep, the ceiling and the eviction order. The behaviour is the one
 * `rateLimit.check.ts` asserts, unchanged.
 */
function counter(): { hit: (bucket: string, max: number, windowMs: number) => boolean; size: () => number } {
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

  return {
    /** Counts one request against `bucket`. False means it has gone over. */
    hit(bucket, max, windowMs) {
      const now = Date.now();
      const seen = callers.get(bucket);

      if (!seen || now - seen.windowStart > windowMs) {
        if (now - sweptAt > windowMs) {
          sweptAt = now;
          for (const [key, entry] of callers) {
            if (now - entry.windowStart > windowMs) callers.delete(key);
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
        return true;
      }

      seen.count += 1;
      return seen.count <= max;
    },
    size: () => callers.size,
  };
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
 * `TRUST_PROXY` is set — see the note in `index.ts`. Where one trusted address
 * carries many clients, as Vercel's rewrite does for the website,
 * {@link SHARED_PROXY_CLIENTS} subdivides that bucket without believing the
 * header it subdivides it by. Pass `key` to bucket on something else;
 * {@link credentialLimit} uses it to count attempts against the account being
 * guessed at rather than against the address doing the guessing.
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
  /**
   * How many clients may share one address, overriding
   * {@link SHARED_PROXY_CLIENTS} for this limiter.
   *
   * Exists so `rateLimit.check.ts` can exercise a shared proxy without the
   * process environment deciding whether the check runs at all. No route sets
   * it; the deployment sets the environment variable instead.
   */
  sharedClients?: number;
}): RateLimiter {
  const fanout = options.sharedClients ?? SHARED_PROXY_CLIENTS;
  /** The stated ceiling, per bucket. */
  const fine = counter();

  /**
   * The aggregate ceiling behind a shared address.
   *
   * Only ever consulted for a request that claimed an untrusted client, so a
   * deployment with `SHARED_PROXY_CLIENTS` unset never opens a bucket here.
   */
  const shared = counter();

  const handler: RateLimiter = (req, res, next) => {
    const refuse = (): void => {
      res.status(429).json({ error: options.message });
    };

    // A caller-supplied key — an identifier, a phone number, a job id. Nothing
    // about the address enters into it, so none of the proxy reasoning applies.
    if (options.key) {
      const bucket = options.key(req);
      if (bucket === null) return next();
      if (!fine.hit(bucket, options.max, options.windowMs)) return refuse();
      return next();
    }

    const address = req.ip ?? 'unknown';
    const claimed = claimedClient(req, fanout);

    if (claimed === null) {
      if (!fine.hit(address, options.max, options.windowMs)) return refuse();
      return next();
    }

    /**
     * Both tiers are counted, and both must allow.
     *
     * Counting before testing matters: a request refused by the aggregate must
     * still spend its own allowance, or a forger held at the outer ceiling
     * would leave every subdivision below it full of unspent room to come back
     * to. See {@link SHARED_PROXY_CLIENTS} for what the two tiers are for.
     */
    const withinOwn = fine.hit(`${address}|${claimed}`, options.max, options.windowMs);
    const withinShared = shared.hit(address, options.max * fanout, options.windowMs);

    if (!withinOwn || !withinShared) return refuse();
    next();
  };

  handler.buckets = () => fine.size() + shared.size();
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

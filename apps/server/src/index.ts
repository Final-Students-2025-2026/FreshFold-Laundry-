/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEmailShaped } from '@freshfold/core';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { closeDatabase, ping } from './db';
import { emailProvider, parseAddress } from './email';
import { store } from './store';
import { developmentCredentials, ensureSeeded, SeedError } from './seed';
import { startHubCycle } from './hub';
import { startRecurringCycle } from './recurring-cycle';
import { guard } from './helpers';
import { securityHeaders } from './headers';
import { requireSupervisor } from './auth';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { claimsRouter } from './routes/claims';
import { contactRouter } from './routes/contact';
import { promotionsRouter } from './routes/promotions';
import { hubsRouter } from './routes/hubs';
import { invoicesRouter } from './routes/invoices';
import { recurringRouter } from './routes/recurring';
import { directionsRouter } from './routes/directions';
import { ordersRouter } from './routes/orders';
import { placesRouter } from './routes/places';
import { ridersRouter } from './routes/riders';
import { messagesRouter, notificationsRouter } from './routes/messaging';
import { accountsRouter, transactionsRouter } from './routes/accounts';
import { chatRouter, paystackRouter } from './routes/integrations';

/**
 * The FreshFold dispatch server.
 *
 * One process owns the data all three products depend on. The website talks to
 * it through Vite's dev proxy; the rider and customer apps talk to it over the
 * LAN. None of them writes anything the others cannot see.
 *
 * The records themselves live in Supabase Postgres — see `./db` for the
 * connection and `./store` for every query that touches it.
 */

dotenv.config();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);

const app = express();

/**
 * Express announces itself on every response otherwise.
 *
 * `X-Powered-By: Express` hands a reader of the headers the one detail worth
 * having before trying anything — which stack to look advisories up against.
 * It costs us nothing to withhold. Unlike everything in `./headers`, this one
 * is removed by not setting it rather than by setting something else, so it
 * belongs here next to the app rather than in that middleware.
 */
app.disable('x-powered-by');

/**
 * Whether `X-Forwarded-For` may be believed.
 *
 * `req.ip` is what the directions proxy rate-limits on, and behind a reverse
 * proxy every request otherwise arrives from the same address — one bucket for
 * the whole internet. Opt-in rather than always-on, because trusting the header
 * when nothing in front strips it lets any caller forge an IP and mint a fresh
 * bucket per request, which is worse than no limiter at all. Set `TRUST_PROXY`
 * to the number of proxies in front of this process (usually `1`), or to a
 * value Express understands such as `loopback`.
 *
 * **Count the proxies that cannot be bypassed, not the ones in the longest
 * path.** On Render that is `1` — its own load balancer — and it stays `1`
 * even though website traffic reaches the same service through a second hop,
 * because `vercel.json` rewrites `/api` to a host that is also reachable
 * directly. A caller who goes straight to `onrender.com` presents whatever
 * chain they like, so raising this to `2` would trust an entry they wrote and
 * hand them a fresh rate-limit bucket per request. The right number is the one
 * that is true for every path into this process, and the cost of that — every
 * website visitor resolving to the Vercel edge and sharing one bucket — is
 * paid in `rateLimit.ts` by `SHARED_PROXY_CLIENTS`, which subdivides a shared
 * address without ever believing it.
 */
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
}

/**
 * Response headers, before anything that can answer a request.
 *
 * `servesWebsite` matches the static-file branch at the bottom of this file: in
 * the deployed shape Vercel serves the site and this process answers only
 * `/api`, so the policy stays tight and `vercel.json` carries the wider one for
 * the pages that need Google Maps. Running as a single process, this serves
 * both and the policy has to cover both.
 *
 * `https` follows `TRUST_PROXY`, which is set exactly when something in front
 * is terminating TLS. HSTS on a plaintext response is ignored anyway; the point
 * of the condition is not to send it in development, where it would pin a
 * developer's `localhost` to https for a year.
 */
const servesWebsite = process.env.NODE_ENV === 'production';

app.use(
  securityHeaders({
    servesWebsite,
    https: Boolean(process.env.TRUST_PROXY),
  })
);

/**
 * The Paystack webhook, and only it, is read as raw bytes.
 *
 * Its signature is an HMAC over exactly what Paystack sent, so the body cannot
 * be parsed and re-serialised before it is checked — key order and number
 * formatting would not survive the round trip, and a valid payment would look
 * forged. This has to be mounted before the JSON parser below; body-parser
 * marks the body as read, so the parser leaves it alone afterwards.
 */
app.use('/api/paystack/webhook', express.raw({ type: '*/*', limit: '1mb' }));

/**
 * Bodies carry base64 proof-of-service photos and signature PNGs, which blow
 * past Express's 100kb default.
 *
 * Six rather than the twelve this used to be. The number was picked to let the
 * blobs through at a time when nothing bounded them; they are bounded now — 2 MB
 * for a photograph and 512 KB for a signature, decoded, checked in
 * `@freshfold/core`'s `uploads` module — so the largest legitimate request is
 * one of each, about 3.4 MB once base64 has added its third. Six leaves
 * comfortable headroom and still halves what a single request can spend before
 * any route has looked at it.
 *
 * This is the outer bound rather than the real control: it is enforced by
 * body-parser before any handler runs, and it cannot tell a large photograph
 * from a large anything else. The per-field checks are what say no to the
 * things that are the wrong shape.
 */
app.use(express.json({ limit: '6mb' }));

/**
 * CORS.
 *
 * The rider app runs on a phone against this machine's LAN address, so it is
 * always cross-origin and development needs to be permissive. Production does
 * not: set `CORS_ORIGINS` to a comma-separated allow-list. Leaving it unset in
 * production is a misconfiguration worth shouting about rather than silently
 * serving every origin on the internet.
 */
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn(
    '[cors] CORS_ORIGINS is not set. Refusing cross-origin requests. ' +
      'Set it to the origins your apps are served from, e.g. https://freshfold.example,http://192.168.1.42:8081'
  );
}

app.use(
  cors({
    origin:
      allowedOrigins.length > 0
        ? allowedOrigins
        : process.env.NODE_ENV === 'production'
          ? false
          : true,
  })
);

/**
 * Liveness, and whether the database behind it is actually reachable.
 *
 * Reports 503 when it is not. A process that is up but cannot reach Supabase
 * serves nothing but 500s, and a health check that says `ok` through that is
 * worse than no health check — it is what keeps a broken instance in the load
 * balancer.
 */
app.get(
  '/api/health',
  guard(async (_req, res) => {
    if (!(await ping())) {
      res.status(503).json({ ok: false, error: 'Database unreachable' });
      return;
    }

    /**
     * That the process is up and the database answers. Deliberately nothing
     * else.
     *
     * This used to report live job and rider counts, unauthenticated, to
     * anybody who asked. A load balancer needs to know the instance is
     * healthy; it does not need the order book. Polled once a day by a
     * stranger those two integers are a growth chart and a headcount, which is
     * a competitor's homework and no part of a health check's job.
     *
     * Removed rather than moved behind the desk's session, because nothing was
     * reading them: `health()` in `@freshfold/core` is a reachability probe and
     * all three callers discard the body. A number with no reader is a
     * disclosure with no feature behind it. If the desk ever wants these, they
     * belong on a metrics route that says who may see them.
     */
    res.json({ ok: true, version: '1.0.0' });
  })
);

app.use('/api/admin', adminRouter);
app.use('/api/auth', authRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/claims', claimsRouter);
app.use('/api/contact', contactRouter);
app.use('/api/promotions', promotionsRouter);
app.use('/api/recurring', recurringRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/hubs', hubsRouter);
app.use('/api/directions', directionsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/places', placesRouter);
app.use('/api/riders', ridersRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/paystack', paystackRouter);

/**
 * The canonical records, for debugging and for the admin dashboard.
 *
 * Behind the desk's session. A `Job` is the unprojected record — every
 * customer's name, address and phone number, all three hand-off codes, and the
 * base64 proof-of-service photographs — and this handed the lot to anybody who
 * asked for it.
 */
app.get(
  '/api/jobs',
  requireSupervisor,
  guard(async (_req, res) => {
    res.json(await store.jobs.list());
  })
);

/**
 * Wipes every table and re-seeds the bootstrap identities.
 *
 * Two locks, because one is not enough for a route whose entire job is
 * destroying the database. It was open: a single unauthenticated POST from
 * anywhere on the internet took out every booking, courier, account and payment
 * record, and the root `package.json` ships an `npm run reset` that curls it.
 *
 * The session is the first lock. Refusing outright in production is the second —
 * there is no circumstance in which the live laundry's records should be
 * truncated over HTTP, and a supervisor's token is a week-long bearer credential
 * on a phone, not something to stand between a real ledger and `truncate`.
 */
app.post(
  '/api/reset',
  requireSupervisor,
  guard(async (_req, res) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({
        error:
          'Resetting the database is disabled in production. Run it against a development ' +
          'instance, or truncate deliberately from the Supabase SQL editor.',
        code: 'RESET_DISABLED',
      });
      return;
    }

    await store.reset();
    await ensureSeeded();
    res.json({ ok: true });
  })
);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API route' });
});

// In production this process also serves the built website. In development
// Vite serves it on its own port and proxies /api back here.
if (process.env.NODE_ENV === 'production') {
  const distPath = process.env.WEB_DIST
    ? path.resolve(process.env.WEB_DIST)
    : path.resolve(HERE, '..', '..', 'web', 'dist');

  /**
   * Only when the build is actually on disk.
   *
   * Serving the site from this process is one of two supported shapes, not the
   * only one. The Render blueprint builds `@freshfold/server` alone and Vercel
   * serves the website, rewriting `/api/*` back here — so on that deployment
   * this directory has never existed. Mounting the catch-all regardless meant
   * every stray request for `/` (a crawler, an uptime probe, somebody opening
   * the onrender.com URL) resolved to a `sendFile` of a path that is not there
   * and logged `ENOENT ... apps/web/dist/index.html`.
   *
   * Which was noise, but expensive noise: it is indistinguishable at a glance
   * from a real deployment fault, and it sat in the log next to the email
   * failure that actually mattered.
   *
   * Checked once at boot rather than per request. The bundle cannot appear
   * while the process is running — nothing writes it but the build, which has
   * long since finished — and a stat on every 404 would be a syscall bought
   * with nothing.
   */
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.log(
      `[web] no built site at ${distPath} — serving the API only. ` +
        'That is expected when the website is deployed separately (see vercel.json).'
    );
  }
}

/** The database host, with the password stripped, for the startup banner. */
function describeDatabase(): string {
  try {
    const parsed = new URL(process.env.DATABASE_URL ?? '');
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'unknown';
  }
}

/**
 * What outbound email will actually do, for the startup banner.
 *
 * Worth a line because the failure it names is invisible from the product: a
 * booking confirmation and the setup link it carries are sent after the
 * response, so a refusal by the provider leaves the customer with a cheerful
 * "check your inbox" and nothing in it. `onboarding@resend.dev` is Resend's
 * shared sender, and it delivers only to the address that owns the Resend
 * account — every customer address is rejected. That is fine for a first test
 * and wrong the moment anybody else books.
 */
function describeEmail(): string {
  const provider = emailProvider();
  if (!provider) return 'not configured — links are written to this log instead';

  const from = process.env.EMAIL_FROM;
  if (!from) return `${provider} key is set but EMAIL_FROM is not — nothing will be sent`;

  /**
   * The address the provider will actually receive, not the string as written.
   *
   * Printing the raw value was the gap this closes. `EMAIL_FROM` carrying its
   * own surrounding quotes — a dashboard storing verbatim what dotenv would
   * have unwrapped — reads perfectly on this line while `parseAddress` hands
   * Brevo a `sender.email` of `"FreshFold <hello@example.com>"`, quotes and
   * angle brackets included, which is refused on every send. The banner said
   * everything was fine for as long as that was true.
   *
   * `parseAddress` now unwraps that case, so anything still failing here is a
   * value no amount of tidying will rescue, and it is worth being loud about:
   * this is the last point before the failure becomes invisible.
   */
  const sender = parseAddress(from);
  if (!isEmailShaped(sender.email)) {
    return (
      `MISCONFIGURED — EMAIL_FROM is ${JSON.stringify(from)}, which resolves to the sender ` +
      `address ${JSON.stringify(sender.email)}. That is not an address, and ${provider} will ` +
      'refuse every send. Expected `Name <addr@host>` or a bare `addr@host`, with no ' +
      'surrounding quotes.'
    );
  }

  if (provider === 'resend' && /@resend\.dev\b/i.test(from)) {
    return (
      `${from} via resend — Resend's shared sender, which DELIVERS ONLY TO THE ADDRESS ` +
      'THAT OWNS THE RESEND ACCOUNT. Verify a domain, or set BREVO_API_KEY, before customers book.'
    );
  }

  // The resolved sender, not the raw value, for the same reason the check above
  // works on it: this line is read to confirm the configuration, and it should
  // show what the provider gets.
  return sender.name
    ? `${sender.name} <${sender.email}> via ${provider}`
    : `${sender.email} via ${provider}`;
}

/**
 * Boot.
 *
 * The connection is checked and the bootstrap identities are put in place
 * *before* the port opens. Accepting requests first would mean the rider app's
 * very first poll racing the seed, and a sign-in failing against a roster that
 * was about to exist.
 */
async function start(): Promise<void> {
  if (!(await ping())) {
    console.error(
      `[db] cannot reach ${describeDatabase()}. Check DATABASE_URL in apps/server/.env, ` +
        'and that the schema in supabase/migrations has been applied.'
    );
    process.exit(1);
  }

  let seeded: { riders: number; supervisors: number; accounts: number };
  try {
    seeded = await ensureSeeded();
  } catch (error) {
    // A seed that cannot be performed safely. The only case is a fresh
    // production database with no SEED_SUPERVISOR_PASSWORD, and the alternative
    // to stopping here is a live desk account whose password is in a public
    // repository — so this is fatal, like an unreachable database above.
    if (error instanceof SeedError) {
      console.error(`[seed] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const total = seeded.riders + seeded.supervisors + seeded.accounts;
  if (total > 0) {
    console.log(
      `[seed] bootstrapped ${seeded.riders} riders, ${seeded.supervisors} supervisors, ` +
        `${seeded.accounts} accounts`
    );

    // Outside production the desk was created with a known password, so say what
    // it is rather than making somebody read it out of seed.ts. In production
    // this is null: the operator supplied it, and a log aggregator should not
    // have a copy.
    const credentials = seeded.supervisors > 0 ? developmentCredentials() : null;
    if (credentials) {
      console.log(`[seed] desk: ${credentials.email} / ${credentials.password}`);
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`FreshFold dispatch server listening on http://0.0.0.0:${PORT}`);
    console.log(`  data: ${describeDatabase()}`);
    console.log(`  point the rider app at this machine's LAN address on port ${PORT}`);
    console.log(`  email: ${describeEmail()}`);
  });

  // The laundry's own stages advance here rather than on a courier's phone, so
  // a job left at the hub keeps moving after the app that dropped it off is
  // closed. See `./hub`.
  const stopHubCycle = startHubCycle();

  // And the standing orders every membership plan sells. Unlike the hub cycle
  // this runs in production by default: a timer booking a pickup the customer
  // explicitly and repeatedly asked for is the feature working, where a timer
  // advancing a stage nobody confirmed is a claim nobody made. See
  // `./recurring-cycle`.
  const stopRecurringCycle = startRecurringCycle();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopHubCycle();
      stopRecurringCycle();
      server.close(() => {
        void closeDatabase().finally(() => process.exit(0));
      });
    });
  }
}

void start();

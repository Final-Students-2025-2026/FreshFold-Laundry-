# Deploying FreshFold

Three products share one dispatch server, and only two of them can be deployed
to a CDN. This is the split:

| Piece | Where | Why |
| --- | --- | --- |
| `apps/web` — marketing site, client portal, admin dashboard | Vercel | Static Vite build. Nothing to run. |
| `apps/server` — dispatch API | Render | Needs a long-lived process. See below. |
| `apps/mobile`, `apps/client` — Expo apps | EAS / app stores | Native. Not covered here. |

**The server is not on Vercel on purpose.** `start()` in
[`apps/server/src/index.ts`](apps/server/src/index.ts) pings Postgres and seeds
the supervisor *before* the port opens, and the API holds sessions, a rider
board and a message log that every surface polls. A serverless function has no
process between requests, so none of that has anywhere to live.

`startHubCycle()` in [`apps/server/src/hub.ts`](apps/server/src/hub.ts) also
wants a long-lived process, but it is no longer the reason for one: in production
the timed sweep is **off** unless you set a dwell, because the two hub stages are
confirmed by a person from the desk's Hub tab. If you do turn it on — see
`HUB_WASH_MINUTES` in the Render environment list below — note that Vercel Cron,
the serverless answer, tops out at one run per minute on Pro and once per *day*
on Hobby, slower than the 2-minute default dwell and a rewrite of the hub
besides.

The website reaches the API through a rewrite in
[`vercel.json`](vercel.json), so `/api/*` is proxied to Render server-side. That
keeps `createClient({ baseUrl: '' })` in
[`apps/web/src/services/store.ts`](apps/web/src/services/store.ts) working
untouched, and means the browser never makes a cross-origin request — no CORS
involved in the website at all.

---

## 0. Register a domain

Do this first; everything downstream wants it.

A `*.vercel.app` subdomain will **not** work for Resend. Resend verifies a
sender by having you add DKIM and SPF records to the domain's DNS zone, and
Vercel owns the `vercel.app` zone — you cannot put records in it. The free
subdomain is fine for looking at the site, useless for sending mail.

Buy one anywhere (Porkbun and Cloudflare are near cost, roughly $10–12/yr for a
`.com`; a `.xyz` is often $1–2 for the first year). Buying through **Vercel →
Domains** costs a little more but puts registration, DNS and hosting in one
dashboard, which is one fewer place to get the nameservers wrong.

Connecting a custom domain to a Vercel project is free, including on Hobby. It
is the registration that costs money.

---

## 1. Deploy the server to Render

Render reads [`render.yaml`](render.yaml) from the repo root.

1. Render → **New** → **Blueprint**, point it at this repo, pick the branch.
2. It will pick up the `freshfold-server` service. Fill in every variable marked
   `sync: false` — the blueprint deliberately keeps secrets out of git:

   - `DATABASE_URL` — Supabase → Project Settings → Database → Connection string
     → URI. **Use the pooled string** (host ends `.pooler.supabase.com`, port
     `6543`). [`db.ts`](apps/server/src/db.ts) already sets `prepare: false` for
     Supavisor's transaction mode, so it works against either, but a free
     Supabase instance will not survive a direct 5432 connection per process.
   - `APP_URL` — your real domain, e.g. `https://freshfold.com`. This is the
     Paystack callback and it is baked into the links inside outbound email, so
     it must be what a customer actually sees, never the `onrender.com` URL.
   - `CORS_ORIGINS` — the Expo web origins, if any. The website does not need
     listing; its calls arrive same-origin via the Vercel proxy.
   - `SEED_SUPERVISOR_PASSWORD` — the password the first supervisor account
     (`supervisor@freshfold.com`) is created with. **The first boot against an
     empty database fails without it**, on purpose: that account can read every
     customer's address and phone number and settle any bill, and it will not be
     created with a default password. Read only while the `supervisors` table is
     empty, so later deploys ignore it — including a deploy against a database
     you already seeded in development, which is a trap of its own and has a
     section of its own below. Nothing else is seeded in production —
     couriers are hired from the desk and customers register themselves.
   - `BREVO_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` — leave these until step 4.
   - `GEMINI_API_KEY`, `PAYSTACK_SECRET_KEY`, `GOOGLE_MAPS_PLATFORM_KEY`.
   - `HUB_WASH_MINUTES`, `HUB_FINISH_MINUTES` — **leave both unset.** In
     production the hub's timed sweep does not run unless one of them is set, and
     the two stages it would advance — In Care → Ironing & Folding → Quality
     Check — are confirmed from the desk's Hub tab by the person who knows the
     load is done. Setting either turns the sweep back on for both stages, which
     means the server telling customers their laundry is washed on the evidence
     that a clock passed a number. If you do it anyway, every advance is filed in
     the audit trail against `system`, saying so.

3. Apply the migrations in `supabase/migrations` if you have not:

   ```bash
   npm run db:migrate --workspace @freshfold/server
   ```

4. Note the service URL (`https://freshfold-server.onrender.com`) and confirm it
   is alive:

   ```bash
   curl https://freshfold-server.onrender.com/api/health
   ```

   `{"ok":true,...}` means the process is up *and* Postgres is reachable. A 503
   means the process is up and the database is not — check `DATABASE_URL`.

### If you developed against this same database

`SEED_SUPERVISOR_PASSWORD` is read *only* when the `supervisors` table is empty.
That check is what makes the variable safe to add to a running deployment — but
it also means a database that already has a supervisor never reaches the code
that would use it. Setting it in Render changes nothing, silently.

Which matters, because a supervisor created by a **development** boot was not
given the password you set here. It was given the fallback in
[`seed.ts`](apps/server/src/seed.ts), which is the literal word `password`.
`NODE_ENV` is unset on a laptop, so the guard that refuses a default in
production does not fire, and the row is created anyway.

Promote that database to production and the desk — every customer's address and
phone number, settlement on any bill — is live on the public URL with a
password anyone would guess on the first try. Nothing in the deploy warns you:
the service is healthy, the variable is set, and the log says nothing.

Check before you trust it:

```sql
select id, created_at from supervisors;
```

A `created_at` earlier than your first production deploy means the row came from
development. Delete it and restart the service — with the table empty, this
variable set and `NODE_ENV=production`, the boot seeds the account properly:

```sql
delete from supervisors;
```

Then confirm both directions: your real password works, *and* `password` is
refused. Only the second proves the row was replaced rather than left alone.

The general form is worth carrying to anything else seeded this way: a
credential created in development survives promotion untouched, and the
emptiness checks that make seeding idempotent are exactly what stop production
from correcting it.

### The free tier sleeps

Render's free plan spins a service down after 15 minutes with no inbound
request, and a cold start takes ~50s. **The hub sweep does not run while it is
asleep**, which undercuts the reason we put the server here — a job dropped off
at the hub stops advancing until the next request wakes the process.

For a demo that is survivable. Before real customers, take the **Starter plan
($7/mo)**, which does not sleep. Nothing about the config changes; it is a
dropdown.

---

## 2. Deploy the website to Vercel

1. Edit [`vercel.json`](vercel.json) and replace the rewrite destination with
   your actual Render URL from step 1:

   ```json
   { "source": "/api/:path*", "destination": "https://YOUR-SERVICE.onrender.com/api/:path*" }
   ```

   Vercel does not interpolate environment variables into `vercel.json`, so this
   has to be a literal.

2. Vercel → **Add New** → **Project**, import the repo. Leave **Root Directory**
   as the repo root — do *not* set it to `apps/web`. The Vite config aliases
   `@freshfold/core` to `../../packages/core/src/index.ts`, which is outside
   `apps/web`, so the build needs the whole workspace. `vercel.json` already
   supplies the build command, install command and output directory.

3. Add the build-time variables. These are read by `loadEnv` in
   [`apps/web/vite.config.ts`](apps/web/vite.config.ts) and baked into the
   bundle, so they must be set *before* the build, and they are public by
   nature:

   - `VITE_GOOGLE_MAPS_PLATFORM_KEY` / `GOOGLE_MAPS_PLATFORM_KEY` — restrict
     this one to the Maps JavaScript API by HTTP referrer. Keep the server's
     Routes-enabled key well away from it.
   - `VITE_GOOGLE_MAPS_MAP_ID` / `GOOGLE_MAPS_MAP_ID` — without one, every
     `AdvancedMarker` falls back to Google's `DEMO_MAP_ID`, which warns on load
     and is unsupported in production.

4. Deploy, then attach the domain: **Project → Settings → Domains**. Follow
   Vercel's instructions to either move the nameservers or add the `A`/`CNAME`
   records at your registrar.

The build takes a few minutes — `npm install` at the root pulls the Expo
workspaces too, which are not needed for the website but keep the lockfile
honest.

---

## 3. Point the server at the real origin

Once the domain resolves, go back to Render and set:

- `APP_URL=https://yourdomain.com`

Redeploy. Links in outbound email and the Paystack callback now point at the
site rather than at nothing.

**Set the same value on Vercel, as `SITE_URL`.** The website needs it for four
things the server knows nothing about: the `<link rel="canonical">`, the
`og:url` on the share card, `sitemap.xml`, and the `LocalBusiness` structured
data. All four are claims about where the real site lives, and all four are
worse wrong than absent — a preview deploy that names itself canonical is a
preview deploy in the search results.

The build warns when `SITE_URL` is unset and falls back to
`https://freshfold.com`, so a missing value is visible in the deploy log rather
than silent.

### Checking the share card

Paste the domain into a WhatsApp chat with yourself. You should get a 1200x630
card with the headline and the price, not a bare link. If it comes back bare,
in order of likelihood: `SITE_URL` is wrong or unset, so `og:image` points at a
host that has no `og.jpg`; the domain has not finished propagating; or WhatsApp
has the old bare-link result cached — it caches aggressively, so test with a
URL it has not seen, e.g. `?x=1` on the end.

`public/og.jpg` is generated, not hand-drawn. Re-render it after any change to
the offer it prints:

```
cd apps/web && node scripts/brand-assets.mjs
```

That also re-renders the favicon PNGs. It needs Chrome on the machine — set
`CHROME_PATH` if it is somewhere unusual — and it is deliberately not part of
`npm run build`, so a deploy never depends on it.

---

## 4. Get email delivering to addresses that are not yours

This is the step the whole exercise was for. There are two ways through it and
the server supports both — [`email.ts`](apps/server/src/email.ts) picks Brevo
when `BREVO_API_KEY` is set and falls back to Resend otherwise.

Pick 4a if you do not own a domain yet, which is the situation this project is
actually in. Pick 4b when you do; it is the better end state.

### 4a. Verify a single sender in Brevo — no domain needed

Brevo will deliver to anybody once it has confirmed you control the *From*
mailbox. That confirmation is a link in an email, not a DNS record, so this
takes about five minutes with nothing bought.

1. Brevo → **Senders, Domains & Dedicated IPs** → **Senders** → **Add a
   Sender**. Use an address you can open — a Gmail address is fine here.

2. Brevo mails that address a confirmation link. Click it. The sender flips to
   verified in the dashboard.

3. Brevo → **SMTP & API** → **API Keys** → **Generate a new API key**. It is a
   v3 key and starts `xkeysib-`.

4. Set on Render and redeploy:

   ```
   BREVO_API_KEY=xkeysib-...
   EMAIL_FROM="FreshFold <the-verified-address@gmail.com>"
   ```

   `EMAIL_FROM` has to be the address you just verified. Brevo rejects a send
   from anything else with a 400, which is logged.

The catch, so it is not a surprise later: mail from a free mailbox domain
carries no SPF or DKIM alignment for *you*, so some recipients will filter it
more aggressively than mail from your own verified domain would be. It reaches
real customers, which `@resend.dev` does not — but 4b is still where this should
end up.

### 4b. Verify the domain in Resend

1. Resend → **Domains** → **Add Domain**. Give it a sending subdomain rather
   than the apex — `send.yourdomain.com` is the convention. A subdomain keeps
   the sending reputation of transactional mail separate from anything the apex
   ever does, and it means a bad sending run cannot poison the domain itself.

2. Resend shows you the records to add. There are normally four, and the exact
   values are generated per-domain and vary by region — copy them from the
   dashboard, do not copy them from here:

   | Type | Name | Purpose |
   | --- | --- | --- |
   | `MX` | `send` | Bounce and complaint feedback |
   | `TXT` | `send` | SPF (`v=spf1 include:amazonses.com ~all`) |
   | `TXT` | `resend._domainkey` | DKIM public key |
   | `TXT` | `_dmarc` | DMARC policy (recommended, not required) |

3. Add them wherever the domain's DNS lives. If you moved the nameservers to
   Vercel in step 2, that is **Vercel → Domains → your domain → DNS Records**,
   which handles `MX` and `TXT` fine.

4. Back in Resend, hit **Verify**. DNS propagation is usually minutes, but give
   it up to an hour before assuming something is wrong.

5. Set on Render and redeploy:

   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM="FreshFold <hello@send.yourdomain.com>"
   ```

   The address must be on the verified domain. Anything `@resend.dev` only ever
   reaches the address that owns the Resend account — which is why booking
   confirmations currently go nowhere.

### Where the contact form's enquiries go

The website's contact form posts to `POST /api/contact`, which writes the
enquiry to the `enquiries` table and *then* emails the desk — in that order, so
a provider having a bad morning costs the notification rather than the message.
The reply-to on that email is whatever address the visitor left, so answering
one is pressing reply.

By default the desk's copy goes to `EMAIL_FROM`'s address. That is not a
fallback chosen for convenience: it is the mailbox somebody verified by clicking
a link in it, so on any deployment where email works at all, the contact form
works too with nothing extra set. Set `CONTACT_EMAIL` when enquiries should land
somewhere else.

Two things worth knowing when somebody says they wrote in and heard nothing:

- `GET /api/contact?undelivered=1` — supervisor session — lists the enquiries
  that were recorded but never emailed. On a healthy deployment it is empty.
- The form tells the sender which of the two happened. "Sent. The desk has it"
  means the email left; the softer "we have your message, our mail is playing
  up" means it did not, and that list is where it is.

### Confirming it worked

There is a script for exactly this —
[`send-test-email.ts`](apps/server/src/send-test-email.ts). It goes through the
same `sendMail` the register route uses, so a success means the real flow works,
but it writes nothing and creates no account:

```bash
npx tsx apps/server/src/send-test-email.ts you@example.com
```

It reads `apps/server/.env`, so put the key and `EMAIL_FROM` there and you can
confirm the sender **before** deploying anything. It echoes back which provider
it picked and the From address — and, for Brevo, the parsed `{name, email}` that
actually goes on the wire.

Run it against an address that is *not* the one owning the provider account.
That is the case the shared `@resend.dev` sender fails and a verified Brevo
sender passes, and it is the entire question this step is answering.

On Brevo it then **waits for the delivery event** rather than trusting the API's
answer, and this distinction matters more than it sounds: Brevo returns 201 and
rejects an unrecognised sender a few seconds later, so "accepted" is what a
message that never leaves the building looks like. Three outcomes:

| Output | Exit | Means |
| --- | --- | --- |
| `RESULT: DELIVERED` | 0 | It reached the inbox. This is the only pass. |
| `RESULT: REJECTED after acceptance` | 1 | Brevo took it, then refused it. The reason is printed above the result — an unverified sender is the usual one. |
| `RESULT: accepted, but delivery UNCONFIRMED` | 2 | No event inside two minutes. Not a pass; check Brevo → Transactional → Logs. |

The commonest failure is `EMAIL_FROM` not matching a sender in Brevo →
**Senders, domains, IPs** character for character. Brevo names the address it
objected to in the rejection reason, so read it rather than guessing.

Second check, after the Render redeploy: the server prints what email will
actually do in its startup banner — `describeEmail()` in
[`index.ts`](apps/server/src/index.ts). You want your real From address and
`via brevo` (or `via resend`) in the Render logs. The shouty `DELIVERS ONLY TO
THE ADDRESS THAT OWNS THE RESEND ACCOUNT` line, or `not configured — links are
written to this log instead`, means the variables did not take.

Last, book a pickup on the live site with an address you control. The
confirmation carries the portal setup link, so it exercises the provider,
`APP_URL` and the link-signing path together — which the script does not.

A silent failure here is invisible from the product: the booking confirmation
is sent *after* the response, so a refusal leaves the customer with a cheerful
"check your inbox" and nothing in it. The refusal is logged with the provider's
own message, which is the only thing that distinguishes an unverified sender
from a malformed address — both are 4xx. Watch the logs on the first real send.

---

## Known wart

With `NODE_ENV=production` the server also mounts `express.static` over
`apps/web/dist` and falls back to `index.html` for unmatched routes
([`index.ts`](apps/server/src/index.ts)). On Render that directory does not
exist, because only the server is built there — so any non-`/api` request to the
`onrender.com` URL returns a 500 from `sendFile` instead of a 404.

Harmless in this topology: Vercel serves the website, and nothing should be
hitting the Render URL directly except the proxy, which only ever asks for
`/api/*`. Worth guarding on the directory existing if the bare URL is ever
public.

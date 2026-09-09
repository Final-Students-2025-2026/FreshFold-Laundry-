# FreshFold

Three products and one backend, in one repository.

- **The website** (`apps/web`) — the marketing site, the client portal customers
  book and track through, and the admin dashboard.
- **The rider app** (`apps/mobile`) — the Expo companion app couriers carry:
  accept jobs, navigate, scan bags, capture proof, hand off.
- **The customer app** (`apps/client`) — the Expo app customers carry: browse,
  book, watch the courier approach, pay, sign at the door.
- **The dispatch server** (`apps/server`) — the single source of truth all of
  them read and write.

A pickup booked on the website or in the customer app appears on a rider's
board. The rider's progress appears on the customer's tracking page and in
their app. There is no second copy of the data and no manual re-keying between
any of them.

## Layout

```
freshfold/
├── apps/
│   ├── web/        Vite + React + Tailwind — customer site, portal, admin
│   ├── mobile/     Expo + React Native + expo-router — rider console
│   ├── client/     Expo + React Native + expo-router — customer app
│   └── server/     Express — REST API, Gemini chatbot, Paystack
└── packages/
    └── core/       Domain model, status mapping, geography, API client
```

npm workspaces. `packages/core` is consumed as TypeScript source by all four,
so there is no build step between editing shared domain code and seeing it
everywhere.

## Running it

```bash
npm install
```

Start the server and the website together:

```bash
npm run dev
```

- website → http://localhost:3000
- dispatch API → http://localhost:4000

Then, in a second terminal, the rider app:

```bash
npm run mobile
```

…and the customer app, in a third:

```bash
npm run client
```

Scan the QR code with **Expo Go**, or press `a` / `i` for an emulator. Both apps
find the dispatch server automatically by reusing the host of the Expo dev
server — no IP address to configure, as long as everything is on the same
machine. They install side by side: different bundle ids, different schemes.

> **Expo Go version matters.** Both target **Expo SDK 57**, and a given Expo Go
> build supports exactly one SDK.

### Seeing the link work

All three apps start empty, so step 1 is where the system gets its first job.

1. Book something — on the website via **Schedule Pickup**, or in the customer
   app's Book tab.
2. Open the rider app. The booking is in the backlog, already carrying a pickup
   pin, a bag manifest with QR codes, a priority and a distance — all derived
   server-side from the address and order value.
3. Accept it and work through the steps. The bottom sheet drives the workflow.
4. Watch from the other side: the customer app's Track tab, or the website's
   client portal. The stage advances as the rider moves, and the map shows the
   courier's real position reported from the phone.
   At the door the rider must check the customer's **collection code** before
   the bags move — scan the QR on the customer's screen, or type the four
   digits. See below.
5. At the door, the customer app can sign for the delivery itself — the
   signature lands as the job's delivery proof.

Everything also works with the server down — all three apps fall back to local
storage and behave exactly as they did before there was a backend.

## How the two products share one record

The website has always called a job a `Booking`; the rider app has always called
it an `Order`. Both names are kept. They are projections of one server-side
`Job`:

```
Booking (customer)  ←── jobToBooking ──  Job  ── jobToOrder ──→  Order (rider)
   7 friendly stages                   15 dispatch states        15 dispatch states
   payment, schedule                   canonical record          bags, coords, proof
```

`Job.status` is the finer of the two vocabularies, so the customer's stage is
always derivable from it:

| Rider sees | Customer sees |
| --- | --- |
| `unassigned`, `assigned` | Scheduled |
| `navigating_to_pickup` … `arrived_at_laundry` | Collecting |
| `dropped_off` | In Care |
| `processing` | Ironing & Folding |
| `ready_for_delivery` | Quality Check |
| `navigating_to_delivery`, `arrived_at_delivery` | Delivering |
| `delivered` | Delivered |

Going the other way — an operator nudging a stage in the admin dashboard — is
lossy, so `fromBookingStatus` picks the *earliest* dispatch state in the target
stage rather than claiming work that has not happened.

`Delivering` is its own stage rather than part of Quality Check. A courier
riding to the door used to read as *Quality Check* with the bar stuck at 90%,
which is a poor thing to be told while somebody is outside with your laundry.

**The round trip.** `deliveryCoords` is the customer's own door, not the hub.
The hub leg has its own destination in the rider console, so naming the hub
here — which is what the code did — routed the final leg back to the laundry
with the customer's clean clothes still on the seat. Moving the pickup pin
moves both ends.

**All three apps speak the seven stages.** The supervisor's dashboard and the
customer's timeline always did; the rider console showed only the dispatch
vocabulary, so a stage moved from the desk changed what the customer read and
left no trace on the phone carrying the bags. Its job cards and its active
workflow now carry a *Customer sees:* pill derived through the same
`toBookingStatus` mapping, and a stage change from any surface reaches the other
two on the next poll — about a second in practice, four at worst.

**Somebody confirms every stage.** The three points where the bags physically
change hands are confirmed by a person, and so are the two stages between them.
A courier scans the customer's collection code at the door, types the desk's code
at the hub, and takes the customer's code back at the end; finishing the
collection leg is what puts a job In Care. From there the desk's **Hub** tab is
the path forward — a supervisor confirms *Washed*, which moves the job to Ironing
& Folding, and *Finished & folded*, which moves it to Quality Check. Each
confirmation is a claim a named person is making, recorded as theirs in the audit
trail.

That matters because the alternative was a clock. Both stages used to advance on
elapsed time — two minutes each — and each expiry fired the real customer message
and the real timeline entry. "Your laundry is being pressed" on the evidence that
a number had passed. Nothing anywhere recorded that a garment had been washed,
because nothing knew.

The stages are still walked in order — `dropped_off` → `processing` →
`ready_for_delivery` — rather than jumping the middle one. Ironing & Folding was
otherwise unreachable except by a supervisor selecting it by hand, which on a
laundry service is the stage the customer is actually paying for. Reaching
Quality Check files an alert for the courier holding the job, or for the whole
roster if none is, because that is the one moment in the hub's leg somebody has
to act on.

**The timed sweep survives as a development convenience.** It lives in the server
(`apps/server/src/hub.ts`), not on the courier's phone: a `setTimeout` in the
rider app made the laundry's progress a property of one device being awake — a
courier who dropped bags off and then closed the app, lost signal or ended their
shift left the job at In Care permanently, and whichever phone got there first
stamped its own `riderId` onto stages it had not worked.

It is **off in production** unless `HUB_WASH_MINUTES` or `HUB_FINISH_MINUTES` is
set, and on everywhere else, so `npm run dev` can still show a job going round
once without three people and a press table. Every advance it makes is filed in
the audit trail against `system`, with the dwell that expired and the plain
admission that nobody confirmed the work — so the answer to "who said this load
was washed" is always either a supervisor's name or *nobody*.

**Every job on the phone's board is scoped by `riderId`.** The server sends each
courier their own jobs *plus the open pool*, so the rider app has to tell the
two apart — and until `Order` carried a `riderId` it could not. Its active
workflow took the first job on the board that was not `unassigned`, which is
correct only while exactly one job is ever in flight; with two, every courier's
phone drove the same one and the hub cycle ripened whichever it found, stamping
its own id on a job nobody had accepted. In Care and Ironing & Folding could
therefore not be held by anyone: a stage set from the desk was walked to Quality
Check within eight seconds.

The other half of that is what the desk can strand. Moving a booking to a
courier leg without naming a courier leaves it in flight with nobody holding it,
and a backlog keyed on `unassigned` hid those jobs from the whole roster — the
customer read *Collecting* with nobody collecting. The backlog is anything still
running that no courier holds, and accepting one of those claims it **where it
stands** rather than resetting it to `assigned`, which would rewind a collected
job to Scheduled.

The `id` is shared: `FFC-882049` is the customer's booking reference *and* the
rider's job id, so one number means one thing in a support conversation.

All of this lives in [`packages/core/src/job.ts`](packages/core/src/job.ts) and
[`packages/core/src/status.ts`](packages/core/src/status.ts).

## The collection hand-off

A courier turning up at a door proves nothing on its own, and neither does a
customer opening it. Every job therefore carries a four-digit `pickupOtp`,
minted once when the job is created and kept for its life.

The customer's app and the website both render it as digits *and* as a QR. The
rider app will not advance a job past `arrived_at_pickup` until one of the two
checks out.

```
FFH1|FFC-780145|pickup|6056
└─┬┘ └────┬───┘ └──┬─┘ └┬─┘
version  job id   leg   code
```

The job id travels inside the QR deliberately: without it, a courier holding
two jobs on one street could have the wrong customer's code accepted against
the job they are actually on. `verifyHandoff` in
[`packages/core/src/job.ts`](packages/core/src/job.ts) rejects a payload whose
id, leg or version does not match, and accepts bare digits only as the typed
fallback — because cameras fail in the rain and a courier at a door cannot be
blocked by that.

The code is minted by `bookingToJob`, which the server re-runs whenever a
booking is upserted. `POST /api/bookings` therefore carries the existing code
over on an id collision; otherwise an offline replay would silently invalidate
the code the customer is already holding up.

Jobs created before this existed have no code, and the rider app lets those
through rather than stranding them at a gate they can never satisfy.

## API

Everything is under `/api`. The website reaches it through Vite's dev proxy; the
rider app over the LAN.

| Route | Purpose |
| --- | --- |
| `GET /health` | Reachability probe both apps use to decide online/offline |
| `POST /auth/register`, `/auth/login` | Sign-up and sign-in; returns a bearer token |
| `POST /auth/logout`, `GET /auth/me` | Revoke a token, validate one |
| `POST /auth/status` | Whether a contact has a login yet — booleans only |
| `GET/POST /bookings`, `GET/PATCH/DELETE /bookings/:id` | Customer view |
| `GET/POST /orders` | Dispatch view |
| `POST /orders/:id/accept`, `/decline` | Claiming a job (409 if already taken) |
| `PATCH /orders/:id/status` | Workflow transitions, proof photos, signatures |
| `POST /admin/login`, `GET /admin/me`, `POST /admin/logout` | Supervisor desk sign-in |
| `GET /admin/audit` | The append-only trail of desk actions, newest first. Supervisor only |
| `POST /riders` | Provision a courier; returns a one-time PIN. Supervisor only |
| `PATCH /riders/:id/active` | Take a courier off the roster, or put them back. Supervisor only |
| `POST /riders/login`, `GET /riders/me`, `POST /riders/logout` | Courier sign-in against the roster |
| `POST /riders/change-pin` | Replace a temporary PIN. Courier only |
| `GET /riders`, `GET/PATCH /riders/:id` | Roster, presence and live telemetry — all behind a courier session; a rider may only PATCH their own record |
| `GET/POST /messages` | One conversation per job, all three surfaces. `?orderId=` is any party to that job; without it, the whole board's traffic, supervisor only and paged (`?limit=`, default 500) |
| `GET/POST /notifications`, `POST /notifications/:id/read` | Rider alerts |
| `GET/PUT /accounts`, `PUT /accounts/addresses` | Customer accounts and the saved address book. `GET` is the desk's directory; `PUT` writes the caller's own record |
| `POST /bookings/:id/refund` | Returns a settled bill to the patron's wallet. Supervisor only, whole-bill, idempotent on the booking's own reference |
| `POST /bookings/:id/rating` | Rates the courier on a delivered order. The customer's alone; one per order, revisable |
| `GET /bookings/availability?date=` | How full each collection window is that day. Open, like the booking form it serves |
| `GET /transactions` | Payment ledger, scoped by the token: a customer's own statement, or the whole ledger for the desk. Read-only — every row is written server-side by a wallet movement |
| `GET /jobs` | Canonical records, for debugging. Supervisor only |
| `POST /reset` | Empty the ledger back to a fresh install. Supervisor only, and refused outright in production |
| `POST /chat` | Gemini-backed "Foldie" concierge chatbot |
| `POST /paystack/initialize`, `GET /paystack/verify/:ref` | Payments |
| `POST /paystack/webhook` | Paystack's own settlement callback. HMAC-signed with the secret key, read as raw bytes, and the only route that credits a wallet without anyone asking it to |
| `POST /accounts/wallet` | The one path that moves a balance or points. A `topup` carries a Paystack reference, never an amount — the server verifies it and credits what was collected |

### The database

Records live in Supabase Postgres. The schema is one migration —
[`supabase/migrations/20260814000000_initial_schema.sql`](supabase/migrations/20260814000000_initial_schema.sql) —
and every query that touches it is in
[`apps/server/src/store.ts`](apps/server/src/store.ts). No route builds SQL of
its own.

Setting it up on a fresh Supabase project:

1. Set `DATABASE_URL` in `apps/server/.env` to the project's connection string —
   dashboard → Project Settings → Database → Connection string → URI, with
   `[YOUR-PASSWORD]` replaced by the database password. Prefer the pooled string
   (port 6543) for anything deployed.
2. `npm run db:migrate -w @freshfold/server`. Each file in `supabase/migrations`
   runs once and is recorded in `schema_migrations`, so this is safe on every
   deploy — and `-- --dry-run` lists what is pending without touching anything.
   Pasting the SQL into the Supabase editor by hand works too.
3. `npm run server`. The three bootstrap identities below are created on first
   boot if the tables are empty.

The server refuses to open its port if the database is unreachable, and
`GET /api/health` answers 503 rather than `ok` in that state — an instance that
is up but cannot reach Supabase serves nothing but errors, and a health check
that lies about it is what keeps a broken one in the load balancer.

Nested value objects on a job — `customer`, `service`, `schedule`, `location`,
`dispatch`, `payment` — are stored as JSONB, because `applyStatus` in
`@freshfold/core` reads and rewrites them whole and nothing queries inside
them. The two fields that *are* filtered on, `rider_id` and `customer_email`,
are generated columns derived from that JSONB, so they cannot drift from it.

If you are coming from the old JSON store, `apps/server/data/db.json` still
works as an import source and is left untouched by the process:

```bash
npm run import:json -w @freshfold/server -- --replace
```

It runs as a single transaction, drops messages and notifications whose job no
longer exists, drops expired sessions, and prints what it moved.

**A fresh install has no jobs.** There is no demo data: every order in the
system is one somebody booked, so the rider's board and the supervisor's ledger
only ever show real work, and all three apps open on empty states until you
book something. What is created on first boot is identity, and none of it is a
job — see [`apps/server/src/seed.ts`](apps/server/src/seed.ts). Each is seeded
only while its table is still empty, so restarting against a database that
already has a roster does nothing.

**In production, one thing is seeded:**

- **A supervisor**, `supervisor@freshfold.com`, whose password comes from
  `SEED_SUPERVISOR_PASSWORD`. Somebody has to be able to sign in and put the first
  courier on the roster. A fresh production database with that variable unset
  refuses to start, which is deliberate — this account can read every customer's
  address and phone number and settle any bill, and it used to be created with the
  password `password` on any deployment that met an empty database. Existing
  deployments need no new configuration: the variable is read only when the
  `supervisors` table is empty.

The roster and the customer directory start empty there and fill with real
people — couriers are hired through the supervisor desk, which issues a random
temporary PIN, and customers register themselves.

**In development, two more, for a door into each app:**

- **A courier roster** of three provisioned riders. Couriers are never
  self-registered — these are employment records carrying an id, an employee
  number, a contact number and a hashed PIN. Name, vehicle and plate are blank
  until the courier enters them, and every performance figure starts at zero.
- **Three sign-in accounts**, so there is a door into the customer app before
  you have registered one. Identity and password only: no points, no wallet, no
  history.

Both use the password `password`, and so does the supervisor unless
`SEED_SUPERVISOR_PASSWORD` says otherwise. The startup banner prints the desk
address and password it used, so there is nothing to look up.

| Courier | Employee ID | Phone | PIN |
| --- | --- | --- | --- |
| `FF-R-204` | `RIDER-204` | `0244567801` | `7801` |
| `FF-R-118` | `RIDER-118` | `0209114402` | `4019` |
| `FF-R-337` | `RIDER-337` | `0553370915` | `1234` |

Signing in with the phone number on the record works too.

### The audit trail

Every action a supervisor takes from the desk that changes somebody's order,
money or standing is written to `audit_events` — a stage confirmed, a cash
payment settled or reversed, an order deleted, points adjusted, a patron blocked
or removed, a courier hired, reassigned or deactivated. The Settings tab reads it
back through `GET /api/admin/audit`, newest first.

Entries are **written by the route that performs the action**, not by the
browser, and inside the same transaction wherever the action has one: a
rolled-back change leaves no trail, and a committed one always has one. The table
is append-only, has no `order_id` foreign key — deleting an order must not delete
the record that somebody deleted it — and nothing prunes it.

This replaces a log the desk kept in its own `localStorage`. That version was
capped at fifty entries by an array `slice`, visible only to the browser that
made it, erased by clearing site data, and keyed on `LOG-` plus four random
digits, which collide. A colleague could not see what you had changed, which is
the one thing an audit trail is for.

Two things are deliberately absent. A **courier's** stage advance is not
recorded, because it is already on the customer's timeline with the hand-off code
and proof photo attached, and twenty routine taps per job would bury the
overrides this pane exists to show. And `POST /api/reset` writes nothing, because
it truncates the table it would write to — and refuses to run in production
anyway.

The hub's timed sweep, when it runs at all, files its advances against `system`
rather than a name, so the trail can say plainly that nobody confirmed a load.

### Phone numbers

A Ghanaian mobile number is ten digits — `0XX XXX XXXX` — so every field that
takes one holds exactly ten, and holds nothing but digits: spaces, dashes and a
`+233` prefix are dropped as they are typed and the eleventh digit never lands.
Nine digits is a typo and eleven is a typo, and both reach the wrong doorstep or
charge the wrong MoMo wallet, so the rule is enforced in the field, again on
submit, and again on the server for every route that accepts a number. The rules
themselves live in one place, `packages/core/src/phone.ts`, because a number
typed into the booking modal and the same number typed into the rider roster
have to end up identical in the database.

Numbers already stored in international form still match what somebody types
locally: comparisons run on the last nine digits, so `0244567801` and
`+233 244 567 801` are the same courier.

### Hiring a courier

A new courier does not sign up; they are hired. The **Courier Roster** tab on
the supervisor desk is where one comes into existence:

1. A supervisor enters the courier's name, phone number, and the company
   vehicle they will ride with its plate. A number already on the roster is
   refused, with the employee ID it belongs to. The vehicle is required: the
   customer is shown it and the plate at the door, and a plate nobody at
   FreshFold checked is not proof of anything. It can be reassigned later from
   the same panel — vehicles go in for repair and riders swap — and the rider
   app shows both read-only.
2. **The server assigns the employee ID** — the next free `RIDER-###` — and
   returns it with the new record. The supervisor does not type it: it is what
   the courier signs in with, so a typo is a courier locked out on their first
   morning, and two supervisors hiring the same morning would otherwise collide.
   It is fixed from then on; the rider app shows it read-only and the telemetry
   endpoint ignores any attempt to change it.
3. **The server generates the PIN** too, and shows it once alongside the ID.
   Nobody types it — a credential the supervisor chose is one they can guess
   later, and under time pressure the choice is always `1234`. It is hashed
   immediately and cannot be read again. Both reach the courier out of band —
   in person, or by phone. The PIN expires in 48 hours if unused.
4. **First sign-in forces a replacement.** Until then `mustChangePin` is set and
   the console redirects to the change-PIN screen with no way past it: a
   provisional PIN is one a second person also knows.
5. Leaving flips `active: false`. Deactivated rather than deleted — deleting
   would orphan every job they carried — and it blocks new logins *and* live
   tokens, since the roster is checked on every request.

### Hand-off codes

Both ends of the round trip are gated by a four-digit code the customer holds,
minted per job when it is created and never regenerated.

**Collection** is a QR the customer shows and the courier scans; the code
travels to the rider app so a scan still verifies in a stairwell with no
signal.

**Delivery** is the mirror image, and deliberately asymmetric: the code goes to
the customer's screens only. The rider console never receives it, types what it
is told, and the *server* decides. Before this it was the constant `7809` for
every job in the system — the courier's app knew it, the "request OTP" button
texted it to the customer, and the error message printed it, while the
customer's own screen masked it to `••••`.

**The override** is for the real world: nobody in, the porter took it, the gate
is locked. The courier writes what happened, and it always succeeds — a courier
cannot be left holding somebody's laundry because a customer's phone is dead.
It is recorded on the job as `proof.deliveryOverrideReason`, raised to the desk
as an alert, and narrated to the customer. A refusal to complete without either
a code or a reason is a `403`; a one-word reason is a `400`.

### Road routes

Every map used to draw the courier's path as a straight line between two
points — across the botanical gardens, through Unity Hall, over whatever was in
the way. On the hub-to-Ayeduase run that line is 3.3 km where the road is
5.3 km, so it was not only wrong to look at: every ETA derived from it was 60%
short on distance.

`GET /api/directions?fromLat=&fromLng=&toLat=&toLng=` asks Google's Routes API
for the geometry a scooter would actually ride and returns it decoded, with the
distance and a traffic-aware duration. It lives on the server for three
reasons: the key stays out of all three client bundles, one answer is shared by
the courier's console, the customer's tracking map and the supervisor's
dashboard, and repeats are cached — coordinates round to about eleven metres,
so a courier polling every four seconds does not bill a request every four
seconds.

It degrades rather than fails. No key configured, quota gone, Google
unreachable: the response is the straight line with `source: 'straight'`, and
the maps draw it dashed rather than pretending it is a route. Set
`GOOGLE_MAPS_PLATFORM_KEY` in `apps/server/.env` (Routes API enabled) to turn
real routing on.

**An arrival time comes from a road or it is not shown.** `routeEtaMinutes()`
answers only for a leg the routing engine computed, and returns `null` for the
straight-line fallback — so the customer's tracking map, the courier's
navigation strip and the desk's live map all show the same figure, from the same
cached answer, or no figure at all. Every one of them used to show the chord
between two points divided by an assumed 18 km/h, which is where the 60% came
from. The surfaces with no route in scope show the stage the job is at instead;
there is no stored duration on a job any more, only the distance, which is a
real measurement.

Re-routing is deliberately lazy — a new route only when the destination changes
or the courier has strayed 80 m from the road they were given, at most once
every 20 seconds. That is roughly four to six billed calls per job.

### The dispatch desk

**It opens at `/admin`, and nothing on the site links to it.**

That is deliberate — a staff console has no business advertising itself in a
customer's header or footer — but the URL then lives only in whoever's head it
was last in, so it is written down here. `/#admin` is a permanent alias and
normalises to the path form on arrival. Case does not matter.

The password is the security boundary, not the obscurity: the desk is behind
`AdminLogin` either way, and the seeded account is the one under **A fresh
install has no jobs** above. In development the startup banner prints the desk
address and password it used.

A mistyped address now says so rather than quietly drawing the marketing page —
see `apps/web/src/components/NotFound.tsx` for why that is worth a screen of its
own. To ask a *deployment* whether the desk is still there:

```bash
npm run smoke --workspace @freshfold/web
```


A courier writing to dispatch used to get an answer in three seconds, composed
on their own phone: a `setTimeout` picked one of four sentences — "Copy that.
Operational details synchronized with the Admin Dashboard." — so the console
would feel staffed. Because `POST /messages` derives a sender from the token and
ignores one in the body, that reply was stored as the *courier's own words*, and
the customer read it in their portal attributed to the person carrying their
laundry.

The desk's **Inbox** tab is a person instead. It reads every thread on the board
and replies into them as Dispatch, through the same `POST /messages` the customer
and the courier use. A desk reply files a notification, so it reaches both of
them rather than waiting to be found; a message *to* the desk does not, because
`Notification` has no recipient and an order-scoped notice goes to everybody on
the job.

There is no unread count, on the tab or in the pane. `Message` carries no read
state, so the figure beside the tab is the number of threads a customer or a
courier spoke into last — which is a fact about the rows, not a guess at who is
owed an answer.

## Configuration

Each app has a committed `.env.example`. Copy it to `.env` and fill in what you
need; nothing is required to run the demo locally.

| Variable | App | Needed for |
| --- | --- | --- |
| `SEED_SUPERVISOR_PASSWORD` | server | The first desk account. Required on a fresh **production** database; in development the seed falls back to `password` |
| `GEMINI_API_KEY` | server | The concierge chatbot |
| `GEMINI_MODEL` | server | Overriding the chatbot model (default `gemini-3.5-flash`) |
| `PAYSTACK_SECRET_KEY` | server | Real MoMo / card payments |
| `APP_URL` | server | Paystack callback URLs |
| `CORS_ORIGINS` | server | Locking the API to known origins in production |
| `VITE_GOOGLE_MAPS_PLATFORM_KEY` | web | The live dispatch map |
| `EXPO_PUBLIC_API_URL` | mobile, client | Only if the server isn't on the dev machine |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | mobile, client | Standalone Android builds only |

## Checks

```bash
npm test
```

Type-checks every workspace and runs the assertion suites. There is no test
framework here: the suites are plain `*.check.ts` scripts that compare values,
print a line each and exit non-zero, which is enough for what they cover and
less machinery than it would replace.

| | |
|---|---|
| `npm run lint` | `tsc --noEmit` across every workspace |
| `npm run check` | The assertion suites only |
| `npm test` | Both |
| `npm run smoke -w @freshfold/web` | Asks a *deployed* site whether the desk is still there. Not part of `npm test` |

What is covered: the pricing, membership and loyalty arithmetic
(`packages/core/src/money.check.ts`), calendar dates, the address book, phone
and email rules (`details.check.ts`), the courier's job assignment
(`apps/mobile/src/store/workload.check.ts`) and the bag scanner (`scan.check.ts`).
That is mostly the pure-function core — the money and the dispatch rules.

The website has two suites of its own, and they are here because of a specific
bug rather than for symmetry. `apps/web/src/route.check.ts` covers which address
opens which screen; `desk.check.ts` covers the supervisor desk's session gate,
led by the assertion that no state renders *nothing*. That gate once had three
states and handled two, so the desk drew an empty overlay over the marketing
page for the length of a request — which looks exactly like the site working,
and was reported as the desk having disappeared. It type-checked, it reviewed
cleanly, and it shipped, because nothing in this app ran any of its behaviour.

Neither suite is a browser: they exercise the logic that decides what renders,
not the rendering. What that logic hands to React is still only checked by
opening it.

**`npm run smoke --workspace @freshfold/web`** is separate and not part of
`npm test`, because it talks to a live deployment — a suite that goes red when
Render is asleep is one people stop reading. It asks a deployed site whether the
desk route is served, whether the JavaScript actually out there contains the
desk, and whether the API behind it answers. Point it somewhere else with
`-- https://…`.

The two builds run `tsc --noEmit` before they emit anything. That is not
redundant with `npm run lint`: Vite and esbuild both strip types without checking
them, so a type error used to produce a clean build and a runtime crash. It has
done exactly that at least once.

## Building for production

```bash
npm run build
npm start
```

`build` compiles the website to `apps/web/dist` and bundles the server to
`apps/server/dist/server.cjs`. `start` runs the server, which serves the website
itself — one process, one port.

The website is split: the marketing page is the entry chunk, and the client
portal, the supervisor desk, the booking form and the map libraries are fetched
when something asks for them. A visitor who never opens the portal never
downloads it.

## Credentials

Passwords are hashed with scrypt and never leave the server. A sign-in posts
the attempt to `/api/auth/login`, which compares it server-side and returns a
bearer token; the browser stores the token and a profile, never a credential.
`GET /api/accounts` returns profile fields only, and `PUT /api/accounts` writes
through an allow-list, so a password cannot be set by including one in the body.

In development, the three sign-in accounts created on first run all use the
password `password`: `ama.serwaah@st.knust.edu.gh`, `kofi.mensah@gmail.com` and
`adwoa.osei@outlook.com`. They start empty — no orders, no points, no wallet.
They are not created in production, where the customer directory starts empty and
fills with people who registered; see [The database](#the-database).

## Known limitations

Kept honest deliberately: several entries here described work that had since been
done, which is worse than no list — it understated the product to anyone reading
it and pointed a contributor at problems that were already closed. What follows
is what is actually open.

- **A courier's PIN is four digits.** That is the right shape for someone
  wearing gloves at a doorstep and the wrong shape for resisting a guessing
  attack. `POST /riders/login` is now rate-limited — eight attempts per employee
  ID per quarter hour, and thirty per address — which puts a full walk of the
  10,000-key space beyond three hundred hours. The limiter is in-memory, so it
  resets on deploy and is per-instance; a longer PIN, or a lockout recorded on
  the roster row, is the stronger fix.
- **Sessions are bearer tokens in `localStorage`**, which is XSS-readable. A
  same-site HTTP-only cookie would be the stronger choice.
- **CORS defaults to permissive in development** so a phone on the LAN can
  reach the API. Set `CORS_ORIGINS` in production; leaving it unset there blocks
  cross-origin requests and logs a warning.
- **The rider's position is the device's real fix**, watched through
  `expo-location` while the courier is online. A fix outside the Kumasi service
  area is replaced by the hub, because every distance and ETA in the system is
  computed against Kumasi addresses and a phone in another city would otherwise
  report a courier 200 km from a pickup. That means the courier does not appear
  to move unless the phone does — there is no longer anything driving the map
  on its own.
- **Sync is polling**, every 4-5 seconds. Fine at this scale; websockets or SSE
  would be the upgrade.
- **Neither translation has been read by a native speaker.** The customer app
  reads in English, Spanish and French, and all three dictionaries are complete —
  but the Spanish and the French were both drafted rather than reviewed, and want
  a speaker's pass before release. `translate` falls back key by key, so a string
  added to English shows in English on that one label rather than dropping the
  whole language, and the settings screen badges any language whose keys are not
  all present. Run `npm run i18n --workspace @freshfold/client` for the coverage
  table, or `-- es` for one language's outstanding keys with the English beside
  them.

  Twi, Ga and Ewe were offered for a while and are gone. They reached 21%, 12%
  and 1% and were withdrawn rather than finished: a language in a picker that is
  a fifth written is a worse promise than one not offered. The machinery that
  carried them is unchanged, so adding a language back is a dictionary file, a
  line in `LOCALES` and a label.
- **Neither translation has been read by a native speaker.** The app reads in
  English, Spanish and French — 539 keys of the app's own copy plus 109 strings
  of catalogue (service descriptions, plan benefits, testimonials), all three at
  100%. Both the Spanish and the French were drafted rather than reviewed and
  want a speaker's pass before release.

  Three things stay English in every language, and each for the same reason —
  they are identifiers rather than copy. **Service names** are the wire value a
  booking stores in `serviceType`, matched by `serviceByName` on the server.
  **Plan names** are the commercial terms quoted back on membership records.
  **Testimonial names** are people. The descriptions, taglines, benefits and
  roles around all three are translated.

  `npm run i18n --workspace @freshfold/client` reports both dictionaries; add
  `-- es` for one language's outstanding app keys.
- **Quantity and the service lines cannot be edited after booking.**
  `applyBookingPatch` does not reprice — `amount` is written once by
  `POST /bookings` and moved only by the payment route — so accepting a new
  quantity there would leave a job saying "four loads" beside a total quoted for
  one. Correcting either means cancelling and rebooking, which is already what
  correcting the service means.
- **A large manifest is a long list.** Bags now follow the real count, so a
  40-unit order gives the courier 40 rows to scan in `QRScanner`. Each row names
  the service it belongs to, but they are not grouped or paged.
- **`read` on a notification is one shared flag**, not per-recipient state, so
  the desk and the customer clearing the same notice clear it for both.
- **The in-memory rate limiters are per-instance.** Two servers behind a load
  balancer allow twice the stated rate between them. That is the honest cost of
  not having Redis here, and it still turns an unbounded number of attempts into
  a bounded one.

### Closed since this list was written

Left here because the list said otherwise for a while, and anyone who read it
then should be able to see what changed.

- ~~The booking write routes are open.~~ Every read and write of a booking goes
  through `resolveBookingAccess` — supervisor, the customer it belongs to, the
  courier holding it, or a tracking token. See `apps/server/src/booking-access.ts`.
- ~~`PATCH /orders/:id/status` is unauthenticated.~~ Behind the same check, with
  per-actor rules: a courier may only move a job they hold, and a customer may
  complete their own delivery but may not waive the code.
- ~~`GET /api/bookings` is unauthenticated, so collection codes are public.~~
  Scoped by the token: a customer's own orders, or the whole board for the desk.
- ~~No rate limiting on `/api/auth/login`.~~ All three credential routes —
  customer, courier and supervisor — are limited per account and per address.
- ~~`POST /api/transactions` lets a signed-in customer write ledger rows.~~
  Removed. Every row a customer can cause is written server-side by `topUp`,
  `charge` or `redeem`, in the same transaction as the balance it explains.

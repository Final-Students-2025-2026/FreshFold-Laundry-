# FreshFold — the customer app

Everything the website offers a customer, plus the live-dispatch surfaces the
rider app introduced, on a phone.

This is a third product against the same dispatch server, not a replacement for
either of the first two. `apps/web` keeps the marketing site and the admin
dashboard; `apps/mobile` keeps the courier console. A booking made here appears
on a rider's board, and a rider's progress appears here, because all three read
and write one `Job` record through `@freshfold/core`.

## Running it

From the repository root, start the dispatch server (and the website, if you
want to see both ends):

```bash
npm run dev
```

Then, in a second terminal:

```bash
npm run client
```

Scan the QR code with **Expo Go**, or press `a` / `i` for an emulator, or `w`
for the browser. The app finds the dispatch server by reusing the host of the
Expo dev server, so there is no IP address to configure as long as both are on
the same machine.

> Targets **Expo SDK 57**, like the rider app. A given Expo Go build supports
> exactly one SDK.

The rider app and this one install side by side — different bundle id
(`com.freshfold.client`), different scheme (`freshfoldclient`), different slug —
so you can run a delivery from both ends on one device.

## What is in it

| Screen | What it carries over |
| --- | --- |
| **Home** | The website's landing page — hero, service catalogue by category, how it works, why us, segments, testimonials, contact — plus a live strip for the order currently in flight |
| **Book** | `BookingModal` as five steps: service → schedule → address → finishing → payment, with a running quote and a pickup pin the customer places themselves |
| **Track** | The client portal's progress bar and the dispatch map, as the whole screen |
| **Order** | Manifest, finishing choices, proof of service, receipt, cancellation |
| **Wallet** | The portal's wallet tab and the Membership section: balance, top-up, ledger, loyalty tier, subscription |
| **Account** | Profile, saved addresses, biometric unlock, order history, support |
| **Chat** | The per-job conversation, shared with the courier and dispatch |
| **Foldie** | `ChatbotWidget`, Gemini-backed through `/api/chat` |

Three capabilities come from the rider console rather than the website, adapted
so the customer is the one holding the phone:

- **Bag scanning.** The courier scans to claim the bags onto the job; the
  customer scans to keep their own count. It writes nothing to `Job.dispatch` —
  the rider owns that field, and two surfaces writing it would race. What it
  produces is a line in the shared conversation.
- **Issue reporting.** `CameraCapture` mirrored: photograph a garment, state
  what happened. The photo is attached to the job as well as the thread, but
  only when live telemetry tells us which status to attach it to — naming any
  other status would rewind or fast-forward the courier's progress.
- **Delivery signature.** The rider console captures a signature *from* the
  customer; here they give it directly, which is the more honest chain of
  custody and the reason the `delivered` transition is theirs to make. The
  handover code is checked before anything is sent.

## The pickup pin

An address is a sentence — "Evandy Hostel, Block B, Room 304" — and a courier
needs a point. The server can derive one with `coordsForAddress`, which hashes
the text into a stable offset from the suburb anchor, but stable is not the same
as correct: that pin lands some 400 m from Evandy Hostel, and dropping the comma
moves it 300 m again. Good enough to draw on a map, useless as a doorstep, and
worse now that the rider app confirms arrival within 35 m of it.

So the Address step asks. `PickupPinPicker` works the way every ride-hailing
app on the phone does: the pin is fixed to the centre of the view and the map
moves under it, which keeps the target visible instead of under a thumb, and
the coordinate commits when the map settles. "Use my current location" is the
other way in. Underneath, the platform geocoder reads back the street the pin
is standing on — free, unlike a Geocoding API call — with one tap to adopt it
as the address.

The coordinate travels with the booking as `Booking.pickupCoords`;
`pickupPinFor` prefers it and falls back to the derived point for bookings made
anywhere else. A pin outside the Kumasi service area is refused rather than
quietly swapped. Saving the address saves its pin, so the second booking to the
same door needs no pinning at all.

Tiles are Google's, on both platforms — `src/mapProvider.ts`, which the tracking
map uses too, so the customer's map, the courier's console and the supervisor's
dashboard all draw the same roads. Android needs no key in Expo Go; iOS falls
back to Apple Maps unless `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` is set, because
asking for Google there without a key renders a grey rectangle rather than a
map.

`react-native-maps` has no web build, and importing it there fails the bundle
rather than throwing at runtime — hence `PickupPinPicker.web.tsx`, which renders
the panel alone. The browser can still set a real pin from its own geolocation,
or explicitly choose the centre of the suburb, which is the old derived
behaviour made a choice instead of an assumption.

## Bags without a bag endpoint

`Booking` is the customer projection and deliberately carries no dispatch
detail, so the manifest on the order screen is re-derived with `bagsForJob` —
the same function the server used to create it. It is deterministic on
`(id, amount, serviceType)`, so the codes match the ones printed on the bags
without an extra endpoint and without any chance of the two lists disagreeing.

## Offline

Same three rules as the website's store, adapted for a device:

1. **Reads are synchronous.** The mirror hydrates from AsyncStorage once at
   startup; every read after that comes out of memory.
2. **Writes are write-through.** They land in the mirror and in storage
   immediately, then go to the server in the background. A failed write is
   queued in order, not lost.
3. **The server pushes back by polling**, every four seconds.

With the server unreachable the app still books, still shows history and still
queues its writes — it just cannot see the courier move.

## Accounts

Bookings do not require one. The website takes bookings from visitors who are
not signed in, and so does this app; `/auth` is offered from the account tab and
from checkout, never imposed at the door. What an account adds is the wallet,
the loyalty tier, the subscription, and history that follows you between
devices.

Passwords go to `/api/auth/*` and come back as a bearer token. Nothing but the
token and the profile is stored on the device.

## Configuration

Copy `.env.example` to `.env`. Nothing is required to run the demo locally.

| Variable | Needed for |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Only if the dispatch server isn't on the dev machine |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Standalone Android builds only |

## Known limitations

- **The tracking map is read-only and iOS/Android only.** `react-native-maps`
  has no web build, so the browser gets `MapPanel` — the same positions,
  distances and ETA as a coordinate readout. A native mount failure degrades to
  the same panel through an error boundary rather than taking the screen down.
- **Card and mobile-money authorisation is simulated.** Paystack is real
  (`/api/paystack/*`); the MoMo prompt and the card form resolve on a timer,
  because there is no acquirer behind the demo.
- **A membership downgrade does not pay the difference back.** Switching credits
  the unused part of the running month against the new plan's fee; where the old
  plan was worth more, today's charge is ₵0 and the excess is not refunded. The
  plans sheet says so before the switch.
- **Renewal is lazy, not scheduled.** There is no cron: `/auth/me` and the plan
  routes settle a due renewal when they are read, and the app polls `/auth/me`,
  so a month rolls over the next time the customer opens the app. An account
  nobody opens renews the moment somebody does.
- **Notifications are polled, not pushed.** There is no `expo-notifications`
  registration, so nothing arrives while the app is closed.

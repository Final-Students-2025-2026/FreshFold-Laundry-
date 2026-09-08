# FreshFold Dispatch — Rider Companion

A React Native / Expo app for FreshFold's laundry riders: accept dispatch offers, navigate to
pickups on a live map, scan bag QR codes, capture proof photos and signatures, and hand off to
the customer with an OTP.

This is one half of the [FreshFold monorepo](../../README.md) — the other half is the customer
website, and both talk to the same dispatch server. Jobs shown here are real bookings made on
the website, and the progress recorded here is what the customer watches on their tracking page.

## Running it

From the repository root:

```bash
npm install
```

Start the dispatch server (and the website) first, so there is a board to pull from:

```bash
npm run dev
```

Then, in a second terminal:

```bash
npm run mobile
```

Scan the QR code with **Expo Go** (Android/iOS), or press `a` / `i` to open an emulator.
No API keys are needed.

The server address is derived from the Expo dev server's own host, so a phone on the same
Wi-Fi finds it with no configuration. Override it with `EXPO_PUBLIC_API_URL` if the server
lives somewhere else — note that `localhost` will never work from a physical phone.

With no server reachable the app runs on whatever it last cached in AsyncStorage — no invented
jobs, so a console that has never connected shows an empty board and says so.
`useApp().connected` says which mode it is in.

`npx expo start --web` also works for a quick browser look at the flows, with a coordinate
readout standing in for the map — `react-native-maps` is iOS/Android only.

> **Expo Go version matters.** This project targets **Expo SDK 57**, and a given Expo Go build
> supports exactly one SDK. If your Expo Go is built for a different SDK, the project will fail
> to launch. Check the SDK your Expo Go supports on its home screen, and either match it here or
> install the matching Expo Go.

## Walkthrough

Everything here runs against the dispatch server. There is no simulator: the
board shows the jobs that exist, and the only way a job appears is that someone
booked it — on the website or in the customer app.

1. **Splash → Sign in.** Employee ID and PIN, checked against the roster on the
   dispatch server — `RIDER-204` / `7801`, `RIDER-118` / `4019`, or `RIDER-337` /
   `1234`. The ten-digit phone number on the record works in place of the
   employee ID — `0244567801`, `0209114402`, `0553370915`.
   Face ID reopens a session on a device that has already signed in; it cannot
   create one, because a face is not something the server can check.

   Those three are seeded for local development only. A production server starts
   with an empty roster: couriers are hired from the supervisor's console, which
   issues a random one-time PIN that expires in 48 hours and has to be changed on
   first sign-in.
2. **Profile.** A rider without a complete profile lands here and stays until name,
   vehicle and plate are all on the record. Jobs cannot be accepted before that —
   the customer is shown those details at the door. Only the name is the
   courier's to enter: the employee ID and the vehicle were both assigned from
   the supervisor's console, so the app shows them read-only and says who to ask
   when a vehicle is missing.
3. **Home.** Toggle *Go online*. This starts the location watch and publishes your
   position, which is what puts the courier on the customer's tracking map.
4. **Accept a job** from the offer card or the Tasks board, then work the bottom sheet:
   start navigation, check the customer's collection code, scan the bag labels,
   photograph the garments, capture a signature.
5. **Drop off at the hub**, wait for processing, then deliver. The delivery code is
   `7809` (`4019` and `1234` also pass).

> **You have to move.** Position is the device's real GPS fix, so the courier only
> travels on the map when the phone does.
>
> **Arrival** is confirmed when two consecutive fixes land within 35 m of the
> destination *and* the device reports its own accuracy as 50 m or better. One
> reading is not enough — a single GPS jump used to be, which meant an order could
> reach `arrived_at_pickup` while the courier was still two streets away and the
> customer was told to come down. A fix the phone cannot vouch for never confirms
> anything, and neither does the hub fallback used when a fix lands outside the
> Kumasi service area. The *Confirm arrival* button is the answer whenever the fix
> disagrees with where you actually are, and the transit card says so when the
> current fix is too rough to decide on its own.
>
> While a leg is in progress the watch tightens to `BestForNavigation` and a fix
> every 5 m; off a leg it relaxes to save the battery.
>
> **Ridden today** is measured by the same watch, not estimated. It adds up the
> gaps between successive fixes the phone is willing to vouch for, and only counts
> a gap larger than the accuracy behind it — a step of 8 m between two fixes each
> accurate to ±30 m is a phone that may not have moved, and a scooter parked for
> twenty minutes would otherwise ride kilometres on jitter alone. It runs offline
> too; the telemetry tick publishes the total when signal returns. The figure
> restarts at the device's own midnight, which is what makes "today" true — before
> this, the tile said *Shift distance* and showed a lifetime total built from a flat
> 2.1 km credited on every pickup signature plus a straight line drawn at booking.
>
> It is a floor, not a total: this is a foreground watch, so kilometres ridden with
> the console closed are not counted. Counting those needs a background location
> task the app does not have — so the tile understates the ride rather than
> guessing at the rest of it.

## Architecture

| Path | Purpose |
| --- | --- |
| `app/` | expo-router routes — splash, auth, chat modal, and the five-tab console |
| `src/store/AppStore.tsx` | Domain state, server sync, AsyncStorage offline cache, and the device location watch |
| `src/store/SessionStore.tsx` | Auth/lock state for the console |
| `src/services/api.ts` | Dispatch server address resolution + the shared `@freshfold/core` client |
| `src/components/` | `LiveMap` (`.web.tsx` fallback for browsers), `QRScanner`, `CameraCapture`, `SignaturePad`, plus shared UI primitives |
| `src/theme.ts` | Brand tokens for the native surfaces |
| `src/data/initialState.ts` | The empty board the app holds before it has heard from the server — no invented jobs |
| `src/types.ts` | Re-export of the shared domain model from `@freshfold/core` |

State lives in one provider so the device is watched exactly once regardless of how many
screens are showing a map, and so an order keeps ripening while the rider browses other tabs.

Reads come from a poll every 4 seconds; writes are applied locally first and sent in the
background, so a rider halfway up a stairwell can still mark a pickup complete. A poll that
lands while a write is in flight is discarded rather than rewinding the workflow.

## Native capabilities

| Feature | Module | Notes |
| --- | --- | --- |
| Live map, markers, route | `react-native-maps` | Google Maps on Android, Apple Maps on iOS. Wrapped in an error boundary — if the native map fails to load, the screen degrades to a coordinate panel instead of taking the app down |
| Bag QR scanning | `expo-camera` | Real barcode scanning, with a tap-to-scan fallback |
| Proof photos | `expo-camera` | Falls back to preset stock shots if the camera is unavailable |
| Signature capture | `react-native-svg` + `PanResponder` | Rasterised to a PNG data URL |
| Biometric unlock | `expo-local-authentication` | Simulated when no biometrics are enrolled |
| Persistence | `@react-native-async-storage/async-storage` | Offline cache in front of the dispatch server |

## Building a standalone app

Expo Go covers the whole demo. For a standalone Android build, Google Maps needs your own key:

```bash
cp .env.example .env
```

Set `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, then `npx expo prebuild` and build with EAS.
iOS needs no key — it uses Apple Maps.

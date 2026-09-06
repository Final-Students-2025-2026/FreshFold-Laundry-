/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomInt } from 'node:crypto';
import { Router } from 'express';
import {
  LAUNDRY_HUB,
  PHONE_LENGTH_MESSAGE,
  checkShift,
  isCompletePhone,
  phoneDigits,
  type RiderTelemetry,
} from '@freshfold/core';
import {
  bearerToken,
  createSession,
  requireRider,
  requireStaff,
  requireSupervisor,
  revokeSession,
} from '../auth';
import { deskActor, recordAudit } from '../audit';
import { hashPassword, needsRehash, sanitizeRider, verifySecret } from '../passwords';
import { credentialLimit } from '../rateLimit';
import { store, type StoredRider } from '../store';
import { guard, notFound } from '../helpers';

/** How long a provisioned PIN stays usable if the courier never signs in. */
const PROVISIONAL_PIN_TTL_MS = 48 * 60 * 60 * 1000;

/** Next free `FF-R-###`, so ids stay readable rather than becoming UUIDs. */
function newRiderId(existing: string[]): string {
  const taken = new Set(existing);
  for (let n = 101; n < 1000; n++) {
    const id = `FF-R-${n}`;
    if (!taken.has(id)) return id;
  }
  return `FF-R-${Date.now()}`;
}

/**
 * Next free `RIDER-###`.
 *
 * The employee ID is assigned here rather than typed by the supervisor: it is
 * a sign-in identifier, so a typo is a courier who cannot get into the app, and
 * two supervisors adding staff on the same morning will otherwise collide.
 */
function newEmployeeId(existing: string[]): string {
  const taken = new Set(existing.map((value) => value.toLowerCase()));
  for (let n = 101; n < 10000; n++) {
    const id = `RIDER-${n}`;
    if (!taken.has(id.toLowerCase())) return id;
  }
  return `RIDER-${Date.now()}`;
}

/**
 * The only fields a courier's phone may write about itself.
 *
 * An allow-list rather than a list of things to strip, because the two fail in
 * opposite directions. This body arrives off the wire and used to be spread
 * straight onto the stored record, so it wrote whatever it happened to
 * contain — and `StoredRider` contains `pinHash`, `active` and `todayEarnings`
 * alongside the position fields. Anything not named here is dropped without
 * comment, so a field added to the roster tomorrow is not writable by a phone
 * the moment it exists.
 *
 * `todayDistance` is here and `todayEarnings` is not, which is not the
 * inconsistency it looks like: how far a scooter went is a measurement only that
 * phone is in a position to make, and earnings are money this server works out
 * from jobs it saw completed. A phone can overstate its own mileage — which a
 * supervisor can see against the jobs on the board — but it cannot pay itself.
 */
function telemetryFrom(body: unknown): RiderTelemetry {
  const source = (body ?? {}) as Record<string, unknown>;
  const telemetry: RiderTelemetry = {};

  if (typeof source.name === 'string') telemetry.name = source.name;
  if (typeof source.isOnline === 'boolean') telemetry.isOnline = source.isOnline;
  if (typeof source.speed === 'number') telemetry.speed = source.speed;
  if (typeof source.heading === 'number') telemetry.heading = source.heading;
  if (typeof source.gpsAccuracy === 'number') telemetry.gpsAccuracy = source.gpsAccuracy;

  // Kilometres ridden today, as the phone measured them, and the device-local
  // date it measured them on. Nothing here reads that date — it is stored so the
  // same phone can tell today from yesterday after a cold start — but a column
  // that takes any string takes a paragraph, so the shape is checked.
  if (Number.isFinite(source.todayDistance) && (source.todayDistance as number) >= 0) {
    telemetry.todayDistance = source.todayDistance as number;
  }
  if (
    typeof source.distanceDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(source.distanceDate)
  ) {
    telemetry.distanceDate = source.distanceDate;
  }

  const coords = source.coords as { lat?: unknown; lng?: unknown } | undefined;
  if (typeof coords?.lat === 'number' && typeof coords?.lng === 'number') {
    telemetry.coords = { lat: coords.lat, lng: coords.lng };
  }

  return telemetry;
}

/**
 * The courier roster, and everything a signed-in courier does with it.
 *
 * Riders are provisioned, not self-registered: a phone cannot invent a courier
 * by pushing telemetry at an unknown id. Signing in is how a device learns
 * which rider it is, and the token it gets back is what authorises the position
 * updates that put a real courier on the customer's map.
 *
 * Every response goes through `sanitizeRider`. Returning a `StoredRider`
 * directly is exactly the bug that exists to prevent.
 */
export const ridersRouter = Router();

/**
 * Sign in with an employee ID and a PIN.
 *
 * The phone number is accepted as an alternative identifier because a courier
 * who has forgotten their employee ID has certainly not forgotten their own
 * number. Both resolve to the same record.
 *
 * The tightest limit of the three login routes, because this credential is the
 * weakest: a PIN is four digits, which is the right shape for someone wearing
 * gloves at a doorstep and a 10,000-key space to anybody with a script. Eight
 * attempts a quarter-hour puts a full walk of that space beyond three hundred
 * hours, while still leaving a courier who has fat-fingered it in the rain
 * several more goes than they will need.
 */
ridersRouter.post(
  '/login',
  ...credentialLimit({
    perIdentifier: 8,
    perAddress: 30,
    windowMs: 15 * 60 * 1000,
    field: 'identifier',
  }),
  guard(async (req, res) => {
    const { identifier, pin } = (req.body ?? {}) as { identifier?: string; pin?: string };

    if (!identifier || !pin) {
      res.status(400).json({ error: 'An employee ID and PIN are required.' });
      return;
    }

    const rider = await store.riders.findByIdentifier(identifier);

    // One message for "no such courier" and "wrong PIN" alike, so the response
    // cannot be used to work out which employee IDs exist. Checked even when
    // there is no courier, so the two take the same time as well as saying the
    // same thing — see the note on the customer sign-in.
    const pinMatches = await verifySecret(pin, {
      salt: rider?.pinSalt,
      hash: rider?.pinHash,
    });

    if (!rider || !pinMatches) {
      res.status(401).json({ error: 'That employee ID and PIN do not match.' });
      return;
    }

    if (rider.active === false) {
      res.status(403).json({ error: 'This courier is no longer on the roster.' });
      return;
    }

    // A temporary PIN that was never used stops working. Checked after the hash
    // comparison so an expired credential cannot be told apart from a wrong one
    // by anybody who does not already know it.
    if (rider.pinExpiresAt && Date.parse(rider.pinExpiresAt) <= Date.now()) {
      res
        .status(403)
        .json({ error: 'That temporary PIN has expired. Ask your supervisor for a new one.' });
      return;
    }

    if (needsRehash(rider.pinHash)) {
      // See the note on the customer sign-in: the only moment the PIN is in
      // hand to re-derive from. Not awaited, not fatal.
      void hashPassword(pin)
        .then((upgraded) =>
          store.riders.update(rider.id, { pinSalt: upgraded.salt, pinHash: upgraded.hash })
        )
        .catch((error: unknown) => console.error('[riders] pin re-hash failed:', error));
    }

    const session = await createSession('rider', rider.id);
    res.json({ token: session.token, rider: sanitizeRider(rider) });
  })
);

/** Re-validates a stored token on launch, and returns who it belongs to. */
ridersRouter.get('/me', requireRider, (req, res) => {
  res.json(sanitizeRider(req.rider!));
});

/**
 * Replaces a temporary PIN with one only the courier knows.
 *
 * The current PIN is required even though the session already proves identity:
 * a phone left unlocked on a table is not the courier, and this is the one
 * action that changes what gets them back in.
 */
ridersRouter.post(
  '/change-pin',
  requireRider,
  guard(async (req, res) => {
    const { currentPin, newPin } = (req.body ?? {}) as {
      currentPin?: string;
      newPin?: string;
    };

    if (!currentPin || !newPin) {
      res.status(400).json({ error: 'Both the current and the new PIN are required.' });
      return;
    }

    if (!/^\d{4}$/.test(newPin)) {
      res.status(400).json({ error: 'A PIN is four digits.' });
      return;
    }

    if (newPin === currentPin) {
      res.status(400).json({ error: 'Choose a PIN different from the temporary one.' });
      return;
    }

    const rider = req.rider!;
    if (!(await verifySecret(currentPin, { salt: rider.pinSalt, hash: rider.pinHash }))) {
      res.status(401).json({ error: 'That is not your current PIN.' });
      return;
    }

    const { salt, hash } = await hashPassword(newPin);

    await store.riders.update(rider.id, {
      pinSalt: salt,
      pinHash: hash,
      mustChangePin: false,
      // The provisioning deadline is spent; the new PIN has no expiry. An
      // explicit null rather than undefined — the store reads the first as
      // "clear this" and the second as "leave it alone".
      pinExpiresAt: null,
    });

    /**
     * Everything signed in on the old PIN is signed out.
     *
     * `POST /auth/reset` has done this for customers since it was written, and
     * says why: whoever knew the old credential may still be holding a bearer
     * token, and leaving those alive means the reset changed the lock while the
     * other key still turned it. That is the case a reset exists for.
     *
     * A courier changing their PIN is the same act for the same reason — they
     * saw somebody watching them key it in — and this did not do it. The PIN
     * changed, the courier believed the old one was now useless, and a phone
     * holding a week-old token carried on regardless. A changed credential that
     * creates a false belief about access is worse than one nobody changed.
     *
     * Their own session goes with the rest, so a fresh one is minted and
     * returned: the courier is not signed out of the phone in their hand
     * mid-shift for having done the right thing.
     */
    await store.sessions.revokeAllFor('rider', rider.id);
    const session = await createSession('rider', rider.id);

    res.json({ ok: true, token: session.token });
  })
);

ridersRouter.post(
  '/logout',
  guard(async (req, res) => {
    const token = bearerToken(req);
    if (token) await revokeSession(token);
    res.json({ ok: true });
  })
);

/**
 * The roster.
 *
 * Behind a staff session — courier or supervisor: this is the staff list, with
 * names, plates and last known positions. It was open, and the customer app
 * polled it every four seconds for a lookup it never used.
 */
ridersRouter.get(
  '/',
  requireStaff,
  guard(async (_req, res) => {
    const riders = await store.riders.list({ activeOnly: true });
    res.json(riders.map(sanitizeRider));
  })
);

/**
 * Puts a courier on the roster. Supervisor only.
 *
 * The supervisor supplies the courier's details; the employee ID is assigned
 * by the server and comes back in the response, alongside the PIN.
 *
 * The PIN is generated here and returned exactly once. Nobody types it: a
 * supervisor choosing a courier's first credential means the supervisor knows
 * it, and `1234` is what gets chosen under time pressure. It is hashed
 * immediately, expires in 48 hours if unused, and must be replaced on first
 * sign-in.
 */
ridersRouter.post(
  '/',
  requireSupervisor,
  guard(async (req, res) => {
    const { name, phone, vehicle, vehiclePlate } = (req.body ?? {}) as {
      name?: string;
      phone?: string;
      vehicle?: string;
      vehiclePlate?: string;
    };

    if (!phone?.trim()) {
      res.status(400).json({ error: 'A phone number is required.' });
      return;
    }

    // The vehicle is the company's, and the customer is shown it at the door, so
    // it is assigned here rather than typed in later by whoever is riding it.
    if (!vehicle?.trim() || !vehiclePlate?.trim()) {
      res.status(400).json({ error: 'A vehicle and its plate number are required.' });
      return;
    }

    if (!isCompletePhone(phone)) {
      res.status(400).json({ error: PHONE_LENGTH_MESSAGE });
      return;
    }

    const wantedPhone = phoneDigits(phone);

    /**
     * The credential a new courier signs in with, from the CSPRNG.
     *
     * This was `Math.floor(1000 + Math.random() * 9000)`, which is V8's
     * xorshift128+ — a generator whose state can be recovered from a handful of
     * consecutive outputs, and which every other secret on this server already
     * avoids. Four digits is a small space to begin with; drawing it from a
     * predictable stream made the space smaller than it looks for anyone who
     * had seen a few of its neighbours.
     *
     * `randomInt` is the right reach here where `@freshfold/core` had to use
     * the Web Crypto global instead: this file is only ever loaded by the
     * server, so `node:crypto` resolves. The upper bound is exclusive.
     */
    const temporaryPin = String(randomInt(1000, 10000));
    const { salt, hash } = await hashPassword(temporaryPin);
    const pinExpiresAt = new Date(Date.now() + PROVISIONAL_PIN_TTL_MS).toISOString();

    /**
     * The clash check and the insert share a transaction so two supervisors
     * adding staff at the same moment cannot both pass the check. If they race
     * anyway the unique index on `lower(employee_id)` is the backstop — the
     * loser gets an error rather than a duplicate roster entry.
     */
    const outcome = await store.tx(async (t) => {
      const clash = await t.riders.findByPhone(wantedPhone);
      if (clash) return { kind: 'clash', employeeId: clash.employeeId } as const;

      const taken = await t.riders.takenIds();

      const rider: StoredRider = {
        id: newRiderId(taken.ids),
        employeeId: newEmployeeId(taken.employeeIds),
        phone: wantedPhone,
        // The courier's own name is theirs to enter; dispatch blocks work until
        // they have. The vehicle came from the supervisor with this request.
        name: name?.trim() ?? '',
        avatar: '',
        vehicle: vehicle.trim(),
        vehiclePlate: vehiclePlate.trim(),
        rating: 0,
        isOnline: false,
        gpsAccuracy: 0,
        speed: 0,
        heading: 0,
        coords: { lat: LAUNDRY_HUB.lat, lng: LAUNDRY_HUB.lng },
        todayDistance: 0,
        distanceDate: '',
        todayEarnings: 0,
        completedCount: 0,
        onTimeRate: 0,
        acceptanceRate: 0,
        completionRate: 0,
        active: true,
        mustChangePin: true,
        pinExpiresAt,
        pinSalt: salt,
        pinHash: hash,
      };

      return { kind: 'ok', rider: await t.riders.insert(rider) } as const;
    });

    if (outcome.kind === 'clash') {
      res
        .status(409)
        .json({ error: `That number is already on the roster as ${outcome.employeeId}.` });
      return;
    }

    // The PIN is deliberately absent. It is a credential, the trail is readable
    // by every desk, and a record of who was hired does not need the password
    // they were hired with.
    await recordAudit(store, {
      ...deskActor(req),
      action: 'Courier hired',
      details:
        `Added ${outcome.rider.name || 'an unnamed courier'} to the roster as ` +
        `${outcome.rider.employeeId} on ${outcome.rider.vehicle} ` +
        `(${outcome.rider.vehiclePlate}), phone ${outcome.rider.phone}`,
      type: 'roster',
      subject: outcome.rider.employeeId,
    });

    res
      .status(201)
      .json({ rider: sanitizeRider(outcome.rider), temporaryPin, pinExpiresAt });
  })
);

/**
 * Reassigns the vehicle a courier rides. Supervisor only.
 *
 * Vehicles move: a scooter goes in for repair and its rider takes another,
 * and a plate typed wrong on a Monday is read out at a customer's door on the
 * Tuesday. Neither is fixed by deleting the courier and starting again, which
 * was the only remedy before this route existed.
 */
ridersRouter.patch(
  '/:id/vehicle',
  requireSupervisor,
  guard(async (req, res) => {
    const { vehicle, vehiclePlate } = (req.body ?? {}) as {
      vehicle?: string;
      vehiclePlate?: string;
    };

    if (!vehicle?.trim() || !vehiclePlate?.trim()) {
      res.status(400).json({ error: 'A vehicle and its plate number are required.' });
      return;
    }

    const rider = await store.riders.update(req.params.id, {
      vehicle: vehicle.trim(),
      vehiclePlate: vehiclePlate.trim(),
    });

    if (!rider) {
      notFound(res, 'Rider');
      return;
    }

    // What it is now, not what it was: nothing here holds a lock, so a "changed
    // from" read before the write could name a plate a second desk had already
    // replaced. The assignment is the fact this route produced.
    await recordAudit(store, {
      ...deskActor(req),
      action: 'Vehicle reassigned',
      details:
        `Assigned ${rider.vehicle} (${rider.vehiclePlate}) to ` +
        `${rider.name || 'an unnamed courier'}, ${rider.employeeId}`,
      type: 'roster',
      subject: rider.employeeId,
    });

    res.json(sanitizeRider(rider));
  })
);

/**
 * Takes a courier off the roster, or puts them back. Supervisor only.
 *
 * Deactivation rather than deletion: a departed courier's jobs still name them,
 * and removing the record would orphan every one. `riderForToken` checks this
 * on every request, so access stops immediately rather than when their token
 * happens to expire.
 */
ridersRouter.patch(
  '/:id/active',
  requireSupervisor,
  guard(async (req, res) => {
    const { active } = (req.body ?? {}) as { active?: boolean };

    if (typeof active !== 'boolean') {
      res.status(400).json({ error: 'An `active` boolean is required.' });
      return;
    }

    const rider = await store.riders.update(req.params.id, { active });

    if (!rider) {
      notFound(res, 'Rider');
      return;
    }

    await recordAudit(store, {
      ...deskActor(req),
      action: active ? 'Courier reinstated' : 'Courier deactivated',
      details: active
        ? `Put ${rider.name || 'an unnamed courier'} (${rider.employeeId}) back on the roster`
        : `Took ${rider.name || 'an unnamed courier'} (${rider.employeeId}) off the roster; ` +
          'their sign-in stops working on the next request',
      type: 'roster',
      subject: rider.employeeId,
    });

    res.json(sanitizeRider(rider));
  })
);

/**
 * The rota, across the fleet, for a window.
 *
 * Staff only — it is the roster with names on it. Defaults to the coming week,
 * which is what the roster console opens on, and takes an explicit window for
 * the dispatcher looking at tonight.
 *
 * Registered here, apart from the other shift routes further down, because
 * Express matches in order and `/shifts` is a single segment: every `/:id`
 * route it sits below would answer this one first, reading `shifts` as a
 * courier id. It used to live under the Shifts heading, below `GET /:id` — so
 * the fleet rota was served by the single-rider route and guarded by
 * `requireRider`, and the roster console's rota came back 401 for the
 * supervisor it exists for. `RosterPanel` swallows that failure to keep the
 * roster itself up, so the pane showed every courier with an empty rota rather
 * than an error.
 */
ridersRouter.get(
  '/shifts',
  requireStaff,
  guard(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : new Date().toISOString();
    const to =
      typeof req.query.to === 'string'
        ? req.query.to
        : new Date(Date.now() + 7 * 86_400_000).toISOString();

    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      res.status(400).json({ error: 'A window needs two timestamps.' });
      return;
    }

    res.json(await store.shifts.between(from, to));
  })
);

ridersRouter.get(
  '/:id',
  requireRider,
  guard(async (req, res) => {
    const rider = await store.riders.find(req.params.id);
    if (!rider) {
      notFound(res, 'Rider');
      return;
    }
    res.json(sanitizeRider(rider));
  })
);

/**
 * Position and presence.
 *
 * A courier may only write their own record. Previously this was an open
 * upsert, so any caller could invent a rider or move an existing one — which
 * on a live map means putting a courier somewhere they are not.
 */
ridersRouter.patch(
  '/:id',
  requireRider,
  guard(async (req, res) => {
    if (req.rider!.id !== req.params.id) {
      res.status(403).json({ error: 'A courier may only update their own record.' });
      return;
    }

    const rider = await store.riders.update(req.params.id, telemetryFrom(req.body));

    if (!rider) {
      notFound(res, 'Rider');
      return;
    }
    res.json(sanitizeRider(rider));
  })
);

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------
//
// The fleet-wide rota, `GET /shifts`, is not here. It has to be registered
// above `GET /:id` to be reachable at all — see the note on it up there.

/**
 * The courier's own rota.
 *
 * Their own and nobody else's, which is why it is keyed on the session rather
 * than on an id in the path. A courier refused a job for being off shift needs
 * to be able to see when they are on without asking the desk.
 */
ridersRouter.get(
  '/me/shifts',
  requireRider,
  guard(async (req, res) => {
    res.json(await store.shifts.forRider(req.rider!.id));
  })
);

/** One courier's blocks. Staff only, for the roster console. */
ridersRouter.get(
  '/:id/shifts',
  requireStaff,
  guard(async (req, res) => {
    res.json(await store.shifts.forRider(req.params.id));
  })
);

/**
 * Rosters a courier for a stretch of time. Supervisor only.
 *
 * The overlap check runs inside the transaction against the courier's existing
 * blocks, because two supervisors filling in the same rota at once is exactly
 * how a courier ends up rostered twice for Tuesday evening — the read and the
 * write have to be one act.
 */
ridersRouter.post(
  '/:id/shifts',
  requireSupervisor,
  guard(async (req, res) => {
    const { startsAt, endsAt, note } = (req.body ?? {}) as {
      startsAt?: string;
      endsAt?: string;
      note?: string;
    };

    const rider = await store.riders.find(req.params.id);
    if (!rider) {
      notFound(res, 'Rider');
      return;
    }

    const proposal = { startsAt: startsAt ?? '', endsAt: endsAt ?? '' };

    const outcome = await store.tx(async (t) => {
      const existing = await t.shifts.forRider(rider.id);
      const verdict = checkShift(proposal, existing);
      if (!verdict.ok) return { kind: 'refused', verdict } as const;

      const shift = await t.shifts.create({
        id: `shift-${rider.id}-${Date.now()}`,
        riderId: rider.id,
        startsAt: new Date(proposal.startsAt).toISOString(),
        endsAt: new Date(proposal.endsAt).toISOString(),
        note: (note ?? '').trim().slice(0, 200),
        createdBy: req.supervisor!.email,
      });

      await recordAudit(t, {
        ...deskActor(req),
        action: 'Shift rostered',
        details:
          `Put ${rider.name} on from ${shift.startsAt} to ${shift.endsAt}` +
          (shift.note ? ` (${shift.note})` : ''),
        type: 'roster',
        subject: rider.id,
      });

      return { kind: 'ok', shift } as const;
    });

    if (outcome.kind === 'refused') {
      res.status(409).json({ error: outcome.verdict.message, reason: outcome.verdict.reason });
      return;
    }

    res.status(201).json(outcome.shift);
  })
);

/**
 * Takes a block off the rota. Supervisor only.
 *
 * No check that the shift is in the future. A rota entry recorded by mistake
 * yesterday is exactly the one somebody needs to remove, and this table is for
 * planning rather than for payroll — see the note on the migration.
 */
ridersRouter.delete(
  '/shifts/:shiftId',
  requireSupervisor,
  guard(async (req, res) => {
    const removed = await store.shifts.remove(req.params.shiftId);

    if (!removed) {
      notFound(res, 'Shift');
      return;
    }

    res.json({ ok: true });
  })
);

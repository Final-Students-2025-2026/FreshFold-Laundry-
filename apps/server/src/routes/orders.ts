/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import {
  applyStatus,
  DEFAULT_RIDER_JOB_LIMIT,
  imageProblem,
  isTerminal,
  onShift,
  orderToJob,
  REFERRAL_REWARD,
  roundCedis,
  toBookingStatus,
  withinJobLimit,
  type Job,
  type JobStatus,
  type HubStage,
  type JobStatusPatch,
  type LaundryBag,
  type Order,
} from '@freshfold/core';
import { requireRider, requireStaff, requireSupervisor } from '../auth';
import { recordAudit, type AuditActor } from '../audit';
import { resolveBookingAccess, type BookingAccess } from '../booking-access';
import { rateLimit } from '../rateLimit';
import { store, type Repositories } from '../store';
import { guard, nowLabel, notFound, orderView, writtenOrderView } from '../helpers';

/**
 * The dispatch half of the API — what the rider app reads and writes.
 *
 * Every transition funnels through `applyStatus` from `@freshfold/core`, so a
 * job's timestamps and proof-of-service attachments are recorded identically
 * no matter which surface triggered the change.
 *
 * All of it is behind a staff session now, and every courier id is read off that
 * session rather than out of a request body. This file used to be open, which on
 * a dispatch API means rather more than a data leak: `?riderId=` decided whose
 * board you were shown, `{ riderId }` in an accept decided who the job was
 * assigned to, and `PATCH /:id/status` moved any job to any stage — so a
 * stranger could take somebody else's pickup, hand it back, or mark it
 * delivered, and the customer would be told so.
 */
export const ordersRouter = Router();

/**
 * The most jobs one courier may hold at once.
 *
 * `RIDER_JOB_LIMIT` in the environment wins, so a laundry with cargo bikes can
 * raise it without a deploy — the same arrangement `PICKUP_SLOT_CAPACITY` has,
 * and for the same reason: the desk knows its own fleet better than a constant
 * does. Anything unparseable or below one falls back to core's number rather
 * than to zero, because a misconfigured variable that let nobody accept
 * anything would take dispatch offline entirely.
 */
/**
 * The most garments one bag can be recorded as holding.
 *
 * Not a physical limit — it is a typo limit. This number is typed at a bench by
 * somebody with a bag open in front of them, and `1000` is one slip from `100`.
 * A ceiling makes the slip visible where it is made rather than on the
 * customer's receipt.
 */
const MAX_BAG_ITEMS = 200;

function jobLimit(): number {
  const configured = Number(process.env.RIDER_JOB_LIMIT);
  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : DEFAULT_RIDER_JOB_LIMIT;
}

/** What dispatch narrates to the customer at each step of the workflow. */
const STATUS_SCRIPT: Partial<Record<JobStatus, string>> = {
  assigned: 'A courier has accepted your contract and is preparing transit.',
  navigating_to_pickup: 'Your courier is on the way to the pickup address.',
  arrived_at_pickup: 'Your courier has arrived and is validating the bag scans.',
  picked_up:
    'Pickup documented and confirmed. Your garments are secured for transit to the Central Hub.',
  navigating_to_laundry: 'Your garments are travelling to the FreshFold Central Hub.',
  dropped_off:
    'Garments checked in at the hub. Beginning the meticulous organic cleaning process.',
  processing: 'Artisanal hand-pressing and boutique folding are under way.',
  ready_for_delivery: 'Quality inspection passed. Your garments are packaged and ready.',
  navigating_to_delivery:
    'Scent-infused clean garments are in transit. Your courier is navigating to you.',
  arrived_at_delivery: 'Your courier has arrived with your garments.',
  delivered: 'Concierge delivery complete. Thank you for choosing FreshFold.',
  cancelled: 'This order has been cancelled. Please contact us if this was unexpected.',
};

/**
 * The board.
 *
 * A courier gets the open pool plus everything already theirs; the desk gets
 * everything. Whose board it is comes from the session — `?riderId=` used to
 * decide, which meant any caller could ask for any courier's assignments by
 * naming them.
 */
ordersRouter.get(
  '/',
  requireStaff,
  guard(async (req, res) => {
    const jobs = await store.jobs.list({ riderId: req.rider?.id ?? null });
    res.json(jobs.map(orderView));
  })
);

/**
 * One job in full.
 *
 * The list above returns every order without its proof-of-service photographs,
 * which is what keeps a four-second poll cheap. This is where a courier's
 * history screen gets the picture back when it needs to draw one — including the
 * proof they captured themselves, which is why a courier may read a job they
 * have since handed on. What they may not do is read one that was never theirs.
 */
ordersRouter.get(
  '/:id',
  requireStaff,
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Order');
      return;
    }

    // The desk sees any job. A courier sees their own and anything still in the
    // open pool, which is the same board `GET /` would have offered them.
    const rider = req.rider;
    if (rider && job.dispatch.riderId && job.dispatch.riderId !== rider.id) {
      notFound(res, 'Order');
      return;
    }

    res.json(orderView(job));
  })
);

/**
 * Injects a job into the backlog without a booking behind it.
 *
 * The rider console's simulation hub, and behind the desk's session: this writes
 * a dispatchable job from a request body, with the customer's name, address and
 * price all taken on the caller's word. Open, it was a way to put fabricated
 * work on the board.
 */
ordersRouter.post(
  '/',
  requireSupervisor,
  guard(async (req, res) => {
    const incoming = req.body as Order;
    if (!incoming?.id) {
      res.status(400).json({ error: 'An order needs an id.' });
      return;
    }

    const job = await store.jobs.upsert(orderToJob(incoming));
    res.status(201).json(orderView(job));
  })
);

ordersRouter.post(
  '/:id/accept',
  requireRider,
  guard(async (req, res) => {
    // Whoever the token says, never whoever the body says. This was read off
    // `req.body.riderId`, so a caller could assign a job to a courier who had
    // not accepted it — or to a courier id that did not exist.
    const riderId = req.rider!.id;

    /**
     * The whole check-then-claim runs inside one transaction, on a locked row.
     *
     * Two couriers tapping accept at the same moment used to both read an
     * unassigned job and both write themselves onto it, because the read and
     * the write were separate trips. Now the second one waits for the first to
     * commit and then sees the job it actually has — so the 409 below fires
     * instead of the job silently changing hands.
     */
    const outcome = await store.tx(async (t) => {
      const existing = await t.jobs.find(req.params.id, { lock: true });
      if (!existing) return { kind: 'missing' } as const;

      if (existing.dispatch.riderId && existing.dispatch.riderId !== riderId) {
        return { kind: 'taken' } as const;
      }
      if (isTerminal(existing.status)) {
        return { kind: 'closed' } as const;
      }

      /**
       * How much this courier is already carrying, and whether they are on.
       *
       * Both checked inside the transaction, on the locked row, because both are
       * races otherwise: a courier tapping accept on six cards at once used to
       * take all six, since nothing counted what they held between the read and
       * the write. Re-accepting a job they already hold is exempt — the count
       * includes it, so charging them for it would refuse an idempotent replay.
       */
      if (existing.dispatch.riderId !== riderId) {
        const open = await t.jobs.countOpenForRider(riderId);
        const room = withinJobLimit(open, jobLimit());
        if (!room.ok) return { kind: 'refused', check: room } as const;

        /**
         * And whether they are rostered to be working at all.
         *
         * `active` says a courier is on the payroll and `isOnline` says their
         * phone is unlocked; neither says they are on shift. Somebody who
         * finished at six and left the app open in a drawer was both, and could
         * take a collection nobody was going to make.
         *
         * A courier with no shifts on the roster at all is let through. The rota
         * is new, and a laundry that has not filled one in yet must not find its
         * whole fleet locked out of the board by a table nobody has populated —
         * that is a migration turning into an outage.
         */
        const shifts = await t.shifts.forRider(riderId);
        if (shifts.length > 0 && !onShift(shifts)) {
          return {
            kind: 'refused',
            check: {
              ok: false,
              reason: 'off-shift' as const,
              message:
                'You are not on shift right now, so this job is not yours to take. ' +
                'Check the rota with the desk.',
            },
          } as const;
        }
      }

      /**
       * A job already down the board is claimed where it stands.
       *
       * Most accepts are of something `unassigned`, and `assigned` is the right
       * next step. But a supervisor can move a booking to a courier leg from
       * the dashboard without naming a courier, which leaves it in flight with
       * nobody holding it — the rider console offers those back out. Forcing
       * `assigned` there would rewind a job the customer has been told is
       * Collecting all the way back to Scheduled, on the strength of somebody
       * picking it up.
       */
      const status = existing.status === 'unassigned' ? 'assigned' : existing.status;

      const job = await transition(t, existing, { status, riderId });
      return { kind: 'ok', job } as const;
    });

    switch (outcome.kind) {
      case 'missing':
        notFound(res, 'Order');
        return;
      case 'taken':
        res.status(409).json({ error: 'That job has already been taken by another rider.' });
        return;
      case 'closed':
        res.status(409).json({ error: 'That job is already closed.' });
        return;
      case 'refused':
        // The sentence is core's, written for the courier reading it on a
        // scooter — "you are already carrying six" is a different problem from
        // "you are not on shift", and the console shows whichever it is.
        res.status(409).json({ error: outcome.check.message, reason: outcome.check.reason });
        return;
      default:
        res.json(writtenOrderView(outcome.job));
    }
  })
);

ordersRouter.post(
  '/:id/decline',
  requireRider,
  guard(async (req, res) => {
    const riderId = req.rider!.id;

    const outcome = await store.tx(async (t) => {
      const existing = await t.jobs.find(req.params.id, { lock: true });
      if (!existing) return { kind: 'missing' } as const;

      /**
       * Only the courier holding it may hand it back.
       *
       * There was no check at all here, and the route sets `unassigned`
       * unconditionally — so a caller could return somebody else's job to the
       * pool mid-leg, with the customer watching a courier who was suddenly no
       * longer assigned. Declining something already in the pool is a no-op
       * rather than an error: the app fires it on a card it has just been
       * offered, and the pool is where that card already lives.
       */
      if (existing.dispatch.riderId && existing.dispatch.riderId !== riderId) {
        return { kind: 'notYours' } as const;
      }

      const declined = await transition(t, existing, { status: 'unassigned' });

      await t.notifications.insert({
        id: `notif-decline-${Date.now()}`,
        title: 'Order Returned to Backlog',
        body: `Order ${declined.reference} was declined and is back in the dispatch queue.`,
        timestamp: nowLabel(),
        type: 'alert',
        orderId: declined.id,
        read: false,
      });

      return { kind: 'ok', job: declined } as const;
    });

    switch (outcome.kind) {
      case 'missing':
        notFound(res, 'Order');
        return;
      case 'notYours':
        res.status(409).json({ error: 'That job belongs to another courier.' });
        return;
      default:
        res.json(writtenOrderView(outcome.job));
    }
  })
);

/** The shortest override that is worth having on a record. */
const MIN_OVERRIDE_REASON = 8;

/**
 * The hand-offs the server adjudicates, and what to say when one fails.
 *
 * Keyed by the status being *entered*, because that is the moment the bags
 * actually move. The pickup leg is absent on purpose: the courier scans a QR
 * at a doorstep that may have no signal, so that one is checked on the device
 * against a code the device was sent — a weaker guarantee, bought deliberately
 * for a stairwell in the rain.
 */
const HANDOFF_GATES: Partial<
  Record<
    JobStatus,
    {
      /** Where the expected code lives on the job. */
      otp: 'dropoffOtp' | 'deliveryOtp';
      /** What the courier's app sends it as. */
      field: 'dropoffCode' | 'deliveryCode';
      /** Which hand-off this is, for the audit line when a code is refused. */
      leg: 'hub' | 'delivery';
      /** Where an override is written on the job's proof record. */
      reasonKey: 'dropoffOverrideReason' | 'deliveryOverrideReason';
      atKey: 'dropoffOverrideAt' | 'deliveryOverrideAt';
      /** Whether a job carrying no code at all is waved through. */
      legacyPasses: boolean;
      /** How the desk hears about an override. */
      alertTitle: string;
      wrongCode: string;
      noCode: string;
      thinReason: string;
      customerLine: string;
    }
  >
> = {
  dropped_off: {
    otp: 'dropoffOtp',
    field: 'dropoffCode',
    leg: 'hub',
    reasonKey: 'dropoffOverrideReason',
    atKey: 'dropoffOverrideAt',
    // Drop-off codes arrived after the ledger did.
    legacyPasses: true,
    alertTitle: 'Bags checked in without a hub code',
    wrongCode: 'That is not the drop-off code for this order.',
    noCode: 'Enter the code on the hub desk’s screen, or record why you cannot.',
    thinReason: 'Say what happened at the hub — a few words at least.',
    customerLine:
      'Your garments were checked in at the hub without the desk code. The courier recorded: ',
  },
  delivered: {
    otp: 'deliveryOtp',
    field: 'deliveryCode',
    leg: 'delivery',
    reasonKey: 'deliveryOverrideReason',
    atKey: 'deliveryOverrideAt',
    // Every job in the ledger has one.
    legacyPasses: false,
    alertTitle: 'Delivery completed without a code',
    wrongCode: 'That is not the delivery code for this order.',
    noCode: 'Enter the code the customer reads out, or record why you cannot.',
    thinReason: 'Say what happened at the door — a few words at least.',
    customerLine: 'Your order was completed without the delivery code. The courier recorded: ',
  },
};

/**
 * Checks a load in at the hub: what is in each bag, and what it weighs.
 *
 * This is where the two numbers on a customer's manifest stop being fiction.
 * `weight` and `itemCount` used to be minted with the booking, in `bagsForJob`,
 * from the digits of the job id — a hash formatted to one decimal place with
 * `kg` after it, and a second hash between three and ten. They were printed on
 * the courier's scanner, on the customer's bag manifest and added up on the hub
 * console, and nobody had weighed or counted anything. Both fields are now
 * absent until this route fills them in.
 *
 * Supervisor only, and deliberately not the courier: the count that matters is
 * the one taken at the hub with the bag open on a bench, not one guessed at a
 * doorstep with the engine running. The courier's job is to get the bags here
 * with the codes matching, which they already do.
 *
 * Idempotent on the bag. Re-checking a bag overwrites its count rather than
 * adding to it — somebody recounting is correcting themselves, and a route that
 * doubled the total on a second pass would make the correction worse than the
 * mistake.
 */
ordersRouter.post(
  '/:id/intake',
  requireSupervisor,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as {
      bags?: { id: string; itemCount?: number; weight?: string }[];
      garments?: { bagId?: string; description?: string; condition?: string }[];
      machine?: string;
      batch?: string;
      notes?: string;
    };

    const supervisor = req.supervisor!;
    const counts = Array.isArray(body.bags) ? body.bags : [];

    if (counts.length === 0) {
      res.status(400).json({ error: 'Check in at least one bag.' });
      return;
    }

    /**
     * A count is a whole number of garments, and there is a ceiling on it.
     *
     * Not because a bag cannot hold a hundred shirts, but because this number
     * is typed by a person at a bench and `1000` is a slip of the thumb away
     * from `100`. The ceiling makes the slip visible at the moment it is made
     * rather than on the customer's receipt.
     */
    for (const bag of counts) {
      if (!bag?.id) {
        res.status(400).json({ error: 'Every line needs the bag it belongs to.' });
        return;
      }

      if (bag.itemCount !== undefined) {
        if (!Number.isInteger(bag.itemCount) || bag.itemCount < 0 || bag.itemCount > MAX_BAG_ITEMS) {
          res.status(400).json({
            error: `A bag holds between 0 and ${MAX_BAG_ITEMS} garments. Check that count.`,
            reason: 'implausible-count',
            bag: bag.id,
          });
          return;
        }
      }
    }

    const named = (body.garments ?? []).filter((garment) => garment?.description?.trim());

    const outcome = await store.tx(async (t) => {
      const job = await t.jobs.find(req.params.id, { lock: true });
      if (!job) return { kind: 'missing' } as const;

      const at = new Date().toISOString();
      const wanted = new Map(counts.map((bag) => [bag.id, bag]));

      /**
       * The counts go onto the bag records the job already carries.
       *
       * Onto the existing manifest rather than into a table of their own,
       * because a bag has no table — bags are minted with the job and live in
       * `jobs.dispatch` as JSON. A count is a property of the bag, and putting
       * it anywhere else would mean every surface that shows a bag doing a join
       * to find out what is in it.
       *
       * Bags not named in the request are left exactly as they were, so a desk
       * checking in three of four bags now and the fourth when it turns up does
       * not blank the three.
       */
      const bags = job.dispatch.bags.map((bag) => {
        const update = wanted.get(bag.id);
        if (!update) return bag;

        return {
          ...bag,
          itemCount: update.itemCount ?? bag.itemCount,
          weight: update.weight?.trim() || bag.weight,
          countedAt: at,
          countedBy: supervisor.name,
        };
      });

      const unknown = counts.filter(
        (bag) => !job.dispatch.bags.some((existing) => existing.id === bag.id)
      );

      if (unknown.length > 0) {
        return { kind: 'unknown-bag', bag: unknown[0].id } as const;
      }

      const saved = await t.jobs.upsert({
        ...job,
        updatedAt: at,
        dispatch: { ...job.dispatch, bags },
      });

      if (named.length > 0) {
        await t.garments.record(
          saved.id,
          named.map((garment, index) => ({
            // Deterministic on the order and the position, so a desk that
            // submits the same list twice corrects its own rows rather than
            // filing a second copy of every garment.
            id: `garment-${saved.id}-${index}`,
            bagId: garment.bagId,
            description: garment.description!.trim().slice(0, 200),
            condition: (garment.condition ?? '').trim().slice(0, 300),
            recordedBy: supervisor.name,
          }))
        );
      }

      const counted = counts.reduce((sum, bag) => sum + (bag.itemCount ?? 0), 0);

      await t.hubEvents.record({
        id: `hub-${saved.id}-intake-${Date.now()}`,
        jobId: saved.id,
        stage: 'intake',
        machine: body.machine?.trim() ?? '',
        batch: body.batch?.trim() ?? '',
        operator: supervisor.email,
        operatorName: supervisor.name,
        notes: body.notes?.trim() ?? '',
      });

      /**
       * The count goes on the trail as well as onto the bag.
       *
       * Because it is the number every later dispute is argued against: if a
       * customer says fourteen went in and twelve came back, the answer has to
       * be attributable to whoever wrote it down, and `job_garments` records
       * only the garments somebody bothered to name.
       */
      await recordAudit(t, {
        actor: supervisor.email,
        actorName: supervisor.name,
        action: 'Load checked in',
        details:
          `Counted ${counted} garment${counted === 1 ? '' : 's'} across ` +
          `${counts.length} bag${counts.length === 1 ? '' : 's'} on ${saved.reference}` +
          (named.length > 0 ? `, naming ${named.length} of them` : ''),
        type: 'stage',
        orderId: saved.id,
        subject: saved.customer.email,
      });

      return { kind: 'ok', job: saved } as const;
    });

    if (outcome.kind === 'missing') {
      notFound(res, 'Order');
      return;
    }

    if (outcome.kind === 'unknown-bag') {
      res.status(400).json({
        error: `${outcome.bag} is not a bag on this order.`,
        reason: 'unknown-bag',
      });
      return;
    }

    res.json(writtenOrderView(outcome.job));
  })
);

/**
 * What happened to this order at the hub, and what was in it.
 *
 * Staff only. This is the pane a supervisor opens when a customer says
 * something came back wrong — the production events in order, and the garments
 * anybody named on the way through.
 */
ordersRouter.get(
  '/:id/production',
  requireStaff,
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.id);
    if (!job) {
      notFound(res, 'Order');
      return;
    }

    const [events, garments] = await Promise.all([
      store.hubEvents.forJob(job.id),
      store.garments.forJob(job.id),
    ]);

    res.json({ events, garments });
  })
);

/**
 * Which hub step a transition *into* each status represents.
 *
 * Keyed on the destination rather than the origin because that is what the
 * request carries, and because the destination is the thing that just finished:
 * a job arriving at `processing` is a job whose wash is done.
 *
 * `dropped_off` is the courier's hand-off at the counter rather than the desk's
 * work, so it is not here — the bags being checked in is recorded by the
 * intake route, which is where somebody counts them.
 */
const HUB_STAGE_FOR: Partial<Record<JobStatus, HubStage>> = {
  processing: 'wash',
  ready_for_delivery: 'finish',
};

/**
 * Constant-time compare, so a code is not distinguishable by how long it takes.
 *
 * Exported for `orders.check.ts`, which pins the length-mismatch case: the
 * obvious way to write this throws on a supplied code of the wrong length, and
 * a wrong length is exactly what a guess looks like.
 */
export function matchesCode(expected: string | undefined, supplied: string | undefined): boolean {
  if (!expected || !supplied) return false;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');

  // `timingSafeEqual` throws on a length mismatch, and a guessed code is exactly
  // where a length mismatch comes from.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Who to file a refused hand-off against. */
function actorFor(access: BookingAccess): AuditActor {
  switch (access.kind) {
    case 'supervisor':
      return { actor: access.supervisor.email, actorName: access.supervisor.name };
    case 'rider':
      return { actor: access.rider.id, actorName: access.rider.name };
    case 'customer':
      return { actor: access.account.email, actorName: access.account.name || access.account.email };
    case 'tracking':
      return { actor: 'tracking-token', actorName: 'Guest tracking link' };
  }
}

/**
 * The ceiling on hand-off code attempts for one leg of one job.
 *
 * A code is four digits, and nothing counted the guesses. Ten thousand requests
 * walked the space, and the reason that mattered is not that a courier could
 * complete a hand-off they were not entitled to — they could already, by
 * supplying an `overrideReason` — but that guessing produced a *clean* one. The
 * override writes its sentence onto the job, raises "completed without a code"
 * to the desk and tells the customer; a guessed code leaves none of that. What
 * was unbounded was the way past the audit trail, not the way past the gate.
 *
 * **Keyed on the job and the leg rather than the caller.** What is being guessed
 * at is this code. Whoever is guessing can change address between attempts and
 * the job cannot, which is the same reasoning `credentialLimit` applies to an
 * account being guessed at.
 *
 * **A request carrying an override is never counted or refused.** That is the
 * accountable way past a code the courier genuinely cannot get — the customer is
 * out, the hub desk is unmanned — and a limiter that could close it would leave
 * somebody standing at a door holding bags they are not allowed to hand over.
 * Locking the honest path to protect the audit trail would be the wrong way
 * round: the override *is* the audit trail.
 *
 * Ten an hour against a space of ten thousand puts a full walk beyond a
 * thousand hours, and leaves a courier in the rain more attempts than they will
 * use. In-memory and per-instance, with the same honest limits as every other
 * limiter here.
 */
const handoffLimit = rateLimit({
  max: 10,
  windowMs: 60 * 60 * 1000,
  message:
    'Too many hand-off code attempts on this order. Record why the code cannot be produced instead.',
  key: (req) => {
    const body = (req.body ?? {}) as { status?: unknown; overrideReason?: unknown };

    // Never limit the accountable path — see above.
    if (typeof body.overrideReason === 'string' && body.overrideReason.trim()) return null;

    // Only the two transitions that check a code. Everything else on this route
    // is an ordinary stage change and has nothing to guess at.
    const status = typeof body.status === 'string' ? body.status : '';
    if (!Object.prototype.hasOwnProperty.call(HANDOFF_GATES, status)) return null;

    return `handoff:${req.params.id}:${status}`;
  },
});

/**
 * Advances a job.
 *
 * Mostly a courier's route, but not only: the customer's own app completes the
 * delivery leg — they sign for it and read out their code — and attaches a photo
 * when reporting a problem. So the caller may be the courier holding the job, the
 * desk, or the customer it belongs to, and what each is allowed to do differs.
 *
 * What none of them may do is act on somebody else's job, which is what this
 * route allowed: no session at all, so any caller could drive any order to any
 * stage, and `delivered` was reachable by supplying a sentence instead of a code.
 */
ordersRouter.patch(
  '/:id/status',
  handoffLimit,
  guard(async (req, res) => {
    const patch = req.body as {
      status?: JobStatus;
      riderId?: string;
      photo?: string;
      signature?: string;
      bags?: LaundryBag[];
      /** The four digits the customer read out at the door. */
      deliveryCode?: string;
      /** The four digits on the hub desk's screen. */
      dropoffCode?: string;
      /** Why the hand-off completed without one. */
      overrideReason?: string;
      /**
       * What actually happened to the load, when the desk is confirming a hub
       * stage. See `hub_events`: the audit trail already records *that* a
       * supervisor confirmed a wash, which is a decision; this is the work.
       */
      hub?: { machine?: string; batch?: string; notes?: string };
    };

    if (!patch?.status) {
      res.status(400).json({ error: 'A status is required.' });
      return;
    }

    /**
     * The two blobs, before anything is locked or written.
     *
     * Refused out here rather than inside the transaction: this is a property
     * of the request, not of the job, and there is no reason to take a row lock
     * to find out that a photograph is four megabytes.
     *
     * `imageProblem` checks the type, the decoded size and the leading bytes —
     * so the field takes an image rather than anything wearing an image's
     * prefix. See `@freshfold/core`'s `uploads` module.
     */
    for (const [field, kind] of [
      ['photo', 'photo'],
      ['signature', 'signature'],
    ] as const) {
      const problem = imageProblem(patch[field], kind);
      if (problem) {
        res.status(413).json({ error: problem, reason: `${field}-rejected` });
        return;
      }
    }

    // Pinned outside the transaction callback: narrowing on a property does
    // not survive into a closure, and the gate below indexes on it.
    const status = patch.status;

    const outcome = await store.tx(async (t) => {
      const existing = await t.jobs.find(req.params.id, { lock: true });
      if (!existing) return { kind: 'missing' } as const;

      const access = await resolveBookingAccess(req, existing);
      if (!access) return { kind: 'missing' } as const;

      /**
       * A courier may only move a job they are holding.
       *
       * A job still in the pool is allowed through so that the claim-by-moving
       * path keeps working: the app pairs an accept with the first leg, and a
       * supervisor can leave a job in flight with nobody on it for the console to
       * pick up where it stands. `resolveBookingAccess` has already refused a
       * courier who holds neither this job nor nothing.
       */
      const riderId = access.kind === 'rider' ? access.rider.id : undefined;

      /**
       * What the customer's own app is allowed to do here.
       *
       * Two things, and only these two. It completes the delivery leg — the
       * signature is theirs to give and the code is theirs to read out — and it
       * attaches a photograph when reporting a problem, at whatever stage the job
       * is already in.
       *
       * The override path is closed to them, which is the point of separating
       * this from the courier's rules: a hand-off completed without a code is an
       * exception somebody has to answer for, and letting the party who holds the
       * code waive it is the same as having no code. A customer sending one is
       * refused rather than quietly ignored — they have their code, and the
       * courier's app has the escape hatch.
       */
      if (access.kind === 'customer' || access.kind === 'tracking') {
        if (patch.overrideReason) {
          return {
            kind: 'refused',
            status: 403,
            error: 'Enter the delivery code to confirm this order.',
          } as const;
        }

        // Anything about the dispatch itself is the courier's to report.
        if (patch.bags || patch.riderId) {
          return {
            kind: 'refused',
            status: 403,
            error: 'That part of the order is updated by your courier.',
          } as const;
        }

        const completing = status === 'delivered';
        const annotating = status === existing.status && !!patch.photo;

        if (!completing && !annotating) {
          return {
            kind: 'refused',
            status: 403,
            error: 'Your courier reports this order’s progress.',
          } as const;
        }
      }

      /**
       * The two transitions a courier's phone cannot make on its own say-so.
       *
       * Somebody else reads out four digits — the customer at their door, the
       * hub desk at the counter — and the courier types them; this is where
       * they are checked, because a check that runs on the courier's device
       * against a code the courier's device was given is not a check. Failing
       * that, the courier writes down why — nobody in, left with the concierge,
       * desk unmanned — and the sentence stays on the job.
       */
      const gate = HANDOFF_GATES[status];

      if (gate) {
        const expected = existing.dispatch[gate.otp];
        const supplied = patch[gate.field]?.trim();
        const reason = patch.overrideReason?.trim();

        /**
         * A job minted before this leg had a code cannot be asked for one.
         *
         * Only reachable for jobs already in the ledger: every path that
         * creates one mints all three codes, and no request body can clear
         * them — `applyBookingPatch` does not write dispatch fields. So an
         * absent code means an old record, not a stripped one, and stranding
         * those at a gate they can never satisfy would leave couriers holding
         * bags they cannot check in.
         */
        if (!expected && gate.legacyPasses) {
          // Nothing to check against; let it through.
        } else {
          const codeMatches = matchesCode(expected, supplied);

          if (!codeMatches) {
            if (!reason) {
              /**
               * A refused code goes in the trail.
               *
               * This is the half of the fix the limiter above cannot do. Ten
               * attempts an hour makes a walk of the space impractical; writing
               * the failures down is what makes an *attempt* visible at all —
               * before this, a wrong code and a job nobody ever touched looked
               * exactly alike from the desk, so the only evidence of somebody
               * working on a code was the moment they succeeded.
               *
               * Recorded before the refusal returns, and it survives it: the
               * transaction commits on this path rather than rolling back,
               * because nothing else has been written and the entry is the
               * point.
               */
              await recordAudit(t, {
                ...actorFor(access),
                action: 'Hand-off code refused',
                details:
                  `${supplied ? 'Wrong' : 'Missing'} ${gate.leg} code on ${existing.reference}` +
                  ` (${toBookingStatus(existing.status)} → ${toBookingStatus(status)})`,
                type: 'stage',
                orderId: existing.id,
                subject: existing.customer.email,
              });

              return {
                kind: 'refused',
                status: 403,
                error: supplied ? gate.wrongCode : gate.noCode,
              } as const;
            }

            if (reason.length < MIN_OVERRIDE_REASON) {
              return {
                kind: 'refused',
                status: 400,
                error: gate.thinReason,
              } as const;
            }
          }
        }
      }

      /**
       * The courier comes from the session, never from the body.
       *
       * `riderId` was read straight off the request, so a caller could stamp a
       * transition — and with it the whole job, since `applyStatus` assigns on
       * any patch carrying one — onto a courier who had never seen it. Left
       * undefined for a customer or the desk, which `applyStatus` reads as "do
       * not touch the assignment": the customer confirming their delivery must
       * not un-assign the courier who made it.
       */
      const job = await transition(t, existing, {
        ...(patch as JobStatusPatch),
        riderId,
      });

      /**
       * The desk's moves are recorded; the courier's are not.
       *
       * A courier advancing a job they are holding is already on the customer's
       * timeline, with the codes and photos that back it up, and twenty routine
       * taps per job would bury the thing this trail is for. What it is for is
       * the desk reaching into a job from outside that flow — the Hub tab
       * confirming a wash, the stage stepper putting a stuck order where it
       * belongs — because that is the move nothing else attributes to anybody.
       */
      /**
       * The production record, for the two stages that are physical work.
       *
       * Separate from the audit line below because they answer different
       * questions. The trail answers "who said this load was washed"; this
       * answers "which machine washed it, in which batch" — and that second
       * question is the one you need when three customers report the same
       * discolouration and the only thing their orders have in common is Washer
       * 3 on Tuesday afternoon.
       *
       * Written whenever the desk advances one of these stages, with or without
       * a machine named: a row saying a named operator confirmed the wash and
       * did not say on what is still more than the nothing that was here before,
       * and it keeps the timeline of an order complete.
       */
      if (access.kind === 'supervisor' && existing.status !== job.status) {
        const stage = HUB_STAGE_FOR[job.status];

        if (stage) {
          await t.hubEvents.record({
            id: `hub-${job.id}-${stage}-${Date.now()}`,
            jobId: job.id,
            stage,
            machine: patch.hub?.machine?.trim() ?? '',
            batch: patch.hub?.batch?.trim() ?? '',
            operator: access.supervisor.email,
            operatorName: access.supervisor.name,
            notes: patch.hub?.notes?.trim() ?? '',
          });
        }
      }

      if (access.kind === 'supervisor' && existing.status !== job.status) {
        const reason = patch.overrideReason?.trim();

        await recordAudit(t, {
          actor: access.supervisor.email,
          actorName: access.supervisor.name,
          action: 'Stage confirmed',
          details:
            `Moved ${job.reference} from ${toBookingStatus(existing.status)} to ` +
            `${toBookingStatus(job.status)} from the desk` +
            (reason ? `, without the hand-off code: ${reason}` : ''),
          type: 'stage',
          orderId: job.id,
          subject: job.customer.email,
        });
      }

      return { kind: 'ok', job } as const;
    });

    switch (outcome.kind) {
      case 'missing':
        notFound(res, 'Order');
        return;
      case 'refused':
        res.status(outcome.status).json({ error: outcome.error });
        return;
      default:
        res.json(writtenOrderView(outcome.job));
    }
  })
);

/**
 * Applies a transition and records everything that hangs off it — the customer
 * message, the desk's notification, and the rider's running totals once a job
 * completes.
 *
 * Takes the already-locked job rather than an id: every caller has just read it
 * under `for update` to make its own checks, and re-reading it here would drop
 * that work on the floor. Takes the transaction handle for the same reason the
 * whole thing is a transaction — four writes that only make sense together.
 *
 * Exported for the hub cycle in `../hub`, which is a caller like any other: the
 * stages it advances have to land on the customer's timeline the same way the
 * courier's do, and a second implementation of that is a second thing to get
 * wrong.
 */
export async function transition(
  t: Repositories,
  previous: Job,
  patch: JobStatusPatch & { overrideReason?: string }
): Promise<Job> {
  const updated = applyStatus(previous, patch);

  // A hand-off completed without the other party's code carries the reason for
  // the rest of the job's life. Attached before the write rather than after:
  // on the JSON store the record and the object in hand were the same thing,
  // so a later mutation still landed. Here the write is the only thing that
  // counts.
  //
  // Keyed off the gate table so the drop-off leg records the same way the
  // delivery leg does, on its own pair of proof fields — an exception at the
  // hub and an exception at the door are different events and a job can carry
  // both.
  const overrideReason = patch.overrideReason?.trim();
  const gate = HANDOFF_GATES[updated.status];
  const isOverride = !!gate && previous.status !== updated.status && !!overrideReason;

  if (gate && isOverride) {
    updated.dispatch.proof = {
      ...updated.dispatch.proof,
      [gate.reasonKey]: overrideReason,
      [gate.atKey]: new Date().toISOString(),
    };
  }

  await t.jobs.upsert(updated);

  if (gate && isOverride) {
    // Tell the desk while somebody can still do something about it.
    await t.notifications.insert({
      id: `notif-override-${updated.id}-${Date.now()}`,
      title: gate.alertTitle,
      body: `${updated.reference} for ${updated.customer.name}: ${overrideReason}`,
      timestamp: nowLabel(),
      type: 'alert',
      orderId: updated.id,
      read: false,
    });

    await t.messages.insert({
      id: `msg-${updated.id}-override-${Date.now()}`,
      sender: 'dispatcher',
      text: `${gate.customerLine}"${overrideReason}". Contact the concierge desk if this is not what you expected.`,
      timestamp: nowLabel(),
      orderId: updated.id,
    });
  }

  const line = previous.status !== updated.status ? STATUS_SCRIPT[updated.status] : undefined;
  if (line) {
    await t.messages.insert({
      id: `msg-${updated.id}-${updated.status}-${Date.now()}`,
      sender: 'dispatcher',
      text: line,
      timestamp: nowLabel(),
      orderId: updated.id,
    });
  }

  /**
   * The one point in the round trip somebody has to act on.
   *
   * The customer is told at every stage by the script above, but the courier is
   * not watching a timeline — they need to know a job they left at the hub hours
   * ago is now bagged and waiting for the ride back. The title says when nobody
   * is holding it: a job that reached this stage without a courier named goes
   * back to the open pool, where the whole roster can see it.
   *
   * Lives here rather than in `../hub` because the hub cycle is no longer the
   * only thing that makes this move. A supervisor confirming the press table has
   * finished a load has to send the same notification, and a notification that
   * only fires when a timer moved the job would have been the courier's silence
   * for every load a person confirmed.
   */
  if (updated.status === 'ready_for_delivery' && previous.status !== 'ready_for_delivery') {
    await t.notifications.insert({
      id: `notif-ready-${updated.id}-${Date.now()}`,
      title: updated.dispatch.riderId
        ? 'Ready for delivery'
        : 'Ready for delivery — no courier assigned',
      body:
        `${updated.reference} for ${updated.customer.name} has passed quality check ` +
        `and is packed for the ride back to ${updated.location.deliveryAddress}.`,
      timestamp: nowLabel(),
      type: 'order',
      orderId: updated.id,
      read: false,
    });
  }

  if (updated.status === 'delivered' && previous.status !== 'delivered') {
    const rider = updated.dispatch.riderId
      ? await t.riders.find(updated.dispatch.riderId)
      : null;

    if (rider) {
      // `todayDistance` is not credited here any more. What this added was
      // `dispatch.distanceKm` — the straight line from the hub to the pickup,
      // measured once at booking — so it undercounted on two axes at once: a
      // chord instead of the road, and one leg instead of the ride back. The
      // courier's phone now reports the distance it measured between its own GPS
      // fixes, and adding this on top of that would count the same ride twice.
      await t.riders.update(rider.id, {
        completedCount: rider.completedCount + 1,
        todayEarnings: Number((rider.todayEarnings + updated.payment.amount).toFixed(2)),
      });
    }

    await settleReferral(t, updated.customer.email);
  }

  return updated;
}

/**
 * Pays the referrer, once, when the person they introduced completes an order.
 *
 * On the *first completed delivery* rather than on registration, which is the
 * whole design: rewarding a registration rewards making accounts, and a
 * referrer needs only an email address and a few minutes to make several.
 * Tying it to a delivered order ties it to money the laundry has actually
 * taken.
 *
 * `referral_rewarded_at` is what makes it once. It is stamped in the same
 * transaction as the credit, so a customer's second order finds it already set
 * and does nothing — and a failure between the two rolls both back rather than
 * paying without recording it.
 *
 * Silent on every path that does not pay. A referral that cannot be settled —
 * no referrer, already paid, a referrer whose account has since been deleted —
 * must not fail the delivery it is hanging off. The courier has done their job.
 */
async function settleReferral(t: Repositories, customerEmail: string): Promise<void> {
  if (!customerEmail) return;

  try {
    const customer = await t.accounts.find(customerEmail);
    if (!customer?.referredBy || customer.referralRewardedAt) return;

    const referrer = await t.accounts.find(customer.referredBy);
    if (!referrer) return;

    const balance = roundCedis((referrer.walletBalance ?? 0) + REFERRAL_REWARD);
    await t.accounts.updateProfile(referrer.email, { walletBalance: balance });

    await t.transactions.upsert({
      id: `txn-referral-${customer.email.replace(/[^a-z0-9]+/gi, '-')}`,
      userEmail: referrer.email,
      amount: REFERRAL_REWARD,
      method: 'Referral',
      status: 'Successful',
      // Deterministic on the *referred* customer, not on the referrer: one
      // person introduced is one reward, however many people introduced them.
      reference: `TXN-REFERRAL-${customer.email.toLowerCase()}`,
      timestamp: new Date().toISOString(),
      description: `Referral reward — ${customer.name || customer.email} completed their first order`,
    });

    await t.accounts.updateProfile(customer.email, {
      referralRewardedAt: new Date().toISOString(),
    });

    await t.notifications.insert({
      id: `notif-referral-${customer.email.replace(/[^a-z0-9]+/gi, '-')}`,
      title: 'Referral reward paid',
      body: `${referrer.name || referrer.email} earned GHS ${REFERRAL_REWARD.toFixed(2)} for introducing ${customer.name || customer.email}.`,
      timestamp: nowLabel(),
      type: 'order',
      read: false,
    });
  } catch (error) {
    // Logged, never thrown: a delivery must not fail because a bonus could not
    // be paid.
    console.error(`[referrals] could not settle a reward for ${customerEmail}:`, error);
  }
}

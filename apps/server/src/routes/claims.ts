/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  canMoveClaim,
  CLAIM_KINDS,
  imageProblem,
  isClaimClosed,
  type Claim,
  type ClaimStatus,
} from '@freshfold/core';
import { recordAudit } from '../audit';
import { resolveBookingAccess, resolveLister } from '../booking-access';
import { requireSupervisor } from '../auth';
import { guard, notFound } from '../helpers';
import { store } from '../store';
import { refund } from '../wallet';

/**
 * Claims: a problem raised, tracked to an outcome.
 *
 * `IssueReporter` in the customer app already does the hard half — it takes a
 * reason, a note and a photograph, and refuses a stock image because an
 * attachment on a complaint reads as evidence. What happened next was nothing:
 * the report went into the courier's message thread and stopped. No state, no
 * owner, no authorisation to re-treat anything, no compensation, and no way to
 * close it. A supervisor scrolling a chat log was the whole claims process.
 *
 * Meanwhile the care copy promises a garment will be "re-treated at our cost",
 * which is a commitment nothing in the system could record, let alone honour.
 *
 * The message thread stays. Somebody with a ruined shirt wants to talk to a
 * person, and that conversation belongs where it already is; a claim is filed
 * *alongside* it and carries the half a conversation cannot — where it has got
 * to, whose it is, and how it ended.
 */
export const claimsRouter = Router();

/** How long after delivery a problem can still be raised, in days. */
const CLAIM_WINDOW_DAYS = 14;

/** The most claims one order can carry, so a thread cannot be used as a queue. */
const MAX_CLAIMS_PER_JOB = 10;

/**
 * The desk's queue.
 *
 * Open by default — settled claims are history and this pane exists to work
 * through the ones that are not. `?all=1` widens it for the supervisor looking
 * back at what was decided.
 */
claimsRouter.get(
  '/',
  requireSupervisor,
  guard(async (req, res) => {
    const all = req.query.all === '1' || req.query.all === 'true';
    res.json(await store.claims.list({ openOnly: !all }));
  })
);

/**
 * A customer's own claims, across every order.
 *
 * Behind their session rather than an email in the query string, for the reason
 * `GET /bookings` is: an address read off the request is a claim about who is
 * asking rather than a fact about it.
 */
claimsRouter.get(
  '/mine',
  guard(async (req, res) => {
    const lister = await resolveLister(req);

    if (!lister) {
      res.status(401).json({ error: 'Sign in to see the problems you have reported.' });
      return;
    }

    if (lister.kind === 'supervisor') {
      res.json(await store.claims.list({ openOnly: false }));
      return;
    }

    res.json(await store.claims.list({ email: lister.account.email }));
  })
);

/**
 * Raises one against an order.
 *
 * Open to whoever can read the booking — a session or the tracking token a
 * guest left with. A guest who booked from the website has no account to sign
 * into and is exactly the customer most likely to have nowhere else to go.
 *
 * The courier is refused. They are frequently the subject of a complaint, and a
 * party to a dispute should not be able to open it on the customer's behalf.
 */
claimsRouter.post(
  '/job/:jobId',
  guard(async (req, res) => {
    const { kind, description, photo } = (req.body ?? {}) as {
      kind?: string;
      description?: string;
      photo?: string;
    };

    /**
     * Same check the hand-off proof gets, for the same reason: this is the
     * other field that takes a base64 image from a phone.
     *
     * Before the lookup, like the orders route does it. Whether a photograph is
     * four megabytes is a property of the request rather than of the job, so
     * there is nothing to learn from the database first — and a body that
     * cannot be accepted should not cost a round trip to find that out.
     */
    const badPhoto = imageProblem(photo, 'photo');
    if (badPhoto) {
      res.status(413).json({ error: badPhoto, reason: 'photo-rejected' });
      return;
    }

    const job = await store.jobs.find(req.params.jobId);
    if (!job) {
      notFound(res, 'Order');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Order');
      return;
    }

    if (access.kind === 'rider') {
      res.status(403).json({ error: 'Only the customer or the desk can raise a claim.' });
      return;
    }

    const text = description?.trim() ?? '';
    if (text.length < 10) {
      res.status(400).json({
        error: 'Say what went wrong — a sentence at least, so the desk can act on it.',
        reason: 'description-required',
      });
      return;
    }

    /**
     * The kind is one of the app's own reason chips, or `other`.
     *
     * Checked rather than trusted because it is what the desk filters and
     * reports on, and a free-text kind would make "how many missing-garment
     * claims did we have last month" unanswerable within a fortnight.
     */
    const reason = CLAIM_KINDS.includes(kind as never) ? kind! : 'other';

    /**
     * There is a window, and it runs from delivery.
     *
     * Not because a complaint after it is untrue, but because after a fortnight
     * the laundry has no way to check one: the garment has been worn and washed
     * again, and `hub_events` for that batch are two hundred loads back. A
     * customer past the window is not turned away — the message thread is still
     * open and the desk can still act — they are told this is a conversation
     * rather than a claim.
     *
     * Undelivered orders are always in window. A problem with an order still in
     * progress is the most urgent kind there is.
     */
    if (job.status === 'delivered' && job.dispatch.deliveredAt) {
      const age = Date.now() - Date.parse(job.dispatch.deliveredAt);

      if (Number.isFinite(age) && age > CLAIM_WINDOW_DAYS * 86_400_000) {
        res.status(409).json({
          error:
            `This order was delivered more than ${CLAIM_WINDOW_DAYS} days ago, which is past ` +
            'the window we can investigate. Message the desk and we will still look at it.',
          reason: 'window-closed',
        });
        return;
      }
    }

    const existing = await store.claims.forJob(job.id);
    if (existing.length >= MAX_CLAIMS_PER_JOB) {
      res.status(409).json({
        error: 'There are already several open reports on this order. The desk will be in touch.',
        reason: 'too-many',
      });
      return;
    }

    const claim = await store.tx(async (t) => {
      const created = await t.claims.create({
        id: `claim-${job.id}-${Date.now()}`,
        jobId: job.id,
        // The address on the job, not one from the request: a tracking token
        // identifies an order rather than a person, and the claim has to be
        // filed against whoever the order belongs to.
        customerEmail: job.customer.email,
        kind: reason,
        description: text.slice(0, 1000),
        photo: photo?.trim() || undefined,
      });

      /**
       * The desk finds out on the board, not by refreshing a list.
       *
       * A claim is the one thing here with a clock on it that nobody else is
       * watching — a booking has a courier and a wash has a hub console, and a
       * complaint has only whoever notices it.
       */
      await t.notifications.insert({
        id: `notif-claim-${created.id}`,
        title: 'Problem reported',
        body: `${job.customer.name} reported a problem with ${job.reference}: ${reason}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'order',
        orderId: job.id,
        read: false,
      });

      return created;
    });

    res.status(201).json(claim);
  })
);

/** Every claim on one order. Whoever can read the order can read these. */
claimsRouter.get(
  '/job/:jobId',
  guard(async (req, res) => {
    const job = await store.jobs.find(req.params.jobId);
    if (!job) {
      notFound(res, 'Order');
      return;
    }

    const access = await resolveBookingAccess(req, job);
    if (!access) {
      notFound(res, 'Order');
      return;
    }

    res.json(await store.claims.forJob(job.id));
  })
);

/**
 * Moves a claim on. Supervisor only.
 *
 * The transitions are core's `canMoveClaim`, and the one that matters is that
 * `resolved` is reachable only from `upheld` — the laundry cannot record a
 * customer as made whole without first having agreed that something was owed.
 *
 * Compensation is paid here rather than left as a number on a row. A claim that
 * says ₵40 and a wallet that never moved is the same broken promise the care
 * copy already made, written down more precisely.
 */
claimsRouter.patch(
  '/:id',
  requireSupervisor,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as {
      status?: ClaimStatus;
      resolution?: string;
      compensation?: number;
      retreatment?: boolean;
      garmentId?: string;
    };

    const supervisor = req.supervisor!;

    const existing = await store.claims.find(req.params.id);
    if (!existing) {
      notFound(res, 'Claim');
      return;
    }

    const next = body.status ?? existing.status;

    if (next !== existing.status && !canMoveClaim(existing.status, next)) {
      res.status(409).json({
        error:
          next === 'resolved'
            ? 'A claim has to be upheld before it can be settled.'
            : `A ${existing.status} claim cannot be moved to ${next}.`,
        reason: 'bad-transition',
      });
      return;
    }

    const compensation = Number(body.compensation);
    const owed =
      Number.isFinite(compensation) && compensation > 0
        ? Math.round(compensation * 100) / 100
        : 0;

    /**
     * A rejection has to say why.
     *
     * The resolution is shown to the customer, and "no" with nothing after it
     * is the worst version of this whole feature — it is what the message
     * thread already did.
     */
    if (next === 'rejected' && !(body.resolution ?? existing.resolution).trim()) {
      res.status(400).json({
        error: 'Say why this is not being upheld. The customer is shown this.',
        reason: 'reason-required',
      });
      return;
    }

    /**
     * Money moves before the row is written, not after.
     *
     * If the credit fails — no account behind a guest booking, most likely —
     * the claim must not be sitting at `resolved` saying the customer was paid.
     * The reference is the claim's own id, so a supervisor clicking twice, or
     * two supervisors acting on the same complaint, credits once.
     */
    let transactionRef = existing.transactionRef;

    if (next === 'resolved' && owed > 0 && !existing.transactionRef) {
      const paid = await refund({
        email: existing.customerEmail,
        amount: owed,
        description: `Claim ${existing.id} — ${existing.kind}`,
        bookingId: existing.jobId,
        reference: `TXN-CLAIM-${existing.id}`,
      });

      if (!paid.ok) {
        res.status(paid.reason === 'no-account' ? 409 : 400).json({
          error:
            paid.reason === 'no-account'
              ? 'This order was booked as a guest, so there is no wallet to credit. ' +
                'Settle it another way and record that here.'
              : 'That compensation could not be paid.',
          reason: paid.reason,
        });
        return;
      }

      transactionRef = paid.transaction?.reference;
    }

    const updated = await store.tx(async (t) => {
      const saved = await t.claims.update(existing.id, {
        status: next,
        resolution: (body.resolution ?? existing.resolution).trim().slice(0, 1000),
        compensation: owed || existing.compensation,
        retreatment: body.retreatment ?? existing.retreatment,
        transactionRef,
        handledBy: supervisor.email,
        handledByName: supervisor.name,
        closed: isClaimClosed(next),
      });

      if (!saved) return null;

      /**
       * The garment named in the complaint is flagged on the record.
       *
       * This is what makes the intake count worth taking: a claim about a blue
       * shirt marks the blue shirt somebody wrote down at the bench, so the
       * next person to open this order sees which item is disputed rather than
       * a paragraph describing it.
       */
      if (body.garmentId) await t.garments.flag(saved.jobId, body.garmentId);

      await recordAudit(t, {
        actor: supervisor.email,
        actorName: supervisor.name,
        action: claimAction(existing.status, saved),
        details: claimDetails(saved, owed),
        type: saved.compensation > 0 ? 'payment' : 'stage',
        orderId: saved.jobId,
        subject: saved.customerEmail,
      });

      return saved;
    });

    if (!updated) {
      notFound(res, 'Claim');
      return;
    }

    res.json(updated);
  })
);

/** How the trail names what just happened to a claim. */
function claimAction(from: ClaimStatus, claim: Claim): string {
  if (from === claim.status) return 'Claim updated';

  switch (claim.status) {
    case 'investigating':
      return 'Claim picked up';
    case 'upheld':
      return 'Claim upheld';
    case 'rejected':
      return 'Claim not upheld';
    case 'resolved':
      return 'Claim settled';
    default:
      return 'Claim updated';
  }
}

function claimDetails(claim: Claim, paid: number): string {
  const parts = [`Claim ${claim.id} on order ${claim.jobId} is now ${claim.status}`];

  if (paid > 0) parts.push(`credited GHS ${paid.toFixed(2)} to the customer's wallet`);
  if (claim.retreatment) parts.push('authorised a re-treatment at our cost');
  if (claim.resolution) parts.push(`reason given: ${claim.resolution}`);

  return parts.join('; ');
}

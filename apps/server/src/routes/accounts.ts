/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  ADDRESS_LIMIT_MESSAGE,
  MAX_SAVED_ADDRESSES,
  PHONE_LENGTH_MESSAGE,
  isCompletePhone,
  isTerminal,
  normaliseAddresses,
  paymentPurpose,
  phoneDigits,
  type PaymentTransaction,
  type UserAccount,
} from '@freshfold/core';
import { requireAuth, requireSupervisor } from '../auth';
import { deskActor, recordAudit } from '../audit';
import { resolveLister } from '../booking-access';
import { cancel, resume, settleAccountByEmail, subscribe } from '../membership';
import { sanitize } from '../passwords';
import { store, type StoredAccount } from '../store';
import { charge, redeem, topUp, type WalletOutcome } from '../wallet';
import { TOPUP_PURPOSE, verifyPaystackTransaction } from './integrations';
import { guard, notFound } from '../helpers';

/**
 * Customer profiles and the payment ledger.
 *
 * Credentials are not part of this resource. Responses go through `sanitize`,
 * and the writable field list below is an allow-list, so a caller cannot set a
 * password hash by including one in the body. Passwords are only ever set via
 * `/api/auth/register`.
 */
export const accountsRouter = Router();

/**
 * Fields a client is allowed to write through this route.
 *
 * `points` and `walletBalance` are deliberately not among them any more. Both
 * apps used to compute a new balance locally and PUT it here, which meant the
 * last writer won: a membership renewal debited by the server was silently
 * restored by whichever device next saved a profile, and a client could award
 * itself any number of care points by asking. Money and points move through
 * `/accounts/wallet` below, which decides the arithmetic itself.
 *
 * `addresses` is not among them either, and for the same reason rather than a
 * different one. Both apps call this with a whole account object, so a name
 * change carries whatever book that device last polled — and a phone saving a
 * name would erase an address added on the website a second earlier. The book
 * moves through `/accounts/addresses` below, which is the only writer.
 */
type WritableAccountFields = Pick<UserAccount, 'email' | 'phone' | 'name'>;

function pickWritable(body: Partial<UserAccount>): Partial<WritableAccountFields> {
  const { email, phone, name } = body;
  const writable: Partial<WritableAccountFields> = {};

  if (email !== undefined) writable.email = email;
  if (phone !== undefined) writable.phone = phone;
  if (name !== undefined) writable.name = name;

  return writable;
}

/**
 * The patron table. Supervisor only.
 *
 * This answered anybody, and `sanitize` only takes the credentials off — so the
 * response was every customer FreshFold has: name, email, phone, points, wallet
 * balance, membership and whether they are suspended. The website polled it
 * every five seconds from the public marketing page.
 */
accountsRouter.get(
  '/',
  requireSupervisor,
  guard(async (_req, res) => {
    const accounts = await store.accounts.list();
    res.json(accounts.map(sanitize));
  })
);

/**
 * Saves a profile. The caller's own, and only theirs.
 *
 * The email used to come out of the body, and there was no session at all: the
 * route would find-or-create by whatever address arrived, so it could rename any
 * customer, move their phone number, or conjure an account for an address it had
 * never seen. The address now comes off the token, and a body naming somebody
 * else is refused rather than quietly redirected — a client sending one has a bug
 * worth hearing about.
 */
accountsRouter.put(
  '/',
  requireAuth,
  guard(async (req, res) => {
    const incoming = pickWritable((req.body ?? {}) as Partial<UserAccount>);
    const session = req.account!;

    if (incoming.email && incoming.email.trim().toLowerCase() !== session.email.toLowerCase()) {
      res.status(403).json({ error: 'A profile can only be saved by the account that owns it.' });
      return;
    }

    // Whatever the body said, this is whose profile it is.
    incoming.email = session.email;

    // A blank number is a profile that has not filled one in yet; a number that
    // is present has to be a whole one.
    if (incoming.phone) {
      if (!isCompletePhone(incoming.phone)) {
        res.status(400).json({ error: PHONE_LENGTH_MESSAGE });
        return;
      }
      incoming.phone = phoneDigits(incoming.phone);
    }

    /**
     * A write, on a locked row. No insert branch any more: `requireAuth`
     * resolved this account to reach here, so it exists by construction. The
     * find-or-create this replaced was the whole of the account-creation path
     * for an unauthenticated caller.
     */
    const outcome = await store.tx(async (t) => {
      const existing = await t.accounts.find(session.email, { lock: true });
      if (!existing) return { ok: false as const, reason: 'no-account' as const };

      /**
       * Nobody else's number.
       *
       * `accounts_phone_key_idx` is a plain index, not a unique one, so the
       * database will happily hold two customers on one number — and sign-in
       * resolves an identifier through `findByIdentifier`, which matches
       * `phone_key` with `limit 1`. Two accounts sharing a number therefore
       * means signing in by phone lands on whichever row Postgres hands back
       * first, and the loser cannot reach their account at all.
       *
       * Nothing could reach this until now: no surface could change a phone
       * number. The app's settings screen can, so the check belongs here —
       * inside the transaction, because a check made outside it is one two
       * simultaneous saves can both pass.
       */
      if (incoming.phone) {
        const holder = await t.accounts.findByIdentifier(incoming.phone);
        if (holder && holder.email.toLowerCase() !== existing.email.toLowerCase()) {
          return { ok: false as const, reason: 'phone-taken' as const };
        }
      }

      // Only the allow-listed fields are written, so password_salt and
      // password_hash on the stored row are untouched.
      const saved = (await t.accounts.updateProfile(existing.email, incoming)) ?? existing;
      return { ok: true as const, account: saved };
    });

    if (!outcome.ok) {
      if (outcome.reason === 'phone-taken') {
        res.status(409).json({
          error: 'That phone number is already on another FreshFold account.',
          reason: 'phone-taken',
        });
        return;
      }

      notFound(res, 'Account');
      return;
    }

    res.json(sanitize(outcome.account));
  })
);

// ---------------------------------------------------------------------------
// Saved addresses
// ---------------------------------------------------------------------------

/**
 * Replaces the signed-in customer's saved address book.
 *
 * The book used to live in the app's own storage, under `freshfold_addresses`,
 * which made it a property of a handset rather than of a person: the website
 * showed none of it, a second phone showed none of it, and reinstalling erased
 * it. It is a column on the account now, so the address a customer saves while
 * booking on their phone is the address the patron portal offers them on a
 * laptop — carried there by the `/auth/me` poll both surfaces already run,
 * which is why this is the only route the move needed.
 *
 * Its own route rather than a field on the PUT above; see the allow-list
 * comment at the top of this file for why that matters.
 *
 * The whole book, every time. Nothing here merges: exactly one entry is the
 * default, so any change is a statement about all of them, and a client that
 * built its array with `withAddress` or `withoutAddress` has already worked out
 * what the whole book should be. Two devices editing at once therefore means the
 * later save wins outright — acceptable for a list of half a dozen addresses a
 * person keeps for themselves, and the alternative is per-entry writes that can
 * leave the book with two defaults or none.
 */
accountsRouter.put(
  '/addresses',
  requireAuth,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as { addresses?: unknown };

    /**
     * Over the ceiling is refused, not trimmed.
     *
     * `normaliseAddresses` caps what it returns, so writing anyway would
     * succeed and silently drop the addresses past the twelfth — and the
     * customer would find out by noticing one missing later. No client sends
     * this: both stop at the limit and show `ADDRESS_LIMIT_MESSAGE`. One that
     * does has a bug, and a 400 is how it hears about it.
     */
    if (Array.isArray(body.addresses) && body.addresses.length > MAX_SAVED_ADDRESSES) {
      res.status(400).json({ error: ADDRESS_LIMIT_MESSAGE, reason: 'address-limit' });
      return;
    }

    // The server's copy of the rules, run on a body it has no reason to trust.
    // Entries without an address or a suburb are dropped, ids are deduplicated
    // and the single default is settled here — so the column holds a book this
    // product can render even if the caller sent something else.
    const addresses = normaliseAddresses(body.addresses);

    // No transaction: this replaces a column outright rather than reading it
    // first, so there is no read-modify-write for a concurrent save to tear.
    const saved = await store.accounts.updateProfile(req.account!.email, { addresses });
    if (!saved) {
      notFound(res, 'Account');
      return;
    }

    res.json(sanitize(saved));
  })
);

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * The plan a client holds is decided here, never by the client.
 *
 * These three routes are the only way the membership columns are written — the
 * profile PUT above cannot touch them, by allow-list — and every one of them
 * requires a customer session, because the plan belongs to whoever the bearer
 * token says is asking rather than to whichever email arrives in a body.
 */

accountsRouter.get(
  '/plan',
  requireAuth,
  guard(async (req, res) => {
    const account = await settleAccountByEmail(req.account!.email);
    res.json({ plan: account?.plan ?? null, account: account ? sanitize(account) : null });
  })
);

accountsRouter.post(
  '/plan',
  requireAuth,
  guard(async (req, res) => {
    const planId = (req.body as { planId?: unknown })?.planId;
    if (typeof planId !== 'string') {
      res.status(400).json({ error: 'A subscription needs a plan.' });
      return;
    }

    const outcome = await subscribe(req.account!.email, planId);

    if (!outcome.ok) {
      const status = outcome.reason === 'no-account' ? 404 : outcome.reason === 'unknown-plan' ? 400 : 409;
      res.status(status).json({
        error:
          outcome.reason === 'unknown-plan'
            ? 'That plan is no longer offered.'
            : outcome.reason === 'already-active'
              ? 'That plan is already running on this account.'
              : outcome.reason === 'insufficient-funds'
                ? `Top up ${formatShortfall(outcome.shortfall)} to start this plan.`
                : 'No account for that session.',
        reason: outcome.reason,
        shortfall: outcome.shortfall,
        plan: outcome.account?.plan ?? null,
      });
      return;
    }

    res.json({
      account: sanitize(outcome.account),
      plan: outcome.account.plan ?? null,
      charged: outcome.charged,
      credit: outcome.credit,
    });
  })
);

accountsRouter.delete(
  '/plan',
  requireAuth,
  guard(async (req, res) => {
    // `resume=true` undoes a cancellation the customer changed their mind
    // about, while the period they paid for is still running.
    const resuming = req.query.resume === 'true';
    const outcome = resuming ? await resume(req.account!.email) : await cancel(req.account!.email);

    if (!outcome.ok) {
      res.status(outcome.reason === 'no-plan' ? 409 : 404).json({
        error: outcome.reason === 'no-plan' ? 'No membership to change.' : 'No account for that session.',
        reason: outcome.reason,
      });
      return;
    }

    res.json({
      account: sanitize(outcome.account),
      plan: outcome.account.plan ?? null,
      activeUntil: outcome.activeUntil,
    });
  })
);

function formatShortfall(amount: number | undefined): string {
  return `₵${(amount ?? 0).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Closing an account
// ---------------------------------------------------------------------------

/**
 * The customer closes their own account.
 *
 * Registered here rather than beside the desk's `delete('/:email')` below,
 * because Express matches in declaration order: down there, `/me` is read as a
 * customer whose email address is the word "me", and since that route is
 * supervisor-only the single symptom would be a 401 on a request that was never
 * wrong. The `/plan` routes sit above `/:email` for the same reason.
 *
 * Deliberately not the supervisor route with a different guard on it. The two
 * answer different questions — the desk removing somebody, against somebody
 * leaving — and only one of them can be answered with "block the account
 * instead".
 *
 * What survives is the orders. `accounts.remove` leaves them, and they have to
 * stay: a job carries the address a courier drove to and the money that changed
 * hands, and the books do not balance without it. What goes is the identity that
 * could sign in and read them.
 *
 * What is forfeited is the wallet balance and any running membership. There is
 * no refund path anywhere in the product and building one is a different
 * project, so the app's confirmation names the balance and says it goes — the
 * alternative, refusing to delete an account with money in it, traps the person
 * asking to leave.
 */
accountsRouter.delete(
  '/me',
  requireAuth,
  guard(async (req, res) => {
    const account = await store.accounts.find(req.account!.email);

    if (!account) {
      // The token outlived the row: the desk deleted it, or another device did.
      notFound(res, 'Account');
      return;
    }

    /**
     * Not while a courier is on the way.
     *
     * The same refusal the desk's route gives, for the same reason — deleting
     * the account cancels nothing, it removes the person the courier would ring
     * from the gate. The wording differs because a customer cannot block their
     * own account, and telling them to would be nonsense.
     *
     * Scoped by phone as well as by email, and it has to be: `jobs.list` reads
     * `customer_email or customer_phone_key`, and `GET /bookings` already asks
     * it for both — so an order this customer booked as a visitor, before they
     * registered, is one they can see in the app. Asking by email alone let
     * exactly that order through: the app showed a pickup still out and the
     * delete succeeded anyway, which is the case this refusal exists for.
     */
    const live = (
      await store.jobs.list({ email: account.email, phone: account.phone ?? null })
    ).filter((job) => !isTerminal(job.status));

    if (live.length > 0) {
      const one = live.length === 1;
      res.status(409).json({
        error:
          `You still have ${live.length} order${one ? '' : 's'} with us. Wait for ` +
          `${one ? 'it' : 'them'} to come back, or cancel ${one ? 'it' : 'them'} first, ` +
          `then delete your account.`,
        code: 'ACCOUNT_HAS_LIVE_ORDERS',
        orders: live.map((job) => job.id),
      });
      return;
    }

    // Sessions first, for the reason the desk's route gives: the failure this
    // order can leave is a customer signed out of an account that still exists,
    // which they can sign back into. The other order leaves a working token for
    // a row that has gone.
    await store.sessions.revokeAllFor('customer', account.email);
    await store.accounts.remove(account.email);

    /**
     * The one entry in this trail a customer writes.
     *
     * Filed all the same. An account disappearing is precisely the event the
     * desk gets asked about later — "who was the customer on this order, and
     * where have they gone" — and without this the answer is nowhere in the
     * system, because the row that held the name is the row that went. The
     * forfeited balance is named for the same reason: it is the part somebody
     * will write in about.
     */
    await recordAudit(store, {
      actor: account.email,
      actorName: account.name || account.email,
      action: 'Account closed by customer',
      details:
        `${account.name || account.email} (${account.email}) deleted their own account` +
        (account.walletBalance
          ? `, forfeiting a ${formatShortfall(account.walletBalance)} wallet balance`
          : '') +
        (account.plan ? ` and a running ${account.plan.planId} membership` : '') +
        '; their past orders were left in place',
      type: 'account',
      subject: account.email,
    });

    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Wallet and care points
// ---------------------------------------------------------------------------

/**
 * The one path that moves a balance or a points total.
 *
 * Authenticated, and scoped to whoever the bearer token says is asking — never
 * to an email in the body. Three actions, all of which write the account and
 * its ledger entry in a single transaction:
 *
 *   topup   — credits the wallet against a settled Paystack payment. Earns no
 *             points; points are for laundry.
 *   charge  — debits it and awards a point per whole cedi.
 *   redeem  — spends care points on a reward from the shared catalogue.
 *
 * `reference` makes a movement idempotent: both apps queue writes offline and
 * replay them, and a replay must not move the balance twice. For `topup` it is
 * also the proof of payment, and is required — see the case below.
 */
accountsRouter.post(
  '/wallet',
  requireAuth,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as {
      action?: unknown;
      amount?: unknown;
      method?: unknown;
      description?: unknown;
      bookingId?: unknown;
      rewardId?: unknown;
      reference?: unknown;
    };

    const email = req.account!.email;
    const reference = typeof body.reference === 'string' ? body.reference : undefined;
    const amount = typeof body.amount === 'number' ? body.amount : NaN;

    let outcome: WalletOutcome;

    switch (body.action) {
      case 'topup': {
        /**
         * A top-up is the one movement that creates money, so it is the one
         * movement that cannot be taken on the caller's word.
         *
         * It used to be: the app posted an amount and the server credited it.
         * Any holder of a session token could fund their own wallet with a
         * single curl. Now the request carries only a Paystack reference, and
         * the balance moves by what Paystack says was collected — `body.amount`
         * is ignored entirely.
         */
        if (!reference?.trim()) {
          res.status(400).json({
            error: 'A top-up needs the Paystack reference for the payment that funded it.',
            reason: 'reference-required',
          });
          return;
        }

        const verified = await verifyPaystackTransaction(reference);
        if (!verified.ok) {
          res.status(verified.status).json({ error: verified.error, reason: 'verify-failed' });
          return;
        }

        const payment = verified.verification;

        if (!payment.paid) {
          res.status(402).json({
            error: `Paystack says this payment is ${payment.status}. Complete the checkout and try again.`,
            reason: 'payment-not-settled',
            paystackStatus: payment.status,
          });
          return;
        }

        // The reference has to belong to the session asking to be credited.
        // Paystack references are guessable enough in aggregate, and without
        // this one customer could quote another's and be credited first — the
        // ledger's idempotency would then quietly deny the payer their money.
        if (payment.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
          res.status(403).json({
            error: 'That payment was made by a different account.',
            reason: 'reference-not-yours',
          });
          return;
        }

        // A booking's payment is for the booking. Without this, a customer
        // could pay for a wash and then replay the same reference here to put
        // its value in the wallet as well.
        //
        // The purpose is written by `/paystack/initialize` from a fixed list
        // and is no longer the caller's to compose — which is what makes this
        // gate and the booking route's mutually exclusive rather than merely
        // different. See `@freshfold/core`'s `payments` module for what the two
        // of them used to allow between them.
        if (paymentPurpose(payment.metadata) !== TOPUP_PURPOSE) {
          res.status(400).json({
            error: 'That payment was not a wallet top-up.',
            reason: 'not-a-topup',
          });
          return;
        }

        outcome = await topUp({
          email,
          amount: payment.amount,
          method: typeof body.method === 'string' ? body.method : 'Paystack',
          reference,
        });
        break;
      }

      case 'charge':
        outcome = await charge({
          email,
          amount,
          description: typeof body.description === 'string' ? body.description : '',
          bookingId: typeof body.bookingId === 'string' ? body.bookingId : undefined,
          reference,
        });
        break;

      case 'redeem':
        outcome = await redeem({
          email,
          rewardId: typeof body.rewardId === 'string' ? body.rewardId : '',
          reference,
        });
        break;

      default:
        res.status(400).json({ error: 'A wallet movement needs an action.' });
        return;
    }

    if (!outcome.ok) {
      const status =
        outcome.reason === 'no-account'
          ? 404
          : outcome.reason === 'bad-amount' || outcome.reason === 'unknown-reward'
            ? 400
            : 409;

      res.status(status).json({
        error:
          outcome.reason === 'bad-amount'
            ? 'A wallet movement needs an amount above zero.'
            : outcome.reason === 'unknown-reward'
              ? 'That reward is no longer offered.'
              : outcome.reason === 'insufficient-funds'
                ? `Top up ${formatShortfall(outcome.shortfall)} to cover this.`
                : outcome.reason === 'insufficient-points'
                  ? `${outcome.shortfall ?? 0} more care points needed for that reward.`
                  : 'No account for that session.',
        reason: outcome.reason,
        shortfall: outcome.shortfall,
      });
      return;
    }

    res.json({
      account: sanitize(outcome.account),
      transaction: outcome.transaction,
    });
  })
);

// ---------------------------------------------------------------------------
// Supervisor actions
// ---------------------------------------------------------------------------

/**
 * Blocking and deletion — the two ways a customer stops being one.
 *
 * Both are behind `requireSupervisor`, and both are registered *after* the plan
 * routes above so that `/accounts/plan` is still matched by `/plan` rather than
 * being read as a customer whose email is the word "plan".
 *
 * Blocking is the reversible one, and the one that stops somebody immediately:
 * their sessions are revoked, `accountForToken` refuses the token they are
 * holding, and sign-in, registration and booking all turn them away. Deletion
 * is for a record that should not exist at all — a duplicate, a test account, a
 * customer exercising their right to be forgotten — and it takes the identity
 * while leaving the orders it booked.
 */

/** What the supervisor who just acted sees, reason and all. */
function patronView(account: StoredAccount): UserAccount {
  return { ...sanitize(account), blockedReason: account.blockedReason };
}

/**
 * Awards or deducts care points. Supervisor only.
 *
 * The desk's adjuster used to write the new total through `PUT /accounts`,
 * which any client could call with any number. Points are an entitlement now:
 * customers earn them by spending, and the only other way they move is a
 * supervisor granting them here, on a locked row, by a delta rather than an
 * absolute — two supervisors crediting the same patron at once would otherwise
 * lose one of the two grants.
 *
 * The reason is not stored on the account; it goes into the audit trail beside
 * the delta and the supervisor who granted it, which is the record somebody
 * asking "why does this patron have 400 points" needs to be able to read.
 */
accountsRouter.patch(
  '/:email/points',
  requireSupervisor,
  guard(async (req, res) => {
    const { delta, reason } = (req.body ?? {}) as { delta?: unknown; reason?: string };

    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
      res.status(400).json({ error: 'A points adjustment needs a non-zero delta.' });
      return;
    }

    const actor = deskActor(req);
    const note = (reason ?? '').trim();

    const account = await store.tx(async (t) => {
      const existing = await t.accounts.find(req.params.email, { lock: true });
      if (!existing) return null;

      // Clamped at zero: a deduction larger than the balance takes it to nothing
      // rather than into a debt no part of the product knows how to collect.
      const points = Math.max(0, Math.round((existing.points ?? 0) + delta));
      const updated = await t.accounts.updateProfile(existing.email, { points });

      // Inside the transaction, so the entry and the balance it explains commit
      // together. Both totals are named because the delta alone does not say
      // what the clamp did.
      await recordAudit(t, {
        ...actor,
        action: 'Points adjustment',
        details:
          `${delta > 0 ? 'Awarded' : 'Deducted'} ${Math.abs(Math.round(delta))} care points ` +
          `for ${existing.name || existing.email} — ${existing.points ?? 0} to ${points}` +
          (note ? `. Reason: ${note}` : '. No reason given'),
        type: 'points',
        subject: existing.email,
      });

      return updated;
    });

    if (!account) {
      notFound(res, 'Account');
      return;
    }

    res.json(sanitize(account));
  })
);

accountsRouter.patch(
  '/:email/blocked',
  requireSupervisor,
  guard(async (req, res) => {
    const { blocked, reason } = (req.body ?? {}) as { blocked?: boolean; reason?: string };

    if (typeof blocked !== 'boolean') {
      res.status(400).json({ error: 'A `blocked` boolean is required.' });
      return;
    }

    const account = await store.accounts.setBlocked(
      req.params.email,
      blocked ? { at: new Date().toISOString(), reason: (reason ?? '').trim() } : null
    );

    if (!account) {
      notFound(res, 'Account');
      return;
    }

    // Outside any transaction, and only on the way in: a customer who is
    // blocked while their app is open should be signed out of it now rather
    // than whenever their week-long token happens to lapse. Lifting a block
    // does not restore the sessions it ended — they sign in again.
    if (blocked) await store.sessions.revokeAllFor('customer', account.email);

    const note = (reason ?? '').trim();

    await recordAudit(store, {
      ...deskActor(req),
      action: blocked ? 'Patron blocked' : 'Patron restored',
      details: blocked
        ? `Blocked ${account.name || account.email} and ended their sessions` +
          (note ? `. Reason: ${note}` : '. No reason given')
        : `Lifted the block on ${account.name || account.email}`,
      type: 'account',
      subject: account.email,
    });

    res.json(patronView(account));
  })
);

accountsRouter.delete(
  '/:email',
  requireSupervisor,
  guard(async (req, res) => {
    const account = await store.accounts.find(req.params.email);

    if (!account) {
      notFound(res, 'Account');
      return;
    }

    /**
     * Not while they have a job on the board.
     *
     * A courier may be riding to this customer's door right now, and the job
     * carries the phone number that gets them in the gate. Deleting the account
     * underneath that does not cancel anything — it just removes the person the
     * desk would call about it. Blocking is what stops somebody mid-flight, so
     * the refusal says so.
     *
     * By phone too, for the reason `/me` above gives at length: the number on
     * the job is the one that gets the courier in the gate, and a visitor's
     * order carries that number and no email at all.
     */
    const live = (
      await store.jobs.list({ email: account.email, phone: account.phone ?? null })
    ).filter((job) => !isTerminal(job.status));

    if (live.length > 0) {
      res.status(409).json({
        error:
          `${account.name || account.email} still has ${live.length} order` +
          `${live.length === 1 ? '' : 's'} in progress. Finish or cancel ${
            live.length === 1 ? 'it' : 'them'
          } first, or block the account instead.`,
        code: 'ACCOUNT_HAS_LIVE_ORDERS',
        orders: live.map((job) => job.id),
      });
      return;
    }

    // Sessions first. If the delete fails after this the customer is signed out
    // of an account that still exists, which is recoverable; the other order
    // leaves a live token for a row that has gone.
    await store.sessions.revokeAllFor('customer', account.email);
    await store.accounts.remove(account.email);

    // The identity is gone, so the trail is the only place the name survives.
    // Deliberately spelled out — an email alone in a list of deletions tells a
    // colleague nothing about which account this was.
    await recordAudit(store, {
      ...deskActor(req),
      action: 'Patron deleted',
      details:
        `Deleted the account for ${account.name || account.email} (${account.email})` +
        `; their past orders were left in place`,
      type: 'account',
      subject: account.email,
    });

    res.json({ ok: true });
  })
);

/**
 * The payment ledger. Read-only.
 *
 * It used to be open in both directions. `GET` took the address to scope by out
 * of the query string, so it answered any customer's statement to anyone who
 * knew their email — and the whole ledger, every customer's payments, to a
 * caller who passed nothing. That is fixed below: the token decides the scope.
 *
 * `POST` is gone entirely rather than fixed. Putting it behind a session and
 * forcing `userEmail` off the token closed the worst of it, but the row's
 * `amount`, `method` and `status` still came from the request — so any signed-in
 * customer could file `₵5,000, Successful` against themselves. That moves no
 * money, `/accounts/wallet` owning every balance change, but the desk's
 * financials panel adds these rows up and reports the total as revenue.
 *
 * Nothing called it. The one client method that did (`recordTransaction`) was
 * itself unreachable from any screen — every ledger row a customer can cause is
 * written server-side by `topUp`, `charge` or `redeem`, in the same transaction
 * as the balance it explains. A write endpoint with no writer is a hole with no
 * feature behind it, so this is a deletion rather than a repair.
 */
export const transactionsRouter = Router();

/** A statement: the caller's own, or the whole ledger for the desk. */
transactionsRouter.get(
  '/',
  guard(async (req, res) => {
    const lister = await resolveLister(req);

    if (!lister) {
      res.status(401).json({ error: 'Sign in to see your statement.' });
      return;
    }

    res.json(
      await store.transactions.list(lister.kind === 'supervisor' ? null : lister.account.email)
    );
  })
);

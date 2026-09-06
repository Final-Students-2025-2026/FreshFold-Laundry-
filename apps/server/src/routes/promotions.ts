/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  REFERRAL_REWARD,
  REFERRAL_WELCOME,
  canClaimReferral,
  checkPromo,
  isReferralCodeShaped,
  makeReferralCode,
  normalisePromoCode,
  promoLabel,
} from '@freshfold/core';
import { randomInt } from 'node:crypto';
import { accountForToken, bearerToken, requireSupervisor } from '../auth';
import { deskActor, recordAudit } from '../audit';
import { guard } from '../helpers';
import { rateLimit } from '../rateLimit';
import { store } from '../store';

/**
 * Promo codes, vouchers and referrals.
 *
 * Everything in this file is aimed at somebody who is not a customer yet. The
 * product had a loyalty ladder and four membership tiers before it had any of
 * this — both of which reward a person for already being here — and nothing at
 * all for getting them here. For a laundry whose market is a university campus
 * that is the odd half to be missing, because the channel that actually works in
 * a hall of residence is one student telling another.
 *
 * The arithmetic and the eligibility rules are `@freshfold/core`'s, in
 * `./promotions`, so the quote a booking form shows and the discount the server
 * grants come out of the same function. What lives here is everything that needs
 * the database: how many times a code has been redeemed, by whom, and whether
 * this is the customer's first order.
 */
export const promotionsRouter = Router();

/** Codes a customer may not mint for themselves by guessing a referral code. */
const RESERVED_PREFIX = 'FF';

/**
 * Checks a code without booking anything.
 *
 * What the booking forms call so a customer can see what their code is worth
 * before they commit to the order. Deliberately *advisory*: `POST /bookings`
 * re-runs the same check against the row it is holding, because the last
 * redemption of a limited code may be somebody else's and may land between this
 * call and that one.
 *
 * Open with no session, like `/bookings/availability`, and for the same reason —
 * the booking form is open to strangers, which is what a booking form is. It
 * leaks whether a code exists and what it is worth, which is what a promo code
 * is for.
 *
 * **Telling one person about one code is not the same as answering everybody
 * about every code**, and until {@link checkLimit} there was nothing marking
 * the difference. A code is a short printable string, so an unmetered oracle
 * over it is a dictionary away from the whole promotions table — including the
 * limited-use codes meant for one campaign, and the referral codes that pay a
 * real ₵ reward. The honest answer to a customer typing what they were given
 * survives a limiter; a script walking the space does not.
 */
const checkLimit = rateLimit({
  max: 20,
  windowMs: 15 * 60 * 1000,
  message: 'Too many code checks. Wait a few minutes, or book without one.',
});

promotionsRouter.post(
  '/check',
  checkLimit,
  guard(async (req, res) => {
    const { code, subtotal, email } = (req.body ?? {}) as {
      code?: string;
      subtotal?: number;
      email?: string;
    };

    const typed = normalisePromoCode(code ?? '');
    if (!typed) {
      res.status(400).json({ error: 'Enter a code.', reason: 'unknown' });
      return;
    }

    const bill = Number(subtotal);
    if (!Number.isFinite(bill) || bill < 0) {
      res.status(400).json({ error: 'A code is checked against an order total.' });
      return;
    }

    const promo = await store.promos.find(typed);
    const usage = email
      ? await store.promos.usage(typed, email)
      : { total: 0, byCustomer: 0 };

    /**
     * A stranger with no address is treated as being on their first order.
     *
     * Optimistic on purpose: the form is showing a quote, and the server decides
     * for real at submission. Telling a guest their first-order code will not
     * work — when it will, because they are indeed a first-time customer — would
     * be the worse of the two errors.
     */
    const history = email
      ? await store.jobs.list({ email, phone: null })
      : [];

    const verdict = checkPromo(promo, bill, {
      ...usage,
      firstOrder: history.length === 0,
    });

    if (!verdict.ok) {
      res.status(200).json({ ok: false, reason: verdict.reason, error: verdict.message });
      return;
    }

    res.json({ ok: true, code: verdict.code, discount: verdict.discount, label: verdict.label });
  })
);

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

/** Every code, with what it has cost. Supervisor only. */
promotionsRouter.get(
  '/',
  requireSupervisor,
  guard(async (_req, res) => {
    res.json(await store.promos.list());
  })
);

/** One code's redemptions — the campaign report. */
promotionsRouter.get(
  '/:code/redemptions',
  requireSupervisor,
  guard(async (req, res) => {
    res.json(await store.promos.redemptions(req.params.code));
  })
);

/**
 * Creates or edits a code. Supervisor only.
 *
 * An upsert rather than separate create and update routes, because a code is its
 * own primary key: there is no id to PATCH against, and "save this code" is one
 * act from the desk's point of view whether or not it existed a moment ago.
 */
promotionsRouter.put(
  '/:code',
  requireSupervisor,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as {
      label?: string;
      kind?: string;
      value?: number;
      maxDiscount?: number;
      minSpend?: number;
      startsAt?: string;
      expiresAt?: string;
      maxUses?: number;
      maxPerCustomer?: number;
      firstOrderOnly?: boolean;
      active?: boolean;
    };

    const code = normalisePromoCode(req.params.code);

    if (code.length < 3 || code.length > 32) {
      res.status(400).json({ error: 'A code is between 3 and 32 characters.' });
      return;
    }

    /**
     * A promo code may not be shaped like a referral code.
     *
     * Both are typed into the same box by the same customer, and the referral
     * lookup runs first. A six-character promo code drawn from the referral
     * alphabet would be ambiguous — and a supervisor could, by accident, mint one
     * that shadowed a real customer's referral code and silently broke it.
     */
    if (isReferralCodeShaped(code) && !code.startsWith(RESERVED_PREFIX)) {
      res.status(409).json({
        error:
          'That looks like a referral code, which customers type into the same box. ' +
          'Use a different length, or start it with FF.',
        reason: 'shadows-referral',
      });
      return;
    }

    if (body.kind !== 'percent' && body.kind !== 'amount') {
      res.status(400).json({ error: 'A code takes a percentage off or an amount off.' });
      return;
    }

    const value = Number(body.value);
    if (!Number.isFinite(value) || value <= 0) {
      res.status(400).json({ error: 'A code has to be worth something.' });
      return;
    }

    /**
     * A percentage is a fraction, and one above 100% is a mistake with a cost.
     *
     * `1` is a hundred per cent off, which is a legitimate thing a launch offer
     * might be. Anything above it is somebody having typed `20` meaning 20%, and
     * accepting it would make every order free and refund the difference.
     */
    if (body.kind === 'percent' && value > 1) {
      res.status(400).json({
        error: 'A percentage is a fraction: 0.2 is 20%. Anything above 1 would be more than free.',
        reason: 'rate-out-of-range',
      });
      return;
    }

    const saved = await store.tx(async (t) => {
      const promo = await t.promos.upsert({
        code,
        label: (body.label ?? '').trim().slice(0, 120),
        kind: body.kind!,
        value,
        maxDiscount:
          Number.isFinite(Number(body.maxDiscount)) && Number(body.maxDiscount) > 0
            ? Number(body.maxDiscount)
            : undefined,
        minSpend: Math.max(0, Number(body.minSpend) || 0),
        startsAt: body.startsAt || undefined,
        expiresAt: body.expiresAt || undefined,
        maxUses:
          Number.isInteger(body.maxUses) && Number(body.maxUses) > 0
            ? Number(body.maxUses)
            : undefined,
        maxPerCustomer: Math.max(1, Number(body.maxPerCustomer) || 1),
        firstOrderOnly: !!body.firstOrderOnly,
        active: body.active !== false,
        createdBy: req.supervisor!.email,
      });

      await recordAudit(t, {
        ...deskActor(req),
        action: 'Promo code saved',
        details:
          `${promo.code} — ${promoLabel(promo)}` +
          (promo.maxDiscount ? `, capped at GHS ${promo.maxDiscount.toFixed(2)}` : '') +
          (promo.active ? '' : ' (withdrawn)'),
        type: 'payment',
      });

      return promo;
    });

    res.json(saved);
  })
);

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

/**
 * The signed-in customer's own referral code, minting one if they have none.
 *
 * Minted lazily rather than at registration, because every account that already
 * exists has none and a backfill would hand codes to accounts that will never
 * ask. The first time somebody opens the screen that shows it, they get one.
 */
promotionsRouter.get(
  '/referral/mine',
  guard(async (req, res) => {
    const account = await accountForToken(bearerToken(req));
    if (!account) {
      res.status(401).json({ error: 'Sign in to see your referral code.' });
      return;
    }

    let code = account.referralCode;

    if (!code) {
      /**
       * Retried on collision rather than assumed unique.
       *
       * The alphabet gives about 887 million codes so a collision is rare, and
       * "rare" is exactly the failure mode that shows up in production and never
       * in testing. The unique index is what actually guarantees it; this loop is
       * what turns the guarantee into a code rather than a 500.
       */
      for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
        const candidate = makeReferralCode(() => randomInt(0, 1_000_000) / 1_000_000);
        const taken = await store.promos.findReferrer(candidate);
        if (!taken) {
          const saved = await store.accounts.updateProfile(account.email, {
            referralCode: candidate,
          });
          code = saved?.referralCode ?? candidate;
        }
      }
    }

    if (!code) {
      res.status(503).json({ error: 'Could not issue a referral code just now. Try again.' });
      return;
    }

    const invited = await store.accounts.referredBy(account.email);

    res.json({
      code,
      reward: REFERRAL_REWARD,
      welcome: REFERRAL_WELCOME,
      invited: invited.length,
      // Only the ones whose reward has actually been paid, so the customer's
      // count and their wallet agree.
      rewarded: invited.filter((row) => !!row.referralRewardedAt).length,
    });
  })
);

/**
 * Claims a referral code, on the newcomer's own account.
 *
 * Separate from registration rather than a field on it, because the two fail
 * differently: a mistyped referral code must not stop somebody creating an
 * account, and a customer who is told about the scheme after signing up should
 * still be able to use it.
 *
 * Nothing is paid here. The reward is earned when the newcomer's first order
 * completes — see `settleReferral` — because rewarding a registration rewards
 * making accounts, and somebody would.
 */
promotionsRouter.post(
  '/referral/claim',
  guard(async (req, res) => {
    const account = await accountForToken(bearerToken(req));
    if (!account) {
      res.status(401).json({ error: 'Sign in to use a referral code.' });
      return;
    }

    const code = normalisePromoCode((req.body ?? {}).code ?? '');
    if (!isReferralCodeShaped(code)) {
      res.status(400).json({ error: 'That is not a referral code.', reason: 'unknown-code' });
      return;
    }

    const referrerEmail = await store.promos.findReferrer(code);

    const verdict = canClaimReferral({
      email: account.email,
      referrerEmail,
      existingReferrer: account.referredBy,
    });

    if (!verdict.ok) {
      res.status(409).json({
        error:
          verdict.reason === 'self-referral'
            ? 'That is your own code.'
            : verdict.reason === 'already-referred'
              ? 'Your account already has a referral on it.'
              : 'That code does not belong to anybody.',
        reason: verdict.reason,
      });
      return;
    }

    const saved = await store.accounts.updateProfile(account.email, {
      referredBy: referrerEmail!,
    });

    res.json({
      ok: true,
      referredBy: saved?.referredBy,
      welcome: REFERRAL_WELCOME,
    });
  })
);


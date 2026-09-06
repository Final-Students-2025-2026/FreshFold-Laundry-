/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Promo codes and referrals — everything aimed at somebody who is not a
 * customer yet.
 *
 * `./loyalty` rewards spending and `./membership` rewards subscribing. Both are
 * retention: they give something to a person who is already here. There was
 * nothing at all on the other side of that line, which for a laundry whose
 * market is a university campus is the odd half to be missing — the channel that
 * actually works in a hall of residence is one student telling another.
 *
 * The rules live here rather than in the route for the reason the reschedule
 * policy does: three surfaces ask the same question and must get the same
 * answer. The booking forms need to show a customer what a code is worth before
 * they commit to it, and the server has to decide what it is actually worth —
 * and a form that promises 20% off where the server gives 20% capped at ₵15 is a
 * form that lies for the length of one checkout.
 *
 * Nothing here touches a database. Usage counts arrive as numbers the caller has
 * already looked up, which is what keeps this runnable in a browser and in Metro.
 */

import { roundCedis } from './membership';
import type { PromoCode } from './types';

// ---------------------------------------------------------------------------
// Applying a code
// ---------------------------------------------------------------------------

/** Why a code was not applied. */
export type PromoRefusal =
  | 'unknown'
  | 'withdrawn'
  | 'not-started'
  | 'expired'
  | 'exhausted'
  | 'already-used'
  | 'first-order-only'
  | 'below-minimum';

export interface PromoRefused {
  ok: false;
  reason: PromoRefusal;
  /** A sentence for the customer. The server sends this back verbatim. */
  message: string;
}

export interface PromoAccepted {
  ok: true;
  code: string;
  /** What it takes off this bill, in cedis, after the cap. */
  discount: number;
  /** How it reads on the summary line: "20% off", "₵15 off". */
  label: string;
}

export type PromoCheck = PromoAccepted | PromoRefused;

/** What the caller has already looked up about this code and this customer. */
export interface PromoUsage {
  /** Redemptions across everybody. */
  total: number;
  /** Redemptions by this customer. */
  byCustomer: number;
  /** Whether this is the customer's first order. */
  firstOrder: boolean;
}

function refuse(reason: PromoRefusal, message: string): PromoRefused {
  return { ok: false, reason, message };
}

/**
 * Normalises a code the way the store does, so a lookup cannot miss on case.
 *
 * Customers do not think of a code as case-sensitive and will not type it that
 * way — `freshers24` on a phone keyboard that auto-lowercases is the normal
 * case, not the exceptional one. Trimmed too: a code pasted out of a WhatsApp
 * message arrives with a space on it about half the time.
 */
export function normalisePromoCode(code: string): string {
  return (code ?? '').trim().toUpperCase();
}

/**
 * What this code is worth on this bill, or why it is worth nothing.
 *
 * `subtotal` is what the customer owes *after* every other reduction — the
 * membership's waived pickup, the member rate and the loyalty tier. A promo code
 * is the last thing applied, which is the only ordering that cannot produce a
 * negative bill: applying it to the gross and then taking a tier discount off
 * the result would let two reductions compound past what the booking is worth.
 */
export function checkPromo(
  promo: PromoCode | null | undefined,
  subtotal: number,
  usage: PromoUsage,
  now: Date = new Date()
): PromoCheck {
  if (!promo) {
    return refuse('unknown', 'That code is not one of ours. Check the spelling and try again.');
  }

  if (!promo.active) {
    return refuse('withdrawn', 'That code is no longer being accepted.');
  }

  const at = now.getTime();

  if (promo.startsAt && Date.parse(promo.startsAt) > at) {
    return refuse('not-started', 'That code is not live yet.');
  }

  if (promo.expiresAt && Date.parse(promo.expiresAt) <= at) {
    return refuse('expired', 'That code has expired.');
  }

  if (promo.maxUses !== undefined && usage.total >= promo.maxUses) {
    return refuse('exhausted', 'That code has been fully claimed.');
  }

  if (usage.byCustomer >= promo.maxPerCustomer) {
    return refuse(
      'already-used',
      promo.maxPerCustomer === 1
        ? 'You have already used that code.'
        : `You have used that code ${usage.byCustomer} times, which is the limit.`
    );
  }

  if (promo.firstOrderOnly && !usage.firstOrder) {
    return refuse('first-order-only', 'That code is for a first order only.');
  }

  /**
   * The minimum is checked against the bill as it stands after everything else.
   *
   * Which is the strict reading, and the right one: a member whose plan has
   * already waived most of the order is not spending ₵50, whatever the gross
   * says, and a "₵10 off orders over ₵50" code that fired on a ₵4 bill would be
   * the campaign losing money on exactly the customers it was not aimed at.
   */
  if (subtotal < promo.minSpend) {
    return refuse(
      'below-minimum',
      `That code applies to orders of ₵${promo.minSpend.toFixed(2)} or more.`
    );
  }

  const raw = promo.kind === 'percent' ? subtotal * promo.value : promo.value;

  const capped =
    promo.kind === 'percent' && promo.maxDiscount !== undefined
      ? Math.min(raw, promo.maxDiscount)
      : raw;

  // Never more than the bill. A ₵20 code on a ₵12 order takes ₵12 off, not ₵20 —
  // the difference is not change owed to the customer.
  const discount = roundCedis(Math.max(0, Math.min(capped, subtotal)));

  return { ok: true, code: promo.code, discount, label: promoLabel(promo) };
}

/** "20% off", "₵15 off" — how a code reads on a summary line. */
export function promoLabel(promo: PromoCode): string {
  return promo.kind === 'percent'
    ? `${Math.round(promo.value * 100)}% off`
    : `₵${promo.value.toFixed(2)} off`;
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

/**
 * What the person doing the referring gets, in cedis, credited to their wallet.
 *
 * Paid when the person they introduced has an order *completed*, not when that
 * person registers. Rewarding a registration rewards making accounts, and
 * somebody will: the referrer would need only an email address and a few
 * minutes. Tying it to a delivered order ties it to money actually taken.
 */
export const REFERRAL_REWARD = 15;

/** What the newcomer gets off their first order. */
export const REFERRAL_WELCOME = 15;

/**
 * The characters a referral code is built from.
 *
 * No `0`, `O`, `1`, `I` or `L`. A referral code is read aloud across a room and
 * typed off a screenshot, and those five are the pairs that get confused doing
 * exactly that. The alphabet is the cheapest place to fix a support burden.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const REFERRAL_CODE_LENGTH = 6;

/**
 * A referral code, from a source of randomness the caller supplies.
 *
 * The randomness is injected rather than taken from `Math.random` or from
 * `node:crypto`, for two different reasons at once: this module runs in three
 * runtimes with three different crypto APIs, and a code generator that cannot be
 * driven deterministically cannot be exercised by the check suite.
 *
 * Uniqueness is the database's job — see the unique index on
 * `accounts.referral_code`. With this alphabet and this length there are about
 * 887 million codes, so a collision is a retry rather than a design problem.
 */
export function makeReferralCode(random: () => number = Math.random): string {
  let out = '';
  for (let n = 0; n < REFERRAL_CODE_LENGTH; n += 1) {
    const index = Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length;
    out += CODE_ALPHABET[index];
  }
  return out;
}

/** Whether a string could be one of ours, before going to the database. */
export function isReferralCodeShaped(code: string): boolean {
  const value = normalisePromoCode(code);
  if (value.length !== REFERRAL_CODE_LENGTH) return false;
  return [...value].every((character) => CODE_ALPHABET.includes(character));
}

/**
 * Whether this customer may claim this referrer.
 *
 * Three refusals, and the middle one is the one that matters: a customer cannot
 * be referred by themselves. It is the first thing anybody tries, it costs the
 * laundry `REFERRAL_REWARD + REFERRAL_WELCOME` every time it works, and it is
 * one string comparison to stop.
 */
export function canClaimReferral(input: {
  /** The newcomer's address. */
  email: string;
  /** The address behind the code they typed, or null if it matched nothing. */
  referrerEmail: string | null;
  /** Who this account was already referred by, if anybody. */
  existingReferrer?: string;
}): { ok: boolean; reason?: 'unknown-code' | 'self-referral' | 'already-referred' } {
  if (!input.referrerEmail) return { ok: false, reason: 'unknown-code' };

  if (input.referrerEmail.toLowerCase() === input.email.toLowerCase()) {
    return { ok: false, reason: 'self-referral' };
  }

  // Set once and never rewritten, which is what stops a customer collecting a
  // second welcome by claiming a second referrer.
  if (input.existingReferrer) return { ok: false, reason: 'already-referred' };

  return { ok: true };
}

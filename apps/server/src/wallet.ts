/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  loyaltyReward,
  pointsForSpend,
  roundCedis,
  type LoyaltyReward,
  type PaymentTransaction,
} from '@freshfold/core';
import { settleAccount } from './membership';
import { store, type Repositories, type StoredAccount } from './store';

/**
 * The wallet and the points balance, server-side.
 *
 * Both apps used to do this arithmetic themselves and PUT the result: the app's
 * `chargeWallet` subtracted locally and posted an absolute `walletBalance`, and
 * the website did the same from a number that started life as a hardcoded ₵150.
 * Two consequences, both of which customers could see. A balance written
 * absolutely clobbers whatever the server computed in between — a membership
 * renewal debited on one device was erased by a top-up on the other. And points
 * were awarded by whichever client happened to run the code, so the website
 * awarded none at all while the app awarded one per cedi.
 *
 * Every movement now happens here, on a locked account row, with its ledger
 * entry written in the same transaction. The clients propose an amount; this
 * decides what the balance and the points become.
 */

export type WalletOutcome =
  | { ok: true; account: StoredAccount; transaction: PaymentTransaction | null }
  | {
      ok: false;
      reason: 'no-account' | 'bad-amount' | 'insufficient-funds' | 'unknown-reward' | 'insufficient-points';
      shortfall?: number;
      account?: StoredAccount;
    };

function accountSlug(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * A movement that has already been recorded is not applied again.
 *
 * Returns the account untouched when this reference is already in the ledger.
 * Both clients queue writes while offline and replay them on reconnect, so the
 * same top-up can arrive twice; without this the second one would be a second
 * credit.
 */
async function alreadyApplied(
  t: Repositories,
  reference: string
): Promise<PaymentTransaction | null> {
  return t.transactions.findByReference(reference);
}

function isPositiveAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
}

/**
 * Runs `apply` against the caller's account, settled and locked.
 *
 * Settling first matters: a renewal that fell due while the app was closed is
 * charged before we decide whether the wallet can cover what is being asked of
 * it now. Otherwise a customer could spend the same cedi twice by getting in
 * ahead of their own renewal.
 */
async function onAccount(
  email: string,
  apply: (t: Repositories, account: StoredAccount) => Promise<WalletOutcome>
): Promise<WalletOutcome> {
  return store.tx(async (t) => {
    const found = await t.accounts.find(email, { lock: true });
    if (!found) return { ok: false, reason: 'no-account' } as const;

    const account = await settleAccount(t, found);
    return apply(t, account);
  });
}

/**
 * Adds money to the wallet.
 *
 * No points: points are earned on laundry, not on funding an account. The
 * Paystack path calls this after a verified payment, and the reference it
 * passes is Paystack's own, so a verify replayed from two tabs credits once.
 */
export async function topUp(input: {
  email: string;
  amount: number;
  method: string;
  reference?: string;
}): Promise<WalletOutcome> {
  if (!isPositiveAmount(input.amount)) return { ok: false, reason: 'bad-amount' };

  const amount = roundCedis(input.amount);
  const reference =
    input.reference?.trim() ||
    `TXN-TOPUP-${accountSlug(input.email)}-${Date.now()}`;

  return onAccount(input.email, async (t, account) => {
    const existing = await alreadyApplied(t, reference);
    if (existing) return { ok: true, account, transaction: existing } as const;

    const balance = roundCedis((account.walletBalance ?? 0) + amount);
    const saved = await t.accounts.updateProfile(account.email, { walletBalance: balance });

    const transaction = await t.transactions.upsert({
      id: `txn-topup-${accountSlug(account.email)}-${Date.now()}`,
      userEmail: account.email,
      amount,
      method: input.method || 'Wallet',
      status: 'Successful',
      reference,
      timestamp: new Date().toISOString(),
      description: `Wallet top-up via ${input.method || 'Wallet'}`,
    });

    return { ok: true, account: saved ?? account, transaction } as const;
  });
}

/**
 * Returns money for work that was paid for and will not be done.
 *
 * To the wallet, always — which is what the cancel dialog has been promising all
 * along: "anything already paid is refunded to your wallet by the concierge
 * desk." Not back down the rail it arrived on: a Paystack refund is a separate
 * API with its own settlement delay and its own failure modes, and a customer
 * owed ₵105 for a pickup that never happened is better served by a balance they
 * can spend today than by a card refund landing in five working days. A customer
 * who wants it off the platform entirely is a conversation with the desk, and
 * the ledger row this writes is what that conversation is held against.
 *
 * The mirror image of {@link charge}, with one asymmetry that is deliberate:
 * **the points earned on the original spend are not clawed back.** They were
 * earned on a booking the customer made in good faith, the tier they bought is
 * already being enjoyed, and reversing them could demote somebody mid-order for
 * a cancellation the laundry may itself have caused. The money comes back; the
 * standing does not move.
 *
 * `reference` is what makes it idempotent, and the caller passes the booking's —
 * so a desk that clicks twice, or two supervisors acting on the same complaint,
 * refunds once.
 */
export async function refund(input: {
  email: string;
  amount: number;
  description: string;
  bookingId?: string;
  reference: string;
}): Promise<WalletOutcome> {
  if (!isPositiveAmount(input.amount)) return { ok: false, reason: 'bad-amount' };

  const amount = roundCedis(input.amount);

  return onAccount(input.email, async (t, account) => {
    const existing = await alreadyApplied(t, input.reference);
    if (existing) return { ok: true, account, transaction: existing } as const;

    const balance = roundCedis((account.walletBalance ?? 0) + amount);
    const saved = await t.accounts.updateProfile(account.email, { walletBalance: balance });

    const transaction = await t.transactions.upsert({
      id: `txn-refund-${accountSlug(account.email)}-${Date.now()}`,
      bookingId: input.bookingId,
      userEmail: account.email,
      amount,
      method: 'Refund',
      status: 'Successful',
      reference: input.reference,
      timestamp: new Date().toISOString(),
      description: input.description || 'FreshFold refund',
    });

    return { ok: true, account: saved ?? account, transaction } as const;
  });
}

/**
 * Spends from the wallet, and earns the points that spend is worth.
 *
 * One point per whole cedi, by `pointsForSpend` — the rule the Bronze tier's
 * own copy states. This is the only path that grants them, which is what stops
 * the two apps from disagreeing about a customer's tier.
 */
export async function charge(input: {
  email: string;
  amount: number;
  description: string;
  bookingId?: string;
  reference?: string;
}): Promise<WalletOutcome> {
  if (!isPositiveAmount(input.amount)) return { ok: false, reason: 'bad-amount' };

  const amount = roundCedis(input.amount);
  const reference =
    input.reference?.trim() || `TXN-${accountSlug(input.email)}-${Date.now()}`;

  return onAccount(input.email, async (t, account) => {
    const existing = await alreadyApplied(t, reference);
    if (existing) return { ok: true, account, transaction: existing } as const;

    const balance = account.walletBalance ?? 0;
    if (balance < amount) {
      return {
        ok: false,
        reason: 'insufficient-funds',
        shortfall: roundCedis(amount - balance),
        account,
      } as const;
    }

    const saved = await t.accounts.updateProfile(account.email, {
      walletBalance: roundCedis(balance - amount),
      points: (account.points ?? 0) + pointsForSpend(amount),
    });

    const transaction = await t.transactions.upsert({
      id: `txn-${accountSlug(account.email)}-${Date.now()}`,
      bookingId: input.bookingId,
      userEmail: account.email,
      amount,
      method: 'Wallet',
      status: 'Successful',
      reference,
      timestamp: new Date().toISOString(),
      description: input.description || 'FreshFold order',
    });

    return { ok: true, account: saved ?? account, transaction } as const;
  });
}

/**
 * Spends points on a reward.
 *
 * The website's reward buttons checked the balance, showed "Successfully
 * redeemed" and deducted nothing — a customer could redeem the same 1000-point
 * voucher indefinitely, and the ₵50 one added money to a number in a React
 * state hook that no other surface could see. Here the points come off and, for
 * the reward that pays out, the credit and its ledger entry go on, together.
 */
export async function redeem(input: {
  email: string;
  rewardId: string;
  reference?: string;
}): Promise<WalletOutcome> {
  const reward: LoyaltyReward | null = loyaltyReward(input.rewardId);
  if (!reward) return { ok: false, reason: 'unknown-reward' };

  const reference =
    input.reference?.trim() ||
    `TXN-REWARD-${accountSlug(input.email)}-${reward.id}-${Date.now()}`;

  return onAccount(input.email, async (t, account) => {
    const existing = await alreadyApplied(t, reference);
    if (existing) return { ok: true, account, transaction: existing } as const;

    const points = account.points ?? 0;
    if (points < reward.cost) {
      return {
        ok: false,
        reason: 'insufficient-points',
        shortfall: reward.cost - points,
        account,
      } as const;
    }

    const credit = reward.walletCredit ?? 0;
    const balance = roundCedis((account.walletBalance ?? 0) + credit);

    const saved = await t.accounts.updateProfile(account.email, {
      points: points - reward.cost,
      ...(credit > 0 ? { walletBalance: balance } : {}),
    });

    // Written even for a voucher, which moves no money. The row is what makes
    // the redemption idempotent — `alreadyApplied` has nothing else to find —
    // and it is also the only record the customer has that they spent those
    // points, which a statement that only tracked cedis would lose.
    const transaction = await t.transactions.upsert({
      id: `txn-reward-${accountSlug(account.email)}-${Date.now()}`,
      userEmail: account.email,
      amount: credit,
      method: 'Care Points',
      status: 'Successful',
      reference,
      timestamp: new Date().toISOString(),
      description: `Redeemed ${reward.cost} care points — ${reward.name}`,
    });

    return { ok: true, account: saved ?? account, transaction } as const;
  });
}

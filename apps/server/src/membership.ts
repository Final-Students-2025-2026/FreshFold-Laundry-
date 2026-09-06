/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  consumePickup,
  membershipPlan,
  membershipSwitchQuote,
  roundCedis,
  settleMembership,
  startMembership,
  type ActivePlan,
  type MembershipCharge,
  type MembershipPlan,
  type PaymentTransaction,
} from '@freshfold/core';
import { store, type Repositories, type StoredAccount } from './store';

/**
 * The membership lifecycle, server-side.
 *
 * Everything that moves money and the plan together lives here, and everything
 * here runs inside a transaction on a locked account row. That is the whole
 * point: the wallet debit, the ledger entry and the entitlement are one write
 * or they are none.
 *
 * The arithmetic itself is in `@freshfold/core` so the customer app can show
 * the same numbers before the customer commits to them. What the app cannot do
 * is *apply* them — it proposes a plan id, and this decides what that costs.
 */

/** The account, flattened into something safe to build an id out of. */
function accountSlug(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * A ledger reference that is the same every time for the same period.
 *
 * Deterministic on purpose: `transactions.upsert` matches on the reference, so
 * a renewal settled twice — two devices polling `/auth/me` at once, say —
 * writes one row rather than billing the customer's statement twice for one
 * debit. The account is part of it because the reference is unique across the
 * whole ledger, not per person.
 */
function membershipReference(email: string, plan: ActivePlan['planId'], periodStart: string): string {
  return `TXN-MEMB-${accountSlug(email)}-${plan}-${Date.parse(periodStart)}`;
}

function membershipTransaction(input: {
  email: string;
  amount: number;
  planId: ActivePlan['planId'];
  periodStart: string;
  description: string;
}): PaymentTransaction {
  return {
    // `id` is the primary key while `reference` carries the unique index, so
    // it has to be per-account too: two customers renewing the same plan in the
    // same millisecond would otherwise collide on the key and fail the write
    // that was taking one of their payments.
    id: `txn-memb-${accountSlug(input.email)}-${input.planId}-${Date.parse(input.periodStart)}`,
    userEmail: input.email,
    amount: input.amount,
    method: 'Wallet',
    status: 'Successful',
    reference: membershipReference(input.email, input.planId, input.periodStart),
    timestamp: new Date().toISOString(),
    description: input.description,
  };
}

async function recordCharges(
  t: Repositories,
  email: string,
  charges: MembershipCharge[]
): Promise<void> {
  for (const charge of charges) {
    const plan = membershipPlan(charge.planId);
    await t.transactions.upsert(
      membershipTransaction({
        email,
        amount: charge.amount,
        planId: charge.planId,
        periodStart: charge.periodStart,
        description: `Membership renewal — ${plan?.name ?? charge.planId}`,
      })
    );
  }
}

/**
 * Brings an account's membership up to date, persisting whatever that cost.
 *
 * Called on every path that reads an account for a client, which is what makes
 * lazy renewal work: there is no scheduler here, so "the plan renewed" happens
 * the next time anybody looks. A plan whose wallet cannot cover the next month
 * lapses instead of renewing, and the customer keeps every period they paid
 * for.
 *
 * Returns the account unchanged — no write at all — when nothing was due, which
 * is the overwhelmingly common case.
 */
export async function settleAccount(
  t: Repositories,
  account: StoredAccount,
  now: Date = new Date()
): Promise<StoredAccount> {
  if (!account.plan) return account;

  const settlement = settleMembership(account.plan, account.walletBalance ?? 0, now);
  const unchanged =
    settlement.charges.length === 0 &&
    settlement.lapsed === null &&
    settlement.plan === account.plan;

  if (unchanged) return account;

  await recordCharges(t, account.email, settlement.charges);

  const saved = await t.accounts.setPlan(
    account.email,
    settlement.plan,
    settlement.charges.length > 0 ? settlement.balance : undefined
  );

  if (settlement.lapsed) {
    await t.notifications.insert({
      // Per account and per period: the insert is `on conflict do nothing`, so
      // a shared id would silently swallow one customer's notice because
      // another's landed in the same millisecond.
      id: `notif-memb-${accountSlug(account.email)}-${Date.parse(account.plan.renewsOn)}`,
      title: 'Membership ended',
      body:
        settlement.lapsed === 'insufficient-funds'
          ? `${account.name || account.email} — not enough wallet balance to renew the membership.`
          : `${account.name || account.email}'s membership reached the end of its paid period.`,
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'system',
      read: false,
    });
  }

  return saved ?? account;
}

/** `settleAccount` on its own transaction, for callers not already in one. */
export async function settleAccountByEmail(
  email: string,
  now: Date = new Date()
): Promise<StoredAccount | null> {
  return store.tx(async (t) => {
    const account = await t.accounts.find(email, { lock: true });
    if (!account) return null;
    return settleAccount(t, account, now);
  });
}

export type SubscribeOutcome =
  | { ok: true; account: StoredAccount; charged: number; credit: number }
  | { ok: false; reason: 'no-account' | 'unknown-plan' | 'already-active' | 'insufficient-funds'; shortfall?: number; account?: StoredAccount };

/**
 * Starts or switches a membership.
 *
 * One debit, for the prorated amount — the app charged the wallet *and* wrote a
 * second membership transaction of its own, so every subscription appeared in
 * the customer's history twice for a single deduction.
 *
 * No loyalty points are awarded. `chargeWallet` in the app granted a point per
 * cedi on any debit, which handed a Corporate subscriber 499 points — most of
 * the way to a discount tier — for buying a plan rather than for buying
 * laundry. Points are earned on laundry.
 */
export async function subscribe(
  email: string,
  planId: string,
  now: Date = new Date()
): Promise<SubscribeOutcome> {
  const definition: MembershipPlan | null = membershipPlan(planId);
  if (!definition) return { ok: false, reason: 'unknown-plan' };

  return store.tx(async (t) => {
    const found = await t.accounts.find(email, { lock: true });
    if (!found) return { ok: false, reason: 'no-account' } as const;

    // Settle first: an overdue renewal is charged, or the plan has lapsed,
    // before we work out what a switch is worth.
    const account = await settleAccount(t, found, now);

    if (account.plan?.planId === definition.id && !account.plan.cancelAtPeriodEnd) {
      return { ok: false, reason: 'already-active', account } as const;
    }

    const quote = membershipSwitchQuote(account.plan, definition, now);
    const balance = account.walletBalance ?? 0;

    if (balance < quote.due) {
      return {
        ok: false,
        reason: 'insufficient-funds',
        shortfall: roundCedis(quote.due - balance),
        account,
      } as const;
    }

    const plan = startMembership(definition, now);
    const saved = await t.accounts.setPlan(account.email, plan, roundCedis(balance - quote.due));

    await t.transactions.upsert(
      membershipTransaction({
        email: account.email,
        amount: quote.due,
        planId: plan.planId,
        periodStart: plan.periodStart,
        description: quote.credit
          ? `Membership — ${definition.name} (₵${quote.credit.toFixed(2)} credit from previous plan)`
          : `Membership — ${definition.name}`,
      })
    );

    return {
      ok: true,
      account: saved ?? account,
      charged: quote.due,
      credit: quote.credit,
    } as const;
  });
}

export type CancelOutcome =
  | { ok: true; account: StoredAccount; activeUntil: string }
  | { ok: false; reason: 'no-account' | 'no-plan' };

/**
 * Cancels at the end of the period already paid for.
 *
 * The plans screen has always said "you keep the month you have paid for",
 * while the button dropped the plan on the spot — no refund, and priority gone
 * the same second. The copy was the honest half, so this implements it: the
 * membership runs to `renewsOn` and is not renewed. `settleMembership` is what
 * finally removes it.
 */
export async function cancel(email: string, now: Date = new Date()): Promise<CancelOutcome> {
  return store.tx(async (t) => {
    const found = await t.accounts.find(email, { lock: true });
    if (!found) return { ok: false, reason: 'no-account' } as const;

    const account = await settleAccount(t, found, now);
    if (!account.plan) return { ok: false, reason: 'no-plan' } as const;

    const saved = await t.accounts.setPlan(account.email, {
      ...account.plan,
      cancelAtPeriodEnd: true,
    });

    return {
      ok: true,
      account: saved ?? account,
      activeUntil: account.plan.renewsOn,
    } as const;
  });
}

/** Undoes a pending cancellation while the period is still running. */
export async function resume(email: string, now: Date = new Date()): Promise<CancelOutcome> {
  return store.tx(async (t) => {
    const found = await t.accounts.find(email, { lock: true });
    if (!found) return { ok: false, reason: 'no-account' } as const;

    const account = await settleAccount(t, found, now);
    if (!account.plan) return { ok: false, reason: 'no-plan' } as const;

    const saved = await t.accounts.setPlan(account.email, {
      ...account.plan,
      cancelAtPeriodEnd: false,
    });

    return { ok: true, account: saved ?? account, activeUntil: account.plan.renewsOn } as const;
  });
}

/**
 * Spends one included pickup, if the plan has any left.
 *
 * Called when a booking is created under a membership. Without it the "2
 * pickups per month", "8 pickups/month" bullets were decoration: nothing
 * anywhere counted a booking against a plan.
 */
export async function consumeIncludedPickup(
  t: Repositories,
  account: StoredAccount
): Promise<StoredAccount> {
  if (!account.plan) return account;

  const next = consumePickup(account.plan);
  if (next === account.plan || next.pickupsUsed === account.plan.pickupsUsed) return account;

  const saved = await t.accounts.setPlan(account.email, next);
  return saved ?? account;
}

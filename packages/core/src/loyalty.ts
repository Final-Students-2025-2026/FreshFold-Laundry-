/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Care points, tiers and what they buy.
 *
 * There used to be two of these: a table in the website's client portal
 * (Silver at 400 points, 15% off at Gold) and another in the customer app's
 * catalogue (Silver at 500, 20% at Gold). The same customer was Gold on one
 * surface and Silver on the other, which is not a rounding difference — it is
 * two different products. This is the one table.
 *
 * Presentation is deliberately absent. A tier here is a name, a threshold and a
 * discount; the website renders it with Tailwind class names and the app with
 * hex gradients, and neither of those means anything to the other.
 *
 * ---
 *
 * **Every line below has to be something the shop can be held to.**
 *
 * This table is read by the marketing landing (`Membership.tsx` renders
 * `cardName` and `benefits`), the client portal (`tier.description`) and the
 * customer app's wallet screen. It is copy, and it is the only copy that ships
 * from `@freshfold/core` rather than from a component — which is exactly how it
 * survived the landing page's rewrite untouched.
 *
 * What was here claimed a "Certified Master Artisan", "24/7 custom scheduling
 * lockers" and a "Dedicated Customer Care VIP line". There is no such
 * certification, there are no lockers, and there is one phone number. The
 * descriptions ran on "our entry-level sanctuary code" and "the ultimate
 * bespoke fabric hospitality" — borrowed luxury vocabulary for a shop charging
 * ₵30 a load, and the precise register `PRODUCT.md` names as an anti-reference.
 *
 * The rule those violations broke, restated so the next edit keeps it: **a
 * benefit on this table has to resolve to something in this package.** The
 * discount is `discountRate` and is applied by `quoteBooking`. Free collection
 * is the `pickup-delivery` service at ₵0 in `./services`. The point rate is
 * `pointsForSpend`, one per whole cedi. A line that cannot be traced to one of
 * those is a claim the shop cannot substantiate, and it comes off.
 */

export type LoyaltyTierId = 'basic' | 'silver' | 'gold';

export interface LoyaltyTier {
  id: LoyaltyTierId;
  /** The tier, as a customer would say it at the counter: "Silver". */
  name: string;
  /** The line printed on the membership card artwork. */
  cardName: string;
  description: string;
  /** Lifetime points at which this tier starts. */
  minPoints: number;
  /** Fraction off every quote, e.g. `0.10` for 10%. */
  discountRate: number;
  benefits: string[];
}

/** Ascending by `minPoints`. `tierForPoints` relies on that ordering. */
export const LOYALTY_TIERS: LoyaltyTier[] = [
  {
    id: 'basic',
    name: 'Bronze',
    cardName: 'FRESHFOLD BRONZE',
    description: 'Where every account starts. 1 point for every ₵1 you spend.',
    minPoints: 0,
    discountRate: 0,
    benefits: [
      'Free pickup and delivery on every order',
      'Follow your courier on the map, both ways',
      'Every order you have placed, kept in the app',
    ],
  },
  {
    id: 'silver',
    name: 'Silver',
    cardName: 'FRESHFOLD SILVER',
    description: '10% off every order, once you have earned 500 points.',
    minPoints: 500,
    discountRate: 0.1,
    benefits: [
      '10% off every quote, taken off automatically',
      'Everything Bronze gets, at the lower price',
      '500 points is about ₵500 of laundry',
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    cardName: 'FRESHFOLD GOLD',
    description: '20% off every order, once you have earned 1,500 points.',
    minPoints: 1500,
    discountRate: 0.2,
    benefits: [
      '20% off every quote, taken off automatically',
      'Everything Bronze and Silver get, at the lowest price',
      '1,500 points is about ₵1,500 of laundry',
    ],
  },
];

/** The highest tier the given lifetime points qualify for. Never null. */
export function tierForPoints(points: number): LoyaltyTier {
  const earned = points > 0 ? points : 0;
  return (
    [...LOYALTY_TIERS].reverse().find((tier) => earned >= tier.minPoints) ?? LOYALTY_TIERS[0]
  );
}

/** The next tier up, or `null` at the top. */
export function nextTierAfter(tier: LoyaltyTier): LoyaltyTier | null {
  const index = LOYALTY_TIERS.findIndex((candidate) => candidate.id === tier.id);
  return LOYALTY_TIERS[index + 1] ?? null;
}

export interface TierProgress {
  tier: LoyaltyTier;
  /** `null` once the customer is at the top tier. */
  next: LoyaltyTier | null;
  /** Points still to earn before `next` starts. Zero at the top. */
  pointsToNext: number;
  /** 0–100 across the current tier's band. 100 at the top. */
  percent: number;
}

/**
 * How far through the current tier a balance sits.
 *
 * Both surfaces drew this bar, and both worked it out themselves — the app from
 * the tier band, the website not at all. One answer here means the progress bar
 * and the "N points to Silver" caption can never disagree.
 */
export function tierProgress(points: number): TierProgress {
  const tier = tierForPoints(points);
  const next = nextTierAfter(tier);

  if (!next) return { tier, next: null, pointsToNext: 0, percent: 100 };

  const band = next.minPoints - tier.minPoints;
  const into = Math.max(0, points - tier.minPoints);

  return {
    tier,
    next,
    pointsToNext: Math.max(0, next.minPoints - points),
    percent: band > 0 ? Math.min(100, (into / band) * 100) : 100,
  };
}

/**
 * Points earned by spending `amount` on laundry: one per whole cedi.
 *
 * Memberships do not earn — see the note on `subscribe` in the server's
 * membership module. This is the rule the Bronze tier's own copy states, and it
 * is applied server-side so neither client can mint points by asking.
 */
export function pointsForSpend(amount: number): number {
  return Math.max(0, Math.floor(amount));
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export type LoyaltyRewardId = 'scent-spray' | 'express-dispatch' | 'wallet-credit-50';

export interface LoyaltyReward {
  id: LoyaltyRewardId;
  name: string;
  description: string;
  /** Points deducted on redemption. */
  cost: number;
  /**
   * Cedis added to the wallet when this is redeemed, if any.
   *
   * The two voucher rewards settle off-ledger — a courier waives the surcharge,
   * a hub adds the fragrance — so they move points and nothing else. The wallet
   * credit is the one that moves money, and it is the reason redemption is a
   * server call rather than a button that sets a success message.
   */
  walletCredit?: number;
}

/**
 * Same rule as the tiers above: each of these has to name something real.
 *
 * The scent reward advertised "French Lavender or Cedarwood", neither of which
 * `SCENTS` in `./pricing` has ever offered, and the express reward waived a
 * surcharge without saying what it was worth. Both now quote the figure the
 * customer would otherwise pay — ₵5 for a scent, ₵50 for the same-day service
 * in `./services` — which is checkable against the booking form.
 */
export const LOYALTY_REWARDS: LoyaltyReward[] = [
  {
    id: 'scent-spray',
    name: 'Free scent upgrade',
    description: 'Organic Lavender or Eucalyptus & Tea-Tree, normally ₵5, on your next order.',
    cost: 300,
  },
  {
    id: 'express-dispatch',
    name: 'Free express same-day',
    description: 'Waives the ₵50 express same-day charge once.',
    cost: 500,
  },
  {
    id: 'wallet-credit-50',
    name: '₵50 wallet credit',
    description: 'Adds ₵50 straight to your FreshFold wallet.',
    cost: 1000,
    walletCredit: 50,
  },
];

export function loyaltyReward(id: string | undefined | null): LoyaltyReward | null {
  if (!id) return null;
  return LOYALTY_REWARDS.find((reward) => reward.id === id) ?? null;
}

import { useState } from 'react';
import { LOYALTY_TIERS } from '../data';
import { LoyaltyTier } from '../types';
import Reveal from './ui/Reveal';

interface MembershipProps {
  onOpenBooking: () => void;
}

/**
 * How each tier is dressed. Everything else about it — the name, the threshold,
 * the discount, the perks — is `LOYALTY_TIERS` in `@freshfold/core`, the same
 * table the customer app and the portal read.
 *
 * The tiers are *earned*, at a point per cedi. This section used to price them
 * at ₵79 and ₵149 a month, which is the membership plan's price on a loyalty
 * tier's card: two different things, and only one of them was ever for sale.
 */
const TIER_STYLE: Record<string, { mark: string; accent: string; ring: string; sheen: string }> = {
  basic: {
    mark: 'B',
    accent: 'text-white',
    ring: 'ring-white/25',
    sheen: 'from-white/10',
  },
  silver: {
    mark: 'S',
    accent: 'text-brand-sage-light',
    ring: 'ring-brand-sage-light/60',
    sheen: 'from-brand-sage-light/20',
  },
  gold: {
    mark: 'G',
    accent: 'text-brand-gold',
    ring: 'ring-brand-gold/70',
    sheen: 'from-brand-gold/25',
  },
};

const pointsLabel = (tier: LoyaltyTier) =>
  tier.minPoints === 0 ? 'First order' : `${tier.minPoints.toLocaleString()} points`;

const rateLabel = (tier: LoyaltyTier) =>
  tier.discountRate === 0 ? 'List price' : `${Math.round(tier.discountRate * 100)}% off everything`;

export default function Membership({ onOpenBooking }: MembershipProps) {
  const [selectedTierId, setSelectedTierId] = useState<string>('silver');

  const activeTier =
    LOYALTY_TIERS.find((tier) => tier.id === selectedTierId) ?? LOYALTY_TIERS[0];
  const style = TIER_STYLE[activeTier.id] ?? TIER_STYLE.basic;

  return (
    <section
      id="membership"
      className="border-b border-white/10 bg-brand-charcoal py-20 font-ui sm:py-28"
    >
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <Reveal className="max-w-[52ch]">
          <h2 className="font-display text-section font-medium text-white text-balance">
            The more you send, the less it costs.
          </h2>
          <p className="mt-5 text-lead text-brand-text-muted">
            One point for every cedi you spend. Nothing to buy and nothing to sign up for — the
            card moves up on its own, and the discount comes off every order after it.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-10 lg:grid-cols-12 lg:gap-14" id="loyalty-container">
          {/* The card */}
          <div className="lg:col-span-5">
            <div
              key={activeTier.id}
              className={`panel-swap relative flex aspect-[1.6] w-full max-w-[26rem] flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br from-brand-sage-dark to-brand-charcoal p-6 ring-1 ${style.ring}`}
              id={`digital-laundry-card-${activeTier.id}`}
            >
                {/* The foil. A single soft corner sheen in the tier's own
                    colour — the one decorative gradient on the page, and it is
                    standing in for a physical thing. */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br to-transparent blur-2xl ${style.sheen}`}
                />

                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-label text-white/60">FreshFold card</p>
                    <p className={`mt-1 text-[15px] font-semibold ${style.accent}`}>
                      {activeTier.cardName}
                    </p>
                  </div>
                  <span
                    className={`grid h-10 w-10 place-items-center rounded-md bg-white/10 text-[17px] font-bold ${style.accent} fs-expanded`}
                  >
                    {style.mark}
                  </span>
                </div>

                <div className="relative">
                  <p className="text-[26px] font-semibold leading-none tracking-[-0.03em] text-white sm:text-[30px]">
                    {rateLabel(activeTier)}
                  </p>
                  <div className="mt-5 flex items-end justify-between gap-4 border-t border-white/15 pt-4">
                    <div>
                      <p className="text-label text-white/60">Reached at</p>
                      <p className="mt-0.5 text-[15px] font-medium text-white tnum">
                        {pointsLabel(activeTier)}
                      </p>
                    </div>
                    <p className="text-label text-white/60 tnum">1 point per ₵1</p>
                  </div>
              </div>
            </div>

            <button
              onClick={onOpenBooking}
              className="mt-6 rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
            >
              Book a pickup and start counting
            </button>
          </div>

          {/* The ladder */}
          <div className="lg:col-span-7" id="loyalty-perks-history">
            <ol className="border-t border-white/10">
              {LOYALTY_TIERS.map((tier) => {
                const isActive = tier.id === activeTier.id;
                const tierStyle = TIER_STYLE[tier.id] ?? TIER_STYLE.basic;
                return (
                  <li key={tier.id} className="border-b border-white/10">
                    <button
                      onClick={() => setSelectedTierId(tier.id)}
                      aria-expanded={isActive}
                      className="flex w-full items-baseline gap-4 py-5 text-left"
                    >
                      <span
                        className={`w-28 shrink-0 text-body tnum ${
                          isActive ? 'text-brand-gold' : 'text-brand-text-muted'
                        }`}
                      >
                        {pointsLabel(tier)}
                      </span>
                      <span
                        className={`flex-1 font-display text-[25px] font-medium transition-colors duration-200 ${
                          isActive ? 'text-white' : 'text-white/85'
                        }`}
                      >
                        {tier.name}
                      </span>
                      <span className={`shrink-0 text-[15px] font-medium ${tierStyle.accent}`}>
                        {rateLabel(tier)}
                      </span>
                    </button>

                    {/* The perks, only for the tier being read. Height is not
                        animated — a list of four lines expanding is a layout
                        animation, and it judders on the phones this page is
                        mostly read on. */}
                    {isActive && (
                      <ul className="panel-swap grid gap-2.5 pb-6 sm:grid-cols-2 sm:gap-x-8">
                        {tier.benefits.map((benefit) => (
                          <li key={benefit} className="flex gap-2.5 text-body text-brand-text-light">
                            <span
                              aria-hidden="true"
                              className="mt-[0.62em] h-1 w-1 shrink-0 rounded-full bg-brand-sage-light"
                            />
                            {benefit}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>

            <p className="mt-6 max-w-[62ch] text-body text-brand-text-muted">
              Points are counted on what you actually spend, and they do not expire. You can see the
              running total on your order page at any time.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

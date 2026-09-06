import { MEMBERSHIP_PLANS, type MembershipPlan } from '@freshfold/core';
import { SUBSCRIPTION_PLANS } from '../data';
import { SubscriptionPlan } from '../types';
import Reveal from './ui/Reveal';
import { useIntent } from '../intent';

interface PricingProps {
  onOpenBooking: () => void;
}

/** The saving on paying twelve months up front, as the toggle advertises it. */
const ANNUAL_DISCOUNT = 0.15;

const membershipById = new Map<string, MembershipPlan>(
  MEMBERSHIP_PLANS.map((plan) => [plan.id, plan])
);

/**
 * A plan's bullets, minus the two that already have a row of their own.
 *
 * The first bullet is the included-pickup allowance and the last is the member
 * rate past it; both are rows of the table, so repeating them underneath would
 * be the same fact twice. That ordering is a documented contract in `data.ts`
 * rather than something worked out here — this was briefly a regular expression
 * over the sentences, which is a copy edit away from either dropping a real
 * benefit or printing a duplicate.
 */
function extraBenefits(plan: SubscriptionPlan): string[] {
  return plan.benefits.slice(1, -1);
}

/** The rows of the comparison, in the order a customer asks the questions. */
const SPECS: { label: string; value: (plan: SubscriptionPlan, m: MembershipPlan) => string }[] = [
  { label: 'Pickups included', value: (_plan, m) => `${m.includedPickups} a month` },
  { label: 'Volume covered', value: (plan) => plan.capacity },
  { label: 'Turnaround', value: (plan) => plan.turnaround },
  {
    label: 'Anything past that',
    value: (_plan, m) => `${Math.round(m.overageDiscount * 100)}% off the list price`,
  },
];

export default function Pricing({ onOpenBooking }: PricingProps) {
  /**
   * The billing cycle lives in the shared intent rather than in this component.
   *
   * Not for the booking form's benefit — a plan is arranged at the desk, not in
   * the pickup form — but because it survives the scroll. Someone who flips to
   * yearly has said something about how they intend to pay, and the concierge
   * below is the surface that can act on it.
   */
  const { intent, note } = useIntent();
  const billingCycle = intent.billingCycle;
  const setBillingCycle = (cycle: 'monthly' | 'annual') => note({ billingCycle: cycle });

  /**
   * Choosing a plan records the plan and opens the booking form.
   *
   * It used to pass `plan.name` down the same channel as a service name, and
   * the booking form put it straight into the first line of the order — so the
   * form opened on "Student Plan", a string the service catalogue has never
   * heard of. `serviceBasePrice` returns 0 for it, `serviceTakesQuantity`
   * returns false, and the `<select>` beside it had no such option to show. A
   * plan is not a service; it is remembered as what it is, and the order opens
   * on whatever the visitor actually built.
   */
  const choosePlan = (planName: string) => {
    note({ plan: planName });
    onOpenBooking();
  };

  const monthlyPrice = (plan: SubscriptionPlan) => {
    const base = membershipById.get(plan.id)?.price ?? 0;
    return billingCycle === 'annual' ? Math.round(base * (1 - ANNUAL_DISCOUNT)) : base;
  };

  return (
    <section
      id="subscriptions"
      className="border-b border-white/10 bg-brand-charcoal py-20 font-ui sm:py-28"
    >
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <Reveal className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <h2 className="max-w-[18ch] font-display text-section font-medium text-white text-balance">
              Or put it on a monthly plan.
            </h2>
            <p className="mt-5 max-w-[56ch] text-lead text-brand-text-muted">
              A plan pays for a set number of pickups each month and takes a fixed cut off
              everything past them. Pause it, change it or stop it whenever — there is nothing to
              cancel out of.
            </p>
          </div>

          {/* Billing toggle */}
          <div className="lg:col-span-5 lg:justify-self-end" id="billing-cycle-toggle">
            <div
              className="inline-flex rounded-md border border-white/15 p-1"
              role="group"
              aria-label="Billing cycle"
            >
              {(['monthly', 'annual'] as const).map((cycle) => (
                <button
                  key={cycle}
                  onClick={() => setBillingCycle(cycle)}
                  aria-pressed={billingCycle === cycle}
                  className={`rounded px-4 py-2 text-[14px] font-medium transition-colors duration-200 ${
                    billingCycle === cycle
                      ? 'bg-brand-sage text-white'
                      : 'text-brand-text-muted hover:text-white'
                  }`}
                >
                  {cycle === 'monthly' ? 'Monthly' : 'Yearly — save 15%'}
                </button>
              ))}
            </div>
          </div>
        </Reveal>

        {/*
          Wide screens: one panel, four columns.

          Two things carry the redesign. The whole comparison sits on a single
          raised surface, so it reads as one object the eye can enter rather
          than as loose text ruled onto the page background. And the
          recommendation is a **filled olive column** running the full height of
          it, instead of the 12% tint that was invisible against charcoal — if a
          plan is the one most people take, saying so quietly is a waste of the
          only real recommendation on the page.

          Prices are champagne gold here as everywhere else on the site. Money
          has one colour: the price list uses it, the plan does too. On the
          olive column the price steps up to `gold-light`, which clears 5.4:1
          against that fill where plain gold would sit at 3.4:1.
        */}
        <Reveal className="mt-14 hidden lg:block" id="pricing-grid">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-brand-card">
            <div className="grid grid-cols-[minmax(11rem,0.8fr)_repeat(4,minmax(0,1fr))]">
              {/* Header row */}
              <div className="border-b border-white/10" />
              {SUBSCRIPTION_PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`flex flex-col border-b px-6 pb-6 pt-6 ${
                    plan.popular
                      ? 'border-black/20 bg-brand-sage'
                      : 'border-white/10 border-l border-l-white/10'
                  }`}
                >
                  <div className="flex h-5 items-center">
                    {plan.popular && (
                      <span className="text-label font-semibold uppercase tracking-[0.14em] text-brand-gold-light">
                        Most chosen
                      </span>
                    )}
                  </div>
                  <h3
                    className={`mt-2.5 font-display text-[27px] font-medium leading-tight ${
                      plan.popular ? 'text-white' : 'text-white'
                    }`}
                  >
                    {plan.name}
                  </h3>
                  {/* `flex-1` on the tagline is what puts the four prices on one
                      line: the header cells are grid siblings and share a
                      height, so letting the sentence absorb the slack pins
                      everything below it to the same baseline however many
                      lines it runs to. */}
                  <p
                    className={`mt-2.5 max-w-[26ch] flex-1 text-body ${
                      plan.popular ? 'text-white/85' : 'text-brand-text-muted'
                    }`}
                  >
                    {plan.tagline}
                  </p>
                  <p className="mt-6 flex items-baseline gap-1.5">
                    <span
                      className={`text-[40px] font-semibold leading-none tracking-[-0.035em] tnum fs-semi ${
                        plan.popular ? 'text-brand-gold-light' : 'text-brand-gold'
                      }`}
                    >
                      ₵{monthlyPrice(plan)}
                    </span>
                    <span
                      className={`text-body ${plan.popular ? 'text-white/80' : 'text-brand-text-muted'}`}
                    >
                      / month
                    </span>
                  </p>
                  <p
                    className={`mt-1.5 text-body ${
                      plan.popular ? 'text-white/80' : 'text-brand-text-muted'
                    }`}
                  >
                    {billingCycle === 'annual' ? 'billed for the year' : 'billed monthly'}
                  </p>
                </div>
              ))}

              {/* Spec rows */}
              {SPECS.map((spec) => (
                <div key={spec.label} className="contents">
                  <div className="border-b border-white/10 py-5 pl-6 pr-4 text-body text-brand-text-muted">
                    {spec.label}
                  </div>
                  {SUBSCRIPTION_PLANS.map((plan) => {
                    const membership = membershipById.get(plan.id);
                    return (
                      <div
                        key={plan.id}
                        className={`border-b px-6 py-5 text-[15px] ${
                          plan.popular
                            ? 'border-black/20 bg-brand-sage text-white'
                            : 'border-l border-b-white/10 border-l-white/10 text-brand-text-light'
                        }`}
                      >
                        {membership ? spec.value(plan, membership) : '—'}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Everything else, and the action */}
              <div className="py-6 pl-6 pr-4 text-body text-brand-text-muted">Also included</div>
              {SUBSCRIPTION_PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`flex flex-col px-6 py-6 ${
                    plan.popular ? 'bg-brand-sage' : 'border-l border-white/10'
                  }`}
                  id={`plan-card-${plan.id}`}
                >
                  <ul className="flex-1 space-y-3">
                    {extraBenefits(plan).map((benefit) => (
                      <li
                        key={benefit}
                        className={`flex gap-2.5 text-body ${
                          plan.popular ? 'text-white/90' : 'text-brand-text-light'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-[0.62em] h-1 w-1 shrink-0 rounded-full ${
                            plan.popular ? 'bg-brand-gold-light' : 'bg-brand-sage-light'
                          }`}
                        />
                        {benefit}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => choosePlan(plan.name)}
                    className={`mt-8 w-full rounded-md py-3.5 text-[15px] font-semibold transition-colors duration-200 ${
                      plan.popular
                        ? 'bg-brand-gold text-brand-charcoal hover:bg-brand-gold-light'
                        : 'border border-white/25 text-white hover:border-white/45 hover:bg-white/5'
                    }`}
                  >
                    Choose this plan
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* Narrow screens: the same four plans, stacked. */}
        <div className="mt-12 space-y-4 lg:hidden">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const membership = membershipById.get(plan.id);
            if (!membership) return null;
            return (
              <Reveal
                key={plan.id}
                className={`overflow-hidden rounded-xl border ${
                  plan.popular ? 'border-brand-sage bg-brand-sage' : 'border-white/10 bg-brand-card'
                }`}
              >
                <div className="p-6">
                  {plan.popular && (
                    <span className="text-label font-semibold uppercase tracking-[0.14em] text-brand-gold-light">
                      Most chosen
                    </span>
                  )}
                  <h3 className="mt-1.5 font-display text-[29px] font-medium leading-tight text-white">
                    {plan.name}
                  </h3>
                  <p
                    className={`mt-2 text-body ${plan.popular ? 'text-white/85' : 'text-brand-text-muted'}`}
                  >
                    {plan.tagline}
                  </p>
                  <p className="mt-6 flex items-baseline gap-1.5">
                    <span
                      className={`text-[40px] font-semibold leading-none tracking-[-0.035em] tnum fs-semi ${
                        plan.popular ? 'text-brand-gold-light' : 'text-brand-gold'
                      }`}
                    >
                      ₵{monthlyPrice(plan)}
                    </span>
                    <span
                      className={`text-body ${plan.popular ? 'text-white/80' : 'text-brand-text-muted'}`}
                    >
                      / month{billingCycle === 'annual' ? ', billed yearly' : ''}
                    </span>
                  </p>

                  <dl className="mt-6">
                    {SPECS.map((spec) => (
                      <div
                        key={spec.label}
                        className={`flex items-baseline justify-between gap-4 border-t py-3 ${
                          plan.popular ? 'border-black/20' : 'border-white/10'
                        }`}
                      >
                        <dt
                          className={`text-body ${plan.popular ? 'text-white/80' : 'text-brand-text-muted'}`}
                        >
                          {spec.label}
                        </dt>
                        <dd
                          className={`text-right text-[15px] ${
                            plan.popular ? 'text-white' : 'text-brand-text-light'
                          }`}
                        >
                          {spec.value(plan, membership)}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <ul
                    className={`mt-4 space-y-3 border-t pt-4 ${
                      plan.popular ? 'border-black/20' : 'border-white/10'
                    }`}
                  >
                    {extraBenefits(plan).map((benefit) => (
                      <li
                        key={benefit}
                        className={`flex gap-2.5 text-body ${
                          plan.popular ? 'text-white/90' : 'text-brand-text-light'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-[0.62em] h-1 w-1 shrink-0 rounded-full ${
                            plan.popular ? 'bg-brand-gold-light' : 'bg-brand-sage-light'
                          }`}
                        />
                        {benefit}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => choosePlan(plan.name)}
                    className={`mt-6 w-full rounded-md py-3.5 text-[15px] font-semibold transition-colors duration-200 ${
                      plan.popular
                        ? 'bg-brand-gold text-brand-charcoal hover:bg-brand-gold-light'
                        : 'border border-white/25 text-white hover:border-white/45 hover:bg-white/5'
                    }`}
                  >
                    Choose this plan
                  </button>
                </div>
              </Reveal>
            );
          })}
        </div>

        <p className="mt-10 max-w-[70ch] text-body text-brand-text-muted">
          If a wash comes back and it is not right, tell us within 24 hours and we do it again at no
          charge. Running a salon, a guest house or an office?{' '}
          <a
            href="#contact"
            className="text-brand-gold underline decoration-brand-gold/40 underline-offset-4 hover:decoration-brand-gold"
          >
            Talk to us about a contract rate
          </a>
          .
        </p>
      </div>
    </section>
  );
}

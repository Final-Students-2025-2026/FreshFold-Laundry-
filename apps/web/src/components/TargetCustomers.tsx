import Reveal from './ui/Reveal';
import { useIntent } from '../intent';
import Img from './ui/Img';

interface TargetCustomersProps {
  onOpenBooking: () => void;
}

/**
 * Who sends us laundry, and what each of them is actually buying.
 *
 * `situation` is written in our own voice on purpose. It used to be a quotation
 * mark around an invented customer — "Midterms, essays, social calendars…" —
 * attributed to nobody, which is a testimonial the shop never received.
 *
 * Every number below is one `packages/core` can produce: plan prices from
 * `MEMBERSHIP_PLANS`, service prices from the catalogue.
 */
const SECTORS = [
  {
    id: 'student' as const,
    tab: 'Students',
    name: 'Students',
    situation:
      'A shared bathroom, a bucket, and a hall that empties into one tap. Laundry day costs an afternoon you were going to spend on coursework.',
    detail:
      'We collect from the halls and hostels around KNUST and bring it back the next day, folded. The student plan is the cheapest way to do it every fortnight.',
    facts: [
      'Student plan — ₵79 a month, two pickups included',
      'Collection from halls and hostels around Ayeduase and Kotei',
      'Washing on its own from ₵30 a load if you would rather pay per wash',
      'Order page shows the stage and the rider, so nobody has to wait in',
    ],
    cta: 'Book a student pickup',
    imageUrl: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?auto=format&fit=crop&q=80&w=1200',
    imageAlt: 'A week of clothes waiting in a laundry basket',
  },
  {
    id: 'professional' as const,
    tab: 'Professionals',
    name: 'Working professionals',
    situation:
      'Shirts for five days and a suit for the one meeting that matters. The washing is not hard — finding the evening to press it is.',
    detail:
      'Shirts and trousers come back pressed and on hangers, ready to wear. Four collections a month on the professional plan is one a week without thinking about it.',
    facts: [
      'Professional plan — ₵149 a month, four pickups included',
      'Ironing and folding from ₵25 an order, pressed and hung',
      'Next-day standard; same-day for ₵50 when a meeting moves',
      '15% off everything past the four included pickups',
    ],
    cta: 'Book a pickup',
    imageUrl: 'https://images.unsplash.com/photo-1714321960831-c8753b534400?auto=format&fit=crop&q=80&w=1200',
    imageAlt: 'Hands running an iron across the shoulder of a white shirt',
  },
  {
    id: 'family' as const,
    tab: 'Families',
    name: 'Families and households',
    situation:
      'School uniforms, sports kit, bedding for four. The machine runs most evenings and the pile still wins.',
    detail:
      'High-volume loads handled without anything getting mixed up between households. Bedding and linens are priced by the set, so a whole house of sheets is one predictable line.',
    facts: [
      'Family plan — ₵289 a month, eight pickups included',
      'Bed sheets and linens — ₵45 a set, washed and pressed',
      'Twice-weekly collection, sorted by household and by fabric',
      '20% off everything past the eight included pickups',
    ],
    cta: 'Book a family pickup',
    imageUrl: 'https://images.unsplash.com/photo-1699797467199-6bdf301649e8?auto=format&fit=crop&q=80&w=1200',
    imageAlt: 'A stack of folded towels and bedding in afternoon light',
  },
  {
    id: 'business' as const,
    tab: 'Businesses',
    name: 'Salons, guest houses and offices',
    situation:
      'Towels and robes that have to be clean and dry before the first appointment. Running out is not an inconvenience, it is a closed shop.',
    detail:
      'Standing collections on the days you need them, invoiced monthly rather than order by order. Contract rates are quoted against your actual volume — tell us what you go through in a week.',
    facts: [
      'Corporate plan — ₵499 a month, up to 30 pickups',
      'Daily collection where the volume needs it',
      'Same-day turnaround prioritised on contract accounts',
      'Larger contracts quoted directly, not off a price list',
    ],
    cta: 'Ask for a contract rate',
    imageUrl: 'https://images.unsplash.com/photo-1556740758-90de374c12ad?auto=format&fit=crop&q=80&w=1200',
    imageAlt: 'The front desk of a busy salon at the start of the day',
  },
];

export default function TargetCustomers({ onOpenBooking }: TargetCustomersProps) {
  /**
   * Which sector they picked is kept in the shared intent, not locally.
   *
   * It never reaches the booking form — a sector is not a service, and putting
   * "Working professionals" into the first line of an order would quote against
   * something the catalogue has never heard of, which is exactly what the old
   * `onSelectCustomerType('')` was written to avoid. What it reaches is the
   * concierge, which can then open on the question this particular reader is
   * most likely to be about to ask.
   */
  const { intent, note } = useIntent();
  const activeId = intent.sector || 'professional';
  const sector = SECTORS.find((item) => item.id === activeId) ?? SECTORS[1];
  const setActiveId = (id: string) => note({ sector: id });

  return (
    <section
      id="target-customers"
      className="border-b border-white/10 bg-brand-charcoal py-20 font-ui sm:py-28"
    >
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <Reveal className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <h2 className="font-display text-section font-medium text-white text-balance lg:col-span-6">
            Who we wash for.
          </h2>
          <p className="max-w-[50ch] text-lead text-brand-text-muted lg:col-span-5 lg:col-start-8">
            The job is the same; the reason for it is not. Pick the one that sounds like you.
          </p>
        </Reveal>

        {/* Tabs, as a quiet rule-anchored row. */}
        <div
          className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-white/10 pb-4"
          id="customer-sector-tabs"
          role="group"
          aria-label="Choose a customer type"
        >
          {SECTORS.map((option) => {
            const isActive = option.id === activeId;
            return (
              <button
                key={option.id}
                onClick={() => setActiveId(option.id)}
                aria-pressed={isActive}
                className={`-mb-[17px] border-b-2 pb-3.5 text-[15px] font-medium transition-colors duration-200 ${
                  isActive
                    ? 'border-brand-gold text-white'
                    : 'border-transparent text-brand-text-muted hover:text-white'
                }`}
              >
                {option.tab}
              </button>
            );
          })}
        </div>

        <div
          key={sector.id}
          className="panel-swap mt-12 grid gap-10 lg:grid-cols-12 lg:gap-14"
          id="customer-display-panel"
        >
            {/* Text first, image second — the mirror of the price list above it,
                so two sections that both pair a picture with a column of text
                do not read as the same section twice. */}
            <div className="lg:col-span-7">
              <h3 className="max-w-[20ch] font-display text-sub font-medium text-white text-balance">
                {sector.name}
              </h3>
              <p className="mt-5 max-w-[54ch] text-lead text-brand-text-light">
                {sector.situation}
              </p>
              <p className="mt-5 max-w-[58ch] text-body text-brand-text-muted">{sector.detail}</p>

              <ul className="mt-9 grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-2">
                {sector.facts.map((fact) => (
                  <li
                    key={fact}
                    className="bg-brand-charcoal px-5 py-4 text-body text-brand-text-light"
                  >
                    {fact}
                  </li>
                ))}
              </ul>

              <div className="mt-9">
                {sector.id === 'business' ? (
                  <a
                    href="#contact"
                    className="inline-block rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
                  >
                    {sector.cta}
                  </a>
                ) : (
                  <button
                    /* Opens on whatever order the reader has actually built,
                       which may well be nothing — the sector itself is not a
                       line and never becomes one. */
                    onClick={onOpenBooking}
                    className="rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
                  >
                    {sector.cta}
                  </button>
                )}
              </div>
            </div>

            <figure className="lg:col-span-5">
              {/* Full width on a phone, five of twelve columns from `lg`. */}
              <Img
                src={sector.imageUrl}
                alt={sector.imageAlt}
                sizes="(min-width: 1024px) 42vw, 100vw"
                width={960}
                height={640}
                className="h-[280px] w-full rounded-lg object-cover sm:h-[380px] lg:h-full lg:min-h-[440px]"
              />
            </figure>
        </div>
      </div>
    </section>
  );
}

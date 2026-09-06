import { useState } from 'react';
import { serviceById } from '@freshfold/core';
import { SERVICES } from '../data';
import { ServiceItem } from '../types';
import { ArrowRight } from 'lucide-react';
import Reveal from './ui/Reveal';
import Estimator from './ui/Estimator';
import { useIntent } from '../intent';
import Img from './ui/Img';

interface ServicesProps {
  /** Opens the booking form, which reads the order out of the shared intent. */
  onOpenBooking: () => void;
}

const CATEGORIES = [
  { id: 'all', label: 'Everything' },
  { id: 'core', label: 'Laundry' },
  { id: 'specialized', label: 'Specialist' },
  { id: 'express', label: 'Express' },
] as const;

type CategoryId = (typeof CATEGORIES)[number]['id'];

/**
 * The price list.
 *
 * This was eleven identical photo cards in a four-column grid, which is the
 * shape a landing page reaches for when it has not decided what the section is.
 * A laundry has a price list — a column of names against a column of prices —
 * so that is what this is: rows, ruled, with the money aligned down the right
 * edge. The photographs did not have to go; there is one of them, large, and it
 * follows whichever row the reader is on.
 *
 * Every price is `priceLabel()` from `@freshfold/core`, the same string the
 * checkout quotes.
 */
export default function Services({ onOpenBooking }: ServicesProps) {
  const [category, setCategory] = useState<CategoryId>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const { addItem } = useIntent();

  /**
   * Pressing Book on a row puts that service on the order and opens the form.
   *
   * It used to pass the name through `App` as a preselection prop, which meant
   * the row *replaced* whatever the estimator had been used to build. Adding it
   * instead is both the smaller surprise and the more useful one: a reader who
   * priced two loads and then spots ironing in the list means to send both.
   */
  const book = (serviceName: string) => {
    addItem(serviceName);
    onOpenBooking();
  };

  const services =
    category === 'all' ? SERVICES : SERVICES.filter((service) => service.category === category);

  // Clamped rather than reset in an effect: the filter can shorten the list
  // under a hover that has already happened, and a stale index would blank the
  // photograph for a frame.
  const active = services[Math.min(activeIndex, services.length - 1)] ?? services[0];

  return (
    <section
      id="services"
      className="border-b border-white/10 bg-brand-charcoal py-20 font-ui sm:py-28"
    >
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <Reveal className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <h2 className="font-display text-section font-medium text-white text-balance lg:col-span-6">
            What we clean, and what it costs.
          </h2>
          <p className="max-w-[52ch] text-lead text-brand-text-muted lg:col-span-5 lg:col-start-8">
            One price list, the same one the booking form charges from. Pickup and delivery are
            free on every line of it.
          </p>
        </Reveal>

        {/* Filter. A quiet text row, not four filled pills — the categories are
            a way to shorten the list, not four competing calls to action. */}
        <div
          className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/10 pb-4"
          id="services-filter"
          role="group"
          aria-label="Filter services"
        >
          {CATEGORIES.map((option) => {
            const isActive = category === option.id;
            return (
              <button
                key={option.id}
                onClick={() => {
                  setCategory(option.id);
                  setActiveIndex(0);
                }}
                aria-pressed={isActive}
                className={`-mb-[17px] border-b-2 pb-3.5 text-[15px] font-medium transition-colors duration-200 ${
                  isActive
                    ? 'border-brand-gold text-white'
                    : 'border-transparent text-brand-text-muted hover:text-white'
                }`}
              >
                {option.label}
              </button>
            );
          })}
          {/* Hidden on a phone: the four filters already fill the row there,
              and a wrapped count drags the active underline off the rule it is
              supposed to sit on. */}
          <span className="ml-auto hidden text-body text-brand-text-muted tnum sm:inline">
            {services.length} {services.length === 1 ? 'service' : 'services'}
          </span>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-14">
          {/* The photograph, following the list. Hidden below `lg`, where the
              rows carry their own thumbnail instead — a sticky panel needs a
              column beside it to be sticky against. */}
          <div className="hidden lg:col-span-5 lg:block">
            <div className="sticky top-28">
              <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-brand-card">
                {/* Five of twelve columns, and only rendered from `lg`. */}
                <Img
                  key={active.id}
                  src={active.imageUrl}
                  alt={active.name}
                  sizes="42vw"
                  width={640}
                  height={800}
                  className="panel-swap absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <div className="mt-4 flex items-baseline justify-between gap-4">
                <p className="text-[15px] font-medium text-white">{active.name}</p>
                <p className="shrink-0 text-[15px] font-semibold text-brand-gold tnum">
                  {active.priceInfo}
                </p>
              </div>
            </div>
          </div>

          {/* The list itself. */}
          <ul className="lg:col-span-7" id="services-grid">
            {services.map((service: ServiceItem, index) => {
              const bookable = serviceById(service.id)?.bookable ?? false;
              const isActive = active.id === service.id;

              return (
                <li
                  key={service.id}
                  className="group border-b border-white/10 transition-colors duration-300 first:border-t first:border-white/10 hover:bg-white/[0.03]"
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <div className="flex items-start gap-4 py-6 transition-[padding] duration-300 group-hover:sm:pl-3 sm:gap-6">
                    {/* The thumbnail the sticky panel replaces on wide screens. */}
                    {/* 64px, fixed. This was fetching the same `w=800` file as
                        the full-bleed panel above to paint a thumbnail. */}
                    <Img
                      src={service.imageUrl}
                      alt=""
                      sizes="64px"
                      width={128}
                      height={128}
                      className="h-16 w-16 shrink-0 rounded-md object-cover lg:hidden"
                    />

                    <div className="min-w-0 flex-1">
                      <h3
                        className={`font-display text-[25px] font-medium leading-tight transition-colors duration-200 sm:text-[27px] ${
                          isActive ? 'text-white' : 'text-white/90'
                        }`}
                      >
                        {service.name}
                      </h3>
                      <p className="mt-2 max-w-[58ch] text-body text-brand-text-muted">
                        {service.description}
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 lg:hidden">
                        <span className="text-[15px] font-semibold text-brand-gold tnum">
                          {service.priceInfo}
                        </span>
                        {bookable ? (
                          <button
                            onClick={() => book(service.name)}
                            className="inline-flex items-center gap-1.5 text-[15px] font-medium text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-brand-gold"
                          >
                            Book this <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <a
                            href="#contact"
                            className="text-[15px] font-medium text-brand-text-muted underline decoration-white/20 underline-offset-4 hover:text-white"
                          >
                            Ask us about it
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Wide screens: price and action in their own columns, so
                        the money runs down one straight edge. */}
                    <div className="hidden w-44 shrink-0 text-right lg:block">
                      <span className="text-[15px] font-semibold text-brand-gold tnum">
                        {service.priceInfo}
                      </span>
                    </div>

                    <div className="hidden w-24 shrink-0 text-right lg:block">
                      {bookable ? (
                        <button
                          onClick={() => book(service.name)}
                          onFocus={() => setActiveIndex(index)}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[15px] font-medium text-white transition-colors duration-200 hover:text-brand-gold"
                        >
                          Book
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <a
                          href="#contact"
                          onFocus={() => setActiveIndex(index)}
                          className="inline-block rounded-md px-2 py-1 text-[15px] font-medium text-brand-text-muted transition-colors duration-200 hover:text-white"
                        >
                          Ask us
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* The price list answers "what does a wash cost". This answers "what
            does *mine* cost", which is the question underneath it. */}
        <Reveal className="mt-14">
          <Estimator onBook={onOpenBooking} />
        </Reveal>
      </div>
    </section>
  );
}

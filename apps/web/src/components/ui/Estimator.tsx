import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import {
  MAX_ITEMS,
  MAX_QUANTITY,
  SCENTS,
  clampQuantity,
  pluraliseUnit,
  priceBreakdown,
  serviceTakesQuantity,
  serviceUnit,
} from '@freshfold/core';
import { BOOKABLE_SERVICE_ITEMS } from '../../data';
import { useIntent } from '../../intent';
import Figure from './Figure';

interface EstimatorProps {
  /** Opens the booking form. It reads the order from the shared intent. */
  onBook: () => void;
}

/**
 * "What will mine cost?" — answered exactly, on the page, for the whole load.
 *
 * The number comes from `priceBreakdown()` in `@freshfold/core`, which is the
 * same function the booking form quotes with and the same one the dispatch
 * server re-derives before it charges anything. That matters more than it
 * sounds: an estimator that runs its own arithmetic is a second source of truth
 * for a price, and a second source of truth for a price is a customer arriving
 * at checkout to a different number than the one that persuaded them.
 *
 * It used to price one line at a time, which is not how anyone's laundry
 * arrives. A student sends two loads, a duvet and a shirt to be pressed — one
 * collection, one courier, one doorstep — and answering only the first of those
 * left them to add the rest up in their head or book three times. So the
 * estimate is now an order: lines go in, the total moves, and the whole thing
 * is handed to the booking form rather than retyped into it. `BookingModal` has
 * carried multi-line orders since line items existed; this is the first surface
 * that lets a stranger build one.
 *
 * Only `BOOKABLE_SERVICE_ITEMS` are offered. Drying is bundled into a wash and
 * a corporate contract is a conversation; neither has a price to quote, so
 * neither belongs in a thing whose entire job is quoting one.
 */
export default function Estimator({ onBook }: EstimatorProps) {
  const { intent, addItem, setQuantity, removeItem, clearItems } = useIntent();

  /**
   * The line being composed, which is not yet on the order.
   *
   * Local rather than in the shared intent on purpose: scrolling past a select
   * is not a statement of intent, and everything downstream — the sticky
   * booking bar, the concierge's opening question — treats a non-empty basket
   * as a decision the visitor actually made.
   */
  const [draftId, setDraftId] = useState(BOOKABLE_SERVICE_ITEMS[0]?.id ?? '');
  const [draftQuantity, setDraftQuantity] = useState(1);

  const draft =
    BOOKABLE_SERVICE_ITEMS.find((item) => item.id === draftId) ?? BOOKABLE_SERVICE_ITEMS[0];

  // Clamped through core, so the ceiling here and the ceiling in the booking
  // form are the same ceiling — and so a per-order service stays at one however
  // many times the plus button is pressed.
  const draftCount = clampQuantity(draftQuantity, draft.name);
  const draftQuote = priceBreakdown({ serviceType: draft.name, quantity: draftCount });
  const counted = serviceTakesQuantity(draft.name);

  const lines = intent.items;
  const hasOrder = lines.length > 0;

  /**
   * The order's price, in one call rather than a sum of per-line calls.
   *
   * `priceBreakdown` is the thing that knows how an order is priced — that the
   * base and the finishes scale per line while an add-on is chosen once for the
   * whole collection. Adding up `gross` per line would quietly re-implement
   * that rule on the marketing page, and get it wrong the moment it changes.
   */
  const orderQuote = priceBreakdown({
    serviceType: lines[0]?.serviceType ?? draft.name,
    items: hasOrder ? lines : undefined,
    quantity: hasOrder ? undefined : draftCount,
  });

  const step = (by: number) =>
    setDraftQuantity((current) => clampQuantity(current + by, draft.name));

  const full = lines.length >= MAX_ITEMS;
  const already = lines.some((line) => line.serviceType === draft.name);

  return (
    <div className="rounded-xl border border-white/10 bg-brand-card p-6 sm:p-8">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        {/* The picker. */}
        <div className="lg:col-span-6">
          <h3 className="font-display text-[27px] font-medium leading-tight text-white">
            Work out what yours costs.
          </h3>
          <p className="mt-2 max-w-[48ch] text-body text-brand-text-muted">
            Add everything that is going in the bag. The same prices the booking form charges from,
            with pickup and delivery already in them.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label
                htmlFor="estimator-service"
                className="block text-[13px] font-medium text-brand-text-light"
              >
                What needs doing
              </label>
              <select
                id="estimator-service"
                value={draft.id}
                onChange={(event) => {
                  setDraftId(event.target.value);
                  setDraftQuantity(1);
                }}
                className="mt-2 w-full rounded-md border border-white/15 bg-brand-charcoal px-4 py-3 text-[15px] text-white transition-colors duration-200 focus:border-brand-gold focus:outline-none"
              >
                {BOOKABLE_SERVICE_ITEMS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-[13px] font-medium text-brand-text-light">How many</span>
              {!counted ? (
                /* Some services are priced per order rather than per unit, and
                   a stepper that refuses to move is worse than no stepper. */
                <p className="mt-2 rounded-md border border-white/10 px-4 py-3 text-[15px] text-brand-text-muted">
                  Priced per order
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-1 rounded-md border border-white/15 p-1">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    disabled={draftCount <= 1}
                    aria-label="One fewer"
                    className="grid h-11 w-11 place-items-center rounded text-white transition-colors duration-200 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span
                    aria-live="polite"
                    className="min-w-[5.5rem] text-center text-[15px] text-white tnum"
                  >
                    {draftCount} {pluraliseUnit(serviceUnit(draft.name), draftCount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    disabled={draftCount >= MAX_QUANTITY}
                    aria-label="One more"
                    className="grid h-11 w-11 place-items-center rounded text-white transition-colors duration-200 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-white/10 pt-5">
            <p className="text-[15px] text-brand-text-muted">
              That line is{' '}
              <span className="font-semibold text-white tnum">
                ₵<Figure value={draftQuote.gross} />
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                addItem(draft.name, draftCount);
                setDraftQuantity(1);
              }}
              disabled={full && !already}
              className="ml-auto rounded-md border border-white/25 px-5 py-2.5 text-[15px] font-medium text-white transition-colors duration-200 hover:border-brand-gold hover:text-brand-gold disabled:opacity-40 disabled:hover:border-white/25 disabled:hover:text-white"
            >
              {already ? 'Add more of these' : 'Add to the order'}
            </button>
          </div>
          {full && !already && (
            <p className="mt-2 text-body text-brand-text-muted">
              Six services is as much as one collection carries. Remove one to add another, or tell
              us about the rest below.
            </p>
          )}
        </div>

        {/* The order. */}
        <div className="lg:col-span-5 lg:col-start-8">
          <div className="flex items-baseline justify-between gap-4 border-b border-white/15 pb-3">
            <h4 className="text-[13px] font-medium text-brand-text-light">Your order</h4>
            {hasOrder && (
              <button
                type="button"
                onClick={clearItems}
                className="text-body text-brand-text-muted transition-colors duration-200 hover:text-white"
              >
                Start again
              </button>
            )}
          </div>

          {/* One live region for the whole basket, so a line added by mouse is
              also announced. */}
          <div aria-live="polite">
            {!hasOrder ? (
              <p className="py-5 text-body text-brand-text-muted">
                Nothing added yet. The price on the left is for one order of{' '}
                {draft.name.toLowerCase()} — add it, or add several things and see the lot.
              </p>
            ) : (
              <ul className="divide-y divide-white/10">
                {lines.map((line) => {
                  const lineCounted = serviceTakesQuantity(line.serviceType);
                  const linePrice = priceBreakdown({
                    serviceType: line.serviceType,
                    quantity: line.quantity,
                  }).gross;

                  return (
                    <li key={line.serviceType} className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-[15px] font-medium text-white">
                          {line.serviceType}
                        </p>
                        <p className="shrink-0 text-[15px] font-semibold text-white tnum">
                          ₵<Figure value={linePrice} />
                        </p>
                        <button
                          type="button"
                          onClick={() => removeItem(line.serviceType)}
                          aria-label={`Remove ${line.serviceType}`}
                          className="-mt-1 grid h-7 w-7 shrink-0 place-items-center rounded text-brand-text-muted transition-colors duration-200 hover:bg-white/10 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {lineCounted ? (
                        <div className="mt-2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setQuantity(line.serviceType, line.quantity - 1)}
                            disabled={line.quantity <= 1}
                            aria-label={`One fewer ${line.serviceType}`}
                            className="grid h-9 w-9 place-items-center rounded border border-white/15 text-white transition-colors duration-200 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-[5rem] text-center text-body text-brand-text-light tnum">
                            {line.quantity}{' '}
                            {pluraliseUnit(serviceUnit(line.serviceType), line.quantity)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQuantity(line.serviceType, line.quantity + 1)}
                            disabled={line.quantity >= MAX_QUANTITY}
                            aria-label={`One more ${line.serviceType}`}
                            className="grid h-9 w-9 place-items-center rounded border border-white/15 text-white transition-colors duration-200 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-body text-brand-text-muted">One order</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-white/15 pt-4">
            <p className="text-[13px] font-medium text-brand-text-muted">
              {hasOrder ? 'You would pay' : 'One order would be'}
            </p>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-[46px] font-semibold leading-none tracking-[-0.035em] text-brand-gold tnum fs-semi">
                ₵<Figure value={orderQuote.gross} />
              </span>
            </p>
            {/*
              Exact about what this number does and does not include.

              It said "scents, starch and extras are chosen when you book",
              which is true and still let the booking form open ₵20 higher than
              the figure that persuaded someone: the form defaults the scent to
              Organic Lavender, and that is ₵5 on every unit of every laundry
              line. A vague caveat in front of a silent increase is the same
              problem as no caveat. Naming the default and its free alternative
              costs one sentence and removes the surprise.
            */}
            <p className="mt-2 text-body text-brand-text-muted">
              Collection and delivery included. The booking form starts on Organic Lavender, which
              adds ₵{SCENTS[0].surcharge} a unit — fragrance-free costs nothing.
            </p>
            <button
              type="button"
              onClick={() => {
                // Booking an order nobody has built means booking the line on
                // screen — which is what the button said before the basket
                // existed, and what someone who never touched it expects.
                if (!hasOrder) addItem(draft.name, draftCount);
                onBook();
              }}
              className="mt-5 w-full rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
            >
              {hasOrder ? 'Book this order' : 'Book this'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

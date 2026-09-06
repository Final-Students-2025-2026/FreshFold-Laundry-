import { useEffect, useState } from 'react';
import { PICKUP_SLOTS, isoDaysFromNow, isoPlusDays } from '@freshfold/core';
import * as store from '../../services/store';
import { windowLabel } from './slots';

/**
 * "When would I get it back?" — the second of the three questions the page
 * exists to answer, and the only one that had no interactive answer.
 *
 * Cost is answered by the estimator and coverage by the area check. When was a
 * sentence in the hero that said "Tomorrow", which is true and also the kind of
 * claim every laundry makes. What makes it credible is that this reads the
 * actual dispatch board: `/bookings/availability` is the same route the booking
 * form asks before it lets anyone choose a window, and it is deliberately open
 * to strangers — it discloses how busy a day is and nothing else. No customer,
 * no address, no order.
 *
 * Which means the scarcity here is real. "Two places left in the evening
 * round" is a fact about tomorrow's rota, not a growth tactic, and under this
 * product's own rule — nothing claimed that isn't true — that is the only kind
 * of urgency the page is allowed.
 *
 * The dates are derived the same way `BookingModal` derives them, and that is
 * load-bearing: the form opens on `isoDaysFromNow(1)` and returns
 * `pickupDate + 1`, so promising a collection *today* here would be a promise
 * the form immediately refuses. The earliest honest answer is tomorrow.
 */
interface SlotRow {
  slot: string;
  remaining: number;
  full: boolean;
}

interface Day {
  date: string;
  deliveryDate: string;
  slots: SlotRow[];
}

/** Ghana is GMT+0 all year, so the stored ISO day is also the wall-clock day. */
const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function dayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return DAY.format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * How many days ahead this will look before giving up.
 *
 * Three, because past that the answer stops being "book now" and starts being a
 * conversation with the desk — and because each day is a request, and this runs
 * on Ghanaian mobile data on the first screenful of the page.
 */
const HORIZON = 3;

export default function NextCollection() {
  const [day, setDay] = useState<Day | null>(null);
  /** Distinguishes "still asking" from "asked, and every round is full". */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (let offset = 1; offset <= HORIZON; offset++) {
        const date = isoDaysFromNow(offset);
        const deliveryDate = isoPlusDays(date, 1) ?? date;

        try {
          const answer = await store.api.slotAvailability(date);
          if (cancelled) return;

          const slots: SlotRow[] = answer.slots.map((row) => ({
            slot: row.slot,
            remaining: row.remaining,
            full: row.full,
          }));

          if (slots.some((row) => !row.full)) {
            setDay({ date, deliveryDate, slots });
            setSettled(true);
            return;
          }
        } catch {
          // An unreachable server is not an excuse to invent a rota. Fall
          // through to the static promise below, which is true regardless.
          if (!cancelled) setSettled(true);
          return;
        }
      }

      if (!cancelled) setSettled(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-label="Next available collection"
      className="border-b border-white/10 bg-brand-charcoal font-ui"
      id="next-collection"
    >
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <div className="grid gap-x-10 gap-y-6 py-8 lg:grid-cols-12 lg:items-center lg:py-7">
          <div className="lg:col-span-4">
            <p className="text-[13px] font-medium text-brand-text-muted">
              {day ? 'Next collection' : 'Collections'}
            </p>
            <p className="mt-1.5 text-[19px] font-medium leading-snug text-white">
              {day ? (
                <>
                  {dayLabel(day.date)}, back{' '}
                  <span className="text-brand-gold">{dayLabel(day.deliveryDate)}</span>
                </>
              ) : (
                <>
                  Tomorrow, back <span className="text-brand-gold">the day after</span>
                </>
              )}
            </p>
          </div>

          {/*
            The rota. Rendered only once the server has actually answered —
            a row of windows with no counts on them looks like a form that has
            not loaded, and a row of invented counts is worse than either.
          */}
          <div className="lg:col-span-8" aria-live="polite">
            {day ? (
              <ul className="grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-3">
                {PICKUP_SLOTS.map((window) => {
                  const row = day.slots.find((candidate) => candidate.slot === window.label);
                  const remaining = row?.remaining ?? 0;
                  const full = row?.full ?? false;

                  return (
                    <li
                      key={window.label}
                      className="flex items-baseline justify-between gap-3 bg-brand-charcoal px-4 py-3.5"
                    >
                      <span className={`text-[15px] tnum ${full ? 'text-brand-text-muted' : 'text-white'}`}>
                        {windowLabel(window.label)}
                      </span>
                      {/*
                        Only says a number when the number means something. Five
                        places left is simply "open"; two is a reason to book
                        now, and saying so at every count would train people to
                        stop reading it.
                      */}
                      <span
                        className={`shrink-0 text-body tnum ${
                          full
                            ? 'text-brand-text-muted'
                            : remaining <= 2
                              ? 'text-brand-gold'
                              : 'text-brand-sage-light'
                        }`}
                      >
                        {full ? 'Full' : remaining <= 2 ? `${remaining} left` : 'Open'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="max-w-[64ch] text-body text-brand-text-muted">
                {settled
                  ? 'We collect every day from 08:00. Open the booking form for the first window we can reach you in.'
                  : 'Checking which windows are still open…'}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

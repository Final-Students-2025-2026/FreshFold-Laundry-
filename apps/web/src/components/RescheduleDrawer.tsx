import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import {
  DELIVERY_TIME_SLOTS,
  MAX_RESCHEDULES,
  PICKUP_TIME_SLOTS,
  deliverySlotsFor,
  isoPlusDays,
  todayIso,
  type Booking,
} from '@freshfold/core';
import { failureMessage } from '@freshfold/core';
import * as store from '../services/store';
import { FIELD } from './ui/portal';
import { windowLabel } from './ui/slots';
import { useDialog } from './ui/useDialog';

/**
 * Moving a booking that is already on the board.
 *
 * The alternative until this existed was cancel and rebook, which cost the
 * customer their reference, their three hand-off codes and — if they had paid —
 * a trip through the refund flow to come back as a new order. Nothing here
 * reprices: the same order moves, and the total on the receipt does not change.
 *
 * The rules are core's `checkReschedule`, and the server runs them again on a
 * locked row. This drawer shows them early so the customer is not walked into a
 * refusal; when the two disagree the server wins, and the sentence it wrote is
 * what appears under the buttons.
 */

interface RescheduleDrawerProps {
  booking: Booking;
  onClose: () => void;
  onMoved?: (booking: Booking) => void;
}

/** How many days the strip offers. The server's horizon is 30. */
const DAYS = 14;

type Windows = Record<string, { remaining: number; full: boolean }>;

export default function RescheduleDrawer({ booking, onClose, onMoved }: RescheduleDrawerProps) {
  const [pickupDate, setPickupDate] = useState(booking.pickupDate);
  const [pickupTime, setPickupTime] = useState(booking.pickupTime || PICKUP_TIME_SLOTS[0]);
  const [deliveryTime, setDeliveryTime] = useState(booking.deliveryTime || DELIVERY_TIME_SLOTS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const deliveryDate = useMemo(() => isoPlusDays(pickupDate, 1) ?? pickupDate, [pickupDate]);

  const returnOptions = useMemo(
    () => deliverySlotsFor(pickupDate, pickupTime, deliveryDate),
    [pickupDate, pickupTime, deliveryDate]
  );

  /* Escape, the focus trap, the scroll lock and returning the keyboard to
     whatever opened this. This sheet had none of the four: it declared
     `aria-modal="true"` — a claim that the page behind is inert — while Tab
     walked out of it into the portal underneath, and there was no key that
     closed it at all. See ui/useDialog. */
  const sheet = useDialog<HTMLDivElement>({ open: true, onClose });

  /**
   * The next fortnight, starting today.
   *
   * Today is on it because the cut-off rather than the calendar is what rules
   * out a same-day move — at 9am this evening's window is still bookable, and a
   * strip starting tomorrow would hide a slot the server would accept.
   */
  const days = useMemo(() => {
    const first = todayIso();
    return Array.from({ length: DAYS }, (_, index) => isoPlusDays(first, index) ?? first);
  }, []);

  const [slots, setSlots] = useState<Windows>({});
  const [returns, setReturns] = useState<Windows>({});

  useEffect(() => {
    let cancelled = false;

    store.api
      // `exclude` is this booking, so the window it already holds is not counted
      // against itself — otherwise a customer on a nearly-full morning sees
      // their own collection listed as unavailable.
      .slotAvailability(pickupDate, { deliveryDate, exclude: booking.id })
      .then((answer) => {
        if (cancelled) return;

        const next: Windows = {};
        for (const row of answer.slots) next[row.slot] = { remaining: row.remaining, full: row.full };
        setSlots(next);

        const back: Windows = {};
        for (const row of answer.deliverySlots ?? []) {
          back[row.slot] = { remaining: row.remaining, full: row.full };
        }
        setReturns(back);
      })
      .catch(() => {
        // Optimistic on failure, like the booking form: an unreachable server
        // should not grey out every window and make the drawer look broken.
        if (cancelled) return;
        setSlots({});
        setReturns({});
      });

    return () => {
      cancelled = true;
    };
  }, [pickupDate, deliveryDate, booking.id]);

  // Follow the collection when the return it had stops being reachable.
  useEffect(() => {
    const reachable = returnOptions.some((slot) => slot.label === deliveryTime);
    if (reachable && !returns[deliveryTime]?.full) return;

    const open = returnOptions.find((slot) => !returns[slot.label]?.full);
    if (open) setDeliveryTime(open.label);
  }, [returnOptions, returns, deliveryTime]);

  const unchanged =
    pickupDate === booking.pickupDate &&
    pickupTime === booking.pickupTime &&
    deliveryTime === (booking.deliveryTime ?? deliveryTime);

  const movesLeft = Math.max(0, MAX_RESCHEDULES - (booking.rescheduleCount ?? 0));

  const submit = async () => {
    setBusy(true);
    setError('');

    try {
      const moved = await store.rescheduleBooking(booking.id, {
        pickupDate,
        pickupTime,
        // Left off when the collection leaves no room for one, rather than sent
        // and refused — losing the whole move over the return window would be
        // the wrong trade.
        deliveryTime: returnOptions.some((slot) => slot.label === deliveryTime)
          ? deliveryTime
          : undefined,
      });

      onMoved?.(moved);
      onClose();
    } catch (failure) {
      // The server writes these for the customer — "that window filled up",
      // "your courier is already on the way" — so they are shown as they arrive.
      setError(
        failureMessage(failure, 'That could not be moved just now. Try again.')
      );
      setBusy(false);
    }
  };

  return (
    /* A conditional render, not an `AnimatePresence` child: the exit did not
       complete, and a dismissed sheet left behind at `opacity: 0` is still a
       `fixed inset-0` pane taking every click. See `.overlay-in` in index.css. */
    <div className="overlay-in fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      {/* The backdrop as its own target: this sheet used to be closable only
          by a 16px icon in its corner. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
      />

      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-title"
        tabIndex={-1}
        className="sheet-in relative flex max-h-[92svh] w-full flex-col rounded-t-md border border-white/10 bg-brand-card font-ui text-[15px] text-white outline-none sm:max-w-md sm:rounded-md"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="reschedule-title"
              className="flex items-center gap-2 font-display text-[24px] font-medium leading-tight text-white"
            >
              <CalendarClock aria-hidden="true" className="h-5 w-5 text-brand-gold" />
              Move this pickup
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-brand-text-muted">
              {movesLeft <= 1
                ? 'This is the last time this booking can be moved. After that, cancel and rebook.'
                : `You can move this booking ${movesLeft} more times.`}{' '}
              Nothing is repriced — same order, same total, same reference{' '}
              <span className="tnum text-white">{booking.id}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-brand-text-muted transition-colors duration-200 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-brand-text-muted">
              New collection date
            </legend>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {days.map((day) => {
                const date = new Date(`${day}T00:00:00Z`);
                const active = day === pickupDate;

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setPickupDate(day)}
                    aria-pressed={active}
                    className={`shrink-0 rounded-md border px-3.5 py-2 text-center transition-colors duration-200 ${
                      active
                        ? 'border-brand-gold bg-brand-gold/10 text-white'
                        : 'border-white/12 text-brand-text-muted hover:border-white/25 hover:text-white'
                    }`}
                  >
                    <span className="block text-[13px]">
                      {date.toLocaleDateString('en-GH', { weekday: 'short', timeZone: 'UTC' })}
                    </span>
                    <span className="tnum block text-[17px] font-semibold">
                      {date.getUTCDate()}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor="reschedule-pickup" className="block text-[13px] font-medium text-brand-text-muted">
              Collection window
            </label>
            <select
              id="reschedule-pickup"
              value={pickupTime}
              onChange={(e) => setPickupTime(e.target.value)}
              className={FIELD}
            >
              {PICKUP_TIME_SLOTS.map((slot) => {
                const state = slots[slot];
                return (
                  /* The value stays the stored label — core documents those as
                     frozen, because the string *is* the value on every booking
                     ever made. Only what the customer reads is the hours. */
                  <option key={slot} value={slot} disabled={state?.full}>
                    {windowLabel(slot)}
                    {state?.full
                      ? ' — full'
                      : state && state.remaining <= 3
                        ? ` — ${state.remaining} left`
                        : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reschedule-return" className="block text-[13px] font-medium text-brand-text-muted">
              Return window
              <span className="ml-2 text-brand-text-muted">back to you on {deliveryDate}</span>
            </label>
            <select
              id="reschedule-return"
              value={deliveryTime}
              onChange={(e) => setDeliveryTime(e.target.value)}
              className={FIELD}
            >
              {DELIVERY_TIME_SLOTS.map((slot) => {
                const state = returns[slot];
                const reachable = returnOptions.some((option) => option.label === slot);

                return (
                  <option key={slot} value={slot} disabled={!reachable || state?.full}>
                    {windowLabel(slot)}
                    {!reachable
                      ? ' — too early'
                      : state?.full
                        ? ' — full'
                        : state && state.remaining <= 3
                          ? ` — ${state.remaining} left`
                          : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {!!error && (
            <p className="rounded-md border border-red-500/25 bg-red-500/10 px-4 py-3 text-[14px] leading-relaxed text-red-300">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || unchanged}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-brand-sage px-4 py-2.5 text-[14px] font-semibold text-white transition-colors duration-200 hover:bg-brand-sage-light hover:text-brand-charcoal disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-brand-text-muted disabled:hover:bg-white/10 disabled:hover:text-brand-text-muted"
            >
              {busy ? 'Moving…' : 'Move pickup'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/12 px-4 py-2.5 text-[14px] font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/5 disabled:cursor-not-allowed"
            >
              Keep it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

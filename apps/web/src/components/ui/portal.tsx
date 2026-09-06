import React from 'react';
import { AlertCircle, AlertTriangle, Check, X } from 'lucide-react';
import type { Booking } from '@freshfold/core';
import { windowLabel } from './slots';
import { useDialog } from './useDialog';

/* -------------------------------------------------------------------------
   The portal's shared surfaces.

   Every card in this file used to be written out longhand, which is how the
   live map and the address book ended up with identical weight: same
   `bg-[#161616]`, same `rounded-2xl`, same `border-white/10`, same padding.
   The four pieces below are the whole vocabulary, so a panel that matters
   more says so by what is *in* it rather than by finding its own border.

   The measurements come from the landing: `rounded-md`, hairline at
   `white/10`, 15px body, 13px meta, `transition-colors duration-200`. This is
   a product surface with its own layout, not a second marketing page, but it
   is the same shop and it should read like it.
   ------------------------------------------------------------------------- */

/** The page's one card. */
export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'li';
}) {
  return (
    <Tag className={`rounded-md border border-white/10 bg-brand-card ${className}`}>
      {children}
    </Tag>
  );
}

/** A panel's title bar: what this is, and at most one thing to do about it. */
export function PanelHead({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-[17px] font-medium text-white">{title}</h3>
        {note && <p className="mt-1 text-[13px] leading-relaxed text-brand-text-muted">{note}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * A said thing: the outcome of a save, a refusal, a standing notice.
 *
 * There were six hand-rolled copies of this before, in three colours and two
 * radii, and the emerald one had drifted to a different border opacity from
 * the red. One component, three tones, and the icon is chosen by the tone
 * rather than passed in and occasionally forgotten.
 */
export function Banner({
  tone,
  children,
}: {
  tone: 'ok' | 'bad' | 'note';
  children: React.ReactNode;
}) {
  const skin = {
    ok: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    bad: 'border-red-500/25 bg-red-500/10 text-red-300',
    note: 'border-brand-gold/30 bg-brand-gold/10 text-brand-gold-light',
  }[tone];
  const Icon = tone === 'ok' ? Check : tone === 'bad' ? AlertTriangle : AlertCircle;

  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-4 py-3 text-[14px] leading-relaxed ${skin}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** A labelled row of facts, as a receipt or a summary sets them. */
export function Row({
  label,
  children,
  strong = false,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 text-[14px]">
      <span className="shrink-0 text-brand-text-muted">{label}</span>
      <span className={`min-w-0 text-right ${strong ? 'font-semibold text-white' : 'text-white'}`}>
        {children}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------
   The buttons: a tone and a size, composed at the call site.

   Olive is FreshFold doing something of its own — booking, saving, sending a
   note to the shop. Brass is money, and only money: paying a bill, topping up
   a wallet, spending points. Everything else is a hairline. Nothing on this
   surface is coloured for decoration, which is why there is no fourth tone.
   ------------------------------------------------------------------------- */
export const BTN =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-200 disabled:cursor-not-allowed';
export const AS_PRIMARY =
  'bg-brand-sage text-white hover:bg-brand-sage-light hover:text-brand-charcoal disabled:bg-white/10 disabled:text-brand-text-muted disabled:hover:bg-white/10 disabled:hover:text-brand-text-muted';
export const AS_MONEY =
  'bg-brand-gold text-brand-charcoal hover:bg-brand-gold-light disabled:bg-white/10 disabled:text-brand-text-muted disabled:hover:bg-white/10';
export const AS_QUIET =
  'border border-white/12 font-medium text-white hover:border-white/25 hover:bg-white/5 disabled:text-brand-text-muted disabled:hover:border-white/12 disabled:hover:bg-transparent';
export const SIZE_MD = 'px-4 py-2.5 text-[14px]';
export const SIZE_SM = 'px-3 py-2 text-[13px]';

/** Every text field on the surface. */
export const FIELD =
  'w-full rounded-md border border-white/12 bg-black/40 px-3.5 py-3 text-[15px] text-white transition-colors duration-200 placeholder:text-brand-text-muted focus:border-brand-gold focus:outline-none disabled:cursor-not-allowed disabled:text-brand-text-muted';
export const LABEL = 'block text-[13px] font-medium text-brand-text-muted';

/**
 * The overlay shell, with the things the old modals did not have.
 *
 * Escape closes it, and the backdrop is a real click target — both were
 * missing from all four dialogs here, so the only way out of a payment sheet
 * was a 20px × icon in the corner. `role="dialog"` and the title association
 * were missing too, which on a screen reader made these four unlabelled
 * groups of buttons floating over a page that was still readable behind them.
 *
 * And it is a conditional render rather than an `AnimatePresence` child. The
 * exit animation did not complete — see the note on `.overlay-in` in
 * index.css — which left every dismissed sheet mounted at `opacity: 0` as a
 * `fixed inset-0` pane over the whole portal, eating every click after it.
 */
export function Modal({
  title,
  note,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  note?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = React.useId();

  /* Escape, the focus trap, the scroll lock and giving the keyboard back to
     whatever opened this. It had the first of those four and none of the other
     three — so `aria-modal="true"` above was telling a screen reader the page
     behind was inert while Tab walked straight out into it. See useDialog. */
  const sheet = useDialog<HTMLDivElement>({ open: true, onClose });

  return (
    <div className="overlay-in fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      {/* The backdrop, as its own element rather than an `onClick` on the
          container — a click that started inside the sheet and ended outside
          it should not close the sheet. */}
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
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`sheet-in relative flex max-h-[92svh] w-full flex-col rounded-t-md border border-white/10 bg-brand-card outline-none sm:rounded-md ${
          wide ? 'sm:max-w-lg' : 'sm:max-w-md'
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[24px] font-medium leading-tight text-white">
              {title}
            </h2>
            {note && <p className="mt-1 text-[13px] leading-relaxed text-brand-text-muted">{note}</p>}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Paid, or not yet. The only two states worth a colour on an order. */
export function PaymentPill({ booking }: { booking: Booking }) {
  const paid = booking.paymentStatus === 'Paid';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[13px] font-medium ${
        paid
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
      }`}
    >
      {paid && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
      {paid ? 'Paid' : 'Unpaid'}
    </span>
  );
}

/**
 * A stored date, written the way somebody would say it.
 *
 * Dates come off a booking as `2026-08-30` and were printed exactly like that,
 * which was tolerable in 10px mono at the bottom of a card and is not at the
 * 21px this now sets "Back to you" in. Parsed as UTC and formatted as UTC, the
 * way the reschedule sheet already does it: these are calendar days, not
 * instants, and reading `2026-08-30` in local time west of Greenwich turns it
 * into the 29th.
 *
 * Anything that is not an ISO day is handed back untouched — a booking made
 * before the format settled should still print something true.
 */
export function dayLabel(date: string | undefined | null): string {
  if (!date) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;

  return parsed.toLocaleDateString('en-GH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * A pickup or delivery slot: the day, then the hours.
 *
 * The hours go through core's own labels — see `ui/slots` — so the portal, the
 * landing and the receipt all say "08:00 – 11:00" rather than the portal
 * saying "08:00 AM - 11:00 AM (Morning Concierge)" on its own.
 */
export function whenLine(date: string | undefined, time: string | undefined): string {
  return [dayLabel(date), windowLabel(time)].filter(Boolean).join(', ');
}


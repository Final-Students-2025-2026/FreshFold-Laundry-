/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The supervisor desk's building blocks.
 *
 * These exist so the desk reads as one instrument rather than five screens.
 * The rules they encode, once, instead of per-callsite:
 *
 * - Shape is consistent: cards are `rounded-2xl` with one soft lift, controls
 *   are pills. Nothing on the desk has a square corner.
 * - Colour is semantic. Neutral is the default; green/amber/red mean paid,
 *   pending, wrong. Sage means "this is the primary action", gold means "this
 *   is selected". Nothing is coloured to look expensive.
 * - Numbers are tabular so a column of cedi amounts lines up on the decimal.
 * - Uppercase-with-wide-tracking is for column headers only — at 30 rows it
 *   stops being a style and starts being an obstacle.
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-admin-fg-2 border-admin-line',
  ok: 'bg-admin-ok/12 text-admin-ok border-admin-ok/25',
  warn: 'bg-admin-warn/12 text-admin-warn border-admin-warn/25',
  danger: 'bg-admin-danger/12 text-admin-danger border-admin-danger/25',
  info: 'bg-admin-info/12 text-admin-info border-admin-info/25',
  accent: 'bg-admin-accent/12 text-admin-accent border-admin-accent/25',
};

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-admin-fg-3',
  ok: 'bg-admin-ok',
  warn: 'bg-admin-warn',
  danger: 'bg-admin-danger',
  info: 'bg-admin-info',
  accent: 'bg-admin-accent',
};

/** A status chip. Small, pill-shaped, never shouty. */
export function Badge({
  tone = 'neutral',
  dot = false,
  mono = false,
  children,
  className = '',
}: {
  tone?: Tone;
  dot?: boolean;
  mono?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ${
        mono ? 'font-mono tabular-nums' : ''
      } ${TONE_SOFT[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />}
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'destructive';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-admin-primary text-white hover:brightness-115 border-transparent font-semibold shadow-sm',
  accent:
    'bg-admin-accent text-black hover:bg-admin-accent/90 border-transparent font-semibold shadow-sm',
  secondary:
    'bg-admin-raised text-admin-fg hover:bg-admin-hover border-admin-line hover:border-admin-line-strong',
  ghost:
    'bg-transparent text-admin-fg-2 hover:text-admin-fg hover:bg-white/[0.06] border-transparent',
  danger:
    'bg-transparent text-admin-danger hover:bg-admin-danger/12 border-transparent hover:border-admin-danger/30',
  /**
   * The one filled red on the desk, reserved for the confirming button of a
   * dialog that is about to do something irreversible. `danger` above is the
   * quiet ghost that *opens* such a dialog — a row full of solid red buttons
   * teaches somebody to click through red, which is the opposite of the point.
   */
  destructive:
    'bg-admin-danger text-black hover:brightness-110 border-transparent font-semibold shadow-sm',
};

/**
 * Ref-forwarding, so a dialog can put the keyboard on its Cancel button. A
 * `useDialog` call site needs a real element to focus and cannot reach through
 * a plain function component to get one.
 */
export const Button = React.forwardRef<
  HTMLButtonElement,
  {
    variant?: ButtonVariant;
    size?: 'sm' | 'md';
    icon?: React.ComponentType<{ className?: string }>;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className = '', ...rest }, ref) {
  const sizing =
    size === 'sm' ? 'h-7 px-2.5 text-[12px] gap-1.5' : 'h-9 px-3.5 text-[13px] gap-1.5';
  return (
    <button
      type="button"
      ref={ref}
      {...rest}
      className={`inline-flex items-center justify-center rounded-full border transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/60 ${sizing} ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  );
});

/** A titled card. One border, one lift — cards never nest visibly. */
export function Panel({
  title,
  description,
  actions,
  bodyClassName = '',
  className = '',
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  bodyClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`admin-card overflow-hidden rounded-2xl border border-admin-line bg-admin-panel ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-admin-fg">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-[12px] leading-snug text-admin-fg-3">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Pill text input, sized for a toolbar. */
export function Input({
  icon: Icon,
  className = '',
  ...rest
}: { icon?: React.ComponentType<{ className?: string }> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative ${className}`}>
      {Icon && (
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-fg-3" />
      )}
      <input
        {...rest}
        className={`h-9 w-full rounded-full border border-admin-line bg-admin-raised text-[13px] text-admin-fg placeholder:text-admin-fg-3 transition-colors focus:border-admin-accent/60 focus:outline-none focus:ring-2 focus:ring-admin-accent/15 ${
          Icon ? 'pl-10 pr-4' : 'px-4'
        }`}
      />
    </div>
  );
}

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={`h-9 cursor-pointer rounded-full border border-admin-line bg-admin-raised px-3.5 text-[13px] text-admin-fg-2 transition-colors hover:border-admin-line-strong focus:border-admin-accent/60 focus:text-admin-fg focus:outline-none ${className}`}
    >
      {children}
    </select>
  );
}

/** Labelled form field for the side panels. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12px] font-medium text-admin-fg-2">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-admin-fg-3">{hint}</span>}
    </label>
  );
}

/** Empty-state block, so every pane fails the same way. */
export function EmptyState({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full border border-admin-line bg-admin-raised">
        <Icon className="h-5 w-5 text-admin-fg-3" />
      </span>
      <p className="text-[13px] font-medium text-admin-fg-2">{title}</p>
      {detail && <p className="max-w-sm text-[12px] leading-relaxed text-admin-fg-3">{detail}</p>}
      {action}
    </div>
  );
}

/**
 * Column header strip for the dense tables. Hidden below `md`, where the rows
 * render as stacked cards and headers would describe nothing.
 */
export function TableHead({
  columns,
  className = '',
}: {
  columns: { label: string; className?: string }[];
  className?: string;
}) {
  return (
    <div
      className={`hidden border-y border-admin-line bg-admin-raised/60 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-admin-fg-3 md:grid ${className}`}
    >
      {columns.map((c) => (
        <span key={c.label} className={c.className}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

/** Cedi amounts, always two decimals, always tabular. */
export function formatCedis(amount: number): string {
  return `₵${amount.toFixed(2)}`;
}

/**
 * A pane-level failure, stated once.
 *
 * Five panes each grew their own red bar with slightly different padding,
 * wording and retry affordance. They are all reporting the same class of thing
 * — "we asked the server and it did not answer" — and the whole reason the
 * resources hold their errors instead of rendering an empty list is so this can
 * say which of the two happened.
 *
 * `onRetry` is optional because not every failure has a retry: a desk with no
 * token cannot re-read anything, and offering a button that will fail the same
 * way is worse than not offering one.
 */
export function Banner({
  tone = 'danger',
  children,
  onRetry,
}: {
  tone?: 'danger' | 'warn';
  children: React.ReactNode;
  onRetry?: () => void;
}) {
  const skin =
    tone === 'warn'
      ? 'border-admin-warn/25 bg-admin-warn/10 text-admin-warn'
      : 'border-admin-danger/25 bg-admin-danger/10 text-admin-danger';

  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${skin}`}
    >
      <p className="flex min-w-0 items-start gap-2 text-[12px] leading-relaxed">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0">{children}</span>
      </p>
      {onRetry && (
        <Button size="sm" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * One number in a pane's summary row.
 *
 * Replaces `Metric`, a bordered card with an icon roundel. Those were the
 * shell's global strip — four of them above every pane, including the seven
 * they said nothing about — and a pane that rendered its own three underneath
 * produced two rows of boxes before the first row of data. A summary that
 * belongs to the list underneath it does not need a box of its own; it needs to
 * be legible in one glance and to take one line.
 */
export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  const valueTone: Record<Tone, string> = {
    neutral: 'text-admin-fg',
    accent: 'text-admin-accent',
    ok: 'text-admin-ok',
    warn: 'text-admin-warn',
    danger: 'text-admin-danger',
    info: 'text-admin-info',
  };

  return (
    <div className="min-w-0">
      <span className="block truncate text-[11px] font-medium text-admin-fg-3">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={`font-mono text-[17px] leading-6 font-semibold tabular-nums ${valueTone[tone]}`}
        >
          {value}
        </span>
        {hint && <span className="truncate text-[11px] text-admin-fg-3">{hint}</span>}
      </span>
    </div>
  );
}

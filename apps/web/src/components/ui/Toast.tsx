import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';

/**
 * Short confirmations that do not deserve a dialog.
 *
 * The site had two ways to tell somebody what just happened: a `Banner` inside
 * a panel, which needs a panel to sit in and stays until something re-renders
 * it, and a label on the button that was pressed. Neither fits an outcome that
 * arrives *after* the button has been let go, or that has to report a failure
 * the button cannot show.
 *
 * The copy control in `RosterPanel` is the case that prompted this. It swapped
 * its own label to "Copied" — but it did so unconditionally, next to a
 * `navigator.clipboard?.writeText()` whose promise nothing awaited. On a
 * browser with no clipboard API, or one that refused the write because the
 * document was not focused, it reported success for something that had not
 * happened, and a supervisor read a rider their PIN off an empty paste.
 *
 * A toast is the right size for that class of thing: it happened, here is
 * whether it worked, and you do not need to acknowledge it. Anything a
 * customer must act on is a `Banner` or a dialog and stays on the screen.
 *
 * `--z-toast` has been in the token stack since it was written and nothing had
 * ever used it. This is what it was for.
 */

export type ToastTone = 'ok' | 'bad' | 'note';

/**
 * Which surface the toast is landing on.
 *
 * The site and the supervisor desk are two visual worlds on purpose — the desk
 * has its own `--color-admin-*` palette rather than the marketing brand's,
 * because it is an instrument somebody stares at for a whole shift. Before this
 * the desk rendered *both*: `RosterPanel` called `useToast` and got a
 * brand-emerald pill, while the dashboard shell had a second, admin-skinned
 * toast of its own, and the two appeared in different corners of the same
 * screen for the same class of event.
 *
 * One component, two skins, and providers nest: the desk mounts its own
 * `ToastProvider skin="desk"` inside the site's, so `useToast` resolves to the
 * nearer one and every call site keeps working untouched.
 */
export type ToastSkin = 'site' | 'desk';

const SKINS: Record<ToastSkin, { tone: Record<ToastTone, string>; shell: string; region: string }> = {
  site: {
    tone: {
      ok: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
      bad: 'border-red-500/25 bg-red-500/10 text-red-200',
      note: 'border-brand-gold/30 bg-brand-gold/10 text-brand-gold-light',
    },
    shell:
      'rounded-md bg-brand-card px-4 py-3 text-[14px] shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-sm',
    region: 'font-ui bottom-24 left-4 right-4 sm:bottom-5 sm:left-auto sm:right-5',
  },
  desk: {
    tone: {
      ok: 'border-admin-ok/30 bg-admin-ok/12 text-admin-ok',
      bad: 'border-admin-danger/30 bg-admin-danger/12 text-admin-danger',
      note: 'border-admin-accent/30 bg-admin-accent/12 text-admin-accent',
    },
    shell:
      'admin-card rounded-xl bg-admin-panel px-4 py-2.5 text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.55)]',
    region: 'font-sans bottom-4 left-4 right-4 sm:bottom-5 sm:left-auto sm:right-5',
  },
};

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

/** Long enough to read a short sentence twice, which is the usual advice. */
const DISMISS_MS = 4200;

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

/**
 * Raise a toast.
 *
 * Safe to call from anywhere below the provider, including from a component
 * that may be rendered outside it — it returns a no-op rather than throwing,
 * because a missing toast is never worth taking a screen down for.
 */
export function useToast(): (message: string, tone?: ToastTone) => void {
  const show = useContext(ToastContext);
  return show ?? noop;
}

const noop = () => {};

export function ToastProvider({
  skin = 'site',
  children,
}: {
  skin?: ToastSkin;
  children: React.ReactNode;
}) {
  const surface = SKINS[skin];
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: ToastTone = 'ok') => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, DISMISS_MS);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  // `show` is stable, so this context value never changes identity and no
  // consumer re-renders because a toast appeared somewhere else on the page.
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/*
        Bottom-left on a phone, bottom-right on a desk.

        Not bottom-right on a phone: that is where the sticky booking bar's
        button is, and a toast that covers "Book a pickup" for four seconds is
        worse than no toast. `bottom-24` clears the bar itself.
      */}
      <div
        // The region is always mounted and always announced, so a toast that
        // arrives into it is read out. A live region created at the same
        // moment as its content is not reliably announced by any screen
        // reader — the region has to exist first.
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed z-[var(--z-toast)] flex flex-col items-start gap-2 sm:items-end ${surface.region}`}
      >
        {toasts.map((toast) => {
          const tone = surface.tone[toast.tone];
          const Icon = toast.tone === 'ok' ? Check : toast.tone === 'bad' ? AlertTriangle : Info;

          return (
            <div
              key={toast.id}
              className={`toast-in pointer-events-auto flex max-w-[24rem] items-start gap-2.5 border leading-relaxed ${surface.shell} ${tone}`}
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 shrink-0 rounded p-1 opacity-60 transition-opacity duration-200 hover:opacity-100"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

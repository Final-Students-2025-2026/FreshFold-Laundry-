/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desk's confirmations.
 *
 * Four irreversible actions — refund, delete order, delete patron, restore
 * access — ran on `window.confirm`. That is a native modal: unstyled, outside
 * the desk's palette, impossible to give a real focus ring or a named button,
 * and in the refund's case a `\n\n`-joined paragraph rendered as a wall of
 * system-font text over a laundry's ledger. It also blocks the main thread, so
 * nothing on the board updates while it is up.
 *
 * The replacement is worth more than the styling. `window.confirm` has exactly
 * two words available, OK and Cancel, so every one of those dialogs had to put
 * the actual verb in the question and hope it was read. Here the button says
 * what it does — "Refund ₵45.00", "Delete order" — which is the one thing
 * somebody skimming a dialog reliably looks at.
 *
 * `useDialog` supplies Escape, the focus trap and focus restoration, so this is
 * the fifth overlay on the site that cannot be written with three of the four.
 *
 * Cancel takes the initial focus, deliberately. Every dialog this raises is
 * destructive, and the safe answer should be the one a hurried Return lands on.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { useDialog } from '../ui/useDialog';
import { Button } from './ui';

export interface ConfirmSpec {
  /** The question, as a sentence fragment: "Delete order 481920?" */
  title: string;
  /** What it means, in one or two sentences. Optional but usually deserved. */
  body?: React.ReactNode;
  /** The verb on the button. Says what happens, never "OK". */
  confirmLabel: string;
  /** `danger` for anything that does not come back. */
  tone?: 'danger' | 'primary';
  cancelLabel?: string;
}

type Ask = (spec: ConfirmSpec) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/**
 * Ask before doing something irreversible.
 *
 * Resolves `false` rather than rejecting when dismissed — a cancelled action is
 * an ordinary outcome, not an error, and making callers wrap every confirmation
 * in a `try` is how a `catch` ends up swallowing the failure of the action
 * itself.
 *
 * Falls back to `window.confirm` outside a provider so a pane rendered on its
 * own still asks, rather than silently proceeding.
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  return ask ?? fallbackAsk;
}

const fallbackAsk: Ask = (spec) =>
  Promise.resolve(window.confirm(`${spec.title}\n\n${spec.confirmLabel}?`));

interface Pending extends ConfirmSpec {
  resolve: (answer: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback<Ask>(
    (spec) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          // A second question while one is up answers the first as cancelled.
          // Queueing them would stack dialogs over a ledger; dropping the new
          // one silently would leave its caller's promise unsettled forever.
          current?.resolve(false);
          return { ...spec, resolve };
        });
      }),
    [],
  );

  const settle = useCallback((answer: boolean) => {
    setPending((current) => {
      current?.resolve(answer);
      return null;
    });
  }, []);

  const value = useMemo(() => ask, [ask]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {pending && <ConfirmDialog spec={pending} onSettle={settle} />}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  spec,
  onSettle,
}: {
  spec: ConfirmSpec;
  onSettle: (answer: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const container = useDialog<HTMLDivElement>({
    open: true,
    onClose: () => onSettle(false),
    initialFocus: cancelRef,
    // The desk scrolls in its own container, not on the body, so locking the
    // body would restore an overflow this overlay never set.
    lockScroll: false,
  });

  const danger = spec.tone !== 'primary';

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onClick={() => onSettle(false)}
        className="absolute inset-0 bg-black/70"
      />

      <motion.div
        ref={container}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="desk-confirm-title"
        aria-describedby={spec.body ? 'desk-confirm-body' : undefined}
        tabIndex={-1}
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className="admin-card relative w-full max-w-md rounded-2xl border border-admin-line-strong bg-admin-panel p-5 focus:outline-none"
      >
        <div className="flex gap-3.5">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
              danger
                ? 'border-admin-danger/25 bg-admin-danger/12 text-admin-danger'
                : 'border-admin-accent/25 bg-admin-accent/12 text-admin-accent'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </span>

          <div className="min-w-0 flex-1">
            <h2
              id="desk-confirm-title"
              className="text-[15px] font-semibold leading-snug text-admin-fg"
            >
              {spec.title}
            </h2>
            {spec.body && (
              <div
                id="desk-confirm-body"
                className="mt-1.5 text-[13px] leading-relaxed text-admin-fg-2"
              >
                {spec.body}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={() => onSettle(false)}>
            {spec.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={danger ? 'destructive' : 'primary'}
            onClick={() => onSettle(true)}
          >
            {spec.confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

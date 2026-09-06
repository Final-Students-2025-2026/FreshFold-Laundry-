import { useEffect, useRef } from 'react';

/**
 * The four things every overlay on this site owes a keyboard.
 *
 * `BookingModal` grew all of them itself — Escape, a focus trap, a scroll
 * lock, and focus put somewhere sensible on open. The shared `Modal` in
 * `portal.tsx` and `RescheduleDrawer` grew two of the four: both set
 * `role="dialog" aria-modal="true"` and both handle Escape, and neither traps
 * focus or locks the scroll. `aria-modal="true"` is a *claim* that the rest of
 * the page is inert; a screen reader acts on it, so a Tab that walks out of
 * the sheet and into the marketing nav behind it lands somewhere the reader
 * has been told does not exist. The header's own drawer had the lock and
 * Escape but never restored focus, so dismissing it dropped the keyboard back
 * at the top of the document.
 *
 * One hook, so a fifth overlay cannot be written with three of the four.
 *
 * ## What it does not do
 *
 * It does not render anything and it does not set `role` or `aria-modal` — the
 * call site owns its own markup, and a hook that reached in to set attributes
 * on it would be the sort of thing you have to fight later.
 */
export interface DialogOptions {
  /** No-op while false, so a call site can keep the hook above its own early return. */
  open: boolean;
  onClose: () => void;
  /**
   * Where focus goes on open. Defaults to the container, which is right for a
   * sheet that opens onto prose; pass a field for one that opens onto a form.
   *
   * Not the first focusable element by default, on purpose: that is usually
   * the close button, and starting a screen reader on "Close" tells somebody
   * nothing about what just opened.
   */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Set false for a sheet the page is meant to stay scrollable behind. */
  lockScroll?: boolean;
}

/** Everything a Tab can reach, in document order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialog<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  initialFocus,
  lockScroll = true,
}: DialogOptions) {
  const container = useRef<T | null>(null);

  /**
   * `onClose` in a ref, so the effect below does not re-run on every render of
   * a parent that passes an inline arrow — which is all of them. Re-running it
   * would re-take focus mid-interaction and, worse, run the scroll-lock
   * cleanup while the dialog is still open.
   */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = container.current;
    if (!node) return;

    // Who to give the keyboard back to. Read before anything is focused.
    const opener = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }

      if (event.key !== 'Tab') return;

      // Read on every Tab rather than cached on open: these dialogs change
      // shape as they are used — the booking form swaps its whole step, the
      // payment sheet grows a field — and a list captured at mount would be
      // trapping focus against buttons that are no longer there.
      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );
      if (focusable.length === 0) {
        // Nothing to land on: keep the keyboard in the dialog rather than
        // letting it escape to the page behind.
        event.preventDefault();
        node.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture, so a dialog opened from inside another dialog takes Escape
    // first and closes only itself.
    document.addEventListener('keydown', onKeyDown, true);

    let previousOverflow = '';
    if (lockScroll) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    /**
     * Focus, immediately and then again one frame later.
     *
     * Both attempts are needed, for opposite reasons:
     *
     *  - **Immediately**, because `requestAnimationFrame` does not fire at all
     *    in a hidden or fully occluded tab. A dialog opened there — a payment
     *    sheet in a background tab, a desk restored by the browser — would get
     *    no focus, and the trap below would then be anchored on whatever was
     *    focused outside it, which is worse than no trap.
     *  - **A frame later**, because these dialogs animate in, and an element
     *    that is still `opacity: 0` and mid-transform is not reliably
     *    focusable — Safari refuses and leaves focus on the body, which
     *    silently disarms the trap for the whole session.
     *
     * The second attempt is conditional, so it cannot pull focus back off a
     * field the reader has already reached in the meantime.
     */
    const focusTarget = () => (initialFocus?.current ?? node);
    focusTarget().focus({ preventScroll: true });

    const focusFrame = requestAnimationFrame(() => {
      if (!node.contains(document.activeElement)) {
        focusTarget().focus({ preventScroll: true });
      }
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown, true);
      if (lockScroll) document.body.style.overflow = previousOverflow;

      // Give the keyboard back to whatever opened this, if it is still on the
      // page — a dialog opened from a row that the dialog itself deleted has
      // nowhere to return to, and focusing a detached node throws focus to the
      // body anyway.
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, lockScroll, initialFocus]);

  return container;
}

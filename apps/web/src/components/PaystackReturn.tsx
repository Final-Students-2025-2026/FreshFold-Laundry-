import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import PaystackMark from './ui/PaystackMark';

/**
 * Where Paystack sends the browser back to.
 *
 * Both checkouts on this site hand Paystack `${origin}/#paystack-success` as
 * their `callback_url`, and until this existed nothing in the app matched that
 * hash. `App`'s hash router recognises `#portal` and `#admin` and treats
 * everything else as "close the portal", so a customer who had just paid
 * watched the 600×750 checkout popup fill up with the marketing homepage —
 * scrollable, complete with its own "Schedule Pickup" buttons, and with nothing
 * anywhere on it to say the payment had landed.
 *
 * Two ways this is reached, and they want different endings:
 *
 *  - **In the popup** the checkout was opened in, which is the normal path.
 *    There is a window behind this one still holding the reference, so the job
 *    is to tell it we are back and get out of the way.
 *  - **In the tab itself**, if the popup was blocked and the customer followed
 *    the link by hand, or if their browser opened it as a tab anyway — phones
 *    routinely do. There is nothing behind it, so it has to be a page somebody
 *    can read and leave from.
 *
 * What it deliberately does not do is decide that the payment succeeded. The
 * redirect fires for an abandoned checkout as readily as a settled one, and the
 * only thing that may move money is the server re-verifying the reference —
 * `/accounts/wallet` for a top-up, `POST /bookings/:id/payment` for a bill. So
 * the wording here says the checkout is finished, not that the money arrived,
 * and the opener is asked to go and check.
 */

/**
 * Reserves the checkout window while the click is still a click.
 *
 * All three Paystack buttons on this site used to call
 * `window.open(authorization_url, …)` at the end of their handler — after
 * `await fetch('/api/paystack/initialize')` and after `await res.json()`. A
 * browser only honours `window.open` while a user gesture is still live, and a
 * network round trip outlives that window by a wide margin, so every one of
 * those calls was a pop-up opened by a script rather than by a person. Chrome,
 * Safari and Firefox all block that silently: no dialog, no exception, no
 * console line. The button spun, the request succeeded, the transaction was
 * created at Paystack — and nothing appeared. It read as a payment step the site
 * simply skipped.
 *
 * So the window is claimed first, in the same tick as the click, and pointed at
 * the checkout once the URL comes back. `about:blank` inherits this origin, so
 * the holding message below can be written into it and the later
 * `location.replace` is a same-origin navigation rather than a second open.
 *
 * `send` returning false is the one case worth telling the customer about: a
 * browser configured to block pop-ups outright still refuses this, and then the
 * link each panel already renders is the way through. It is never a reason to
 * fail the payment — the transaction exists either way, and its reference is
 * held by the screen that asked for it.
 */
export interface CheckoutWindow {
  /** Points the held window at the checkout. False if there is none to point. */
  send(url: string): boolean;
  /** Closes the held window — the checkout was never created. */
  cancel(): void;
}

export function openCheckoutWindow(): CheckoutWindow {
  let held: Window | null = null;

  try {
    held = window.open('', '_blank', 'width=600,height=750');
  } catch {
    // Blocked, or no `window` worth the name. The link fallback covers it.
    held = null;
  }

  if (held) {
    try {
      // A blank pop-up sitting white for the length of a round trip reads as a
      // window that failed to load. Same-origin, so this is allowed.
      held.document.write(
        '<!doctype html><meta charset="utf-8"><title>Opening Paystack…</title>' +
          '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
          'height:100vh;background:#161616;color:#a8a29e;font:14px system-ui,sans-serif">' +
          'Opening the Paystack checkout…</body>'
      );
      held.document.close();
    } catch {
      // Cosmetic only — a window we cannot write to is still a window we can
      // navigate.
    }
  }

  return {
    send(url) {
      if (!held || held.closed) return false;
      try {
        // `replace` rather than assignment, so the holding page above does not
        // become a history entry the customer can go "back" to.
        held.location.replace(url);
        held.focus();
        return true;
      } catch {
        return false;
      }
    },
    cancel() {
      try {
        if (held && !held.closed) held.close();
      } catch {
        // Already gone, which is the outcome this wanted.
      }
      held = null;
    },
  };
}

/** What the popup sends its opener. Read by `usePaystackReturn` below. */
export const PAYSTACK_RETURN_MESSAGE = 'freshfold:paystack-return';

export default function PaystackReturn() {
  // Whether there is an opener to hand back to. `false` puts the customer on a
  // page with a way out instead of a window that is about to close itself.
  const [inPopup, setInPopup] = useState(false);

  useEffect(() => {
    let opener: Window | null = null;
    try {
      // Cross-origin access to `window.opener` throws; ours never is, but a
      // customer arriving from somewhere unexpected should land on the panel
      // below rather than on an exception.
      opener = window.opener && !window.opener.closed ? window.opener : null;
    } catch {
      opener = null;
    }

    if (!opener) return;
    setInPopup(true);

    // Targeted at our own origin rather than `'*'`: this says a payment
    // reference is worth re-checking, and it does not need broadcasting to
    // whatever else may be listening.
    try {
      opener.postMessage({ type: PAYSTACK_RETURN_MESSAGE }, window.location.origin);
    } catch {
      // Opener gone between the check and the post. The panel below still
      // renders, so the customer is not stranded.
    }

    // Long enough to be read as an answer rather than a flicker, short enough
    // that nobody is left waiting on it. A window this tab did not open cannot
    // be closed by script, so the panel stays put on that path — which is why
    // it reads as something finished rather than something in progress.
    const timer = setTimeout(() => window.close(), 1800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-brand-charcoal text-white font-sans antialiased flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-[#161616] rounded-2xl border border-white/10 p-8 text-center space-y-4 shadow-2xl">
        {/* Both marks, because this window is the seam between the two
            businesses: the customer arrived here from Paystack's checkout and
            is about to be handed back to FreshFold, and saying so with the
            same mark they just paid under is what makes the jump legible. */}
        <div className="flex items-center justify-center gap-3">
          <span className="inline-flex p-3 bg-brand-sage/15 rounded-full border border-brand-sage/25 text-brand-sage">
            <CheckCircle2 className="w-8 h-8" />
          </span>
          <PaystackMark className="h-6 w-6" />
        </div>

        <div className="space-y-2">
          <span className="font-mono text-[9px] text-brand-sage uppercase tracking-widest block font-bold">
            FreshFold
          </span>
          <h1 className="font-serif text-xl text-white">Checkout complete</h1>
          <p className="text-xs text-stone-400 leading-relaxed">
            {inPopup
              ? 'You can close this window — we are confirming the payment on the page behind it.'
              : 'Head back to your patron portal to confirm the payment against your order.'}
          </p>
        </div>

        {!inPopup && (
          <button
            type="button"
            onClick={() => {
              window.location.hash = '#portal';
            }}
            className="w-full py-3 bg-brand-sage text-white rounded-xl text-xs font-bold font-sans uppercase tracking-widest hover:bg-brand-sage-light transition-all cursor-pointer shadow-lg"
          >
            Return to Patron Portal
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Runs `onReturn` when the checkout popup this window opened comes back.
 *
 * The screen that opened the checkout is the only one holding the reference, so
 * it is the only one that can settle against it — this is how it finds out the
 * customer is finished without them having to press "I have paid" first. That
 * button stays where it is: a popup blocked, closed by hand, or opened as a tab
 * on a phone never sends this, and the manual path is what covers all three.
 *
 * The origin check is the point of the whole handler. `message` fires for
 * anything any frame or window cares to send, so without it this is a way for
 * any page the customer has open to make this one re-verify.
 */
export function usePaystackReturn(onReturn: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: string } | null)?.type !== PAYSTACK_RETURN_MESSAGE) return;
      onReturn();
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onReturn, enabled]);
}

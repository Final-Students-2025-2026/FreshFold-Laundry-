import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CloudOff, Clock, LogIn, RefreshCw } from 'lucide-react';
import * as store from '../../services/store';

/**
 * Says out loud what the store has always quietly done.
 *
 * `services/store.ts` is built to survive a dropped connection: a write that
 * cannot reach the dispatch server is queued in `localStorage` and replayed
 * when it can, which is the right design for a site used on Kumasi mobile data
 * from inside a hall of residence. It already tracks both halves of that —
 * `isOnline()` and `pendingWriteCount()` — and nothing on the page had ever
 * rendered either.
 *
 * So the failure mode was a good mechanism with no interface: somebody books a
 * pickup on a connection that has gone, gets a confirmation screen, and the
 * order sits in their browser. It *will* send. But they have been told it was
 * sent, which is a different claim, and the difference is a customer waiting
 * in for a rider who was never dispatched.
 *
 * Four states, because they need different words:
 *
 *  - **Offline with nothing queued** — a warning. Nothing is lost; nothing is
 *    in flight either.
 *  - **Offline with writes queued** — a promise. This is the one that matters:
 *    it names how many, and it is what lets someone close the tab without
 *    wondering.
 *  - **Queued behind an expired session** — a promise that needs something from
 *    the reader. The connection is fine and waiting will not help, so this is
 *    the one state the strip asks for an action instead of reporting one. It
 *    exists because the queue now holds these writes rather than discarding
 *    them; before, the promise above was made and then quietly broken.
 *  - **Waking** — the gateway is answering instead of the server, which on the
 *    free plan means it is booting and will be along in under a minute. Reading
 *    that as a dropped connection sent people to check a network that was fine.
 *
 * Nothing shows when the connection is fine and the queue is empty, which is
 * almost always — nor before anything is known, which is the state this used to
 * render as "no connection" for as long as the first request took.
 *
 * A permanent "you are online" badge is noise that trains people to stop
 * reading the strip it lives in.
 */
export default function ConnectionBanner() {
  const [state, setState] = useState(() => store.connectionState());
  const [pending, setPending] = useState(() => store.pendingWriteCount());
  const [blocked, setBlocked] = useState(() => store.isQueueBlockedOnAuth());

  useEffect(() => {
    const sync = () => {
      setState(store.connectionState());
      setPending(store.pendingWriteCount());
      setBlocked(store.isQueueBlockedOnAuth());
    };

    // The store notifies on every poll and every queue movement, which covers
    // the server going away while the browser still believes it has a network
    // — the common case on a captive portal or a stalled mobile connection,
    // and one `navigator.onLine` reports as fine.
    const unsubscribe = store.subscribe(sync);

    // The browser's own events are still worth listening to: they fire the
    // instant the interface changes, where the store finds out on its next
    // poll up to five seconds later.
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();

    return () => {
      unsubscribe();
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const online = state === 'online';
  const waking = state === 'waking';

  // Blocked is not syncing: the writes are held for a sign-in, not in flight.
  const syncing = online && pending > 0 && !blocked;
  // `unknown` says nothing: no attempt has come back yet, either way.
  const hidden = state === 'unknown' || (online && pending === 0);

  /**
   * Tell the rest of the page how tall this is.
   *
   * This is `position: fixed` at the top of the viewport, and so is every
   * top-level surface on this site — the marketing header, the client portal,
   * the supervisor desk. Without an offset it simply covers whichever one is
   * on screen. A padding on `body` would not help: fixed elements are
   * positioned against the viewport, not the document.
   *
   * So each of those carries `.below-banner`, which reads this variable. See
   * index.css.
   *
   * Measured rather than assumed, because the message wraps to two and
   * sometimes three lines on a narrow phone — and a hard-coded height would
   * put the header back over the text at exactly the widths where the message
   * matters most.
   */
  const bar = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = bar.current;
    const root = document.documentElement;

    if (!node) {
      root.style.removeProperty('--banner-h');
      return;
    }

    const measure = () => root.style.setProperty('--banner-h', `${node.offsetHeight}px`);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => {
      observer.disconnect();
      root.style.removeProperty('--banner-h');
    };
  }, [hidden, syncing, blocked, waking, pending]);

  if (hidden) return null;

  return (
    <div
      ref={bar}
      // `polite`: this is worth hearing, but not worth interrupting somebody
      // mid-sentence to say.
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[var(--z-toast)] font-ui"
    >
      <div
        className={`flex items-center justify-center gap-2.5 px-4 py-2 text-[13.5px] font-medium ${
          syncing
            ? 'bg-brand-sage text-white'
            : 'bg-brand-gold text-brand-charcoal'
        }`}
      >
        {syncing ? (
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : blocked ? (
          <LogIn aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        ) : waking ? (
          <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <CloudOff aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="text-center">
          {syncing ? (
            <>
              Back online — sending {pending} {pending === 1 ? 'change' : 'changes'}…
            </>
          ) : blocked ? (
            <>
              Your session ended. {pending} {pending === 1 ? 'change is' : 'changes are'} saved on
              this device and will send when you sign in again.
            </>
          ) : waking ? (
            <>
              The dispatch server is starting up — this takes about a minute.
              {pending > 0 ? (
                <>
                  {' '}
                  {pending} {pending === 1 ? 'change is' : 'changes are'} saved and will send as
                  soon as it answers.
                </>
              ) : null}
            </>
          ) : pending > 0 ? (
            <>
              No connection. {pending} {pending === 1 ? 'change is' : 'changes are'} saved on this
              device and will send when you are back.
            </>
          ) : (
            <>No connection. You can keep reading; anything you send will wait.</>
          )}
        </span>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';

/**
 * What shows while one of the lazy screens is on the wire.
 *
 * The `Suspense` fallback for all four heavy surfaces used to be `null`, on
 * the reasoning that each mounts into a space that was empty a moment ago, so
 * an empty space is the honest intermediate state. That holds for the several
 * hundred milliseconds it takes on a desk connection. It does not hold on
 * Kumasi mobile data, where the booking chunk is 40 KB over a link that may be
 * doing 30 KB/s: "Book a pickup" is pressed, nothing happens for two seconds,
 * and the customer presses it again — which is exactly the reading a button
 * that does nothing invites.
 *
 * So: nothing for the first {@link DELAY_MS}, then a plain, quiet acknowledgement.
 *
 * The delay is the whole design. A spinner that appears and vanishes inside
 * 200ms is a flash of anxiety over a wait nobody would otherwise have noticed,
 * and it makes a fast page feel busier than a slow one. Below the threshold
 * this component renders exactly what it replaced.
 */
const DELAY_MS = 260;

export default function Pending({ label = 'Loading' }: { label?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-brand-charcoal/70 p-5 font-ui backdrop-blur-sm"
      // `polite`, not `assertive`: this is a progress note, and it should wait
      // its turn behind whatever the reader was already being told.
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-md border border-white/10 bg-brand-card px-5 py-4">
        {/* The dots are the animation. A rotating ring reads as "working" in a
            way that sets a clock running; three dots read as "on its way".
            Both collapse to a static mark under reduced motion — see
            `.pending-dot` in index.css. */}
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="pending-dot h-1.5 w-1.5 rounded-full bg-brand-gold" />
          <span className="pending-dot h-1.5 w-1.5 rounded-full bg-brand-gold" />
          <span className="pending-dot h-1.5 w-1.5 rounded-full bg-brand-gold" />
        </span>
        <span className="text-[15px] text-white">{label}…</span>
      </div>
    </div>
  );
}

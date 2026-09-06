import { useEffect, useRef, useState } from 'react';

const motionAllowed =
  typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that rolls when it changes.
 *
 * Used for the estimator total and nothing else, and the restraint is the
 * point: this animates *between* two real values because the reader just
 * caused the change, so the roll is feedback. Counting a price up from zero
 * when a section scrolls into view is the other thing people do with this, and
 * it means putting several seconds of wrong prices on screen to decorate a
 * number that was never in doubt. On a page whose whole argument is "the price
 * you see is the price", that is the one place not to be cute.
 *
 * Correctness is guaranteed twice over. The `requestAnimationFrame` loop is the
 * nice version; the timer beside it sets the true value regardless, so a
 * throttled or abandoned animation can never leave a stale number on screen.
 */
export default function Figure({ value, duration = 420 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const frame = useRef(0);

  useEffect(() => {
    if (!motionAllowed) {
      setDisplay(value);
      return;
    }

    const from = display;
    if (from === value) return;

    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      // ease-out-cubic: quick off the mark, settles rather than stops.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    // The guarantee. Whatever the frames did or did not do, the number on
    // screen is the real one shortly after.
    const settle = window.setTimeout(() => setDisplay(value), duration + 80);

    return () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(settle);
    };
    // `display` is deliberately not a dependency: it is the animation's start
    // point, read once per change, not something the effect should re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{display}</>;
}

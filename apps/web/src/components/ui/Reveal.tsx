import { useLayoutEffect, useRef } from 'react';
import type { ElementType, ReactNode } from 'react';

/**
 * Whether an entrance may run at all — decided once, at module load.
 *
 * Where there is no `IntersectionObserver`, or the reader has asked for less
 * motion, nothing is ever armed and every section below simply renders.
 */
const motionAllowed =
  typeof window !== 'undefined' &&
  typeof IntersectionObserver !== 'undefined' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The reveal, and why it is CSS rather than a `motion` component.
 *
 * The first version of this was `motion`'s `whileInView`, and on this page it
 * shipped a blank pricing table. A JavaScript-driven animation advances on
 * `requestAnimationFrame`; when the browser throttles that — a backgrounded
 * tab, a heavy main thread, a headless renderer taking a screenshot — the
 * tween stops wherever it had got to and the inline `opacity` it had written
 * stays there. The section had reached `opacity: 0; translateY(11.25px)` and
 * stopped, and no amount of scrolling brought it back.
 *
 * The mechanism here cannot fail that way, because **the resting state is the
 * visible one**:
 *
 *  - The element's own styles are its final appearance. Nothing is required to
 *    run for the page to look right.
 *  - `reveal-hidden` is added only to elements that are *below the fold at
 *    mount*, inside `useLayoutEffect` so it lands before the first paint —
 *    nothing on screen is ever hidden and then shown, so there is no flash.
 *  - Removing that class is what animates. A CSS transition that is throttled
 *    or interrupted still resolves to the style the element now computes to,
 *    which is the visible one. The worst case is that the movement is not seen,
 *    not that the content is not seen.
 *
 * The observer is shared: one `IntersectionObserver` for the page rather than
 * one per revealed block.
 */
const HIDDEN = 'reveal-hidden';

let sharedObserver: IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.remove(HIDDEN);
          sharedObserver?.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.01 }
    );
  }
  return sharedObserver;
}

interface RevealProps {
  children: ReactNode;
  className?: string;
  id?: string;
  as?: ElementType;
  /** Seconds, for staggering siblings. Keep the spread under ~0.3s. */
  delay?: number;
  /** How far it travels, in px. A settle, not an entrance. */
  y?: number;
}

export default function Reveal({
  children,
  className,
  id,
  as: Tag = 'div',
  delay = 0,
  y = 18,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !motionAllowed) return;

    // Only what the reader cannot see yet. Anything already on screen at mount
    // is left alone: hiding it in order to fade it back in is a flicker, not an
    // entrance.
    const top = node.getBoundingClientRect().top;
    if (top < window.innerHeight * 0.92) return;

    node.classList.add(HIDDEN);
    const io = observer();
    io.observe(node);
    return () => io.unobserve(node);
  }, []);

  return (
    <Tag
      ref={ref}
      id={id}
      className={`reveal ${className ?? ''}`}
      style={
        {
          '--reveal-delay': `${Math.round(delay * 1000)}ms`,
          '--reveal-y': `${y}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </Tag>
  );
}

/**
 * The same mechanism, fired on mount instead of on scroll — for the hero, which
 * is on screen from the start and orchestrates its own arrival.
 *
 * The un-hiding is a `setTimeout`, deliberately: unlike `requestAnimationFrame`
 * a timer still fires in a throttled or hidden tab, so the element always ends
 * up visible even if the transition between the two states is never drawn.
 */
export function Enter({
  children,
  className,
  id,
  as: Tag = 'div',
  delay = 0,
  y = 24,
  clip = false,
}: RevealProps & { clip?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !motionAllowed) return;

    node.classList.add(HIDDEN);
    const timer = window.setTimeout(() => node.classList.remove(HIDDEN), 30);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Tag
      ref={ref}
      id={id}
      className={`reveal ${clip ? 'reveal-clip' : ''} ${className ?? ''}`}
      style={
        {
          '--reveal-delay': `${Math.round(delay * 1000)}ms`,
          '--reveal-y': `${y}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </Tag>
  );
}

export { motionAllowed };

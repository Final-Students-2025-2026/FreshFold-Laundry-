import { useEffect, useRef, useState } from 'react';

/**
 * Which section the reader is in, and how far down they are.
 *
 * ## What this replaces
 *
 * `App` ran one `scroll` handler that, on **every** scroll event — not per
 * frame, per event, which on a trackpad or a smooth-scrolling phone is many
 * times a frame — did this:
 *
 *     const sections = [
 *       { id: 'services', el: document.getElementById('services') },
 *       … seven more …
 *     ];
 *     for (…) { const offsetTop = item.el.offsetTop; … }
 *
 * Eight `getElementById` lookups and eight `offsetTop` reads. `offsetTop` is a
 * layout-forcing read: the browser has to flush any pending style and layout
 * work before it can answer, so a handler that does eight of them in a loop
 * turns every scroll event into a synchronous layout. That is the classic
 * cause of a marketing page that scrolls smoothly on a laptop and stutters on
 * the mid-range Android most of this site is actually read on.
 *
 * `IntersectionObserver` answers the same question with no layout reads at
 * all: the browser already knows where these boxes are relative to the
 * viewport, and it tells us when that changes, off the main thread.
 */

/**
 * The band that counts as "here".
 *
 * A section is active while it crosses a horizontal strip a fifth of the way
 * down the viewport. Top-anchored rather than centred because the fixed header
 * sits over the top ~72px and because a reader's attention is above the middle
 * of the screen, not at it — a centred band lights the *next* heading while
 * you are still reading the current one.
 */
const BAND = '-20% 0px -70% 0px';

/**
 * Tracks which of `ids` is currently in the band.
 *
 * Returns the last one to enter it, and keeps returning it when nothing is in
 * the band at all — between two short sections, say. A spy that reset to empty
 * would blink the header nav off every time a gap went past, which reads as a
 * bug.
 */
export function useScrollSpy(ids: readonly string[], fallback: string): string {
  const [active, setActive] = useState(fallback);

  // The ids are a literal at the call site, so a new array identity every
  // render would re-create the observer on every render. Compared by value.
  const key = ids.join('|');

  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (sections.length === 0) return;

    /** Everything currently crossing the band, so leaving one falls back to another. */
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }

        if (visible.size === 0) return;

        // Document order, so two overlapping sections resolve to the upper
        // one — the same answer the old loop gave, without the layout reads.
        for (const section of sections) {
          if (visible.has(section.id)) {
            setActive(section.id);
            return;
          }
        }
      },
      { rootMargin: BAND, threshold: 0 }
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}

/**
 * Whether the page has been scrolled past `distance`.
 *
 * Still a scroll listener, because there is no element to observe — but it
 * reads `scrollY` only, which is a cheap property the browser keeps to hand
 * rather than a layout-forcing one, it coalesces to one read per frame, and it
 * sets state only when the answer actually flips rather than on every event.
 * That is the difference between two re-renders a visit and several hundred.
 */
export function useScrolledPast(distance: number): boolean {
  const [past, setPast] = useState(false);
  const queued = useRef(false);

  useEffect(() => {
    const read = () => {
      queued.current = false;
      setPast((was) => {
        const now = window.scrollY > distance;
        return now === was ? was : now;
      });
    };

    const onScroll = () => {
      if (queued.current) return;
      queued.current = true;
      requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [distance]);

  return past;
}

/**
 * Scrolls a section into view, honouring the fixed header and the reader's
 * motion preference.
 *
 * The offset is `scroll-margin-top` in index.css rather than a number here, so
 * a link, a `:target` jump from the footer and the browser restoring a scroll
 * position all land in the same place. This function only decides *how* to
 * travel.
 */
export function scrollToSection(id: string): void {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';

  const element = document.getElementById(id);
  if (element) element.scrollIntoView({ behavior, block: 'start' });
  else window.scrollTo({ top: 0, behavior });
}

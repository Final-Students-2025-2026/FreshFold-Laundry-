import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Enter, motionAllowed } from './ui/Reveal';
import Img from './ui/Img';

interface HeroProps {
  onOpenBooking: () => void;
  onExplorePlans: () => void;
}

/**
 * The three facts a first-time visitor is actually here for.
 *
 * Every one of them is a number this business can stand behind: the wash price
 * and the express surcharge come from `packages/core`'s catalogue, the address
 * is the shop. What used to sit here — "Certified Fabric Experts", "Over 12,000
 * pristine deliveries" — was three adjectives and an invented statistic.
 */
const FACTS = [
  { label: 'A wash', value: '₵30', note: 'per load, pickup and delivery free' },
  { label: 'Back to you', value: 'Tomorrow', note: 'same day for ₵50 more' },
  { label: 'We collect from', value: 'Kumasi', note: 'Ayeduase-Kotei and around' },
];

export default function Hero({ onOpenBooking, onExplorePlans }: HeroProps) {
  const backdrop = useRef<HTMLDivElement | null>(null);

  /**
   * The photograph drifts a little slower than the page.
   *
   * `transform` only — nothing here reads or writes layout, so the browser can
   * keep it on the compositor and the scroll stays smooth on the mid-range
   * Android this page is mostly read on. The work is coalesced into one frame
   * per scroll burst rather than run per event.
   *
   * The element is in its correct position before this ever runs, and the
   * effect simply never starts where motion is unwelcome; there is no state in
   * which the hero depends on it.
   */
  useEffect(() => {
    const node = backdrop.current;
    if (!node || !motionAllowed) return;

    let queued = false;
    const apply = () => {
      queued = false;
      const shift = Math.min(window.scrollY, 900) * 0.18;
      node.style.transform = `translate3d(0, ${shift}px, 0)`;
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      node.style.transform = '';
    };
  }, []);

  return (
    <section
      id="hero"
      className="relative isolate flex min-h-[min(100svh,54rem)] items-center overflow-hidden border-b border-white/10 font-ui"
    >
      {/*
        The photograph, full bleed, behind everything.

        The old hero did this too and the picture never survived it: grayscale,
        `opacity-20`, then two blurred colour blobs on top. What reached the
        screen was mud with a texture rumour in it.

        Three layers instead, each with one job. The image keeps most of its
        colour — a light desaturation only, so the linen stays warm next to the
        brass accent. The flat scrim is the contrast guarantee: at 68% over even
        a pure-white pixel the ground computes to L*≈0.10, which holds white
        body copy at 6.2:1, so the type is legible over any frame of any crop at
        any viewport rather than over the one the design was checked against.
        The gradient then sinks the top and bottom edges into the page colour so
        the section has no seam at the header or at the price list below.
      */}
      <div ref={backdrop} className="absolute inset-0 -z-10 will-change-transform">
        {/* The page's LCP element, and the one image on it that is worth
            `priority`. It asked for `w=2000` unconditionally, which is the
            file a 390px phone was downloading to paint a 390px-wide backdrop.

            `sizes="100vw"` because it is full-bleed. Keep the candidate widths
            in step with the `<link rel="preload">` in index.html — the browser
            picks from that list first, and a mismatch turns the preload from a
            saved request into a wasted one. */}
        <Img
          src="https://images.unsplash.com/photo-1524404794194-16bae22718c0"
          alt="Laundered sheets and towels, washed, pressed and folded into squared-off stacks"
          sizes="100vw"
          priority
          width={1280}
          height={853}
          className="h-[125%] w-full object-cover saturate-[0.72]"
        />
        <div className="absolute inset-0 bg-brand-charcoal/[0.68]" />
        <div className="absolute inset-0 bg-gradient-to-b from-brand-charcoal via-transparent to-brand-charcoal" />
      </div>

      <div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-28 text-center sm:px-8 sm:pb-28 sm:pt-32">
        {/* The one kicker on the page. A single named line above the headline is
            a brand's voice; the same device above all eight sections is the
            scaffolding this redesign took out. */}
        <Enter as="p" y={14}>
          {/* Gold-light rather than gold. Against the brightest pixel the crop
              could ever put behind it, `--color-brand-gold` measures 3.05:1 and
              this measures 4.62:1 — the ring of legibility has to hold for any
              frame of this photograph at any viewport, not just the one the
              design was checked against. */}
          <span className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-brand-gold-light sm:text-[12.5px] sm:tracking-[0.2em]">
            Kumasi · Free pickup &amp; delivery
          </span>
        </Enter>

        <Enter
          as="h1"
          delay={0.08}
          className="mx-auto mt-6 max-w-[19ch] font-display text-hero font-medium text-white text-balance"
          id="hero-headline"
        >
          Laundry, collected and returned.
        </Enter>

        <Enter
          as="p"
          delay={0.16}
          className="mx-auto mt-6 max-w-[54ch] text-lead text-white/85"
          id="hero-subheadline"
        >
          We pick it up from your place in Kumasi, wash and press it properly, and bring it back the
          next day — folded, sorted, and never mixed with anyone else&rsquo;s.
        </Enter>

        <Enter
          delay={0.24}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          id="hero-buttons"
        >
          <button
            onClick={onOpenBooking}
            className="w-full rounded-md bg-brand-gold px-8 py-4 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light sm:w-auto"
          >
            Book a pickup
          </button>
          <button
            onClick={onExplorePlans}
            className="w-full rounded-md border border-white/30 bg-white/5 px-8 py-4 text-[15px] font-medium text-white backdrop-blur-sm transition-colors duration-200 hover:border-white/50 hover:bg-white/10 sm:w-auto"
          >
            See the monthly plans
          </button>
        </Enter>

        {/* The facts, under a single rule. Centred with the rest of the
            composition, and no icons: a shield and a laurel wreath add nothing
            to a number that can speak for itself. */}
        <Enter
          as="dl"
          delay={0.32}
          className="mt-12 grid divide-y divide-white/20 border-t border-white/20 pt-7 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:divide-white/20"
          id="hero-stats"
        >
          {FACTS.map((fact) => (
            <div key={fact.label} className="px-4 py-5 first:pt-0 sm:py-0">
              <dt className="text-label font-medium text-white/80">{fact.label}</dt>
              {/* Archivo, not the serif. Cormorant sets old-style figures by
                  default, so `₵30` came out with a descending 3 and a dwarf
                  zero — charming in running prose, wrong for a price, and out
                  of step with every other number on the page. The serif carries
                  the voice here; the grotesque carries the data. */}
              <dd className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em] text-white tnum fs-semi">
                {fact.value}
              </dd>
              <dd className="mx-auto mt-2 max-w-[24ch] text-body text-white/80">{fact.note}</dd>
            </div>
          ))}
        </Enter>
      </div>

      {/* Scroll cue. Kept from the old hero, but pointing somewhere: it says
          what is below rather than "Scroll to discover", and it is a button, so
          it works from the keyboard. */}
      <button
        onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
        className="absolute inset-x-0 bottom-6 mx-auto flex w-fit flex-col items-center gap-1.5 rounded-md px-4 py-2 text-white/60 transition-colors duration-200 hover:text-white"
        id="hero-scroll-indicator"
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.2em]">Prices</span>
        <ChevronDown className="scroll-cue h-4 w-4" />
      </button>
    </section>
  );
}

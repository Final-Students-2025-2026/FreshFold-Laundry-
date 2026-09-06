/**
 * Paystack's mark: four stacked bars.
 *
 * Inline SVG rather than an `<img>`, for three reasons that all point the same
 * way. The site's CSP sets `img-src 'self' data: blob:` plus Google's map tiles
 * and Unsplash — Paystack's own CDN is not on it, so a hosted logo would be
 * blocked with no visible error. It costs no request on Ghanaian mobile data.
 * And it renders inside `PaystackReturn`, which is a 600×750 popup that has to
 * paint before it closes itself 1.8 seconds later.
 *
 * **The geometry here is drawn from memory, not from Paystack's brand kit.**
 * The proportions are close but should not be assumed exact: if the official
 * asset differs, replace the four `<rect>`s below and every surface that shows
 * the mark follows, because they all come through this one component.
 *
 * Why the supplier's own colour, on a page whose palette is charcoal, olive and
 * brass: this is the one thing on the screen that is deliberately not ours. It
 * is shown immediately before the customer is handed to a window on somebody
 * else's domain, and recognising the mark there is the whole point of putting
 * it here. Kept small so it reads as a provider badge rather than as part of
 * the page's own colour system.
 */
const PAYSTACK_CYAN = '#00C3F7';

interface PaystackMarkProps {
  className?: string;
  /** Set for a mark that takes the surrounding text colour instead. */
  monochrome?: boolean;
}

export default function PaystackMark({ className, monochrome = false }: PaystackMarkProps) {
  const fill = monochrome ? 'currentColor' : PAYSTACK_CYAN;

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Paystack"
      focusable="false"
    >
      <rect x="2" y="3.6" width="20" height="3.4" rx="1.1" fill={fill} />
      <rect x="2" y="8.6" width="20" height="3.4" rx="1.1" fill={fill} />
      {/* The short bar is what makes the stack read as a stack. */}
      <rect x="2" y="13.6" width="12.4" height="3.4" rx="1.1" fill={fill} />
      <rect x="2" y="18.6" width="20" height="3.4" rx="1.1" fill={fill} />
    </svg>
  );
}

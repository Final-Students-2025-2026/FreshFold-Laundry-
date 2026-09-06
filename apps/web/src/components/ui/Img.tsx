import { useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * Every photograph on the site, at a size the device asked for.
 *
 * ## The problem this fixes
 *
 * Every `<img>` here pointed at a single fixed-width file. The hero asked for
 * `w=2000` and the service tiles for `w=800`, and both got exactly that
 * whatever they were rendered into — so a phone with a 390px viewport
 * downloaded a 2000px-wide photograph to paint it 390px wide, and then did it
 * again for a 64px thumbnail at 800px. On the connection most of this site's
 * visitors are on, that is somebody's mobile data spent on pixels their screen
 * cannot resolve.
 *
 * ## How
 *
 * Unsplash resizes on its own CDN from a query parameter, so a `srcset` is
 * arithmetic on the URL rather than a build step. The browser then picks a
 * candidate from `sizes` — which is why `sizes` has to describe the *rendered*
 * width, and why it is a required prop rather than one with a default: a
 * wrong-but-plausible default is how you end up shipping the full-width file
 * to a thumbnail while believing the problem is solved.
 *
 * `q=72` rather than the `q=80` these URLs carried. At the widths below the
 * difference is not visible over a photograph that already has a 68% scrim on
 * it, and it is about a fifth off every file.
 *
 * ## What this is not
 *
 * It is not the whole fix. These are stock photographs on somebody else's CDN:
 * the site depends on Unsplash staying up and on its hotlinking terms not
 * changing, and no amount of `srcset` makes a stock photo of a stranger's
 * linen into a picture of this shop. The real answer is photographs of the
 * actual premises, self-hosted and served as AVIF next to a JPEG. That is a
 * shoot, not a refactor — and when those files land, they land behind this
 * component, which already has every call site.
 */

/** The rungs. Doubling-ish, and capped where the largest layout can use them. */
const WIDTHS = [320, 480, 640, 960, 1280, 1920] as const;

/** Unsplash sizing params, normalised. */
function unsplashAt(url: URL, width: number): string {
  const sized = new URL(url);
  sized.searchParams.set('auto', 'format');
  sized.searchParams.set('fit', 'crop');
  sized.searchParams.set('q', '72');
  sized.searchParams.set('w', String(width));
  // `dpr` is deliberately left off: the browser already accounts for device
  // pixel ratio when it chooses from `srcset`, and setting both makes it
  // multiply twice.
  sized.searchParams.delete('dpr');
  sized.searchParams.delete('h');
  return sized.toString();
}

/**
 * A `srcset` for a source that supports resizing, or nothing for one that does
 * not.
 *
 * Only Unsplash is rewritten. Anything else — a self-hosted file, a proof
 * photograph out of the dispatch server — is passed through untouched, because
 * appending `w=` to a URL that ignores it produces a srcset of five identical
 * files and the browser will happily download the largest.
 */
export function responsive(src: string): { src: string; srcSet?: string } {
  let url: URL;
  try {
    url = new URL(src, window.location.origin);
  } catch {
    return { src };
  }

  if (url.hostname !== 'images.unsplash.com') return { src };

  return {
    // The mid rung as the fallback for anything that ignores `srcset`.
    src: unsplashAt(url, 960),
    srcSet: WIDTHS.map((width) => `${unsplashAt(url, width)} ${width}w`).join(', '),
  };
}

interface ImgProps {
  src: string;
  /**
   * Empty string for a picture that adds nothing a caption has not already
   * said — the component then also sets `aria-hidden`, so a screen reader
   * skips it rather than announcing an unlabelled graphic.
   */
  alt: string;
  /**
   * How wide this renders, in CSS terms — e.g. `'64px'` or
   * `'(min-width: 1024px) 40vw, 100vw'`. Required; see the note above.
   */
  sizes: string;
  className?: string;
  /**
   * The hero, and nothing else. `priority` skips lazy-loading and asks the
   * browser to fetch this ahead of the queue; used on more than one image per
   * page it makes every one of them slower.
   */
  priority?: boolean;
  /** Intrinsic ratio, to hold the space before the file lands. See below. */
  width?: number;
  height?: number;
}

export default function Img({
  src,
  alt,
  sizes,
  className = '',
  priority = false,
  width,
  height,
}: ImgProps) {
  const [failed, setFailed] = useState(false);
  const { src: fallbackSrc, srcSet } = responsive(src);

  /**
   * When the photograph does not arrive.
   *
   * A broken `<img>` renders as the browser's torn-page glyph with the alt
   * text beside it in the default serif — on a dark card that reads as a bug
   * in the page rather than as a picture that failed, and it is not rare here:
   * the images are on a third-party CDN, reached over connections that drop.
   * A quiet placeholder in the site's own colours is the honest version, and
   * the layout does not move when it appears.
   */
  if (failed) {
    return (
      <div
        className={`grid place-items-center bg-brand-card-light text-brand-text-muted ${className}`}
        role={alt ? 'img' : 'presentation'}
        aria-label={alt || undefined}
      >
        <ImageOff aria-hidden="true" className="h-5 w-5 opacity-50" />
      </div>
    );
  }

  return (
    <img
      src={fallbackSrc}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      aria-hidden={alt === '' ? true : undefined}
      /* `width`/`height` are the intrinsic ratio, not a layout size — every
         call site sizes with CSS. They are here so the browser can reserve the
         right box before the file lands, which is what stops the rest of the
         section jumping when it does. */
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      /* Off the main thread, so decoding a 1280px photograph does not land as
         a dropped frame in the middle of a scroll. */
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

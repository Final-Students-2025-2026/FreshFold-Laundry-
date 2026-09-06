import type { Plugin } from 'vite';
import { SCHEDULE, SHOP, clockTime } from '../src/shop';

/**
 * Everything a link to this site needs to arrive somewhere looking like a
 * business: the share card, the canonical URL, the icons, and the
 * `LocalBusiness` record that puts a laundry in Kumasi into a search result.
 *
 * ## Why a plugin rather than tags typed into index.html
 *
 * Three of these facts already exist somewhere else in the repo and had no
 * business being written down a second time:
 *
 *  - **The title and the description** are in `index.html`, where you would
 *    look for them. This reads them back out of the document rather than
 *    declaring its own, so `og:title` cannot drift from `<title>` — which is
 *    the usual way a share card ends up advertising last quarter's headline.
 *  - **The address, phone and opening hours** are in `src/shop.ts`, which the
 *    contact section renders. A hand-written `openingHoursSpecification` is a
 *    second schedule to forget on the day the shop starts closing at six, and
 *    a stale one is worse than none: Google will print it.
 *  - **The domain** is not in the repo at all, on purpose — it is `APP_URL` on
 *    the server and `SITE_URL` here, because the same build serves a preview
 *    deploy, a staging host and the real thing, and a canonical tag pointing
 *    at the wrong one of those is how a preview deploy gets indexed instead of
 *    the site.
 *
 * ## The inline `<script type="application/ld+json">`
 *
 * The site's CSP is `script-src 'self'` with no `unsafe-inline`, and
 * `apps/server/src/headers.check.ts` asserts the built page carries no inline
 * script, so that the policy can hold without a nonce Vercel cannot mint for a
 * static file.
 *
 * A JSON-LD block is not an exception being carved out of that. It is a data
 * block: the type is not a JavaScript MIME type, so the browser never executes
 * it and `script-src` never gates it. The check has been narrowed to say what
 * it always meant — no inline *executable* script — rather than relaxed.
 */
export interface SiteMetadataOptions {
  /**
   * The origin the site is actually served from, no trailing slash.
   *
   * Read from `SITE_URL` by vite.config.ts. The default is a placeholder and
   * says so in the build log, because shipping a canonical tag that points at
   * somebody else's domain is worse than shipping none.
   */
  siteUrl: string;
}

/** The routes worth telling a crawler about. See public/robots.txt for the rest. */
const INDEXABLE = ['/'];

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** `<script>` cannot contain the literal `</script>`, whatever the type says. */
const escapeJson = (value: unknown) =>
  JSON.stringify(value, null, 2).replace(/</g, '\\u003c');

function structuredData(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${siteUrl}/#business`,
    name: SHOP.name,
    description:
      'Laundry collected across Kumasi, washed and pressed at the shop in ' +
      'Ayeduase-Kotei, and returned the next day. Pickup and delivery are free.',
    url: `${siteUrl}/`,
    telephone: SHOP.phone,
    email: SHOP.email,
    image: `${siteUrl}/og.jpg`,
    logo: `${siteUrl}/icon-512.png`,
    priceRange: '₵₵',
    currenciesAccepted: 'GHS',
    address: {
      '@type': 'PostalAddress',
      streetAddress: SHOP.addressLine1,
      addressLocality: SHOP.locality,
      addressRegion: SHOP.region,
      addressCountry: SHOP.country,
    },
    areaServed: {
      '@type': 'City',
      name: SHOP.locality,
    },
    // Derived from the same rows the contact section prints — see src/shop.ts.
    openingHoursSpecification: SCHEDULE.map(({ hours }) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [...hours.days],
      opens: clockTime(hours.opens),
      closes: clockTime(hours.closes),
    })),
  };
}

export default function siteMetadata({ siteUrl }: SiteMetadataOptions): Plugin {
  const origin = siteUrl.replace(/\/$/, '');

  return {
    name: 'freshfold:site-metadata',

    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Read the two facts the document already states, rather than
        // declaring a second copy of either.
        const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? SHOP.name;
        const description =
          html.match(/<meta\s+name="description"\s+content="([\s\S]*?)"/i)?.[1]?.trim() ?? '';

        const tags = [
          `<link rel="canonical" href="${origin}/" />`,
          '',
          '<!-- Icons. The SVG is the one every current desktop browser uses; the',
          '     PNGs are for iOS, which ignores SVG favicons, and for the manifest.',
          '     All four are rendered by scripts/brand-assets.mjs. -->',
          '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
          '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
          '<link rel="manifest" href="/site.webmanifest" />',
          '',
          '<!-- The share card. This is what a link pasted into WhatsApp becomes,',
          '     which is how most of these links actually travel. Without it the',
          '     message shows a bare URL and nothing else. -->',
          '<meta property="og:type" content="website" />',
          `<meta property="og:site_name" content="${escapeHtml(SHOP.name)}" />`,
          `<meta property="og:title" content="${escapeHtml(title)}" />`,
          `<meta property="og:description" content="${escapeHtml(description)}" />`,
          `<meta property="og:url" content="${origin}/" />`,
          `<meta property="og:image" content="${origin}/og.jpg" />`,
          '<meta property="og:image:width" content="1200" />',
          '<meta property="og:image:height" content="630" />',
          '<meta property="og:image:type" content="image/jpeg" />',
          '<meta property="og:image:alt" content="FreshFold — laundry, collected and returned. A wash ₵30, back to you tomorrow, pickup and delivery free." />',
          '<meta property="og:locale" content="en_GH" />',
          '',
          '<meta name="twitter:card" content="summary_large_image" />',
          `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
          `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
          `<meta name="twitter:image" content="${origin}/og.jpg" />`,
          '',
          '<!-- What this business is, where it is and when it is open, for a',
          '     search result. Built from src/shop.ts at build time so it cannot',
          '     disagree with the hours the contact section prints. -->',
          `<script type="application/ld+json">${escapeJson(structuredData(origin))}</script>`,
        ];

        const indent = (line: string) => (line ? `    ${line}` : '');
        return html.replace(
          '</head>',
          `${tags.map(indent).join('\n')}\n  </head>`
        );
      },
    },

    /**
     * The sitemap and robots.txt, emitted rather than committed, for the same
     * reason the canonical tag is injected: both have to carry the domain this
     * build is actually being served from. `Sitemap:` in particular has to be
     * an absolute URL, so a committed robots.txt would have to guess one.
     */
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      const urls = INDEXABLE.map(
        (route) =>
          '  <url>\n' +
          `    <loc>${origin}${route}</loc>\n` +
          `    <lastmod>${today}</lastmod>\n` +
          '    <changefreq>weekly</changefreq>\n' +
          '  </url>'
      ).join('\n');

      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          `${urls}\n` +
          '</urlset>\n',
      });

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source:
          '# FreshFold Laundry Co.\n' +
          '#\n' +
          '# The marketing page is the only thing here worth indexing. /portal is a\n' +
          "# customer's own account and /admin is the supervisor desk — both are behind\n" +
          '# a login, both send `noindex` from the app as well, and neither has\n' +
          '# anything a search result should ever point at.\n' +
          '\n' +
          'User-agent: *\n' +
          'Allow: /\n' +
          'Disallow: /portal\n' +
          'Disallow: /admin\n' +
          'Disallow: /paystack-success\n' +
          '\n' +
          `Sitemap: ${origin}/sitemap.xml\n`,
      });
    },
  };
}

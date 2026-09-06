/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import type { RequestHandler, Response } from 'express';

/**
 * The response headers a browser needs in order to defend the page for us.
 *
 * Written here rather than pulled in as `helmet`, for the reason the two email
 * transports are written against bare `fetch`: this is a short list of literal
 * strings, the project keeps its runtime dependencies to the five that are
 * bundled `--external` in the build, and a dependency would buy defaults that
 * have to be overridden anyway — helmet's own CSP does not know about Google
 * Maps or about the two pages this server renders itself.
 *
 * What this is for. The dashboard holds a supervisor's bearer token, and that
 * token reads every customer record, settles any bill and empties the roster.
 * There is no XSS in the product today — React escapes by default and nothing
 * calls `dangerouslySetInnerHTML` — but CSP is the control that decides how much
 * a future one is worth, and there was none. `frame-ancestors` matters for the
 * same reason: the desk has one-click destructive controls and was framable.
 *
 * Note on where this applies. In the deployed topology Vercel serves the
 * website and proxies `/api` here, so these headers land on API responses and on
 * the two pages this server renders — the email-confirmation page and the
 * password-reset form. The website's own HTML gets the same treatment from
 * `vercel.json`, which has to be kept in step; the CSP there is the one that
 * governs the dashboard. This branch still matters because `index.ts` also
 * serves the built site when the whole thing runs as one process.
 *
 * Why that file matches `/((?!api/).*)` rather than everything: a browser given
 * two Content-Security-Policy headers enforces both. `/api` is proxied here,
 * and the reset form this server renders carries a per-response nonce — a
 * second policy from Vercel that does not know the nonce would block the inline
 * script, and the form would stop working in production only. The exclusion
 * cannot be explained in `vercel.json` itself: Vercel rejects any key it does
 * not recognise inside a `headers` entry, `_comment` included, so the reason
 * lives here.
 */

/**
 * Hosts the website legitimately reaches, and why each one is here.
 *
 * Kept as a single list so the policy below and `vercel.json` can be read
 * against each other. Anything not named is refused by `default-src 'self'`.
 */
// Google's own CSP guidance for the Maps JavaScript API names both hosts: the
// loader comes from `maps.googleapis.com` and pulls further modules from
// `maps.gstatic.com`.
const GOOGLE_MAPS_SCRIPTS = 'https://maps.googleapis.com https://maps.gstatic.com';
const GOOGLE_MAPS_ASSETS = 'https://maps.gstatic.com https://maps.googleapis.com https://*.googleusercontent.com';
const GOOGLE_FONTS = 'https://fonts.googleapis.com https://fonts.gstatic.com';

/**
 * Marketing photography on the public page.
 *
 * `encrypted-tbn0.gstatic.com` used to be listed beside it, for a single
 * service tile whose image was a Google Images *thumbnail* — a ~100px preview
 * of a search result, hotlinked. That image has been replaced with one from
 * the same source as the other ten, so the host is no longer reachable from
 * any code path and has been dropped rather than left in the policy. An origin
 * nothing loads from is an origin that can only ever be used by something you
 * did not intend.
 */
const IMAGE_HOSTS = 'https://images.unsplash.com';

/**
 * Where a `nonce` for this response lives, so a handler that renders inline
 * script can reference the one that was actually sent.
 *
 * A nonce rather than `'unsafe-inline'` for scripts: the reset page is the only
 * inline script this server serves and it is the page that holds somebody's new
 * password, which is precisely the page not to open up.
 */
declare module 'express-serve-static-core' {
  interface Response {
    cspNonce?: string;
  }
}

/** The nonce minted for this response. */
export function cspNonce(res: Response): string {
  return res.cspNonce ?? '';
}

/**
 * Builds the policy for one response.
 *
 * `style-src` allows `'unsafe-inline'` and that is a deliberate, narrow
 * concession rather than an oversight. The Google Maps JavaScript API styles
 * every marker and control by setting `style` attributes from script, and a
 * nonce cannot cover a style *attribute* — only a `<style>` element. The two
 * pages this server renders are built the same way, because they have no
 * stylesheet to link to. Inline style is not a script-execution primitive, so
 * the trade is a real one: it costs some defence against CSS-based exfiltration
 * and buys a map that renders.
 */
function policy(nonce: string, servesWebsite: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${servesWebsite ? GOOGLE_MAPS_SCRIPTS : ''}`.trim(),
    `style-src 'self' 'unsafe-inline' ${servesWebsite ? GOOGLE_FONTS : ''}`.trim(),
    `font-src 'self' ${servesWebsite ? GOOGLE_FONTS : ''}`.trim(),

    // `data:` carries the proof-of-service photographs and signature PNGs, which
    // are base64 inside the job record rather than files behind a URL.
    `img-src 'self' data: blob: ${servesWebsite ? `${GOOGLE_MAPS_ASSETS} ${IMAGE_HOSTS}` : ''}`.trim(),

    `connect-src 'self' ${servesWebsite ? GOOGLE_MAPS_SCRIPTS : ''}`.trim(),

    // Maps runs some of its work in a blob worker. Without this the directive
    // falls back to `default-src 'self'`, which refuses one.
    `worker-src 'self' blob:`,

    // Nothing here embeds anything, and nothing should embed us.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",

    // A form on one of our pages posts to us. The reset form uses `fetch`, so
    // this is belt and braces against an injected form element.
    "form-action 'self'",

    // Stops an injected `<base>` re-pointing every relative URL on the page.
    "base-uri 'self'",
  ];

  return directives.join('; ');
}

/**
 * The middleware. Mount it before any route.
 *
 * `servesWebsite` widens the policy for the hosts the marketing site and the
 * dashboard need. It is false for an API-only deployment — which is the
 * deployed shape, where Vercel serves the site — so that the API's own
 * responses carry the tightest policy that still lets the two rendered pages
 * work.
 */
export function securityHeaders(options: { servesWebsite: boolean; https: boolean }): RequestHandler {
  return (_req, res, next) => {
    const nonce = randomBytes(16).toString('base64');
    res.cspNonce = nonce;

    res.setHeader('Content-Security-Policy', policy(nonce, options.servesWebsite));

    // A JSON response that a browser decides to treat as HTML is an XSS sink
    // that no amount of escaping fixes.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // `frame-ancestors` above is the modern control and takes precedence where
    // it is understood; this is for what does not.
    res.setHeader('X-Frame-Options', 'DENY');

    // Keep booking ids and reset tokens out of other people's access logs. The
    // reset page sets its own `no-referrer` meta on top of this.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Nothing here uses any of them, and an injected script should not be the
    // first thing that tries.
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()'
    );

    // Only over TLS: sent on a plaintext response it is ignored by browsers, and
    // setting it in development would be a way to lock a developer's own
    // `localhost` into https for a year.
    if (options.https) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  };
}

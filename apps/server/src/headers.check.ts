/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The response headers, and the one policy that has to stay in step with a file
 * outside this workspace.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * There were none of these headers at all, which mattered because the dashboard
 * holds a supervisor's bearer token in `localStorage` and that token reads every
 * customer record and settles any bill. CSP is what decides how much a future
 * XSS is worth; `frame-ancestors` is what stops the desk's one-click
 * destructive controls being framed.
 *
 * The last section is the one worth having. In the deployed topology Vercel
 * serves the website and proxies `/api` here, so there are two policies — this
 * one and `vercel.json`'s — and a browser handed two `Content-Security-Policy`
 * headers enforces *both*. The password-reset page is served through that proxy
 * and carries an inline script with a per-response nonce, so a `vercel.json`
 * whose matcher covered `/api` would block it, in production only, on the page
 * that resets passwords. That is a bug nobody finds until somebody cannot get
 * back into their account, so it is asserted here instead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { securityHeaders } from './headers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERCEL_JSON = path.resolve(HERE, '..', '..', '..', 'vercel.json');

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${a}\n        want ${e}`}`
  );
}

function checkTrue(label: string, actual: boolean): void {
  check(label, actual, true);
}

function section(title: string): void {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 55 - title.length))}`);
}

function serve(options: { servesWebsite: boolean; https: boolean }, port: number) {
  const app = express();
  app.use(securityHeaders(options));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  return new Promise<{ close: () => void; get: () => Promise<Headers> }>((resolve) => {
    const server = app.listen(port, () =>
      resolve({
        close: () => server.close(),
        get: async () => (await fetch(`http://127.0.0.1:${port}/x`)).headers,
      })
    );
  });
}

async function main(): Promise<void> {
  section('the API-only policy');

  const api = await serve({ servesWebsite: false, https: false }, 4611);
  const h = await api.get();
  const csp = h.get('content-security-policy') ?? '';

  check('a policy is sent at all', csp.length > 0, true);
  checkTrue("default-src is 'self'", csp.includes("default-src 'self'"));
  checkTrue('the page cannot be framed', csp.includes("frame-ancestors 'none'"));
  checkTrue('plugins are refused', csp.includes("object-src 'none'"));
  checkTrue('an injected <base> cannot re-point the page', csp.includes("base-uri 'self'"));
  checkTrue('a form cannot post off-site', csp.includes("form-action 'self'"));
  checkTrue('a nonce is issued', /script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/.test(csp));
  checkTrue("scripts do not allow 'unsafe-inline'", !/script-src [^;]*'unsafe-inline'/.test(csp));
  checkTrue("scripts do not allow 'unsafe-eval'", !csp.includes("'unsafe-eval'"));
  checkTrue(
    'an API-only deployment names no third-party script host',
    !/script-src [^;]*https:/.test(csp)
  );

  check('MIME sniffing is off', h.get('x-content-type-options'), 'nosniff');
  check('framing is refused for older browsers too', h.get('x-frame-options'), 'DENY');
  check('referrers are trimmed cross-origin', h.get('referrer-policy'), 'strict-origin-when-cross-origin');
  checkTrue('camera and microphone are refused', (h.get('permissions-policy') ?? '').includes('camera=()'));
  check('HSTS is not sent over plaintext', h.get('strict-transport-security'), null);

  section('a nonce is per-response, not per-process');

  const first = (await api.get()).get('content-security-policy') ?? '';
  const second = (await api.get()).get('content-security-policy') ?? '';
  const nonceOf = (policy: string) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1] ?? '';

  checkTrue('two responses carry different nonces', nonceOf(first) !== nonceOf(second));
  checkTrue('and both are long enough to be unguessable', nonceOf(first).length >= 20);

  api.close();

  section('the single-process policy, and HSTS');

  const full = await serve({ servesWebsite: true, https: true }, 4612);
  const fh = await full.get();
  const fcsp = fh.get('content-security-policy') ?? '';

  checkTrue('the Maps loader is allowed', fcsp.includes('https://maps.googleapis.com'));
  checkTrue('so is the host it pulls modules from', fcsp.includes('https://maps.gstatic.com'));
  checkTrue('Google Fonts is allowed for the stylesheet', fcsp.includes('https://fonts.googleapis.com'));
  checkTrue('and for the font files', fcsp.includes('https://fonts.gstatic.com'));
  checkTrue('proof photographs are data: URIs', /img-src [^;]*data:/.test(fcsp));
  checkTrue('Maps blob workers are allowed', fcsp.includes("worker-src 'self' blob:"));
  check('HSTS is sent behind TLS', fh.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');

  full.close();

  section('vercel.json stays in step');

  const vercel = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8')) as {
    headers?: { source: string; headers: { key: string; value: string }[] }[];
  };

  const rule = vercel.headers?.[0];
  checkTrue('the website is given headers at all', Boolean(rule));

  if (rule) {
    /**
     * The load-bearing assertion. `/api` is proxied to this server, which sets
     * its own policy; a browser given two of them enforces both, and the
     * reset page's nonce is not in Vercel's. Its matcher must exclude `/api`.
     */
    checkTrue(
      'the matcher excludes /api, so the reset page keeps its nonce',
      rule.source.includes('?!api/')
    );
    checkTrue(
      'and it does not simply match everything',
      rule.source !== '/(.*)' && rule.source !== '/(.*)?'
    );

    const sent = new Map(rule.headers.map((entry) => [entry.key.toLowerCase(), entry.value]));
    for (const name of [
      'content-security-policy',
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
      'permissions-policy',
      'strict-transport-security',
    ]) {
      checkTrue(`the website is sent ${name}`, sent.has(name));
    }

    const webCsp = sent.get('content-security-policy') ?? '';
    checkTrue('the website refuses framing', webCsp.includes("frame-ancestors 'none'"));
    checkTrue("the website's scripts are not 'unsafe-inline'", !/script-src [^;]*'unsafe-inline'/.test(webCsp));
    checkTrue("the website's scripts are not 'unsafe-eval'", !webCsp.includes("'unsafe-eval'"));

    // The built index.html links its bundle rather than inlining it, which is
    // what lets the policy above hold without a nonce Vercel cannot mint for a
    // static file. If Vite ever starts inlining, this is the warning.
    //
    // `application/ld+json` is excluded, and that is not a hole being opened.
    // A block whose type is not a JavaScript MIME type is data: the browser
    // never executes it, so `script-src` never gates it and there is nothing
    // for a nonce to authorise. The page carries one — the LocalBusiness
    // record injected by apps/web/vite/site-metadata.ts — and counting it as
    // an inline script would have this check failing for a tag the policy has
    // no opinion about. What the check is actually asserting, and now says, is
    // that no *executable* inline script reaches the page.
    const built = path.resolve(HERE, '..', '..', 'web', 'dist', 'index.html');
    if (fs.existsSync(built)) {
      const html = fs.readFileSync(built, 'utf8');
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].filter(
        ([tag]) => !/type=["']application\/ld\+json["']/i.test(tag)
      );
      check('the built page has no executable inline script for the policy to block', inline.length, 0);
    } else {
      console.log('SKIP  built page not present — run `npm run build -w @freshfold/web` to check it');
    }
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

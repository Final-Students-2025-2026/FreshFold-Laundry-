/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How the connection to Postgres is secured.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * The driver was configured with `ssl: 'require'`, which does not mean what it
 * looks like it means: in `postgres/src/connection.js` the strings `'require'`,
 * `'allow'` and `'prefer'` all set `rejectUnauthorized = false`. The session was
 * encrypted against somebody listening and open to somebody interposing — any
 * certificate accepted, self-signed, expired or issued for another host. Anyone
 * in the path between this process and Supabase could read every customer
 * address and payment record, rewrite rows in flight, and take the database
 * password off the wire during startup authentication.
 *
 * These assertions are about the decision rather than the connection.
 * `databaseSsl` takes its environment as an argument precisely so the four
 * branches can be checked here without a network or a live database, which is
 * what lets this run in CI beside everything else.
 *
 * The connection itself was verified by hand against the real pooler: with the
 * Supabase root as the trust anchor it connects, and with an unrelated CA it is
 * refused with `SELF_SIGNED_CERT_IN_CHAIN` rather than quietly succeeding. That
 * is the half a unit test cannot honestly claim, and it is why the assertion
 * below about `'require'` matters — it is the string that would silently undo
 * all of this.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { databaseSsl, type DatabaseSsl } from './db';

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

/** A PEM-looking blob. Never parsed here — only carried through. */
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n';

/** Runs `body` with `console.warn` captured rather than printed. */
function warnings(body: () => void): string[] {
  const said: string[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => void said.push(args.join(' '));
  try {
    body();
  } finally {
    console.warn = real;
  }
  return said;
}

function threw(body: () => unknown): string | null {
  try {
    body();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------------------------------------------------------------------------
section('a CA means the certificate is actually checked');

const withPem = databaseSsl({ SUPABASE_CA_CERT: PEM }, false);
check('an inline PEM is passed straight through', withPem, {
  ca: PEM.trim(),
  rejectUnauthorized: true,
});

/**
 * The field that does the work. `rejectUnauthorized` is what separates an
 * encrypted connection from an authenticated one, and an object that omitted it
 * would read as a fix while behaving like the bug.
 */
checkTrue(
  'and rejectUnauthorized is on',
  typeof withPem === 'object' && withPem.rejectUnauthorized === true
);

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-ca-')), 'root.crt');
fs.writeFileSync(file, PEM);

check('a path is read off disk', databaseSsl({ SUPABASE_CA_CERT: file }, false), {
  ca: PEM,
  rejectUnauthorized: true,
});

/**
 * The two forms are told apart by the PEM header, because a certificate starts
 * with `-----BEGIN` and a filesystem path never does.
 */
const unreadable = threw(() => databaseSsl({ SUPABASE_CA_CERT: '/no/such/ca.crt' }, false));
checkTrue('an unreadable path is refused rather than ignored', unreadable !== null);
checkTrue('...and the message says what to give it', (unreadable ?? '').includes('PEM block'));

section('without a CA the connection is NOT authenticated');

/**
 * This is the assertion that documents the hazard. `'require'` reads like the
 * secure option and is the one that disables verification, so it is written
 * down here — if somebody ever "simplifies" the CA branch away, this says
 * plainly what they would be going back to.
 */
check('no CA falls back to the unverified string', databaseSsl({}, false), 'require');

check(
  'an empty CA is the same as none',
  databaseSsl({ SUPABASE_CA_CERT: '   ' }, false),
  'require'
);

section('...and production says so out loud');

const inProduction = warnings(() => databaseSsl({ NODE_ENV: 'production' }, false));
check('exactly one warning is raised', inProduction.length, 1);
checkTrue('it names the variable to set', (inProduction[0] ?? '').includes('SUPABASE_CA_CERT'));
checkTrue(
  'and does not claim the connection is safe',
  (inProduction[0] ?? '').includes('NOT ') && (inProduction[0] ?? '').includes('authenticated')
);

const inDevelopment = warnings(() => databaseSsl({}, false));
check('development is left quiet', inDevelopment.length, 0);

section('strict mode refuses to start instead');

const strict = threw(() => databaseSsl({ DATABASE_SSL_STRICT: 'true' }, false));
checkTrue('no CA plus strict is fatal', strict !== null);
checkTrue('...and says where to get the certificate', (strict ?? '').includes('Supabase dashboard'));

check(
  'strict with a CA is simply verified',
  databaseSsl({ DATABASE_SSL_STRICT: 'true', SUPABASE_CA_CERT: PEM }, false),
  { ca: PEM.trim(), rejectUnauthorized: true }
);

section('and localhost is left alone');

/**
 * A developer's own Postgres speaks plaintext and has no certificate to check.
 * Strict mode must not turn that into a refusal to boot.
 */
check('local needs no TLS at all', databaseSsl({}, true), false);
check(
  'even under strict mode',
  databaseSsl({ DATABASE_SSL_STRICT: 'true' }, true) satisfies DatabaseSsl,
  false
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

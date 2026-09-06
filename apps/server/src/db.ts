/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import dotenv from 'dotenv';
import postgres from 'postgres';

/**
 * The connection to Supabase Postgres.
 *
 * `dotenv.config()` runs here rather than only in `index.ts` because ES module
 * imports are evaluated before any statement in the importing module. A
 * `dotenv.config()` call sitting below the import list in `index.ts` would run
 * *after* this file had already read `process.env`, so the connection string
 * would always look unset. Calling it here makes the module self-sufficient:
 * it works the same whether it is reached through the server, a seed script or
 * a one-off `tsx` invocation. It never overwrites a variable that is already
 * set, so a real environment still wins over the file.
 */
dotenv.config();

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy apps/server/.env.example to apps/server/.env and ' +
      'paste your Supabase connection string into it — Supabase dashboard → ' +
      'Project Settings → Database → Connection string → URI.'
  );
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

/**
 * The certificate authority to check Supabase against, or null if none is set.
 *
 * `SUPABASE_CA_CERT` carries either the certificate itself or a path to it,
 * told apart by the PEM header — one of them starts with `-----BEGIN` and a
 * filesystem path never does. Render takes multi-line environment values, so
 * the inline form needs no file on the instance; the path form is for local
 * development, where a downloaded `.crt` beside the checkout is easier.
 *
 * Get it from the Supabase dashboard: Database → Settings → SSL Configuration
 * → download the CA certificate. It is a public certificate rather than a
 * secret, but it must come from the dashboard over an authenticated connection
 * — a root pulled off the wire from the very connection it is meant to verify
 * proves nothing, since a caller in a position to tamper with that connection
 * is in a position to hand you their own root.
 */
function certificateAuthority(configured: string | undefined): string | null {
  if (!configured) return null;

  if (configured.startsWith('-----BEGIN')) return configured;

  try {
    return fs.readFileSync(configured, 'utf8');
  } catch {
    throw new Error(
      `SUPABASE_CA_CERT points at ${configured}, which cannot be read. Give it either the ` +
        'certificate itself — the PEM block, newlines and all — or a path to a readable file.'
    );
  }
}

/**
 * How the connection to Supabase is secured.
 *
 * **`'require'` does not mean what it looks like it means.** In this driver it
 * maps to `rejectUnauthorized: false` — see `postgres/src/connection.js`, where
 * `'require'`, `'allow'` and `'prefer'` all land on the same line. The session
 * is encrypted against somebody listening and wide open to somebody
 * interposing: any certificate is accepted, self-signed, expired, or issued for
 * another host entirely. Anyone who can get into the path between this process
 * and Supabase reads every customer address, phone number and payment record,
 * can rewrite rows on the way past, and collects the `DATABASE_URL` password
 * during startup authentication — which is full write access to every table.
 *
 * So a CA is supplied and the certificate is checked. What the old note here
 * said was true — Supabase serves a chain rooted in its own `Supabase Root 2021
 * CA`, which is not in Node's trust store, so plain `verify-full` cannot
 * connect — but it drew the wrong conclusion from it. The bundle is one file
 * from the dashboard rather than something that has to be shipped, and Node
 * verifies the hostname against the certificate on its own once there is a
 * trust anchor to check against.
 *
 * `servername` is deliberately not set here. The driver already derives it from
 * the connection host, and this object is merged *over* its options — so naming
 * it again would only create a second place for the pooler's hostname to be
 * wrong.
 *
 * Without a CA this falls back to the old behaviour rather than refusing to
 * start, because a deployment that is running today must not be taken off the
 * air by a security fix it has not been configured for yet. That fallback is
 * announced loudly in production, and `DATABASE_SSL_STRICT=true` turns it into
 * a refusal — set that once the certificate is in place, and an unverified
 * connection can never quietly come back.
 */
export type DatabaseSsl = false | 'require' | { ca: string; rejectUnauthorized: true };

/**
 * Takes its environment rather than reading it, so the four branches can be
 * asserted in `db.check.ts` without opening a connection or a subprocess.
 */
export function databaseSsl(
  env: {
    SUPABASE_CA_CERT?: string;
    DATABASE_SSL_STRICT?: string;
    NODE_ENV?: string;
  },
  local: boolean
): DatabaseSsl {
  if (local) return false;

  const ca = certificateAuthority(env.SUPABASE_CA_CERT?.trim());
  if (ca) return { ca, rejectUnauthorized: true };

  if (env.DATABASE_SSL_STRICT === 'true') {
    throw new Error(
      'DATABASE_SSL_STRICT is set but SUPABASE_CA_CERT is not, so the database certificate ' +
        'cannot be verified. Add the CA from the Supabase dashboard (Database → Settings → SSL ' +
        'Configuration), or unset DATABASE_SSL_STRICT to accept an unverified connection.'
    );
  }

  if (env.NODE_ENV === 'production') {
    console.warn(
      '[db] SUPABASE_CA_CERT is not set. The connection to Postgres is encrypted but NOT ' +
        'authenticated — any certificate is accepted, so anyone able to intercept the path to ' +
        'Supabase can read and rewrite every record and capture the database password. ' +
        'Download the CA from the Supabase dashboard (Database → Settings → SSL Configuration), ' +
        'set it as SUPABASE_CA_CERT, then set DATABASE_SSL_STRICT=true to keep it that way.'
    );
  }

  return 'require';
}

export const sql = postgres(url, {
  ssl: databaseSsl(process.env, isLocal),

  /**
   * Prepared statements off.
   *
   * Supabase's pooled connection string (port 6543, Supavisor in transaction
   * mode) hands a different backend connection to each statement, so a
   * prepared statement created by one query is not there for the next and the
   * pooler reports it as missing. Direct connections on 5432 do not need this,
   * but leaving it off costs a plan cache rather than correctness, and it means
   * the same build works against either string.
   */
  prepare: false,

  max: Number(process.env.DATABASE_POOL_MAX || 10),
  idle_timeout: 20,
  connect_timeout: 10,

  /**
   * `timestamptz` comes back as a JS `Date`; the domain model speaks ISO
   * strings everywhere (`Job.createdAt`, `StoredSession.expiresAt`). Converting
   * at the boundary means no route has to remember which it is holding.
   */
  types: {
    date: {
      to: 1184,
      from: [1082, 1114, 1184],
      serialize: (value: Date | string) =>
        typeof value === 'string' ? value : value.toISOString(),
      parse: (value: string) => new Date(value).toISOString(),
    },
  },
});

/**
 * Anything a query can run against — the pool, or a transaction handle.
 *
 * Every repository function in `./store` takes one of these, so the same
 * function body serves a standalone call and a step inside `store.tx()`
 * without a second copy that differs only in what it was passed.
 */
export type Executor = postgres.Sql | postgres.TransactionSql;

/** Whether the database is reachable. Backs `/api/health`. */
export async function ping(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch (error) {
    console.error('[db] ping failed:', error);
    return false;
  }
}

/** Closes the pool on shutdown, letting in-flight queries finish first. */
export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}

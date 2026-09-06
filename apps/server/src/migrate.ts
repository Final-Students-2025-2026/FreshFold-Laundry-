/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, sql } from './db';

/**
 * Applies the SQL in `supabase/migrations` to whatever `DATABASE_URL` points at.
 *
 *   npm run db:migrate -w @freshfold/server
 *   npm run db:migrate -w @freshfold/server -- --dry-run
 *
 * Each file runs once and is recorded in `schema_migrations`, so this is safe
 * to run on every deploy: the second run has nothing to do and says so.
 *
 * A migration and the row that records it go in together, inside one
 * transaction. Half a migration marked as applied is the failure mode worth
 * spending a transaction to avoid — it is the one that needs a human to work
 * out which half.
 *
 * The Supabase SQL editor is still a fine way to run these by hand; this exists
 * so that it does not have to be, and so nobody has to remember which files
 * they already pasted.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, '..', '..', '..', 'supabase', 'migrations');

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`[migrate] no migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  // Sorted by filename, which is why they are named with a timestamp prefix.
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] no .sql files found');
    await closeDatabase();
    return;
  }

  await sql`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql<{ version: string }[]>`select version from schema_migrations`).map(
      (row) => row.version
    )
  );

  const pending = files.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log(`[migrate] up to date — ${applied.size} migration(s) already applied`);
    await closeDatabase();
    return;
  }

  console.log(`[migrate] ${pending.length} pending:`);
  for (const file of pending) console.log(`  ${file}`);

  if (dryRun) {
    console.log('[migrate] --dry-run: nothing was applied');
    await closeDatabase();
    return;
  }

  for (const file of pending) {
    const ddl = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      await tx`insert into schema_migrations (version) values (${file})`;
    });

    console.log(`[migrate] applied ${file}`);
  }

  console.log('[migrate] done');
  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error('[migrate] failed:', error);
  await closeDatabase().catch(() => {});
  process.exit(1);
});

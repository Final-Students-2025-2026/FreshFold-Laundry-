/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every table in `supabase/migrations` has row-level security turned on.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * This exists because the rule it enforces was already written down and still
 * decayed. The initial schema enabled RLS on its eight tables and left a comment
 * explaining that a client given direct Supabase access must find these tables
 * closed. Twenty migrations later, fourteen tables had been added and not one of
 * them repeated the line — including `invoices`, `claims`, `recurring_pickups`
 * and `audit_events`.
 *
 * Nobody decided that. A comment asking to be maintained is not a control, and
 * this is the difference: a new table without `enable row level security` fails
 * `npm test` in the same breath as a type error, which is the only moment
 * anybody is looking.
 *
 * Deliberately a text scan rather than a query against a live database. It has
 * to run in CI on a checkout with no `DATABASE_URL`, and what it is checking is
 * that the *migration* says so — a table enabled by hand in the Supabase console
 * is a table the next environment does not have.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, '..', '..', '..', 'supabase', 'migrations');

/**
 * Tables that are exempt, with the reason.
 *
 * `schema_migrations` is created by the runner in `./migrate`, not by any file
 * here, so the scan never sees it declared — and it holds filenames, which is
 * not data anybody needs protecting.
 */
const EXEMPT = new Set<string>(['schema_migrations']);

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.log(`FAIL  ${message}`);
}

function pass(message: string): void {
  console.log(`PASS  ${message}`);
}

/** Strips `--` line comments so a table named in prose is not counted. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

const files = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error(`[schema] no migrations found at ${MIGRATIONS}`);
  process.exit(1);
}

const created = new Map<string, string>();
const secured = new Set<string>();

for (const file of files) {
  const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));

  for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
    const table = match[1].toLowerCase();
    if (!created.has(table)) created.set(table, file);
  }

  for (const match of sql.matchAll(
    /alter\s+table\s+([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi
  )) {
    secured.add(match[1].toLowerCase());
  }
}

console.log(`\n--- row-level security ${'-'.repeat(40)}`);
console.log(`        ${created.size} tables across ${files.length} migrations\n`);

const unsecured = [...created.keys()]
  .filter((table) => !EXEMPT.has(table) && !secured.has(table))
  .sort();

if (unsecured.length === 0) {
  pass('every table enables row level security');
} else {
  for (const table of unsecured) {
    fail(
      `\`${table}\` has no \`enable row level security\` (created in ${created.get(table)}).\n` +
        '        Supabase grants anon and authenticated privileges on public tables by\n' +
        '        default and serves them over PostgREST, so a table without RLS is\n' +
        '        readable by anyone holding the project\'s anon key — which is a key\n' +
        '        designed to ship inside client code. Add the line to a migration.'
    );
  }
}

// A statement enabling RLS on something that was never created is a typo in a
// table name, which fails silently against Postgres — `alter table` on a missing
// relation errors, so the migration would break on deploy rather than here. Worth
// catching at the same moment as the other direction.
const phantom = [...secured].filter((table) => !created.has(table)).sort();
if (phantom.length === 0) {
  pass('every secured table is one that exists');
} else {
  for (const table of phantom) {
    fail(`\`${table}\` has RLS enabled but is never created — check the spelling.`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

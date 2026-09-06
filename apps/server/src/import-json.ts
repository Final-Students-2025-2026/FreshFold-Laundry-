/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Job, Message, Notification, PaymentTransaction } from '@freshfold/core';
import { hashToken } from './auth';
import { closeDatabase } from './db';
import {
  store,
  type StoredAccount,
  type StoredRider,
  type StoredSession,
  type StoredSupervisor,
} from './store';

/**
 * Moves the contents of the old `db.json` into Supabase. One shot.
 *
 *   npm run import:json -w @freshfold/server
 *   npm run import:json -w @freshfold/server -- --replace
 *   npm run import:json -w @freshfold/server -- ./some/other/db.json
 *
 * The whole import is a single transaction: it either all lands or none of it
 * does, so a failure halfway through leaves nothing to clean up before trying
 * again.
 *
 * It refuses to run against a database that already holds records, because the
 * one thing worse than not importing is importing over live work. `--replace`
 * says to truncate first and is the flag to use after the server has booted
 * once and seeded its three bootstrap identities.
 */

interface FileDatabase {
  jobs?: Job[];
  riders?: StoredRider[];
  messages?: Message[];
  notifications?: Notification[];
  accounts?: StoredAccount[];
  supervisors?: StoredSupervisor[];
  transactions?: PaymentTransaction[];
  sessions?: StoredSession[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

function resolveSource(args: string[]): string {
  const given = args.find((arg) => !arg.startsWith('--'));
  if (given) return path.resolve(given);
  return path.resolve(HERE, '..', 'data', 'db.json');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const source = resolveSource(args);

  if (!fs.existsSync(source)) {
    console.error(`[import] no file at ${source}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(source, 'utf8')) as FileDatabase;

  const jobs = data.jobs ?? [];
  const riders = data.riders ?? [];
  const accounts = data.accounts ?? [];
  const supervisors = data.supervisors ?? [];
  const transactions = data.transactions ?? [];
  const sessions = data.sessions ?? [];

  /**
   * Messages and notifications carry a foreign key to their job now, and the
   * file has plenty pointing at orders that were deleted — the arrays they
   * lived in had no way to notice. Those are dropped rather than imported
   * against a job that does not exist, and counted so the number is not a
   * surprise.
   */
  const jobIds = new Set(jobs.map((job) => job.id));
  const keptMessages = (data.messages ?? []).filter((m) => !m.orderId || jobIds.has(m.orderId));
  const keptNotifications = (data.notifications ?? []).filter(
    (n) => !n.orderId || jobIds.has(n.orderId)
  );
  const droppedMessages = (data.messages ?? []).length - keptMessages.length;
  const droppedNotifications = (data.notifications ?? []).length - keptNotifications.length;

  /**
   * Expired tokens are not worth carrying over — everyone holding one has to
   * sign in again either way.
   *
   * The dump predates sessions being stored as digests, so its rows carry the
   * raw token under `token`. Hashing it here is what keeps a still-valid
   * session working across the import: it produces exactly the digest the
   * server computes when that same token next arrives in a header. A dump
   * written since the change already holds the digest, and is passed through.
   */
  const now = Date.now();
  const liveSessions = sessions
    .filter((session) => Date.parse(session.expiresAt) > now)
    .map((session) => {
      const legacy = (session as StoredSession & { token?: string }).token;
      return legacy ? { ...session, tokenHash: hashToken(legacy) } : session;
    });

  console.log(`[import] reading ${source}`);

  if (replace) {
    console.log('[import] --replace: truncating every table first');
    await store.reset();
  } else {
    const [existingJobs, existingRiders] = await Promise.all([
      store.jobs.count(),
      store.riders.count(),
    ]);

    if (existingJobs > 0 || existingRiders > 0) {
      console.error(
        `[import] refusing to run: the database already holds ${existingJobs} jobs and ` +
          `${existingRiders} riders. Re-run with --replace to truncate first.`
      );
      await closeDatabase();
      process.exit(1);
    }
  }

  await store.tx(async (t) => {
    // Riders and jobs before the records that reference them.
    for (const rider of riders) await t.riders.insert(rider);
    for (const account of accounts) await t.accounts.insert(account);
    for (const supervisor of supervisors) await t.supervisors.insert(supervisor);
    for (const job of jobs) await t.jobs.upsert(job);

    for (const message of keptMessages) await t.messages.insert(message);
    for (const notification of keptNotifications) await t.notifications.insert(notification);
    for (const transaction of transactions) {
      await t.transactions.upsert({ ...transaction, id: transaction.id || transaction.reference });
    }
    for (const session of liveSessions) await t.sessions.insert(session);
  });

  console.log('[import] done:');
  console.log(`  jobs           ${jobs.length}`);
  console.log(`  riders         ${riders.length}`);
  console.log(`  accounts       ${accounts.length}`);
  console.log(`  supervisors    ${supervisors.length}`);
  console.log(`  transactions   ${transactions.length}`);
  console.log(
    `  messages       ${keptMessages.length}` +
      (droppedMessages ? ` (${droppedMessages} orphaned, dropped)` : '')
  );
  console.log(
    `  notifications  ${keptNotifications.length}` +
      (droppedNotifications ? ` (${droppedNotifications} orphaned, dropped)` : '')
  );
  console.log(
    `  sessions       ${liveSessions.length}` +
      (sessions.length - liveSessions.length
        ? ` (${sessions.length - liveSessions.length} expired, dropped)`
        : '')
  );
  console.log(`\n[import] ${source} is left untouched — keep it until you are satisfied.`);

  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error('[import] failed, nothing was written:', error);
  await closeDatabase().catch(() => {});
  process.exit(1);
});

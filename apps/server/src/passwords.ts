/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { RiderState, UserAccount } from '@freshfold/core';
import type { StoredAccount, StoredRider } from './store';

/**
 * Password hashing, and the one function that makes an account safe to send.
 *
 * Deliberately free of runtime dependencies — the seed data needs to hash
 * passwords while the store is still being constructed, so this module must not
 * import the store back.
 *
 * ---
 *
 * **Three things changed here, and they are related.**
 *
 * *It was synchronous.* `scryptSync` occupies the event loop for the whole
 * derivation, on a single-process server that also runs a fifteen-second hub
 * sweep. Concurrent sign-ins queued behind each other, and an unbounded
 * registration endpoint was an unbounded way to hold the loop. `scrypt` runs on
 * libuv's threadpool instead, so the server keeps answering while it works.
 *
 * *It ran at Node's defaults*, N=2^14, which is below what OWASP's Password
 * Storage Cheat Sheet asks for and cheap for anybody cracking a stolen
 * `accounts` table offline.
 *
 * *And the parameters were not recorded*, so raising them would have meant
 * every existing row being unverifiable. They are part of the stored hash now,
 * which is what makes {@link needsRehash} possible: an old password is checked
 * with the parameters it was made under and quietly re-hashed with the current
 * ones the next time it is used successfully. Nobody is locked out and nobody
 * has to be asked to change anything.
 */

const scryptAsync = promisify(scrypt) as (
  secret: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const KEYLEN = 64;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

/** What Node's `scryptSync` defaulted to, and therefore what every old row used. */
const LEGACY_COST = 14;

/**
 * The current cost, as a power of two.
 *
 * **Sixteen rather than OWASP's seventeen, on purpose.** scrypt's memory is
 * `128 · N · r`, so the cost is bought in RAM as much as in time:
 *
 * ```
 *   2^14 (the old default)    16 MB     240 ms
 *   2^15                      32 MB     477 ms
 *   2^16 (this)               64 MB    1094 ms
 *   2^17 (OWASP's minimum)   128 MB    1963 ms
 * ```
 *
 * Measured on the development machine, which is roughly three times slower than
 * a typical server — the shape matters more than the absolute numbers.
 *
 * The deployment target is a 512 MB Render instance that also holds the
 * Postgres pool and the hub cycle. Derivations run on libuv's threadpool, four
 * wide by default, so the memory ceiling is four concurrent hashes: 256 MB at
 * 2^16, and 512 MB at 2^17 — the whole instance, for hashing alone. A KDF that
 * puts the process in front of the OOM killer on four simultaneous sign-ins has
 * not made anybody safer. 2^16 is four times the work the old default cost and
 * leaves the process room to answer the requests it is hashing for.
 *
 * Configurable because the right answer is a property of the box rather than of
 * the code, and because raising it is now free: the parameters travel with each
 * hash, so an operator who moves to a larger instance sets `SCRYPT_COST=17` and
 * every account upgrades itself as its owner next signs in.
 */
const CURRENT_COST = (() => {
  const asked = Number(process.env.SCRYPT_COST);
  if (!Number.isInteger(asked)) return 16;
  // Below 14 is weaker than what this replaced; above 20 is 1 GB a hash.
  return Math.min(Math.max(asked, 14), 20);
})();

/** `maxmem` is a ceiling, not an allocation. Node's 32 MB default is too low. */
function maxmemFor(cost: number): number {
  return 2 * 128 * 2 ** cost * BLOCK_SIZE;
}

interface Params {
  cost: number;
  blockSize: number;
  parallelism: number;
}

const CURRENT_PARAMS: Params = {
  cost: CURRENT_COST,
  blockSize: BLOCK_SIZE,
  parallelism: PARALLELISM,
};

const LEGACY_PARAMS: Params = { cost: LEGACY_COST, blockSize: 8, parallelism: 1 };

/**
 * How a hash is stored: `scrypt$<cost>$<r>$<p>$<hex>`.
 *
 * A bare hex string is a row written before this existed, and is read with
 * {@link LEGACY_PARAMS}. Keeping the old format readable rather than migrating
 * it is what avoids signing every customer out — the alternative is a column
 * nobody can verify against and a password reset for the whole table.
 */
const ENCODED = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([0-9a-f]+)$/;

function encode(params: Params, derived: Buffer): string {
  return `scrypt$${params.cost}$${params.blockSize}$${params.parallelism}$${derived.toString('hex')}`;
}

function decode(stored: string): { params: Params; expected: Buffer } {
  const match = ENCODED.exec(stored);
  if (!match) return { params: LEGACY_PARAMS, expected: Buffer.from(stored, 'hex') };

  return {
    params: {
      cost: Number(match[1]),
      blockSize: Number(match[2]),
      parallelism: Number(match[3]),
    },
    expected: Buffer.from(match[4], 'hex'),
  };
}

async function derive(secret: string, salt: string, params: Params): Promise<Buffer> {
  return scryptAsync(secret, salt, KEYLEN, {
    N: 2 ** params.cost,
    r: params.blockSize,
    p: params.parallelism,
    maxmem: maxmemFor(params.cost),
  });
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString('hex');
  return {
    salt,
    hash: encode(CURRENT_PARAMS, await derive(password, salt, CURRENT_PARAMS)),
  };
}

/**
 * Whether this stored hash was made with weaker parameters than we now use.
 *
 * Called after a *successful* verification — that is the only moment the plain
 * secret is in hand to re-derive from. See the sign-in routes.
 */
export function needsRehash(stored: string | undefined): boolean {
  if (!stored) return false;
  const { params } = decode(stored);
  return (
    params.cost < CURRENT_PARAMS.cost ||
    params.blockSize !== CURRENT_PARAMS.blockSize ||
    params.parallelism !== CURRENT_PARAMS.parallelism
  );
}

/**
 * A salt and hash that match nothing, derived once at startup.
 *
 * This is the whole of the fix for the timing oracle. All three sign-in routes
 * take care to return one identical message whether the account is unknown or
 * the password is wrong — and then gave the answer away anyway, because a
 * missing account returned `false` immediately while a real one paid the full
 * scrypt cost. The gap is hundreds of milliseconds and trivially measurable, so
 * the careful wording was measuring as decoration.
 *
 * Rather than asking every route to remember to burn time, the burn lives in
 * {@link verifySecret}: a credential with no salt or hash is checked against
 * this one and takes exactly as long as a real failure. A call site cannot
 * forget to do it, because there is nothing to remember.
 *
 * The residual gap is that a *legacy* row still verifies faster than the
 * current parameters, so timing distinguishes an old account from an unknown
 * one. That shrinks to nothing as `needsRehash` upgrades rows on sign-in, and
 * it does not reveal what the original oracle did — whether an address is a
 * customer at all.
 */
const DUMMY = (() => {
  const salt = randomBytes(16).toString('hex');
  return { salt, promise: derive('a password that is not anybody\'s', salt, CURRENT_PARAMS) };
})();

/**
 * Compares a secret against a stored salt/hash pair.
 *
 * Takes the pair rather than an account so riders can use it too — their PIN is
 * hashed exactly the same way, and there is no reason for a second copy of this
 * with different field names.
 */
export async function verifySecret(
  secret: string,
  stored: { salt?: string; hash?: string }
): Promise<boolean> {
  // No credential to check. Burn the same time a real failure costs, then say
  // no — see the note on DUMMY.
  if (!stored.salt || !stored.hash) {
    await derive(secret, DUMMY.salt, CURRENT_PARAMS);
    return false;
  }

  const { params, expected } = decode(stored.hash);

  // A hash whose recorded parameters are nonsense — a truncated row, a bad
  // hand-edit — must not be a way to ask for a 1 GB allocation.
  if (params.cost < 1 || params.cost > 20 || params.blockSize < 1 || params.parallelism < 1) {
    await DUMMY.promise;
    return false;
  }

  const attempt = await derive(secret, stored.salt, params);

  // timingSafeEqual throws on a length mismatch, so check that first.
  if (attempt.length !== expected.length) return false;
  return timingSafeEqual(attempt, expected);
}

export async function verifyPassword(
  password: string,
  account: StoredAccount | null | undefined
): Promise<boolean> {
  return verifySecret(password, {
    salt: account?.passwordSalt,
    hash: account?.passwordHash,
  });
}

/**
 * Strips a courier's credentials so the record can be sent to a client.
 *
 * `mustChangePin` deliberately survives — the console needs to know it is on a
 * provisional credential. `pinExpiresAt` does not: when that deadline falls is
 * the desk's business, and publishing it tells an attacker how long a
 * guessable temporary PIN has left.
 */
export function sanitizeRider(rider: StoredRider): RiderState {
  const { pinSalt, pinHash, active, pinExpiresAt, ...safe } = rider;
  return safe;
}

/**
 * Strips credentials off an account so it can be sent to a client.
 *
 * Every route returning account data goes through this. Handing back a
 * `StoredAccount` directly is precisely the bug this exists to prevent.
 */
export function sanitize(account: StoredAccount): UserAccount {
  const {
    passwordHash,
    passwordSalt,
    // The confirmation link and its clock. A client that could read the digest
    // could confirm an address it does not own, and when the link expires is
    // not the customer's business — the resend button is.
    verificationTokenHash,
    verificationExpiresAt,
    verificationSentAt,
    // Why a supervisor suspended this account. `blockedAt` survives — a client
    // has to know it is looking at a blocked account — but the note behind it
    // is the desk's, and `GET /api/accounts` answers anyone who asks.
    blockedReason,
    ...safe
  } = account;
  return { ...safe, hasPassword: Boolean(passwordHash) };
}

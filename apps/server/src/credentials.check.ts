/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How secrets are hashed, and how long a wrong answer takes to give.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * Three findings meet in this file.
 *
 * *The cost was Node's default*, N=2^14, below what OWASP's Password Storage
 * Cheat Sheet asks for and cheap to attack offline. It was also `scryptSync`,
 * which holds the event loop of a single-process server for the whole
 * derivation. And the parameters were not recorded anywhere, so raising them
 * would have made every existing row unverifiable — which is why they are part
 * of the stored hash now, and why an old password is upgraded quietly the next
 * time its owner uses it.
 *
 * *And a missing account answered instantly* while a real one paid the full
 * scrypt cost. All three sign-in routes take care to return one identical
 * message either way; the clock gave it back. The last section is the one that
 * matters most here, because it is the assertion that the careful wording is
 * doing something rather than decorating.
 */

import { hashPassword, needsRehash, verifyPassword, verifySecret } from './passwords';
import { hashToken } from './auth';

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

async function timed(work: () => Promise<unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  await work();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function main(): Promise<void> {
  section('hashing, and reading a hash back');

  const stored = await hashPassword('a real password');

  checkTrue('the right secret verifies', await verifySecret('a real password', stored));
  checkTrue('a wrong one does not', !(await verifySecret('a real passwore', stored)));
  checkTrue('nor does the empty string', !(await verifySecret('', stored)));

  const again = await hashPassword('a real password');
  checkTrue('the same password hashes differently each time', again.hash !== stored.hash);
  checkTrue('...because the salt is fresh', again.salt !== stored.salt);

  section('the parameters travel with the hash');

  /**
   * This is what makes the cost raisable at all. Without it, changing the
   * parameters would leave every stored row unverifiable and the only way
   * forward would be resetting every password in the table.
   */
  checkTrue('a new hash records how it was made', stored.hash.startsWith('scrypt$'));
  const cost = Number(/^scrypt\$(\d+)\$/.exec(stored.hash)?.[1]);
  checkTrue('at a cost above the old Node default of 2^14', cost > 14);
  checkTrue('a fresh hash does not want re-hashing', !needsRehash(stored.hash));

  section('an old hash still works, and is upgraded');

  /**
   * A row written before any of this: bare hex, no parameters, made at Node's
   * default cost. It has to keep verifying — the alternative is signing every
   * customer out — and it has to be recognised as due for an upgrade.
   */
  const { scryptSync } = await import('node:crypto');
  const legacySalt = 'a'.repeat(32);
  const legacy = {
    salt: legacySalt,
    hash: scryptSync('an old password', legacySalt, 64).toString('hex'),
  };

  checkTrue('a legacy hash still verifies', await verifySecret('an old password', legacy));
  checkTrue('a wrong secret against it still fails', !(await verifySecret('nope', legacy)));
  checkTrue('and it is flagged for re-hashing', needsRehash(legacy.hash));
  checkTrue('an absent hash is not flagged', !needsRehash(undefined));

  section('nonsense parameters are refused, not obeyed');

  // A truncated row or a bad hand-edit must not become a way to ask the process
  // for a 1 GB allocation.
  checkTrue(
    'an absurd cost is refused rather than attempted',
    !(await verifySecret('anything', { salt: 'ab', hash: 'scrypt$40$8$1$00' }))
  );
  checkTrue(
    'a zero block size is refused',
    !(await verifySecret('anything', { salt: 'ab', hash: 'scrypt$16$0$1$00' }))
  );

  section('a missing account costs the same as a wrong password');

  /**
   * The finding, and the assertion that closes it.
   *
   * `verifySecret` used to return false immediately when there was no stored
   * credential, so an unknown address answered in about a millisecond while a
   * real one paid the full derivation. Both branches now derive, so the two are
   * within the same order of magnitude.
   *
   * The bound is deliberately loose — a factor of three, over an average of
   * several runs. This measures wall-clock on a shared machine, and an
   * assertion tight enough to be interesting would be one that fails on a busy
   * CI box for reasons that have nothing to do with the property.
   */
  // Each iteration is two real derivations, so this is the slow part of the
  // suite. Three is enough to average out a scheduling hiccup.
  const runs = 3;
  let wrongTotal = 0;
  let missingTotal = 0;

  for (let run = 0; run < runs; run += 1) {
    wrongTotal += await timed(() => verifySecret('wrong password', stored));
    missingTotal += await timed(() => verifySecret('wrong password', {}));
  }

  const wrong = wrongTotal / runs;
  const missing = missingTotal / runs;
  const ratio = Math.max(wrong, missing) / Math.max(1, Math.min(wrong, missing));

  console.log(
    `        wrong password ${wrong.toFixed(1)}ms · unknown account ${missing.toFixed(1)}ms · ratio ${ratio.toFixed(2)}x`
  );

  checkTrue('an unknown account is not answered instantly', missing > 5);
  checkTrue('the two are within the same order of magnitude', ratio < 3);

  checkTrue('and it still answers no', !(await verifySecret('anything', {})));
  checkTrue('a null account verifies as no', !(await verifyPassword('anything', null)));
  checkTrue('so does an undefined one', !(await verifyPassword('anything', undefined)));

  section('session tokens are stored as digests');

  /**
   * Every other token in the system is stored hashed and always has been. The
   * session token — the credential every request carries — was the exception.
   */
  const token = 'f'.repeat(64);
  const digest = hashToken(token);

  check('a digest is sha-256 hex', /^[0-9a-f]{64}$/.test(digest), true);
  checkTrue('and is not the token', digest !== token);
  check('the same token always gives the same digest', hashToken(token), digest);
  checkTrue('a different token gives a different digest', hashToken('e'.repeat(64)) !== digest);

  /**
   * The migration converts existing rows in place by hashing the token already
   * in the column, which is what keeps live sessions working across the deploy.
   * This asserts the digest the server computes is the one Postgres will have
   * written — the two have to agree or every phone signs out at once.
   */
  const { createHash } = await import('node:crypto');
  check(
    "it matches what the migration's sha256() produces",
    digest,
    createHash('sha256').update(token).digest('hex')
  );

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

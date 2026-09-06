/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one password rule, which used to be four that disagreed.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * The server refused anything under five characters, the website's setup form
 * refused under five with its own sentence, the customer app refused under six,
 * and the reset page rendered a `minlength` from a constant only the server
 * could see. So a five-character password was accepted by one surface, rejected
 * by another, and explained differently by each.
 *
 * Five was also below the floor NIST SP 800-63B and OWASP ASVS 2.1.1 both set,
 * which is eight.
 */

import { check, checkTrue, report, section } from './check';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_LENGTH_MESSAGE,
  passwordProblem,
} from './passwords';

section('the floor');

check('eight, per NIST SP 800-63B and ASVS 2.1.1', MIN_PASSWORD_LENGTH, 8);
check('one character short is refused', passwordProblem('a'.repeat(7)), PASSWORD_LENGTH_MESSAGE);
check('exactly eight is accepted', passwordProblem('a'.repeat(8)), null);
check('the old five-character floor no longer passes', passwordProblem('abcde'), PASSWORD_LENGTH_MESSAGE);
check('nor does the app\'s old six', passwordProblem('abcdef'), PASSWORD_LENGTH_MESSAGE);
check('an empty password is refused', passwordProblem(''), PASSWORD_LENGTH_MESSAGE);

section('the ceiling, which is there for a different reason');

// Not a strength rule — a bound on how much scrypt a stranger can ask for.
checkTrue('a very long password is refused', passwordProblem('a'.repeat(MAX_PASSWORD_LENGTH + 1)) !== null);
check('exactly at the limit is fine', passwordProblem('a'.repeat(MAX_PASSWORD_LENGTH)), null);

section('what everybody picks');

checkTrue('"password" is refused however it is capitalised', passwordProblem('PaSsWoRd') !== null);
checkTrue('so is "12345678"', passwordProblem('12345678') !== null);
checkTrue('so is "qwerty123"', passwordProblem('qwerty123') !== null);
checkTrue('and the obvious one for this product', passwordProblem('freshfold123') !== null);

check('a long ordinary password is accepted', passwordProblem('kumasi-linen-tuesday'), null);
check('so is a passphrase with spaces', passwordProblem('two clean shirts please'), null);

/**
 * NIST asks for a blocklist *instead of* composition rules, not alongside them.
 * A password that is long and unremarkable must pass without symbols or digits,
 * because "must contain a symbol" is what produces `Password1!`.
 */
check('no composition rule is imposed', passwordProblem('alltheletters'), null);

section('one rule, one sentence');

/**
 * Each surface used to write its own copy. The value of a shared function is
 * that the sentence comes with the verdict, so there is nothing left to
 * paraphrase differently.
 */
checkTrue('a refusal explains itself', (passwordProblem('abc') ?? '').length > 10);
check('the length message names the actual minimum', PASSWORD_LENGTH_MESSAGE.includes('8'), true);
checkTrue(
  'a common password is refused for being common, not for being short',
  !(passwordProblem('password123') ?? '').includes('at least')
);

report();

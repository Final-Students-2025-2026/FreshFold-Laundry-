/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What counts as an acceptable password, in one place.
 *
 * It was in four, and they disagreed: the server refused anything under five
 * characters, the website's setup form refused under five with its own copy of
 * the sentence, the customer app refused under six, and the reset page rendered
 * a `minlength` from a constant only the server could see. A customer choosing
 * a five-character password was accepted by the website, rejected by the app,
 * and told two different things about why.
 *
 * The floor was also simply too low. NIST SP 800-63B and OWASP ASVS 2.1.1 both
 * set eight as the minimum, and five is a space an attacker walks offline in
 * minutes regardless of how patiently the login route is rate-limited.
 *
 * Here rather than in the server because a client that cannot check the rule
 * has to guess it, and guessing is what produced the four versions. The server
 * still enforces it — this is what lets the apps say the same thing first.
 */

/**
 * The floor. Eight, per NIST SP 800-63B and OWASP ASVS 2.1.1.
 *
 * Existing shorter passwords keep working: this is checked when one is *set*,
 * not when one is used, so nobody is locked out of an account by a rule that
 * arrived after they chose it.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The ceiling, which exists for a different reason than the floor.
 *
 * Not a strength rule — it is a bound on how much work a stranger can ask the
 * server to do. The hash cost is paid per attempt on whatever arrives, and
 * without this a request body can carry a megabyte of it.
 */
export const MAX_PASSWORD_LENGTH = 200;

export const PASSWORD_LENGTH_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * Passwords that are refused whatever their length.
 *
 * NIST SP 800-63B asks for exactly this in place of composition rules — no
 * "must contain a symbol", which mostly produces `Password1!` — and a short
 * list of what people actually pick catches more real cases than any pattern
 * would. Deliberately small: it is checked in the browser as well, and a
 * hundred thousand entries in the bundle to catch the same accounts these forty
 * do is not a trade worth making.
 *
 * Compared case-insensitively, so `PASSWORD` and `Password` are both here.
 */
const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty123',
  'qwertyuiop',
  '1q2w3e4r',
  '1qaz2wsx',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'welcome1',
  'welcome123',
  'admin123',
  'letmein1',
  'letmein123',
  'trustno1',
  'starwars',
  'whatever',
  'superman',
  'michael1',
  'jennifer',
  'computer',
  'freedom1',
  'monkey123',
  'dragon123',
  'abc12345',
  'abcd1234',
  'a1b2c3d4',
  'zaq12wsx',
  'asdfghjkl',
  'freshfold',
  'freshfold1',
  'freshfold123',
  'laundry123',
]);

/**
 * Why this password cannot be used, or null if it can.
 *
 * Returns the sentence to show rather than a code, because every caller does
 * the same thing with it and a second mapping from code to sentence is a second
 * place for the four versions to grow back.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_LENGTH_MESSAGE;

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'That password is one of the most commonly used ones. Please choose another.';
  }

  return null;
}

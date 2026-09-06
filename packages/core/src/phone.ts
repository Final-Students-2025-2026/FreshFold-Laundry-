/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phone numbers.
 *
 * Everybody FreshFold deals with — patrons, couriers, the MoMo account a bill
 * is settled from — is reachable on a Ghanaian mobile number, and a Ghanaian
 * mobile number is ten digits: `0XX XXX XXXX`. Nine is a typo and eleven is a
 * typo, so every field that takes one holds exactly ten digits and nothing
 * else. The rules live here rather than in each form, because a number typed
 * into the booking modal and the same number typed into the rider roster have
 * to end up looking the same in the database.
 */

/** A Ghanaian mobile number, in digits. `0XX XXX XXXX`. */
export const PHONE_DIGITS = 10;

/** Every digit of a number, with spaces, dashes, brackets and `+` dropped. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * What a phone field is allowed to contain after a keystroke.
 *
 * Anything that is not a digit never lands, and the eleventh digit never
 * lands either — the field simply stops accepting, which is a quieter way of
 * saying "ten" than an error message under a full box.
 */
export function limitPhoneInput(value: string): string {
  const digits = phoneDigits(value);

  // Somebody pasting an international number meant the same number, so keep
  // the number rather than the first ten characters of it: `+233 244 567 801`
  // becomes `0244567801`, not `2332445678`, which is nobody.
  if (digits.length > PHONE_DIGITS && digits.startsWith('233')) {
    return `0${digits.slice(3)}`.slice(0, PHONE_DIGITS);
  }

  return digits.slice(0, PHONE_DIGITS);
}

/** Whether a field holds a whole number rather than half of one. */
export function isCompletePhone(value: string): boolean {
  return phoneDigits(value).length === PHONE_DIGITS;
}

/** What to say when it does not. One wording, everywhere it is said. */
export const PHONE_LENGTH_MESSAGE = `A phone number is ${PHONE_DIGITS} digits, e.g. 0244000000.`;

/**
 * The comparable part of a number, so that two ways of writing the same phone
 * match: `0244567801`, `+233 244 567 801` and `233244567801` all reduce to
 * `244567801`. Records predate the ten-digit rule — a patron who registered
 * in international format still has to be able to sign in.
 */
export function phoneKey(value: string): string {
  let digits = phoneDigits(value);
  if (digits.length > 9 && digits.startsWith('233')) digits = digits.slice(3);
  if (digits.length > 9 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(-9);
}

/** Whether two numbers are the same number, however each was written. */
export function samePhone(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = phoneKey(a);
  return left.length === 9 && left === phoneKey(b);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * What counts as an email address, for the one question anything here asks of
 * one: is there something to send to.
 *
 * Deliberately loose. This is not an attempt to decide which addresses exist —
 * only delivery answers that, which is why the confirmation link exists — but
 * to catch the blank field, the typo with no `@`, and the domain with no dot.
 * A stricter pattern buys nothing and costs the occasional real customer with
 * an address it has not heard of.
 *
 * It lives beside the phone rules and for the same reason: the booking form on
 * the website, the one in the customer app and the setup-link check on the
 * server all have to agree about what an address is, and three copies of a
 * regular expression do not stay equal.
 */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether there is an address here worth sending a receipt to. */
export function isEmailShaped(value: string | undefined | null): boolean {
  return typeof value === 'string' && EMAIL_SHAPE.test(value.trim());
}

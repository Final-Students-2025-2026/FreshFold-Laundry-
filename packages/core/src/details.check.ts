/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for the details a booking is made of: dates, addresses, phone numbers
 * and email addresses.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * Separate from `money.check.ts` because nothing here decides a price. What it
 * has in common is that every rule below used to live in two or three places at
 * once — a phone field in the website's form and another in the app's, two
 * copies of the date arithmetic, an email pattern on the server and nothing at
 * all on the clients — and the drift between those copies is what the
 * assertions are aimed at.
 */

import { check, checkTrue, report, section } from './check';
import { isoDaysFromNow, isoPlusDays, isIsoDate, todayIso } from './dates';
import {
  MAX_SAVED_ADDRESSES,
  defaultAddress,
  normaliseAddresses,
  sameAddresses,
  withAddress,
  withoutAddress,
} from './addresses';
import {
  EMAIL_SHAPE,
  PHONE_DIGITS,
  isCompletePhone,
  isEmailShaped,
  limitPhoneInput,
  phoneDigits,
  samePhone,
} from './phone';
import type { SavedAddress } from './types';

const address = (id: string, over: Partial<SavedAddress> = {}): SavedAddress => ({
  id,
  label: `Label ${id}`,
  address: `${id} Street`,
  suburb: 'Ayeduase',
  isDefault: false,
  ...over,
});

// ---------------------------------------------------------------------------
section('calendar dates');

// A delivery date is a day on a calendar, not an instant, and the arithmetic
// must not consult a timezone. See the header of `dates.ts`.
check('the day after', isoPlusDays('2026-08-24', 1), '2026-08-25');
check('across a month', isoPlusDays('2026-08-31', 1), '2026-09-01');
check('across a year', isoPlusDays('2026-12-31', 1), '2027-01-01');
check('into a leap day', isoPlusDays('2028-02-28', 1), '2028-02-29');
check('past a non-leap February', isoPlusDays('2026-02-28', 1), '2026-03-01');
check('backwards', isoPlusDays('2026-01-01', -1), '2025-12-31');
check('nowhere', isoPlusDays('2026-08-24', 0), '2026-08-24');

// Null rather than a guess: a form mid-keystroke is the ordinary case, and the
// caller is the one that knows what to show instead.
check('a blank field is not a date', isoPlusDays('', 1), null);
check('a half-typed date is not a date', isoPlusDays('2026-08', 1), null);
check('nor is a word', isoPlusDays('tomorrow', 1), null);
check('nor is a slashed date', isoPlusDays('24/08/2026', 1), null);

check('a real day', isIsoDate('2026-08-24'), true);
check('a day that does not exist', isIsoDate('2026-02-31'), false);
check('the 13th month', isIsoDate('2026-13-01'), false);
check('the right shape backwards', isIsoDate('24-08-2026'), false);
check('not a string at all', isIsoDate(20260824), false);

// `todayIso` is the one function here that reads a clock, and it reads the
// *local* one — what the customer means by "today" is the date on their wall.
check('late evening is still today', todayIso(new Date(2026, 7, 24, 23, 59)), '2026-08-24');
check('one minute past midnight is the new day', todayIso(new Date(2026, 7, 25, 0, 1)), '2026-08-25');
check('single digits are padded', todayIso(new Date(2026, 0, 5, 12, 0)), '2026-01-05');

// The bug this replaced: `new Date()` + `setDate(+1)` + `toISOString()` gave
// the day after tomorrow in the evening west of Greenwich, and today in the
// morning east of it.
check('tomorrow, from a late evening', isoDaysFromNow(1, new Date(2026, 7, 24, 23, 30)), '2026-08-25');
check('tomorrow, from an early morning', isoDaysFromNow(1, new Date(2026, 7, 24, 6, 15)), '2026-08-25');
check('tomorrow, from midday', isoDaysFromNow(1, new Date(2026, 7, 24, 12, 0)), '2026-08-25');
check('today', isoDaysFromNow(0, new Date(2026, 7, 24, 18, 0)), '2026-08-24');

// ---------------------------------------------------------------------------
section('the address book');

check('an entry with no address is dropped', normaliseAddresses([address('a', { address: '' })]), []);
check('an entry with no suburb is dropped', normaliseAddresses([address('a', { suburb: '' })]), []);
check('an entry with no id is dropped', normaliseAddresses([address('')]), []);
check('anything that is not an object is dropped', normaliseAddresses(['home', null, 7]), []);
check('a non-array is an empty book', normaliseAddresses('home'), []);

check('a blank label falls back to the suburb',
  normaliseAddresses([address('a', { label: '' })])[0].label, 'Ayeduase');

{
  // The whole array is rewritten on every save from two surfaces at once, so
  // "a later duplicate wins, in the earlier one's position" is what stops the
  // book reshuffling under the customer.
  const deduped = normaliseAddresses([
    address('a', { address: 'First' }),
    address('b'),
    address('a', { address: 'Second' }),
  ]);
  check('a duplicate id collapses to one entry', deduped.length, 2);
  check('...the later one wins', deduped[0].address, 'Second');
  check('...in the earlier one position', deduped[0].id, 'a');
}

{
  const book = normaliseAddresses([address('a'), address('b')]);
  check('a book with no default gets one', book.filter((entry) => entry.isDefault).length, 1);
  check('...and it is the first', book[0].isDefault, true);
}

{
  const book = normaliseAddresses([
    address('a', { isDefault: true }),
    address('b', { isDefault: true }),
  ]);
  check('two claimants leave exactly one default',
    book.filter((entry) => entry.isDefault).length, 1);
}

{
  // The invariant `withAddress` exists to protect: an edit claiming the default
  // has to clear the flag from whoever held it, or the normaliser finds the old
  // one first and the customer's choice is silently lost.
  const book = withAddress([address('a', { isDefault: true }), address('b')],
    address('b', { isDefault: true }));
  check('claiming the default moves it', book.find((e) => e.id === 'b')?.isDefault, true);
  check('...and takes it from the old holder', book.find((e) => e.id === 'a')?.isDefault, false);
  check('...leaving exactly one', book.filter((e) => e.isDefault).length, 1);
}

{
  const book = withAddress([address('a'), address('b')], address('a', { address: 'Moved' }));
  check('editing an entry does not move it to the bottom', book[0].id, 'a');
  check('...and does not add a second copy', book.length, 2);
  check('...but does change it', book[0].address, 'Moved');
}

{
  const full = Array.from({ length: MAX_SAVED_ADDRESSES }, (_, i) => address(`a${i}`));
  const rejected = withAddress(full, address('one-too-many'));
  check('a full book refuses a new entry', rejected.length, MAX_SAVED_ADDRESSES);
  checkTrue('...and the new one is not in it',
    !rejected.some((entry) => entry.id === 'one-too-many'));

  // Editing is not adding: a full book must still be editable.
  const edited = withAddress(full, address('a0', { address: 'Edited' }));
  check('...but an edit to an existing entry still lands', edited[0].address, 'Edited');
  check('...without growing the book', edited.length, MAX_SAVED_ADDRESSES);

  // The reason `withAddress` guards the ceiling itself rather than leaving it
  // to the slice in `normaliseAddresses`. A rejected entry that had claimed the
  // default would otherwise clear the flag from every existing address on its
  // way to being dropped — so refusing to add a thirteenth address would also
  // silently move the customer's default to whatever sorted first.
  const withDefault = Array.from({ length: MAX_SAVED_ADDRESSES }, (_, i) =>
    address(`a${i}`, { isDefault: i === 2 }));
  const refused = withAddress(withDefault, address('overflow', { isDefault: true }));
  check('a refused entry does not move the existing default',
    refused.find((entry) => entry.isDefault)?.id, 'a2');
  checkTrue('...and is not stored', !refused.some((entry) => entry.id === 'overflow'));
}

{
  // Deleting the default hands it on, which is the normaliser promoting the
  // first survivor rather than anything `withoutAddress` does itself.
  const left = withoutAddress([address('a', { isDefault: true }), address('b')], 'a');
  check('removing an entry removes it', left.length, 1);
  check('...and the default is handed on', left[0].isDefault, true);

  check('removing something absent changes nothing',
    withoutAddress([address('a', { isDefault: true })], 'nope').length, 1);
  check('emptying the book is allowed', withoutAddress([address('a')], 'a'), []);
}

check('the default of an empty book is null', defaultAddress([]), null);
check('and of an undefined book', defaultAddress(undefined), null);
check('the default is the one flagged',
  defaultAddress(normaliseAddresses([address('a'), address('b', { isDefault: true })]))?.id, 'b');

{
  // Used to decide whether a save is worth making, so a false positive is a
  // write on every poll and a false negative is a lost edit.
  const book = normaliseAddresses([address('a'), address('b')]);
  checkTrue('a book equals itself', sameAddresses(book, book));
  checkTrue('...and an identical copy', sameAddresses(book, normaliseAddresses([address('a'), address('b')])));
  checkTrue('...but not one with an edit in it',
    !sameAddresses(book, normaliseAddresses([address('a', { address: 'Changed' }), address('b')])));
  checkTrue('...nor one with an entry missing', !sameAddresses(book, [book[0]]));
}

// ---------------------------------------------------------------------------
section('phone numbers');

check('a Ghanaian mobile number is ten digits', PHONE_DIGITS, 10);
check('formatting is stripped', phoneDigits('024 456 7801'), '0244567801');
check('so are brackets and dashes', phoneDigits('(024)-456-7801'), '0244567801');

check('ten digits is complete', isCompletePhone('0244567801'), true);
check('nine is a typo', isCompletePhone('024456780'), false);
check('eleven is a typo', isCompletePhone('02445678012'), false);
check('blank is not a number', isCompletePhone(''), false);

check('the eleventh digit never lands', limitPhoneInput('02445678019'), '0244567801');
check('letters never land', limitPhoneInput('024abc4567801'), '0244567801');

// Pasting an international number means the same number, so it is converted
// rather than truncated: `2332445678` is nobody.
check('a pasted +233 number becomes a local one', limitPhoneInput('+233 24 456 7801'), '0244567801');

// Both sides normalised, so a stored `+233...` and a typed `0...` do not read
// as an edit on the settings screen.
checkTrue('the same number written two ways compares equal',
  samePhone('+233 24 456 7801', '0244567801'));
checkTrue('...and with formatting', samePhone('024-456-7801', '0244567801'));
checkTrue('...but two different numbers do not', !samePhone('0244567801', '0244567802'));

// ---------------------------------------------------------------------------
section('email addresses');

// Deliberately loose — it catches the blank field and the obvious typo, and
// leaves the question of whether an address exists to the confirmation link.
checkTrue('an ordinary address', isEmailShaped('ama@example.com'));
checkTrue('a subdomain', isEmailShaped('ama@mail.knust.edu.gh'));
checkTrue('surrounding space is trimmed', isEmailShaped('  ama@example.com  '));
checkTrue('a blank field is not an address', !isEmailShaped(''));
checkTrue('nor is one with no @', !isEmailShaped('ama.example.com'));
checkTrue('nor one with no domain dot', !isEmailShaped('ama@example'));
checkTrue('nor one with a space in it', !isEmailShaped('ama mensah@example.com'));
checkTrue('nor undefined', !isEmailShaped(undefined));
checkTrue('nor null', !isEmailShaped(null));

// The server's `mailBookingConfirmation` tests this pattern directly, so it has
// to stay a RegExp rather than becoming a function.
checkTrue('the raw pattern is still exported for the server',
  EMAIL_SHAPE instanceof RegExp && EMAIL_SHAPE.test('ama@example.com'));

report();

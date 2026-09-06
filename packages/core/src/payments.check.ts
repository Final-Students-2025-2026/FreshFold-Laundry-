/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks for the one field that decides where a payment's money lands.
 *
 * Run with `npm run check --workspace @freshfold/core`.
 *
 * These exist because of a specific defect rather than for coverage. A checkout
 * used to carry client-composed metadata, and two settlement routes each read a
 * different key out of it — so one intent declaring itself both a wallet top-up
 * and a booking payment satisfied both, and a single ₵200 payment settled a
 * ₵200 booking *and* credited ₵200 to the wallet. See the header of
 * `./payments` for the full account.
 *
 * The assertions below are written against the property that makes that
 * impossible — that no metadata this module can build is ever readable as both
 * purposes at once — rather than against the two example values that happened
 * to exploit it.
 */

import { check, checkTrue, report, section } from './check';
import {
  PAYMENT_PURPOSES,
  buildPaymentMetadata,
  isPaymentPurpose,
  paymentBookingId,
  paymentPurpose,
} from './payments';

section('a payment declares exactly one purpose');

check(
  'a top-up is a top-up',
  paymentPurpose(buildPaymentMetadata('wallet_topup', undefined, undefined)),
  'wallet_topup'
);

check(
  'a booking payment is a booking payment',
  paymentPurpose(buildPaymentMetadata('booking', 'FFC-482013', undefined)),
  'booking'
);

check(
  'a booking payment names its booking',
  paymentBookingId(buildPaymentMetadata('booking', 'FFC-482013', undefined)),
  'FFC-482013'
);

check(
  'a top-up names no booking',
  paymentBookingId(buildPaymentMetadata('wallet_topup', undefined, undefined)),
  null
);

section('the double-claim, as it was actually performed');

/**
 * The exploit in one line: a booking id handed to the top-up branch.
 *
 * This is the shape the old code let a customer compose directly. The builder
 * is given both halves and must still refuse to produce something the booking
 * gate will accept.
 */
const smuggled = buildPaymentMetadata('wallet_topup', 'FFC-482013', undefined);

check('a booking id passed to a top-up is dropped', paymentBookingId(smuggled), null);
check('and it is still only a top-up', paymentPurpose(smuggled), 'wallet_topup');
checkTrue('the key is absent, not merely unread', !('booking_id' in smuggled));

/**
 * The same attempt made against the *reader*, in case a payment created before
 * this format existed still carries a stray top-level `booking_id`. The purpose
 * is what decides, so a top-up carrying one settles nothing.
 */
const legacy = { type: 'wallet_topup', booking_id: 'FFC-482013' };
check('a legacy top-up carrying a booking id settles no booking', paymentBookingId(legacy), null);

section('no metadata is ever readable as both purposes');

for (const purpose of PAYMENT_PURPOSES) {
  const built = buildPaymentMetadata(purpose, 'FFC-000001', {
    customer_name: 'Ama',
    phone: '0244000000',
    service: 'Premium press',
  });

  const isTopUp = paymentPurpose(built) === 'wallet_topup';
  const settlesABooking = paymentBookingId(built) !== null;

  checkTrue(`${purpose}: credits a wallet or settles a booking, never both`, !(isTopUp && settlesABooking));
}

section('display fields cannot reach the gates');

/**
 * A caller controls `display`, so it is the one part of the metadata still
 * composed client-side. It is nested, and both readers look only at the top
 * level — so `type` and `booking_id` written in here are inert.
 */
const disguised = buildPaymentMetadata('wallet_topup', undefined, {
  customer_name: 'Ama',
  // Not fields of `PaymentDisplayFields`; a caller sending them anyway is the
  // case being checked, so they are cast in rather than declared.
  ...({ type: 'booking', booking_id: 'FFC-482013' } as Record<string, string>),
});

check('a purpose hidden in display does not change the purpose', paymentPurpose(disguised), 'wallet_topup');
check('a booking id hidden in display settles nothing', paymentBookingId(disguised), null);
check('display keeps only the fields it declares', Object.keys(disguised.display).sort(), [
  'customer_name',
  'phone',
  'service',
]);
check('and the real display value survives', disguised.display.customer_name, 'Ama');

section('what a gate refuses');

check('metadata that is absent has no purpose', paymentPurpose(undefined), null);
check('metadata that is null has no purpose', paymentPurpose(null), null);
check('metadata that is a string has no purpose', paymentPurpose('wallet_topup'), null);
check('an unknown purpose is not a purpose', paymentPurpose({ type: 'refund' }), null);
check('an empty booking id does not name a booking', paymentBookingId({ type: 'booking', booking_id: '  ' }), null);

checkTrue('the purpose guard accepts every listed purpose', PAYMENT_PURPOSES.every(isPaymentPurpose));
checkTrue('and nothing else', !isPaymentPurpose('wallet_topup '));

section('display fields are bounded');

const long = buildPaymentMetadata('booking', 'FFC-000001', { customer_name: 'x'.repeat(400) });
check('a long name is trimmed to what a dashboard column holds', long.display.customer_name?.length, 120);
check('a blank name is dropped rather than sent empty', buildPaymentMetadata('booking', 'FFC-1', { customer_name: '   ' }).display.customer_name, undefined);

report();

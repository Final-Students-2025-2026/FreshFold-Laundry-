/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Route-level checks for what a checkout is allowed to declare.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * `@freshfold/core`'s own `payments.check.ts` covers the builder and the two
 * readers as pure functions. These cover the thing that sits above them: that
 * `/paystack/initialize` refuses a checkout which does not declare a purpose,
 * and that no shape of request body can put a `booking_id` into the metadata of
 * a wallet top-up.
 *
 * That combination is the defect these exist for. `metadata` used to be
 * forwarded from the request body verbatim, so a customer could open one
 * checkout declaring itself both a top-up and a payment for a booking, pay once,
 * and settle both — see the header of `@freshfold/core`'s `payments` module.
 *
 * Only calls to api.paystack.co are intercepted, so nothing leaves the machine
 * and no database is touched. What is asserted is the metadata that *would*
 * have been sent, which is the field the whole defect turned on.
 */
import express from 'express';
import {
  callbackPolicy,
  isAllowedCallback,
  paystackRouter,
  type CallbackPolicy,
} from './routes/integrations';

process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';

const realFetch = globalThis.fetch;
let sentMetadata: unknown = null;

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input);
  if (!url.includes('api.paystack.co')) return realFetch(input, init);

  sentMetadata = JSON.parse(String(init?.body)).metadata;
  return new Response(
    JSON.stringify({
      status: true,
      data: { authorization_url: 'https://x', access_code: 'a', reference: 'PSK_1' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}) as typeof fetch;

const app = express();
app.use(express.json());
app.use('/api/paystack', paystackRouter);

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

const server = app.listen(4599, async () => {
  const post = async (body: unknown) => {
    sentMetadata = null;
    const res = await realFetch('http://127.0.0.1:4599/api/paystack/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as { reason?: string },
      metadata: sentMetadata as { type?: string; booking_id?: string; display?: unknown } | null,
    };
  };

  console.log('\n--- the exploit payload, as it was actually performed ------');

  const exploit = await post({
    email: 'me@x.com',
    amount: 200,
    purpose: 'wallet_topup',
    bookingId: 'FFC-482013',
  });
  check('a top-up naming a booking still opens', exploit.status, 200);
  check('...but no booking_id reaches Paystack', exploit.metadata?.booking_id, undefined);
  check('...so it can only ever be a top-up', exploit.metadata?.type, 'wallet_topup');

  console.log('\n--- the old client contract, now refused -------------------');

  const legacy = await post({
    email: 'me@x.com',
    amount: 200,
    metadata: { type: 'wallet_topup', booking_id: 'FFC-482013' },
  });
  check('a raw metadata object is refused', legacy.status, 400);
  check('...with a reason the client can route on', legacy.body.reason, 'purpose-required');
  check('...and nothing reached Paystack', legacy.metadata, null);

  console.log('\n--- a purpose smuggled through display ---------------------');

  const disguised = await post({
    email: 'me@x.com',
    amount: 200,
    purpose: 'wallet_topup',
    display: { type: 'booking', booking_id: 'FFC-482013', customer_name: 'Ama' },
  });
  check('display cannot change the purpose', disguised.metadata?.type, 'wallet_topup');
  check('display cannot name a booking', disguised.metadata?.booking_id, undefined);
  check('...and display keeps only its own fields', disguised.metadata?.display, {
    customer_name: 'Ama',
  });

  console.log('\n--- the legitimate paths still work -----------------------');

  const booking = await post({
    email: 'me@x.com',
    amount: 200,
    purpose: 'booking',
    bookingId: 'FFC-482013',
    display: { customer_name: 'Ama', phone: '0244000000', service: 'Wash' },
  });
  check('a booking payment names its booking', booking.metadata?.booking_id, 'FFC-482013');
  check('...with the right purpose', booking.metadata?.type, 'booking');

  const topup = await post({ email: 'me@x.com', amount: 50, purpose: 'wallet_topup' });
  check('a plain top-up opens', topup.status, 200);
  check('...as a top-up', topup.metadata?.type, 'wallet_topup');

  console.log('\n--- what a malformed checkout is told ---------------------');

  const noId = await post({ email: 'me@x.com', amount: 200, purpose: 'booking' });
  check('a booking payment with no booking is refused', noId.status, 400);
  check('...with a reason', noId.body.reason, 'booking-id-required');

  const badPurpose = await post({ email: 'me@x.com', amount: 200, purpose: 'refund' });
  check('an invented purpose is refused', badPurpose.status, 400);
  check('...with a reason', badPurpose.body.reason, 'purpose-required');

  console.log('\n--- where Paystack may return a customer -------------------');

  /**
   * The open redirect, and why it could not simply be deleted.
   *
   * `callback_url` was forwarded to Paystack as it arrived, on an endpoint with
   * no session. So anyone could mint a checkout on the real gateway that landed
   * the customer on their own page the moment the payment settled — the
   * highest-trust moment in the flow. Both Expo apps and the website
   * legitimately pass one, so the fix is an allow-list rather than a removal.
   */
  const policy: CallbackPolicy = {
    origins: ['https://freshfold.example'],
    schemes: ['freshfoldclient'],
    anyOrigin: false,
  };

  const allows = (url: string) => isAllowedCallback(url, policy);

  check('the site we serve is allowed', allows('https://freshfold.example/#paystack-success'), true);
  check('a path under it is allowed', allows('https://freshfold.example/pay/done'), true);
  check('the customer app scheme is allowed', allows('freshfoldclient://paystack-success?flow=book'), true);
  check('case in the origin does not matter', allows('https://FreshFold.Example/#done'), true);

  check('another site is refused', allows('https://freshfold-billing.example/pay'), false);
  check('a lookalike subdomain is refused', allows('https://freshfold.example.evil.test/pay'), false);
  check('another port on our own host is refused', allows('https://freshfold.example:8443/x'), false);
  check('plain http to an https origin is refused', allows('http://freshfold.example/x'), false);
  check('an unknown scheme is refused', allows('freshfoldrider://x'), false);
  check('javascript: is refused', allows('javascript:alert(1)'), false);
  check('data: is refused', allows('data:text/html,<h1>pay again</h1>'), false);
  check('file: is refused', allows('file:///etc/passwd'), false);
  check('a bare path is refused', allows('/paystack-success'), false);
  check('nonsense is refused', allows('not a url'), false);
  check('an empty string is refused', allows(''), false);

  const permissive = { ...policy, anyOrigin: true };
  check(
    'development with no CORS_ORIGINS lets any origin through',
    isAllowedCallback('http://192.168.1.42:8081/x', permissive),
    true
  );
  check('...but still not javascript:', isAllowedCallback('javascript:alert(1)', permissive), false);

  console.log('\n--- the policy the environment produces --------------------');

  const before = {
    env: process.env.NODE_ENV,
    cors: process.env.CORS_ORIGINS,
    app: process.env.APP_URL,
  };
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGINS = 'https://freshfold.example, https://app.freshfold.example';
  process.env.APP_URL = 'https://freshfold.example';

  const live = callbackPolicy();
  check('production never allows an arbitrary origin', live.anyOrigin, false);
  check('every configured origin is allowed', live.origins.sort(), [
    'https://app.freshfold.example',
    'https://freshfold.example',
  ]);
  check('the customer app scheme survives into production', live.schemes, ['freshfoldclient']);
  check('Expo Go is not trusted in production', live.schemes.includes('exp'), false);

  console.log('\n--- and the route enforces it -----------------------------');

  // Still inside the production window opened above. It matters that these run
  // there: with no `CORS_ORIGINS` set outside production the policy is
  // deliberately permissive, exactly as the CORS middleware is, so asserting
  // the refusal against a development policy would assert nothing.
  const evil = await post({
    email: 'me@x.com',
    amount: 200,
    purpose: 'booking',
    bookingId: 'FFC-482013',
    callback_url: 'https://freshfold-billing.example/pay',
  });
  check('a checkout returning to another site is refused', evil.status, 400);
  check('...with a reason', evil.body.reason, 'callback-not-allowed');
  check('...and nothing reached Paystack', evil.metadata, null);

  const deepLink = await post({
    email: 'me@x.com',
    amount: 200,
    purpose: 'booking',
    bookingId: 'FFC-482013',
    callback_url: 'freshfoldclient://paystack-success?flow=book',
  });
  check('the app deep link still opens a checkout', deepLink.status, 200);

  const none = await post({ email: 'me@x.com', amount: 50, purpose: 'wallet_topup' });
  check('omitting it entirely is fine', none.status, 200);

  process.env.NODE_ENV = before.env;
  process.env.CORS_ORIGINS = before.cors;
  process.env.APP_URL = before.app;

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  server.close();
  process.exit(failures === 0 ? 0 : 1);
});

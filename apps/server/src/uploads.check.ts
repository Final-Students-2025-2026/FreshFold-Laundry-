/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The upload limits, on the routes that actually take uploads.
 *
 * Run with `npm run check --workspace @freshfold/server`.
 *
 * `@freshfold/core`'s own `uploads.check.ts` covers the validator as a pure
 * function. These cover the thing that matters more: that it is *wired* — a
 * validator nobody calls is worth nothing, and this finding existed because
 * three fields had no check at all rather than because the check was wrong.
 *
 * Every one of these runs before the route touches the database, which is both
 * why they work without one and a property worth having on its own: a body that
 * cannot be accepted should not cost a round trip to find that out.
 */

import express from 'express';
import { MAX_MESSAGE_CHARS, MAX_PHOTO_BYTES } from '@freshfold/core';
import { claimsRouter } from './routes/claims';
import { messagesRouter } from './routes/messaging';
import { ordersRouter } from './routes/orders';

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

/** A `data:` URI of roughly `bytes` decoded, with a valid JPEG magic number. */
function jpeg(bytes: number): string {
  const payload = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(Math.max(0, bytes - 3)),
  ]);
  return `data:image/jpeg;base64,${payload.toString('base64')}`;
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  app.use('/api/orders', ordersRouter);
  app.use('/api/claims', claimsRouter);
  app.use('/api/messages', messagesRouter);

  const server = app.listen(4614);
  await new Promise((resolve) => server.once('listening', resolve));

  const post = async (path: string, body: unknown, method = 'POST') => {
    const res = await fetch(`http://127.0.0.1:4614${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { error?: string; reason?: string } };
  };

  section('the hand-off proof, on PATCH /orders/:id/status');

  const bigPhoto = await post(
    '/api/orders/FFC-000001/status',
    { status: 'delivered', photo: jpeg(MAX_PHOTO_BYTES + 100_000) },
    'PATCH'
  );
  check('an oversized photograph is refused', bigPhoto.status, 413);
  check('...and says which field', bigPhoto.body.reason, 'photo-rejected');

  const bigSignature = await post(
    '/api/orders/FFC-000001/status',
    { status: 'delivered', signature: jpeg(600_000) },
    'PATCH'
  );
  check('a signature over its tighter limit is refused', bigSignature.status, 413);
  check('...and says which field', bigSignature.body.reason, 'signature-rejected');

  const notAnImage = await post(
    '/api/orders/FFC-000001/status',
    { status: 'delivered', photo: 'data:image/jpeg;base64,AAAAAAAAAAAAAAAA' },
    'PATCH'
  );
  check('bytes that are not an image are refused', notAnImage.status, 413);

  /**
   * The refusals above must not be reachable only for unauthenticated callers —
   * but they must also not require authentication, because the point is that
   * they land before the lookup. A well-formed small photo gets past the size
   * check and is then refused for the ordinary reason: no such order.
   */
  const goodPhoto = await post(
    '/api/orders/FFC-000001/status',
    { status: 'delivered', photo: jpeg(20_000) },
    'PATCH'
  );
  checkTrue('a valid photograph gets past the size check', goodPhoto.status !== 413);

  section('the claim photograph, on POST /claims/job/:id');

  const bigClaim = await post('/api/claims/job/FFC-000001', {
    kind: 'damage',
    description: 'A long enough description to pass the other check.',
    photo: jpeg(MAX_PHOTO_BYTES + 100_000),
  });
  check('an oversized claim photograph is refused', bigClaim.status, 413);
  check('...and says which field', bigClaim.body.reason, 'photo-rejected');

  const svgClaim = await post('/api/claims/job/FFC-000001', {
    kind: 'damage',
    description: 'A long enough description to pass the other check.',
    photo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  });
  check('an SVG is refused', svgClaim.status, 413);

  section('message text, on POST /messages');

  const longMessage = await post('/api/messages', {
    orderId: 'FFC-000001',
    text: 'x'.repeat(MAX_MESSAGE_CHARS + 1),
  });
  check('a message over the limit is refused', longMessage.status, 413);
  checkTrue('...and says what the limit is', (longMessage.body.error ?? '').includes(String(MAX_MESSAGE_CHARS)));

  const emptyMessage = await post('/api/messages', { orderId: 'FFC-000001', text: '' });
  check('an empty message is still a 400, not a 413', emptyMessage.status, 400);

  const okMessage = await post('/api/messages', {
    orderId: 'FFC-000001',
    text: 'Left it with the porter.',
  });
  checkTrue('an ordinary message gets past the length check', okMessage.status !== 413);

  section('and the outer bound behind all of them');

  /**
   * The body limit is the backstop, enforced by body-parser before any handler
   * runs. It was 12 MB, chosen when nothing bounded the blobs; now that they
   * are bounded the largest legitimate request is about 3.4 MB, so it is 6.
   */
  const enormous = await fetch('http://127.0.0.1:4614/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 'FFC-000001', text: 'x'.repeat(8 * 1024 * 1024) }),
  });
  check('a body past the limit never reaches a route', enormous.status, 413);

  server.close();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

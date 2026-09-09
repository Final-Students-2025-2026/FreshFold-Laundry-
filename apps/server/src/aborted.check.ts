/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the server does when the caller stops listening.
 *
 * Worth assertions because every part of it is invisible from outside. Nothing
 * about a request that was abandoned looks different in a response — there is
 * no response — so getting this wrong produces no symptom at all until a free
 * instance is spending its afternoon serialising boards for browsers that hung
 * up eight seconds ago.
 *
 * The `close` event fires on *every* response, successful or not, which is the
 * trap here: a check that only listened for it would mark every completed
 * request as abandoned and skip half the answers on this server.
 * `writableFinished` is what separates the two, and the first two assertions
 * below are the ones that would catch getting that backwards.
 */

import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { callerGone, guard } from './helpers';

let failures = 0;

function checkTrue(label: string, actual: boolean): void {
  if (!actual) failures += 1;
  console.log(`${actual ? 'PASS' : 'FAIL'}  ${label}${actual ? '' : '\n        got  false'}`);
}

function section(title: string): void {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 55 - title.length))}`);
}

/**
 * Enough of a response for `guard`: an emitter carrying the three flags it
 * reads, plus a count of how many times it was answered.
 *
 * Its own type rather than an intersection with Express's `Response`, which
 * cannot be satisfied honestly — `status()` on the real type returns the real
 * type, and a stub that returned the stub would not typecheck against it. The
 * cast happens at the two places the fake meets the real signatures instead,
 * where it is visible.
 */
interface FakeRes extends EventEmitter {
  locals: Record<string, unknown>;
  writableFinished: boolean;
  destroyed: boolean;
  headersSent: boolean;
  statusCalls: number;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
}

function fakeRes(): FakeRes {
  const res = new EventEmitter() as FakeRes;

  res.locals = {};
  res.writableFinished = false;
  res.destroyed = false;
  res.headersSent = false;
  res.statusCalls = 0;
  res.status = (_code: number) => {
    res.statusCalls += 1;
    return res;
  };
  res.json = (_body: unknown) => res;

  return res;
}

/** The one place the fake is handed to code expecting the real thing. */
const asRes = (res: FakeRes): Response => res as unknown as Response;

const fakeReq = (): Request => ({ method: 'GET', originalUrl: '/api/bookings' }) as Request;

const noop = (() => {}) as never;

/** Lets the `.catch` inside `guard` run before anything is asserted. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function main(): Promise<void> {
  section('telling a finished response from an abandoned one');

  {
    const res = fakeRes();
    guard(async () => undefined)(fakeReq(), asRes(res), noop);

    // The ordinary case: the answer was written, then the connection closed.
    res.writableFinished = true;
    res.emit('close');

    checkTrue('a response that finished is not a caller who left', !callerGone(asRes(res)));
  }

  {
    const res = fakeRes();
    guard(async () => undefined)(fakeReq(), asRes(res), noop);

    // The case this exists for: closed with nothing written.
    res.writableFinished = false;
    res.emit('close');

    checkTrue('a response that never finished is', callerGone(asRes(res)));
  }

  section('what a handler sees while it is still working');

  {
    const res = fakeRes();
    guard(async () => undefined)(fakeReq(), asRes(res), noop);

    checkTrue('nobody has left before anything happens', !callerGone(asRes(res)));

    res.emit('close');
    checkTrue('...and the flag survives for the handler to read afterwards', callerGone(asRes(res)));
  }

  {
    // A socket torn down without the event reaching us still counts. This is the
    // fallback half of `callerGone`, and the reason it does not read `locals`
    // alone.
    const res = fakeRes();
    res.destroyed = true;
    checkTrue('a destroyed response counts as gone', callerGone(asRes(res)));
  }

  section('a failure with nobody to tell');

  {
    const res = fakeRes();
    guard(async () => {
      throw new Error('boom');
    })(fakeReq(), asRes(res), noop);

    await settle();
    checkTrue('a live caller still gets its 500', res.statusCalls === 1);
  }

  {
    const res = fakeRes();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    guard(async () => {
      await held;
      throw new Error('boom');
    })(fakeReq(), asRes(res), noop);

    // The caller leaves, and only then does the work fail.
    res.emit('close');
    release?.();
    await settle();

    checkTrue('a caller who left is not written to', res.statusCalls === 0);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import { emailProvider, parseAddress, sendMail, verificationMail } from './email';

/**
 * One-off check that the mail credentials actually deliver.
 *
 * Goes through the same `sendMail` the register route uses, so a success here
 * means the real flow works — but it writes nothing and creates no account, so
 * running it leaves no trace in the database.
 *
 *   npx tsx apps/server/src/send-test-email.ts you@example.com
 *
 * Run it against an address that is *not* the one that owns the provider
 * account. That is the case Resend's shared sender fails and Brevo's verified
 * single sender passes, and it is the only thing this script is really for.
 *
 * On Brevo it then waits for the delivery event, because acceptance is not
 * delivery: the API answers 201 and *then* rejects a sender it does not
 * recognise, so the obvious reading of a success here — "it sent" — was wrong in
 * exactly the case this script exists to catch. Asking the event log is the only
 * way to tell the two apart from outside a mailbox.
 */

dotenv.config({ path: 'apps/server/.env' });

const to = process.argv[2];

if (!to) {
  console.error('Usage: tsx apps/server/src/send-test-email.ts <recipient>');
  process.exit(1);
}

const provider = emailProvider();
const from = process.env.EMAIL_FROM;

console.log(`[test] provider = ${provider ?? 'none — this will only log, not send'}`);
console.log(`[test] EMAIL_FROM = ${from ?? '(unset)'}`);
if (provider === 'brevo' && from) {
  // The parsed form is what Brevo actually receives, and a sender it does not
  // recognise is the likeliest rejection — so print it rather than the raw string.
  console.log(`[test] brevo sender = ${JSON.stringify(parseAddress(from))}`);
}
console.log(`[test] sending to ${to}…`);

const link = `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/auth/verify?token=test-link-not-real`;

/** Brevo's event log trails the send by up to a minute or so. */
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 120_000;

/** The events that end the wait, and whether each one counts as success. */
const TERMINAL: Record<string, boolean> = {
  delivered: true,
  error: false,
  blocked: false,
  hardBounces: false,
  softBounces: false,
  invalid: false,
  spam: false,
};

interface BrevoEvent {
  event: string;
  date: string;
  email: string;
  reason?: string;
}

/**
 * Waits for Brevo to say what became of the message.
 *
 * Filtered by recipient rather than message id because `sendMail` returns a
 * boolean — teaching it to hand back an id would change the signature every
 * route depends on, to serve one diagnostic script. Anything logged before we
 * pressed send is ignored, so an earlier run's failure cannot be mistaken for
 * this one's.
 */
async function awaitBrevoOutcome(recipient: string, sentAt: number): Promise<boolean | null> {
  const key = process.env.BREVO_API_KEY;
  if (!key) return null;

  const url =
    'https://api.brevo.com/v3/smtp/statistics/events' +
    `?limit=50&email=${encodeURIComponent(recipient)}`;

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    let events: BrevoEvent[];
    try {
      const response = await fetch(url, { headers: { 'api-key': key, accept: 'application/json' } });
      if (!response.ok) {
        console.log(`[test] event log unavailable (${response.status}); giving up on confirmation`);
        return null;
      }
      ({ events = [] } = (await response.json()) as { events?: BrevoEvent[] });
    } catch (error) {
      console.log('[test] event log unreachable; giving up on confirmation:', error);
      return null;
    }

    // A second of slack: the event's timestamp is Brevo's clock, not ours.
    const fresh = events.filter((event) => Date.parse(event.date) >= sentAt - 1_000);

    for (const event of fresh) {
      if (event.event in TERMINAL) {
        const verdict = TERMINAL[event.event];
        console.log(`[test] event: ${event.event}${event.reason ? ` — ${event.reason}` : ''}`);
        return verdict;
      }
    }

    process.stdout.write('.');
  }

  console.log(`\n[test] no delivery event within ${POLL_TIMEOUT_MS / 1000}s — check the Brevo log`);
  return null;
}

async function main(): Promise<void> {
  const sentAt = Date.now();
  const accepted = await sendMail(verificationMail(to, 'Test Recipient', link));

  if (!accepted) {
    console.log('[test] RESULT: NOT sent — see error above');
    process.exit(1);
  }

  if (provider !== 'brevo') {
    console.log(`[test] RESULT: accepted by ${provider ?? 'nobody — logged only'}`);
    process.exit(0);
  }

  console.log('[test] accepted by brevo — waiting for the delivery event…');
  const delivered = await awaitBrevoOutcome(to, sentAt);

  if (delivered === null) {
    // Accepted, outcome unknown. Not a pass: the one failure this script is for
    // looks exactly like this until the event arrives.
    console.log('[test] RESULT: accepted, but delivery UNCONFIRMED');
    process.exit(2);
  }

  console.log(
    delivered
      ? '[test] RESULT: DELIVERED'
      : '[test] RESULT: REJECTED after acceptance — see the event reason above'
  );
  process.exit(delivered ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('[test] threw:', error);
  process.exit(1);
});

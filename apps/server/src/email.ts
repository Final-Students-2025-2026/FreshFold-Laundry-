/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Outbound email, via Brevo or Resend.
 *
 * Both are written against their REST endpoint with bare `fetch` rather than a
 * vendor package. There is one call to make and it is four lines; a dependency
 * would buy retry logic this does not want — a verification email that fails is
 * resent by the customer pressing a button, not by the server queueing work it
 * cannot see the outcome of.
 *
 * Brevo wins when both keys are set, because of the thing that actually blocks
 * this project: Resend's shared sender delivers only to the address that owns
 * the Resend account, so every customer address bounces until a domain is
 * verified — and verifying one needs a domain, which we do not have yet. Brevo
 * verifies a *single sender address* by clicking a link in that mailbox, and
 * then sends to anybody. That is the whole reason for the second transport;
 * Resend stays because the domain route is still the better end state.
 *
 * With neither key set, the link is written to the server log instead of sent.
 * That is the difference between a fresh clone being able to register an
 * account and not, and it keeps the whole flow exercisable offline — which
 * matters here, where the dev machine is often on a hotspot with unreliable
 * DNS.
 */

import { describeItems, type BookingItem } from '@freshfold/core';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** How long to wait on the provider before giving up. */
const SEND_TIMEOUT_MS = 10_000;

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Where a reply should go, when that is not the sender.
   *
   * There is exactly one case: the contact form's copy to the desk. It is sent
   * *from* the verified sender — it has to be, that being the only address
   * either provider will accept — but the person who wrote it is a stranger
   * whose address is in the body. Without this header, hitting reply answers
   * the laundry's own mailbox, and the desk has to retype an address off the
   * screen to answer somebody.
   *
   * Never set from an unvalidated string. `routes/contact.ts` puts an address
   * here only after `isEmailShaped` has passed it, which rules out the
   * whitespace and newlines that would otherwise be worth worrying about in a
   * header.
   */
  replyTo?: { name?: string; email: string };
}

/** Which transport `sendMail` will use, given the environment as it stands. */
export function emailProvider(): 'brevo' | 'resend' | null {
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

export function emailConfigured(): boolean {
  return emailProvider() !== null;
}

/**
 * The mailbox the contact form's enquiries are sent to.
 *
 * `CONTACT_EMAIL` when it is set, and the sender's own address otherwise. That
 * fallback is not a guess: `EMAIL_FROM` has to be a mailbox somebody verified
 * by clicking a link in it, so it is the one address on the deployment that is
 * known to exist and known to be read. A deployment that has configured email
 * at all therefore has a working contact form without a second variable.
 *
 * Returns null only when neither is set, which is a server with no outbound
 * mail configured — there, `sendMail` writes the enquiry to the log instead.
 */
export function contactAddress(): string | null {
  const explicit = process.env.CONTACT_EMAIL?.trim();
  if (explicit) return parseAddress(explicit).email;

  const from = process.env.EMAIL_FROM?.trim();
  return from ? parseAddress(from).email : null;
}

/**
 * Sends a message, or logs it when no key is configured.
 *
 * Resolves either way. A caller's job — registering an account — has already
 * succeeded by the time this runs, and failing it because a third party is
 * having a bad morning would be the wrong trade: the account exists, and the
 * customer can ask for another link. The failure is logged, not swallowed
 * silently, and the boolean lets the route tell the client whether to say "sent"
 * or "we could not send it".
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const provider = emailProvider();

  if (!provider) {
    console.log(
      `[email] no BREVO_API_KEY or RESEND_API_KEY — not sending. To: ${mail.to}\n` +
        `[email] ${mail.subject}\n` +
        mail.text
          .split('\n')
          .map((line) => `[email] ${line}`)
          .join('\n')
    );
    return true;
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.error(`[email] ${provider} key is set but EMAIL_FROM is not; nothing sent.`);
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response =
      provider === 'brevo'
        ? await postBrevo(mail, from, controller.signal)
        : await postResend(mail, from, controller.signal);

    if (!response.ok) {
      // The useful part is in the body — an unverified sender and a malformed
      // address are both 4xx, and the message is the only thing that tells them
      // apart.
      console.error(`[email] ${provider} refused (${response.status}): ${await response.text()}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[email] send failed:', error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Brevo's transactional endpoint.
 *
 * It wants the sender split into name and address, so `EMAIL_FROM` — which is
 * written in the one format both providers' dashboards show you,
 * `FreshFold <hello@example.com>` — gets taken apart here rather than being a
 * second variable that can disagree with the first.
 */
function postBrevo(mail: Mail, from: string, signal: AbortSignal): Promise<Response> {
  const sender = parseAddress(from);

  return fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY as string,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: mail.to }],
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
    signal,
  });
}

function postResend(mail: Mail, from: string, signal: AbortSignal): Promise<Response> {
  return fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY as string}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [mail.to],
      ...(mail.replyTo
        ? {
            reply_to: mail.replyTo.name
              ? `${mail.replyTo.name} <${mail.replyTo.email}>`
              : mail.replyTo.email,
          }
        : {}),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
    signal,
  });
}

/**
 * Strips one layer of matching surrounding quotes.
 *
 * `.env` and a hosting dashboard disagree about what a quoted value means, and
 * the disagreement is silent. `EMAIL_FROM="FreshFold <hello@example.com>"` is
 * written that way because the address contains spaces, and dotenv takes the
 * quotes off on the way in — so locally `process.env.EMAIL_FROM` never has
 * them. Paste that same line's right-hand side into Render's environment
 * editor, which stores the field verbatim, and the quotes become part of the
 * value.
 *
 * That is not hypothetical: it is what shipped, and it broke every send in
 * production while every send on a laptop kept working.
 */
function unwrapQuotes(value: string): string {
  const trimmed = value.trim();
  const match = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return match ? match[2].trim() : trimmed;
}

/**
 * Splits `Name <addr@host>` into its parts, tolerating a bare address.
 *
 * Brevo rejects a `sender.email` with angle brackets in it, so getting this
 * wrong is a 400 on every send rather than something that degrades quietly.
 *
 * The whole value is unwrapped before the split, and the name again after it,
 * so `"FreshFold <hello@example.com>"` and `"FreshFold" <hello@example.com>`
 * both land on the same sender. Only the outer layer comes off: a name that is
 * quoted inside an otherwise unquoted value is still the caller's to keep.
 */
export function parseAddress(value: string): { name?: string; email: string } {
  const unwrapped = unwrapQuotes(value);

  const match = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(unwrapped);
  if (!match) return { email: unwrapped };

  const name = unwrapQuotes(match[1]);
  return name ? { name, email: match[2] } : { email: match[2] };
}

/**
 * The confirmation message.
 *
 * Plain text alongside the HTML because a mail client that refuses to render
 * the second still has to show the customer a link they can use, and because a
 * text part measurably keeps mail out of spam folders.
 */
export function verificationMail(to: string, name: string, link: string): Mail {
  const greeting = name.trim() ? `Hello ${name.trim()},` : 'Hello,';

  return {
    to,
    subject: 'Confirm your email — FreshFold',
    text: [
      greeting,
      '',
      'Confirm your email address to start booking pickups with FreshFold:',
      '',
      link,
      '',
      'The link is good for 24 hours. If you did not create a FreshFold account,',
      'you can ignore this message — nothing was set up.',
      '',
      'FreshFold Luxury Co.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2f3437">
        <p style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#7d8b7f;margin:0 0 6px">
          White-glove service
        </p>
        <h1 style="font-size:22px;font-weight:800;margin:0 0 18px">Confirm your email</h1>
        <p style="font-size:14px;line-height:22px;margin:0 0 12px">${escapeHtml(greeting)}</p>
        <p style="font-size:14px;line-height:22px;margin:0 0 24px">
          Confirm your email address to start booking pickups with FreshFold.
        </p>
        <p style="margin:0 0 28px">
          <a href="${escapeHtml(link)}"
             style="display:inline-block;background:#7d8b7f;color:#fff;text-decoration:none;padding:13px 26px;border-radius:12px;font-size:14px;font-weight:700">
            Confirm my email
          </a>
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;margin:0 0 6px">
          Or paste this into your browser:
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;word-break:break-all;margin:0 0 24px">
          ${escapeHtml(link)}
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;margin:0">
          The link is good for 24 hours. If you did not create a FreshFold account, you can
          ignore this message — nothing was set up.
        </p>
      </div>
    `.trim(),
  };
}

/**
 * The password-reset message.
 *
 * Says what to do if the customer did not ask for it, and names the hour-long
 * expiry: a reset mail nobody requested is the one signal a customer gets that
 * somebody is trying their address, and it should read as reassuring rather
 * than alarming — nothing has changed yet, and the link dies on its own.
 */
export function passwordResetMail(to: string, name: string, link: string): Mail {
  const greeting = name.trim() ? `Hello ${name.trim()},` : 'Hello,';

  return {
    to,
    subject: 'Reset your password — FreshFold',
    text: [
      greeting,
      '',
      'Somebody asked to reset the password on your FreshFold account.',
      'Choose a new one here:',
      '',
      link,
      '',
      'The link is good for one hour and can only be used once. If this was not',
      'you, ignore this message — your password has not changed, and nobody can',
      'sign in without it.',
      '',
      'FreshFold Luxury Co.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2f3437">
        <p style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#7d8b7f;margin:0 0 6px">
          White-glove service
        </p>
        <h1 style="font-size:22px;font-weight:800;margin:0 0 18px">Reset your password</h1>
        <p style="font-size:14px;line-height:22px;margin:0 0 12px">${escapeHtml(greeting)}</p>
        <p style="font-size:14px;line-height:22px;margin:0 0 24px">
          Somebody asked to reset the password on your FreshFold account. Choose a new one below.
        </p>
        <p style="margin:0 0 28px">
          <a href="${escapeHtml(link)}"
             style="display:inline-block;background:#7d8b7f;color:#fff;text-decoration:none;padding:13px 26px;border-radius:12px;font-size:14px;font-weight:700">
            Choose a new password
          </a>
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;margin:0 0 6px">
          Or paste this into your browser:
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;word-break:break-all;margin:0 0 24px">
          ${escapeHtml(link)}
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;margin:0">
          The link is good for one hour and can only be used once. If this was not you, ignore this
          message — your password has not changed, and nobody can sign in without it.
        </p>
      </div>
    `.trim(),
  };
}

/** What the booking confirmation needs to say back to the customer. */
export interface BookingMailDetails {
  id: string;
  name: string;
  serviceType: string;
  /**
   * Every service on the order, so `describeItems` below can name them all.
   *
   * The comment beside that call already claimed it did. It could not: this
   * interface carried `serviceType` alone, so a booking for a wash *and* an
   * ironing was confirmed as just the first of the two.
   */
  items?: BookingItem[];
  quantity?: number;
  pickupDate: string;
  pickupTime: string;
  /** The return window, when the customer chose one. See `JobSchedule`. */
  deliveryDate?: string;
  deliveryTime?: string;
  address: string;
}

/**
 * The two schedule lines, written the same way wherever they appear.
 *
 * Shared between the confirmation and the reschedule notice so the customer
 * comparing the two mails is comparing the same sentence. The return line is
 * omitted rather than left blank when there is no date, which is true of
 * records written before the return window existed.
 */
function scheduleLines(booking: BookingMailDetails): [string, string][] {
  const lines: [string, string][] = [['Pickup', `${booking.pickupDate}, ${booking.pickupTime}`]];

  if (booking.deliveryDate) {
    lines.push([
      'Return',
      booking.deliveryTime
        ? `${booking.deliveryDate}, ${booking.deliveryTime}`
        : booking.deliveryDate,
    ]);
  }

  return lines;
}

/**
 * The booking confirmation, carrying the link that turns an order into a login.
 *
 * This is how an access password is created. A stranger fills in the website's
 * form — no account, no password — and the only channel we can be sure reaches
 * them afterwards is the address they just typed. The link goes there rather
 * than to a WhatsApp thread the desk would have to open by hand, which is the
 * difference between a customer who can track their own pickup and one who has
 * to ask.
 *
 * `hasPassword` swaps the call to action. A returning customer already has
 * credentials, and sending them to a "choose your password" screen they cannot
 * use — the setup form answers 409 for an account that has one — would be worse
 * than sending nothing.
 */
export function bookingSetupMail(
  to: string,
  booking: BookingMailDetails,
  link: string,
  hasPassword: boolean
): Mail {
  const greeting = booking.name.trim() ? `Hello ${booking.name.trim()},` : 'Hello,';
  const action = hasPassword ? 'Track this pickup' : 'Set up your portal password';

  const lines: [string, string][] = [
    ['Booking', booking.id],
    // Every service on the order. `describeItems` falls back to the single
    // service name, so a one-service booking reads exactly as it always did.
    ['Service', describeItems(booking) || booking.serviceType],
    ...scheduleLines(booking),
    ['Address', booking.address],
  ];

  return {
    to,
    subject: `Pickup ${booking.id} confirmed — FreshFold`,
    text: [
      greeting,
      '',
      'Your pickup is booked. Here is what we have:',
      '',
      ...lines.map(([label, value]) => `${label}: ${value}`),
      '',
      hasPassword
        ? 'Sign in to the patron portal to follow your courier live:'
        : 'Choose the password for your patron portal here — it is the login you will use to follow your courier live:',
      '',
      link,
      '',
      ...(hasPassword
        ? []
        : ['Anyone holding this link can set that password, so please keep it to yourself.', '']),
      'FreshFold Luxury Co.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2f3437">
        <p style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#7d8b7f;margin:0 0 6px">
          White-glove service
        </p>
        <h1 style="font-size:22px;font-weight:800;margin:0 0 18px">Your pickup is booked</h1>
        <p style="font-size:14px;line-height:22px;margin:0 0 20px">${escapeHtml(greeting)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:20px;margin:0 0 24px">
          ${lines
            .map(
              ([label, value]) => `
          <tr>
            <td style="padding:7px 0;color:#6b7280;border-bottom:1px solid #eeeae4">${escapeHtml(label)}</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;border-bottom:1px solid #eeeae4">${escapeHtml(value)}</td>
          </tr>`
            )
            .join('')}
        </table>
        <p style="font-size:14px;line-height:22px;margin:0 0 24px">
          ${
            hasPassword
              ? 'Sign in to the patron portal to follow your courier live.'
              : 'Choose the password for your patron portal below — it is the login you will use to follow your courier live.'
          }
        </p>
        <p style="margin:0 0 28px">
          <a href="${escapeHtml(link)}"
             style="display:inline-block;background:#7d8b7f;color:#fff;text-decoration:none;padding:13px 26px;border-radius:12px;font-size:14px;font-weight:700">
            ${escapeHtml(action)}
          </a>
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;margin:0 0 6px">
          Or paste this into your browser:
        </p>
        <p style="font-size:12px;line-height:19px;color:#6b7280;word-break:break-all;margin:0 0 24px">
          ${escapeHtml(link)}
        </p>
        ${
          hasPassword
            ? ''
            : `<p style="font-size:12px;line-height:19px;color:#6b7280;margin:0">
          Anyone holding this link can set that password, so please keep it to yourself.
        </p>`
        }
      </div>
    `.trim(),
  };
}

/**
 * Confirms that a booking has moved, and says where from.
 *
 * The old window is on it deliberately. A mail that says only "your pickup is
 * on Thursday" is indistinguishable from the original confirmation arriving
 * twice, which is exactly the case a customer needs to be able to tell apart —
 * if they did not make this change, this mail is the only thing that will tell
 * them. Same reason the remaining allowance is stated: a customer with one move
 * left should learn it here rather than when the form refuses them.
 */
export function bookingRescheduledMail(
  to: string,
  booking: BookingMailDetails,
  previous: { pickupDate: string; pickupTime: string },
  movesLeft: number
): Mail {
  const greeting = booking.name.trim() ? `Hello ${booking.name.trim()},` : 'Hello,';
  const was = `${previous.pickupDate}, ${previous.pickupTime}`;

  const lines: [string, string][] = [
    ['Booking', booking.id],
    ['Was', was],
    ...scheduleLines(booking),
    ['Address', booking.address],
  ];

  const allowance =
    movesLeft > 0
      ? `You can move this booking ${movesLeft} more ${movesLeft === 1 ? 'time' : 'times'}.`
      : 'This booking has now been moved as many times as it can be — if the date has to change again, cancel it and place a new one.';

  return {
    to,
    subject: `Pickup ${booking.id} moved to ${booking.pickupDate} — FreshFold`,
    text: [
      greeting,
      '',
      'Your collection has been moved. Here is what we now have:',
      '',
      ...lines.map(([label, value]) => `${label}: ${value}`),
      '',
      allowance,
      '',
      'If this was not you, reply to this mail and we will put it back.',
      '',
      'FreshFold Luxury Co.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2f3437">
        <p style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#7d8b7f;margin:0 0 6px">
          White-glove service
        </p>
        <h1 style="font-size:22px;font-weight:800;margin:0 0 18px">Your collection has moved</h1>
        <p style="font-size:14px;line-height:22px;margin:0 0 20px">${escapeHtml(greeting)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:20px;margin:0 0 24px">
          ${lines
            .map(
              ([label, value]) => `
          <tr>
            <td style="padding:7px 0;color:#6b7280;border-bottom:1px solid #eeeae4">${escapeHtml(label)}</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;border-bottom:1px solid #eeeae4">${escapeHtml(value)}</td>
          </tr>`
            )
            .join('')}
        </table>
        <p style="font-size:13px;line-height:21px;color:#6b7280;margin:0 0 8px">${escapeHtml(allowance)}</p>
        <p style="font-size:13px;line-height:21px;color:#6b7280;margin:0">
          If this was not you, reply to this mail and we will put it back.
        </p>
      </div>
    `.trim(),
  };
}

/**
 * The desk's copy of a contact-form enquiry.
 *
 * Addressed to the laundry rather than to a customer, which makes it the one
 * message in this file written for whoever is at the desk: no branding above
 * the fold, no call to action, and the sender's own words first because that is
 * what somebody is opening it to read.
 *
 * `replyTo` is the whole point of it. The message is sent from the verified
 * sender — the only address either provider accepts — so without that header
 * every reply would go to the laundry's own mailbox. With it, answering an
 * enquiry is pressing reply.
 *
 * The subject carries the sender's name so a morning's worth of these can be
 * told apart in a list, and `id` goes in the footer so a row on this table and
 * a message in the inbox can be matched up.
 */
export function enquiryMail(
  to: string,
  enquiry: { id: string; name: string; email: string; message: string; createdAt: string }
): Mail {
  const name = enquiry.name.trim();
  const from = enquiry.email.trim();
  // Only when it is really an address. `routes/contact.ts` has already refused
  // anything else, and a Reply-To pointing at a typo is worse than none.
  const replyTo = from ? { name, email: from } : undefined;

  const received = new Date(enquiry.createdAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'GMT',
  });

  return {
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: `Website enquiry from ${name}`,
    text: [
      enquiry.message,
      '',
      '—',
      `From: ${name}${from ? ` <${from}>` : ' (no email address given)'}`,
      `Received: ${received} GMT`,
      `Reference: ${enquiry.id}`,
      '',
      from
        ? 'Reply to this message and it goes to them.'
        : 'They left no address, so this cannot be replied to.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2f3437">
        <p style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#7d8b7f;margin:0 0 6px">
          Website enquiry
        </p>
        <h1 style="font-size:22px;font-weight:800;margin:0 0 18px">${escapeHtml(name)}</h1>
        <p style="font-size:15px;line-height:24px;white-space:pre-wrap;margin:0 0 28px">${escapeHtml(
          enquiry.message
        )}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:20px;margin:0 0 20px">
          <tr>
            <td style="padding:7px 0;color:#6b7280;border-bottom:1px solid #eeeae4">From</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;border-bottom:1px solid #eeeae4">${
              from
                ? `<a href="mailto:${escapeHtml(from)}" style="color:#2f3437">${escapeHtml(from)}</a>`
                : 'No address given'
            }</td>
          </tr>
          <tr>
            <td style="padding:7px 0;color:#6b7280;border-bottom:1px solid #eeeae4">Received</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;border-bottom:1px solid #eeeae4">${escapeHtml(
              received
            )} GMT</td>
          </tr>
          <tr>
            <td style="padding:7px 0;color:#6b7280;border-bottom:1px solid #eeeae4">Reference</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;border-bottom:1px solid #eeeae4">${escapeHtml(
              enquiry.id
            )}</td>
          </tr>
        </table>
        <p style="font-size:12px;line-height:19px;color:#6b7280;margin:0">
          ${
            from
              ? 'Reply to this message and it goes to them.'
              : 'They left no address, so this cannot be replied to.'
          }
        </p>
      </div>
    `.trim(),
  };
}

/**
 * Escapes text going into the HTML part.
 *
 * The name comes from whatever the customer typed at registration, so it is
 * untrusted by definition — and it is about to be interpolated into markup that
 * lands in a mail client.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

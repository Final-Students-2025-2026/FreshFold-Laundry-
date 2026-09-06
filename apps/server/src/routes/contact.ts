/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { isEmailShaped } from '@freshfold/core';
import { requireSupervisor } from '../auth';
import { contactAddress, enquiryMail, sendMail } from '../email';
import { guard } from '../helpers';
import { rateLimit } from '../rateLimit';
import { store } from '../store';

/**
 * The website's contact form.
 *
 * `Contact.tsx` used to answer "Send it" by assigning a `mailto:` URL to
 * `window.location.href`. That hands the enquiry to the visitor's own mail
 * client, which is fine on a phone with Gmail installed and silent on a desktop
 * browser with no mail handler registered: the assignment is a no-op — no
 * dialog, no navigation, nothing in the console — and the form went on to say
 * "Your mail app is open with the message ready to send" and cleared the
 * fields. There is no way to feature-detect the difference, so the confident
 * message was shown to everybody and the enquiry reached the laundry only
 * sometimes.
 *
 * Two things happen here instead, in this order: the enquiry is written to
 * `enquiries`, and then the desk is emailed. The order is deliberate. The row
 * is the record and the email is the notification, so a provider outage costs
 * the notification — `delivered` on the row says which ones that happened to,
 * and the response says so too, because a form that claims delivery it cannot
 * confirm is the thing this route exists to stop.
 *
 * Open, like the booking form: a contact form behind a sign-in is not a contact
 * form. What guards it is the limiter below and the length caps.
 */
export const contactRouter = Router();

const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_MESSAGE = 2000;

/**
 * How many enquiries one address may send in an hour.
 *
 * Sized for the honest edge of real use — somebody writing, remembering a
 * detail, and writing again — rather than for the median, which is one. This is
 * the only thing standing between an open form and a mailbox full of whatever
 * somebody with a script felt like sending, and it is in-memory like every
 * other limiter here, which means per-instance and reset on deploy. See
 * `rateLimit.ts` for the honest description of what that buys.
 *
 * Bucketed on the caller's address rather than on the email field: the field is
 * optional, so keying on it would leave "send nothing" as the whole bypass.
 */
const enquiryLimit = rateLimit({
  max: 5,
  windowMs: 60 * 60 * 1000,
  message:
    'That is several messages in an hour. If it is urgent, the shop number is on this page.',
});

contactRouter.post(
  '/',
  enquiryLimit,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as { name?: string; email?: string; message?: string };

    const name = (body.name ?? '').trim();
    const email = (body.email ?? '').trim();
    const message = (body.message ?? '').trim();

    /**
     * The same two fields the form itself insists on, refused with the same
     * sentence.
     *
     * Worth stating because the alternative is the failure this codebase keeps
     * finding: two surfaces holding different opinions about the same rule, and
     * a customer meeting whichever one is stricter with no idea why.
     */
    if (!name || !message) {
      res.status(400).json({ error: 'We need a name and a message before we can send this.' });
      return;
    }

    if (name.length > MAX_NAME) {
      res.status(400).json({ error: `A name is at most ${MAX_NAME} characters.` });
      return;
    }

    /**
     * Refused rather than truncated.
     *
     * Cutting somebody's message off at two thousand characters and telling
     * them it was sent would deliver a sentence that stops mid-word, and the
     * half that mattered is as likely to be in the part that was dropped.
     */
    if (message.length > MAX_MESSAGE) {
      res.status(400).json({
        error: `That message is longer than we can take — ${MAX_MESSAGE} characters at most. Send the short version and we will call you.`,
      });
      return;
    }

    /**
     * The address is optional, and checked when it is there.
     *
     * It becomes the Reply-To on the desk's copy, so a typo here is an enquiry
     * nobody can answer — and the sender would never find out, because the
     * bounce goes to the laundry. Better to say so while they are still looking
     * at the form.
     */
    if (email && (!isEmailShaped(email) || email.length > MAX_EMAIL)) {
      res.status(400).json({
        error: 'That email address does not look right. Check it, or leave it blank.',
        reason: 'bad-email',
      });
      return;
    }

    const enquiry = await store.enquiries.create({
      id: `enq-${randomBytes(9).toString('hex')}`,
      name,
      email,
      message,
    });

    /**
     * The desk's copy, after the row is safely down.
     *
     * `sendMail` resolves either way and never throws, so a provider failure
     * cannot roll back an enquiry that has already been accepted. With no key
     * configured it writes the message to the server log and reports success,
     * which is the right answer there: the log is where mail goes on a machine
     * with no mail configured, and it is what makes this flow exercisable
     * offline.
     */
    const desk = contactAddress();
    const delivered = desk ? await sendMail(enquiryMail(desk, enquiry)) : false;

    if (delivered) {
      await store.enquiries.markDelivered(enquiry.id);
    } else {
      // Loud, because the enquiry is now sitting in a table nobody is watching.
      console.error(
        `[contact] enquiry ${enquiry.id} from ${name} was saved but not emailed` +
          (desk ? '' : ' — neither CONTACT_EMAIL nor EMAIL_FROM is set')
      );
    }

    /**
     * `delivered` is the honest half of the answer and the form reads it.
     *
     * The enquiry is recorded either way, which is why this is a 201 rather
     * than an error — but "we have it" and "somebody has been told" are
     * different statements, and conflating them is how the old form came to
     * announce a send that never happened.
     */
    res.status(201).json({ ok: true, delivered });
  })
);

/**
 * What has come in. Supervisor only.
 *
 * Without this the table is write-only, and a record nobody can read is not a
 * record — it is the same silence the form had before, one layer down.
 * `?undelivered=1` narrows it to the ones the desk was never emailed about,
 * which on a healthy deployment is empty and is the first place to look when
 * somebody says they wrote in and heard nothing.
 */
contactRouter.get(
  '/',
  requireSupervisor,
  guard(async (req, res) => {
    const undeliveredOnly = req.query.undelivered === '1' || req.query.undelivered === 'true';
    res.json(await store.enquiries.list({ undeliveredOnly }));
  })
);

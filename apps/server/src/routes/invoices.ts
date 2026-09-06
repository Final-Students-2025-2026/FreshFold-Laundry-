/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { isIsoDate, ratesFromEnv, taxOn } from '@freshfold/core';
import { requireSupervisor } from '../auth';
import { deskActor, recordAudit } from '../audit';
import { resolveLister } from '../booking-access';
import { guard, notFound } from '../helpers';
import { store, type Repositories } from '../store';

/**
 * Invoices, for the customers the catalogue already advertises to and the
 * software could not bill.
 *
 * `SERVICES` has carried an entry called "Corporate Contracts" — boutique
 * hotels, spas, fitness studios, corporate offices — marked `bookable: false`
 * with the price note "Custom Enterprise Quotes". So the marketing site sold to
 * businesses, and there was no way to bill one: a grep for `invoice` returned
 * nothing, and every payment path in the product settled a single booking at the
 * moment it happened, by wallet, card or cash at the door.
 *
 * That works for a student with one bag. It is not how a hotel buys laundry — a
 * hotel expects a month of collections on one document, thirty days to pay, a
 * reference to quote, and a tax breakdown their own accountant can check.
 *
 * The numbers are frozen at issue. A draft recomputes from its lines as they are
 * added; an issued invoice does not, because it is a statement of what was owed
 * on the day it was issued and a document that restated itself when a tax rate
 * moved would be restating a bill somebody had already paid.
 */
export const invoicesRouter = Router();

/** Default payment terms, in days, when the desk does not name a date. */
const DEFAULT_TERMS_DAYS = 30;

/** The desk's list: everything, or just what is outstanding. */
invoicesRouter.get(
  '/',
  requireSupervisor,
  guard(async (req, res) => {
    const outstanding = req.query.outstanding === '1' || req.query.outstanding === 'true';
    res.json(await store.invoices.list({ outstanding }));
  })
);

/**
 * The signed-in customer's own invoices.
 *
 * Behind their session rather than an email in the query string, for the reason
 * `GET /bookings` is: an address read off the request is a claim about who is
 * asking rather than a fact about it.
 */
invoicesRouter.get(
  '/mine',
  guard(async (req, res) => {
    const lister = await resolveLister(req);

    if (!lister) {
      res.status(401).json({ error: 'Sign in to see your invoices.' });
      return;
    }

    if (lister.kind === 'supervisor') {
      res.json(await store.invoices.list());
      return;
    }

    res.json(await store.invoices.list({ email: lister.account.email }));
  })
);

/** One invoice with its lines. The customer it bills, or the desk. */
invoicesRouter.get(
  '/:id',
  guard(async (req, res) => {
    const lister = await resolveLister(req);
    if (!lister) {
      res.status(401).json({ error: 'Sign in to see this invoice.' });
      return;
    }

    const invoice = await store.invoices.find(req.params.id);
    if (!invoice) {
      notFound(res, 'Invoice');
      return;
    }

    /**
     * A customer may read their own and nothing else.
     *
     * Answered as a 404 rather than a 403, so an invoice number cannot be probed
     * for existence — the numbers are sequential, which makes guessing the next
     * one trivial and makes the difference between the two responses a
     * disclosure.
     */
    if (
      lister.kind !== 'supervisor' &&
      invoice.billToEmail.toLowerCase() !== lister.account.email.toLowerCase()
    ) {
      notFound(res, 'Invoice');
      return;
    }

    res.json(invoice);
  })
);

/** Opens a draft. Supervisor only. */
invoicesRouter.post(
  '/',
  requireSupervisor,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as {
      billToEmail?: string;
      billToName?: string;
      billToOrg?: string;
      billToAddress?: string;
      billToTin?: string;
      periodStart?: string;
      periodEnd?: string;
      dueOn?: string;
      notes?: string;
    };

    const email = (body.billToEmail ?? '').trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'An invoice needs somebody to bill.' });
      return;
    }

    for (const [field, value] of [
      ['periodStart', body.periodStart],
      ['periodEnd', body.periodEnd],
      ['dueOn', body.dueOn],
    ] as const) {
      if (value && !isIsoDate(value)) {
        res.status(400).json({ error: `${field} has to be a date in YYYY-MM-DD form.` });
        return;
      }
    }

    const year = new Date().getFullYear();

    const invoice = await store.tx(async (t) => {
      const number = await t.invoices.nextNumber(year);

      const created = await t.invoices.create({
        id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        number,
        billToEmail: email,
        billToName: (body.billToName ?? '').trim(),
        billToOrg: (body.billToOrg ?? '').trim(),
        billToAddress: (body.billToAddress ?? '').trim(),
        billToTin: (body.billToTin ?? '').trim(),
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        dueOn: body.dueOn ?? defaultDueDate(),
        notes: (body.notes ?? '').trim().slice(0, 2000),
        createdBy: req.supervisor!.email,
      });

      await recordAudit(t, {
        ...deskActor(req),
        action: 'Invoice opened',
        details: `Opened ${created.number} for ${created.billToOrg || created.billToEmail}`,
        type: 'payment',
        subject: created.billToEmail,
      });

      return created;
    });

    res.status(201).json(invoice);
  })
);

/**
 * Adds a line. Supervisor only, and only while the invoice is a draft.
 *
 * A line may name an order or stand alone. When it names one, the order is
 * checked against every other invoice first — one collection appearing on two
 * documents is the mistake that costs a corporate relationship, and it is a
 * cheap query.
 */
invoicesRouter.post(
  '/:id/lines',
  requireSupervisor,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as {
      jobId?: string;
      description?: string;
      quantity?: number;
      unitPrice?: number;
    };

    const invoice = await store.invoices.find(req.params.id);
    if (!invoice) {
      notFound(res, 'Invoice');
      return;
    }

    if (invoice.status !== 'draft') {
      res.status(409).json({
        error: 'This invoice has been issued, so its lines are fixed. Raise a credit note instead.',
        reason: 'not-a-draft',
      });
      return;
    }

    let description = (body.description ?? '').trim();
    let unitPrice = Number(body.unitPrice);
    let quantity = Number(body.quantity);

    if (body.jobId) {
      const job = await store.jobs.find(body.jobId);
      if (!job) {
        res.status(404).json({ error: 'That order does not exist.' });
        return;
      }

      const already = await store.invoices.billedJobs([job.id]);
      if (already.has(job.id)) {
        res.status(409).json({
          error: `${job.reference} is already on an invoice.`,
          reason: 'already-billed',
        });
        return;
      }

      // Defaults from the order, so the common case is one click. Anything the
      // desk actually typed wins — a negotiated rate is exactly the reason a
      // corporate customer is on an invoice rather than paying at the door.
      description = description || `${job.reference} — ${job.service.type}`;
      unitPrice = Number.isFinite(unitPrice) ? unitPrice : job.payment.amount;
      quantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    }

    if (!description) {
      res.status(400).json({ error: 'A line needs a description.' });
      return;
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      res.status(400).json({ error: 'A line needs a price.' });
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;

    const amount = Math.round(unitPrice * quantity * 100) / 100;

    const updated = await store.tx(async (t) => {
      await t.invoices.addLine({
        id: `line-${invoice.id}-${Date.now()}`,
        invoiceId: invoice.id,
        jobId: body.jobId,
        description: description.slice(0, 300),
        quantity,
        unitPrice,
        amount,
        position: (invoice.lines?.length ?? 0) + 1,
      });

      return retotal(t, invoice.id);
    });

    res.json(updated);
  })
);

/** Removes a line from a draft. */
invoicesRouter.delete(
  '/:id/lines/:lineId',
  requireSupervisor,
  guard(async (req, res) => {
    const invoice = await store.invoices.find(req.params.id);
    if (!invoice) {
      notFound(res, 'Invoice');
      return;
    }

    if (invoice.status !== 'draft') {
      res.status(409).json({ error: 'This invoice has been issued.', reason: 'not-a-draft' });
      return;
    }

    const updated = await store.tx(async (t) => {
      const removed = await t.invoices.removeLine(invoice.id, req.params.lineId);
      if (!removed) return null;
      return retotal(t, invoice.id);
    });

    if (!updated) {
      notFound(res, 'Line');
      return;
    }

    res.json(updated);
  })
);

/**
 * Issues, settles or voids one. Supervisor only.
 *
 * `issued` freezes the numbers; from that point `retotal` is never called on it
 * again. `paid` records what came in — part payments are normal on a corporate
 * account, so the amount is a running figure rather than a flag.
 */
invoicesRouter.patch(
  '/:id',
  requireSupervisor,
  guard(async (req, res) => {
    const { status, paid, dueOn } = (req.body ?? {}) as {
      status?: string;
      paid?: number;
      dueOn?: string;
    };

    const invoice = await store.invoices.find(req.params.id);
    if (!invoice) {
      notFound(res, 'Invoice');
      return;
    }

    if (status && !['draft', 'issued', 'paid', 'void'].includes(status)) {
      res.status(400).json({ error: 'That is not a state an invoice can be in.' });
      return;
    }

    /**
     * An issued invoice cannot go back to being a draft.
     *
     * It has been sent. Editing the lines on a document somebody is holding, and
     * leaving it under the same number, is how two versions of one invoice end
     * up in circulation — the answer to a wrong invoice is a credit note or a
     * void and a reissue, both of which leave a trail.
     */
    if (status === 'draft' && invoice.status !== 'draft') {
      res.status(409).json({
        error: 'This invoice has been issued. Void it and raise a new one instead.',
        reason: 'already-issued',
      });
      return;
    }

    if (status === 'issued' && (invoice.lines?.length ?? 0) === 0) {
      res.status(409).json({
        error: 'An invoice with no lines on it is not a document. Add a line first.',
        reason: 'empty',
      });
      return;
    }

    const received = Number(paid);

    const updated = await store.tx(async (t) => {
      const saved = await t.invoices.setStatus(invoice.id, {
        status: (status ?? invoice.status) as typeof invoice.status,
        paid: Number.isFinite(received) && received >= 0 ? received : undefined,
        dueOn: dueOn && isIsoDate(dueOn) ? dueOn : undefined,
      });

      if (saved && status && status !== invoice.status) {
        await recordAudit(t, {
          ...deskActor(req),
          action: `Invoice ${status}`,
          details:
            `${saved.number} for ${saved.billToOrg || saved.billToEmail} — ` +
            `GHS ${saved.total.toFixed(2)}` +
            (saved.paid > 0 ? `, GHS ${saved.paid.toFixed(2)} received` : ''),
          type: 'payment',
          subject: saved.billToEmail,
        });
      }

      return saved;
    });

    if (!updated) {
      notFound(res, 'Invoice');
      return;
    }

    res.json(await store.invoices.find(updated.id));
  })
);

/**
 * Recomputes an invoice's money from its own lines.
 *
 * The tax is worked out once, over the whole document, rather than per line.
 * Rounding per line and summing the results drifts by a pesewa or two across a
 * month of collections, and the number a customer's accountant checks is the
 * total — so the total is the thing that has to be exactly right.
 */
async function retotal(t: Repositories, id: string) {
  const invoice = await t.invoices.find(id);
  if (!invoice) return null;

  const subtotal =
    invoice.lines?.reduce((sum, line) => sum + line.amount, 0) ?? 0;

  const breakdown = taxOn(Math.round(subtotal * 100) / 100, ratesFromEnv(process.env));

  await t.invoices.retotal(id, {
    net: breakdown.net,
    tax: breakdown.tax,
    total: breakdown.gross,
    taxLines: breakdown.lines,
  });

  return t.invoices.find(id);
}

/** Thirty days out, as a calendar date. */
function defaultDueDate(): string {
  const due = new Date(Date.now() + DEFAULT_TERMS_DAYS * 86_400_000);
  return due.toISOString().slice(0, 10);
}

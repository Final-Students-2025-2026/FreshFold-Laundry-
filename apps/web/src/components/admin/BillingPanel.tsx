/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Invoices, for the customers the catalogue already advertises to.
 *
 * "Corporate Contracts" has been in `SERVICES` from the start — boutique hotels,
 * spas, fitness studios, corporate offices — marked `bookable: false` with the
 * note "Custom Enterprise Quotes". The marketing site sold to businesses and the
 * software could not bill one: every payment path settled a single booking at
 * the moment it happened, by wallet, card or cash at the door.
 *
 * The state that matters here is `issued`. A draft recomputes its totals as
 * lines are added; an issued invoice never does again, because it is a statement
 * of what was owed on the day it was issued and a document that restated itself
 * when a tax rate moved would be restating a bill somebody had already paid.
 * Going back to draft is refused for the same reason — the answer to a wrong
 * invoice is a void and a reissue, both of which leave a trail.
 */

import { useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import type { Invoice, InvoiceStatus } from '@freshfold/core';
import { failureMessage } from '@freshfold/core';
import * as store from '../../services/store';
import OrderRef from './OrderRef';
import PaneHeader, { ResourceBanner } from './PaneHeader';
import type { DeskResource } from './useDeskResource';
import { Badge, Button, EmptyState, Field, Input, Panel, formatCedis, type Tone } from './ui';

const TONES: Record<InvoiceStatus, Tone> = {
  draft: 'neutral',
  issued: 'warn',
  paid: 'ok',
  void: 'danger',
};

export default function BillingPanel({
  invoices: resource,
  onSaved,
  onFailed,
}: {
  /** The ledger of invoices, held by the shell for the rail's overdue figure. */
  invoices: DeskResource<Invoice[]>;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const invoices = resource.data;
  const loading = resource.loading;

  const [open, setOpen] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  const [billTo, setBillTo] = useState({ email: '', org: '', name: '', address: '', tin: '' });
  const [line, setLine] = useState({ jobId: '', description: '', quantity: '1', unitPrice: '' });

  const load = () => resource.refresh();

  const withToken = async (work: (token: string) => Promise<void>): Promise<void> => {
    const token = store.readAdminToken();
    if (!token) {
      onFailed('This desk is not signed in, so nothing was recorded.');
      return;
    }

    setBusy(true);
    try {
      await work(token);
    } catch (e) {
      onFailed(failureMessage(e, 'That could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    withToken(async (token) => {
      const invoice = await store.api.createInvoice(
        {
          billToEmail: billTo.email.trim(),
          billToName: billTo.name.trim(),
          billToOrg: billTo.org.trim(),
          billToAddress: billTo.address.trim(),
          billToTin: billTo.tin.trim(),
        },
        token,
      );

      setBillTo({ email: '', org: '', name: '', address: '', tin: '' });
      setOpen(invoice);
      load();
      onSaved(`${invoice.number} opened`);
    });

  const addLine = () =>
    withToken(async (token) => {
      if (!open) return;

      const updated = await store.api.addInvoiceLine(
        open.id,
        {
          jobId: line.jobId.trim() || undefined,
          description: line.description.trim() || undefined,
          quantity: Number(line.quantity) || 1,
          unitPrice: line.unitPrice.trim() ? Number(line.unitPrice) : undefined,
        },
        token,
      );

      setLine({ jobId: '', description: '', quantity: '1', unitPrice: '' });
      setOpen(updated);
      load();
    });

  const move = (status: InvoiceStatus) =>
    withToken(async (token) => {
      if (!open) return;
      const updated = await store.api.updateInvoice(open.id, { status }, token);
      setOpen(updated);
      load();
      onSaved(`${updated.number} ${status}`);
    });

  const outstanding = invoices
    .filter((invoice) => invoice.status === 'issued')
    .reduce((sum, invoice) => sum + (invoice.total - invoice.paid), 0);

  const drafts = invoices.filter((invoice) => invoice.status === 'draft').length;
  const issued = invoices.filter((invoice) => invoice.status === 'issued').length;

  return (
    <div className="space-y-4">
      <PaneHeader
        stats={[
          { label: 'Invoices', value: invoices.length },
          {
            label: 'Outstanding',
            value: formatCedis(outstanding),
            tone: outstanding > 0 ? 'warn' : 'ok',
            hint: `${issued} issued`,
          },
          { label: 'Drafts', value: drafts, hint: 'not yet sent' },
        ]}
        freshness={resource}
        banner={<ResourceBanner error={resource.error} refresh={resource.refresh} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-admin-fg-3" />
              {open ? open.number : 'Invoices'}
            </span>
          }
          description={
            open
              ? `${open.billToOrg || open.billToEmail}${open.dueOn ? ` · due ${open.dueOn}` : ''}`
              : 'A month of collections on one document, with terms.'
          }
          actions={
            open ? (
              <Button size="sm" onClick={() => setOpen(null)}>
                Back to list
              </Button>
            ) : (
              <Badge mono>{invoices.length}</Badge>
            )
          }
        >
          {open ? (
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONES[open.status]}>{open.status}</Badge>
                <span className="font-mono text-[13px] text-admin-fg">
                  {formatCedis(open.total)}
                </span>
                <span className="text-[11px] text-admin-fg-3">
                  net {formatCedis(open.net)} · tax {formatCedis(open.tax)}
                </span>
              </div>

              {(open.lines ?? []).length === 0 ? (
                <p className="text-[12px] text-admin-fg-3">
                  No lines yet. An invoice with none on it is not a document, and cannot be issued.
                </p>
              ) : (
                <div className="divide-y divide-admin-line rounded-xl border border-admin-line">
                  {(open.lines ?? []).map((row) => (
                    <div key={row.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-admin-fg-2">
                        {row.description}
                        {/*
                          The order this line bills for, as somewhere you can go.
                          It is typed in as free text below, so it is only a
                          reference when there is one — a line for "March
                          collections" names no single job and should not
                          pretend to.
                        */}
                        {row.jobId && (
                          <>
                            {' · '}
                            <OrderRef id={row.jobId} className="text-[11px]" />
                          </>
                        )}
                      </span>
                      <span className="font-mono text-[11px] text-admin-fg-3">
                        {row.quantity} × {formatCedis(row.unitPrice)}
                      </span>
                      <span className="font-mono text-[12px] text-admin-fg">
                        {formatCedis(row.amount)}
                      </span>
                      {open.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() =>
                            void withToken(async (token) => {
                              const updated = await store.api.removeInvoiceLine(
                                open.id,
                                row.id,
                                token,
                              );
                              setOpen(updated);
                            })
                          }
                          className="rounded-full p-1 text-admin-fg-3 transition-colors hover:text-admin-danger"
                          aria-label="Remove line"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* The tax working, line by line, because each levy has to appear
                  separately on a VAT invoice — one "levies 6%" row is not an
                  invoice a customer's accountant can check. */}
              {open.taxLines.length > 0 && (
                <div className="rounded-xl border border-admin-line px-3 py-2">
                  {open.taxLines.map((tax) => (
                    <div key={tax.id} className="flex justify-between text-[11px] text-admin-fg-3">
                      <span>
                        {tax.label} ({(tax.rate * 100).toFixed(1)}%)
                      </span>
                      <span className="font-mono">{formatCedis(tax.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {open.status === 'draft' && (
                <div className="space-y-2 rounded-xl border border-admin-line p-3">
                  <span className="block text-[12px] font-medium text-admin-fg-2">Add a line</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={line.jobId}
                      onChange={(e) => setLine({ ...line, jobId: e.target.value })}
                      placeholder="Order id (optional)"
                    />
                    <Input
                      value={line.description}
                      onChange={(e) => setLine({ ...line, description: e.target.value })}
                      placeholder="Description"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => setLine({ ...line, quantity: e.target.value })}
                      placeholder="Qty"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => setLine({ ...line, unitPrice: e.target.value })}
                      placeholder="Unit price"
                    />
                  </div>
                  <Button size="sm" icon={Plus} disabled={busy} onClick={() => void addLine()}>
                    Add line
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {open.status === 'draft' && (
                  <Button variant="primary" disabled={busy} onClick={() => void move('issued')}>
                    Issue
                  </Button>
                )}
                {open.status === 'issued' && (
                  <Button variant="primary" disabled={busy} onClick={() => void move('paid')}>
                    Mark paid
                  </Button>
                )}
                {open.status !== 'void' && open.status !== 'paid' && (
                  <Button variant="danger" disabled={busy} onClick={() => void move('void')}>
                    Void
                  </Button>
                )}
              </div>
            </div>
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={loading ? 'Reading the invoices…' : 'Nothing billed yet'}
              detail={loading ? undefined : 'Open one beside this panel for a corporate customer.'}
            />
          ) : (
            <div className="divide-y divide-admin-line">
              {invoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  onClick={() =>
                    void withToken(async (token) => {
                      setOpen(await store.api.getInvoice(invoice.id, token));
                    })
                  }
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-admin-raised"
                >
                  <span className="font-mono text-[12px] text-admin-fg">{invoice.number}</span>
                  <Badge tone={TONES[invoice.status]}>{invoice.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-admin-fg-2">
                    {invoice.billToOrg || invoice.billToEmail}
                  </span>
                  <span className="font-mono text-[12px] text-admin-fg">
                    {formatCedis(invoice.total)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="New invoice" description="Numbered in sequence for the year.">
          <div className="space-y-3 p-5">
            <Field label="Bill to (email)" hint="Where the document goes.">
              <Input
                value={billTo.email}
                onChange={(e) => setBillTo({ ...billTo, email: e.target.value })}
                placeholder="accounts@goldentulip.com"
              />
            </Field>
            <Field label="Organisation">
              <Input
                value={billTo.org}
                onChange={(e) => setBillTo({ ...billTo, org: e.target.value })}
                placeholder="Golden Tulip Kumasi"
              />
            </Field>
            <Field label="Contact">
              <Input
                value={billTo.name}
                onChange={(e) => setBillTo({ ...billTo, name: e.target.value })}
                placeholder="Ama Owusu"
              />
            </Field>
            <Field label="Address">
              <Input
                value={billTo.address}
                onChange={(e) => setBillTo({ ...billTo, address: e.target.value })}
                placeholder="Rain Tree Street, Kumasi"
              />
            </Field>
            <Field label="TIN" hint="Their tax number, so they can reclaim the VAT.">
              <Input
                value={billTo.tin}
                onChange={(e) => setBillTo({ ...billTo, tin: e.target.value })}
                placeholder="C0001234567"
              />
            </Field>

            <Button
              variant="primary"
              disabled={busy || !billTo.email.trim()}
              onClick={() => void create()}
            >
              {busy ? 'Opening…' : 'Open draft'}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

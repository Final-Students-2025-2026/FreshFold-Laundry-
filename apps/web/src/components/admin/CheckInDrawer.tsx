/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checking a load in: what is in each bag, and what it weighs.
 *
 * This is the surface that makes a bag manifest true. Both numbers on it used to
 * be minted with the booking, in `bagsForJob`, out of the digits of the job id —
 * a hash formatted to one decimal place with `kg` after it, and a second hash
 * between three and ten. They were printed on the courier's scanner, on the
 * customer's own manifest, and totalled on the board behind this drawer. Nobody
 * had weighed or counted anything, and a customer disputing a missing garment
 * was arguing against a number derived from their own reference.
 *
 * Counting is the required half; naming garments is not. A hostel wash is thirty
 * items and a laundry that had to type thirty rows per bag would stop by the
 * second week, which is how a tracking scheme becomes a table of nulls. The rows
 * below are for the garments worth naming — the ones a customer would notice,
 * and the ones that arrive already marked, which is the half that protects the
 * laundry when the stain turns out to have been there all along.
 */

import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { Order } from '@freshfold/core';
import * as store from '../../services/store';
import ProductionRecord from './ProductionRecord';
import { Badge, Button, Field, Input } from './ui';

interface CheckInDrawerProps {
  order: Order;
  onClose: () => void;
  /** Called with a sentence for the dashboard's flash strip once it lands. */
  onCheckedIn: (message: string) => void;
}

interface GarmentDraft {
  key: number;
  bagId: string;
  description: string;
  condition: string;
}

export default function CheckInDrawer({ order, onClose, onCheckedIn }: CheckInDrawerProps) {
  const bags = order.bags ?? [];

  /** Counts keyed by bag id, as typed. Strings, so an empty field stays empty. */
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(bags.map((bag) => [bag.id, bag.itemCount?.toString() ?? '']))
  );
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(bags.map((bag) => [bag.id, bag.weight ?? '']))
  );

  const [garments, setGarments] = useState<GarmentDraft[]>([]);
  const [machine, setMachine] = useState('');
  const [batch, setBatch] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const addGarment = () =>
    setGarments((current) => [
      ...current,
      { key: Date.now(), bagId: bags[0]?.id ?? '', description: '', condition: '' },
    ]);

  const total = Object.values(counts).reduce((sum, value) => {
    const parsed = Number(value);
    return sum + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }, 0);

  /** Every bag has to be given a number, including zero. */
  const missing = bags.filter((bag) => counts[bag.id]?.trim() === '');

  const submit = async () => {
    const token = store.readAdminToken();
    if (!token) {
      setError('This desk is not signed in.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await store.api.checkInLoad(
        order.id,
        {
          bags: bags.map((bag) => ({
            id: bag.id,
            // An empty field is left off entirely rather than sent as zero: the
            // server leaves an unnamed bag exactly as it was, so a desk checking
            // in three of four now and the fourth when it turns up does not
            // blank the three.
            itemCount: counts[bag.id]?.trim() ? Number(counts[bag.id]) : undefined,
            weight: weights[bag.id]?.trim() || undefined,
          })),
          garments: garments
            .filter((garment) => garment.description.trim())
            .map((garment) => ({
              bagId: garment.bagId || undefined,
              description: garment.description.trim(),
              condition: garment.condition.trim(),
            })),
          machine: machine.trim() || undefined,
          batch: batch.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        token
      );

      onCheckedIn(`${order.orderNumber} — ${total} garment${total === 1 ? '' : 's'} checked in`);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : 'That could not be recorded. Nothing has changed.'
      );
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-admin-line bg-admin-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-[15px] font-semibold text-admin-fg">
              Check in {order.orderNumber}
            </h3>
            <p className="text-[12px] leading-relaxed text-admin-fg-3">
              {order.customerName} · {order.laundryType}. Count every bag before it goes in —
              this is the number every later dispute is argued against.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-admin-fg-3 transition-colors hover:text-admin-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ------------------------------------------------------------ bags */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-admin-fg-2">Bags</span>
            <Badge tone={missing.length > 0 ? 'warn' : 'ok'}>
              {total} garment{total === 1 ? '' : 's'} counted
            </Badge>
          </div>

          {bags.length === 0 ? (
            <p className="rounded-xl border border-admin-line bg-admin-raised px-4 py-3 text-[12px] text-admin-fg-3">
              This order has no bag manifest, so there is nothing to count against.
            </p>
          ) : (
            bags.map((bag) => (
              <div
                key={bag.id}
                className="grid grid-cols-[1fr_90px_110px] items-center gap-3 rounded-xl border border-admin-line bg-admin-raised px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate font-mono text-[11px] text-admin-fg-2">
                    {bag.qrCode || bag.id}
                  </span>
                  <span className="block truncate text-[11px] text-admin-fg-3">{bag.type}</span>
                </div>

                <Input
                  type="number"
                  min={0}
                  max={200}
                  inputMode="numeric"
                  placeholder="items"
                  value={counts[bag.id] ?? ''}
                  onChange={(e) =>
                    setCounts((current) => ({ ...current, [bag.id]: e.target.value }))
                  }
                />

                <Input
                  type="text"
                  placeholder="e.g. 2.7kg"
                  value={weights[bag.id] ?? ''}
                  onChange={(e) =>
                    setWeights((current) => ({ ...current, [bag.id]: e.target.value }))
                  }
                />
              </div>
            ))
          )}
        </div>

        {/* -------------------------------------------------------- garments */}
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="block text-[12px] font-medium text-admin-fg-2">
                Garments worth naming
              </span>
              <span className="block text-[11px] text-admin-fg-3">
                Optional. Anything a customer would notice, and anything that arrived already
                marked — a stain recorded now is a stain that was already there.
              </span>
            </div>
            <Button size="sm" icon={Plus} onClick={addGarment}>
              Add
            </Button>
          </div>

          {garments.map((garment, index) => (
            <div
              key={garment.key}
              className="grid grid-cols-[110px_1fr_1fr_32px] items-center gap-2 rounded-xl border border-admin-line bg-admin-raised px-3 py-2"
            >
              <select
                value={garment.bagId}
                onChange={(e) =>
                  setGarments((current) =>
                    current.map((row, i) => (i === index ? { ...row, bagId: e.target.value } : row))
                  )
                }
                className="h-9 cursor-pointer rounded-full border border-admin-line bg-admin-panel px-3 text-[12px] text-admin-fg-2 focus:border-admin-accent/60 focus:outline-none"
              >
                <option value="">No bag</option>
                {bags.map((bag) => (
                  <option key={bag.id} value={bag.id}>
                    {bag.qrCode || bag.id}
                  </option>
                ))}
              </select>

              <Input
                placeholder="Blue oxford shirt"
                value={garment.description}
                onChange={(e) =>
                  setGarments((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, description: e.target.value } : row
                    )
                  )
                }
              />

              <Input
                placeholder="Condition on arrival"
                value={garment.condition}
                onChange={(e) =>
                  setGarments((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, condition: e.target.value } : row
                    )
                  )
                }
              />

              <button
                type="button"
                onClick={() =>
                  setGarments((current) => current.filter((_, i) => i !== index))
                }
                className="rounded-full p-1.5 text-admin-fg-3 transition-colors hover:text-admin-danger"
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/*
          What is already on the record for this load.

          Here because this drawer is reopened — the "Counts" button on a load
          that has been checked in once — and somebody adding to a manifest
          needs to see what is already on it. Without this the second visit
          names the same shirt twice, or skips it on the assumption that the
          first visit got it.
        */}
        <div className="mt-6">
          <ProductionRecord orderId={order.id} />
        </div>

        {/* ------------------------------------------------------ production */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Machine" hint="Which washer it is going into.">
            <Input
              placeholder="Washer 3"
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
            />
          </Field>
          <Field label="Batch" hint="What it is going in with.">
            <Input
              placeholder="Tue-PM-A"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
            />
          </Field>
          <Field label="Note" hint="Anything odd about this load.">
            <Input
              placeholder="One bag damp on arrival"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>

        {!!error && (
          <p className="mt-4 rounded-xl border border-admin-danger/25 bg-admin-danger/10 px-4 py-3 text-[12px] leading-relaxed text-admin-danger">
            {error}
          </p>
        )}

        {missing.length > 0 && !error && (
          <p className="mt-4 text-[11px] text-admin-fg-3">
            {missing.length} bag{missing.length === 1 ? '' : 's'} still without a count. You can
            record the rest now and come back — bags you leave blank are left as they were.
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <Button
            variant="primary"
            disabled={busy || bags.length === 0}
            onClick={() => void submit()}
          >
            {busy ? 'Recording…' : 'Record check-in'}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

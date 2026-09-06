/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settlement: what has been paid, what has not, and the receipt for either.
 *
 * Unpaid orders sort to the top. This pane exists to chase money, so the rows
 * that need action should not be interleaved with the twenty settled ones a
 * supervisor has no reason to look at.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Printer, Receipt, Wallet, X } from 'lucide-react';
import { decodeFinish, priceBreakdown, describeItems } from '@freshfold/core';
import type { Booking } from '../../types';
import OrderRef from './OrderRef';
import PaneHeader, { ResourceBanner } from './PaneHeader';
import type { DeskResource } from './useDeskResource';
import { Badge, Button, EmptyState, Panel, TableHead, formatCedis } from './ui';
import { displayAmount } from '../../services/amount';

const COLS =
  'md:grid md:grid-cols-[112px_minmax(140px,1.4fr)_minmax(150px,1.4fr)_100px_96px_76px] md:items-center md:gap-3';

export default function FinancialsPanel({
  bookings,
  freshness,
  collected,
  outstanding,
  onTogglePayment,
  onRefund,
}: {
  bookings: Booking[];
  /** The mirror these rows come out of. */
  freshness: Pick<DeskResource<unknown>, 'error' | 'refreshing' | 'fetchedAt' | 'refresh'>;
  collected: number;
  outstanding: number;
  onTogglePayment: (bookingId: string) => Promise<void>;
  /** Returns a settled bill to the patron's wallet. Supervisor only. */
  onRefund: (bookingId: string) => Promise<void>;
}) {
  /**
   * The receipt on screen.
   *
   * Held here rather than in the shell, where it used to live. Nothing outside
   * this pane opens a receipt, and a modal whose open/closed state survives a
   * tab change is a modal that can be reopened by navigating back to a pane you
   * did not open it from.
   */
  const [receiptFor, setReceiptFor] = useState<Booking | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('unpaid-first');

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();

    const matching = bookings.filter((b) => {
      const paid = b.paymentStatus === 'Paid';
      const matchesQuery =
        !q ||
        b.id.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        (b.transactionRef?.toLowerCase().includes(q) ?? false);

      const matchesStatus =
        statusFilter === 'unpaid-first' ||
        (statusFilter === 'unpaid' && !paid) ||
        (statusFilter === 'paid' && paid) ||
        (statusFilter === 'refunded' && b.paymentStatus === 'Refunded');

      return matchesQuery && matchesStatus;
    });

    // Unpaid first, then by amount descending — the biggest debt at the top.
    // This pane exists to chase money, so the rows that need action should not
    // be interleaved with the twenty settled ones nobody has to look at.
    return matching.sort((a, b) => {
      const aPaid = a.paymentStatus === 'Paid' ? 1 : 0;
      const bPaid = b.paymentStatus === 'Paid' ? 1 : 0;
      if (aPaid !== bPaid) return aPaid - bPaid;
      return displayAmount(b) - displayAmount(a);
    });
  }, [bookings, query, statusFilter]);

  const unpaidCount = bookings.filter((b) => b.paymentStatus !== 'Paid').length;
  const filtersActive = query.trim() !== '' || statusFilter !== 'unpaid-first';

  return (
    <div className="space-y-4">
      <PaneHeader
        stats={[
          { label: 'Collected', value: formatCedis(collected), tone: 'ok' },
          {
            label: 'Outstanding',
            value: formatCedis(outstanding),
            tone: outstanding > 0 ? 'warn' : 'neutral',
            hint: `${unpaidCount} unpaid`,
          },
          {
            label: 'Showing',
            value: ordered.length,
            tone: filtersActive ? 'accent' : 'neutral',
            hint: `of ${bookings.length}`,
          },
        ]}
        freshness={freshness}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Order, customer or transaction reference…',
        }}
        filters={[
          {
            label: 'Filter by settlement',
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: 'unpaid-first', label: 'Unpaid first' },
              { value: 'unpaid', label: 'Only unpaid' },
              { value: 'paid', label: 'Only paid' },
              { value: 'refunded', label: 'Only refunded' },
            ],
          },
        ]}
        filtersActive={filtersActive}
        onClearFilters={() => {
          setQuery('');
          setStatusFilter('unpaid-first');
        }}
        banner={<ResourceBanner error={freshness.error} refresh={freshness.refresh} />}
      />

      <Panel
        title="Settlement"
        description="Unpaid orders are listed first — this pane exists to chase money."
      >
        {ordered.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={bookings.length === 0 ? 'Nothing to settle' : 'No orders match'}
            detail={
              bookings.length === 0
                ? 'Orders appear here as soon as they are booked.'
                : `${bookings.length} order${bookings.length === 1 ? '' : 's'} on the board, none of them matching.`
            }
          />
        ) : (
          <>
            <TableHead
              className={COLS}
              columns={[
                { label: 'Order' },
                { label: 'Customer' },
                { label: 'Service' },
                { label: 'Amount', className: 'text-right' },
                { label: 'Status' },
                { label: '', className: '' },
              ]}
            />
            <div className="divide-y divide-admin-line">
              {ordered.map((b) => {
                const paid = b.paymentStatus === 'Paid';
                const refunded = b.paymentStatus === 'Refunded';
                // Only a cash collection is the desk's to take back. A wallet
                // debit or a Paystack charge moved real money and needs a
                // refund, which the button beside it now performs.
                const reversible = b.paymentMethod === 'Cash';
                return (
                  <div key={b.id} className={`px-5 py-3 hover:bg-admin-hover ${COLS}`}>
                    <span className="text-[12px]">
                      <OrderRef id={b.id} />
                    </span>

                    <div className="mt-0.5 min-w-0 md:mt-0">
                      <span className="block truncate text-[13px] font-medium text-admin-fg">
                        {b.name}
                      </span>
                      {b.transactionRef && (
                        <span className="block truncate font-mono text-[11px] text-admin-fg-3">
                          {b.transactionRef}
                        </span>
                      )}
                    </div>

                    {/*
                      Joined rather than interpolated: a booking with no suburb
                      on it used to render the separator with nothing after it,
                      so the line trailed off in a dangling "·".
                    */}
                    <span className="mt-0.5 block truncate text-[12px] text-admin-fg-2 md:mt-0">
                      {[describeItems(b) || b.serviceType, b.suburb?.trim()]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>

                    <span className="mt-1 block font-mono text-[13px] tabular-nums text-admin-fg md:mt-0 md:text-right">
                      {formatCedis(displayAmount(b))}
                    </span>

                    <div className="mt-1.5 md:mt-0">
                      {/* Three states, not two: a refunded booking is neither
                          owed nor collected, and showing it as "Unpaid" would
                          put it back on the desk's list of things to chase. */}
                      <Badge tone={refunded ? 'neutral' : paid ? 'ok' : 'warn'} dot>
                        {refunded ? 'Refunded' : paid ? 'Paid' : 'Unpaid'}
                      </Badge>
                    </div>

                    <div className="mt-2 flex items-center gap-1 md:mt-0 md:justify-self-end">
                      <Button
                        size="sm"
                        variant={paid ? 'ghost' : 'primary'}
                        onClick={() => void onTogglePayment(b.id)}
                        disabled={paid && !reversible}
                        title={
                          paid
                            ? reversible
                              ? 'Undo the cash collection recorded on this order'
                              : `Paid by ${b.paymentMethod ?? 'gateway'} — use Refund instead`
                            : 'Record that a courier collected this bill in cash'
                        }
                      >
                        {paid ? 'Revert' : 'Settle'}
                      </Button>

                      {/*
                        Offered only on a settled booking, which is the only
                        thing there is to refund — and never on a cash one,
                        where Revert beside it is the honest act: no money left
                        the building, so none needs returning to a wallet.
                      */}
                      {paid && !reversible && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onRefund(b.id)}
                          title={`Return ${formatCedis(displayAmount(b))} to ${b.name}'s FreshFold wallet`}
                        >
                          Refund
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Printer}
                        aria-label={`Receipt for ${b.id}`}
                        title="Itemised receipt"
                        onClick={() => setReceiptFor(b)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      <AnimatePresence>
        {receiptFor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setReceiptFor(null)}
          >
            <motion.div
              initial={{ scale: 0.97, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97, y: 8 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="admin-card w-full max-w-sm rounded-2xl border border-admin-line bg-admin-panel"
            >
              <header className="flex items-center justify-between border-b border-admin-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-admin-accent" />
                  <h2 className="text-[13px] font-semibold text-admin-fg">Itemised receipt</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setReceiptFor(null)}
                  aria-label="Close receipt"
                  className="cursor-pointer rounded p-0.5 text-admin-fg-3 hover:text-admin-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="space-y-3 px-4 py-4 text-[12px]">
                <ReceiptRow label="Order" value={receiptFor.id} mono />
                <ReceiptRow label="Customer" value={receiptFor.name} />
                <ReceiptRow label="Service" value={describeItems(receiptFor) || receiptFor.serviceType} />
                {/*
                  Same join as the row above, and it matters more here: this is
                  the document the customer is handed, and an address with no
                  suburb behind it printed with a trailing comma.
                */}
                <ReceiptRow
                  label="Pickup"
                  value={[receiptFor.address?.trim(), receiptFor.suburb?.trim()]
                    .filter(Boolean)
                    .join(', ')}
                />

                {/*
                  Itemised from the booking. This used to print a "Care package"
                  of the total minus ten and a flat "Dispatch fee" of ₵10.00 on
                  every order — a split that matched no booking and no fee this
                  business charges. These are the lines the quote was built from.
                */}
                {(() => {
                  const finish = decodeFinish(receiptFor.specialInstructions);
                  // The lines matter here as much as the finish: a receipt
                  // that itemises one load against a total charged for three
                  // does not add up, and the difference lands in the reduction
                  // row as though a discount had been applied.
                  const lines = priceBreakdown({
                    serviceType: receiptFor.serviceType,
                    scent: finish.scent,
                    starch: finish.starch,
                    addonIds: receiptFor.specialtyAddons,
                    items: receiptFor.items,
                    quantity: receiptFor.quantity,
                  });
                  const total = displayAmount(receiptFor);
                  // Below list price means an included pickup, the member rate
                  // or a loyalty tier took its cut. Its own line, not folded in.
                  const reduction = Math.max(0, lines.gross - total);

                  return (
                    <>
                      <div className="space-y-2 border-t border-admin-line pt-3">
                        <ReceiptRow label="Care package" value={formatCedis(lines.base)} mono />
                        {lines.finishes > 0 && (
                          <ReceiptRow
                            label="Scent & starch"
                            value={formatCedis(lines.finishes)}
                            mono
                          />
                        )}
                        {lines.addons > 0 && (
                          <ReceiptRow
                            label="Specialty add-ons"
                            value={formatCedis(lines.addons)}
                            mono
                          />
                        )}
                        {reduction > 0 && (
                          <ReceiptRow
                            label="Membership & loyalty"
                            value={`-${formatCedis(reduction)}`}
                            mono
                          />
                        )}
                      </div>

                      <div className="flex items-baseline justify-between border-t border-admin-line pt-3">
                        <span className="text-[13px] font-medium text-admin-fg">Total</span>
                        <span className="font-mono text-[15px] font-semibold tabular-nums text-admin-accent">
                          {formatCedis(total)}
                        </span>
                      </div>
                    </>
                  );
                })()}

                <div className="flex items-center justify-between">
                  <span className="text-admin-fg-2">Status</span>
                  <Badge tone={receiptFor.paymentStatus === 'Paid' ? 'ok' : 'warn'} dot>
                    {receiptFor.paymentStatus ?? 'Pending'}
                  </Badge>
                </div>
              </div>

              <footer className="border-t border-admin-line px-4 py-3">
                <Button
                  variant="primary"
                  icon={Printer}
                  className="w-full"
                  onClick={() => window.print()}
                >
                  Print / save PDF
                </Button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-admin-fg-2">{label}</span>
      <span
        className={`min-w-0 truncate text-right text-admin-fg ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

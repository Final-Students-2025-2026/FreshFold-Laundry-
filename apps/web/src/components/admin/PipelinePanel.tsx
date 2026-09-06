/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The live order pipeline.
 *
 * This pane used to render every order as a ~450px card: a dispatcher with
 * thirty live jobs could see two of them at once, and finding the one the
 * customer on the phone is asking about meant scrolling past twenty-eight
 * others. It is a table now — one 56px row per order, everything needed to
 * triage in that row, and the detail (address, landmark, stage stepper,
 * contact, telemetry map) one click away in an expansion.
 *
 * Only one row expands at a time. Two open maps is two polling map widgets and
 * a scroll position nobody can hold.
 */

import { describeItems, type AuditEvent } from '@freshfold/core';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronRight,
  Inbox,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import type { Booking, BookingStatus } from '../../types';
import HandoffCode from '../HandoffCode';
import LiveDispatchMap from '../LiveDispatchMap';
import ProductionRecord from './ProductionRecord';
import ProofOfService from './ProofOfService';
import { Badge, Button, EmptyState, Panel, TableHead, formatCedis, type Tone } from './ui';
import { HUB_LEG } from './stages';
import { OrderTrail } from './AuditPanel';
import { displayAmount } from '../../services/amount';

/**
 * Grid tracks.
 *
 * From `md` up this is a table: one row of columns per order, shared with the
 * header strip. Below `md` those same cells reflow into a four-line card —
 * two columns, `order-*` deciding what pairs with what — rather than stacking
 * into eight lines and turning a twelve-order list into a scroll marathon.
 */
const COLS_MD =
  'md:grid-cols-[112px_minmax(150px,1.5fr)_minmax(110px,1fr)_minmax(130px,1.1fr)_92px_minmax(120px,1fr)_84px_28px] md:items-center md:gap-3';

const ROW_GRID = `grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 md:grid ${COLS_MD}`;

/**
 * How far through the pipeline a stage is, and what that should look like.
 * Cancelled is the one stage that is not progress, so it gets its own tone
 * rather than being drawn as "100% complete".
 */
function stageTone(status: BookingStatus): Tone {
  if (status === 'Cancelled') return 'danger';
  if (status === 'Delivered') return 'ok';
  if (status === 'Scheduled') return 'neutral';
  return 'info';
}

export default function PipelinePanel({
  bookings,
  totalCount,
  stageSequence,
  riderPhones,
  auditEvents,
  focusOrderId,
  onFocusHandled,
  onUpdateStatus,
  onTogglePayment,
  onDelete,
}: {
  bookings: Booking[];
  /** How many orders exist before filtering, so the empty state can tell why. */
  totalCount: number;
  stageSequence: BookingStatus[];
  riderPhones: Record<string, string>;
  /** The desk's trail, for the recent-activity list in an expansion. */
  auditEvents: AuditEvent[];
  /** An order the desk has been asked to show, from a reference elsewhere. */
  focusOrderId: string | null;
  onFocusHandled: () => void;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => void | Promise<void>;
  onTogglePayment: (bookingId: string) => Promise<void>;
  onDelete: (bookingId: string) => void | Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mapOpenFor, setMapOpenFor] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  /**
   * Open the row somebody followed a reference to, and scroll to it.
   *
   * The scroll is the half that matters. Expanding a row twelve screens down a
   * long board looks, from where the reader is sitting, exactly like nothing
   * having happened — which is how a cross-pane link stops being trusted.
   */
  useEffect(() => {
    if (!focusOrderId) return;

    setExpandedId(focusOrderId);

    // After paint, so the row exists and the expansion has taken its height.
    const frame = requestAnimationFrame(() => {
      rowRefs.current
        .get(focusOrderId)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      onFocusHandled();
    });

    return () => cancelAnimationFrame(frame);
  }, [focusOrderId, onFocusHandled]);

  if (bookings.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Inbox}
          title={totalCount === 0 ? 'No orders on the board' : 'No orders match these filters'}
          detail={
            totalCount === 0
              ? 'Orders arrive here the moment a customer books on the website or in the app.'
              : `${totalCount} order${totalCount === 1 ? '' : 's'} on the board, none of them matching. Clear the filters to see them.`
          }
        />
      </Panel>
    );
  }

  return (
    <Panel bodyClassName="">
      <TableHead
        className={COLS_MD}
        columns={[
          { label: 'Order' },
          { label: 'Customer' },
          { label: 'Pickup' },
          { label: 'Stage' },
          { label: 'Payment' },
          { label: 'Courier' },
          { label: 'Amount', className: 'text-right' },
          { label: '', className: '' },
        ]}
      />

      <div className="divide-y divide-admin-line">
        {bookings.map((b) => {
          const isExpanded = expandedId === b.id;
          const paid = b.paymentStatus === 'Paid';
          // A cash collection is the desk's own record, so the desk can take it
          // back. A wallet debit or a Paystack charge moved money and needs a
          // refund — the server refuses to reverse either.
          const reversible = b.paymentMethod === 'Cash';
          const stageIndex = stageSequence.indexOf(b.status);

          return (
            <div
              key={b.id}
              ref={(node) => {
                if (node) rowRefs.current.set(b.id, node);
                else rowRefs.current.delete(b.id);
              }}
              className={isExpanded ? 'bg-admin-raised/60' : ''}
            >
              {/* --- The row itself. Whole row is the disclosure control. --- */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => setExpandedId(isExpanded ? null : b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedId(isExpanded ? null : b.id);
                  }
                }}
                className={`w-full cursor-pointer px-5 py-3 text-left transition-colors hover:bg-admin-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-admin-accent/60 ${ROW_GRID}`}
              >
                <span className="order-1 font-mono text-[12px] font-medium tabular-nums text-admin-accent md:order-none">
                  {b.id}
                </span>

                <div className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
                  <span className="block truncate text-[13px] font-medium text-admin-fg">
                    {b.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-admin-fg-3">
                    {b.phone}
                  </span>
                </div>

                <span className="order-4 block truncate text-[12px] text-admin-fg-2 md:order-none">
                  {b.suburb}
                </span>

                <div className="order-6 md:order-none">
                  <Badge tone={stageTone(b.status)} dot>
                    {b.status}
                  </Badge>
                </div>

                <div className="order-7 justify-self-end md:order-none md:justify-self-auto">
                  <Badge tone={paid ? 'ok' : 'warn'}>{paid ? 'Paid' : 'Unpaid'}</Badge>
                </div>

                <span className="order-5 block truncate text-right text-[12px] text-admin-fg-2 md:order-none md:text-left">
                  {b.rider?.name?.trim() || (
                    <span className="text-admin-fg-3 italic">Unassigned</span>
                  )}
                </span>

                <span className="order-2 block font-mono text-[13px] font-medium tabular-nums text-admin-fg md:order-none md:text-right">
                  {formatCedis(displayAmount(b))}
                </span>

                <ChevronRight
                  className={`hidden h-4 w-4 shrink-0 text-admin-fg-3 transition-transform md:block ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                />
              </div>

              {/* --- Expansion: everything that used to bloat every card. --- */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4 border-t border-admin-line px-5 py-4">
                      {/* Facts grid */}
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Detail icon={MapPin} label="Pickup address">
                          <span className="text-admin-fg">{b.address}</span>
                          {b.notes && (
                            <span className="mt-1 block text-admin-fg-2">
                              Landmark: {b.notes}
                            </span>
                          )}
                        </Detail>

                        <Detail icon={Mail} label="Contact">
                          <span className="block truncate text-admin-fg">{b.email}</span>
                          <span className="block font-mono text-admin-fg-2">{b.phone}</span>
                        </Detail>

                        <Detail icon={Sparkles} label="Service">
                          {/* Every service and its count. Four loads is a
                              different vehicle from one, and an order carrying
                              two services is a different job from one. */}
                          <span className="block text-admin-fg">
                            {describeItems(b) || b.serviceType}
                          </span>
                          {b.specialtyAddons?.length ? (
                            <span className="block text-admin-fg-2">
                              {b.specialtyAddons.join(', ')}
                            </span>
                          ) : null}
                        </Detail>

                        <Detail icon={User} label="Courier">
                          {b.rider ? (
                            <>
                              <span className="block text-admin-fg">
                                {b.rider.name?.trim() || 'Name not yet set'}
                                {/* Dark until this session, because nothing ever
                                    wrote the number it is guarded on. The count
                                    beside it is what separates 5.0 from one
                                    rating from 4.6 from ninety. */}
                                {b.rider.rating > 0 && (
                                  <span className="ml-1.5 font-mono text-admin-fg-3">
                                    {b.rider.rating.toFixed(1)}★
                                    {!!b.rider.ratingCount && ` (${b.rider.ratingCount})`}
                                  </span>
                                )}
                              </span>
                              <span className="block font-mono text-admin-fg-2">
                                {/*
                                  No ETA here. This line used to end "· ETA 9m",
                                  from the courier's coordinates in a straight
                                  line to the door at an assumed 18 km/h — and
                                  the stage stepper immediately below says where
                                  the job actually is.
                                */}
                                {[b.rider.vehicle?.trim(), b.rider.vehiclePlate?.trim()]
                                  .filter(Boolean)
                                  .join(' · ') || 'Vehicle pending'}
                              </span>
                            </>
                          ) : (
                            <span className="text-admin-fg-3">
                              Waiting for a rider to accept from the dispatch board
                            </span>
                          )}
                        </Detail>
                      </div>

                      {/* Stage stepper — click any stage to move the order to it. */}
                      <div>
                        <span className="mb-1.5 block text-[11px] font-medium text-admin-fg-3">
                          Stage · step {stageIndex + 1} of {stageSequence.length}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {stageSequence.map((stage, idx) => {
                            const isCurrent = stage === b.status;
                            const isPassed = stageIndex >= idx;
                            return (
                              <button
                                key={stage}
                                type="button"
                                onClick={() => void onUpdateStatus(b.id, stage)}
                                title={
                                  isCurrent
                                    ? `${b.id} is at ${stage}`
                                    : `Move ${b.id} to ${stage} — ${b.name} is told`
                                }
                                className={`h-7 rounded-md border px-2 text-[12px] transition-colors cursor-pointer ${
                                  isCurrent
                                    ? 'border-admin-accent bg-admin-accent text-black font-semibold'
                                    : isPassed
                                      ? 'border-admin-line-strong bg-admin-raised text-admin-fg-2 hover:text-admin-fg'
                                      : 'border-admin-line bg-transparent text-admin-fg-3 hover:border-admin-line-strong hover:text-admin-fg-2'
                                }`}
                              >
                                {stage}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* The hub's half of the middle hand-off. */}
                      {!!b.rider && HUB_LEG.includes(b.rider.jobStatus) && (
                        <div className="max-w-sm">
                          <HandoffCode booking={b} leg="dropoff" surface="admin" />
                        </div>
                      )}

                      {/* What the courier captured at each handover. */}
                      <ProofOfService bookingId={b.id} proof={b.proof} />

                      {/* And what the hub did to it in between. */}
                      <ProductionRecord orderId={b.id} />

                      {/*
                        Who last did something to this order.

                        The trail's commonest question is asked with the order
                        already on screen, and answering it used to mean opening
                        Settings and reading a few hundred undifferentiated rows.
                      */}
                      <OrderTrail events={auditEvents} orderId={b.id} />

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2 border-t border-admin-line pt-3">
                        <Button
                          size="sm"
                          variant={paid ? 'secondary' : 'primary'}
                          onClick={() => void onTogglePayment(b.id)}
                          disabled={paid && !reversible}
                          title={
                            paid
                              ? reversible
                                ? 'Undo the cash collection recorded on this order'
                                : `Paid by ${b.paymentMethod ?? 'gateway'} — that needs a refund, not a reversal`
                              : 'Record that a courier collected this bill in cash'
                          }
                        >
                          {paid ? 'Undo cash collection' : 'Record cash collected'}
                        </Button>

                        <Button size="sm" icon={MapPin} onClick={() => setMapOpenFor(mapOpenFor === b.id ? null : b.id)}>
                          {mapOpenFor === b.id ? 'Hide map' : 'Live map'}
                        </Button>

                        <div className="mx-1 hidden h-4 w-px bg-admin-line sm:block" />

                        <a
                          href={`tel:${b.phone}`}
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-admin-line bg-admin-raised px-2 text-[12px] text-admin-fg transition-colors hover:bg-admin-hover"
                        >
                          <Phone className="h-3.5 w-3.5 text-admin-fg-3" /> Customer
                        </a>

                        {!!riderPhones[b.rider?.id ?? ''] && (
                          <a
                            href={`tel:${riderPhones[b.rider!.id]}`}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-admin-line bg-admin-raised px-2 text-[12px] text-admin-fg transition-colors hover:bg-admin-hover"
                          >
                            <Phone className="h-3.5 w-3.5 text-admin-fg-3" /> Courier
                          </a>
                        )}

                        {/* WhatsApp shortcut hidden for now. */}

                        <Button
                          size="sm"
                          variant="danger"
                          icon={Trash2}
                          className="ml-auto"
                          onClick={() => void onDelete(b.id)}
                        >
                          Delete order
                        </Button>
                      </div>

                      {mapOpenFor === b.id && (
                        <div className="overflow-hidden rounded-xl border border-admin-line">
                          <LiveDispatchMap
                            clientSuburb={b.suburb}
                            clientAddress={b.address}
                            bookingStatus={b.status}
                            bookingId={b.id}
                            clientName={b.name}
                            clientCoords={b.pickupCoords}
                            rider={b.rider}
                          />
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-admin-fg-3">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <div className="text-[12px] leading-relaxed">{children}</div>
    </div>
  );
}

/** Client-side filtering, kept next to the table it filters. */
export function filterBookings(
  bookings: Booking[],
  {
    query,
    status,
    suburb,
    payment,
  }: { query: string; status: string; suburb: string; payment: string },
): Booking[] {
  const q = query.trim().toLowerCase();
  return bookings.filter((b) => {
    const matchesQuery =
      !q ||
      b.name.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      b.phone.toLowerCase().includes(q) ||
      b.email.toLowerCase().includes(q) ||
      b.suburb.toLowerCase().includes(q) ||
      (b.notes?.toLowerCase().includes(q) ?? false);

    const matchesStatus = status === 'all' || b.status === status;
    // Trimmed on both sides, because `useSuburbs` trims what it offers: a
    // padded suburb in the ledger would otherwise never match the option minted
    // from it.
    const matchesSuburb = suburb === 'all' || b.suburb?.trim() === suburb;
    const matchesPayment =
      payment === 'all' ||
      (payment === 'Paid' && b.paymentStatus === 'Paid') ||
      (payment === 'Unpaid' && b.paymentStatus !== 'Paid');

    return matchesQuery && matchesStatus && matchesSuburb && matchesPayment;
  });
}

/**
 * Distinct suburbs present in the ledger, for the filter dropdown.
 *
 * Blanks are dropped rather than offered. A booking can reach the ledger with
 * no suburb on it, and every one of those used to become an unlabelled option
 * in the filter — a row a supervisor can select, that narrows the board to a
 * set they cannot name, and that reads as a rendering fault rather than as
 * missing data. Trimmed as well as filtered, so whitespace is not a suburb.
 */
export function useSuburbs(bookings: Booking[]): string[] {
  return useMemo(
    () =>
      Array.from(new Set(bookings.map((b) => b.suburb?.trim()).filter(Boolean) as string[])).sort(),
    [bookings],
  );
}

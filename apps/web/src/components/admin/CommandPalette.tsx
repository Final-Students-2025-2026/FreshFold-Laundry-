/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One search over the whole desk.
 *
 * Five of the eleven panes are lookup surfaces — somebody is on the phone and
 * the job is to find them, not to browse — and the desk answered that with
 * three search boxes in three different places and none at all on the other
 * five. Worse, the panes do not share a key: a claim names an order, an invoice
 * line names an order, a thread belongs to an order, and getting from one to
 * another meant reading six digits off the screen and retyping them somewhere
 * else.
 *
 * So the id, the phone number, the name and the plate are all typed in the same
 * place, and the answer is a row you press rather than a pane you then have to
 * search again. `OrderRef` is the same idea reached from the other direction:
 * this finds the order you can only describe, that one follows an order already
 * named on screen.
 *
 * ## Why it searches nothing of its own
 *
 * Every collection here is one the shell already holds for its rail badges. The
 * palette adds no request, opens no connection and has no loading state — it is
 * a view over what is on the desk, so it cannot be stale in a way the pane
 * behind it is not. A palette that fetched would be a twelfth freshness model.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bike,
  CornerDownLeft,
  FileText,
  LayoutList,
  Search,
  ShieldQuestion,
  Users,
} from 'lucide-react';
import type { Claim, Invoice, RiderState } from '@freshfold/core';
import type { Booking, UserAccount } from '../../types';
import { useDialog } from '../ui/useDialog';
import { TABS, type TabId } from './nav';
import { formatCedis } from './ui';
import { displayAmount } from '../../services/amount';

interface Result {
  key: string;
  /** Which heading it files under. */
  group: string;
  icon: typeof LayoutList;
  title: string;
  detail: string;
  /** Right-aligned status, when the thing has one. */
  meta?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  bookings: Booking[];
  accounts: UserAccount[];
  riders: RiderState[];
  claims: Claim[];
  invoices: Invoice[];
  onOpenOrder: (orderId: string) => void;
  onGoToTab: (tab: TabId) => void;
  /** Selects a patron in the directory and opens it. */
  onOpenPatron: (email: string) => void;
}

/**
 * How many rows the list will render.
 *
 * A cap rather than a scroller over all four hundred orders: past about a
 * dozen, the answer to "did it find it" is to type another character, not to
 * scroll. Applied per group so one big collection cannot crowd the others out.
 */
const PER_GROUP = 5;

export default function CommandPalette(props: CommandPaletteProps) {
  return (
    <AnimatePresence>{props.open && <Palette {...props} />}</AnimatePresence>
  );
}

function Palette({
  onClose,
  bookings,
  accounts,
  riders,
  claims,
  invoices,
  onOpenOrder,
  onGoToTab,
  onOpenPatron,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const container = useDialog<HTMLDivElement>({
    open: true,
    onClose,
    initialFocus: inputRef,
    lockScroll: false,
  });

  const results = useMemo(
    () => search({ query, bookings, accounts, riders, claims, invoices, onOpenOrder, onGoToTab, onOpenPatron }),
    [query, bookings, accounts, riders, claims, invoices, onOpenOrder, onGoToTab, onOpenPatron],
  );

  // Typing moves the answer, so the highlight goes back to the top with it.
  useEffect(() => setCursor(0), [query]);

  // Keep the highlighted row in view when the keyboard is doing the moving.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const run = (result: Result | undefined) => {
    if (!result) return;
    result.run();
    onClose();
  };

  /**
   * Arrows and Return, taken before `useDialog`'s Tab trap sees them.
   *
   * Bound to the container rather than the input so the list responds even if
   * focus has been tabbed onto a row, and `preventDefault` on the arrows stops
   * the input's own caret movement fighting the cursor.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[cursor]);
    }
  };

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />

      <motion.div
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label="Search the desk"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        initial={{ opacity: 0, y: -8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.99 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className="admin-card relative flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-admin-line-strong bg-admin-panel focus:outline-none"
      >
        <div className="flex items-center gap-3 border-b border-admin-line px-4">
          <Search className="h-4 w-4 shrink-0 text-admin-fg-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Order, name, phone, plate, invoice…"
            aria-label="Search the desk"
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-admin-fg placeholder:text-admin-fg-3 focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-admin-line bg-admin-raised px-1.5 py-0.5 font-mono text-[10px] text-admin-fg-3 sm:block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="admin-scroll max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-admin-fg-3">
              {query.trim()
                ? `Nothing on the desk matches “${query.trim()}”.`
                : 'Type an order number, a name, a phone number or a plate.'}
            </p>
          ) : (
            results.map((result, index) => {
              const heading = result.group === lastGroup ? null : (lastGroup = result.group);
              const Icon = result.icon;
              const active = index === cursor;

              return (
                <div key={result.key}>
                  {heading && (
                    <p className="px-4 pb-1 pt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-admin-fg-3">
                      {heading}
                    </p>
                  )}
                  <button
                    type="button"
                    data-active={active}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => run(result)}
                    className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors ${
                      active ? 'bg-admin-hover' : ''
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${active ? 'text-admin-accent' : 'text-admin-fg-3'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-admin-fg">{result.title}</span>
                      <span className="block truncate text-[11.5px] text-admin-fg-3">
                        {result.detail}
                      </span>
                    </span>
                    {result.meta && (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-admin-fg-2">
                        {result.meta}
                      </span>
                    )}
                    {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-admin-fg-3" />}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Everything that matches, grouped, capped and ordered by how specific the
 * match is.
 *
 * Orders come first on a numeric query and people first on an alphabetic one,
 * because that is what the two kinds of query mean: six digits is somebody
 * reading a reference off a receipt, letters are somebody who only has a name.
 */
function search({
  query,
  bookings,
  accounts,
  riders,
  claims,
  invoices,
  onOpenOrder,
  onGoToTab,
  onOpenPatron,
}: Omit<CommandPaletteProps, 'open' | 'onClose'> & { query: string }): Result[] {
  const q = query.trim().toLowerCase();

  // Empty query: offer the panes rather than the first five of every list.
  if (!q) {
    return TABS.map((tab) => ({
      key: `tab:${tab.id}`,
      group: 'Go to',
      icon: tab.icon,
      title: tab.label,
      detail: tab.blurb,
      run: () => onGoToTab(tab.id),
    }));
  }

  const hit = (...fields: (string | undefined)[]) =>
    fields.some((field) => field?.toLowerCase().includes(q));

  const numeric = /^\d/.test(q);

  const orders: Result[] = bookings
    .filter((b) => hit(b.id, b.name, b.phone, b.email, b.suburb, b.rider?.name))
    .slice(0, PER_GROUP)
    .map((b) => ({
      key: `order:${b.id}`,
      group: 'Orders',
      icon: LayoutList,
      title: `${b.id} · ${b.name}`,
      detail: `${b.suburb} · ${b.status}${b.rider?.name ? ` · ${b.rider.name}` : ''}`,
      meta: formatCedis(displayAmount(b)),
      run: () => onOpenOrder(b.id),
    }));

  const patrons: Result[] = accounts
    .filter((a) => hit(a.name, a.email, a.phone))
    .slice(0, PER_GROUP)
    .map((a) => ({
      key: `patron:${a.email}`,
      group: 'Patrons',
      icon: Users,
      title: a.name || a.email,
      detail: a.email,
      meta: a.points !== undefined ? `${a.points} pts` : undefined,
      run: () => onOpenPatron(a.email),
    }));

  const couriers: Result[] = riders
    .filter((r) => hit(r.name, r.employeeId, r.phone, r.vehicle, r.vehiclePlate))
    .slice(0, PER_GROUP)
    .map((r) => ({
      key: `rider:${r.id}`,
      group: 'Couriers',
      icon: Bike,
      title: r.name || r.employeeId,
      detail: [r.employeeId, r.phone, r.vehiclePlate].filter(Boolean).join(' · '),
      run: () => onGoToTab('roster'),
    }));

  const claimHits: Result[] = claims
    .filter((c) => hit(c.id, c.jobId, c.customerEmail, c.kind))
    .slice(0, PER_GROUP)
    .map((c) => ({
      key: `claim:${c.id}`,
      group: 'Claims',
      icon: ShieldQuestion,
      title: `${c.kind} · ${c.customerEmail}`,
      detail: `Order ${c.jobId}`,
      meta: c.status,
      run: () => onGoToTab('claims'),
    }));

  const invoiceHits: Result[] = invoices
    .filter((i) => hit(i.number, i.billToOrg, i.billToEmail, i.billToName))
    .slice(0, PER_GROUP)
    .map((i) => ({
      key: `invoice:${i.number}`,
      group: 'Invoices',
      icon: FileText,
      title: `${i.number} · ${i.billToOrg || i.billToName || i.billToEmail}`,
      detail: i.status,
      meta: formatCedis(i.total),
      run: () => onGoToTab('billing'),
    }));

  const panes: Result[] = TABS.filter((tab) => hit(tab.label, tab.blurb))
    .slice(0, PER_GROUP)
    .map((tab) => ({
      key: `tab:${tab.id}`,
      group: 'Go to',
      icon: tab.icon,
      title: tab.label,
      detail: tab.blurb,
      run: () => onGoToTab(tab.id),
    }));

  return numeric
    ? [...orders, ...invoiceHits, ...patrons, ...couriers, ...claimHits, ...panes]
    : [...patrons, ...orders, ...couriers, ...claimHits, ...invoiceHits, ...panes];
}

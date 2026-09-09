/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The supervisor desk.
 *
 * Mounted only for a supervisor whose token the server has just verified — see
 * the gate in `App.tsx`. Structurally it is a shell: the collections the panes
 * share, the handlers that mutate them, and a chrome of grouped rail plus top
 * bar. Each pane lives in `./admin/`.
 *
 * ## What this rewrite changed, and why
 *
 * The desk worked and read as ten separate applications sharing a sidebar.
 *
 * **One freshness model.** There were six: bookings from a mirror nothing ever
 * pulled, accounts re-read from `localStorage` on every booking change,
 * messages on each open, the audit trail only while Settings was mounted, rider
 * phones exactly once, and four panes each with a private `load()`. Nothing
 * polled, nothing said how old it was, and the button titled *Reload the ledger
 * from the server* called a function that read the local patron mirror. Every
 * collection is a `DeskResource` now — held, stamped, refreshed through one code
 * path — and the Floor collections poll while the tab is visible.
 *
 * **One integrity model.** The rule was already right and applied unevenly: if a
 * customer can see it, wait for the server. Payments, refunds, points, blocks
 * and hub confirmations all did. Stage changes and order deletes did not, and
 * both of those reach the customer — a stage change *is* the message they get.
 * Both go through the server now, and `store.applyBooking` lands the response
 * without echoing it back as a queued patch.
 *
 * **One notification system.** A single `successNotif` string on a 4s timeout
 * that never cleared the previous timer, so two actions inside four seconds
 * truncated each other; failures came through the same pill, which hardcoded a
 * green tick. Errors rendered as success. The desk mounts the site's
 * `ToastProvider` in its own skin — queued, tone-aware — and the four
 * `window.confirm` calls are a real dialog with a named verb on its button.
 *
 * **The badges mean one thing.** "This needs you", nothing else. See `nav.ts`.
 *
 * **The summary belongs to the pane.** Four metric cards used to render above
 * every pane, including the seven they described nothing on. See `PaneHeader`.
 *
 * On the palette: five of eleven panes are lookup surfaces and the desk had
 * three search boxes between them. `⌘K` searches everything the shell holds,
 * and `OrderRef` makes the id a place you can go — a claim, an invoice line, an
 * audit entry and a thread all name an order, and every one of them was a dead
 * string.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  LogOut,
  Menu,
  Search,
  Shield,
  X,
} from 'lucide-react';
import {
  ApiError,
  BOOKING_STAGE_SEQUENCE,
  isRemedyOwed,
  TimeoutError,
  type AuditEvent,
  type Claim,
  type Invoice,
  type Message,
  type Order,
  type RiderState,
} from '@freshfold/core';
import type { Booking, UserAccount } from '../types';
import * as store from '../services/store';
import { displayAmount } from '../services/amount';
import { ToastProvider, useToast } from './ui/Toast';
import RosterPanel from './admin/RosterPanel';
import PipelinePanel, { filterBookings, useSuburbs } from './admin/PipelinePanel';
import HubPanel from './admin/HubPanel';
import ClaimsPanel from './admin/ClaimsPanel';
import OffersPanel from './admin/OffersPanel';
import BillingPanel from './admin/BillingPanel';
import MessagesPanel, { inboundThreadCount } from './admin/MessagesPanel';
import PatronsPanel from './admin/PatronsPanel';
import FinancialsPanel from './admin/FinancialsPanel';
import SettingsPanel from './admin/SettingsPanel';
import AuditPanel from './admin/AuditPanel';
import PaneHeader, { ResourceBanner } from './admin/PaneHeader';
import CommandPalette from './admin/CommandPalette';
import { ConfirmProvider, useConfirm } from './admin/Confirm';
import { OrderRefProvider } from './admin/OrderRef';
import { useDeskMirror, useDeskResource } from './admin/useDeskResource';
import { NAV, groupOf, tabSpec, type TabId } from './admin/nav';
import { HUB_LEG } from './admin/stages';
import { Badge, Button, formatCedis } from './admin/ui';

interface AdminDashboardProps {
  /** Closes the desk and returns to the site. The session survives. */
  onClose: () => void;
  /** Revokes the desk token and drops back to the login. */
  onSignOut: () => void;
  activeBookings: Booking[];
  onUpdateBookings: (bookings: Booking[]) => void;
}

/**
 * The providers, and then the desk.
 *
 * Split because the desk's own handlers call `useToast` and `useConfirm`, which
 * have to resolve to providers above them. The toast provider is nested inside
 * the site's: `useToast` finds the nearer one, so `RosterPanel` — which has
 * called it since before this rewrite — picks up the desk skin without being
 * touched.
 */
export default function AdminDashboard(props: AdminDashboardProps) {
  return (
    <ToastProvider skin="desk">
      <ConfirmProvider>
        <Desk {...props} />
      </ConfirmProvider>
    </ToastProvider>
  );
}

function Desk({ onClose, onSignOut, activeBookings, onUpdateBookings }: AdminDashboardProps) {
  const supervisor = useMemo(() => store.readAdminSupervisor()?.name ?? 'Supervisor desk', []);
  const toast = useToast();
  const confirm = useConfirm();

  const [activeTab, setActiveTab] = useState<TabId>('pipeline');
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /**
   * The order the desk has been asked to show, from a reference somewhere else.
   *
   * Handed to `PipelinePanel`, which expands that row and hands it back once it
   * has. Held here because following a reference also has to change pane and
   * clear the filters that might be hiding the row — neither of which the pane
   * can do for itself.
   */
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const clearFocusOrder = useCallback(() => setFocusOrderId(null), []);

  // Pipeline filters. The one piece of pane state that genuinely belongs to the
  // shell: `openOrder` has to be able to clear it from outside the pane.
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [suburbFilter, setSuburbFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');

  /** Which patron the directory should open on, when arriving from the palette. */
  const [focusPatronEmail, setFocusPatronEmail] = useState<string | null>(null);
  const clearFocusPatron = useCallback(() => setFocusPatronEmail(null), []);

  // -------------------------------------------------------------------------
  // Collections
  // -------------------------------------------------------------------------

  /**
   * Bookings, patrons and threads.
   *
   * These three live in the offline mirror and come back together in one
   * `store.pull()`, which `App`'s `startSync` already runs every five seconds
   * for the whole site — so this reports that sync rather than adding a second
   * one. `activeBookings` arrives as a prop because `App` owns the ledger for
   * the portal and the live map too; accounts and messages are read off the
   * mirror here, on the same subscription that feeds it.
   */
  const mirror = useDeskMirror();

  const [accounts, setAccounts] = useState<UserAccount[]>(() => store.readAccounts());
  const [messages, setMessages] = useState<Message[]>(() => store.readMessages());

  useEffect(() => {
    const sync = () => {
      setAccounts(store.readAccounts());
      setMessages(store.readMessages());
    };
    sync();
    return store.subscribe(sync);
  }, []);

  /**
   * The hub board.
   *
   * An `Order` carries the bags, the bag count and the exact dispatch status
   * that a `Booking` does not, so the Hub pane needs it — and so does the rail,
   * which cannot say how many loads are waiting to be confirmed without it.
   * Polled with the Floor group.
   */
  const readOrders = useCallback((token: string) => store.api.listOrders(token), []);
  const orders = useDeskResource<Order[]>(readOrders, [], { pollSeconds: 45 });

  const readClaims = useCallback(
    (token: string) => store.api.listClaims(token, { all: true }),
    [],
  );
  const claims = useDeskResource<Claim[]>(readClaims, []);

  const readInvoices = useCallback((token: string) => store.api.listInvoices(token), []);
  const invoices = useDeskResource<Invoice[]>(readInvoices, []);

  /**
   * The roster.
   *
   * Read here rather than in the Couriers pane because two other things need
   * it: the Pipeline's "call the courier" control, and the palette's plate
   * search. The jobs themselves carry `rider` — name, vehicle, plate, dispatch
   * status — but deliberately not a phone number: that object is sent to the
   * customer too, and a courier's personal number is not the customer's to have.
   */
  const readRiders = useCallback((token: string) => store.api.listRiders(token), []);
  const riders = useDeskResource<RiderState[]>(readRiders, []);

  const riderPhones = useMemo(
    () => Object.fromEntries(riders.data.map((rider) => [rider.id, rider.phone])),
    [riders.data],
  );

  /**
   * The audit trail.
   *
   * The one collection that is not always on. It is a few hundred rows read by
   * exactly two screens — its own pane, and the recent-activity list inside a
   * Pipeline expansion — so it is fetched while one of those is open and parked
   * otherwise.
   */
  const readAudit = useCallback((token: string) => store.api.listAuditEvents(token, 200), []);
  const audit = useDeskResource<AuditEvent[]>(readAudit, [], {
    enabled: activeTab === 'audit' || activeTab === 'pipeline',
  });

  /**
   * Brings back everything an action could have changed.
   *
   * Every handler below writes through the server, and the server writes an
   * audit entry in the same transaction — so the trail is stale the moment
   * anything succeeds. The mirror is refreshed too, because a settlement moves
   * a Pipeline row and a Settlement row at once.
   */
  const afterWrite = useCallback(() => {
    mirror.refresh();
    audit.refresh();
  }, [mirror, audit]);

  // -------------------------------------------------------------------------
  // Derived: what needs somebody
  // -------------------------------------------------------------------------

  const unpaid = useMemo(
    () => activeBookings.filter((b) => b.paymentStatus !== 'Paid'),
    [activeBookings],
  );

  /**
   * Live orders nobody is carrying.
   *
   * The rail's Pipeline figure, and the one thing on that pane that is actually
   * a supervisor's to do — it used to show the total number of orders, which is
   * inventory and needs nothing from anyone.
   */
  const unassigned = useMemo(
    () =>
      activeBookings.filter(
        (b) => b.status !== 'Delivered' && b.status !== 'Cancelled' && !b.rider,
      ),
    [activeBookings],
  );

  const awaitingHub = useMemo(
    () => orders.data.filter((o) => o.status === 'dropped_off' || o.status === 'processing'),
    [orders.data],
  );

  /**
   * The loads riding in, for the top of the Hub pane.
   *
   * Separate from `awaitingHub` because it is a different kind of work: nothing
   * here is confirmed from the desk. The pane shows these so that the person
   * holding the drop-off code is looking at the screen it is on when the
   * courier walks up.
   */
  const inboundHub = useMemo(
    () => orders.data.filter((o) => HUB_LEG.includes(o.status)),
    [orders.data],
  );

  /**
   * A courier who has stopped riding is work; one still on the road is not.
   *
   * Only `arrived_at_laundry` counts towards the rail's badge — the badge rule
   * is "this needs you", and somebody standing at the counter waiting to be
   * given four digits needs you more immediately than anything else on the
   * pane. The rest of the inbound leg would be inventory.
   */
  const atHubDesk = useMemo(
    () => inboundHub.filter((o) => o.status === 'arrived_at_laundry').length,
    [inboundHub],
  );

  const openClaims = useMemo(
    () => claims.data.filter((c) => c.status === 'open' || isRemedyOwed(c)),
    [claims.data],
  );

  const unpaidInvoices = useMemo(
    () => invoices.data.filter((i) => i.status === 'issued'),
    [invoices.data],
  );

  const needsAttention: Partial<Record<TabId, number>> = {
    pipeline: unassigned.length,
    hub: awaitingHub.length + atHubDesk,
    inbox: inboundThreadCount(messages),
    claims: openClaims.length,
    financials: unpaid.length,
    billing: unpaidInvoices.length,
  };

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const goToTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setNavOpen(false);
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setSuburbFilter('all');
    setPaymentFilter('all');
  }, []);

  /**
   * Follow a reference to an order.
   *
   * Clears the filters first, deliberately. Arriving on a pane filtered to
   * "Delivered, Ayeduase, unpaid" and being told the order is not there is
   * indistinguishable from the order not existing, and the reference was
   * followed precisely because somebody wanted to see *that* row.
   */
  const openOrder = useCallback(
    (orderId: string) => {
      clearFilters();
      setActiveTab('pipeline');
      setNavOpen(false);
      setFocusOrderId(orderId);

      if (!activeBookings.some((b) => b.id === orderId)) {
        toast(
          `Order ${orderId} is not on this board. It may have been delivered and archived.`,
          'note',
        );
      }
    },
    [activeBookings, clearFilters, toast],
  );

  const openPatron = useCallback((email: string) => {
    setActiveTab('patrons');
    setNavOpen(false);
    setFocusPatronEmail(email);
  }, []);

  /** ⌘K anywhere on the desk, and Escape closes the drawer before anything else. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === 'Escape' && navOpen) setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /**
   * Every failure on the desk reports the same way: what failed, and that
   * nothing moved.
   *
   * The test is not `instanceof Error`, which is what it used to be. Everything
   * thrown in a browser passes that — including the `DOMException` an aborted
   * `fetch` rejects with, whose message in Chrome is `signal is aborted without
   * reason`. That went straight into a toast in front of a supervisor, who has
   * no way to read it as "the request took more than eight seconds".
   *
   * Only the two errors we build ourselves carry a sentence meant for a person:
   * `ApiError`, which is either the server's own `error` field or the wording
   * for a gateway reply, and `TimeoutError`. Everything else gets the caller's
   * fallback, which is written for the specific thing that failed and is better
   * than any platform string.
   */
  const reportFailure = useCallback(
    (e: unknown, fallback: string) => {
      const stated = e instanceof ApiError || e instanceof TimeoutError;
      toast(stated ? e.message : fallback, 'bad');
    },
    [toast],
  );

  /**
   * Moves an order to a stage.
   *
   * Server-first, and confirmed when it is not the obvious next step. This used
   * to write the local mirror and let the sync queue carry it — the one
   * customer-visible write on the desk that did not wait for an answer, and the
   * only one whose failure path was `console.error`. A stage change *is* the
   * message the customer receives, so a row that moved because a request was
   * sent is exactly the bug the hub timer was deleted for.
   *
   * The confirmation is not on every move. Advancing one step is the ordinary
   * thing this control is for and asking each time trains people to click
   * through the dialog; going backwards or skipping ahead is either a
   * correction or a mistake, and both are worth a sentence.
   */
  const handleUpdateStatus = useCallback(
    async (bookingId: string, newStatus: Booking['status']) => {
      const target = activeBookings.find((b) => b.id === bookingId);
      if (!target || target.status === newStatus) return;

      const from = BOOKING_STAGE_SEQUENCE.indexOf(target.status);
      const to = BOOKING_STAGE_SEQUENCE.indexOf(newStatus);
      const isNextStep = to === from + 1;

      if (!isNextStep) {
        const backwards = to < from;
        const ok = await confirm({
          title: backwards
            ? `Move ${bookingId} back to ${newStatus}?`
            : `Skip ${bookingId} ahead to ${newStatus}?`,
          body: backwards
            ? `It is at ${target.status}. ${target.name} has already been told about every stage up to that point, and will be told about this one too.`
            : `It is at ${target.status}, and ${newStatus} is ${to - from} stages ahead. ${target.name} will be told their laundry has reached it.`,
          confirmLabel: backwards ? `Move back to ${newStatus}` : `Skip to ${newStatus}`,
        });
        if (!ok) return;
      }

      const token = store.readAdminToken();
      if (!token) {
        toast('This desk is not signed in, so nothing was changed.', 'bad');
        return;
      }

      try {
        const updated = await store.api.updateBooking(bookingId, { status: newStatus }, { token });
        store.applyBooking(updated);
        toast(`${bookingId} moved to ${newStatus}`);
        afterWrite();
      } catch (e) {
        reportFailure(e, `${bookingId} could not be moved. It is still at ${target.status}.`);
      }
    },
    [activeBookings, confirm, toast, afterWrite, reportFailure],
  );

  /**
   * Returns a settled bill to the customer's wallet.
   *
   * Confirmed, and deliberately: this is the one desk action that moves money
   * *outward*, it is idempotent rather than reversible — a refund cannot be
   * un-refunded from here — and the amount is worth reading back before it goes.
   * The other payment controls are recoverable in a click.
   */
  const handleRefundBooking = useCallback(
    async (bookingId: string) => {
      const target = activeBookings.find((b) => b.id === bookingId);
      if (!target) return;

      const owed = formatCedis(displayAmount(target));

      const ok = await confirm({
        title: `Refund ${owed} to ${target.name}?`,
        body: `It goes back to their FreshFold wallet and order ${bookingId} is marked Refunded. This cannot be undone from the desk.`,
        confirmLabel: `Refund ${owed}`,
      });
      if (!ok) return;

      try {
        const refunded = await store.refundBooking(bookingId);
        onUpdateBookings(activeBookings.map((b) => (b.id === bookingId ? refunded : b)));
        toast(`${bookingId} refunded — ${owed} returned to the patron's wallet`);
        afterWrite();
      } catch (e) {
        reportFailure(e, `Could not reach the server. ${bookingId} is unchanged.`);
      }
    },
    [activeBookings, confirm, onUpdateBookings, toast, afterWrite, reportFailure],
  );

  /**
   * Records that a courier was handed cash for an order, or takes that record
   * back.
   *
   * Cash is the one payment a supervisor can actually attest to, so it is the
   * one this button records: `POST /bookings/:id/payment` with `Cash`, which
   * writes a statement row naming whoever recorded it and leaves
   * `transactionRef` empty, because nothing outside this building confirmed
   * anything. The reversal is cash-only for the same reason — money that moved
   * through Paystack or a wallet needs a refund, not a flag flip, and the server
   * will refuse.
   */
  const handleTogglePaymentStatus = useCallback(
    async (bookingId: string) => {
      const target = activeBookings.find((b) => b.id === bookingId);
      if (!target) return;

      const wasPaid = target.paymentStatus === 'Paid';

      try {
        const settled = wasPaid
          ? await store.reverseCashPayment(bookingId)
          : await store.payForBooking(bookingId, 'Cash');

        onUpdateBookings(activeBookings.map((b) => (b.id === bookingId ? settled : b)));

        toast(
          wasPaid
            ? `${bookingId} back to pay on pickup — cash collection reversed`
            : `${bookingId} settled — ${formatCedis(displayAmount(settled))} collected in cash`,
        );

        afterWrite();
      } catch (e) {
        reportFailure(e, `Could not reach the server. ${bookingId} is unchanged.`);
      }
    },
    [activeBookings, onUpdateBookings, toast, afterWrite, reportFailure],
  );

  /**
   * Removes an order from the ledger.
   *
   * Server-first, for the same reason as the stage change: it used to drop the
   * row locally and enqueue a delete, so a rejected delete left the desk showing
   * a ledger the server did not have — and swallowed the reason to `console`.
   */
  const handleDeleteBooking = useCallback(
    async (bookingId: string) => {
      const target = activeBookings.find((b) => b.id === bookingId);

      const ok = await confirm({
        title: `Delete order ${bookingId}?`,
        body: target
          ? `${target.name}'s ${target.suburb} collection, ${formatCedis(displayAmount(target))}. It leaves the ledger entirely — this is not a cancellation, and it cannot be undone.`
          : 'It leaves the ledger entirely. This cannot be undone.',
        confirmLabel: 'Delete order',
      });
      if (!ok) return;

      const token = store.readAdminToken();
      if (!token) {
        toast('This desk is not signed in, so nothing was deleted.', 'bad');
        return;
      }

      try {
        await store.api.deleteBooking(bookingId, { token });
        store.forgetBooking(bookingId);
        toast(`${bookingId} removed from the ledger`);
        afterWrite();
      } catch (e) {
        reportFailure(e, `${bookingId} could not be deleted. It is still on the board.`);
      }
    },
    [activeBookings, confirm, toast, afterWrite, reportFailure],
  );

  /**
   * Awards or deducts care points.
   *
   * Sent as a delta and applied server-side on a locked row. The desk used to
   * work the new total out from its own copy and PUT it back, which meant two
   * supervisors adjusting at once lost one of the two grants.
   */
  const handleAdjustPoints = useCallback(
    async (email: string, delta: number, reason: string) => {
      const patron = accounts.find((acc) => acc.email.toLowerCase() === email.toLowerCase());
      const who = patron?.name || email;

      try {
        const updated = await store.adjustPatronPoints(email, delta, reason);
        toast(
          `${delta > 0 ? '+' : '−'}${Math.abs(delta)} pts for ${who} — now ${updated.points ?? 0}`,
        );
        afterWrite();
      } catch (e) {
        reportFailure(e, 'Could not adjust points. Try again in a moment.');
      }
    },
    [accounts, toast, afterWrite, reportFailure],
  );

  /**
   * Suspends a patron, or lifts it.
   *
   * Blocking asks for a reason and is reversible from the same button, so it
   * needs no dialog. Restoring does: it is the half that puts somebody back in
   * front of couriers, and the reason they were blocked is worth reading first.
   */
  const handleSetPatronBlocked = useCallback(
    async (email: string, blocked: boolean, reason: string) => {
      const patron = accounts.find((acc) => acc.email.toLowerCase() === email.toLowerCase());
      const who = patron?.name || email;

      if (!blocked) {
        const ok = await confirm({
          title: `Restore access for ${who}?`,
          body: patron?.blockedReason
            ? `They were blocked for: “${patron.blockedReason}”. They will be able to book again immediately.`
            : 'They will be able to book again immediately.',
          confirmLabel: 'Restore access',
          tone: 'primary',
        });
        if (!ok) return;
      }

      try {
        await store.setAccountBlocked(email, blocked, reason);
        toast(blocked ? `${who} blocked` : `${who} reinstated`);
        afterWrite();
      } catch (e) {
        reportFailure(e, `${who} is unchanged — the server did not accept that.`);
      }
    },
    [accounts, confirm, toast, afterWrite, reportFailure],
  );

  /** Erases the account. Their orders stay in the ledger; the identity goes. */
  const handleDeletePatron = useCallback(
    async (email: string) => {
      const patron = accounts.find((acc) => acc.email.toLowerCase() === email.toLowerCase());
      const who = patron?.name || email;

      const ok = await confirm({
        title: `Delete ${who} from the system?`,
        body: `Their past orders stay in the ledger, but the account, its wallet${
          patron?.points ? ` and its ${patron.points} points` : ' and its points'
        } are gone. This cannot be undone.`,
        confirmLabel: 'Delete patron',
      });
      if (!ok) return;

      try {
        await store.deleteAccount(email);
        if (focusPatronEmail?.toLowerCase() === email.toLowerCase()) setFocusPatronEmail(null);
        toast(`${who} deleted`);
        afterWrite();
      } catch (e) {
        reportFailure(e, `${who} was not deleted — the server did not accept that.`);
      }
    },
    [accounts, confirm, focusPatronEmail, toast, afterWrite, reportFailure],
  );

  // -------------------------------------------------------------------------
  // Pipeline filtering
  // -------------------------------------------------------------------------

  const suburbs = useSuburbs(activeBookings);
  const filteredBookings = useMemo(
    () =>
      filterBookings(activeBookings, {
        query: searchQuery,
        status: statusFilter,
        suburb: suburbFilter,
        payment: paymentFilter,
      }),
    [activeBookings, searchQuery, statusFilter, suburbFilter, paymentFilter],
  );

  const filtersActive =
    searchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    suburbFilter !== 'all' ||
    paymentFilter !== 'all';

  // `displayAmount`, not `amount || 50`. The old fallback was a different
  // invented number on every pane, and `||` counted a genuinely free order — a
  // complimentary pickup is ₵0 — as a booking with no price.
  const collected = activeBookings
    .filter((b) => b.paymentStatus === 'Paid')
    .reduce((sum, b) => sum + displayAmount(b), 0);
  const outstanding = unpaid.reduce((sum, b) => sum + displayAmount(b), 0);
  const inTransit = activeBookings.filter(
    (b) => b.status !== 'Delivered' && b.status !== 'Cancelled' && b.status !== 'Scheduled',
  ).length;

  const tab = tabSpec(activeTab);
  const group = groupOf(activeTab);

  // -------------------------------------------------------------------------
  // Chrome
  // -------------------------------------------------------------------------

  /**
   * The rail.
   *
   * The selected row is a pill cut out of the rail in the page colour, so the
   * rail and the content area join into one shape — `.admin-rail-active` in
   * `index.css` draws the two inverted corners that make that join read.
   */
  const navList = (
    <nav className="flex flex-col gap-4 py-3 pl-3" aria-label="Desk sections">
      {NAV.map((navGroup) => (
        <div key={navGroup.id}>
          <p className="px-4 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-admin-fg-3">
            {navGroup.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {navGroup.tabs.map((navTab) => {
              const Icon = navTab.icon;
              const isActive = activeTab === navTab.id;
              const count = needsAttention[navTab.id] ?? 0;

              return (
                <button
                  key={navTab.id}
                  type="button"
                  onClick={() => goToTab(navTab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  title={navTab.blurb}
                  className={`relative flex h-10 cursor-pointer items-center gap-3 rounded-l-2xl pl-4 pr-3 text-[13px] transition-colors ${
                    isActive
                      ? 'admin-rail-active bg-admin-bg font-semibold text-admin-fg'
                      : 'text-admin-fg-2 hover:bg-white/[0.04] hover:text-admin-fg'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${isActive ? 'text-admin-accent' : 'text-admin-fg-3'}`}
                  />
                  <span className="flex-1 text-left">{navTab.label}</span>

                  {/*
                    One figure, one meaning: something here is waiting on a
                    person. Zero renders nothing, so a quiet rail is quiet.
                  */}
                  {count > 0 && (
                    <span
                      title={`${count} needing attention`}
                      className="rounded-full bg-admin-warn/15 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-admin-warn"
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <OrderRefProvider onOpenOrder={openOrder}>
      <div className="below-banner fixed inset-0 z-[60] flex bg-admin-rail font-sans text-admin-fg antialiased">
        <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto lg:flex">
          <DeskIdentity supervisor={supervisor} />
          {navList}
          <div className="mt-auto p-3">
            <SignOut onSignOut={onSignOut} />
          </div>
        </aside>

        <AnimatePresence>
          {navOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setNavOpen(false)}
                className="fixed inset-0 z-40 bg-black/70 lg:hidden"
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'tween', duration: 0.18 }}
                className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto bg-admin-rail shadow-2xl lg:hidden"
              >
                <DeskIdentity supervisor={supervisor} onDismiss={() => setNavOpen(false)} />
                {navList}
                <div className="mt-auto p-3">
                  <SignOut onSignOut={onSignOut} />
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Content area — a rounded panel laid over the rail, so the rail's
            active pill runs into it. */}
        <div className="admin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto bg-admin-bg lg:rounded-l-3xl">
          <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 bg-admin-bg/95 px-5 py-4 backdrop-blur lg:rounded-tl-3xl">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              className="-ml-1 cursor-pointer rounded-full p-2 text-admin-fg-2 hover:bg-white/[0.06] hover:text-admin-fg lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[20px] font-semibold leading-tight">{tab.label}</h1>
              <p className="mt-0.5 truncate text-[12px] text-admin-fg-3">
                <span className="text-admin-accent">{group.label}</span> · {tab.blurb}
              </p>
            </div>

            {/*
              The palette's trigger. A button rather than a hint, because the
              shortcut is undiscoverable and this is the only search on the desk
              that reaches every pane.
            */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 cursor-pointer items-center gap-2 rounded-full border border-admin-line bg-admin-raised px-3.5 text-[13px] text-admin-fg-3 transition-colors hover:border-admin-line-strong hover:text-admin-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/60 sm:flex"
            >
              <Search className="h-4 w-4" />
              <span>Search the desk</span>
              <Badge tone="neutral" mono className="ml-1">
                ⌘K
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search the desk"
              className="cursor-pointer rounded-full p-2 text-admin-fg-2 hover:bg-white/[0.06] hover:text-admin-fg sm:hidden"
            >
              <Search className="h-4 w-4" />
            </button>

            <Button icon={X} onClick={onClose} title="Close the desk — the session stays open">
              <span className="hidden sm:inline">Close</span>
            </Button>

            <div className="ml-1 flex items-center gap-2.5 border-l border-admin-line pl-3">
              <div className="hidden text-right sm:block">
                <span className="block max-w-40 truncate text-[13px] font-semibold leading-tight">
                  {supervisor}
                </span>
                <span className="block text-[11px] leading-tight text-admin-fg-3">
                  Kumasi operations
                </span>
              </div>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-admin-accent/30 bg-admin-accent/10 text-[13px] font-semibold text-admin-accent">
                {initialsOf(supervisor)}
              </span>
            </div>
          </header>

          <main className="flex-1 space-y-4 px-5 pb-6">
            {activeTab === 'pipeline' && (
              <>
                <PaneHeader
                  stats={[
                    { label: 'Live orders', value: activeBookings.length, hint: 'on the board' },
                    { label: 'In transit', value: inTransit, tone: 'info', hint: 'being worked' },
                    {
                      label: 'Unassigned',
                      value: unassigned.length,
                      tone: unassigned.length > 0 ? 'warn' : 'ok',
                      hint: 'no courier',
                    },
                    {
                      label: 'Showing',
                      value: filteredBookings.length,
                      tone: filtersActive ? 'accent' : 'neutral',
                    },
                  ]}
                  freshness={mirror}
                  search={{
                    value: searchQuery,
                    onChange: setSearchQuery,
                    placeholder: 'Order, name, phone or suburb…',
                  }}
                  filters={[
                    {
                      label: 'Filter by stage',
                      value: statusFilter,
                      onChange: setStatusFilter,
                      options: [
                        { value: 'all', label: 'All stages' },
                        ...BOOKING_STAGE_SEQUENCE.map((s) => ({ value: s, label: s })),
                      ],
                    },
                    {
                      label: 'Filter by suburb',
                      value: suburbFilter,
                      onChange: setSuburbFilter,
                      options: [
                        { value: 'all', label: 'All suburbs' },
                        ...suburbs.map((s) => ({ value: s, label: s })),
                      ],
                    },
                    {
                      label: 'Filter by payment',
                      value: paymentFilter,
                      onChange: setPaymentFilter,
                      options: [
                        { value: 'all', label: 'Any payment' },
                        { value: 'Paid', label: 'Paid' },
                        { value: 'Unpaid', label: 'Unpaid / COD' },
                      ],
                    },
                  ]}
                  filtersActive={filtersActive}
                  onClearFilters={clearFilters}
                  banner={<ResourceBanner error={mirror.error} refresh={mirror.refresh} />}
                />

                <PipelinePanel
                  bookings={filteredBookings}
                  totalCount={activeBookings.length}
                  stageSequence={BOOKING_STAGE_SEQUENCE}
                  riderPhones={riderPhones}
                  auditEvents={audit.data}
                  focusOrderId={focusOrderId}
                  onFocusHandled={clearFocusOrder}
                  onUpdateStatus={handleUpdateStatus}
                  onTogglePayment={handleTogglePaymentStatus}
                  onDelete={handleDeleteBooking}
                />
              </>
            )}

            {activeTab === 'hub' && (
              <HubPanel
                orders={orders}
                awaiting={awaitingHub}
                inbound={inboundHub}
                bookings={activeBookings}
                onConfirmed={(message) => {
                  toast(message);
                  orders.refresh();
                  afterWrite();
                }}
                onFailed={(message) => toast(message, 'bad')}
              />
            )}

            {activeTab === 'roster' && <RosterPanel riders={riders} />}

            {activeTab === 'inbox' && (
              <MessagesPanel
                messages={messages}
                freshness={mirror}
                bookings={activeBookings}
                onReplied={(message) => {
                  toast(message);
                  // The pane keeps no copy of what it sent, so the thread it
                  // wrote into comes back from the server with the desk's line.
                  mirror.refresh();
                }}
                onFailed={(message) => toast(message, 'bad')}
              />
            )}

            {activeTab === 'claims' && (
              <ClaimsPanel
                claims={claims}
                onHandled={(message) => {
                  toast(message);
                  claims.refresh();
                  afterWrite();
                }}
                onFailed={(message) => toast(message, 'bad')}
              />
            )}

            {activeTab === 'patrons' && (
              <PatronsPanel
                accounts={accounts}
                freshness={mirror}
                focusEmail={focusPatronEmail}
                onFocusHandled={clearFocusPatron}
                onAdjust={handleAdjustPoints}
                onSetBlocked={handleSetPatronBlocked}
                onDelete={handleDeletePatron}
              />
            )}

            {activeTab === 'financials' && (
              <FinancialsPanel
                bookings={activeBookings}
                freshness={mirror}
                collected={collected}
                outstanding={outstanding}
                onTogglePayment={handleTogglePaymentStatus}
                onRefund={handleRefundBooking}
              />
            )}

            {activeTab === 'billing' && (
              <BillingPanel
                invoices={invoices}
                onSaved={(message) => {
                  toast(message);
                  invoices.refresh();
                  afterWrite();
                }}
                onFailed={(message) => toast(message, 'bad')}
              />
            )}

            {activeTab === 'offers' && (
              <OffersPanel
                onSaved={(message) => {
                  toast(message);
                  audit.refresh();
                }}
                onFailed={(message) => toast(message, 'bad')}
              />
            )}

            {activeTab === 'audit' && <AuditPanel trail={audit} />}

            {activeTab === 'settings' && (
              <SettingsPanel supervisor={supervisor} onSignOut={onSignOut} />
            )}
          </main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          bookings={activeBookings}
          accounts={accounts}
          riders={riders.data}
          claims={claims.data}
          invoices={invoices.data}
          onOpenOrder={openOrder}
          onGoToTab={goToTab}
          onOpenPatron={openPatron}
        />
      </div>
    </OrderRefProvider>
  );
}

function SignOut({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      title="Revoke this desk token and return to the login"
      className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-full px-4 text-[13px] text-admin-fg-2 transition-colors hover:bg-admin-danger/10 hover:text-admin-danger"
    >
      <LogOut className="h-4 w-4 shrink-0" />
      Sign out
    </button>
  );
}

/** `Ama Boateng` → `AB`. Falls back to one letter, never to an empty circle. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Wordmark and who is signed in, at the top of the rail. */
function DeskIdentity({ supervisor, onDismiss }: { supervisor: string; onDismiss?: () => void }) {
  return (
    <div className="flex h-[72px] shrink-0 items-center gap-3 px-5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-admin-accent">
        <Shield className="h-4 w-4 text-black" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight">FreshFold</span>
        <span className="block truncate text-[11px] leading-tight text-admin-fg-3">
          {supervisor}
        </span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close navigation"
          className="cursor-pointer rounded-full p-1 text-admin-fg-3 hover:text-admin-fg"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

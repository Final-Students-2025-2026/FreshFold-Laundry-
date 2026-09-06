/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sweep that turns a standing order into a booking.
 *
 * Modelled on `./hub` deliberately, because it has the same three hazards and
 * they have already been solved once here: it runs on a timer, it may be running
 * in more than one process, and what it produces is visible to a customer. The
 * differences are in how much worse a mistake is. A hub sweep that fires twice
 * advances a status that was going to advance anyway; a recurring sweep that
 * fires twice puts two collections on one doorstep and bills for both.
 *
 * So the decision about *whether* a standing order is due lives in
 * `@freshfold/core`'s `nextDue` — pure, clocked by an argument, and covered by
 * the check suite — and this file does only the parts that need a database:
 * reading the rows, creating the booking, and moving the marker.
 *
 * The marker is what makes it safe to run twice. `markBooked` updates the row
 * only if `last_booked_for` is still what it was when this pass read it, so the
 * second process to arrive matches no rows and skips. Same mechanism `ripen`
 * uses in `./hub`, and for the same reason.
 *
 * Unlike the hub cycle, this one runs in production by default. A timer that
 * advances a stage nobody confirmed is a machine making a claim on the laundry's
 * behalf; a timer that books a pickup the customer has explicitly and repeatedly
 * asked for is the feature working. `RECURRING_SWEEP=off` stops it.
 */

import dotenv from 'dotenv';
import {
  bookingItems,
  bookingToJob,
  defaultHub,
  describeItems,
  hubCoords,
  hubForPickup,
  newJobId,
  nextDue,
  pickupPinFor,
  quoteBooking,
  ratesFromEnv,
  rescheduledDelivery,
  type Booking,
  type RecurringPickup,
} from '@freshfold/core';
import { recordAudit, SYSTEM_ACTOR } from './audit';
import { settleAccountByEmail } from './membership';
import { store } from './store';

dotenv.config();

/** How often the sweep looks. Hourly: a standing order is a weekly event. */
const TICK_MS = 60 * 60 * 1000;

/** What one pass did, for the log and for the on-demand route. */
export interface SweepResult {
  considered: number;
  booked: { id: string; bookingId: string; date: string }[];
  failed: { id: string; error: string }[];
}

/**
 * Books one standing order for one date.
 *
 * The whole thing is one transaction, and the marker moves inside it. A booking
 * that commits without the marker moving would be booked again on the next pass
 * an hour later — the customer's doorstep is the thing that fails, so this is
 * the transaction boundary that matters most in the file.
 */
async function book(
  pickup: RecurringPickup,
  date: string
): Promise<{ ok: true; bookingId: string } | { ok: false; error: string }> {
  try {
    /**
     * The membership, read before the transaction like `POST /bookings` does.
     *
     * A standing order is the *reason* somebody holds a plan, so this is the one
     * booking path where the plan discount and the included pickup matter most —
     * a "weekly pickups" plan whose weekly pickups were quoted at the full rate
     * would be the feature getting its own headline promise wrong.
     */
    const member = await settleAccountByEmail(pickup.customerEmail);

    const account = await store.accounts.find(pickup.customerEmail);
    if (!account) return { ok: false, error: 'no account behind this standing order' };

    const items = bookingItems({ items: pickup.items });

    const quote = quoteBooking({
      selections: {
        serviceType: items[0]?.serviceType,
        scent: pickup.scent,
        starch: pickup.starch,
        addonIds: pickup.addons,
        items,
      },
      plan: member?.plan ?? null,
      points: member?.points ?? 0,
      taxRates: ratesFromEnv(process.env),
    });

    const hubs = await store.hubs.list().catch(() => []);
    const pin = pickupPinFor({
      address: pickup.address,
      suburb: pickup.suburb,
      pickupCoords: pickup.pickupCoords,
    });
    const hub = hubs.length > 0 ? hubForPickup(hubs, pin, pickup.suburb) : defaultHub();

    /**
     * Deterministic on the standing order and the date it is for.
     *
     * Which is the second line of defence behind the marker: even if two
     * processes both got past `markBooked` — they cannot, but the cost of being
     * wrong here is a courier at somebody's door — the upsert in `jobs` would
     * land on one row rather than two.
     */
    const id = `${pickup.id}-${date}`.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40) || newJobId();

    const booking: Booking = {
      id,
      name: account.name,
      email: account.email,
      phone: account.phone,
      items: quote.items,
      serviceType: quote.items[0].serviceType,
      quantity: quote.items[0].quantity,
      planId: member?.plan?.planId,
      pickupDate: date,
      pickupTime: pickup.pickupTime,
      deliveryDate: rescheduledDelivery(date),
      deliveryTime: pickup.deliveryTime,
      scent: pickup.scent,
      starch: pickup.starch,
      specialtyAddons: pickup.addons.length > 0 ? pickup.addons : undefined,
      specialInstructions: pickup.notes || undefined,
      address: pickup.address,
      suburb: pickup.suburb,
      city: pickup.city,
      pickupCoords: pickup.pickupCoords,
      status: 'Scheduled',
      createdAt: new Date().toISOString(),
      amount: quote.total,
      hubId: hub.id,
      /**
       * Always pay-on-pickup, never the plan's card.
       *
       * A standing order must not charge anybody automatically. Nothing in this
       * product has ever taken money without somebody pressing something, and a
       * timer that debited a wallet weekly would be the first — which is a
       * decision for the person who owns the business, not a consequence of a
       * scheduling feature.
       */
      paymentMethod: 'Pay on Pickup',
      paymentStatus: 'Pay on Pickup',
    };

    const outcome = await store.tx(async (t) => {
      /**
       * The marker first, and only then the booking.
       *
       * This ordering is the whole safety property. If the marker cannot be
       * moved — because another process moved it a millisecond ago — nothing is
       * booked at all. The reverse order would create the booking and then
       * discover it should not have.
       */
      const claimed = await t.recurring.markBooked(pickup.id, date, pickup.lastBookedFor);
      if (!claimed) return { kind: 'raced' } as const;

      const created = bookingToJob(booking, undefined, hubCoords(hub));
      const existing = await t.jobs.find(created.id, { lock: true });

      if (existing) {
        created.dispatch.pickupOtp = existing.dispatch.pickupOtp;
        created.dispatch.dropoffOtp = existing.dispatch.dropoffOtp;
        created.dispatch.deliveryOtp = existing.dispatch.deliveryOtp;
      }

      const saved = await t.jobs.upsert(created);

      await t.notifications.insert({
        id: `notif-${saved.id}`,
        title: 'Standing order booked',
        body:
          `${saved.customer.name}'s weekly ${describeItems({ items: saved.service.items, serviceType: saved.service.type }) || saved.service.type} ` +
          `is booked for ${date} in ${saved.location.suburb}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'order',
        orderId: saved.id,
        read: false,
      });

      /**
       * On the trail as the system's, like the hub cycle's advances.
       *
       * A booking nobody pressed a button to make should be attributable to the
       * thing that made it. The customer set up the standing order, and this
       * pass acted on it — those are two different events and the trail says
       * which one this is.
       */
      await recordAudit(t, {
        ...SYSTEM_ACTOR,
        action: 'Standing order booked',
        details:
          `Booked ${saved.reference} for ${date} from the standing order ${pickup.id} ` +
          `(every week, ${pickup.pickupTime}). Nobody placed this order by hand.`,
        type: 'system',
        orderId: saved.id,
        subject: saved.customer.email,
      });

      return { kind: 'ok', id: saved.id } as const;
    });

    if (outcome.kind === 'raced') return { ok: false, error: 'already booked by another pass' };
    return { ok: true, bookingId: outcome.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown failure' };
  }
}

/**
 * One pass over every live standing order.
 *
 * Each is booked in its own transaction, like `./hub`'s ripening, so one that
 * fails — a deleted account, a lock timeout — does not take the rest of the
 * sweep with it.
 */
export async function sweepRecurring(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { considered: 0, booked: [], failed: [] };

  const candidates = await store.recurring.due();
  result.considered = candidates.length;

  for (const pickup of candidates) {
    const due = nextDue(pickup, now);
    if (!due.ok) continue;

    const outcome = await book(pickup, due.date);

    if (outcome.ok) {
      result.booked.push({ id: pickup.id, bookingId: outcome.bookingId, date: due.date });
    } else {
      result.failed.push({ id: pickup.id, error: outcome.error });
    }
  }

  return result;
}

/**
 * Starts the cycle. Returns the function that stops it.
 *
 * On by default, unlike the hub cycle — see the header. `RECURRING_SWEEP=off`
 * is how an operator turns it off, which they would want while migrating data or
 * while a standing order is known to be misconfigured.
 *
 * Unref'd so it never keeps the process alive, and guarded against overlap so a
 * slow pass is not overtaken by the next hour's.
 */
export function startRecurringCycle(): () => void {
  if (process.env.RECURRING_SWEEP === 'off') {
    console.log('[recurring] sweep off. Standing orders will not book themselves.');
    return () => {};
  }

  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await sweepRecurring();
      if (result.booked.length > 0 || result.failed.length > 0) {
        console.log(
          `[recurring] considered ${result.considered}, booked ${result.booked.length}` +
            (result.failed.length > 0 ? `, failed ${result.failed.length}` : '')
        );
      }
      for (const failure of result.failed) {
        console.error(`[recurring] ${failure.id}: ${failure.error}`);
      }
    } catch (error) {
      console.error('[recurring] sweep failed:', error);
    } finally {
      running = false;
    }
  };

  // Once at startup as well as hourly: a server that has been down over a
  // weekend has standing orders to catch up on, and waiting an hour to notice
  // would push a Monday collection past its own cut-off.
  void tick();

  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();

  console.log('[recurring] sweep on, hourly. Standing orders book themselves inside their lead window.');

  return () => clearInterval(timer);
}

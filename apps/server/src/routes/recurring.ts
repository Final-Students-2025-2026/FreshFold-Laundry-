/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  DELIVERY_TIME_SLOTS,
  MAX_LEAD_DAYS,
  PICKUP_TIME_SLOTS,
  bookingItems,
  describeSchedule,
  isIsoDate,
  todayIso,
  type BookingItem,
} from '@freshfold/core';
import { resolveLister } from '../booking-access';
import { requireSupervisor } from '../auth';
import { guard, notFound } from '../helpers';
import { store } from '../store';

/**
 * Standing orders — the thing every membership plan has always sold.
 *
 * The plans screen advertises "Weekly door-side pickups — 4 a month" and charges
 * ₵149 a month for it; the Family plan gets eight and the Corporate plan thirty.
 * And `includedPickups` was only ever *consumed*: grep it and every hit is a
 * subtraction. Nothing in the system had ever scheduled one.
 *
 * So the customer who bought weekly pickups opened the app every Sunday and
 * booked the same order by hand, and if they forgot, the allowance expired at
 * renewal without anybody noticing — a subscription whose unused half is revenue
 * for work that was never done, which is the version of this that ends up in a
 * complaint rather than in a renewal.
 *
 * What this file does *not* do is invent a second kind of booking. A standing
 * order is a template plus a weekday; the sweep in `../recurring-cycle` turns it
 * into ordinary bookings that can be rescheduled, cancelled and complained about
 * exactly like any other.
 */
export const recurringRouter = Router();

/** The most standing orders one customer may hold. */
const MAX_PER_CUSTOMER = 5;

/** The customer's own standing orders, or the whole list for the desk. */
recurringRouter.get(
  '/',
  guard(async (req, res) => {
    const lister = await resolveLister(req);

    if (!lister) {
      res.status(401).json({ error: 'Sign in to see your standing orders.' });
      return;
    }

    if (lister.kind === 'supervisor') {
      res.json(await store.recurring.due());
      return;
    }

    res.json(await store.recurring.forCustomer(lister.account.email));
  })
);

/**
 * Creates or edits one.
 *
 * A `PUT` with a client-supplied id, so the customer app can edit a standing
 * order it is holding without a separate create/update pair — and so a replayed
 * offline write lands on the same row rather than making a second weekly pickup
 * the customer never asked for. That last one matters more here than anywhere
 * else in the product: a duplicated standing order is a courier at somebody's
 * door every week for a wash they are not expecting and will be charged for.
 */
recurringRouter.put(
  '/:id',
  guard(async (req, res) => {
    const lister = await resolveLister(req);

    if (!lister || lister.kind === 'supervisor') {
      res.status(401).json({ error: 'Sign in to set up a standing order.' });
      return;
    }

    const body = (req.body ?? {}) as {
      weekday?: number;
      pickupTime?: string;
      deliveryTime?: string;
      items?: BookingItem[];
      scent?: string;
      starch?: string;
      addons?: string[];
      address?: string;
      suburb?: string;
      city?: string;
      pickupCoords?: { lat: number; lng: number };
      notes?: string;
      active?: boolean;
      leadDays?: number;
      startsOn?: string;
      endsOn?: string;
    };

    if (!Number.isInteger(body.weekday) || body.weekday! < 0 || body.weekday! > 6) {
      res.status(400).json({ error: 'Choose a day of the week.' });
      return;
    }

    /**
     * The window has to be one the laundry actually offers.
     *
     * Checked rather than trusted because a standing order outlives the screen
     * that made it: this string is written straight onto every booking it
     * produces, for months, and `countByPickupSlot` groups on it — so a typo
     * here would create a phantom window that quietly took no capacity and
     * appeared on no availability list.
     */
    if (!PICKUP_TIME_SLOTS.includes(body.pickupTime ?? '')) {
      res.status(400).json({ error: 'Choose one of the collection windows offered.' });
      return;
    }

    if (body.deliveryTime && !DELIVERY_TIME_SLOTS.includes(body.deliveryTime)) {
      res.status(400).json({ error: 'Choose one of the return windows offered.' });
      return;
    }

    const items = bookingItems({ items: body.items });
    if (items.length === 0) {
      res.status(400).json({ error: 'A standing order needs at least one service.' });
      return;
    }

    if (!body.address?.trim()) {
      res.status(400).json({ error: 'A standing order needs an address to collect from.' });
      return;
    }

    const startsOn = isIsoDate(body.startsOn ?? '') ? body.startsOn! : todayIso();
    if (body.endsOn && !isIsoDate(body.endsOn)) {
      res.status(400).json({ error: 'An end date has to be a date.' });
      return;
    }

    if (body.endsOn && body.endsOn < startsOn) {
      res.status(400).json({ error: 'A standing order cannot end before it starts.' });
      return;
    }

    const existing = await store.recurring.forCustomer(lister.account.email);

    if (existing.length >= MAX_PER_CUSTOMER && !existing.some((row) => row.id === req.params.id)) {
      res.status(409).json({
        error: `You can hold ${MAX_PER_CUSTOMER} standing orders. Pause one to add another.`,
        reason: 'too-many',
      });
      return;
    }

    const saved = await store.recurring.upsert({
      id: req.params.id,
      customerEmail: lister.account.email,
      weekday: body.weekday!,
      pickupTime: body.pickupTime!,
      deliveryTime: body.deliveryTime,
      items,
      scent: body.scent,
      starch: body.starch,
      addons: Array.isArray(body.addons) ? body.addons : [],
      address: body.address.trim(),
      suburb: (body.suburb ?? '').trim(),
      city: (body.city ?? 'Kumasi').trim(),
      pickupCoords: body.pickupCoords,
      notes: (body.notes ?? '').trim().slice(0, 500),
      active: body.active !== false,
      leadDays: Math.min(MAX_LEAD_DAYS, Math.max(1, Number(body.leadDays) || 2)),
      startsOn,
      endsOn: body.endsOn,
    });

    res.json({ ...saved, schedule: describeSchedule(saved) });
  })
);

/** Stops one for good. Pausing is `active: false` on the PUT above. */
recurringRouter.delete(
  '/:id',
  guard(async (req, res) => {
    const lister = await resolveLister(req);

    if (!lister || lister.kind === 'supervisor') {
      res.status(401).json({ error: 'Sign in to remove a standing order.' });
      return;
    }

    const removed = await store.recurring.remove(req.params.id, lister.account.email);

    if (!removed) {
      notFound(res, 'Standing order');
      return;
    }

    res.json({ ok: true });
  })
);

/**
 * Runs the sweep now. Supervisor only.
 *
 * The cycle in `../recurring-cycle` does this on a timer; this is the same pass
 * on demand, for a desk that has just fixed a standing order and does not want
 * to wait out an hour to see whether it books. Returns what it did rather than
 * an `ok`, because "it ran and produced nothing" and "it ran and booked four"
 * are the two answers worth telling apart.
 */
recurringRouter.post(
  '/sweep',
  requireSupervisor,
  guard(async (_req, res) => {
    const { sweepRecurring } = await import('../recurring-cycle');
    res.json(await sweepRecurring());
  })
);

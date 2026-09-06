/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { SERVICE_SUBURBS, defaultHub } from '@freshfold/core';
import { requireStaff, requireSupervisor } from '../auth';
import { deskActor, recordAudit } from '../audit';
import { guard, notFound } from '../helpers';
import { store } from '../store';

/**
 * Branches.
 *
 * `LAUNDRY_HUB` in `packages/core/src/geo.ts` is one pair of coordinates and a
 * name, read by roughly twenty call sites: every distance, every ETA, the rider
 * console's destination for the drop-off leg, both live maps, and the distance
 * that feeds `priorityForBooking`. Its own comment said "change it in one place
 * or not at all", which was exactly right while there was one — and was why a
 * second branch was a refactor rather than a row.
 *
 * The constant is still there and still seeds the first hub, so nothing that
 * reads it behaves differently. What is new is that a job records which branch
 * took it, and `hubForPickup` decides which that is.
 *
 * What this deliberately does not do is route between branches, balance load
 * across them, or move a bag from one to another. Those are real problems and a
 * table does not solve them. Stopping here means the schema is no longer the
 * thing in the way: a laundry that opens in Bomso can be represented, and the
 * routing question can be answered later against real data rather than guessed
 * at now.
 */
export const hubsRouter = Router();

/** Every branch. Staff only — it is the operation's own geography. */
hubsRouter.get(
  '/',
  requireStaff,
  guard(async (_req, res) => {
    const hubs = await store.hubs.list();

    // Falls back to the constant so a database that has not run the migration
    // still answers with the branch every existing job went to, rather than with
    // an empty list that reads as "this laundry has no premises".
    res.json(hubs.length > 0 ? hubs : [defaultHub()]);
  })
);

/**
 * Creates or edits one. Supervisor only.
 *
 * `is_default` is deliberately not writable here. Exactly one hub is the
 * fallback, the database enforces that with a partial unique index, and moving
 * it is a migration-shaped decision rather than a form field — a laundry that
 * changes which branch is the default while orders are in flight has changed
 * where a job with no recorded branch is assumed to have gone.
 */
hubsRouter.put(
  '/:id',
  requireSupervisor,
  guard(async (req, res) => {
    const body = (req.body ?? {}) as {
      name?: string;
      address?: string;
      lat?: number;
      lng?: number;
      suburbs?: string[];
      active?: boolean;
    };

    const id = (req.params.id ?? '').trim().toUpperCase();
    if (id.length < 3 || id.length > 40) {
      res.status(400).json({ error: 'A branch id is between 3 and 40 characters.' });
      return;
    }

    if (!body.name?.trim()) {
      res.status(400).json({ error: 'A branch needs a name.' });
      return;
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      res.status(400).json({ error: 'A branch needs a latitude between -90 and 90.' });
      return;
    }

    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'A branch needs a longitude between -180 and 180.' });
      return;
    }

    /**
     * The coverage list has to name suburbs the laundry actually serves.
     *
     * Checked rather than free text, because `hubForPickup` matches on it
     * exactly: a branch that listed "Ayeduase Newsite" would cover nothing at
     * all, silently, and the collections it was opened for would keep going to
     * the other branch with nobody able to see why.
     */
    const suburbs = (Array.isArray(body.suburbs) ? body.suburbs : [])
      .map((suburb) => (suburb ?? '').trim())
      .filter(Boolean);

    const unknown = suburbs.filter((suburb) => !SERVICE_SUBURBS.includes(suburb));

    if (unknown.length > 0) {
      res.status(400).json({
        error: `${unknown[0]} is not a suburb FreshFold collects from.`,
        reason: 'unknown-suburb',
        suburbs: SERVICE_SUBURBS,
      });
      return;
    }

    const saved = await store.tx(async (t) => {
      const hub = await t.hubs.upsert({
        id,
        name: body.name!.trim().slice(0, 120),
        address: (body.address ?? '').trim(),
        lat,
        lng,
        suburbs,
        active: body.active !== false,
      });

      await recordAudit(t, {
        ...deskActor(req),
        action: 'Branch saved',
        details:
          `${hub.id} — ${hub.name}` +
          (hub.suburbs.length > 0 ? `, covering ${hub.suburbs.join(', ')}` : ', no stated area') +
          (hub.active ? '' : ' (closed)'),
        type: 'roster',
        subject: hub.id,
      });

      return hub;
    });

    res.json(saved);
  })
);

/** One branch. */
hubsRouter.get(
  '/:id',
  requireStaff,
  guard(async (req, res) => {
    const hub = await store.hubs.find(req.params.id);

    if (!hub) {
      notFound(res, 'Branch');
      return;
    }

    res.json(hub);
  })
);

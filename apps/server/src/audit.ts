/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { AuditEvent, AuditEventType } from '@freshfold/core';
import type { Repositories } from './store';

/**
 * The desk's audit trail.
 *
 * Entries used to be built in the browser and kept in `localStorage`: the
 * record of who settled a payment or deleted an order lived on the machine that
 * did it, capped at fifty by an array `slice`, and gone with the site data. It
 * was also, being a client-side record of a client-side claim, evidence of
 * nothing. These are written here, by the route that performs the action, in
 * the same transaction as the write they describe — so an action that rolls
 * back leaves no entry and one that commits always has one.
 *
 * Nothing in this file can amend or remove an entry, and no route exposes a way
 * to. Append-only is the whole value of the table.
 */

/** Who did it: an identity to hold to account, and a name to put on screen. */
export interface AuditActor {
  actor: string;
  actorName: string;
}

/**
 * Nobody did it.
 *
 * The hub cycle advancing a stage on a timer, which is a fact about the system
 * rather than about a person. Recorded rather than left silent precisely because
 * an unattributed advance is the thing a supervisor needs to be able to find:
 * "In Care ripened into Ironing & Folding because two minutes passed" is not
 * somebody confirming that a garment was washed.
 */
export const SYSTEM_ACTOR: AuditActor = { actor: 'system', actorName: 'Hub cycle' };

/**
 * The supervisor behind a request.
 *
 * Only safe on a route behind `requireSupervisor`, or one that has resolved a
 * supervisor for itself — which is every caller, because the desk is the only
 * party whose actions this trail records.
 */
export function deskActor(req: Request): AuditActor {
  const supervisor = req.supervisor;
  if (!supervisor) {
    // Reachable only by wiring an audit call into an unguarded route. Recorded
    // rather than thrown: losing the entry is worse than an imprecise actor,
    // and "unknown desk" in the trail is a bug report somebody will read.
    return { actor: 'unknown', actorName: 'Unknown desk' };
  }
  return { actor: supervisor.email, actorName: supervisor.name };
}

/**
 * What an entry says, minus the parts the server fills in.
 *
 * `id` and `at` are deliberately not the caller's to supply: the browser's old
 * ids were `LOG-` plus four random digits, which collide, and its timestamps
 * were whatever the machine's clock said.
 */
export interface AuditEntry extends AuditActor {
  action: string;
  details: string;
  type: AuditEventType;
  orderId?: string;
  subject?: string;
}

/**
 * Files one entry.
 *
 * Takes the repositories handle rather than reaching for `store` so a route
 * already inside `store.tx` records in that same transaction — the same reason
 * `transition` takes one. Pass `store` itself for a route that is not in a
 * transaction; the shape is identical.
 */
export async function recordAudit(t: Repositories, entry: AuditEntry): Promise<AuditEvent> {
  return t.auditEvents.insert({
    id: `audit-${randomBytes(9).toString('hex')}`,
    ...entry,
  });
}

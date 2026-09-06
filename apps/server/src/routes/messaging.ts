/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { messageProblem } from '@freshfold/core';
import type { Message, MessageSender, Notification } from '@freshfold/core';
import { requireStaff } from '../auth';
import {
  resolveBookingAccess,
  resolveCaller,
  resolveLister,
  type BookingAccess,
  type Caller,
} from '../booking-access';
import { store } from '../store';
import { guard, nowLabel, notFound } from '../helpers';

/**
 * One conversation per job, visible from all three surfaces: the customer
 * writes from the client portal, the rider from the companion app's chat, and
 * dispatch narration is appended automatically as the job's status advances
 * (see `routes/orders.ts`).
 *
 * Both collections are behind an identity now, and a message's sender is derived
 * from that identity rather than declared. This was open in both directions: a
 * bare `GET /api/messages` returned every conversation in the system, and a POST
 * carried its own `sender`, so anybody could write into any job's thread as
 * `dispatcher` — which is the voice the customer reads as FreshFold's own.
 */
export const messagesRouter = Router();

/**
 * Who the caller is on the job a message belongs to.
 *
 * Returns `null` for a job that does not exist as well as for one the caller has
 * no claim on, so the two are indistinguishable from outside — an order id is
 * six digits and telling them apart is most of what walking the space was for.
 */
async function accessToOrder(
  req: Parameters<typeof resolveBookingAccess>[0],
  orderId: string
): Promise<BookingAccess | null> {
  const job = await store.jobs.find(orderId);
  if (!job) return null;
  return resolveBookingAccess(req, job);
}

/**
 * What a party to a job signs their messages as.
 *
 * The three voices in a thread are the customer, the courier and the desk, and
 * each one is a fact about who is holding the token rather than a field they
 * fill in. A tracking token is the guest's grant on their own booking, so it
 * writes as the customer — which is who it belongs to.
 */
function senderFor(access: BookingAccess): MessageSender {
  switch (access.kind) {
    case 'rider':
      return 'rider';
    case 'supervisor':
      return 'dispatcher';
    default:
      return 'customer';
  }
}

/**
 * How much of the whole ledger's traffic the desk's inbox gets by default, and
 * the most it can ask for. Same shape as the audit trail's paging: nothing is
 * discarded, the route just answers a page.
 */
const DEFAULT_INBOX_PAGE = 500;
const MAX_INBOX_PAGE = 2000;

/**
 * A job's thread, or every thread.
 *
 * `orderId` narrows to one conversation, which any party to that job may read.
 * Without it this is the whole ledger's messaging history, so it is the desk's
 * alone — it used to answer anybody, and the rider app polled it unscoped every
 * four seconds.
 */
messagesRouter.get(
  '/',
  guard(async (req, res) => {
    const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : null;

    if (!orderId) {
      const lister = await resolveLister(req);
      if (lister?.kind !== 'supervisor') {
        res.status(403).json({ error: 'Ask for one order’s messages by id.' });
        return;
      }

      // Floored for the same reason the audit route floors it: `?limit=10.5`
      // reaches Postgres as a numeric it rounds on its own, and a page size
      // decided by rounding rules is not one anybody asked for.
      const asked = Number(req.query.limit);
      const limit =
        Number.isFinite(asked) && asked >= 1
          ? Math.min(Math.floor(asked), MAX_INBOX_PAGE)
          : DEFAULT_INBOX_PAGE;

      res.json(await store.messages.listRecent(limit));
      return;
    }

    if (!(await accessToOrder(req, orderId))) {
      notFound(res, 'Order');
      return;
    }

    res.json(await store.messages.list(orderId));
  })
);

messagesRouter.post(
  '/',
  guard(async (req, res) => {
    const incoming = req.body as Partial<Message>;

    // Length as well as presence. This was the one text field in the product
    // with no bound at all, while claim descriptions, rating comments and
    // invoice lines were all capped — an omission rather than a policy.
    const text = incoming?.text ?? '';
    const problem = messageProblem(text);
    if (problem) {
      // 413 when there is text and it is too long, 400 when there is none.
      res.status(text ? 413 : 400).json({ error: problem });
      return;
    }

    /**
     * A message belongs to a job, always.
     *
     * `orderId` was optional, and a message without one is a message in no
     * conversation — nothing renders it, and it was the only way to write here
     * without naming something to be checked against.
     */
    if (!incoming.orderId) {
      res.status(400).json({ error: 'A message needs the order it belongs to.' });
      return;
    }

    const access = await accessToOrder(req, incoming.orderId);
    if (!access) {
      notFound(res, 'Order');
      return;
    }

    const message: Message = {
      id: incoming.id || `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      // Read off the session, never off the body.
      sender: senderFor(access),
      text,
      timestamp: incoming.timestamp || nowLabel(),
      orderId: incoming.orderId,
    };

    const stored = await store.tx(async (t) => {
      const saved = await t.messages.insert(message);

      /**
       * A reply from the desk rings a bell; a message to the desk does not.
       *
       * Until now nothing here raised a notification at all. The only "New
       * Dispatch Message" alert that ever existed was raised by the courier's own
       * phone, about a canned reply that phone had just invented — so deleting
       * that `setTimeout` without this would leave the real desk quieter than the
       * fake one, and a supervisor's answer would sit in a thread nobody had been
       * told to open.
       *
       * Only the desk's messages notify, and that is a limit rather than a
       * preference: `Notification` has no recipient column, so `feedFor` routes an
       * order-scoped notice to *everybody* on that job — the courier holding it
       * and the customer who owns it. Notifying on a customer's message would
       * push it straight back to the customer who wrote it. Their messages reach
       * the desk through its inbox instead, which is a surface somebody is looking
       * at. A `recipient` column is the fix, and is not this change.
       *
       * Both writes or neither: a bell for a message that was not stored would
       * point at a thread that does not contain it, and a message with no bell is
       * the thing being repaired.
       */
      if (saved.sender === 'dispatcher') {
        await t.notifications.insert({
          id: `notif-msg-${saved.id}`,
          title: 'Dispatch replied',
          body: saved.text,
          timestamp: saved.timestamp,
          type: 'message',
          orderId: saved.orderId,
          read: false,
        });
      }

      return saved;
    });

    res.status(201).json(stored);
  })
);

export const notificationsRouter = Router();

/**
 * The desk's feed, or a customer's own.
 *
 * Staff read the lot — that is what the notification tray on the dispatch desk
 * is. A customer reads only the ones filed against their own orders, which is
 * all their app has ever displayed: it pulled every notification in the system
 * and filtered in the device, so one customer's tray held the names and suburbs
 * of everybody else's pickups.
 */
notificationsRouter.get(
  '/',
  guard(async (req, res) => {
    const caller = await resolveCaller(req);

    if (!caller) {
      res.status(401).json({ error: 'Sign in to see your notifications.' });
      return;
    }

    res.json(await feedFor(caller));
  })
);

/**
 * The notifications one caller is entitled to.
 *
 * A supervisor gets the feed itself. A courier gets everything about the jobs on
 * their board — `store.jobs.list({ riderId })` is already "mine plus the open
 * pool" — plus the notices that name no order, which are the desk-wide alerts
 * they are meant to act on. A customer gets only what is filed against their own
 * orders: a notice with no order behind it is bookkeeping about somebody's
 * membership, and is not addressed to them.
 */
async function feedFor(caller: NonNullable<Caller>): Promise<Notification[]> {
  const notifications = await store.notifications.list();

  if (caller.kind === 'supervisor') return notifications;

  if (caller.kind === 'rider') {
    const board = new Set(
      (await store.jobs.list({ riderId: caller.rider.id })).map((job) => job.id)
    );
    return notifications.filter((n) => !n.orderId || board.has(n.orderId));
  }

  const mine = new Set(
    (
      await store.jobs.list({
        email: caller.account.email,
        phone: caller.account.phone ?? null,
      })
    ).map((job) => job.id)
  );
  return notifications.filter((n) => n.orderId && mine.has(n.orderId));
}

/**
 * Files a notification. Staff only.
 *
 * Every notification the product actually raises is written server-side, inside
 * the transaction that caused it — see `transition` in `./orders` and the hub
 * cycle. This stays for the dispatch console's own alerts, and behind a staff
 * session: open, it was a way to put arbitrary text in front of the desk.
 */
notificationsRouter.post(
  '/',
  requireStaff,
  guard(async (req, res) => {
    const incoming = req.body as Partial<Notification>;
    if (!incoming?.title || !incoming.body) {
      res.status(400).json({ error: 'A notification needs a title and body.' });
      return;
    }

    if (incoming.orderId && !(await store.jobs.find(incoming.orderId))) {
      notFound(res, 'Order');
      return;
    }

    const notification: Notification = {
      id: incoming.id || `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: incoming.title,
      body: incoming.body,
      timestamp: incoming.timestamp || nowLabel(),
      type: incoming.type ?? 'system',
      orderId: incoming.orderId,
      read: incoming.read ?? false,
    };

    res.status(201).json(await store.notifications.insert(notification));
  })
);

/**
 * Marks one read.
 *
 * Anyone who is entitled to see it may dismiss it: staff, or the customer whose
 * order it is about. `read` is a single shared flag rather than per-recipient
 * state, which is a pre-existing limitation — the desk and the customer clearing
 * the same notice clear it for both — and not something this change alters.
 */
notificationsRouter.post(
  '/:id/read',
  guard(async (req, res) => {
    const caller = await resolveCaller(req);
    if (!caller) {
      res.status(401).json({ error: 'Sign in to update your notifications.' });
      return;
    }

    // Dismissable exactly when it was visible, which is what `feedFor` already
    // answers — rather than a second, subtly different rule about who owns what.
    const visible = (await feedFor(caller)).some((n) => n.id === req.params.id);
    if (!visible) {
      notFound(res, 'Notification');
      return;
    }

    const notification = await store.notifications.markRead(req.params.id);
    if (!notification) {
      notFound(res, 'Notification');
      return;
    }
    res.json(notification);
  })
);

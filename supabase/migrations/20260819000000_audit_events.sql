-- ---------------------------------------------------------------------------
-- The audit trail — who did what to the ledger
-- ---------------------------------------------------------------------------
--
-- The supervisor desk has always had an audit pane, and it has never been an
-- audit trail. The entries were built in the browser, kept in `localStorage`
-- under `freshfold_audit_logs`, capped at fifty by an array `slice`, and keyed
-- on `LOG-` plus four random digits. So the record of who settled a payment,
-- who adjusted a loyalty balance and who deleted an order was: visible only to
-- the machine that did it, erased by clearing site data, and liable to give two
-- different events the same id. A second supervisor saw none of it.
--
-- An audit trail written by the party being audited is not evidence of
-- anything. These rows are written by the server, inside the transaction that
-- performs the action, so an action that rolls back leaves no entry behind and
-- one that commits always has one.
--
-- Append-only. Nothing updates or deletes a row here — there is no route that
-- can, which is the point of the table.

create table if not exists audit_events (
  id         text primary key,
  seq        bigserial not null,

  -- A real instant, not the display label the other feeds carry. This trail
  -- outlives a session, and "14:32" with no date is not a record of anything.
  created_at timestamptz not null default now(),

  -- The supervisor's email, or the literal 'system' when the hub cycle
  -- advanced a stage on a timer rather than a person confirming it.
  actor      text not null,
  actor_name text not null,

  action     text not null,
  details    text not null,

  type       text not null check (type in
               ('stage', 'order', 'payment', 'points', 'account', 'roster', 'system')),

  -- No foreign key, deliberately. `notifications.order_id` cascades on delete,
  -- which here would mean that deleting an order also deletes the record of
  -- somebody deleting it. Same reasoning as `transactions.booking_id`.
  order_id   text,

  -- The patron email or courier id the entry concerns, when it concerns one.
  subject    text
);

-- The pane is newest-first, like the other feeds.
create index if not exists audit_events_seq_idx on audit_events (seq desc);

-- For "everything that has ever been done to this order".
create index if not exists audit_events_order_id_idx on audit_events (order_id);

-- ---------------------------------------------------------------------------
-- Blocking a customer account
-- ---------------------------------------------------------------------------
--
-- The desk could edit a customer's points and delete their orders, but it had
-- no way to stop a customer: somebody running up chargebacks, abusing couriers
-- or booking pickups they never hand over could be cleared off the board one
-- order at a time and simply book again.
--
-- A timestamp rather than the `active` boolean the roster tables use, because
-- these two answer different questions. A courier leaves the roster and that is
-- the whole of it; a suspended customer is an account somebody is going to ask
-- about, and "when" is half of that answer. Null is the normal state, which
-- also means every existing row is unblocked without a backfill.
--
-- Deletion needs no column. The row goes, and the jobs it booked stay — they
-- carry the customer's details inside `jobs.customer` and are not joined back
-- to this table, so the ledger survives the account leaving it.

alter table accounts
  add column if not exists blocked_at     timestamptz,
  -- Why, in the supervisor's words. Server-side only: `sanitize` in
  -- apps/server/src/passwords.ts strips it from every list response, because
  -- `GET /api/accounts` answers anyone and a supervisor's private note about a
  -- customer is not a thing to publish. It is returned to the desk on the
  -- request that sets it, and nowhere else.
  add column if not exists blocked_reason text;

-- The desk lists blocked patrons first, and sign-in reads the column on every
-- attempt. Partial, so unblocked accounts — nearly all of them — cost nothing.
create index if not exists accounts_blocked_at_idx
  on accounts (blocked_at)
  where blocked_at is not null;

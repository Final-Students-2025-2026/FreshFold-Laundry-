-- ---------------------------------------------------------------------------
-- Memberships move onto the account
-- ---------------------------------------------------------------------------
--
-- A subscription used to live only in the customer app's AsyncStorage: the
-- wallet was debited on the server, and the entitlement it bought was written
-- to the device. Two consequences, both paid for by the customer:
--
--   * reinstalling the app, or signing in on a second device, silently threw
--     the plan away;
--   * the server granted `elite` dispatch priority on the strength of a
--     `planId` the client put in the booking body, which anyone could set.
--
-- The plan belongs where the wallet it is paid from belongs. These columns are
-- written only by /api/accounts/plan — the profile route's allow-list does not
-- include them, so a PUT of the whole account cannot grant itself a plan.
--
-- All nullable: an account without a membership has no row values here, and
-- `plan_id is null` is the single test for "no plan".

alter table accounts
  add column if not exists plan_id             text,
  add column if not exists plan_started_at     timestamptz,
  add column if not exists plan_period_start   timestamptz,
  add column if not exists plan_renews_on      timestamptz,
  add column if not exists plan_price          double precision,
  -- Included pickups spent in the period now running; reset on renewal.
  add column if not exists plan_pickups_used   integer not null default 0,
  -- A cancellation the customer has already made, taking effect at period end.
  add column if not exists plan_cancel_at_end  boolean not null default false;

-- Renewal is settled lazily, when an account is read. Nothing sweeps the table
-- on a timer today, but a plan that is overdue is the only interesting subset
-- if anything ever does — and the same index answers "who is due to renew".
create index if not exists accounts_plan_renews_on_idx
  on accounts (plan_renews_on)
  where plan_id is not null;

-- The membership transactions written by renewals and switches hang off the
-- account like every other ledger row; `transactions` needs no new column.

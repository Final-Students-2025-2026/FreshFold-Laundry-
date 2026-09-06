-- FreshFold dispatch — initial schema.
--
-- Replaces the JSON file that stood in for a database (apps/server/data/db.json).
-- The eight collections of the old `Database` interface become eight tables,
-- one for one, so nothing in the domain model had to be renamed to fit.
--
-- Two conventions run through the whole file:
--
--  1. **Nested value objects stay JSONB.** A `Job` is six nested groups —
--     customer, service, schedule, location, dispatch, payment — and
--     `applyStatus` in @freshfold/core reads and rewrites them as whole
--     objects. Shredding them into eighty columns would mean reassembling
--     them on every read for no gain: nothing queries inside them. What *is*
--     queried gets promoted to a real column below.
--
--  2. **Promoted columns are GENERATED, never written.** `rider_id` and
--     `customer_email` are the two fields routes actually filter on, and both
--     live inside JSONB. Deriving them means they cannot drift from the
--     object they came from — there is no code path that updates one and
--     forgets the other.

-- ---------------------------------------------------------------------------
-- Jobs — the canonical record
-- ---------------------------------------------------------------------------

create table if not exists jobs (
  -- `FFC-######`, minted by newJobId() in @freshfold/core. The customer's
  -- booking reference and the rider's job id are deliberately the same string.
  id            text primary key,
  reference     text not null,

  status        text not null check (status in (
                  'unassigned',
                  'assigned',
                  'navigating_to_pickup',
                  'arrived_at_pickup',
                  'pickup_scanned',
                  'picked_up',
                  'navigating_to_laundry',
                  'arrived_at_laundry',
                  'dropped_off',
                  'processing',
                  'ready_for_delivery',
                  'navigating_to_delivery',
                  'arrived_at_delivery',
                  'delivered',
                  'cancelled'
                )),

  created_at    timestamptz not null,
  updated_at    timestamptz not null,

  -- The six nested groups of the Job type, stored as they are modelled.
  -- `dispatch` carries the bag manifest and the base64 proof-of-service
  -- photos, so it is comfortably the largest of them; Postgres will TOAST it
  -- out of line on its own.
  customer      jsonb not null,
  service       jsonb not null,
  schedule      jsonb not null,
  location      jsonb not null,
  dispatch      jsonb not null,
  payment       jsonb not null,

  -- Derived, for the two filters the API actually runs. See note 2 above.
  rider_id      text generated always as (dispatch ->> 'riderId') stored,
  customer_email text generated always as (lower(customer ->> 'email')) stored
);

-- `GET /api/orders?riderId=` — the open pool plus everything already theirs.
create index if not exists jobs_rider_id_idx on jobs (rider_id);
-- `GET /api/bookings?email=` — one customer's order history.
create index if not exists jobs_customer_email_idx on jobs (customer_email);
-- Every list route sorts newest first.
create index if not exists jobs_created_at_idx on jobs (created_at desc);

-- ---------------------------------------------------------------------------
-- Riders — the courier roster
-- ---------------------------------------------------------------------------

create table if not exists riders (
  -- `FF-R-###`. Assigned by the server, readable on purpose.
  id              text primary key,
  -- `RIDER-###`. A sign-in identifier, so the server assigns it rather than
  -- letting a supervisor type one and collide.
  employee_id     text not null,
  phone           text not null,

  -- The courier's own, entered on first sign-in; dispatch refuses work until
  -- it has a value.
  name            text not null default '',
  avatar          text not null default '',

  -- Company property, assigned by a supervisor. The customer is shown both at
  -- the door, so neither is the courier's to edit.
  vehicle         text not null default '',
  vehicle_plate   text not null default '',

  -- Telemetry the phone reports about itself.
  --
  -- `double precision` rather than `numeric` throughout this file: every one of
  -- these is a `number` in the domain model, JS has no decimal type, and
  -- postgres.js hands `numeric` back as a *string* to avoid the precision loss
  -- that converting it would cause. Declaring float8 keeps the round trip
  -- honest instead of parsing a string back into the float it started as.
  is_online       boolean not null default false,
  battery_level   double precision not null default 100,
  gps_accuracy    double precision not null default 0,
  speed           double precision not null default 0,
  heading         double precision not null default 0,
  coords          jsonb not null default '{"lat": 6.6852, "lng": -1.5815}'::jsonb,

  -- Running totals. Every one starts at zero: nobody has driven anywhere yet,
  -- and a seeded 4.9 rating would be a claim rather than a measurement.
  rating          double precision not null default 0,
  today_distance  double precision not null default 0,
  today_earnings  double precision not null default 0,
  completed_count integer not null default 0,
  on_time_rate    double precision not null default 0,
  acceptance_rate double precision not null default 0,
  completion_rate double precision not null default 0,

  -- Credentials. These never leave the server — sanitizeRider() in
  -- apps/server/src/passwords.ts is what strips them on the way out.
  pin_salt        text,
  pin_hash        text,
  -- True while the courier is still on the temporary PIN a supervisor issued.
  must_change_pin boolean not null default false,
  -- When an unused provisioned PIN stops working. A temporary credential that
  -- lives forever is a permanent one nobody remembers issuing.
  pin_expires_at  timestamptz,

  -- How somebody leaves the roster. Deleting the record would orphan every job
  -- they ever carried, so a departed courier is deactivated instead.
  active          boolean not null default true,

  -- The comparable part of a number, mirroring phoneKey() in @freshfold/core:
  -- 0244567801, +233 244 567 801 and 233244567801 all reduce to 244567801.
  -- NULL below nine digits, so a half-typed number matches nothing — which is
  -- exactly what samePhone() returns for one.
  phone_key       text generated always as (
                    nullif(right(regexp_replace(phone, '[^0-9]', '', 'g'), 9), '')
                  ) stored
);

-- Sign-in resolves either identifier to the same record.
create unique index if not exists riders_employee_id_idx on riders (lower(employee_id));
create index if not exists riders_phone_key_idx on riders (phone_key);

-- ---------------------------------------------------------------------------
-- Accounts — customer identities
-- ---------------------------------------------------------------------------

create table if not exists accounts (
  -- Email is the identity. Stored as typed for display; matched case-insensitively
  -- through the unique index below, which is what the old
  -- `a.email.toLowerCase() === wanted` scan did on every lookup.
  email          text primary key,
  phone          text not null default '',
  name           text not null default '',
  created_at     timestamptz not null default now(),

  -- Nullable, and left null rather than defaulted to 0: `points?: number` on
  -- UserAccount distinguishes "no loyalty balance recorded" from "zero points",
  -- and the portal renders those differently.
  points         double precision,
  wallet_balance double precision,

  -- An account created by a booking has no password yet. Claiming it via
  -- /api/auth/register is the normal path, not a conflict — so these are
  -- nullable rather than required.
  password_salt  text,
  password_hash  text,

  phone_key      text generated always as (
                   nullif(right(regexp_replace(phone, '[^0-9]', '', 'g'), 9), '')
                 ) stored
);

create unique index if not exists accounts_email_idx on accounts (lower(email));
create index if not exists accounts_phone_key_idx on accounts (phone_key);

-- ---------------------------------------------------------------------------
-- Supervisors — the desk
-- ---------------------------------------------------------------------------

create table if not exists supervisors (
  id            text primary key,
  name          text not null,
  email         text not null,
  created_at    timestamptz not null default now(),
  active        boolean not null default true,
  password_salt text,
  password_hash text
);

create unique index if not exists supervisors_email_idx on supervisors (lower(email));

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

-- One conversation per job, written from all three surfaces: the customer from
-- the portal, the courier from the companion app, and dispatch narration
-- appended automatically as the status advances.
create table if not exists messages (
  id        text primary key,
  -- Insertion order. `timestamp` below is a *display label* ("14:32") produced
  -- by nowLabel(), not a sortable instant, so it cannot order the thread — and
  -- the array it replaced was ordered by push order alone.
  seq       bigserial not null,
  sender    text not null check (sender in ('rider', 'customer', 'dispatcher', 'laundry_center')),
  text      text not null,
  timestamp text not null,
  order_id  text references jobs (id) on delete cascade
);

create index if not exists messages_order_id_seq_idx on messages (order_id, seq);

create table if not exists notifications (
  id        text primary key,
  seq       bigserial not null,
  title     text not null,
  body      text not null,
  -- A display label, for the same reason as messages.timestamp.
  timestamp text not null,
  type      text not null check (type in ('order', 'system', 'message', 'alert')),
  order_id  text references jobs (id) on delete cascade,
  read      boolean not null default false
);

-- The feed is newest-first; the old array was built with unshift().
create index if not exists notifications_seq_idx on notifications (seq desc);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table if not exists transactions (
  id          text primary key,
  seq         bigserial not null,
  -- The reference is what Paystack echoes back, and what an upsert matches on.
  reference   text not null unique,
  booking_id  text,
  user_email  text,
  amount      double precision not null,
  method      text not null,
  status      text not null check (status in ('Successful', 'Pending', 'Failed')),
  -- Client-supplied and of no guaranteed format, so it is carried verbatim
  -- rather than parsed into a timestamptz that would quietly reformat it.
  timestamp   text not null,
  description text not null
);

create index if not exists transactions_user_email_idx on transactions (lower(user_email));
create index if not exists transactions_seq_idx on transactions (seq desc);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

-- One token store for all three audiences. `kind` decides which table
-- `subject` points into — an email for a customer or supervisor, a rider id
-- for a courier — so the expiry sweep, the revoke path and the bearer parsing
-- are written once rather than three times.
--
-- No foreign key on `subject` for that reason: it is a different table
-- depending on `kind`. Identity is re-resolved on every request anyway, which
-- is what makes deactivating a courier take effect immediately instead of
-- waiting out their week-long token.
create table if not exists sessions (
  token      text primary key,
  kind       text not null check (kind in ('customer', 'rider', 'admin')),
  subject    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_expires_at_idx on sessions (expires_at);
create index if not exists sessions_subject_idx on sessions (kind, subject);

-- ---------------------------------------------------------------------------
-- Lock the tables out of the public REST API
-- ---------------------------------------------------------------------------

-- Supabase publishes every table in the `public` schema through PostgREST, and
-- the anon key that reaches it is *designed* to be public — it ships inside the
-- website's JavaScript bundle. Without row-level security that would make
-- `accounts.password_hash`, `riders.pin_hash` and the whole session table
-- readable, and writable, by anyone who opened the site and read one variable.
--
-- Enabling RLS with **no policies at all** denies every request that arrives as
-- `anon` or `authenticated`, which is exactly right here: nothing is supposed
-- to reach these tables that way. The dispatch server connects over the
-- Postgres wire protocol as the table owner, and an owner bypasses RLS unless
-- the table is set to FORCE — so the server keeps full access and loses
-- nothing.
--
-- If a client is ever given direct Supabase access — to replace the four-second
-- polling with Realtime, say — this is the line to revisit, and revisiting it
-- means writing policies, not deleting these statements.

alter table jobs          enable row level security;
alter table riders        enable row level security;
alter table accounts      enable row level security;
alter table supervisors   enable row level security;
alter table messages      enable row level security;
alter table notifications enable row level security;
alter table transactions  enable row level security;
alter table sessions      enable row level security;

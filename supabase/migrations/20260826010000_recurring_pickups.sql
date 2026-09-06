-- Recurring pickups: the thing every membership plan already sells.
--
-- The plans screen advertises "Weekly door-side pickups — 4 a month" and charges
-- ₵149 a month for it. `MEMBERSHIP_PLANS` gives the Family plan eight and the
-- Corporate plan thirty. And `includedPickups` is only ever *consumed* — grep it
-- and every hit is a subtraction. Nothing in the system has ever scheduled one.
--
-- So the customer who bought "weekly pickups" opens the app every Sunday and
-- books the same order by hand, and if they forget, the allowance expires at
-- renewal without anybody noticing. They are paying a subscription for the
-- privilege of doing the thing manually, and the unused half is revenue the
-- laundry keeps for work it never did — which is the version of this that ends
-- up in a complaint.
--
-- One row per standing order. The bookings it produces are ordinary bookings:
-- this table schedules them and then gets out of the way, so a recurring pickup
-- can be rescheduled, cancelled or complained about exactly like any other.
create table if not exists recurring_pickups (
  id          text primary key,

  -- Lower-cased, like every other customer key here.
  customer_email text not null,

  -- Which day of the week, `0` Sunday through `6` Saturday.
  --
  -- A weekday plus a window rather than an interval in days, because that is how
  -- a person describes this: "every Tuesday morning", not "every 168 hours". The
  -- two diverge the moment a week is skipped, and the weekday is the one that
  -- stays true.
  weekday     smallint not null check (weekday between 0 and 6),

  -- The collection window, as a `PICKUP_TIME_SLOTS` label — the same string a
  -- one-off booking stores, so the capacity counting in `countByPickupSlot`
  -- sees a generated booking exactly like a hand-made one.
  pickup_time text not null,

  -- And the return window, as a `DELIVERY_TIME_SLOTS` label. Optional, like the
  -- one on a booking.
  delivery_time text,

  -- What to book, as the `BookingItem[]` a booking carries. JSONB because it is
  -- the same shape `jobs.service` already stores and reads back — a normalised
  -- line-items table here would be the only place in the schema that modelled
  -- them relationally, and the two would drift.
  items       jsonb not null default '[]'::jsonb,

  -- The finishes, so a standing order comes back the way the customer likes it
  -- rather than defaulting every week.
  scent       text,
  starch      text,
  addons      jsonb not null default '[]'::jsonb,

  -- Where to collect from. A snapshot rather than a pointer into the address
  -- book: an address deleted from the book must not silently redirect a standing
  -- order, and the customer editing one is editing this.
  address     text not null,
  suburb      text not null,
  city        text not null default 'Kumasi',
  pickup_coords jsonb,

  notes       text not null default '' check (char_length(notes) <= 500),

  -- Paused rather than deleted, because "skip the next few weeks" is what people
  -- actually want and deleting loses the setup.
  active      boolean not null default true,

  -- How far ahead the sweep books. One by default: a booking that exists is a
  -- booking that occupies a collection window, and materialising six weeks of
  -- them would fill the board with orders nobody has confirmed.
  lead_days   smallint not null default 2 check (lead_days between 1 and 14),

  -- The last date this produced a booking for, as `YYYY-MM-DD`.
  --
  -- A date rather than a timestamp because it answers a calendar question —
  -- "have we booked this week's yet" — and because it is what makes the sweep
  -- idempotent: two server instances running the same pass produce one booking,
  -- since the second sees the date already moved.
  last_booked_for date,

  -- When the standing order starts and stops. `ends_at` null runs until paused.
  starts_on   date not null default current_date,
  ends_on     date,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The customer's own list, on their account screen.
create index if not exists recurring_pickups_customer_idx
  on recurring_pickups (customer_email);

-- The sweep's own query: everything live, oldest-booked first.
create index if not exists recurring_pickups_due_idx
  on recurring_pickups (last_booked_for) where active;

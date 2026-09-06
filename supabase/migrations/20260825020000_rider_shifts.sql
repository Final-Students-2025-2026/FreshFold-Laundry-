-- Shifts: when a courier is actually working.
--
-- The roster's whole model of availability is `riders.active`, a boolean set by
-- a supervisor, plus `is_online`, which the phone sets by being open. Neither
-- answers the question a dispatcher actually has, which is "who is on tonight".
-- A courier who is `active` is on the payroll; a courier who is `is_online` has
-- the app in the foreground. Somebody who finished at six and left their phone
-- unlocked in a drawer is both, and is not going to collect anything.
--
-- The cost of not knowing shows up on the booking form rather than the roster.
-- `PICKUP_SLOT_CAPACITY` is a single number a supervisor guesses at and tunes by
-- hand, because nothing can work out how many collections an evening can take —
-- that being a function of how many couriers are on, which nothing records.
--
-- One row per stretch of work. Not a recurring-pattern table: a weekly template
-- is the second thing to want and it stores a *rule*, which then has to be
-- reconciled with the exceptions that are the entire reason anybody looks at a
-- rota. Concrete blocks first.
create table if not exists rider_shifts (
  id          text primary key,

  -- Cascades: a courier removed from the roster takes their future shifts with
  -- them. Losing the past ones with them is the deliberate trade — this table is
  -- for planning the week, and payroll history is not what it holds.
  rider_id    text not null references riders(id) on delete cascade,

  -- Instants, not calendar days, unlike `jobs.schedule.pickupDate`. A pickup
  -- date is a day on a wall calendar and the arithmetic on it must not consult a
  -- timezone; a shift is a stretch of clock time with a real beginning, and
  -- "18:00 to 02:00" is a normal evening shift that crosses midnight. Storing it
  -- as a date plus two times would make that the awkward case.
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,

  -- Nobody works a shift that ends before it starts. Enforced here rather than
  -- only in the route because an inverted range would make every "who is on
  -- now" query silently wrong rather than loudly.
  constraint rider_shifts_ordered check (ends_at > starts_at),

  -- "Evening round", "covering Kojo". The reason this block exists, for whoever
  -- reads the rota next week.
  note        text not null default '' check (char_length(note) <= 200),

  -- Who rostered it. Supervisors only write here, so this is always somebody.
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);

-- "Is this courier on right now", and "what is this courier's week" — the same
-- index answers both, because both scan one courier's blocks by time.
create index if not exists rider_shifts_rider_idx on rider_shifts (rider_id, starts_at);

-- "Who is on at this moment", across the roster. The dispatcher's question, and
-- the one the accept route asks before it lets a courier take work.
create index if not exists rider_shifts_window_idx on rider_shifts (starts_at, ends_at);

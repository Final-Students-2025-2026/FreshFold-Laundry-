-- Rider ratings: the write path for a column that has been sitting at zero
-- since the schema was written.
--
-- `riders.rating` has existed from the first migration, with a comment saying a
-- seeded 4.9 "would be a claim rather than a measurement". That was right, and
-- then nothing ever wrote a measurement either: the column was initialised to 0
-- at provisioning and no route in the server has ever moved it. Meanwhile the
-- concierge chatbot has been telling customers they can "rate riders to earn
-- care loyalty points" — a feature advertised in the product with nothing behind
-- it at all.
--
-- A table rather than a running average on the rider row, for three reasons. An
-- average with no rows behind it cannot be recomputed when a courier leaves and
-- their jobs are reassigned, or when a rating is withdrawn. It cannot answer
-- "who rated this" — so nothing stops one customer rating the same delivery
-- forty times. And a supervisor looking at 2.8 stars needs to read the comments
-- to know what to do about it, which means the comments have to be somewhere.
create table if not exists job_ratings (
  -- The job is the key. One delivery, one rating — which is what makes the
  -- write idempotent without a second uniqueness rule, and what stops a
  -- customer rating the same courier repeatedly to move their average.
  job_id      text primary key references jobs(id) on delete cascade,

  -- Denormalised from the job deliberately. `jobs.dispatch.riderId` can be
  -- reassigned by the desk after a delivery, and the rating belongs to whoever
  -- actually carried it — not to whoever holds the record afterwards.
  rider_id    text not null,

  -- Whose rating it is. Lower-cased, like `jobs.customer_email`, so the two
  -- join without a function on either side.
  customer_email text not null,

  -- One to five. Checked here as well as in the route: this column feeds an
  -- average, and a single row of 4000 would move a courier's standing more than
  -- every honest rating put together.
  stars       smallint not null check (stars between 1 and 5),

  -- What they actually said. Optional — most people press a star and move on —
  -- and capped, because a text column with no ceiling is a place to put a
  -- payload rather than a sentence.
  comment     text not null default '' check (char_length(comment) <= 500),

  created_at  timestamptz not null default now()
);

-- The one query that runs on every write: recomputing a courier's average.
create index if not exists job_ratings_rider_idx on job_ratings (rider_id);

-- `riders.rating` stays, and stays a `double precision` average — every surface
-- that shows a courier already reads it, and this makes it true rather than
-- replacing it. What it needs beside it is the count, so the desk can tell 5.0
-- from one delighted customer apart from 4.6 from ninety.
alter table riders add column if not exists rating_count integer not null default 0;

-- Hubs: making the second branch possible without making it happen.
--
-- `LAUNDRY_HUB` in `packages/core/src/geo.ts` is one pair of coordinates and a
-- name, and roughly twenty places read it: every distance, every ETA, the rider
-- console's destination for the drop-off leg, the customer's live map, the
-- courier's live map, `priorityForBooking`'s distance input. Its own comment
-- says "change it in one place or not at all", which was exactly right while
-- there was one — and is the reason a second branch was a refactor rather than a
-- row.
--
-- This is the row. The constant stays and becomes the seed for the first hub, so
-- nothing that reads it today changes behaviour; what changes is that a job now
-- records *which* hub it went to, and distance is measured from that.
--
-- What this deliberately does not do is route between hubs, balance load across
-- them, or transfer a bag from one to another. Those are real problems and they
-- are not solved by a table. The point of stopping here is that the schema stops
-- being the thing in the way: a laundry that opens in Bomso can be represented,
-- and the routing question can be answered later on real data instead of
-- guessed at now.
create table if not exists hubs (
  -- Readable, like `riders.id`: `HUB-AYEDUASE`, not a UUID. It appears in logs
  -- and on the dispatch board.
  id          text primary key check (char_length(id) between 3 and 40),

  name        text not null check (char_length(name) between 1 and 120),
  address     text not null default '',

  -- Where it is. Two columns rather than a JSONB `Coords`, unlike
  -- `jobs.location`, because these are the thing distance is computed against
  -- and a numeric column can be indexed and compared — the nearest-hub query is
  -- arithmetic on these, not a projection out of JSON.
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),

  -- Which suburbs this branch collects from. An array rather than a join table
  -- because it is a short list of names from `SERVICE_SUBURBS` that the desk
  -- edits as a whole, and because nothing queries "which hubs serve Bomso"
  -- often enough to earn a second table.
  --
  -- Empty means "no stated area", which the nearest-hub fallback treats as
  -- eligible for everywhere — a single-branch operation should not have to fill
  -- in a coverage list to keep working.
  suburbs     text[] not null default '{}',

  -- Closed without being deleted. A hub with jobs against it cannot be removed
  -- without orphaning them, and a branch that shuts for refurbishment reopens.
  active      boolean not null default true,

  -- Exactly one hub is the fallback: the one a job goes to when nothing else
  -- decides, and the one every existing job is backfilled to. Enforced by the
  -- unique index below rather than by a check, because "exactly one" is a
  -- statement about the table and not about a row.
  is_default  boolean not null default false,

  created_at  timestamptz not null default now()
);

-- At most one default. A partial unique index on a constant is the standard way
-- to say "only one row may have this flag set".
create unique index if not exists hubs_single_default_idx on hubs ((is_default)) where is_default;

-- Seeded from the constant, so the first hub is the hub every existing job
-- already went to and no distance in the system changes meaning.
--
-- The coordinates are the ones in `geo.ts`, including its own warning that the
-- pin is the midpoint of the Ayeduase and Kotei anchors rather than a surveyed
-- point on the forecourt. Moving it is now an update to this row rather than a
-- deploy, which is most of the argument for the table.
insert into hubs (id, name, address, lat, lng, suburbs, is_default)
values (
  'HUB-AYEDUASE',
  'FreshFold Care Headquarters',
  'FreshFold Laundry Hub (Wagyingo Opal Hostel, Ayeduase-Kotei)',
  6.6625,
  -1.552,
  '{}',
  true
)
on conflict (id) do nothing;

-- Which branch handled a job.
--
-- Nullable, and read through a fallback to the default hub rather than
-- backfilled with an update. Two reasons: every job written before this ran went
-- to the only hub there was, so the fallback is not a guess; and a null here is
-- honest about the difference between "we recorded the branch" and "we inferred
-- it", which matters the moment there are two and somebody is auditing a
-- mis-sorted bag.
--
-- `on delete set null` for the reason `invoice_lines.job_id` has it: closing a
-- branch must not delete its history.
alter table jobs add column if not exists hub_id text references hubs(id) on delete set null;

-- "Everything that went through this branch" — the per-branch board, and the
-- query behind any comparison between two of them.
create index if not exists jobs_hub_idx on jobs (hub_id) where hub_id is not null;

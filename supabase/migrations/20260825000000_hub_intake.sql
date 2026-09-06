-- Counting the laundry, and recording who ran it through what.
--
-- Two tables for two gaps that are really one gap: nothing in this system has
-- ever recorded a fact about the physical work. The hub console advances a job
-- from "awaiting wash" to "awaiting press" and the record of that is a status
-- string and an audit line. Which machine ran the load, which batch it went in,
-- how many garments were in the bag when it arrived and how many came back out
-- — none of it existed anywhere.
--
-- The consequence is the one every laundry lives with. A customer says a shirt
-- came back stained, or did not come back at all, and there is nothing to check.
-- The manifest they are holding said "12 items", and that number was
-- `3 + ((charCodeAt((i + 2) % len) + i) % 8)` in `bagsForJob` — a hash of their
-- own booking reference, formatted as a count and printed on their receipt.
-- Nobody had counted anything. Weight was the same: a second hash of the same
-- digits, rendered to one decimal place with `kg` after it.
--
-- Those two fields are now absent until a person fills them in. This is where
-- what they fill in goes.

-- ---------------------------------------------------------------------------
-- What was in the bag
-- ---------------------------------------------------------------------------

-- Individual garments, recorded at the hub as the bag is emptied.
--
-- Deliberately not required for every garment. A hostel wash is thirty items
-- and a laundry that had to type thirty rows to check a bag in would stop
-- typing them by the second week, which is how a well-meant tracking scheme
-- becomes a table full of nulls. The per-bag count in `jobs.dispatch` is the
-- number that must always be taken; a row here is for the garments worth naming
-- — the ones a customer would notice, the ones that arrive already damaged, and
-- the ones somebody has said are missing.
--
-- That is what makes "you lost my blue shirt" answerable: not because every
-- sock is enumerated, but because a blue shirt is exactly the kind of thing
-- somebody writes down.
create table if not exists job_garments (
  id          text primary key,

  -- Cascades: a garment record is meaningless without the order it belongs to,
  -- and a deleted job should not leave rows pointing at nothing.
  job_id      text not null references jobs(id) on delete cascade,

  -- Which bag it came out of. Free text rather than a foreign key because bags
  -- live in `jobs.dispatch` as JSON — they are minted with the job and have no
  -- table of their own. Nullable for a garment recorded against the order as a
  -- whole, which is what a customer reporting a missing item gives you: they
  -- know what is missing, not which bag it should have been in.
  bag_id      text,

  -- "Blue oxford shirt", "child's red trainers". Written by whoever is holding
  -- it, so the words are theirs; capped because a description is a phrase.
  description text not null check (char_length(description) between 1 and 200),

  -- Noted on arrival, before anything is washed. This is the half that protects
  -- the laundry: a stain recorded at intake is a stain that was already there,
  -- and without a record every stain is arguably the laundry's.
  condition   text not null default '' check (char_length(condition) <= 300),

  -- True when this garment is the subject of a dispute — reported missing, or
  -- returned damaged. Set from the claims flow rather than at intake.
  flagged     boolean not null default false,

  -- The hub operator's name, as they are known on the roster. Not an id: the
  -- person who counted a bag two years ago may not be on the roster now, and the
  -- record should still say who it was.
  recorded_by text not null default '',

  created_at  timestamptz not null default now()
);

-- Every read of this table is "what was in this order", either at the hub desk
-- or from a supervisor answering a complaint.
create index if not exists job_garments_job_idx on job_garments (job_id);

-- ---------------------------------------------------------------------------
-- Who ran it, and through what
-- ---------------------------------------------------------------------------

-- One row per thing that physically happened to a load at the hub.
--
-- The audit trail already records *that* a supervisor confirmed a wash, and
-- that is genuinely useful — `hub.ts` even files its timed advances against
-- `system` so the honest answer to "who confirmed this" is available. What it
-- cannot record is anything about the work itself, because `audit_events` is a
-- log of decisions rather than of production.
--
-- A separate table rather than more columns on `jobs` because a job passes
-- through several of these and the interesting queries are across jobs, not
-- within one: "every load that went through machine 3 on Tuesday" is the query
-- you run when three customers report the same discolouration, and it is
-- unanswerable against a column that only holds the most recent value.
create table if not exists hub_events (
  id          text primary key,
  job_id      text not null references jobs(id) on delete cascade,

  -- Which step this records: `intake`, `wash`, `finish` or `quality_check`.
  -- Text rather than an enum so a laundry that adds a step — dry cleaning,
  -- a repair bench — does not need a migration to record it. Checked non-empty
  -- rather than checked against a list, for the same reason.
  stage       text not null check (char_length(stage) between 1 and 40),

  -- The machine, as the laundry labels it: "Washer 3", "Press 1". Optional,
  -- because an intake count and a quality check do not happen on a machine.
  machine     text not null default '' check (char_length(machine) <= 60),

  -- Which load it went in with. This is what makes a fault traceable sideways:
  -- one machine, one batch, four customers' bags, and a dye run affects all
  -- four. Optional for the same reason as `machine`.
  batch       text not null default '' check (char_length(batch) <= 60),

  -- Who did it. Their email is the identity the desk signs in with; the name is
  -- stored beside it because the email may be reassigned or revoked and the
  -- record should still read as a person.
  operator          text not null default '',
  operator_name     text not null default '',

  -- Anything the operator wanted to say about this step.
  notes       text not null default '' check (char_length(notes) <= 500),

  created_at  timestamptz not null default now()
);

-- "What happened to this order", in order — the query the supervisor answering
-- a complaint runs.
create index if not exists hub_events_job_idx on hub_events (job_id, created_at);

-- "Everything that went through this machine", which is the query that finds a
-- fault before the fourth customer reports it.
create index if not exists hub_events_machine_idx on hub_events (machine, created_at)
  where machine <> '';

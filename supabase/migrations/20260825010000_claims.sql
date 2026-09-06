-- Claims: an issue tracked to an outcome, rather than a message and a silence.
--
-- `IssueReporter` in the customer app is a careful piece of work — it takes a
-- reason, a note and a photograph, refuses a stock image, and files the lot into
-- the courier's message thread. And then nothing. There is no record that an
-- issue was raised, no state it can be in, nobody it is assigned to, no
-- authorisation to re-treat a garment, no compensation, and no way to close it.
-- A supervisor scrolling a chat log is the entire claims process.
--
-- Meanwhile the product promises otherwise. The care copy says a garment will be
-- "re-treated at our cost", which is a commitment with no workflow behind it: no
-- surface anywhere can record that the re-treatment was authorised, that it
-- happened, or that the customer was made whole.
--
-- This is the table that makes that promise keepable. It deliberately does not
-- replace the message thread — a customer reporting a problem wants to talk to
-- somebody, and that conversation is the right place for it. What it adds is the
-- half a conversation cannot do: a state, an owner, and an ending.
create table if not exists claims (
  id          text primary key,

  -- The order complained about. Cascades with it: a deleted job takes its
  -- claims, because a claim against nothing is not a claim.
  job_id      text not null references jobs(id) on delete cascade,

  -- Lower-cased, like `jobs.customer_email` and `job_ratings.customer_email`, so
  -- the three join without a function on either side.
  customer_email text not null,

  -- What kind of problem. The same five the app's reason chips offer, plus
  -- `other` for the ones that are not on a chip. Text rather than an enum so a
  -- new chip does not need a migration.
  kind        text not null check (char_length(kind) between 1 and 40),

  -- The customer's own words. Required: a claim with no description is a button
  -- press, and the desk cannot act on one.
  description text not null check (char_length(description) between 1 and 1000),

  -- What they attached, if anything. A URI rather than bytes — proof photos are
  -- already stored this way on `jobs.dispatch.proof`, and this follows it rather
  -- than inventing a second convention.
  photo       text,

  -- Where it has got to.
  --
  --   open         nobody has picked it up yet
  --   investigating  somebody has, and is looking
  --   upheld       the laundry accepts it; a remedy is owed
  --   rejected     the laundry does not accept it, with a reason
  --   resolved     the remedy has been delivered and the customer is whole
  --
  -- `upheld` and `resolved` are deliberately separate. Agreeing that a shirt was
  -- ruined and actually compensating for it are two events that can be days
  -- apart, and a single "closed" state would let the first be mistaken for the
  -- second — which is exactly the failure a claims process exists to prevent.
  status      text not null default 'open'
              check (status in ('open', 'investigating', 'upheld', 'rejected', 'resolved')),

  -- What the laundry decided, and why. Shown to the customer, so it is written
  -- for them rather than as an internal note.
  resolution  text not null default '' check (char_length(resolution) <= 1000),

  -- What was paid back, in cedis. Numeric rather than a float, for the reason
  -- every other money column here is: a compensation of 12.30 must be 12.30.
  --
  -- Zero is a real answer and not a missing one — a claim can be upheld and
  -- remedied by re-treating the garment, which costs the customer nothing and
  -- pays them nothing.
  compensation numeric(12, 2) not null default 0 check (compensation >= 0),

  -- The wallet movement that paid it, when one was made. Lets a supervisor get
  -- from the claim to the ledger row without matching on amounts and dates, and
  -- is what makes paying twice detectable.
  transaction_ref text,

  -- Whether a re-treatment was authorised — the thing the care copy promises.
  -- Separate from `compensation` because they are different remedies and a claim
  -- can have both.
  retreatment boolean not null default false,

  -- The supervisor who owns it. Empty while it is still in the open pool.
  handled_by  text not null default '',
  handled_by_name text not null default '',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- When it stopped being open. Null until it does, which makes "how long are we
  -- taking to settle these" a query rather than an estimate.
  closed_at   timestamptz
);

-- "Every claim on this order" — the supervisor opening a job, and the customer
-- looking at their own order screen.
create index if not exists claims_job_idx on claims (job_id);

-- "Everything this customer has raised", which is the context you want before
-- deciding a sixth one.
create index if not exists claims_customer_idx on claims (customer_email, created_at);

-- The desk's own queue: what is still open, oldest first. Partial, because the
-- settled ones are history and the open ones are work.
create index if not exists claims_open_idx on claims (created_at)
  where status in ('open', 'investigating', 'upheld');

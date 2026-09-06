-- Invoices, for the customers the product already refuses to take money from.
--
-- `SERVICES` carries an entry called "Corporate Contracts" — boutique hotels,
-- spas, fitness studios, corporate offices — marked `bookable: false` with the
-- price note "Custom Enterprise Quotes". So the marketing site sells to
-- businesses and the software cannot bill one: a grep for `invoice` returned
-- nothing, and every payment path in the system settles a single booking at the
-- moment it happens, by wallet, card or cash at the door.
--
-- That is fine for a student with one bag. It is not how a hotel buys laundry.
-- A hotel expects a month of collections on one document, thirty days to pay it,
-- a reference to quote, and a tax breakdown their own accountant can check.
--
-- Two tables: the invoice, and the lines on it. Lines are separate rather than
-- JSONB — unlike `recurring_pickups.items`, which is a template — because these
-- get summed, aged and reconciled, and because an invoice line is the one thing
-- here somebody may need to query across documents ("everything we billed the
-- Golden Tulip in March").
create table if not exists invoices (
  id          text primary key,

  -- The human reference: `INV-2026-0007`. Separate from `id` because it appears
  -- on a document a stranger's accounts department will quote back, and it has
  -- to be sequential and readable in a way an internal id does not.
  number      text not null unique,

  -- Who is being billed. An email rather than a foreign key to `accounts`,
  -- because a corporate customer may be billed before anybody there has made an
  -- account — the contract is with the organisation.
  bill_to_email text not null,
  bill_to_name  text not null default '',
  -- The registered name and address the invoice must carry to be one.
  bill_to_org   text not null default '',
  bill_to_address text not null default '',
  -- Their own tax number, which a business customer needs on the document to
  -- reclaim anything.
  bill_to_tin   text not null default '',

  -- What period this covers. Both dates, because "March" is ambiguous across a
  -- billing cycle that does not start on the first.
  period_start date,
  period_end   date,

  -- The money, all of it stored rather than recomputed.
  --
  -- An invoice is a statement of what was owed on the day it was issued. Tax
  -- rates move, prices move, and a document that recomputed itself would quietly
  -- restate a bill somebody has already paid — so the numbers are frozen here,
  -- and `tax_lines` keeps the working.
  net         numeric(12, 2) not null default 0 check (net >= 0),
  tax         numeric(12, 2) not null default 0 check (tax >= 0),
  total       numeric(12, 2) not null default 0 check (total >= 0),

  -- The levy-by-levy breakdown as `TaxLine[]`, frozen with the rates that
  -- produced it. JSONB because it is a snapshot for display, never joined on.
  tax_lines   jsonb not null default '[]'::jsonb,

  -- What has actually been received against it. Part payments are normal on a
  -- corporate account, so this is a running figure rather than a boolean.
  paid        numeric(12, 2) not null default 0 check (paid >= 0),

  --   draft   being assembled; not a document yet, and editable
  --   issued  sent to the customer; the numbers are now frozen
  --   paid    settled in full
  --   void    withdrawn
  --
  -- There is no `overdue`: that is a function of `due_on` and today, and storing
  -- it would mean a row whose status is wrong until something sweeps it.
  status      text not null default 'draft'
              check (status in ('draft', 'issued', 'paid', 'void')),

  -- Payment terms, as a date rather than a number of days, so the answer to
  -- "when is this due" does not depend on knowing when it was issued.
  due_on      date,

  issued_at   timestamptz,
  paid_at     timestamptz,

  notes       text not null default '' check (char_length(notes) <= 2000),

  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The customer's own documents, newest first — and the ageing report.
create index if not exists invoices_customer_idx on invoices (bill_to_email, created_at);

-- What is outstanding. Partial, because paid and void invoices are history and
-- the unpaid ones are the work.
create index if not exists invoices_outstanding_idx on invoices (due_on)
  where status = 'issued';

create table if not exists invoice_lines (
  id          text primary key,
  invoice_id  text not null references invoices(id) on delete cascade,

  -- The order this line bills for, when it bills for one. Null for a line
  -- somebody typed — a delivery surcharge, a contracted monthly minimum, a
  -- credit note against a complaint.
  --
  -- `on delete set null` rather than cascade, deliberately and unlike everywhere
  -- else in this schema: deleting a job must not silently remove a line from an
  -- invoice that has been issued and possibly paid. The description below stands
  -- on its own, so the line still reads correctly with the link gone.
  job_id      text references jobs(id) on delete set null,

  description text not null check (char_length(description) between 1 and 300),
  quantity    numeric(12, 2) not null default 1 check (quantity > 0),
  unit_price  numeric(12, 2) not null check (unit_price >= 0),
  amount      numeric(12, 2) not null check (amount >= 0),

  -- Ordering on the document. Explicit rather than by `created_at`, because a
  -- draft gets lines added and removed and the sequence is the desk's choice.
  position    integer not null default 0,

  created_at  timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id, position);

-- "Has this order already been billed?" — the check that stops one collection
-- appearing on two invoices, which is the mistake that costs a corporate
-- relationship.
create index if not exists invoice_lines_job_idx on invoice_lines (job_id)
  where job_id is not null;

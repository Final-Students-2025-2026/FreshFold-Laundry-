-- Enquiries: the contact form's message, kept rather than handed off.
--
-- `Contact.tsx` answered "Send it" by building a `mailto:` URL and assigning it
-- to `window.location.href`. That is a handoff, not a submission, and it fails
-- in a way nothing on either side can see: assigning an unregistered protocol
-- is a silent no-op in a desktop browser — no dialog, no navigation, no console
-- error — while the form goes on to announce "Your mail app is open with the
-- message ready to send" and clear the fields. A visitor without a mail client
-- got a confident confirmation and an enquiry that reached nobody, and the
-- laundry had no way to know it had happened. It cannot be feature-detected,
-- which is why the fix is a route rather than a better message.
--
-- The row is the record and the email is the notification, in that order. The
-- desk's copy is sent after this row is committed, so a provider outage costs a
-- notification rather than an enquiry — `delivered` below is what says which
-- ones that happened to.
--
-- Deliberately not an account, a ticket or a thread. Somebody asking what a
-- duvet costs is not opening a case, and `claims` already exists for a problem
-- that needs a state and an owner. This is a message with a name on it.
create table if not exists enquiries (
  id text primary key,

  -- Bounded here as well as in the route, because the check constraint is the
  -- one that holds when a second caller learns the endpoint.
  name    text not null check (char_length(name) between 1 and 120),

  -- Optional on the form, so empty rather than null — the same convention the
  -- rest of this schema uses for a string nobody filled in. When it is set it
  -- becomes the Reply-To on the desk's copy, which is the whole reason the
  -- field is worth having: without it a reply has nowhere to go.
  email   text not null default '' check (char_length(email) <= 200),

  -- What they actually wrote. Two thousand characters is well past anything the
  -- form's five-row textarea invites and short of a paste of a whole document.
  message text not null check (char_length(message) between 1 and 2000),

  -- Whether the desk's copy reached the mail provider.
  --
  -- False does not mean the enquiry was lost — it is on this table either way.
  -- It means nobody was told about it, which makes the undelivered ones a list
  -- somebody has to read by hand rather than a silence.
  delivered boolean not null default false,

  created_at timestamptz not null default now()
);

-- Newest first, which is the only order the desk reads these in.
create index if not exists enquiries_recent_idx on enquiries (created_at desc);

-- The ones nobody was emailed about. Partial, because it is a fault list rather
-- than a view of the table: on a healthy deployment it is empty.
create index if not exists enquiries_undelivered_idx on enquiries (created_at)
  where not delivered;

-- Supabase grants anon and authenticated privileges on public tables by default
-- and serves them over PostgREST. This one holds names, addresses and whatever
-- a stranger chose to write to a laundry, which is not a public list.
alter table enquiries enable row level security;

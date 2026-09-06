-- Row-level security on the fourteen tables that were added without it.
--
-- The initial schema turned RLS on for the eight tables that existed then, and
-- said why in a comment that is worth repeating rather than pointing at:
--
--   Enabling RLS with **no policies at all** denies every request that arrives
--   as `anon` or `authenticated`, which is exactly right here: nothing is
--   supposed to reach these tables that way. The dispatch server connects over
--   the Postgres wire protocol as the table owner, and an owner bypasses RLS
--   unless the table is set to FORCE — so the server keeps full access and
--   loses nothing.
--
-- Every migration since has added tables and not repeated those two words. That
-- is not a judgement anybody made; it is a line nobody remembered, fourteen
-- times. The comment asked to be maintained and nothing enforced it, so this
-- backfills the tables and `apps/server/src/schema.check.ts` now fails the build
-- when a `create table` lands without a matching `enable row level security`.
--
-- What this is defending against, stated plainly, because "enable RLS" is easy
-- to apply as a ritual: Supabase grants the `anon` and `authenticated` roles
-- privileges on tables in `public` by default and publishes them over PostgREST.
-- The anon key is designed to be embedded in client code — it is public by
-- construction. No FreshFold client holds it today, which is the only reason
-- this is a latent hole rather than an open one. Between them these tables carry
-- every invoice, every complaint with its photographs, every promo code and who
-- redeemed it, every standing order with the home address it collects from, and
-- the whole audit trail. Several are writable.
--
-- Nothing here changes what the dispatch server can do. If a client is ever
-- given direct Supabase access — to replace the four-second polling with
-- Realtime, say — this is the line to revisit, and revisiting it means writing
-- policies, not deleting these statements.

-- Money and the documents that ask for it.
alter table invoices                enable row level security;
alter table invoice_lines           enable row level security;

-- Promotions: the codes themselves, and who has already spent one.
alter table promo_codes             enable row level security;
alter table promo_redemptions       enable row level security;

-- What a customer said went wrong, and the photographs attached to it.
alter table claims                  enable row level security;

-- Standing orders. Each row is a home address and a weekly time somebody is
-- reliably out, which is a different kind of sensitive from the rest of this.
alter table recurring_pickups       enable row level security;

-- The laundry's own floor: where a load is, and what was done to it.
alter table hubs                    enable row level security;
alter table hub_events              enable row level security;
alter table job_garments            enable row level security;

-- Couriers: their shifts, and what customers said about them.
alter table rider_shifts            enable row level security;
alter table job_ratings             enable row level security;

-- The trail. Reading it is reading every supervisor action, by name, with the
-- customer and the amount attached; writing it is forging that record.
alter table audit_events            enable row level security;

-- Bearer grants. Both store digests rather than tokens, so neither is a
-- credential in the clear — but a row here is still the fact that a particular
-- address has an outstanding link, and `booking_setup_tokens` carries the
-- address itself.
alter table booking_setup_tokens    enable row level security;
alter table booking_tracking_tokens enable row level security;

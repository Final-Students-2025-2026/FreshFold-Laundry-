-- ---------------------------------------------------------------------------
-- Which account a booking belongs to, as distinct from who to contact about it
-- ---------------------------------------------------------------------------
--
-- A customer's own orders used to be found by matching `customer_email` OR
-- `customer_phone_key`. The number half of that has been removed: nothing in
-- this system proves that the phone number on an account belongs to the person
-- holding it — registration takes it as a plain field and no confirmation is
-- ever sent to it — so it was an ownership credential anybody could assert, and
-- asserting somebody else's was enough to read their addresses and all three
-- hand-off codes.
--
-- Removing it left one honest case with nothing holding it up. Both booking
-- forms let a signed-in customer edit the contact address on their own booking,
-- because ordering a collection for a flatmate is a real thing to do. Those
-- orders matched on the number before. Without it they would be missing from
-- the history of the very account that placed them.
--
-- So the two ideas that were being conflated are separated here. `customer ->>
-- 'email'` stays what it has always been: where the confirmation goes, and who
-- the desk writes to. `customer ->> 'ownerEmail'` is the account that placed
-- the booking, written server-side from the session by `bookingToJob` and never
-- read off a request body.
--
-- Generated rather than a plain column, for the same two reasons `customer_email`
-- and `customer_phone_key` are. The value already travels inside the `customer`
-- jsonb that `jobs.upsert` writes whole, so there is no second write to keep in
-- step and no way for the column and the record to disagree. And `lower()`
-- matches how `customer_email` is derived, so the two can be compared against
-- one lowercased parameter in the same `where` clause.
--
-- Null on every job written before this existed, and on every guest booking
-- after it — a guest has no account to name. Both are matched on the contact
-- address exactly as they always were, so nothing needs backfilling.

alter table jobs
  add column if not exists owner_email text generated always as (
    lower(customer ->> 'ownerEmail')
  ) stored;

-- `GET /api/bookings` ORs this against `customer_email`, so it wants the same
-- index that one has. Partial: the column is null for guests and for history,
-- which is most of the table, and none of those rows can ever match a lookup.
create index if not exists jobs_owner_email_idx on jobs (owner_email)
  where owner_email is not null;

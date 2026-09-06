-- ---------------------------------------------------------------------------
-- One customer's orders, found the same way on every surface
-- ---------------------------------------------------------------------------
--
-- `GET /api/bookings?email=` matched on `customer_email` alone, so the customer
-- app only ever saw jobs booked under the exact address on the account. The
-- website's portal did not use that filter at all: it pulled the whole ledger
-- and matched `email OR samePhone(phone)` in the browser, which meant a booking
-- placed as a guest — same person, same number, a different address typed into
-- the form — appeared in the portal and was missing from the app.
--
-- Matching on the number as well is the behaviour worth keeping, so this gives
-- the server the column to do it with. Same expression as `accounts.phone_key`
-- and `riders.phone_key`, which mirrors phoneKey() in @freshfold/core: 0244567801,
-- +233 244 567 801 and 233244567801 all reduce to 244567801, and anything
-- shorter than nine digits reduces to NULL so a half-typed number matches
-- nothing.

alter table jobs
  add column if not exists customer_phone_key text generated always as (
    nullif(right(regexp_replace(customer ->> 'phone', '[^0-9]', '', 'g'), 9), '')
  ) stored;

create index if not exists jobs_customer_phone_key_idx on jobs (customer_phone_key);

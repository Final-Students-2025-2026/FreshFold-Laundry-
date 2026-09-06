-- ---------------------------------------------------------------------------
-- Email verification, for customer accounts only
-- ---------------------------------------------------------------------------
--
-- Couriers and supervisors are deliberately not covered. Both are provisioned
-- by the company rather than self-registered — a courier signs in with an
-- employee ID and a PIN and may have no email at all — so there is nothing for
-- a confirmation link to prove about them. `riders` and `supervisors` get no
-- columns here.
--
-- The token is stored as a sha-256 digest, never in the clear. It arrives in a
-- URL, so it ends up in browser history, in any mail scanner between here and
-- the customer, and in the referrer of whatever the landing page loads. A
-- database leak should not also hand over the ability to confirm addresses.

alter table accounts
  -- Nothing has been confirmed until somebody clicks a link.
  add column if not exists email_verified            boolean not null default false,
  -- Both null once verification succeeds, so a spent link cannot be replayed.
  add column if not exists verification_token_hash   text,
  add column if not exists verification_expires_at   timestamptz,
  -- Rate-limits the resend button. Null means "never sent one".
  add column if not exists verification_sent_at      timestamptz;

-- ---------------------------------------------------------------------------
-- Grandfathering
-- ---------------------------------------------------------------------------
--
-- Every account that already exists is treated as verified. The alternative is
-- shipping this migration and instantly blocking every existing customer from
-- booking over an email that was never asked for — a self-inflicted outage, and
-- one that lands on exactly the people who have already paid.
--
-- Accounts created from this point start false, because `default false` above
-- applies to inserts and this statement runs once.
update accounts set email_verified = true where email_verified = false;

-- The lookup the confirmation link performs. Partial, because a row with no
-- outstanding token is not a row this index ever needs to answer for.
create index if not exists accounts_verification_token_idx
  on accounts (verification_token_hash)
  where verification_token_hash is not null;

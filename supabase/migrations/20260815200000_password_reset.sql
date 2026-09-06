-- ---------------------------------------------------------------------------
-- Password reset, for customer accounts only
-- ---------------------------------------------------------------------------
--
-- Same audience and the same reasoning as email verification: couriers and
-- supervisors are provisioned, so `riders` and `supervisors` get no columns
-- here. A courier who forgets a PIN is reissued one by the desk.
--
-- Before this, a forgotten password was permanent. `/auth/register` refuses an
-- address that already has a hash, and the lookup behind it matches on phone
-- number too, so the customer could not even re-register around it — their own
-- contact details were held by an account they could no longer open, along with
-- their wallet balance, their loyalty points and their membership.
--
-- The token is stored as a sha-256 digest for the reason the verification one
-- is: it travels in a URL, so it lands in browser history and in every mail
-- scanner along the way. This one is stronger than a confirmation link — it
-- takes over an account rather than confirming an address — which is why it
-- lives for one hour rather than twenty-four.

alter table accounts
  -- All three null when no reset is outstanding, and cleared the moment one is
  -- spent, so a link in an inbox cannot be replayed a second time.
  add column if not exists reset_token_hash  text,
  add column if not exists reset_expires_at  timestamptz,
  -- Rate-limits requests per account. Null means "never asked for one".
  add column if not exists reset_sent_at     timestamptz;

-- The lookup the reset link performs. Partial, for the same reason the
-- verification index is: a row with no outstanding token never answers it.
create index if not exists accounts_reset_token_idx
  on accounts (reset_token_hash)
  where reset_token_hash is not null;

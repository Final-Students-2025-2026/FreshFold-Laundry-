-- Sessions stop holding the bearer token itself.
--
-- Every other token in this system is stored as a digest and has been from the
-- day it was added: `booking_setup_tokens.token_hash`,
-- `booking_tracking_tokens.token_hash`, `accounts.verification_token_hash`,
-- `accounts.reset_token_hash`. Each carries a comment explaining that the row is
-- the grant and only the digest belongs in it.
--
-- `sessions.token` was the exception, and it is the one that matters most: it is
-- the credential every request carries, for customers, couriers and the desk
-- alike. Anyone who read this table once — a support export, a stray backup, a
-- read-only replica, a future SQL injection — held live working sessions for
-- everybody signed in, for as long as those had left to run, with nothing in any
-- log to say they had been used by somebody else.
--
-- The server hashes with SHA-256 before it looks a token up. That is the right
-- construction here and a KDF would be the wrong one: the token is 32 bytes from
-- `randomBytes`, so there is no low-entropy secret to slow an attacker down
-- around, and a per-request scrypt would make every authenticated call pay for
-- protection it does not need.
--
-- **Nobody is signed out by this.** The digest of an existing token can be
-- computed from the token already in the column, so the rows convert in place
-- and the phone in a courier's pocket keeps working. That is the whole reason
-- for the `update` below rather than a `truncate`.

alter table sessions rename column token to token_hash;

-- `sha256()` is built into Postgres 11+; Supabase is well past that. Existing
-- values are the raw tokens, so this is exactly what the server will compute
-- when the same token next arrives in an Authorization header.
update sessions set token_hash = encode(sha256(token_hash::bytea), 'hex');

-- The column was already the primary key, so lookups by digest are indexed and
-- uniqueness still holds — two distinct tokens cannot collide into one row.
comment on column sessions.token_hash is
  'SHA-256 of the bearer token, hex. The token itself is returned to the client once, at sign-in, and is not recoverable from here.';

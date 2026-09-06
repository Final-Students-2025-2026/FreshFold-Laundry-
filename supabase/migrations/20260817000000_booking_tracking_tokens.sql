-- ---------------------------------------------------------------------------
-- Tracking links — how a guest reaches their own order
-- ---------------------------------------------------------------------------
--
-- Every read of a booking now needs a session, which leaves out the one caller
-- the funnel is built around: a stranger who filled in the form. They have no
-- account, and the confirmation email invites them to open one — but the pickup
-- is on the board before they get round to it, and they need to see it. They
-- also need the collection code, which is what they read out to the courier at
-- the door.
--
-- Before this, guests were served by leaving the read routes open. `FFC-######`
-- is six digits, so that was not a guest reading their own order so much as
-- anybody reading anybody's, hand-off codes included.
--
-- So a booking hands back a token when it is created, and that token is the
-- right to read *that one* booking. Same shape as `booking_setup_tokens` next
-- door, and for the same reasons: the row is the grant, and only the digest is
-- stored.
--
-- Two differences from the setup link. This one is not single-use — it is read
-- on every poll for the life of the order — and it does not open an account, so
-- the worst a leaked one costs is one booking's detail rather than a login.

create table if not exists booking_tracking_tokens (
  -- sha-256 of the token handed to the client. It travels in a request header
  -- rather than a URL, unlike the setup and reset links, so it stays out of
  -- browser history and out of the referrer of anything the page loads. The
  -- digest is stored anyway: a dump of this table should not be a set of
  -- working credentials.
  token_hash text primary key,

  -- `on delete cascade` because a token for an order the desk has removed
  -- grants nothing, and the row would outlive what it points at.
  booking_id text not null references jobs (id) on delete cascade,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Issuing a token retires any earlier one for the same booking, which is a
-- delete by booking rather than by digest.
create index if not exists booking_tracking_tokens_booking_idx
  on booking_tracking_tokens (booking_id);

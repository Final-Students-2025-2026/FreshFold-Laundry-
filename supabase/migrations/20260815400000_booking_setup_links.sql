-- ---------------------------------------------------------------------------
-- Setup links — turning a booking into a login
-- ---------------------------------------------------------------------------
--
-- A guest books a pickup and is emailed a link that lets them choose the
-- password for the patron portal. Until now that link carried nothing but the
-- booking reference, and `FFC-######` is six digits: anybody could walk the
-- space against the public `GET /api/bookings/:id`, find a real order, and
-- claim its account — because a booking has no password on it yet, and
-- `/auth/register` is designed to let the customer set the first one.
--
-- So the link carries a 32-byte random token instead, and this is where its
-- digest lives.
--
-- A table rather than columns on `jobs`, for two reasons. A booking is upserted
-- whole on every replay of the web app's offline queue, and a token column
-- would be overwritten by the copy of the record the browser happens to be
-- holding. And the row is the token: spending a link deletes it, which is a
-- single statement no concurrent claim can interleave with — two tabs
-- submitting the same link race at the `delete ... returning`, and exactly one
-- of them comes back with a row.

create table if not exists booking_setup_tokens (
  -- sha-256 of the token in the email. The raw value exists in the message and
  -- nowhere else, for the reason the verification and reset digests do: it
  -- travels in a URL, so it lands in browser history and in every mail scanner
  -- between here and the customer.
  token_hash text primary key,

  -- The booking the link opens. `on delete cascade` because a link to an order
  -- the desk has removed opens nothing, and an orphan row here is a credential
  -- for an account that would be created from a job that no longer exists.
  booking_id text not null references jobs (id) on delete cascade,

  -- The address the link was sent to, recorded at issue time. The claim reads
  -- the booking for the customer's details, so this is not what the account is
  -- built from — it is what says where this particular link went, after the
  -- fact, when somebody asks.
  email      text not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- One live link per booking: issuing a new one clears the old, which is a
-- delete by booking rather than by digest.
create index if not exists booking_setup_tokens_booking_idx
  on booking_setup_tokens (booking_id);

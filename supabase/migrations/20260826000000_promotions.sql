-- Promo codes, vouchers and referrals: the acquisition side of the ledger.
--
-- Loyalty tiers and membership plans have existed since the schema was written,
-- and both are retention mechanics — they reward somebody who is already a
-- customer for staying one. There was nothing at all for getting somebody to
-- become one. A grep for `coupon`, `promo`, `voucher` or `referral` across the
-- whole repository returned nothing: no launch offer, no student discount, no
-- "refer a friend", no way for the desk to make good on a bad week with a code.
--
-- Which is a strange gap for a business whose customers are students on a campus,
-- because word of mouth in a hall of residence is the entire marketing channel.
--
-- Two tables. The code itself, and every use of it — because a code with a limit
-- on it is only limited if the uses are counted somewhere, and because "who
-- redeemed this and what did it cost us" is the only question that tells you
-- whether a campaign worked.

-- ---------------------------------------------------------------------------
-- The codes
-- ---------------------------------------------------------------------------

create table if not exists promo_codes (
  -- The code as typed, upper-cased. The primary key *is* the code: there is no
  -- surrogate id, because a promo code is already a short unique string that
  -- people type, and a second identifier beside it would only create a way for
  -- the two to disagree.
  --
  -- Upper-cased on the way in by the server so `freshers24` and `FRESHERS24`
  -- are one code rather than two — customers do not think of a code as
  -- case-sensitive and will not type it that way.
  code        text primary key check (char_length(code) between 3 and 32),

  -- What the desk calls it internally. "Freshers week 2026", "Apology — burst
  -- pipe Tuesday". Not shown to the customer.
  label       text not null default '' check (char_length(label) <= 120),

  -- `percent` takes a share off the bill; `amount` takes a fixed number of
  -- cedis. Two kinds rather than one, because they fail differently and the
  -- difference matters: 20% off a ₵30 wash is ₵6, and ₵20 off it is most of the
  -- order. A campaign wants one or the other deliberately.
  kind        text not null check (kind in ('percent', 'amount')),

  -- For `percent`, a fraction: 0.15 is 15%. For `amount`, cedis.
  --
  -- `numeric` rather than a float for the same reason every money column here
  -- is one, and it holds the percent too so a single column serves both kinds
  -- without a second nullable one that is always null for half the rows.
  value       numeric(12, 4) not null check (value > 0),

  -- The most a percentage code can take off one booking, in cedis. Null for no
  -- ceiling. This is what stops "20% off everything" being an unbounded
  -- liability the first time somebody books a ₵180 office clean — a percentage
  -- with no cap is a promise whose cost nobody has estimated.
  max_discount numeric(12, 2) check (max_discount is null or max_discount > 0),

  -- The smallest order it applies to. Zero for none. Stops a ₵20-off code being
  -- spent on a ₵25 booking, which is a campaign that loses money per redemption.
  min_spend   numeric(12, 2) not null default 0 check (min_spend >= 0),

  -- When it works. Null `starts_at` means immediately; null `expires_at` means
  -- until somebody withdraws it. Both null is a permanent code, which is a
  -- legitimate thing for a standing student discount to be.
  starts_at   timestamptz,
  expires_at  timestamptz,

  -- Total redemptions allowed across everybody. Null for unlimited.
  max_uses    integer check (max_uses is null or max_uses > 0),

  -- Redemptions allowed per customer. One by default, which is what almost every
  -- campaign means and what nobody remembers to say.
  max_per_customer integer not null default 1 check (max_per_customer > 0),

  -- Whether it is for new customers only. The commonest condition on an
  -- acquisition code and the one most easily got wrong by hand — "first order"
  -- is checked against the customer's booking history at redemption time.
  first_order_only boolean not null default false,

  -- Withdrawn without being deleted. A code that has been redeemed cannot be
  -- deleted without orphaning the redemptions that record what it cost, so the
  -- desk switches it off instead.
  active      boolean not null default true,

  created_by  text not null default '',
  created_at  timestamptz not null default now()
);

-- The desk's list: what is running now.
create index if not exists promo_codes_active_idx on promo_codes (active, expires_at)
  where active;

-- ---------------------------------------------------------------------------
-- Who used what
-- ---------------------------------------------------------------------------

create table if not exists promo_redemptions (
  id          text primary key,

  -- Cascades with the code only if the code is deleted, which the desk is
  -- steered away from doing by `active` above.
  code        text not null references promo_codes(code) on delete cascade,

  -- Cascades with the job: a redemption against a booking that no longer exists
  -- records nothing useful.
  job_id      text not null references jobs(id) on delete cascade,

  -- Lower-cased, matching `jobs.customer_email` and `claims.customer_email`.
  customer_email text not null,

  -- What it actually took off, in cedis, after the cap and the floor. Recorded
  -- rather than recomputed, because the code's terms can change afterwards and
  -- the campaign's cost is what it cost on the day.
  discount    numeric(12, 2) not null check (discount >= 0),

  created_at  timestamptz not null default now(),

  -- One redemption per code per booking. This is the constraint that makes the
  -- per-customer and total limits mean anything: without it a replayed offline
  -- write would file the same redemption twice and burn two of a customer's one.
  unique (code, job_id)
);

-- "How many times has this been used, and by whom" — the two limit checks, and
-- the campaign report.
create index if not exists promo_redemptions_code_idx on promo_redemptions (code);
create index if not exists promo_redemptions_customer_idx
  on promo_redemptions (code, customer_email);

-- ---------------------------------------------------------------------------
-- Referrals
-- ---------------------------------------------------------------------------

-- Every account gets a code of its own to hand out.
--
-- On the account rather than in a table of its own because it is one column and
-- one-to-one with the row it would join to — a `referral_codes` table would be
-- `accounts` with extra steps. Nullable because every account that already
-- exists has none until the server mints one, which it does lazily the first
-- time somebody asks for theirs.
alter table accounts add column if not exists referral_code text;

-- Who introduced this customer. The referrer's *email*, not their code, because
-- a code could in principle be reissued and the relationship is between people.
-- Set once, at registration, and never rewritten — which is what stops a
-- customer collecting a second referral bonus by claiming a second referrer.
alter table accounts add column if not exists referred_by text;

-- When the referrer's reward was paid, so it is paid once. Null until the
-- referred customer's first order completes, which is the event that earns it —
-- rewarding a registration rewards making accounts, and somebody will.
alter table accounts add column if not exists referral_rewarded_at timestamptz;

-- The code has to be unique to be a code at all. A partial unique index rather
-- than a column constraint so the nulls on existing rows do not collide with
-- each other.
create unique index if not exists accounts_referral_code_idx
  on accounts (referral_code) where referral_code is not null;

-- "Who did this customer bring in", for the referrer's own screen.
create index if not exists accounts_referred_by_idx on accounts (referred_by)
  where referred_by is not null;

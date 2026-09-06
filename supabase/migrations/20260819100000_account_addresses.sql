-- ---------------------------------------------------------------------------
-- The saved address book moves onto the account
-- ---------------------------------------------------------------------------
--
-- A customer's saved pickup addresses have never been FreshFold's record of
-- anything. The app kept them in AsyncStorage under `freshfold_addresses`, so
-- the book belonged to a handset rather than to a person: the same customer on
-- the website saw none of it, the same customer on a second phone saw none of
-- it, and reinstalling the app erased the lot. Meanwhile the patron portal on
-- the website showed a suburb dropdown, an address line and a hostel field
-- above a Save button whose entire implementation was to print "Settings
-- updated successfully!" — because there was nowhere for it to write.
--
-- Both surfaces already re-read `UserAccount` off a poll every few seconds, so
-- putting the book on the account is all that "an address saved on my phone
-- shows up on the website, and the other way round" requires. No new endpoint,
-- no new sync path: `PUT /api/accounts` gains one writable field and the two
-- existing polls carry it.
--
-- jsonb rather than a table of its own. The book is read and written whole —
-- every save rewrites the array, because that is how "exactly one default"
-- stays true without a second round trip — it is never queried across
-- customers, and it is never joined to. `jobs.customer` and `riders.coords`
-- are stored the same way for the same reason.
--
-- `not null default '[]'` rather than nullable, unlike `points` and
-- `wallet_balance` beside it. Those two distinguish "no balance recorded" from
-- "zero", and the portal renders them differently. A book has no such
-- distinction: no addresses and an empty array are the same state, and giving
-- it two spellings would only mean every reader having to handle both.

alter table accounts
  add column if not exists addresses jsonb not null default '[]'::jsonb;

-- The shape the server writes and both apps read: an array of objects, each
-- with an id, label, address and suburb, and optionally a city and a `coords`
-- pin. Enforced in `normaliseAddresses` in @freshfold/core, which the route
-- runs on the way in — this constraint is only the floor under it, catching a
-- write that reached the column by some other path (a migration, a repair done
-- by hand at the psql prompt) with something that is not a book in it.
--
-- Deliberately shallow. Validating each entry's keys in SQL would duplicate the
-- normaliser in a second language, and the two would drift the first time a
-- field was added.
alter table accounts
  drop constraint if exists accounts_addresses_is_array;

alter table accounts
  add constraint accounts_addresses_is_array
  check (jsonb_typeof(addresses) = 'array');

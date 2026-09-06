/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The saved address book.
 *
 * One customer, one book, written by three surfaces: the app's settings screen,
 * the app's booking form (which offers to save the address it just collected),
 * and the patron portal on the website. It is stored on the account, so all
 * three are writing the same array — and the rules for what that array may
 * contain therefore have to be one set of rules rather than three.
 *
 * `normaliseAddresses` is those rules. The server runs it on the way in, so it
 * is authoritative; the clients run it on their optimistic copy, so the row
 * that appears the instant a customer presses Save is the row the poll brings
 * back a moment later rather than a slightly different one that flickers.
 */

import type { Coords, SavedAddress } from './types';

/**
 * How many a customer may keep.
 *
 * A book is a convenience, not storage: the whole array is rewritten on every
 * save and travels inside every `/auth/me` response, which both apps poll every
 * four to five seconds. Somebody scripting a thousand entries into it would be
 * adding that to a request each surface makes twelve times a minute, which is
 * why there is a ceiling at all. Twelve is well past what a person who moves
 * between a hostel, a family house and an office actually needs.
 */
export const MAX_SAVED_ADDRESSES = 12;

/** What to say when the ceiling is reached. One wording, everywhere. */
export const ADDRESS_LIMIT_MESSAGE = `An account can keep ${MAX_SAVED_ADDRESSES} saved addresses. Remove one to add another.`;

/**
 * The longest any one field may be.
 *
 * Generous for a Ghanaian address — "Gaza Hostel, Block C, Room 304, off the
 * Ayeduase New Site road" is 66 — and short enough that the column cannot be
 * used as a place to park a payload. Over-length text is cut rather than
 * refused: a truncated landmark still gets a courier to the gate, and refusing
 * the whole save would lose the other addresses in the array with it.
 */
const MAX_FIELD_LENGTH = 200;

/** Trimmed, collapsed to single spaces, and cut to length. */
function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LENGTH);
}

/**
 * A pin, or nothing.
 *
 * Both halves have to be real finite numbers in range. A `NaN` here is not a
 * cosmetic problem: `coords` is what the courier's map routes to and what the
 * distance-based part of the price is measured from, so a malformed pin is a
 * booking that cannot be quoted. Dropping it falls back to the point derived
 * from the suburb, which is the same thing an address saved before pins existed
 * does.
 */
function coords(value: unknown): Coords | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;

  return { lat, lng };
}

/**
 * Whatever a client sent, as a book this product can use.
 *
 * Deliberately total: it takes `unknown` and always returns an array, because
 * the two callers want that. The server is handed a parsed request body it has
 * no reason to trust, and a client is handed whatever an older build of itself
 * left in storage. Neither wants an exception — the server wants to write
 * something safe, and the app wants to render something.
 *
 * What it guarantees, in order:
 *
 *  - An array, capped at {@link MAX_SAVED_ADDRESSES}.
 *  - Every entry has an id, a label, an address and a suburb. An entry missing
 *    the address or the suburb is dropped rather than saved blank: those two are
 *    what a courier is given, and an entry that cannot be driven to is not an
 *    address. A missing label is filled from the suburb instead of dropping the
 *    entry, because a label is only what the customer calls it.
 *  - Ids are unique. A duplicate is the client's bug, and keeping the later
 *    entry matches the edit-in-place the array rewrite is meant to express.
 *  - Exactly one default, when there is anything to default to. The first entry
 *    claiming it keeps it; if nobody claims it, the first entry gets it — a book
 *    with no default would make the booking form ask which address to use every
 *    single time.
 */
export function normaliseAddresses(input: unknown): SavedAddress[] {
  if (!Array.isArray(input)) return [];

  const byId = new Map<string, SavedAddress>();

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;

    const raw = entry as Partial<SavedAddress>;
    const id = text(raw.id);
    const address = text(raw.address);
    const suburb = text(raw.suburb);

    if (!id || !address || !suburb) continue;

    const city = text(raw.city);
    const pin = coords(raw.coords);

    const saved: SavedAddress = {
      id,
      label: text(raw.label) || suburb,
      address,
      suburb,
      isDefault: raw.isDefault === true,
    };

    // Optional fields are omitted rather than set to undefined: this array is
    // serialised into a jsonb column and compared by `JSON.stringify` on both
    // clients to decide whether anything changed, and `{"city": null}` against
    // an absent key reads as a change when nothing changed.
    if (city) saved.city = city;
    if (pin) saved.coords = pin;

    // A later duplicate wins, and takes the earlier one's position — `set` on
    // an existing key keeps insertion order — so the book does not reshuffle
    // under the customer because two surfaces raced.
    byId.set(id, saved);
  }

  const book = [...byId.values()].slice(0, MAX_SAVED_ADDRESSES);
  if (book.length === 0) return book;

  const claimed = book.findIndex((saved) => saved.isDefault);
  const chosen = claimed === -1 ? 0 : claimed;

  return book.map((saved, at) => (at === chosen ? { ...saved, isDefault: true } : { ...saved, isDefault: false }));
}

/**
 * The address a booking should offer first.
 *
 * The default if there is one, otherwise the first — the same fallback the app
 * used when the book lived on the device, kept here so the website's portal
 * picks the same entry the app would.
 */
export function defaultAddress(addresses: SavedAddress[] | undefined): SavedAddress | null {
  if (!addresses?.length) return null;
  return addresses.find((saved) => saved.isDefault) ?? addresses[0] ?? null;
}

/**
 * Whether two books are the same book.
 *
 * Both clients hold an optimistic copy and re-apply whatever the next poll
 * hands back. Without a comparison that ignores nothing but ordering-stable
 * serialisation, every poll would look like a change and re-render the settings
 * screen under whoever was typing in it.
 */
export function sameAddresses(
  a: SavedAddress[] | undefined,
  b: SavedAddress[] | undefined
): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/**
 * Adds an address to a book, or replaces the entry it shares an id with.
 *
 * The merge every surface's Save button wants, in one place. `isDefault` on the
 * incoming entry is honoured — the normaliser clears it from the others — so
 * "make this my default" is the same call as "save this".
 *
 * Returns the book unchanged when it is full and this would be a new entry, so
 * a caller can compare lengths to decide whether to show
 * {@link ADDRESS_LIMIT_MESSAGE}.
 */
export function withAddress(
  addresses: SavedAddress[] | undefined,
  address: SavedAddress
): SavedAddress[] {
  const book = addresses ?? [];
  const existing = book.some((saved) => saved.id === address.id);

  if (!existing && book.length >= MAX_SAVED_ADDRESSES) return normaliseAddresses(book);

  // The incoming entry takes the position of the one it replaces, so editing an
  // address does not move it to the bottom of the customer's list.
  const merged = existing
    ? book.map((saved) => (saved.id === address.id ? address : saved))
    : [...book, address];

  // A new entry claiming the default, or an edit claiming it, has to clear the
  // flag from everyone else before the normaliser picks the first claimant —
  // otherwise the old default is found first and the customer's choice is lost.
  const deduped = address.isDefault
    ? merged.map((saved) => (saved.id === address.id ? saved : { ...saved, isDefault: false }))
    : merged;

  return normaliseAddresses(deduped);
}

/**
 * Removes an address, and hands the default to whatever is left.
 *
 * The re-defaulting is the normaliser's, not this function's — it promotes the
 * first entry when nobody claims the flag, which is exactly what deleting the
 * default should do.
 */
export function withoutAddress(
  addresses: SavedAddress[] | undefined,
  id: string
): SavedAddress[] {
  return normaliseAddresses((addresses ?? []).filter((saved) => saved.id !== id));
}

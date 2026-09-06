/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Coords, Hub } from './types';

/**
 * One geography for both apps.
 *
 * The web build and the rider build once drifted onto different hub
 * coordinates, which meant the customer's live map and the rider's map
 * disagreed about where the garments were going. Everything downstream —
 * route polylines, the landmark table, every ETA — reads the hub from here so
 * that cannot happen again. Change it in one place or not at all.
 *
 * The operation runs out of Wagyingo Opal Hostel on the Ayeduase–Kotei road,
 * beside the Benab filling station. It was at Bomso Junction until then.
 *
 * NOTE: the pin below is an estimate — the midpoint of the existing Ayeduase
 * and Kotei anchors, which lands on the right stretch of road but was not
 * surveyed to the building. Every distance and ETA in the system is measured
 * from it, so replace it with a pin dropped on the actual forecourt when
 * somebody is standing there.
 */
export const LAUNDRY_HUB: Coords & { name: string } = {
  lat: 6.6625,
  lng: -1.552,
  name: 'FreshFold Care Headquarters',
};

export const LAUNDRY_HUB_ADDRESS =
  'FreshFold Laundry Hub (Wagyingo Opal Hostel, Ayeduase-Kotei)';

/**
 * The id the constant above is seeded into the `hubs` table under.
 *
 * `LAUNDRY_HUB` stays exactly where it is and keeps working, because roughly
 * twenty call sites read it and a second branch should not be a rewrite of all
 * twenty. What changed is that it is now the *default* hub rather than the only
 * conceivable one: a job records which branch it went to, and everything that
 * measures a distance measures it from that branch, falling back to this when a
 * job predates the column.
 */
export const DEFAULT_HUB_ID = 'HUB-AYEDUASE';

/** The constant as a `Hub`, for surfaces that have no list to read yet. */
export function defaultHub(): Hub {
  return {
    id: DEFAULT_HUB_ID,
    name: LAUNDRY_HUB.name,
    address: LAUNDRY_HUB_ADDRESS,
    lat: LAUNDRY_HUB.lat,
    lng: LAUNDRY_HUB.lng,
    suburbs: [],
    active: true,
    isDefault: true,
    createdAt: '',
  };
}

/** A hub's position, in the shape everything else measures against. */
export function hubCoords(hub: Pick<Hub, 'lat' | 'lng'>): Coords {
  return { lat: hub.lat, lng: hub.lng };
}

/**
 * Which branch should take a collection from this pin.
 *
 * A branch that names the suburb wins outright, however far away it is: coverage
 * is an operational decision somebody made deliberately, and overriding it with
 * arithmetic would mean a hub declaring an area it does not serve gets sent work
 * there anyway. Among branches that name it — or, if none does, among all of
 * them — the nearest wins.
 *
 * Falls back to the default hub, and then to the first active one, so this
 * always answers. A booking that could not be assigned a branch is a booking
 * nobody collects, which is a worse failure than one sent to the wrong branch of
 * a two-branch laundry.
 */
export function hubForPickup(
  hubs: readonly Hub[],
  pickup: Coords,
  suburb?: string
): Hub {
  const open = hubs.filter((hub) => hub.active);
  if (open.length === 0) return hubs[0] ?? defaultHub();

  const needle = (suburb ?? '').trim().toLowerCase();

  const covering = needle
    ? open.filter((hub) =>
        hub.suburbs.some((name) => name.trim().toLowerCase() === needle)
      )
    : [];

  const candidates = covering.length > 0 ? covering : open;

  return candidates.reduce((closest, hub) =>
    distanceKm(pickup, hubCoords(hub)) < distanceKm(pickup, hubCoords(closest)) ? hub : closest
  );
}

/** Suburbs FreshFold collects from, and the anchor pin for each. */
export const SUBURB_COORDS: Record<string, Coords> = {
  Bomso: { lat: 6.6845, lng: -1.5802 },
  Ayeduase: { lat: 6.6685, lng: -1.5524 },
  Kotei: { lat: 6.6565, lng: -1.5515 },
  Deduako: { lat: 6.6515, lng: -1.5621 },
  Boadi: { lat: 6.6815, lng: -1.5412 },
  'KNUST Campus': { lat: 6.6725, lng: -1.5645 },
};

export const SERVICE_SUBURBS = Object.keys(SUBURB_COORDS);

/**
 * The anchor pin for a suburb named in free text.
 *
 * The customer app offers a fixed list, but the website's booking form is a
 * text box — "ayeduase", "Ayeduase Newsite", "KNUST campus" all mean a suburb
 * we serve, and none of them is a key in the table. Loose on purpose, and
 * falling back to the middle of campus rather than to nothing, because this
 * only ever decides where a map opens.
 */
export function anchorForSuburb(suburb: string): Coords {
  const exact = SUBURB_COORDS[suburb];
  if (exact) return { ...exact };

  const needle = (suburb || '').trim().toLowerCase();
  if (needle) {
    const match = Object.keys(SUBURB_COORDS).find(
      (key) => needle.includes(key.toLowerCase()) || key.toLowerCase().includes(needle)
    );
    if (match) return { ...SUBURB_COORDS[match] };
  }

  return { ...SUBURB_COORDS['KNUST Campus'] };
}

export interface Landmark {
  name: string;
  lat: number;
  lng: number;
  suburb: string;
  type: 'hostel' | 'landmark' | 'hub';
  description: string;
}

export const LANDMARKS: Landmark[] = [
  { name: 'FreshFold Laundry Hub (Wagyingo Opal)', lat: 6.6625, lng: -1.552, suburb: 'Ayeduase', type: 'hub', description: 'FreshFold Premium Apparel Processing & Steam-Press Sanctuary, beside the Benab filling station' },
  { name: 'Evandy Hostel', lat: 6.6685, lng: -1.5524, suburb: 'Ayeduase', type: 'hostel', description: 'Popular private student residency with luxury care dropoff lockers' },
  { name: 'Frontline Hostel', lat: 6.6695, lng: -1.5511, suburb: 'Ayeduase', type: 'hostel', description: 'Major student hostel equipped with standard FreshFold pickup service' },
  { name: 'Wundua Hostel', lat: 6.6692, lng: -1.5539, suburb: 'Ayeduase', type: 'hostel', description: 'High-density student accommodation off the Ayeduase high street' },
  { name: 'Brunei Complex', lat: 6.6661, lng: -1.5658, suburb: 'KNUST Campus', type: 'hostel', description: 'Postgraduate hostel block' },
  { name: 'Unity Hall (Conti)', lat: 6.6749, lng: -1.5721, suburb: 'KNUST Campus', type: 'hostel', description: 'Premier on-campus male hall' },
  { name: 'University Hall (Katanga)', lat: 6.6791, lng: -1.5699, suburb: 'KNUST Campus', type: 'hostel', description: 'Legendary student hall with on-demand laundry dispatch services' },
  { name: 'Queens Hall', lat: 6.6752, lng: -1.5684, suburb: 'KNUST Campus', type: 'hostel', description: 'All-inclusive student hall with active FreshFold pickup lockers' },
  { name: 'Republic Hall', lat: 6.6738, lng: -1.5602, suburb: 'KNUST Campus', type: 'hostel', description: 'Central on-campus mixed hall with designated laundry points' },
  { name: 'Independence Hall', lat: 6.6715, lng: -1.5582, suburb: 'KNUST Campus', type: 'hostel', description: 'Designated on-campus hall with direct courier access' },
  { name: 'SRC Hostel', lat: 6.6645, lng: -1.5495, suburb: 'KNUST Campus', type: 'hostel', description: 'Large student residence complex off the main campus drive' },
  { name: 'De-Grace Hostel', lat: 6.6582, lng: -1.5492, suburb: 'Kotei', type: 'hostel', description: 'Premium private off-campus hostel block' },
  { name: 'Kotei Town Square', lat: 6.6565, lng: -1.5515, suburb: 'Kotei', type: 'landmark', description: 'Central hub of the Kotei community' },
  { name: 'Deduako Court', lat: 6.6515, lng: -1.5621, suburb: 'Deduako', type: 'landmark', description: 'Developing student residential suites' },
  { name: 'Boadi Junction Hub', lat: 6.6815, lng: -1.5412, suburb: 'Boadi', type: 'landmark', description: 'Access gateway to pristine Boadi residential estates' },
];

/**
 * Which suburb a point is in.
 *
 * The nearest anchor, which is all "suburb" ever meant here: the six names in
 * the table are collection zones, not surveyed boundaries, and the dispatch
 * board groups by them.
 *
 * This exists because the booking forms stopped asking. A suburb was a
 * required field back when the pin was hashed out of the address and the map
 * needed *something* to centre on — now the customer picks a real place or
 * drops a real pin, and asking them to also classify it into a zone was asking
 * them to do the geometry themselves. Derived from the pin, the two can never
 * disagree, which they previously could and did.
 */
export function suburbForCoords(coords: Coords): string {
  let best = SERVICE_SUBURBS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [name, anchor] of Object.entries(SUBURB_COORDS)) {
    const away = distanceKm(coords, anchor);
    if (away < bestDistance) {
      bestDistance = away;
      best = name;
    }
  }

  return best;
}

/**
 * The suburb to file a booking under, given what the customer has actually
 * told us: a pin if they placed one, otherwise the address they typed.
 *
 * Empty when neither says anything — which is honest, and which the job model
 * already tolerates. `coordsForAddress` falls back to the middle of campus for
 * an unknown suburb, so a blank one costs nothing that guessing would not.
 */
export function deriveSuburb(pin?: Coords | null, address = ''): string {
  if (!pin) return matchLandmark(address)?.suburb ?? '';

  /*
   * A pin standing on a place we already know is filed where that place is
   * filed. The table's labels are a dispatcher's judgement and the anchors are
   * geometry, and the two do not always agree: SRC Hostel is listed under
   * KNUST Campus but sits half a kilometre from the Ayeduase anchor and nearly
   * two from the campus one. Nearest-anchor alone would quietly refile it, so
   * the board and the landmark table would disagree about the same building.
   * Whoever curated the table wins on the buildings the table covers.
   */
  const onLandmark = LANDMARKS.find(
    (mark) => metresBetween(pin, mark) <= LANDMARK_SNAP_M
  );
  if (onLandmark) return onLandmark.suburb;

  return suburbForCoords(pin);
}

/**
 * How close to a landmark counts as standing on it. A gate, a side entrance
 * and the point recorded in the table are all the same building at this range,
 * and the nearest two landmarks are further apart than this.
 */
const LANDMARK_SNAP_M = 150;

/**
 * The landmark a free-text address is talking about, if any.
 *
 * Students type where they live the way they say it — "Evandy", "Conti",
 * "Katanga Hall room 12" — and this table already knows where fifteen of those
 * places are to the metre. Matching on the name with the bracketed nickname
 * pulled out catches both halves: "Unity Hall (Conti)" answers to either.
 *
 * The three-character floor is what stops a short nickname matching inside an
 * unrelated word. Returns null rather than guessing, because the caller's
 * fallback — asking the customer to place a pin — is better than a confident
 * wrong answer.
 *
 * Lived in the supervisor's map, where it decided where to *draw* a booking
 * that already existed. It is more use here: the same match can put the pin
 * roughly right while the customer is still typing.
 */
export function matchLandmark(address: string, suburb = ''): Landmark | null {
  const haystacks = [address, suburb]
    .map((part) => (part || '').trim().toLowerCase())
    .filter(Boolean);

  if (haystacks.length === 0) return null;

  const found = LANDMARKS.find((mark) => {
    const names = [
      mark.name.split('(')[0].trim().toLowerCase(),
      mark.name.match(/\((.*?)\)/)?.[1]?.trim().toLowerCase() ?? '',
    ].filter((name) => name.length > 2);

    return haystacks.some((part) =>
      names.some(
        (name) =>
          // A finished address contains the place: "Evandy Hostel, Room 12".
          part.includes(name) ||
          // A half-typed one is the start of it: "Evandy" is on its way to
          // Evandy Hostel. Anchored at the front, and four characters in,
          // because a loose substring makes "Hall" pick whichever hall the
          // table happens to list first.
          (part.length >= MIN_TYPED_MATCH && name.startsWith(part))
      )
    );
  });

  return found ?? null;
}

/** Shortest partial worth resolving to a landmark while somebody is typing. */
const MIN_TYPED_MATCH = 4;

/**
 * Bounding box for the service area.
 *
 * Coordinates outside it are stale, corrupt, or not ours: the apps use it to
 * decide whether persisted state survives an upgrade, the booking route uses it
 * to refuse a pickup pin, and the directions proxy uses it as the only thing
 * standing between a billed Google endpoint and the open internet.
 *
 * That last caller is why this is drawn tightly. It used to be a whole degree
 * square — roughly 110 km on a side, from north of Mampong to past Obuasi —
 * which let anybody walk arbitrary routes through the proxy and call it Kumasi.
 * These bounds are Greater Kumasi with room to grow: every landmark, suburb
 * anchor and hub below sits well inside them, as does the city centre and the
 * airport, while the box is about a sixteenth of the area.
 */
export const SERVICE_AREA_BOUNDS = {
  minLat: 6.55,
  maxLat: 6.8,
  minLng: -1.75,
  maxLng: -1.45,
} as const;

export function isOutsideServiceArea(coords?: Coords): boolean {
  if (!coords) return true;
  return (
    coords.lat > SERVICE_AREA_BOUNDS.maxLat ||
    coords.lat < SERVICE_AREA_BOUNDS.minLat ||
    coords.lng > SERVICE_AREA_BOUNDS.maxLng ||
    coords.lng < SERVICE_AREA_BOUNDS.minLng
  );
}

/**
 * A stable pin for a free-text address.
 *
 * Bookings are typed by hand ("Gaza Hostel, Room 304") and there is no
 * geocoder in the loop, so an address is hashed to a small deterministic
 * offset from its suburb anchor. Same address, same pin, every time — which is
 * what makes the customer's map and the rider's map agree.
 */
export function coordsForAddress(address: string, suburb?: string): Coords {
  const base = (suburb && SUBURB_COORDS[suburb]) || SUBURB_COORDS['KNUST Campus'];
  if (!address) return { ...base };

  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = (hash << 5) - hash + address.charCodeAt(i);
    hash |= 0;
  }

  return {
    lat: base.lat + ((Math.abs(hash) % 80) - 40) * 0.0001,
    lng: base.lng + ((Math.abs(hash >> 3) % 80) - 40) * 0.0001,
  };
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km — accurate enough for an ETA readout. */
export function distanceKm(from: Coords, to: Coords): number {
  const R = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Compass bearing from one point to another, in degrees. */
export function bearingBetween(from: Coords, to: Coords): number {
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Straight-line separation in metres. */
export function metresBetween(from: Coords, to: Coords): number {
  return distanceKm(from, to) * 1000;
}

/**
 * Arrival.
 *
 * Reaching a destination is what flips an order from `navigating_*` to
 * `arrived_*`, which is a real claim: the customer is told their courier is at
 * the door, and the pickup checklist opens. So it is a test against metres on
 * the ground, and against how much the device's own fix can be trusted.
 *
 * `ARRIVAL_RADIUS_M` is a doorway rather than a street — close enough that
 * "arrived" is true from anywhere inside it, tight enough that the building
 * next door is outside it.
 */
export const ARRIVAL_RADIUS_M = 35;

/**
 * The worst fix worth acting on.
 *
 * A phone reporting ±120 m has no idea which side of the road it is on, and a
 * position that vague cannot confirm a 35 m arrival — it would fire from
 * halfway down the street, or refuse to fire while the courier stands at the
 * door. Such a fix is still fine for drawing the courier on a map, which is
 * why this is a threshold for acting rather than for believing at all.
 */
export const MAX_ACTIONABLE_ACCURACY_M = 50;

/** Whether a fix is precise enough to base a status change on. */
export function isActionableFix(accuracyM?: number | null): boolean {
  return typeof accuracyM === 'number' && accuracyM > 0 && accuracyM <= MAX_ACTIONABLE_ACCURACY_M;
}

/**
 * Whether a reported position is close enough, and sure enough of itself, to
 * count as arrived. A fix the device cannot vouch for never arrives anywhere —
 * the courier confirms by hand instead, which is a button they already have.
 */
export function hasArrivedAt(position: Coords, target: Coords, accuracyM?: number | null): boolean {
  if (!isActionableFix(accuracyM)) return false;
  return metresBetween(position, target) <= ARRIVAL_RADIUS_M;
}

/**
 * A heading is only meaningful above walking pace. Standing still, the compass
 * derived from consecutive fixes is noise, and feeding it to a map turns the
 * courier's arrow into a spinner.
 */
export const MIN_HEADING_SPEED_KMH = 4;

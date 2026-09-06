/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  LANDMARKS,
  SERVICE_AREA_BOUNDS,
  isOutsideServiceArea,
  matchLandmark,
  type PlaceDetail,
  type PlaceSuggestion,
} from '@freshfold/core';
import { rateLimit } from '../rateLimit';

/**
 * Address lookup for the two booking forms.
 *
 * Both of them used to open their map over the middle of campus and wait for
 * somebody to drag a pin across two kilometres of it. This narrows the gap:
 * type "Evandy" and the pin starts at Evandy.
 *
 * Two sources, in order. FreshFold's own landmark table answers first — those
 * are the fifteen halls and hostels the couriers actually serve, their
 * coordinates are already exact, and looking them up costs nothing. Google
 * covers everything else, restricted to the service area so this cannot be
 * used as a free geocoder for somewhere we do not deliver.
 *
 * Like the directions proxy, the key stays server-side and everything degrades
 * rather than erroring: no key, no quota or no Google leaves the landmark
 * matches, and no matches leaves the customer placing the pin by hand, which
 * is what they did before this route existed.
 */
export const placesRouter = Router();

const AUTOCOMPLETE_ENDPOINT = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places';

/** Below this a query is too vague to spend a lookup on. */
const MIN_QUERY_LENGTH = 3;

/** Longest query worth forwarding; past this it is somebody pasting an essay. */
const MAX_QUERY_LENGTH = 120;

/** How many rows the dropdown shows. */
const MAX_SUGGESTIONS = 6;

/**
 * Autocomplete is typed into, so the same prefixes recur constantly — both
 * within one customer's lookup and across everybody booking from the same
 * hostel. Five minutes is long enough to absorb that and short enough that a
 * newly-listed place appears the same day.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry<T> {
  value: T;
  at: number;
}

const searchCache = new Map<string, CacheEntry<PlaceSuggestion[]>>();
const detailCache = new Map<string, CacheEntry<PlaceDetail>>();

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;

  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return hit.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, at: Date.now() });
}

/**
 * The box Google is told to search inside.
 *
 * `locationRestriction` rather than `locationBias`: a bias merely prefers the
 * area and will still cheerfully return Accra, and a courier cannot ride to
 * Accra. The bounds are the same ones the directions proxy enforces, so the
 * two agree about where FreshFold operates.
 */
const RESTRICTION = {
  rectangle: {
    low: { latitude: SERVICE_AREA_BOUNDS.minLat, longitude: SERVICE_AREA_BOUNDS.minLng },
    high: { latitude: SERVICE_AREA_BOUNDS.maxLat, longitude: SERVICE_AREA_BOUNDS.maxLng },
  },
};

/**
 * FreshFold's own places, matched on the same loose rules the supervisor's map
 * uses. Free, exact, and first in the list — a courier who has been to Evandy
 * Hostel two hundred times does not need Google's opinion on where it is.
 */
function landmarkSuggestions(query: string): PlaceSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return LANDMARKS.filter((mark) => {
    if (mark.type === 'hub') return false;

    const cleanName = mark.name.split('(')[0].trim().toLowerCase();
    const nickname = mark.name.match(/\((.*?)\)/)?.[1]?.toLowerCase() ?? '';

    // Prefix-ish rather than the containment `matchLandmark` uses: this runs
    // against a partial query, where "un" should offer Unity and University
    // rather than nothing.
    return cleanName.includes(needle) || (!!nickname && nickname.includes(needle));
  }).map((mark) => ({
    id: `landmark:${mark.name}`,
    primary: mark.name,
    secondary: `${mark.suburb} · FreshFold serves this address`,
    source: 'landmark' as const,
    coords: { lat: mark.lat, lng: mark.lng },
  }));
}

/**
 * What to write into the customer's address field.
 *
 * `formattedAddress` alone is not it. Google's formatted address for Republic
 * Hall is "Kumasi, Ghana" — postally true, useless to a courier, and worse than
 * the "Republic Hall KNUST" the customer had already typed before choosing the
 * suggestion. Taking the name and letting the formatted address supply the
 * context after it gives "Republic Hall, Kumasi, Ghana", which is the row they
 * actually clicked on.
 */
function describePlace(name?: string, formatted?: string): string {
  const place = name?.trim() ?? '';
  // Plus codes ("MCFW+85C") are how Google addresses somewhere with no street
  // number. They are precise and completely unreadable, and a courier holding
  // a phone at a hostel gate has no use for one — the pin carries the
  // precision, the words only have to be recognisable.
  const address = (formatted ?? '')
    .replace(/\b[A-Z0-9]{4,6}\+[A-Z0-9]{2,3}\b,?\s*/g, '')
    .trim();

  if (!place) return address || 'Selected address';
  if (!address) return place;
  // Plenty of addresses already lead with the name; do not say it twice.
  if (address.toLowerCase().includes(place.toLowerCase())) return address;

  return `${place}, ${address}`;
}

/** Asks Google. Returns an empty list on anything unexpected. */
async function googleSuggestions(query: string, session: string): Promise<PlaceSuggestion[]> {
  const key = process.env.GOOGLE_MAPS_PLATFORM_KEY;
  if (!key) return [];

  try {
    const response = await fetch(AUTOCOMPLETE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
      },
      body: JSON.stringify({
        input: query,
        locationRestriction: RESTRICTION,
        includedRegionCodes: ['gh'],
        sessionToken: session,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn('[places] autocomplete returned', response.status);
      return [];
    }

    const body = (await response.json()) as {
      suggestions?: {
        placePrediction?: {
          placeId?: string;
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
        };
      }[];
    };

    return (body.suggestions ?? [])
      .map((entry) => entry.placePrediction)
      .filter((prediction): prediction is NonNullable<typeof prediction> => !!prediction?.placeId)
      .map((prediction) => ({
        id: prediction.placeId!,
        primary: prediction.structuredFormat?.mainText?.text ?? '',
        secondary: prediction.structuredFormat?.secondaryText?.text ?? '',
        source: 'google' as const,
      }))
      .filter((suggestion) => !!suggestion.primary);
  } catch (error) {
    console.warn('[places] autocomplete request failed:', error);
    return [];
  }
}

/**
 * `GET /api/places/search?q=&session=`
 *
 * Open, for the same reason the directions proxy is: a booking form is a
 * stranger filling in a form, and there is no session to require. The guards
 * are the service-area restriction, the minimum query length, the cache and
 * the window below.
 */
placesRouter.get(
  '/search',
  rateLimit({
    max: 40,
    windowMs: 60 * 1000,
    message: 'Too many address lookups. Try again in a minute.',
  }),
  async (req, res) => {
    const query = String(req.query.q ?? '').trim();
    const session = String(req.query.session ?? '').slice(0, 64);

    // Not an error — it is what every lookup looks like for its first two
    // keystrokes, and the form should not be showing an error for that.
    if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
      return res.json([]);
    }

    const cacheKey = query.toLowerCase();
    const cached = readCache(searchCache, cacheKey);
    if (cached) return res.json(cached);

    const ours = landmarkSuggestions(query);
    const theirs = await googleSuggestions(query, session);

    // Ours first, and never duplicated by Google's copy of the same building.
    const seen = new Set(ours.map((entry) => entry.primary.toLowerCase()));
    const merged = [
      ...ours,
      ...theirs.filter((entry) => !seen.has(entry.primary.toLowerCase())),
    ].slice(0, MAX_SUGGESTIONS);

    // Cached even when empty: a query with no answer is asked repeatedly as
    // somebody keeps typing, and each repeat would otherwise be billed.
    writeCache(searchCache, cacheKey, merged);

    res.json(merged);
  }
);

/**
 * `GET /api/places/:id?session=`
 *
 * The second half of a lookup: the chosen suggestion's address and coordinate.
 * Landmark ids are answered from the table without touching Google.
 */
placesRouter.get(
  '/:id',
  rateLimit({
    max: 20,
    windowMs: 60 * 1000,
    message: 'Too many address lookups. Try again in a minute.',
  }),
  async (req, res) => {
    const id = req.params.id;
    const session = String(req.query.session ?? '').slice(0, 64);

    if (id.startsWith('landmark:')) {
      const name = id.slice('landmark:'.length);
      const mark = matchLandmark(name);

      if (!mark) {
        return res.status(404).json({ error: 'That place is no longer on our list.' });
      }

      return res.json({
        id,
        address: `${mark.name}, ${mark.suburb}`,
        coords: { lat: mark.lat, lng: mark.lng },
      } satisfies PlaceDetail);
    }

    const cached = readCache(detailCache, id);
    if (cached) return res.json(cached);

    const key = process.env.GOOGLE_MAPS_PLATFORM_KEY;
    if (!key) {
      return res.status(503).json({ error: 'Address lookup is not configured.' });
    }

    try {
      const response = await fetch(
        `${DETAILS_ENDPOINT}/${encodeURIComponent(id)}?sessionToken=${encodeURIComponent(session)}`,
        {
          headers: {
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'id,formattedAddress,displayName,location',
          },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        console.warn('[places] details returned', response.status);
        return res.status(502).json({ error: 'Could not look that address up just now.' });
      }

      const body = (await response.json()) as {
        formattedAddress?: string;
        displayName?: { text?: string };
        location?: { latitude?: number; longitude?: number };
      };

      const lat = body.location?.latitude;
      const lng = body.location?.longitude;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(502).json({ error: 'That address has no location we can use.' });
      }

      const coords = { lat, lng };

      /*
       * Belt and braces on the restriction sent to Google. A pin outside the
       * service area is one the courier cannot ride to, and accepting it here
       * would put a booking on the board that the pickup route would then
       * refuse — a rejection two screens later, about a choice made here.
       */
      if (isOutsideServiceArea(coords)) {
        return res
          .status(400)
          .json({ error: 'That address is outside the FreshFold service area.' });
      }

      const detail: PlaceDetail = {
        id,
        address: describePlace(body.displayName?.text, body.formattedAddress),
        coords,
      };

      writeCache(detailCache, id, detail);
      res.json(detail);
    } catch (error) {
      console.warn('[places] details request failed:', error);
      res.status(502).json({ error: 'Could not look that address up just now.' });
    }
  }
);

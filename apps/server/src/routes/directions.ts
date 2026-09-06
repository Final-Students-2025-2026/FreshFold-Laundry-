/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  decodePolyline,
  isOutsideServiceArea,
  straightLineRoute,
  type Coords,
  type RouteLeg,
} from '@freshfold/core';
import { rateLimit } from '../rateLimit';

/**
 * Road routes, for every map in the product.
 *
 * All three apps used to draw the courier's path as a straight line between
 * two points. This asks Google's Routes API for the geometry a scooter would
 * actually ride, and hands the same answer to the rider console, the
 * customer's tracking map and the supervisor's dashboard — computed once,
 * server-side, so the three cannot disagree about the way round and the key
 * never ships in a client bundle.
 *
 * Everything degrades to the straight line rather than to an error: no key
 * configured, quota exhausted, Google unreachable, a courier whose position is
 * not known yet. A map that draws something slightly wrong is worth more to
 * somebody holding laundry than a map that draws nothing.
 */
export const directionsRouter = Router();

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * How long an answer stays good.
 *
 * The road geometry between two points does not change; the duration does, so
 * this is short enough to keep a traffic-aware ETA honest and long enough that
 * a courier's four-second poll costs nothing. Every repeat within the window
 * is served from memory.
 */
const CACHE_TTL_MS = 3 * 60 * 1000;

/**
 * Coordinates are rounded to about eleven metres before they become a cache
 * key. A courier moving down a street would otherwise miss the cache on every
 * single fix, which is a billed request per poll per rider.
 */
const KEY_PRECISION = 4;

/** Belt and braces on a billed endpoint: a ceiling on cache size. */
const MAX_CACHE_ENTRIES = 300;

/**
 * Per-caller ceiling.
 *
 * The cache only absorbs repeats of the *same* leg. Somebody feeding this
 * endpoint a slightly different coordinate each time misses the cache every
 * time, and each miss is a billed Google request — so without this the service
 * area below is the only limit, and the service area is a box, not a budget.
 *
 * The window is sized against what honest use actually needs: a courier's map
 * asks at most once per twenty seconds per leg, and a supervisor with several
 * job maps open asks once per job. Thirty a minute leaves that untouched.
 */
const limit = rateLimit({
  max: 30,
  windowMs: 60 * 1000,
  message: 'Too many route requests. Try again in a minute.',
});

interface CacheEntry {
  route: RouteLeg;
  at: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(from: Coords, to: Coords, mode: string): string {
  const round = (value: number) => value.toFixed(KEY_PRECISION);
  return `${mode}:${round(from.lat)},${round(from.lng)}->${round(to.lat)},${round(to.lng)}`;
}

function readCache(key: string): RouteLeg | null {
  const hit = cache.get(key);
  if (!hit) return null;

  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return hit.route;
}

function writeCache(key: string, route: RouteLeg): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Oldest insertion first — Map keeps insertion order.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { route, at: Date.now() });
}

function parseCoords(lat: unknown, lng: unknown): Coords | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { lat: latitude, lng: longitude };
}

/**
 * Asks Google for the route. Returns null on anything unexpected — a caller
 * that cannot tell "no key" from "quota exceeded" from "Google is down" is a
 * caller that draws the straight line either way.
 */
async function fetchRoadRoute(from: Coords, to: Coords, mode: string): Promise<RouteLeg | null> {
  const key = process.env.GOOGLE_MAPS_PLATFORM_KEY;
  if (!key) return null;

  try {
    const response = await fetch(ROUTES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        // A courier on a scooter takes lanes a car cannot; `TWO_WHEELER` is
        // the mode that matches the fleet, and it only supports the
        // traffic-aware preference.
        travelMode: mode === 'DRIVE' ? 'DRIVE' : 'TWO_WHEELER',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      console.warn('[directions] Routes API returned', response.status);
      return null;
    }

    const body = (await response.json()) as {
      routes?: {
        distanceMeters?: number;
        duration?: string;
        polyline?: { encodedPolyline?: string };
      }[];
    };

    const route = body.routes?.[0];
    const encoded = route?.polyline?.encodedPolyline;
    if (!route || !encoded) return null;

    const coordinates = decodePolyline(encoded);
    if (coordinates.length < 2) return null;

    return {
      coordinates,
      distanceMeters: route.distanceMeters ?? 0,
      // The API returns durations as `"825s"`.
      durationSeconds: Number.parseInt(route.duration ?? '0', 10) || 0,
      source: 'roads',
    };
  } catch (error) {
    console.warn('[directions] Routes API request failed:', error);
    return null;
  }
}

/**
 * `GET /api/directions?fromLat=&fromLng=&toLat=&toLng=`
 *
 * Open to all three apps, including a customer tracking an order without an
 * account — there is no session to require without breaking guest tracking.
 * What guards the bill instead is three things together: both ends have to be
 * inside the service area, which makes this useless as a general-purpose
 * routing proxy; the cache absorbs repeats of a leg; and the per-IP window
 * above bounds what a single caller can spend when they defeat the cache.
 */
directionsRouter.get('/', limit, async (req, res) => {
  const from = parseCoords(req.query.fromLat, req.query.fromLng);
  const to = parseCoords(req.query.toLat, req.query.toLng);

  if (!from || !to) {
    return res.status(400).json({ error: 'fromLat, fromLng, toLat and toLng are required.' });
  }

  if (isOutsideServiceArea(from) || isOutsideServiceArea(to)) {
    return res
      .status(400)
      .json({ error: 'Both ends of a route must be inside the Kumasi service area.' });
  }

  const mode = req.query.mode === 'DRIVE' ? 'DRIVE' : 'TWO_WHEELER';
  const key = cacheKey(from, to, mode);

  const cached = readCache(key);
  if (cached) return res.json(cached);

  const route = (await fetchRoadRoute(from, to, mode)) ?? straightLineRoute(from, to);

  // A fallback is cached too, briefly: if Google is down, hammering it once
  // per poll per courier does not bring it back any sooner.
  writeCache(key, route);

  res.json(route);
});

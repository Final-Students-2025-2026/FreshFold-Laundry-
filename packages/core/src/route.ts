/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { distanceKm } from './geo';
import type { Coords } from './types';

/**
 * Roads, not chords.
 *
 * Every map in the product used to draw the courier's path as a straight line
 * between two points — across the botanical gardens, through Unity Hall, over
 * whatever happened to be in the way. A road route is a different thing
 * entirely: on the hub-to-Ayeduase run the straight line is 3.3 km and the road
 * is 5.3 km, so the line was not just ugly, it was 60% short and every ETA
 * derived from it was optimistic.
 *
 * The dispatch server asks Google's Routes API for the real geometry and hands
 * it to all three apps in this shape. One request per leg, one answer, so the
 * courier's console, the customer's tracking map and the supervisor's
 * dashboard cannot disagree about the way round.
 */
export interface RouteLeg {
  /** The road path, decoded and ready to draw. */
  coordinates: Coords[];
  /** Driving distance along that path. */
  distanceMeters: number;
  /** How long the routing engine thinks it takes, traffic included. */
  durationSeconds: number;
  /**
   * `roads` when a routing engine answered, `straight` when it could not and
   * this is the old chord. The UI says which, rather than presenting a guess
   * as a route.
   */
  source: 'roads' | 'straight';
}

/**
 * Decodes Google's encoded polyline format.
 *
 * The format is a run of signed offsets: each value is left-shifted by one
 * (with the sign in the low bit), split into five-bit chunks, ORed with 0x20
 * while more chunks follow, and offset by 63 so the whole thing survives being
 * pasted into a URL. Coordinates are deltas from the previous point, in units
 * of 1e-5 degrees.
 *
 * Implemented here rather than pulled in as a dependency because it is twenty
 * lines and it has to run in three bundlers.
 */
export function decodePolyline(encoded: string): Coords[] {
  const points: Coords[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Average scooter speed on campus roads.
 *
 * Not exported, and not an ETA. It exists to give the fallback leg below a
 * `durationSeconds` so it has the same shape as a real one — and
 * `routeEtaMinutes` refuses to read it, because a straight line divided by a
 * constant is what every arrival time in this product used to be.
 */
const AVERAGE_SPEED_KMH = 18;

/**
 * The fallback route: the straight line, named as such.
 *
 * Used when no routing key is configured, when the API is unreachable, and
 * when a leg has no sensible origin yet. Same shape as a real route so no
 * caller has to branch — only the `source` field, for anything that wants to
 * be honest about it on screen.
 */
export function straightLineRoute(from: Coords, to: Coords): RouteLeg {
  const km = distanceKm(from, to);
  return {
    coordinates: [{ ...from }, { ...to }],
    distanceMeters: Math.round(km * 1000),
    durationSeconds: Math.max(60, Math.round((km / AVERAGE_SPEED_KMH) * 3600)),
    source: 'straight',
  };
}

/**
 * Minutes to arrival, or `null` when nobody knows.
 *
 * A `straight` leg has a duration only because the interface requires one: it is
 * the chord divided by an average speed, which on the hub-to-Ayeduase run is 60%
 * short before traffic is considered. Refusing it here rather than at each call
 * site is deliberate — six surfaces used to render that number as an arrival
 * time, and the ones that checked did it by hand. Callers show the stage the job
 * is at instead.
 */
export function routeEtaMinutes(route: RouteLeg): number | null {
  if (route.source !== 'roads') return null;
  return Math.max(1, Math.round(route.durationSeconds / 60));
}

/**
 * How far a point has strayed from a route, in metres.
 *
 * Cheap and good enough to answer "should we re-route?": the distance to the
 * nearest *vertex* rather than to the nearest segment. Vertices on a road
 * route are dense — every few metres through a bend — so the error is small,
 * and it is compared against a threshold of tens of metres.
 */
export function metresOffRoute(position: Coords, route: RouteLeg): number {
  if (route.coordinates.length === 0) return Number.POSITIVE_INFINITY;

  let nearest = Number.POSITIVE_INFINITY;
  for (const point of route.coordinates) {
    const gap = distanceKm(position, point) * 1000;
    if (gap < nearest) nearest = gap;
  }
  return nearest;
}

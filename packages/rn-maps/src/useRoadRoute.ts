/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { metresOffRoute, type Coords, type RouteLeg } from '@freshfold/core';

/**
 * The road between here and the destination.
 *
 * Asks the dispatch server, which asks Google once per leg and caches the
 * answer for everybody. What comes back is the geometry a scooter would
 * actually ride; what the maps drew before was a straight line through whatever
 * happened to be in the way. The courier's console and the customer's tracking
 * card both use this, so the line the customer watches is the line the courier
 * was given.
 *
 * Re-routing is deliberately lazy. A position arrives every couple of seconds
 * on the rider's side and on every poll on the customer's, and each fresh route
 * is a billed request — so a new one is only fetched when the destination
 * changes or when the courier has genuinely left the road they were given: a
 * wrong turn, not GPS noise.
 *
 * Lives here rather than in each app because it was copied between them, and a
 * bug in it therefore had to be found and fixed twice.
 */

/** Far enough off the line to mean a wrong turn rather than a bad fix. */
const REROUTE_METRES = 80;
/** Floor on how often a re-route may be asked for, whatever the deviation. */
const MIN_REROUTE_INTERVAL_MS = 20_000;

/** The one call this needs from an app's dispatch client. */
export type DirectionsFetcher = (from: Coords, to: Coords) => Promise<RouteLeg>;

export type UseRoadRoute = (from: Coords | null, to: Coords | null) => RouteLeg | null;

/**
 * Binds the hook to an app's API client, so call sites keep the plain
 * `useRoadRoute(from, to)` shape.
 */
export function createUseRoadRoute(getDirections: DirectionsFetcher): UseRoadRoute {
  return function useRoadRoute(from: Coords | null, to: Coords | null): RouteLeg | null {
    const [route, setRoute] = useState<RouteLeg | null>(null);

    // Read inside the effect without making it a dependency: the effect runs on
    // every fix, and depending on the route it sets would loop.
    const routeRef = useRef<RouteLeg | null>(null);
    const lastFetchAt = useRef(0);
    /** A request already on the wire. Two fixes must not both ask. */
    const inFlight = useRef(false);
    const mounted = useRef(true);
    routeRef.current = route;

    const fromLat = from?.lat;
    const fromLng = from?.lng;
    const legKey = to ? `${to.lat},${to.lng}` : null;

    /**
     * The leg a request was made for, so an answer that arrives after the
     * courier has been sent somewhere else is dropped rather than drawn.
     */
    const legRef = useRef(legKey);

    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);

    // A new destination invalidates the old road immediately, rather than
    // leaving the previous leg drawn until the replacement lands.
    useEffect(() => {
      legRef.current = legKey;
      setRoute(null);
      routeRef.current = null;
      lastFetchAt.current = 0;
      inFlight.current = false;
    }, [legKey]);

    useEffect(() => {
      if (fromLat === undefined || fromLng === undefined || !to) return;
      if (inFlight.current) return;

      const here: Coords = { lat: fromLat, lng: fromLng };
      const current = routeRef.current;
      const strayed = !current || metresOffRoute(here, current) > REROUTE_METRES;
      if (!strayed) return;

      /**
       * The floor applies whether or not there is a road on screen.
       *
       * It used to be skipped while `route` was still null — which is precisely
       * the state a failed request leaves behind. A server that was down, or a
       * booking Google would not answer for, therefore got one billed request
       * per position report: every two seconds, from every courier navigating
       * and every customer watching, for as long as it stayed broken. Twenty
       * seconds is the floor for the first attempt at a leg as much as for the
       * ninth.
       */
      const now = Date.now();
      if (now - lastFetchAt.current < MIN_REROUTE_INTERVAL_MS) return;
      lastFetchAt.current = now;
      inFlight.current = true;

      /*
       * Deliberately not cancelled by this effect's cleanup. The effect re-runs
       * on every position report, so a cleanup that cancelled would throw away
       * the answer to the request the previous one had just made — a moving
       * courier could discard several responses in a row and never see a road
       * at all. The leg check below is what keeps a stale answer off the map.
       */
      const requestedLeg = legRef.current;

      getDirections(here, to)
        .then((next) => {
          if (mounted.current && legRef.current === requestedLeg) setRoute(next);
        })
        .catch(() => {
          // Offline, or the server is down. The map keeps the last road it was
          // given, or draws nothing — both better than a line to somewhere it
          // is not. The next report past the floor above tries again.
        })
        .finally(() => {
          inFlight.current = false;
        });
      // `to` is covered by `legKey`; `route` is read through the ref on purpose.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromLat, fromLng, legKey]);

    return route;
  };
}

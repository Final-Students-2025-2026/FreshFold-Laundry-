import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary
} from '@vis.gl/react-google-maps';
import { Compass, Navigation, Info, MapPin, RefreshCw, Layers, Map as MapIcon, Shield, Sun, Moon } from 'lucide-react';
import {
  LANDMARKS,
  LAUNDRY_HUB,
  SUBURB_COORDS,
  coordsForAddress,
  matchLandmark,
  routeEtaMinutes,
  type BookingRiderView,
  type Coords,
  type Landmark,
  type RouteLeg
} from '@freshfold/core';
import * as store from '../services/store';

interface LiveDispatchMapProps {
  clientSuburb: string;
  clientAddress: string;
  bookingStatus: string;
  bookingId: string;
  clientName: string;
  /**
   * The exact pin the dispatch server assigned this booking. When present it
   * beats the landmark/suburb guesswork below, so the customer's marker sits
   * where the rider is actually being routed.
   */
  clientCoords?: Coords;
  /**
   * Live telemetry from the rider's phone. Without it there is no courier
   * marker, because there is no courier on the road.
   */
  rider?: BookingRiderView;
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

/**
 * The missing-key diagnosis goes to the console, not to the page.
 *
 * This module used to render its own setup instructions when the key was
 * absent — create a `.env`, set `VITE_GOOGLE_MAPS_PLATFORM_KEY`, restart
 * `npm run dev`, or open Settings > Secrets in the environment it was
 * scaffolded in. Which would be reasonable if only a developer could ever see
 * it, and this component is mounted on `ClientPortal`'s tracking panel: a
 * customer watching for their laundry was one quota error or one referrer
 * restriction away from being told to edit a file they do not have.
 *
 * Maps keys fail in production for ordinary reasons, so that was not a
 * hypothetical. The customer now gets one sentence about what they can see;
 * whoever can actually fix it gets the variable name here, once at module
 * load, where it belongs.
 */
if (!hasValidKey) {
  console.warn(
    '[maps] VITE_GOOGLE_MAPS_PLATFORM_KEY is unset or still the placeholder. ' +
      'Live tracking will render as unavailable. Set it in apps/web/.env for local ' +
      'work, or in the Vercel project for a deploy — it is a build-time variable, ' +
      'so a redeploy is needed rather than a restart.'
  );
}

/**
 * The cloud Map ID.
 *
 * `AdvancedMarker` — every pin on this map — requires one. `DEMO_MAP_ID` is
 * Google's sandbox value: it renders, and it warns in the console on every
 * load, is explicitly not for production, and carries none of the styling a
 * real Map ID configured in the cloud console would. Set
 * `VITE_GOOGLE_MAPS_MAP_ID` and the map uses yours; leave it and the demo
 * still works, which is what a fresh checkout needs.
 */
const MAP_ID =
  (import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID ||
  process.env.GOOGLE_MAPS_MAP_ID ||
  'DEMO_MAP_ID';

// The landmark table, suburb anchors and hub all come from @freshfold/core, so
// the pin the customer watches and the pin the rider navigates to are the same
// point derived the same way.
const landmarks = LANDMARKS;
const suburbCoords = SUBURB_COORDS;
const laundryHub = LAUNDRY_HUB;

/** Dash pattern for a line that is an estimate rather than a road. */
const DASH_SYMBOL: google.maps.IconSequence[] = [
  {
    icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 },
    offset: '0',
    repeat: '12px',
  },
];

/**
 * The route line.
 *
 * One `Polyline` for the life of the map, with its path and its styling swapped
 * on it. What this did before was list the path array in its dependencies — and
 * that array was rebuilt on every render, so every five-second poll tore the
 * line off the map and constructed a new one. Visible as a flicker, and a
 * steady drip of garbage on a dashboard that is left open all day.
 *
 * `dashed` is the same distinction the two phone apps already draw: a solid
 * line is a claim about which way the courier is coming, and until the routing
 * engine has answered there is no such claim to make.
 */
function RoutePolyline({
  path,
  dashed,
}: {
  path: { lat: number; lng: number }[];
  dashed: boolean;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || !mapsLib) return;

    const polyline = new mapsLib.Polyline({
      geodesic: true,
      strokeColor: '#c5a880',
      map,
    });
    polylineRef.current = polyline;

    return () => {
      polyline.setMap(null);
      polylineRef.current = null;
    };
  }, [map, mapsLib]);

  useEffect(() => {
    if (path.length < 2) return;
    polylineRef.current?.setPath(path);
  }, [path]);

  useEffect(() => {
    // A dashed line in the Maps JS API is a transparent stroke wearing a
    // repeating symbol; there is no dash array.
    polylineRef.current?.setOptions(
      dashed
        ? { strokeOpacity: 0, strokeWeight: 3, icons: DASH_SYMBOL }
        : { strokeOpacity: 0.85, strokeWeight: 3, icons: null }
    );
  }, [dashed]);

  return null;
}

/**
 * Frames the job once, then gets out of the way.
 *
 * `fitKey` changes when the map is showing a different job, or when the real
 * road arrives to replace the stand-in — the two moments where re-framing is
 * what the viewer wants. It deliberately does not change as the courier moves.
 * This used to depend on the bounds array itself, which was a fresh array on
 * every render, so `fitBounds` ran on every poll and threw away whatever the
 * supervisor had just zoomed into.
 */
function MapFitBounds({
  bounds,
  fitKey,
}: {
  bounds: { lat: number; lng: number }[];
  fitKey: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || bounds.length < 2) return;
    try {
      const latLngBounds = new google.maps.LatLngBounds();
      bounds.forEach(pt => latLngBounds.extend(pt));
      map.fitBounds(latLngBounds, { top: 50, right: 50, bottom: 50, left: 50 });
    } catch (e) {
      // ignore fit bounds error on initialization
    }
    // `bounds` is read on purpose without being a trigger — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);

  return null;
}

export default function LiveDispatchMap({
  clientSuburb,
  clientAddress,
  bookingStatus,
  bookingId,
  clientName,
  clientCoords,
  rider
}: LiveDispatchMapProps) {
  const [mapTheme, setMapTheme] = useState<'light' | 'dark'>('dark');
  // The hub out of the shared table rather than a copy of it. This was a
  // literal, and it went stale the moment the operation moved off Bomso.
  const [selectedLandmark, setSelectedLandmark] = useState<Landmark | null>(
    () => landmarks.find((mark) => mark.type === 'hub') ?? null
  );

  // Calculate Client Position accurately
  const getClientPosition = (): { lat: number; lng: number } => {
    // The server already decided where this job is. Trust it.
    if (clientCoords) return clientCoords;

    // 1. Check known campus hostels / halls landmarks. The matcher lives in
    //    core now, because the booking form uses the same one to put the pin
    //    roughly right before the customer has touched the map.
    const matchedLandmark = matchLandmark(clientAddress, clientSuburb);
    if (matchedLandmark) {
      return { lat: matchedLandmark.lat, lng: matchedLandmark.lng };
    }

    // 2. Fallback to suburb coordinate anchor with deterministic string hash offset
    const matchedKey = Object.keys(suburbCoords).find(key =>
      clientSuburb.toLowerCase().includes(key.toLowerCase()) ||
      key.toLowerCase().includes(clientSuburb.toLowerCase())
    );

    return coordsForAddress(clientAddress, matchedKey ?? 'Ayeduase');
  };

  // Memoised on what it is derived from, so the pin is one object for as long
  // as the job is one job. Everything below keys off its identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clientPos = useMemo(getClientPosition, [
    clientCoords?.lat,
    clientCoords?.lng,
    clientAddress,
    clientSuburb,
  ]);

  /**
   * The road, from the dispatch server.
   *
   * What stood here was `getRoadRoutePath`: a hand-written list of waypoints
   * per suburb — HQ, KNUST Main Gate, Commercial Area, Admin Roundabout — that
   * bent like a road but knew nothing about the actual pickup pin, and had to
   * be extended by hand for every new suburb. The server now asks Google for
   * the real geometry and gives the same answer to the courier's console and
   * the customer's tracking map, so all three draw one line.
   */
  const [route, setRoute] = useState<RouteLeg | null>(null);

  // Stable identity, for the same reason `clientPos` has one: `rider` is a new
  // object on every poll.
  const routeOrigin = useMemo(
    () => rider?.coords ?? laundryHub,
    [rider?.coords?.lat, rider?.coords?.lng]
  );

  useEffect(() => {
    let cancelled = false;

    store.api
      .getDirections(routeOrigin, clientPos)
      .then((next) => {
        if (!cancelled) setRoute(next);
      })
      .catch(() => {
        /* Falls back to the straight line below. */
      });

    return () => {
      cancelled = true;
    };
    // Re-routes when the job moves or the courier does, rounded so a metre of
    // GPS jitter is not a new request.
  }, [
    clientPos.lat.toFixed(4),
    clientPos.lng.toFixed(4),
    routeOrigin.lat.toFixed(3),
    routeOrigin.lng.toFixed(3),
  ]);

  /**
   * Whether the line on screen is a road or a guess.
   *
   * The server flags its own straight-line fallback, and until the first answer
   * arrives there is nothing but a guess. Both are drawn dashed — the same
   * distinction the rider console and the customer's phone already make.
   */
  const isRoad = route?.source === 'roads';

  /**
   * Minutes to the door, from the same road leg the polyline is drawn from.
   *
   * `null` until the routing engine answers, and `null` for good if it never
   * does. The marker used to read `rider.etaMinutes` — a straight line divided
   * by an assumed scooter speed — while this component already held the real
   * answer in `route` a few lines up.
   */
  const etaMinutes = route ? routeEtaMinutes(route) : null;

  const pathPoints = useMemo(() => {
    const raw = route
      ? route.coordinates.map((point) => ({ lat: point.lat, lng: point.lng }))
      : // The straight line from wherever the courier actually is. The canned
        // waypoint table that used to fill this gap always began at the hub,
        // so a courier already halfway to Kotei was drawn setting off from the
        // hub — a route bending convincingly through junctions nobody was at.
        [routeOrigin];

    // Ensure path ends at exact clientPos
    const last = raw[raw.length - 1];
    if (!last || last.lat !== clientPos.lat || last.lng !== clientPos.lng) {
      return [...raw, clientPos];
    }
    return raw;
  }, [route, routeOrigin, clientPos]);

  /**
   * When re-framing is welcome: a different job on screen, or the real road
   * landing in place of the stand-in. Not every time the courier moves.
   */
  const fitKey = `${bookingId}:${clientPos.lat},${clientPos.lng}:${route ? 'road' : 'pending'}`;

  /**
   * Where the courier is.
   *
   * Only ever their reported position. What stood here interpolated a marker
   * along the guessed route with a sine wiggle on it whenever no rider was
   * on the job — a courier riding up the road on a map, with nobody assigned
   * and nobody moving.
   */
  const courierPos = rider?.coords ?? null;

  /*
    No map, said to the person actually reading it.

    The order is unaffected — the courier is still coming, and every stage still
    advances on the timeline above this panel. Only the map is missing, so that
    is all this says. See the note beside `hasValidKey` for where the reason
    goes instead.
  */
  if (!hasValidKey) {
    return (
      <div className="w-full rounded-2xl border border-white/10 bg-black/30 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-brand-sage-light">
          <MapPin aria-hidden="true" className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-[17px] font-medium text-white">Live tracking is unavailable</h3>
        <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-relaxed text-brand-text-muted">
          The map is not loading at the moment. Your order is not affected — the
          stages above still update as the courier collects and delivers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tracker Header Hud */}
      <div className="bg-[#121212]/80 backdrop-blur-md p-4 rounded-xl border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-brand-sage/15 border border-brand-sage/20 rounded-xl text-brand-sage shrink-0 mt-0.5">
            <Compass className="w-5 h-5 animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] bg-brand-sage/10 text-brand-sage border border-brand-sage/30 px-1.5 py-0.5 rounded font-mono tracking-wider uppercase font-black">
                Google Maps Telemetry
              </span>
              <span className="text-[8px] bg-brand-gold/10 text-brand-gold border border-brand-gold/30 px-1.5 py-0.5 rounded font-mono tracking-wider uppercase font-bold">
                📍 Auto-Pinned Location
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
            </div>
            <h5 className="font-serif text-sm font-medium text-white mt-1">
              Live KNUST Dispatch Telemetry
            </h5>
            <p className="font-sans text-[11px] text-[#8E9299] font-light">
              Pinned Destination: <strong className="text-brand-sage font-medium">{clientAddress || 'Pickup Point'}</strong>, <span className="text-stone-300">{clientSuburb}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:self-center">
          {/* Theme Toggle Button */}
          <button
            onClick={() => setMapTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 text-stone-300 hover:text-white rounded-lg text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Toggle Map theme (Light/Dark)"
          >
            {mapTheme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Light Map</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-400" />
                <span>Dark Map</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Map Interactive Frame */}
      <div className="relative w-full h-[380px] rounded-2xl border border-white/10 overflow-hidden bg-[#0e0e0e] shadow-2xl">
        <APIProvider apiKey={API_KEY} version="weekly">
          <Map
            defaultCenter={{ lat: 6.6710, lng: -1.5620 }}
            defaultZoom={14}
            mapId={MAP_ID}
            style={{ width: '100%', height: '100%' }}
            colorScheme={mapTheme === 'dark' ? 'DARK' : 'LIGHT'}
            gestureHandling="greedy"
            disableDefaultUI={true}
          >
            {/* Draw Route Polyline */}
            <RoutePolyline path={pathPoints} dashed={!isRoad} />
            <MapFitBounds bounds={pathPoints} fitKey={fitKey} />

            {/* FreshFold HQ Marker */}
            <AdvancedMarker position={laundryHub} title={laundryHub.name}>
              <div className="relative flex items-center justify-center">
                <div className="absolute w-8 h-8 rounded-full bg-[#c5a880]/20 animate-ping"></div>
                <div className="w-7 h-7 bg-[#c5a880] border border-black rounded-lg flex items-center justify-center shadow-lg text-black font-serif text-[10px] font-bold">
                  HQ
                </div>
              </div>
            </AdvancedMarker>

            {/* Client Destination Marker - Auto Pinned Pickup Address */}
            <AdvancedMarker
              position={clientPos}
              title={`Pickup Location: ${clientAddress || clientSuburb}`}
              onClick={() => setSelectedLandmark({
                name: `Pickup: ${clientAddress || clientSuburb}`,
                lat: clientPos.lat,
                lng: clientPos.lng,
                suburb: clientSuburb,
                type: 'landmark',
                description: `Accurately pinned pickup destination for ${clientName || 'Valued Patron'}. Dispatch rider navigates directly to this location.`
              })}
            >
              <div className="relative flex flex-col items-center justify-center group cursor-pointer">
                <div className="absolute w-9 h-9 rounded-full bg-brand-sage/30 animate-ping"></div>
                <div className="w-7 h-7 bg-brand-sage border-2 border-white rounded-full flex items-center justify-center shadow-2xl text-white font-bold group-hover:scale-110 transition-transform">
                  <MapPin className="w-4 h-4 fill-current text-white" />
                </div>
                <div className="mt-1 whitespace-nowrap bg-black/95 text-brand-sage border border-brand-sage/40 px-2 py-0.5 rounded text-[9.5px] font-mono tracking-wide font-bold shadow-2xl flex items-center gap-1">
                  <span>📍</span>
                  <span>{clientAddress ? (clientAddress.length > 22 ? clientAddress.slice(0, 20) + '...' : clientAddress) : clientSuburb}</span>
                </div>
              </div>
            </AdvancedMarker>

            {/* Live Courier Runner Marker. Named, when there is a courier to
                name — the other two apps both label this pin with the person
                riding it, and "FreshFold Courier Runner" told the customer
                nothing they could check at the door. */}
            {!!courierPos && (
            <AdvancedMarker
              position={courierPos}
              title={
                rider
                  ? [
                      rider.name?.trim() || 'Your courier',
                      [rider.vehicle?.trim(), rider.vehiclePlate?.trim()]
                        .filter(Boolean)
                        .join(' · '),
                      etaMinutes !== null ? `${etaMinutes} min away` : '',
                    ]
                      .filter(Boolean)
                      .join(' — ')
                  : 'Courier not yet assigned'
              }
            >
              <div className="relative flex items-center justify-center">
                <div className="absolute w-10 h-10 rounded-full bg-[#c5a880]/30 animate-ping"></div>
                <div className="w-8 h-8 bg-[#c5a880] border-2 border-[#161616] rounded-full flex items-center justify-center shadow-2xl text-black">
                  <Navigation className="w-4 h-4 transform rotate-45 fill-current" />
                </div>
              </div>
            </AdvancedMarker>
            )}

            {/* Interactive Student Hostels & Landmarks */}
            {landmarks.map((mark, i) => {
              if (mark.type === 'hub') return null;
              return (
                <AdvancedMarker
                  key={i}
                  position={{ lat: mark.lat, lng: mark.lng }}
                  title={mark.name}
                  onClick={() => setSelectedLandmark(mark)}
                >
                  <div className="w-3 h-3 rounded-full bg-stone-700/90 border border-white/30 hover:bg-brand-sage hover:scale-125 transition-all cursor-pointer shadow-md flex items-center justify-center">
                    <div className="w-1 h-1 bg-white rounded-full"></div>
                  </div>
                </AdvancedMarker>
              );
            })}
          </Map>
        </APIProvider>

        {/* HUD Overlay with Selected Hostel/Landmark details */}
        {selectedLandmark && (
          <div className="absolute bottom-4 left-4 right-4 z-20 bg-[#161616]/95 backdrop-blur-md p-3 rounded-xl border border-white/10 flex items-center justify-between gap-4 animate-fade-in text-left shadow-2xl">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase font-mono tracking-wider font-extrabold border ${
                  selectedLandmark.type === 'hub' ? 'bg-[#c5a880]/10 text-[#c5a880] border-[#c5a880]/30' :
                  selectedLandmark.type === 'hostel' ? 'bg-brand-sage/10 text-brand-sage border-brand-sage/30' :
                  'bg-stone-800 text-stone-400 border-white/5'
                }`}>
                  {selectedLandmark.type}
                </span>
                <strong className="font-serif text-xs text-white tracking-wide">{selectedLandmark.name}</strong>
              </div>
              <p className="text-[10.5px] text-stone-400 font-sans font-light leading-snug">
                {selectedLandmark.description} • Sector: <span className="text-brand-sage font-medium">{selectedLandmark.suburb}</span>
              </p>
            </div>
            <button
              onClick={() => setSelectedLandmark(null)}
              className="text-[9px] font-mono text-stone-500 hover:text-white uppercase font-bold px-2 py-1 bg-white/5 hover:bg-white/10 rounded transition-colors border border-white/5 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Floating Quick Stats Map Key */}
        <div className="absolute top-4 right-4 z-20 bg-black/90 p-3 rounded-xl border border-white/10 text-left max-w-[210px] space-y-2 backdrop-blur-sm pointer-events-auto">
          <span className="font-mono text-[8px] tracking-wider text-[#8E9299] block uppercase font-bold">Map Key / Coverage</span>
          <div className="space-y-1.5 text-[10px] font-sans">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded bg-[#c5a880] border border-black inline-block"></span>
              <span className="text-stone-300 font-light">FreshFold HQ (Wagyingo Opal)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-sage inline-block"></span>
              <span className="text-stone-300 font-light">Delivery Target</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-stone-700 border border-white/30 flex items-center justify-center inline-block">
                <div className="w-0.5 h-0.5 bg-white rounded-full"></div>
              </div>
              <span className="text-stone-300 font-light">Hostels (Evandy, Brunei, etc)</span>
            </div>
            {/* Says what is actually on screen. The old caption promised a
                dashed line for a polyline that was always solid, whether the
                routing engine had answered or not. */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#c5a880]">{isRoad ? '━' : '┄'}</span>
              <span className="text-[9px] text-[#8E9299] font-mono">
                {isRoad ? 'Solid Line = Road Route' : 'Dashed Line = Direct Estimate'}
              </span>
            </div>
          </div>
        </div>

        {/* Google Maps floating tip */}
        <div className="absolute top-4 left-4 z-20 bg-black/80 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-white/5 text-[9px] text-stone-400 font-mono flex items-center gap-1">
          <span>💡 Google Maps Live Telemetry. Click hostels for details.</span>
        </div>
      </div>
    </div>
  );
}

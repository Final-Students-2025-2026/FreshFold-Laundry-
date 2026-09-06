import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps';
import { Crosshair, Loader2, MapPin } from 'lucide-react';
import {
  anchorForSuburb,
  isOutsideServiceArea,
  matchLandmark,
  metresBetween,
  type Coords,
} from '@freshfold/core';

/**
 * Where the courier should knock, chosen on the website.
 *
 * The booking form has always been free text — "Victory Towers Hostel, Room
 * 304" — and no amount of parsing turns that into a doorstep. Without a pin the
 * dispatch server falls back to `coordsForAddress`, which hashes the string
 * into a stable offset from the suburb anchor: the same point on every screen,
 * and roughly four hundred metres from the building. The courier then navigates
 * confidently into a field.
 *
 * The customer app has asked for a real pin for a while. This is the same
 * question asked in the funnel most customers actually use. Optional, as it is
 * on the phone — a booking form that refuses to submit is worse than a courier
 * who has to ring the bell — but asked plainly, and with the consequence of
 * skipping it written on screen.
 */

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

const MAP_ID =
  (import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID ||
  process.env.GOOGLE_MAPS_MAP_ID ||
  'DEMO_MAP_ID';

/** How close to the suburb anchor still counts as "roughly the suburb". */
const ANCHOR_TOLERANCE_M = 30;

interface PickupPinFieldProps {
  value: Coords | null;
  onChange: (next: Coords | null) => void;
  /** Centres the map before a pin exists, and labels the fallback action. */
  suburb: string;
  /**
   * The typed address, watched for a hostel this product already knows the
   * coordinates of. Nothing is read out of it beyond that match.
   */
  address?: string;
  /**
   * How the current pin came to be, for the read-back. A pin the customer
   * dragged needs no explanation; one that appeared under them does.
   */
  origin?: PinOrigin;
  onOriginChange?: (next: PinOrigin) => void;
}

export type PinOrigin = 'map' | 'device' | 'suburb' | 'landmark' | 'place' | null;

const ORIGIN_NOTE: Record<Exclude<PinOrigin, null | 'map'>, string> = {
  device: 'from your device location',
  suburb: 'the middle of the suburb — drag the map to your gate',
  landmark: 'matched from the address you typed — check it is the right gate',
  place: 'from the address you chose — check it is the right gate',
};

/**
 * The pin does not move; the map does.
 *
 * Same idiom as the customer app and as every ride-hailing app: dragging a
 * marker means covering it with the cursor at the moment you need to see what
 * is under it. The pin sits at the centre of the viewport and the city slides
 * beneath it, committing when the map settles rather than on every frame.
 */
function CentrePinCommitter({
  onCommit,
  programmatic,
}: {
  onCommit: (next: Coords) => void;
  /** Set while the camera is being moved by code rather than by a hand. */
  programmatic: React.MutableRefObject<boolean>;
}) {
  const map = useMap();

  // Kept in a ref so a new callback identity does not re-subscribe the
  // listeners on every render of the form around it.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (!map) return;

    /**
     * `idle` also fires when the map first lays itself out. Committing that
     * would hand back a pin nobody aimed — the suburb anchor wearing the
     * customer's authority, which is the whole thing this field exists to
     * stop. So it only reports once the map has been moved on purpose.
     */
    let touched = false;

    const marks = ['dragstart', 'zoom_changed'].map((event) =>
      map.addListener(event, () => {
        /*
         * A fly-to is not a gesture. `MapFlyTo` changes the zoom, which fires
         * `zoom_changed` exactly like a pinch would — so without this guard
         * every programmatic move would mark the pin as hand-placed, which
         * silences the provenance note under the map and stops any later
         * address match from being applied.
         */
        if (programmatic.current) return;
        touched = true;
      })
    );

    const idle = map.addListener('idle', () => {
      if (programmatic.current) {
        // The camera has arrived where code sent it. Nothing to commit, and
        // the next real gesture starts from a clean slate.
        programmatic.current = false;
        return;
      }
      if (!touched) return;

      const centre = map.getCenter();
      if (centre) commitRef.current({ lat: centre.lat(), lng: centre.lng() });
    });

    return () => {
      marks.forEach((mark) => mark.remove());
      idle.remove();
    };
  }, [map, programmatic]);

  return null;
}

/**
 * Flies the camera to a point the customer did not pan to — the device fix, or
 * the suburb centre. Keyed on the coordinate, and deliberately fed from a
 * separate piece of state to the committed pin: driving it from the pin itself
 * would make every commit pan the map, and every pan a commit.
 */
function MapFlyTo({
  target,
  programmatic,
}: {
  target: Coords | null;
  programmatic: React.MutableRefObject<boolean>;
}) {
  const map = useMap();
  const key = target ? `${target.lat},${target.lng}` : null;

  useEffect(() => {
    if (!map || !target) return;
    programmatic.current = true;
    map.panTo(target);
    map.setZoom(17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}

/** Asks the browser where it is. Refuses a fix from outside Kumasi. */
function useBrowserFix(onFound: (next: Coords) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setError('This browser cannot share a location. Place the pin by hand instead.');
      return;
    }

    setBusy(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        const coords: Coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        // A customer booking from Accra for a Kumasi address would otherwise
        // send the courier 250 km down the N6.
        if (isOutsideServiceArea(coords)) {
          setError('That puts you outside our Kumasi service area. Place the pin by hand instead.');
          return;
        }

        onFound(coords);
      },
      () => {
        setBusy(false);
        setError('Could not read your location. Place the pin by hand, or allow location access.');
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }, [onFound]);

  return { locate, busy, error };
}

function formatDistance(metres: number): string {
  return metres < 950 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

export default function PickupPinField({
  value,
  onChange,
  suburb,
  address = '',
  origin = null,
  onOriginChange,
}: PickupPinFieldProps) {
  const [flyTo, setFlyTo] = useState<Coords | null>(null);
  const programmatic = useRef(false);

  const anchor = useMemo(() => anchorForSuburb(suburb), [suburb]);

  const place = useCallback(
    (next: Coords, how: PinOrigin) => {
      onChange(next);
      onOriginChange?.(how);
    },
    [onChange, onOriginChange]
  );

  /**
   * The camera follows any pin the customer did not drag there.
   *
   * Covers the pin arriving from outside this component entirely — the address
   * autocomplete sets it on the form, not here — which otherwise moved the pin
   * to a building somewhere off the edge of a map still sitting over the
   * suburb. `map` is excluded because a drag has already put the camera where
   * the customer wants it, and flying to it would fight them.
   */
  useEffect(() => {
    if (!value || origin === 'map') return;
    setFlyTo({ ...value });
  }, [value?.lat, value?.lng, origin]); // eslint-disable-line react-hooks/exhaustive-deps

  const { locate, busy, error } = useBrowserFix(
    useCallback((next: Coords) => place(next, 'device'), [place])
  );

  /*
   * There is no longer a suburb to follow.
   *
   * The camera used to chase the suburb because the customer picked one from a
   * field. That field is gone — the suburb is derived from the pin now — so
   * following it would mean the camera chasing the pin's own classification
   * around: drag across a boundary, and the map flies to the middle of the
   * suburb you just left for. The address lookup and the landmark match do
   * this job properly, by moving to a building rather than to a zone.
   */

  /**
   * Follow the address, when it names somewhere we already know.
   *
   * Fifteen halls and hostels have exact coordinates in `@freshfold/core`, and
   * the supervisor's map has always used them to place a booking after the
   * fact. Used here they put the pin on the building while the customer is
   * still typing the room number.
   *
   * It never overrides a pin the customer placed themselves — a match is a
   * starting point, and dragging is the last word.
   */
  const matched = useMemo(() => matchLandmark(address, ''), [address]);
  const appliedLandmark = useRef<string | null>(null);

  useEffect(() => {
    if (!matched) return;
    if (appliedLandmark.current === matched.name) return;
    if (value && (origin === 'map' || origin === 'device' || origin === 'place')) return;

    appliedLandmark.current = matched.name;
    place({ lat: matched.lat, lng: matched.lng }, 'landmark');
  }, [matched, value, origin, place]);

  // Read once: after this the map owns its own camera, and handing a centre
  // back to a map the customer is dragging fights them for it.
  const initialCentre = useMemo(() => value ?? anchor, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fromAnchor = value ? metresBetween(value, anchor) : 0;
  const originNote = origin && origin !== 'map' ? ORIGIN_NOTE[origin] : null;

  return (
    <div className="space-y-2.5">
      {/* Sized and worded like every other field in the booking form. This
          was an 11px tracked-uppercase label with a 9.5px monospace
          "DOORSTEP ACCURACY" badge beside it — two type scales and a register
          the rest of the product has stopped using, on the one control whose
          instructions actually have to be read. */}
      <span className="block text-[13px] font-medium text-brand-text-light">
        Drop a pin on your door <span className="text-brand-text-muted">(optional)</span>
      </span>

      {hasValidKey && (
        <div className="relative w-full h-[210px] rounded-md overflow-hidden border border-white/15 bg-brand-charcoal">
          <APIProvider apiKey={API_KEY} version="weekly">
            <Map
              defaultCenter={initialCentre}
              defaultZoom={16}
              mapId={MAP_ID}
              style={{ width: '100%', height: '100%' }}
              colorScheme="DARK"
              gestureHandling="greedy"
              disableDefaultUI={true}
              zoomControl={true}
            >
              {/* A drag is the customer's own answer; it outranks every guess
                  above and stops them being reapplied. */}
              <CentrePinCommitter
                programmatic={programmatic}
                onCommit={(next) => {
                  onChange(next);
                  onOriginChange?.('map');
                }}
              />
              <MapFlyTo target={flyTo} programmatic={programmatic} />
            </Map>
          </APIProvider>

          {/* The pin itself: fixed to the centre, never under the cursor. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center -translate-y-3">
              <div className="w-7 h-7 rounded-full bg-brand-gold border-2 border-white shadow-2xl flex items-center justify-center">
                <MapPin className="w-3.5 h-3.5 text-white fill-current" />
              </div>
              <div className="w-0.5 h-2 bg-brand-gold" />
            </div>
          </div>

          {!value && (
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 bg-black/85 border border-white/10 rounded-lg px-3 py-2">
              <p className="text-body font-medium text-white">
                Move the map so the pin sits on your gate
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={locate}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-md bg-brand-sage py-3 text-[15px] font-medium text-white transition-colors duration-200 hover:bg-brand-sage-light disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          {busy ? 'Finding you…' : 'Use my current location'}
        </button>
        <button
          type="button"
          onClick={() => place({ ...anchor }, 'suburb')}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-white/15 py-3 text-[15px] font-medium text-white transition-colors duration-200 hover:border-white/30"
        >
          <MapPin className="w-4 h-4" />
          Use the centre of {suburb.trim() || 'campus'}
        </button>
      </div>

      {!!error && (
        <p className="rounded-md border border-brand-gold/30 bg-brand-gold/5 px-3 py-2 text-body text-brand-gold">
          {error}
        </p>
      )}

      {value ? (
        <div className="space-y-0.5">
          <p className="text-body text-brand-text-muted tnum">
            Pinned at {value.lat.toFixed(5)}° N, {Math.abs(value.lng).toFixed(5)}° W ·{' '}
            {fromAnchor < ANCHOR_TOLERANCE_M
              ? `the centre of ${suburb.trim() || 'campus'}`
              : `${formatDistance(fromAnchor)} from the centre of ${suburb.trim() || 'campus'}`}
          </p>
          {/* Where the pin came from, when it was not dragged there. A pin that
              appeared under the customer without explanation is the same
              unexamined guess the derived location used to be. */}
          {!!originNote && <p className="text-body text-brand-gold">{originNote}</p>}
        </div>
      ) : (
        <p className="text-body text-brand-text-muted">
          {hasValidKey
            ? 'No pin yet. Without one your courier is sent to the middle of the suburb and will call you from there.'
            : 'Map unavailable. Share your location or pick the suburb centre — without either, your courier is sent to the middle of the suburb and will call you from there.'}
        </p>
      )}
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bike, Crosshair, Home, Warehouse } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { LAUNDRY_HUB, routeEtaMinutes, type Booking, type Coords } from '@freshfold/core';
import { MAP_PROVIDER } from '@freshfold/rn-maps';
import { useRoadRoute } from '../hooks/useRoadRoute';
import { jobStatusLabel, useT } from '../i18n';
import { colors, courierName, courierVehicle, radius, shadow, tints } from '../theme';
import MapPanel from './MapPanel';

/**
 * The customer's live map.
 *
 * Deliberately narrower than the rider console's: there is one job, one
 * courier and no dispatch controls. What it renders is the pickup pin, the
 * hub, and — once a courier is on the job — their reported position with the
 * leg they are currently driving.
 *
 * The rider app owns the telemetry; this only ever reads it. If the native map
 * fails to mount, `MapPanel` takes over so a tile problem degrades this card
 * rather than the screen.
 */

interface TrackingMapProps {
  booking: Booking;
  /** Rendered on web, where `react-native-maps` has no implementation. */
  notice?: string;
}

/**
 * Module scope on purpose: this is a constant, and a constant built inside the
 * component body is a new object on every render, which silently defeats every
 * memo and effect that depends on it.
 */
const HUB: Coords = { lat: LAUNDRY_HUB.lat, lng: LAUNDRY_HUB.lng };

/**
 * Keeps a map failure contained. `react-native-maps` is a native view, so a
 * missing module or a bad Google Maps key on the device throws while rendering
 * — without this the whole order screen goes with it. Same guard the rider
 * console puts around its own map.
 */
class MapBoundary extends React.Component<
  { fallback: (message: string) => React.ReactNode; children: React.ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.warn('[TrackingMap] native map failed to render, showing panel:', error);
  }

  render() {
    if (this.state.message !== null) return this.props.fallback(this.state.message);
    return this.props.children;
  }
}

export default function TrackingMap(props: TrackingMapProps) {
  const { t } = useT();

  return (
    <MapBoundary
      fallback={(message) => (
        <MapPanel booking={props.booking} notice={t('map.failed', { message })} />
      )}
    >
      <NativeTrackingMap {...props} />
    </MapBoundary>
  );
}

function NativeTrackingMap({ booking }: TrackingMapProps) {
  const { t, locale } = useT();
  const mapRef = useRef<MapView | null>(null);

  const pickup = booking.pickupCoords;
  const courier = booking.rider?.coords;

  /**
   * Whether the camera still belongs to the map.
   *
   * It stops the moment the customer touches it. The follow-cam below used to
   * be unconditional, and — because the booking is re-fetched on a poll, so
   * every coordinate on this card is a fresh object every render — it re-armed
   * on each one. A customer pinching in to see which side of the road the
   * courier was on got about a tenth of a second before the camera pulled back
   * out. Touch takes it; the recenter button hands it back.
   */
  const [following, setFollowing] = useState(true);

  /**
   * Which leg the courier is on decides what the line connects. Before pickup
   * they are heading to the door; after it, to the hub; on the return, back to
   * the door again.
   */
  const jobStatus = booking.rider?.jobStatus;
  const destination = useMemo<Coords>(() => {
    if (jobStatus === 'navigating_to_laundry' || jobStatus === 'arrived_at_laundry') return HUB;
    return pickup ?? HUB;
    // Memoised on the coordinates themselves rather than on `pickup`, which is
    // a new object on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus, pickup?.lat, pickup?.lng]);

  /** The road the courier is on, drawn from wherever they are to wherever they are going. */
  const route = useRoadRoute(courier ?? null, courier ? destination : null);

  /** Minutes, or null when the leg on screen is the dashed fallback. */
  const etaMinutes = route ? routeEtaMinutes(route) : null;

  const region = useMemo<Region>(() => {
    const points = [pickup, HUB, courier].filter(Boolean) as Coords[];
    return regionFor(points);
    // Same reason as above: these objects are replaced wholesale on every
    // poll, so the memo has to key on the numbers inside them or it is not a
    // memo at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, courier?.lat, courier?.lng]);

  // Follow the courier as they move, but gently — an animated camera on every
  // 4-second poll would make the card feel like it is twitching.
  useEffect(() => {
    if (!courier || !following) return;
    const timer = setTimeout(() => mapRef.current?.animateToRegion(region, 900), 120);
    return () => clearTimeout(timer);
  }, [courier, following, region]);

  const recenter = () => {
    setFollowing(true);
    mapRef.current?.animateToRegion(region, 500);
  };

  // A booking the server has not pinned yet has nothing to draw.
  if (!pickup) {
    return <MapPanel booking={booking} notice={t('map.noPin')} />;
  }

  return (
    <View style={styles.wrapper}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
        // A touch is the customer saying "let me look" — pan or pinch, both of
        // which have to release the camera, and only this fires for both.
        onTouchStart={() => setFollowing(false)}
      >
        <Marker coordinate={toLatLng(pickup)} anchor={{ x: 0.5, y: 0.5 }} title={t('map.home')}>
          <View style={[styles.pin, styles.pinHome]}>
            <Home size={13} color="#FFFFFF" />
          </View>
        </Marker>

        <Marker coordinate={toLatLng(HUB)} anchor={{ x: 0.5, y: 0.5 }} title={LAUNDRY_HUB.name}>
          <View style={[styles.pin, styles.pinHub]}>
            <Warehouse size={12} color="#FFFFFF" />
          </View>
        </Marker>

        {!!courier && (
          <>
            <Marker
              coordinate={toLatLng(courier)}
              anchor={{ x: 0.5, y: 0.5 }}
              title={courierName(booking.rider, locale)}
              description={courierVehicle(booking.rider, locale)}
            >
              <View style={styles.courierHalo}>
                <View style={styles.courierPin}>
                  <Bike size={14} color="#FFFFFF" />
                </View>
              </View>
            </Marker>

            {/*
              The road, when the server has it. Dashed only while it is still
              the straight-line stand-in — a solid line is a claim about which
              way they are coming, and a dashed one reads as the guess it is.
            */}
            <Polyline
              coordinates={
                route
                  ? route.coordinates.map(toLatLng)
                  : [toLatLng(courier), toLatLng(destination)]
              }
              strokeColor={colors.brandSage}
              strokeWidth={route?.source === 'roads' ? 4 : 3}
              lineDashPattern={route?.source === 'roads' ? undefined : [8, 6]}
              lineCap="round"
            />
          </>
        )}
      </MapView>

      {/* Only worth showing once there is something to recenter on, and only
          once the customer has taken the camera. */}
      {!!courier && !following && (
        <Pressable
          onPress={recenter}
          accessibilityLabel={t('map.recenter')}
          hitSlop={8}
          style={({ pressed }) => [styles.recenterButton, pressed && { opacity: 0.8 }]}
        >
          <Crosshair size={15} color={colors.brandSage} />
        </Pressable>
      )}

      {!!booking.rider && (
        <View style={styles.etaChip}>
          <View style={styles.etaDot} />
          <Text style={styles.etaText}>
            {/* The routing engine's own estimate, or nothing. `routeEtaMinutes`
                returns null for the server's straight-line fallback — that leg's
                duration is the chord divided by an assumed speed, which is what
                every arrival time in this app used to be. With no route to read,
                the stage is the honest answer. */}
            {etaMinutes !== null
              ? t('map.eta', { minutes: etaMinutes })
              : jobStatusLabel(t, booking.rider.jobStatus)}
          </Text>
        </View>
      )}
    </View>
  );
}

function toLatLng(coords: Coords) {
  return { latitude: coords.lat, longitude: coords.lng };
}

/** A region that fits every supplied point, with a little breathing room. */
function regionFor(points: Coords[]): Region {
  if (points.length === 0) {
    return {
      latitude: LAUNDRY_HUB.lat,
      longitude: LAUNDRY_HUB.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.012, (maxLat - minLat) * 1.7),
    longitudeDelta: Math.max(0.012, (maxLng - minLng) * 1.7),
  };
}

const styles = StyleSheet.create({
  wrapper: {
    height: 260,
    borderRadius: radius.xxl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgSand,
    ...shadow.xs,
  },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...shadow.md,
  },
  pinHome: { backgroundColor: colors.brandGold },
  pinHub: { backgroundColor: colors.textCharcoal },

  courierHalo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tints.sage25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courierPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  recenterButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardPure,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    ...shadow.md,
  },

  etaChip: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.cardPure,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    ...shadow.md,
  },
  etaDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.statusSuccess },
  etaText: { fontSize: 10.5, fontWeight: '800', color: colors.textCharcoal },
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Activity, Minus, Navigation, Plus } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { routeEtaMinutes } from '@freshfold/core';
import { MAP_PROVIDER } from '@freshfold/rn-maps';
import { LAUNDRY_HUB_COORDS } from '../data/initialState';
import { useRoadRoute } from '../hooks/useRoadRoute';
import { NavigationTarget } from '../store/AppStore';
import { colors, formatCedis, ink, radius, shadow, text, tints, touch } from '../theme';
import { Coords, Order, RiderState } from '../types';
import MapFallback from './MapFallback';
import { Badge, Button, Divider } from './ui';

interface LiveMapProps {
  rider: RiderState;
  orders: Order[];
  activeOrder?: Order;
  navigationTarget: NavigationTarget | null;
  /** Order the map should fly to, set when arriving from another screen. */
  focusedOrderId?: string | null;
  onSelectOrder?: (order: Order) => void;
  onAcceptOrder?: (orderId: string) => void;
  /**
   * Extra room above the map's own top overlay, for screens that float their
   * own chrome in the same corner. The safe-area inset is already accounted
   * for — this is only the height of what sits above.
   */
  overlayTopOffset?: number;
}

const DEFAULT_DELTA = 0.012;

function toRegion(coords: Coords, delta = DEFAULT_DELTA): Region {
  return {
    latitude: coords.lat,
    longitude: coords.lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

/**
 * Keeps a map failure contained. `react-native-maps` is a native view, so a
 * missing module or a bad Google Maps key on the device throws while rendering
 * — without this the whole screen (and the rider's active job) goes with it.
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
    console.warn('[LiveMap] native map failed to render, showing fallback:', error);
  }

  render() {
    if (this.state.message !== null) return this.props.fallback(this.state.message);
    return this.props.children;
  }
}

export default function LiveMap(props: LiveMapProps) {
  return (
    <MapBoundary
      fallback={(message) => (
        <MapFallback
          {...props}
          notice={`The map could not be loaded on this device (${message}). Everything else on this screen still works.`}
        />
      )}
    >
      <NativeLiveMap {...props} />
    </MapBoundary>
  );
}

function NativeLiveMap({
  rider,
  orders,
  activeOrder,
  navigationTarget,
  focusedOrderId,
  onSelectOrder,
  onAcceptOrder,
  overlayTopOffset = 0,
}: LiveMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // The map fills the screen, edge to edge and under the status bar, so its
  // floating controls have to clear the inset themselves. Without this the GPS
  // badge and the zoom buttons sit under a notch or Dynamic Island.
  const insets = useSafeAreaInsets();

  // Custom marker views must stop re-rendering into the map texture once they
  // have painted, or Android drops frames on every rider tick.
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracksViewChanges(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  const visibleOrders = useMemo(
    () => orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled'),
    [orders]
  );

  // A pin tapped on another screen wins the camera.
  useEffect(() => {
    if (!focusedOrderId) return;
    const found = orders.find((o) => o.id === focusedOrderId);
    if (!found) return;

    setSelectedOrder(found);
    mapRef.current?.animateToRegion(toRegion(found.pickupCoords, 0.005), 600);
  }, [focusedOrderId, orders]);

  // Frame the whole leg when a new destination is set, then follow the rider.
  const legKey = navigationTarget
    ? `${navigationTarget.coords.lat},${navigationTarget.coords.lng}`
    : null;

  /**
   * Whether the camera is still following the courier.
   *
   * It stops the moment they drag the map. Without this the follow-cam below
   * yanks the view back to the rider on every position report — and since the
   * watch tightened to a fix every two seconds while navigating, a courier
   * trying to look at the junction ahead got about a second and a half before
   * the map snapped back. The recenter button is how they opt back in.
   */
  const [following, setFollowing] = useState(true);

  /**
   * The road to the destination, from the dispatch server.
   *
   * What used to be drawn here was a dogleg: rider → a corner → target, three
   * points pretending to be a route. It crossed buildings, the botanical
   * gardens and the Ayeduase gate wall indiscriminately, and on the hub run it
   * was 60% shorter than the road it stood in for.
   */
  const route = useRoadRoute(navigationTarget ? rider.coords : null, navigationTarget?.coords ?? null);

  /**
   * Minutes to the destination, or nothing.
   *
   * `routeEtaMinutes` answers only for a leg a routing engine actually
   * computed — so this is null while the first answer is in flight, and null
   * for good when the server had to fall back to the straight line.
   */
  const navEtaMinutes = route ? routeEtaMinutes(route) : null;

  const routeCoordinates = route
    ? route.coordinates.map((point) => ({ latitude: point.lat, longitude: point.lng }))
    : navigationTarget
      ? // Until the road arrives, the straight line — one segment, not a
        // dogleg, so it never looks like a route it is not.
        [
          { latitude: rider.coords.lat, longitude: rider.coords.lng },
          { latitude: navigationTarget.coords.lat, longitude: navigationTarget.coords.lng },
        ]
      : [];

  useEffect(() => {
    if (!navigationTarget || !mapRef.current) return;

    // Frame the road, not the crow's flight: a route that loops out to a
    // junction and back sits outside a box drawn around its two ends.
    const frame =
      routeCoordinates.length > 1
        ? routeCoordinates
        : [
            { latitude: rider.coords.lat, longitude: rider.coords.lng },
            { latitude: navigationTarget.coords.lat, longitude: navigationTarget.coords.lng },
          ];

    mapRef.current.fitToCoordinates(frame, {
      edgePadding: { top: 110, right: 60, bottom: 190, left: 60 },
      animated: true,
    });
    setFollowing(true);
    // Re-framing on every rider tick would fight the follow-cam below, so this
    // runs when the leg changes or when its road first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKey, route?.source, route?.coordinates.length]);

  useEffect(() => {
    if (!navigationTarget || selectedOrder || !following) return;
    mapRef.current?.animateCamera(
      { center: { latitude: rider.coords.lat, longitude: rider.coords.lng } },
      { duration: 800 }
    );
  }, [rider.coords.lat, rider.coords.lng, navigationTarget, selectedOrder, following]);

  const routeColor = activeOrder?.priority === 'elite' ? colors.brandGold : colors.brandSage;

  const recenter = () => {
    setFollowing(true);
    mapRef.current?.animateToRegion(toRegion(rider.coords, 0.006), 500);
  };

  const zoomBy = (factor: number) => {
    mapRef.current
      ?.getCamera()
      .then((camera) => {
        if (camera.zoom != null) {
          mapRef.current?.animateCamera({ zoom: camera.zoom + factor }, { duration: 250 });
        } else if (camera.altitude != null) {
          // Apple Maps reports altitude instead of a zoom level.
          mapRef.current?.animateCamera(
            { altitude: camera.altitude / Math.pow(2, factor) },
            { duration: 250 }
          );
        }
      })
      .catch(() => {
        // The map went away mid-gesture. Nothing to zoom, nothing to report.
      });
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        initialRegion={toRegion(rider.coords)}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        onPress={() => setSelectedOrder(null)}
        // A touch is the courier saying "let me look" — the camera lets go
        // until they ask for it back.
        //
        // `onTouchStart` rather than `onPanDrag`, because a pinch is not a
        // drag: a courier zooming in on the junction ahead did not fire the
        // pan gesture, so the follow-cam kept its grip and pulled the zoom
        // straight back out on the next fix.
        onTouchStart={() => setFollowing(false)}
      >
        {/* Central laundry hub */}
        <Marker
          coordinate={{ latitude: LAUNDRY_HUB_COORDS.lat, longitude: LAUNDRY_HUB_COORDS.lng }}
          tracksViewChanges={tracksViewChanges}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.hubMarker}>
            <View style={styles.hubDot}>
              <View style={styles.hubDiamond} />
            </View>
            <Text style={styles.hubLabel}>FreshFold Hub</Text>
          </View>
        </Marker>

        {/* Pickup pins */}
        {visibleOrders.map((order) => {
          const isSelected = selectedOrder?.id === order.id;
          const isActive = activeOrder?.id === order.id;

          return (
            <Marker
              key={order.id}
              coordinate={{
                latitude: order.pickupCoords.lat,
                longitude: order.pickupCoords.lng,
              }}
              tracksViewChanges={tracksViewChanges || isSelected}
              anchor={{ x: 0.5, y: 1 }}
              onPress={(e) => {
                e.stopPropagation();
                setSelectedOrder(order);
                onSelectOrder?.(order);
              }}
            >
              <View style={styles.pinWrapper}>
                <View
                  style={[
                    styles.pin,
                    isSelected && styles.pinSelected,
                    !isSelected && isActive && styles.pinActive,
                  ]}
                >
                  <View
                    style={[
                      styles.pinDot,
                      (isSelected || isActive) && { backgroundColor: '#FFFFFF' },
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.pinLabel,
                      (isSelected || isActive) && { color: '#FFFFFF' },
                    ]}
                  >
                    {order.customerName}
                  </Text>
                </View>
                <Text style={styles.pinSubLabel} numberOfLines={1}>
                  📍 {order.pickupAddress.split(',')[0]}
                </Text>
              </View>
            </Marker>
          );
        })}

        {/* The rider */}
        <Marker
          coordinate={{ latitude: rider.coords.lat, longitude: rider.coords.lng }}
          tracksViewChanges={tracksViewChanges}
          anchor={{ x: 0.5, y: 0.5 }}
          rotation={rider.heading}
          flat
          zIndex={40}
        >
          <View style={styles.riderHalo}>
            <View style={styles.riderDot}>
              <Navigation size={14} color="#FFFFFF" fill="#FFFFFF" />
            </View>
          </View>
        </Marker>

        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={routeColor}
            strokeWidth={4}
            lineCap="round"
          />
        )}
      </MapView>

      {/* GPS quality + map controls */}
      <View
        style={[
          styles.topOverlay,
          { top: insets.top + 12 + overlayTopOffset, pointerEvents: 'box-none' },
        ]}
      >
        <View style={styles.gpsBadge}>
          <Activity size={13} color={colors.statusSuccess} />
          <View>
            <Text style={styles.gpsTitle}>GPS High Accuracy</Text>
            <Text style={styles.gpsSub}>KNUST Campus Grid</Text>
          </View>
        </View>

        <View style={styles.mapControls}>
          {/* Filled while the camera is following, hollow once the courier has
              panned away — so the button says what tapping it will do. */}
          <Pressable
            onPress={recenter}
            accessibilityLabel={
              following ? 'Recenter map on rider' : 'Follow the rider again'
            }
            style={({ pressed }) => [
              styles.controlButton,
              following && styles.controlActive,
              pressed && styles.controlPressed,
            ]}
          >
            <Navigation
              size={16}
              color={following ? '#FFFFFF' : colors.brandSage}
              fill={following ? '#FFFFFF' : 'transparent'}
            />
          </Pressable>
          <Pressable
            onPress={() => zoomBy(1)}
            accessibilityLabel="Zoom in"
            style={({ pressed }) => [
              styles.controlButton,
              styles.controlSmall,
              pressed && styles.controlPressed,
            ]}
          >
            <Plus size={14} color={colors.textCharcoal} />
          </Pressable>
          <Pressable
            onPress={() => zoomBy(-1)}
            accessibilityLabel="Zoom out"
            style={({ pressed }) => [
              styles.controlButton,
              styles.controlSmall,
              pressed && styles.controlPressed,
            ]}
          >
            <Minus size={14} color={colors.textCharcoal} />
          </Pressable>
        </View>
      </View>

      {/* Tapped pin detail */}
      {selectedOrder && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <View style={styles.detailTitleRow}>
                <Text style={styles.detailName} numberOfLines={1}>
                  {selectedOrder.customerName}
                </Text>
                <Badge
                  label={selectedOrder.priority}
                  tone={selectedOrder.priority === 'elite' ? 'gold' : 'sage'}
                />
              </View>
              <Text style={styles.detailOrderNumber}>{selectedOrder.orderNumber}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelectedOrder(null)}
              hitSlop={touch.slop}
              accessibilityLabel="Dismiss pin details"
              style={styles.detailCloseButton}
            >
              <Text style={styles.detailClose}>✕</Text>
            </Pressable>
          </View>

          <Divider style={{ marginVertical: 8 }} />

          <Text style={styles.detailAddress}>📍 {selectedOrder.pickupAddress}</Text>
          <Text style={styles.detailCoords}>
            {selectedOrder.pickupCoords.lat.toFixed(4)}° N,{' '}
            {Math.abs(selectedOrder.pickupCoords.lng).toFixed(4)}° W
          </Text>

          <View style={styles.detailStatsRow}>
            {/*
              Distance, load and fare — the three things that decide whether to
              take a job. The middle figure was the job's stored `estDuration`,
              a straight line divided by an assumed scooter speed; a bag count
              is something the courier can verify at the door.
            */}
            <Text style={styles.detailStat}>{selectedOrder.distance} km</Text>
            <Text style={styles.detailStat}>
              {selectedOrder.bagCount} {selectedOrder.bagCount === 1 ? 'bag' : 'bags'}
            </Text>
            <Text style={[styles.detailStat, { color: ink.sage, fontWeight: '700' }]}>
              {formatCedis(selectedOrder.price)}
            </Text>
          </View>

          {selectedOrder.status === 'unassigned' && onAcceptOrder && (
            <Button
              label="Accept task at location"
              onPress={() => {
                onAcceptOrder(selectedOrder.id);
                setSelectedOrder(null);
              }}
              style={{ marginTop: 10 }}
            />
          )}
        </View>
      )}

      {/* Turn-by-turn strip */}
      {navigationTarget && activeOrder && !selectedOrder && (
        <View style={styles.navCard}>
          <View style={styles.navIcon}>
            <Navigation size={16} color={colors.brandSage} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.navTitle} numberOfLines={1}>
              {activeOrder.status === 'navigating_to_pickup'
                ? 'Navigating to pickup'
                : activeOrder.status === 'navigating_to_laundry'
                  ? 'Navigating to laundry hub'
                  : 'Navigating to delivery'}
            </Text>
            <Text style={styles.navSubtitle} numberOfLines={1}>
              {navigationTarget.label}
            </Text>
          </View>
          {/*
            Distance and time for the leg being ridden right now, off the road
            route. `activeOrder.distance` is the job's hub-to-pickup figure,
            fixed when it was booked — it does not shrink as the courier gets
            closer, and it was measured in a straight line anyway.

            The minutes come from the routing engine or not at all. What used to
            stand in was the job's stored `estDuration`, which was that same
            straight line divided by an assumed 18 km/h.
          */}
          <View style={styles.navMetrics}>
            <Text style={styles.navDistance}>
              {route
                ? `${(route.distanceMeters / 1000).toFixed(1)} km`
                : `${activeOrder.distance} km`}
            </Text>
            {navEtaMinutes !== null && (
              <Text style={styles.navEta}>Est. {navEtaMinutes} min</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgLinen,
    overflow: 'hidden',
  },

  /* markers */
  hubMarker: { alignItems: 'center' },
  hubDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brandSage,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.xs,
  },
  hubDiamond: {
    width: 7,
    height: 7,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }],
  },
  hubLabel: {
    marginTop: 4,
    ...text.micro,
    fontWeight: '700',
    color: colors.textCharcoal,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  pinWrapper: { alignItems: 'center', maxWidth: 150 },
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: colors.brandSage,
    ...shadow.xs,
  },
  pinSelected: {
    backgroundColor: colors.brandSage,
    borderColor: '#FFFFFF',
  },
  pinActive: {
    backgroundColor: colors.brandGold,
    borderColor: '#FFFFFF',
  },
  pinDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brandSage,
  },
  pinLabel: {
    ...text.micro,
    fontWeight: '700',
    color: ink.sage,
    maxWidth: 110,
  },
  pinSubLabel: {
    marginTop: 3,
    ...text.micro,
    fontWeight: '600',
    color: colors.textCharcoal,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  riderHalo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tints.sage20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brandSage,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },

  /* overlays */
  topOverlay: {
    position: 'absolute',
    // `top` is applied inline — it depends on the device's safe-area inset.
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  gpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    ...shadow.md,
  },
  gpsTitle: { ...text.overline, color: colors.textCharcoal },
  gpsSub: { ...text.micro, marginTop: 2 },
  mapControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  controlButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  controlSmall: { width: touch.min, height: touch.min, borderRadius: touch.min / 2 },
  controlActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  controlPressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },

  detailCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 16,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: tints.sage30,
    padding: 14,
    ...shadow.lg,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailName: { ...text.strong, flexShrink: 1 },
  detailOrderNumber: { ...text.caption, fontWeight: '700', color: ink.gold, marginTop: 3 },
  // The tap target the bare glyph never had.
  detailCloseButton: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailClose: { ...text.title, color: colors.textSlate },
  detailAddress: { ...text.body, fontWeight: '600' },
  detailCoords: { ...text.mono, marginTop: 4 },
  detailStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  detailStat: text.body,

  navCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: tints.sage20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...shadow.md,
  },
  navIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tints.sage10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: text.strong,
  navSubtitle: { ...text.caption, marginTop: 2 },
  navMetrics: {
    alignItems: 'flex-end',
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSoft,
    paddingLeft: 10,
  },
  navDistance: { ...text.strong, color: ink.sage },
  navEta: text.micro,
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MapPin, Navigation } from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationTarget } from '../store/AppStore';
import { colors, formatCedis, ink, radius, shadow, text, tints, touch } from '../theme';
import { Order, RiderState } from '../types';
import { Badge, Button } from './ui';

interface MapFallbackProps {
  rider: RiderState;
  orders: Order[];
  activeOrder?: Order;
  navigationTarget: NavigationTarget | null;
  focusedOrderId?: string | null;
  onSelectOrder?: (order: Order) => void;
  onAcceptOrder?: (orderId: string) => void;
  /** Shown in place of the default copy when the native map failed to load. */
  notice?: string;
}

/**
 * Stand-in for the native map: a coordinate readout and a tappable pin list —
 * every action the real map offers, minus the tiles.
 *
 * Used on web (`react-native-maps` is iOS/Android only) and as the safety net
 * when the native map fails to mount, so a map problem degrades this screen
 * instead of taking down the app.
 */
export default function MapFallback({
  rider,
  orders,
  activeOrder,
  navigationTarget,
  focusedOrderId,
  onSelectOrder,
  onAcceptOrder,
  notice,
}: MapFallbackProps) {
  // This panel stands in for a full-bleed map, so it owns the same edge-to-edge
  // area and has to clear the notch itself.
  const insets = useSafeAreaInsets();

  const visibleOrders = orders.filter(
    (o) => o.status !== 'delivered' && o.status !== 'cancelled'
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 14 }]}>
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Map preview</Text>
        <Text style={styles.noticeBody}>
          {notice ?? 'Live tiles render on iOS and Android.'}
        </Text>
      </View>

      <View style={styles.riderCard}>
        <View style={styles.riderIcon}>
          <Navigation size={15} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.riderLabel}>Rider position</Text>
          <Text style={styles.riderCoords}>
            {rider.coords.lat.toFixed(5)}° N, {Math.abs(rider.coords.lng).toFixed(5)}° W
          </Text>
        </View>
        <Text style={styles.riderSpeed}>{rider.speed} km/h</Text>
      </View>

      {navigationTarget && (
        <View style={styles.navCard}>
          <Text style={styles.navTitle}>Navigating to {navigationTarget.label}</Text>
          <Text style={styles.navCoords}>
            {navigationTarget.coords.lat.toFixed(5)}° N,{' '}
            {Math.abs(navigationTarget.coords.lng).toFixed(5)}° W
            {activeOrder ? ` • ${activeOrder.distance} km` : ''}
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.pinList}>
        {visibleOrders.map((order) => {
          const focused = focusedOrderId === order.id;
          const active = activeOrder?.id === order.id;

          return (
            <Pressable
              key={order.id}
              onPress={() => onSelectOrder?.(order)}
              style={[styles.pinRow, (focused || active) && styles.pinRowActive]}
            >
              <MapPin size={14} color={active ? colors.brandGold : colors.brandSage} />
              <View style={{ flex: 1 }}>
                <View style={styles.pinTitleRow}>
                  <Text style={styles.pinName} numberOfLines={1}>
                    {order.customerName}
                  </Text>
                  <Badge
                    label={order.priority}
                    tone={order.priority === 'elite' ? 'gold' : 'sage'}
                  />
                </View>
                <Text style={styles.pinAddress} numberOfLines={1}>
                  {order.pickupAddress}
                </Text>
                <Text style={styles.pinMeta}>
                  {order.pickupCoords.lat.toFixed(4)}° N,{' '}
                  {Math.abs(order.pickupCoords.lng).toFixed(4)}° W •{' '}
                  {formatCedis(order.price)}
                </Text>
              </View>

              {order.status === 'unassigned' && onAcceptOrder && (
                <Button
                  label="Accept"
                  onPress={() => onAcceptOrder(order.id)}
                  style={styles.acceptButton}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // `paddingTop` is applied inline — it depends on the device's safe-area inset.
  container: { flex: 1, backgroundColor: colors.bgLinen, padding: 14, gap: 10 },
  notice: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    gap: 3,
    ...shadow.xs,
  },
  noticeTitle: text.overline,
  noticeBody: text.body,

  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tints.sage20,
    padding: 12,
    ...shadow.xs,
  },
  riderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderLabel: text.overline,
  riderCoords: { ...text.mono, color: colors.textCharcoal, marginTop: 3 },
  riderSpeed: { ...text.bodyStrong, color: ink.sage },

  navCard: {
    backgroundColor: tints.gold05,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tints.gold30,
    padding: 12,
    gap: 2,
  },
  navTitle: text.strong,
  navCoords: text.mono,

  pinList: { gap: 8, paddingBottom: 12 },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: touch.min,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
  },
  pinRowActive: { borderColor: colors.brandSage },
  pinTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pinName: { ...text.strong, flexShrink: 1 },
  pinAddress: { ...text.caption, marginTop: 3 },
  pinMeta: { ...text.caption, marginTop: 3 },
  acceptButton: { paddingHorizontal: 16 },
});

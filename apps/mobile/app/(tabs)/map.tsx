/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocalSearchParams } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LiveMap from '../../src/components/LiveMap';
import { useApp } from '../../src/store/AppStore';
import { colors, ink, radius, shadow, text } from '../../src/theme';

export default function MapScreen() {
  // Tapping "Pin" on an assignment card routes here with the order to frame.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const {
    rider,
    orders,
    myOrders,
    activeOrder,
    focusedOrderId,
    focusOrder,
    navigationTarget,
    acceptOrder,
    profileComplete,
  } = useApp();

  return (
    <View style={styles.container}>
      <LiveMap
        rider={rider}
        orders={orders}
        activeOrder={activeOrder}
        navigationTarget={navigationTarget}
        // The route param wins — it is the courier having just tapped "Pin" on
        // a specific card — and otherwise this follows the job the workflow
        // sheet is on, so switching jobs on the home screen reframes the map.
        focusedOrderId={focus ?? focusedOrderId ?? activeOrder?.id ?? null}
        onSelectOrder={(order) => {
          if (myOrders.some((o) => o.id === order.id)) focusOrder(order.id);
        }}
        // See the note on the home screen's map: no accept control at all
        // until the profile is complete.
        onAcceptOrder={profileComplete ? acceptOrder : undefined}
      />

      <SafeAreaView style={[styles.overlay, { pointerEvents: 'box-none' }]} edges={['top']}>
        {/* Said "Compass overlay", which described the chip rather than the
            board. A count is something the courier can act on. */}
        <View style={styles.countChip}>
          <MapPin size={18} color={ink.sage} />
          <Text style={styles.countLabel}>
            {orders.length} {orders.length === 1 ? 'job' : 'jobs'} on the map
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  overlay: { position: 'absolute', top: 0, left: 14, right: 14, alignItems: 'flex-start' },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    // Sits below the map's own GPS badge, which starts 12 below the safe-area
    // inset and stands about 38 tall. This chip is already inside a top
    // SafeAreaView, so the inset is not counted twice.
    marginTop: 60,
    ...shadow.md,
  },
  countLabel: { ...text.bodyStrong, color: colors.textCharcoal },
});

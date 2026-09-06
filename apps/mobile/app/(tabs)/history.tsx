/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { History as HistoryIcon, ShieldCheck } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, EmptyState } from '../../src/components/ui';
import { useApp } from '../../src/store/AppStore';
import { colors, formatCedis, ink, radius, text } from '../../src/theme';

export default function HistoryScreen() {
  const { orders, loadOrderProof } = useApp();

  const completed = useMemo(
    () => orders.filter((o) => o.status === 'delivered'),
    [orders]
  );

  /**
   * The board this list is built from arrives without its photographs — one
   * request every four seconds cannot carry them. This screen is the only
   * place a courier looks back at a finished job, so it asks for the ones it
   * is about to draw, once each, and only for jobs it does not already hold.
   */
  useEffect(() => {
    for (const order of completed) {
      if (!order.deliveryPhoto) void loadOrderProof(order.id);
    }
  }, [completed, loadOrderProof]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={text.heading}>Delivered</Text>
        <Text style={styles.subtitle}>
          {completed.length === 0
            ? 'Jobs you have finished will be listed here.'
            : `${completed.length} ${completed.length === 1 ? 'job' : 'jobs'}, with the proof you captured at the door.`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {completed.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon size={42} color={colors.brandStone} />}
            title="Nothing delivered yet"
            body="Once you hand a job over, it is listed here with its signature and photo."
          />
        ) : (
          completed.map((order) => (
            <View key={order.id} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineLine} />
              </View>

              <Card style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.customer} numberOfLines={1}>
                    {order.customerName}
                  </Text>
                  <Text style={styles.deadline}>{order.deadline}</Text>
                </View>

                <Text style={styles.address} numberOfLines={2}>
                  {order.pickupAddress}
                </Text>

                <View style={styles.proofRow}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.proofLabel}>Signature</Text>
                    <View style={styles.secureRow}>
                      <ShieldCheck size={18} color={ink.success} />
                      <Text style={styles.secureLabel}>
                        {order.deliverySignature ? 'Captured' : 'Not captured'}
                      </Text>
                    </View>
                    <Text style={styles.payout}>{formatCedis(order.price)}</Text>
                  </View>

                  {!!order.deliveryPhoto && (
                    <View style={{ gap: 4 }}>
                      <Text style={styles.proofLabel}>Photo</Text>
                      <Image source={{ uri: order.deliveryPhoto }} style={styles.proofImage} />
                    </View>
                  )}
                </View>
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  header: { paddingHorizontal: 18, paddingTop: 12 },
  subtitle: { ...text.caption, marginTop: 4 },

  list: { padding: 18, gap: 14, paddingBottom: 40 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineRail: { width: 12, alignItems: 'center', paddingTop: 8 },
  timelineDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.brandSage,
    borderWidth: 2,
    borderColor: colors.cardPure,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    marginTop: 4,
    backgroundColor: 'rgba(111, 122, 99, 0.35)',
  },

  card: { flex: 1, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  customer: { ...text.strong, flex: 1 },
  deadline: text.micro,
  address: text.caption,

  proofRow: {
    flexDirection: 'row',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: 10,
  },
  proofLabel: text.overline,
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secureLabel: { ...text.bodyStrong, color: ink.success },
  // Money, in the brand's colour for it — as an ink, not the 2.24:1 fill.
  payout: { ...text.strong, color: ink.gold, marginTop: 2 },
  proofImage: {
    width: 84,
    height: 60,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgLinen,
  },
});

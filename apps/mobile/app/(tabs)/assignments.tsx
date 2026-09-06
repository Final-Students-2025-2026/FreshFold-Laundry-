/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { Activity, CheckCircle2, CloudOff, Layers2, MapPin } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CustomerStage from '../../src/components/CustomerStage';
import ProfileGate from '../../src/components/ProfileGate';
import { Badge, Button, Card, Chip, ConnectionPill, EmptyState, Input } from '../../src/components/ui';
import { usePullToRefresh } from '../../src/hooks/usePullToRefresh';
import { useApp } from '../../src/store/AppStore';
import { colors, formatCedis, humanizeStatus, ink, radius, text, tints, touch } from '../../src/theme';
import { Order } from '../../src/types';

type Filter = 'all' | 'mine' | 'available' | 'completed';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All jobs' },
  { id: 'mine', label: 'In my hands' },
  { id: 'available', label: 'Going spare' },
  { id: 'completed', label: 'Completed' },
];

export default function AssignmentsScreen() {
  const router = useRouter();
  const { orders, myOrders, acceptOrder, focusOrder, connected, profileComplete } = useApp();
  const refreshControl = usePullToRefresh();

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  /** Ids this courier is holding, for the per-card decisions below. */
  const mine = useMemo(() => new Set(myOrders.map((o) => o.id)), [myOrders]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return orders.filter((order) => {
      const matches =
        !needle ||
        order.customerName.toLowerCase().includes(needle) ||
        order.orderNumber.toLowerCase().includes(needle);

      if (!matches) return false;

      switch (filter) {
        case 'mine':
          return mine.has(order.id);
        // Anything nobody holds and that is still running — which is not the
        // same as `unassigned`. A job the desk moved to a courier leg without
        // naming a courier is going spare too, and hiding it here is how those
        // sat on the customer's timeline with nobody collecting.
        case 'available':
          return !order.riderId && order.status !== 'delivered' && order.status !== 'cancelled';
        case 'completed':
          return order.status === 'delivered';
        default:
          return true;
      }
    });
  }, [orders, filter, query, mine]);

  const statusTone = (order: Order) => {
    if (order.status === 'delivered') return 'success' as const;
    if (order.status === 'unassigned') return 'muted' as const;
    return 'sage' as const;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={text.heading}>Jobs</Text>
          <ConnectionPill online={connected} />
        </View>
        <Text style={styles.subtitle}>
          {connected
            ? 'Take one that is going spare, or open one you are already holding.'
            : 'Showing the last board this device cached — new requests will not arrive until dispatch is reachable.'}
        </Text>
      </View>

      <View style={styles.controls}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search customers or codes…"
          accessibilityLabel="Search jobs"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((item) => (
            <Chip
              key={item.id}
              label={item.label}
              selected={filter === item.id}
              onPress={() => setFilter(item.id)}
            />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        <ProfileGate />

        {filtered.length === 0 ? (
          <EmptyState
            icon={
              connected ? (
                <Activity size={42} color={colors.brandStone} />
              ) : (
                <CloudOff size={42} color={ink.warning} />
              )
            }
            title={connected ? 'No assignments' : 'Not connected to dispatch'}
            body={
              connected
                ? "You're all caught up. New pickup requests will appear here."
                : 'This console cannot reach the dispatch server, so jobs booked on the website or in the customer app will not show up. Check the server is running and that this device is on the same network.'
            }
          />
        ) : (
          filtered.map((order) => (
            <Card key={order.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.customer} numberOfLines={1}>
                      {order.customerName}
                    </Text>
                    <Badge
                      label={order.priority}
                      tone={order.priority === 'elite' ? 'gold' : 'sage'}
                    />
                  </View>
                  <Text style={styles.orderNumber}>{order.orderNumber}</Text>
                  <View style={{ marginTop: 5 }}>
                    <CustomerStage status={order.status} compact />
                  </View>
                </View>

                <Badge label={humanizeStatus(order.status)} tone={statusTone(order)} />
              </View>

              <View style={styles.detailBlock}>
                <View style={styles.detailRow}>
                  <MapPin size={18} color={ink.sage} />
                  <Text style={styles.detailText} numberOfLines={1}>
                    Pickup: {order.pickupAddress}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${order.orderNumber} on the map`}
                    hitSlop={touch.slop}
                    onPress={() => router.push({ pathname: '/(tabs)/map', params: { focus: order.id } })}
                    style={({ pressed }) => [styles.pinChip, pressed && { opacity: 0.8 }]}
                  >
                    <MapPin size={16} color={ink.sage} />
                    <Text style={styles.pinChipLabel}>Map</Text>
                  </Pressable>
                </View>

                <View style={styles.detailRow}>
                  <Layers2 size={18} color={ink.sage} />
                  <Text style={styles.detailText} numberOfLines={1}>
                    {order.laundryType} ({order.bagCount} bags)
                  </Text>
                </View>

                <Text style={styles.coords}>
                  GPS {order.pickupCoords.lat.toFixed(4)}° N,{' '}
                  {Math.abs(order.pickupCoords.lng).toFixed(4)}° W
                </Text>
              </View>

              <View style={styles.cardFooter}>
                <View>
                  <Text style={styles.payoutLabel}>Payout</Text>
                  <Text style={styles.payout}>{formatCedis(order.price)}</Text>
                </View>

                {/* Keyed on who holds the job rather than on its status: a job
                    the desk left mid-flight with no courier is still one this
                    rider can take, and one they already hold is theirs to
                    drive whatever stage it has reached. */}
                {order.status !== 'delivered' && !order.riderId ? (
                  <Button
                    label="Accept"
                    size="compact"
                    disabled={!profileComplete}
                    onPress={() => {
                      acceptOrder(order.id);
                      router.push('/(tabs)');
                    }}
                  />
                ) : mine.has(order.id) ? (
                  <Button
                    label="Open"
                    variant="gold"
                    size="compact"
                    onPress={() => {
                      // Put the sheet on *this* job before leaving, or the home
                      // screen would open on whichever one it was already
                      // showing — the whole point of tapping this card.
                      focusOrder(order.id);
                      router.push('/(tabs)');
                    }}
                  />
                ) : order.status !== 'delivered' ? null : (
                  <View style={styles.completeRow}>
                    <CheckCircle2 size={18} color={ink.success} />
                    <Text style={styles.completeLabel}>Delivered</Text>
                  </View>
                )}
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  header: { paddingHorizontal: 18, paddingTop: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subtitle: { ...text.caption, marginTop: 4 },

  controls: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },
  filterRow: { gap: 8, paddingBottom: 2 },

  list: { padding: 18, gap: 14, paddingBottom: 40 },
  card: { gap: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customer: { ...text.strong, flexShrink: 1 },
  orderNumber: { ...text.caption, fontWeight: '700', color: ink.gold, marginTop: 3 },

  detailBlock: { gap: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { ...text.body, flex: 1 },
  pinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: touch.min,
    backgroundColor: tints.sage15,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
  },
  pinChipLabel: { ...text.caption, fontWeight: '800', color: ink.sage },
  coords: { ...text.mono, paddingLeft: 26 },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: 12,
  },
  payoutLabel: text.overline,
  payout: { ...text.title, color: ink.gold, marginTop: 2 },
  completeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  completeLabel: { ...text.bodyStrong, color: ink.success },
});

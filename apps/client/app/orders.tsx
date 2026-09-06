/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { ArrowLeft, PackageSearch } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OrderCard from '../src/components/OrderCard';
import { EmptyState, Segmented } from '../src/components/ui';
import { useClient } from '../src/store/ClientStore';
import { colors, formatCedis } from '../src/theme';

type Filter = 'all' | 'active' | 'completed';

/**
 * Order history — the client portal's orders tab.
 *
 * The same three filters the website offers, because customers arrive here
 * asking one of exactly three questions: where is my stuff, what did I spend,
 * and what did I order last time so I can order it again.
 */
export default function OrdersScreen() {
  const router = useRouter();
  const { bookings, activeBookings, pastBookings, refresh } = useClient();

  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => {
    if (filter === 'active') return activeBookings;
    if (filter === 'completed') return pastBookings;
    return [...bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [filter, bookings, activeBookings, pastBookings]);

  const lifetimeSpend = useMemo(
    () =>
      bookings
        .filter((booking) => booking.paymentStatus === 'Paid')
        .reduce((total, booking) => total + (booking.amount ?? 0), 0),
    [bookings]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ArrowLeft size={17} color={colors.textCharcoal} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Your orders</Text>
          <Text style={styles.headerSub}>
            {bookings.length} total · {formatCedis(lifetimeSpend)} spent
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
        <Segmented<Filter>
          options={[
            { id: 'all', label: `All (${bookings.length})` },
            { id: 'active', label: `Active (${activeBookings.length})` },
            { id: 'completed', label: `Past (${pastBookings.length})` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandSage} />
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            icon={<PackageSearch size={26} color={colors.brandStone} />}
            title={filter === 'completed' ? 'No completed orders yet' : 'No orders here'}
            body={
              filter === 'active'
                ? 'Nothing is in flight right now.'
                : 'Bookings you make — on the app or the website — show up here against the same account.'
            }
            action="Schedule a pickup"
            onAction={() => router.push('/(tabs)/book')}
          />
        ) : (
          visible.map((booking) => (
            <OrderCard
              key={booking.id}
              booking={booking}
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: booking.id } })}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 19, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.4 },
  headerSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },

  scroll: { padding: 20, paddingTop: 4, paddingBottom: 40, gap: 11 },
});

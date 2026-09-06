/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  Camera,
  ChevronRight,
  MessageSquare,
  PackageSearch,
  Phone,
  QrCode,
  Radar,
  Star,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type JobStatus } from '@freshfold/core';
import HandoffCard from '../../src/components/HandoffCard';
import { StageTimeline } from '../../src/components/StageTimeline';
import TrackingMap from '../../src/components/TrackingMap';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConnectionPill,
  EmptyState,
  SectionLabel,
} from '../../src/components/ui';
import {
  describeOrder,
  jobStatusLabel,
  paymentStatusLabel,
  stageLabel,
  useT,
} from '../../src/i18n';
import { useClient } from '../../src/store/ClientStore';
import {
  colors,
  courierName,
  courierVehicle,
  formatCedis,
  radius,
  shadow,
  tints,
} from '../../src/theme';

/**
 * Dispatch states in which the bags are still with the customer, and the
 * collection code is therefore worth showing.
 */
const COLLECTION_PENDING = new Set<JobStatus>([
  'unassigned',
  'assigned',
  'navigating_to_pickup',
  'arrived_at_pickup',
]);

/**
 * Track.
 *
 * The website's client portal shows a progress bar and a dispatch map; this is
 * that, with the phone's advantages: the map is the whole card, the courier's
 * contact is a tap, and the actions that used to be the rider's alone — scan
 * the bags, photograph a problem, sign at the door — are reachable from here.
 *
 * Multiple orders in flight get a selector strip; one order skips it.
 */
export default function TrackScreen() {
  const router = useRouter();
  const { activeBookings, primaryBooking, online, probed, refresh, messagesFor } = useClient();
  const { t, locale } = useT();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Follow the store's choice until the customer picks a different order.
  useEffect(() => {
    if (!selectedId && primaryBooking) setSelectedId(primaryBooking.id);
    if (selectedId && !activeBookings.some((booking) => booking.id === selectedId)) {
      setSelectedId(primaryBooking?.id ?? null);
    }
  }, [selectedId, primaryBooking, activeBookings]);

  const booking = useMemo(
    () => activeBookings.find((candidate) => candidate.id === selectedId) ?? primaryBooking,
    [activeBookings, selectedId, primaryBooking]
  );

  const unreadThread = useMemo(
    () => (booking ? messagesFor(booking.id).length : 0),
    [booking, messagesFor]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (!booking) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('track.title')}</Text>
          <ConnectionPill online={online} pending={!probed} />
        </View>
        <View style={{ padding: 20 }}>
          <EmptyState
            icon={<PackageSearch size={28} color={colors.brandStone} />}
            title={t('track.empty.title')}
            body={t('track.empty.body')}
            action={t('common.schedulePickup')}
            onAction={() => router.push('/(tabs)/book')}
          />
        </View>
      </SafeAreaView>
    );
  }

  const rider = booking.rider;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('track.title')}</Text>
          <Text style={styles.headerSub}>{booking.id}</Text>
        </View>
        <ConnectionPill online={online} pending={!probed} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandSage} />
        }
      >
        {activeBookings.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectorRow}
          >
            {activeBookings.map((candidate) => {
              const active = candidate.id === booking.id;
              return (
                <Pressable
                  key={candidate.id}
                  onPress={() => setSelectedId(candidate.id)}
                  style={[styles.selectorChip, active && styles.selectorChipActive]}
                >
                  <Text style={[styles.selectorRef, active && { color: '#FFFFFF' }]}>
                    {candidate.id}
                  </Text>
                  <Text
                    style={[styles.selectorStage, active && { color: 'rgba(255,255,255,0.75)' }]}
                    numberOfLines={1}
                  >
                    {/* The coarse stage, not the dispatch status — this chip is
                        the customer's own vocabulary for one of their orders. */}
                    {stageLabel(t, candidate.status)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <TrackingMap booking={booking} />

        {/* The screen someone stares at while waiting for the doorbell, so the
            collection code belongs here rather than one tap deeper. */}
        {COLLECTION_PENDING.has(booking.rider?.jobStatus ?? 'unassigned') && (
          <HandoffCard booking={booking} />
        )}

        {/* ---------------------------------------------------- the courier */}
        {rider ? (
          <Card style={styles.riderCard}>
            <Avatar size={46} />
            <View style={{ flex: 1 }}>
              <Text style={styles.riderName}>{courierName(rider, locale)}</Text>
              <Text style={styles.riderVehicle} numberOfLines={1}>
                {courierVehicle(rider, locale)}
              </Text>
              <View style={styles.riderMeta}>
                <Star size={11} color={colors.brandGold} fill={colors.brandGold} />
                <Text style={styles.riderRating}>{rider.rating.toFixed(1)}</Text>
                <Badge label={jobStatusLabel(t, rider.jobStatus)} tone="sage" />
              </View>
            </View>

            <View style={{ gap: 7 }}>
              <Pressable
                onPress={() => Linking.openURL(`tel:${booking.phone.replace(/\s/g, '')}`)}
                style={styles.roundAction}
                accessibilityLabel={t('track.call')}
              >
                <Phone size={15} color={colors.brandSage} />
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: '/chat', params: { id: booking.id } })}
                style={styles.roundAction}
                accessibilityLabel={t('track.message')}
              >
                <MessageSquare size={15} color={colors.brandSage} />
              </Pressable>
            </View>
          </Card>
        ) : (
          <Card tone="sunken" style={{ gap: 4 }}>
            <Text style={styles.pendingTitle}>{t('track.pending.title')}</Text>
            <Text style={styles.pendingBody}>{t('track.pending.body')}</Text>
          </Card>
        )}

        {/* ------------------------------------------------------- progress */}
        <Card style={{ gap: 4 }}>
          <StageTimeline stage={booking.status} dispatchStatus={rider?.jobStatus} />
        </Card>

        {/* -------------------------------------------------------- actions */}
        <View>
          <SectionLabel>{t('track.section.door')}</SectionLabel>
          <View style={styles.actionGrid}>
            <ActionTile
              icon={<QrCode size={17} color={colors.brandSage} />}
              label={t('track.action.scan')}
              caption={t('track.action.scanCaption')}
              onPress={() =>
                router.push({ pathname: '/order/[id]', params: { id: booking.id, action: 'scan' } })
              }
            />
            <ActionTile
              icon={<Camera size={17} color={colors.brandSage} />}
              label={t('track.action.issue')}
              caption={t('track.action.issueCaption')}
              onPress={() =>
                router.push({ pathname: '/order/[id]', params: { id: booking.id, action: 'issue' } })
              }
            />
            <ActionTile
              icon={<MessageSquare size={17} color={colors.brandSage} />}
              label={t('track.action.chat')}
              caption={
                // Two keys and a branch rather than a plural rule: the singular
                // is its own string, so a language that says it differently can.
                unreadThread === 1
                  ? t('track.action.chatOne')
                  : unreadThread > 1
                    ? t('track.action.chatMany', { count: unreadThread })
                    : t('track.action.chatCaption')
              }
              onPress={() => router.push({ pathname: '/chat', params: { id: booking.id } })}
            />
            <ActionTile
              icon={<Radar size={17} color={colors.brandSage} />}
              label={t('track.action.full')}
              caption={t('track.action.fullCaption')}
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: booking.id } })}
            />
          </View>
        </View>

        {/* -------------------------------------------------------- summary */}
        <Card style={{ gap: 9 }}>
          <SectionLabel>{t('track.section.order')}</SectionLabel>
          {/* Five of these six labels are the booking flow's own — the same
              field labelled the same way, so the same key. Only "Payment" is
              new, because the booking summary never puts a label on that row. */}
          <Row label={t('book.summary.service')} value={describeOrder(t, booking)} />
          <Row
            label={t('book.done.collection')}
            value={t('track.row.collectionValue', {
              date: booking.pickupDate,
              time: booking.pickupTime,
            })}
          />
          <Row label={t('book.done.return')} value={booking.deliveryDate} />
          <Row
            label={t('book.summary.address')}
            value={[booking.address, booking.suburb].filter(Boolean).join(', ')}
          />
          <Row
            label={t('track.row.payment')}
            // `paymentStatus` is optional on `Booking`, and the template that
            // stood here interpolated it unguarded — a booking without one
            // rendered the word "undefined" to the customer. An order with no
            // payment state recorded has nothing to say about it, so it falls to
            // the same blank every other empty row uses.
            //
            // The status is a closed union and is translated; the method beside
            // it is a free-form string the server writes, and is not.
            value={
              booking.paymentStatus
                ? t('track.row.paymentValue', {
                    status: paymentStatusLabel(t, booking.paymentStatus),
                    method: booking.paymentMethod ?? t('common.blank'),
                  })
                : ''
            }
          />
          <Row
            label={t('book.summary.total')}
            value={formatCedis(booking.amount ?? 0, locale)}
            emphasis
          />

          <Button
            label={t('track.open')}
            variant="ghost"
            onPress={() => router.push({ pathname: '/order/[id]', params: { id: booking.id } })}
            iconRight={<ChevronRight size={14} color={colors.textCharcoal} />}
            style={{ marginTop: 4 }}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionTile({
  icon,
  label,
  caption,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  caption: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.88 }]}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.actionCaption} numberOfLines={1}>
        {caption}
      </Text>
    </Pressable>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  const { t } = useT();

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueStrong]} numberOfLines={2}>
        {value || t('common.blank')}
      </Text>
    </View>
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
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.5 },
  headerSub: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, color: colors.textMuted },

  scroll: { padding: 20, paddingTop: 4, paddingBottom: 36, gap: 14 },

  selectorRow: { gap: 8, paddingRight: 20, paddingBottom: 2 },
  selectorChip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: radius.lg,
    backgroundColor: colors.cardPure,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    gap: 2,
    minWidth: 116,
  },
  selectorChipActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  selectorRef: { fontSize: 10.5, fontWeight: '800', color: colors.textCharcoal },
  selectorStage: { fontSize: 9.5, color: colors.textMuted },

  riderCard: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  riderName: { fontSize: 14, fontWeight: '800', color: colors.textCharcoal },
  riderVehicle: { fontSize: 10.5, color: colors.textSlate, marginTop: 2 },
  riderMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  riderRating: { fontSize: 10.5, fontWeight: '800', color: colors.textCharcoal, marginRight: 2 },
  roundAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tints.sage08,
    borderWidth: 1,
    borderColor: tints.sage18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pendingTitle: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  pendingBody: { fontSize: 11, color: colors.textSlate, lineHeight: 15.5 },

  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  actionTile: {
    width: '48%',
    gap: 5,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.cardPure,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    ...shadow.xs,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  actionLabel: { fontSize: 12, fontWeight: '800', color: colors.textCharcoal },
  actionCaption: { fontSize: 10, color: colors.textMuted },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { width: 82, fontSize: 10.5, color: colors.textMuted },
  rowValue: { flex: 1, fontSize: 11.5, color: colors.textCharcoal, textAlign: 'right' },
  rowValueStrong: { fontSize: 14, fontWeight: '800' },
});

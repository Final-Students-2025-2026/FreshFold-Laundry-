/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChevronRight, Clock, MapPin } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Booking } from '@freshfold/core';
import { colors, courierName, formatCedis, formatDate, radius, shadow, tints } from '../theme';
import { describeOrder, useT } from '../i18n';
import { StageTimeline } from './StageTimeline';
import { Badge, type BadgeTone } from './ui';

/** Payment state maps onto the badge palette the same way on every screen. */
export function paymentTone(booking: Booking): BadgeTone {
  switch (booking.paymentStatus) {
    case 'Paid':
      return 'success';
    case 'Refunded':
      return 'info';
    case 'Pay on Pickup':
      return 'warning';
    default:
      return 'muted';
  }
}

export default function OrderCard({
  booking,
  onPress,
}: {
  booking: Booking;
  onPress?: () => void;
}) {
  const { t } = useT();
  const cancelled = booking.status === 'Cancelled';
  const delivered = booking.status === 'Delivered';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.reference}>{booking.id}</Text>
          <Text style={styles.service} numberOfLines={1}>
            {describeOrder(t, booking)}
          </Text>
        </View>
        <Badge
          label={booking.paymentStatus ?? 'Pending'}
          tone={paymentTone(booking)}
        />
        <ChevronRight size={16} color={colors.textMuted} />
      </View>

      <View style={styles.metaRow}>
        <View style={styles.meta}>
          <MapPin size={11} color={colors.textMuted} />
          <Text style={styles.metaText} numberOfLines={1}>
            {[booking.address, booking.suburb].filter(Boolean).join(', ') || 'No address'}
          </Text>
        </View>
        <View style={styles.meta}>
          <Clock size={11} color={colors.textMuted} />
          <Text style={styles.metaText}>{formatDate(booking.pickupDate)}</Text>
        </View>
      </View>

      {!delivered && !cancelled ? (
        <View style={{ marginTop: 12 }}>
          <StageTimeline
            stage={booking.status}
            dispatchStatus={booking.rider?.jobStatus}
            compact
          />
        </View>
      ) : (
        <View style={styles.closedRow}>
          <Badge
            label={cancelled ? 'Cancelled' : 'Delivered'}
            tone={cancelled ? 'error' : 'success'}
          />
          <Text style={styles.amount}>{formatCedis(booking.amount ?? 0)}</Text>
        </View>
      )}

      {!delivered && !cancelled && (
        <View style={styles.footRow}>
          <Text style={styles.amount}>{formatCedis(booking.amount ?? 0)}</Text>
          {booking.rider ? (
            /*
              Just the name. What followed it was "· 8 min away", computed from
              the courier's coordinates in a straight line to the door at an
              assumed 18 km/h. The timeline above this row carries the stage, and
              the tracking screen carries the routed arrival time.
            */
            <Text style={styles.riderLine} numberOfLines={1}>
              {courierName(booking.rider)}
            </Text>
          ) : (
            <Text style={styles.riderLinePending}>Awaiting courier</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 15,
    ...shadow.xs,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reference: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.textMuted,
  },
  service: { fontSize: 13.5, fontWeight: '800', color: colors.textCharcoal, marginTop: 2 },

  metaRow: { flexDirection: 'row', gap: 14, marginTop: 8, alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { fontSize: 10.5, color: colors.textSlate, flexShrink: 1 },

  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    gap: 10,
  },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  amount: { fontSize: 13, fontWeight: '800', color: colors.textCharcoal },
  riderLine: { fontSize: 10.5, fontWeight: '700', color: colors.brandSage, flexShrink: 1 },
  riderLinePending: {
    fontSize: 10.5,
    color: colors.textMuted,
    backgroundColor: tints.stone35,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
});

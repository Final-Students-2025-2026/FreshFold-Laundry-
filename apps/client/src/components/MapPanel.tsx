/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bike, Home, Warehouse } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LAUNDRY_HUB, distanceKm, type Booking, type Coords } from '@freshfold/core';
import { jobStatusLabel, useT } from '../i18n';
import { colors, courierName, courierVehicle, radius, shadow, tints } from '../theme';

/**
 * Stand-in for the native map: the same three positions as a coordinate
 * readout, with the distances between them.
 *
 * Used on web (`react-native-maps` is iOS/Android only) and as the safety net
 * when the native map fails to mount. Everything the map communicates — where
 * the courier is, which way they are heading, how far there is to go — is
 * still here; only the tiles are missing.
 *
 * `notice` arrives already translated: the three callers each have a different
 * reason for showing this panel, and each knows its own sentence.
 */
export default function MapPanel({
  booking,
  notice,
}: {
  booking: Booking;
  notice?: string;
}) {
  const { t, locale } = useT();

  const pickup = booking.pickupCoords;
  const hub: Coords = { lat: LAUNDRY_HUB.lat, lng: LAUNDRY_HUB.lng };
  const courier = booking.rider?.coords;

  return (
    <View style={styles.container}>
      <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>{t('map.readout')}</Text>
        <Text style={styles.noticeBody}>{notice ?? t('map.webNotice')}</Text>
      </View>

      {!!courier && (
        <View style={styles.courierRow}>
          <View style={styles.courierIcon}>
            <Bike size={14} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>
              {/* The same name-and-vehicle pair the home screen's live card
                  shows, formatted the same way, so it is the same key. */}
              {t('home.live.courier', {
                name: courierName(booking.rider, locale),
                vehicle: courierVehicle(booking.rider, locale),
              })}
            </Text>
            <Text style={styles.rowCoords}>{formatCoords(courier)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {/*
              The stage, not a minute count. What stood here was
              `rider.etaMinutes` — the straight-line distance to the destination
              divided by an assumed 18 km/h. This panel holds no route (it is the
              fallback for when the map cannot draw one), so it has nothing to
              derive an arrival time from and says where the job is instead. The
              address row below carries the live distance.
            */}
            <Text style={styles.rowEta}>
              {booking.rider
                ? jobStatusLabel(t, booking.rider.jobStatus)
                : t('common.blank')}
            </Text>
          </View>
        </View>
      )}

      <PinRow
        icon={<Home size={13} color="#FFFFFF" />}
        tone={colors.brandGold}
        label={t('map.home')}
        detail={[booking.address, booking.suburb].filter(Boolean).join(', ')}
        coords={pickup}
        distanceFrom={courier}
      />

      <PinRow
        icon={<Warehouse size={12} color="#FFFFFF" />}
        tone={colors.textCharcoal}
        label={LAUNDRY_HUB.name}
        detail={t('map.hubDetail')}
        coords={hub}
        distanceFrom={courier}
      />
    </View>
  );
}

function PinRow({
  icon,
  tone,
  label,
  detail,
  coords,
  distanceFrom,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  detail: string;
  coords?: Coords;
  distanceFrom?: Coords;
}) {
  const { t } = useT();

  const away =
    coords && distanceFrom ? `${distanceKm(distanceFrom, coords).toFixed(1)} km` : undefined;

  return (
    <View style={styles.pinRow}>
      <View style={[styles.pinIcon, { backgroundColor: tone }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {detail || t('common.blank')}
        </Text>
        <Text style={styles.rowCoords}>
          {coords ? formatCoords(coords) : t('map.noPinYet')}
        </Text>
      </View>
      {!!away && <Text style={styles.rowAway}>{away}</Text>}
    </View>
  );
}

function formatCoords(coords: Coords): string {
  return `${coords.lat.toFixed(5)}° N, ${Math.abs(coords.lng).toFixed(5)}° W`;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgLinen,
    padding: 13,
    gap: 9,
    ...shadow.xs,
  },
  noticeBox: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 11,
    gap: 3,
  },
  noticeTitle: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  noticeBody: { fontSize: 10.5, color: colors.textCharcoal, lineHeight: 14.5 },

  courierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tints.sage25,
    padding: 11,
  },
  courierIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 11,
  },
  pinIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowLabel: { fontSize: 11.5, fontWeight: '800', color: colors.textCharcoal },
  rowDetail: { fontSize: 10, color: colors.textSlate, marginTop: 1 },
  rowCoords: { fontSize: 9, color: colors.textMuted, marginTop: 2 },
  rowEta: { fontSize: 12, fontWeight: '800', color: colors.brandSage },
  rowStage: { fontSize: 8.5, color: colors.textMuted, marginTop: 1 },
  rowAway: { fontSize: 10.5, fontWeight: '700', color: colors.textSlate },
});

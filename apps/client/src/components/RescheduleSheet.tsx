/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Calendar, Check } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  DELIVERY_TIME_SLOTS,
  MAX_RESCHEDULES,
  PICKUP_TIME_SLOTS,
  deliverySlotsFor,
  isoDaysFromNow,
  isoPlusDays,
  todayIso,
  type Booking,
} from '@freshfold/core';
import { intlTag, useT } from '../i18n';
import { api } from '../services/api';
import { colors, formatDate, radius } from '../theme';
import { Button, OptionRow, SectionLabel } from './ui';

/**
 * Moving a booking that has already been placed.
 *
 * The alternative, until this existed, was cancel and rebook — which lost the
 * customer their reference, their three hand-off codes and, if they had paid,
 * put their money through a refund to come back as a new order. Nothing here
 * reprices: the same order moves, and the total on the receipt does not change.
 *
 * The rules are `@freshfold/core`'s `checkReschedule`, not this sheet's. The
 * server enforces them on a locked row and is the only thing that can — a
 * window can fill while somebody is choosing, and a courier can accept the job
 * — so this screen shows the same rules early rather than deciding anything.
 * When the two disagree the server wins, and its sentence is what appears in the
 * error line.
 */

interface RescheduleSheetProps {
  booking: Booking;
  onCancel: () => void;
  /** Rejects with the server's `ApiError`; the message on it is shown as-is. */
  onConfirm: (change: {
    pickupDate: string;
    pickupTime: string;
    deliveryTime?: string;
  }) => Promise<void>;
}

/** How many days forward the strip offers. The horizon is the server's, at 30. */
const DAYS = 14;

export default function RescheduleSheet({ booking, onCancel, onConfirm }: RescheduleSheetProps) {
  const { t, locale } = useT();

  const [pickupDate, setPickupDate] = useState(booking.pickupDate || isoDaysFromNow(1));
  const [pickupTime, setPickupTime] = useState(booking.pickupTime || PICKUP_TIME_SLOTS[0]);
  const [deliveryTime, setDeliveryTime] = useState(
    booking.deliveryTime || DELIVERY_TIME_SLOTS[0]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const deliveryDate = useMemo(
    () => isoPlusDays(pickupDate, 1) ?? pickupDate,
    [pickupDate]
  );

  const returnOptions = useMemo(
    () => deliverySlotsFor(pickupDate, pickupTime, deliveryDate),
    [pickupDate, pickupTime, deliveryDate]
  );

  /**
   * The next fortnight, starting today.
   *
   * Today is included because the cut-off, not the calendar, is what rules out a
   * same-day move: a customer at 9am can still take this evening's window, and
   * a strip that started tomorrow would hide a slot the server would accept.
   */
  const days = useMemo(() => {
    const first = todayIso();
    return Array.from({ length: DAYS }, (_, index) => isoPlusDays(first, index) ?? first);
  }, []);

  /**
   * How full the windows are on the chosen day, on both legs.
   *
   * `exclude` is this booking, so the window it currently holds is not counted
   * against itself — without it a customer looking at their own nearly-full
   * morning would see their own collection listed as unavailable.
   */
  const [slots, setSlots] = useState<Record<string, { remaining: number; full: boolean }>>({});
  const [returns, setReturns] = useState<Record<string, { remaining: number; full: boolean }>>({});

  useEffect(() => {
    let cancelled = false;

    api
      .slotAvailability(pickupDate, { deliveryDate, exclude: booking.id })
      .then((answer) => {
        if (cancelled) return;

        const next: Record<string, { remaining: number; full: boolean }> = {};
        for (const row of answer.slots) next[row.slot] = { remaining: row.remaining, full: row.full };
        setSlots(next);

        const back: Record<string, { remaining: number; full: boolean }> = {};
        for (const row of answer.deliverySlots ?? []) {
          back[row.slot] = { remaining: row.remaining, full: row.full };
        }
        setReturns(back);
      })
      .catch(() => {
        // Optimistic on failure, like the booking form: greying out every
        // window because the network is down would make the sheet look broken
        // rather than let the customer try. The server refuses if they are wrong.
        if (cancelled) return;
        setSlots({});
        setReturns({});
      });

    return () => {
      cancelled = true;
    };
  }, [pickupDate, deliveryDate, booking.id]);

  // Follow the collection when the return it had stops being reachable.
  useEffect(() => {
    const reachable = returnOptions.some((slot) => slot.label === deliveryTime);
    if (reachable && !returns[deliveryTime]?.full) return;

    const open = returnOptions.find((slot) => !returns[slot.label]?.full);
    if (open) setDeliveryTime(open.label);
  }, [returnOptions, returns, deliveryTime]);

  const unchanged =
    pickupDate === booking.pickupDate &&
    pickupTime === booking.pickupTime &&
    deliveryTime === (booking.deliveryTime ?? deliveryTime);

  const movesLeft = Math.max(0, MAX_RESCHEDULES - (booking.rescheduleCount ?? 0));

  const submit = async () => {
    setBusy(true);
    setError('');

    try {
      await onConfirm({
        pickupDate,
        pickupTime,
        // Omitted when the collection leaves no room for one, rather than sent
        // and refused — a same-day return after the evening window has nowhere
        // to go, and losing the whole move over it would be the wrong trade.
        deliveryTime: returnOptions.some((slot) => slot.label === deliveryTime)
          ? deliveryTime
          : undefined,
      });
    } catch (failure) {
      // The server writes these sentences for the customer — "that window
      // filled up", "your courier is already on the way" — so they are shown
      // rather than replaced with a generic one.
      const message = failure instanceof Error ? failure.message : '';
      setError(message || t('order.reschedule.failed'));
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <Calendar size={17} color={colors.brandSage} />
        <Text style={styles.title}>{t('order.reschedule.title')}</Text>
      </View>

      <Text style={styles.blurb}>
        {movesLeft <= 1
          ? t('order.reschedule.lastMove')
          : t('order.reschedule.movesLeft', { count: movesLeft })}
      </Text>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 9 }}>
          <SectionLabel>{t('order.reschedule.date')}</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {days.map((day) => {
              const active = day === pickupDate;
              const date = new Date(`${day}T00:00:00Z`);

              return (
                <Pressable
                  key={day}
                  onPress={() => setPickupDate(day)}
                  style={[styles.day, active && styles.dayActive]}
                >
                  <Text style={[styles.dayName, active && styles.dayTextActive]}>
                    {date.toLocaleDateString(intlTag(locale), { weekday: 'short', timeZone: 'UTC' })}
                  </Text>
                  <Text style={[styles.dayNum, active && styles.dayTextActive]}>
                    {date.getUTCDate()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={{ gap: 9, marginTop: 16 }}>
          <SectionLabel>{t('book.window.title')}</SectionLabel>
          {PICKUP_TIME_SLOTS.map((slot) => {
            const state = slots[slot];
            return (
              <OptionRow
                key={slot}
                title={slot.split(' (')[0]}
                subtitle={
                  state?.full
                    ? t('book.window.full')
                    : state && state.remaining <= 3
                      ? t('book.window.remaining', { count: state.remaining })
                      : slot.match(/\((.*)\)/)?.[1]
                }
                disabled={state?.full}
                selected={pickupTime === slot}
                onPress={() => {
                  if (!state?.full) setPickupTime(slot);
                }}
                trailing={
                  pickupTime === slot ? <Check size={16} color={colors.brandSage} /> : undefined
                }
              />
            );
          })}
        </View>

        <View style={{ gap: 9, marginTop: 16 }}>
          <SectionLabel>{t('book.return.title')}</SectionLabel>
          <Text style={styles.returnDay}>
            {t('book.return.day', { date: formatDate(deliveryDate, locale) })}
          </Text>
          {DELIVERY_TIME_SLOTS.map((slot) => {
            const state = returns[slot];
            const reachable = returnOptions.some((option) => option.label === slot);
            const blocked = !reachable || !!state?.full;

            return (
              <OptionRow
                key={slot}
                title={slot.split(' (')[0]}
                subtitle={
                  !reachable
                    ? t('book.return.tooEarly')
                    : state?.full
                      ? t('book.window.full')
                      : state && state.remaining <= 3
                        ? t('book.window.remaining', { count: state.remaining })
                        : slot.match(/\((.*)\)/)?.[1]
                }
                disabled={blocked}
                selected={deliveryTime === slot}
                onPress={() => {
                  if (!blocked) setDeliveryTime(slot);
                }}
                trailing={
                  deliveryTime === slot ? <Check size={16} color={colors.brandSage} /> : undefined
                }
              />
            );
          })}
        </View>
      </ScrollView>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} disabled={busy} />
        <Button
          label={busy ? t('common.saving') : t('order.reschedule.confirm')}
          onPress={submit}
          disabled={busy || unchanged}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '800', color: colors.textCharcoal },
  blurb: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  body: { maxHeight: 420 },

  strip: { gap: 8, paddingVertical: 2 },
  day: {
    minWidth: 52,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  dayActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  dayName: { fontSize: 10, textTransform: 'uppercase', color: colors.textMuted },
  dayNum: { fontSize: 16, fontWeight: '800', color: colors.textCharcoal },
  dayTextActive: { color: '#FFFFFF' },

  returnDay: { fontSize: 12, color: colors.textMuted, marginTop: -3 },
  error: { fontSize: 12, lineHeight: 18, color: colors.statusError },
  actions: { flexDirection: 'row', gap: 9 },
});

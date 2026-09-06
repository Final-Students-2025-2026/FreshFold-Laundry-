/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BOOKING_STAGE_SEQUENCE, toBookingStatus, type OrderStatus } from '@freshfold/core';
import { colors, ink, radius, text, tints } from '../theme';

/**
 * What the customer is being told, right now.
 *
 * The console works in dispatch statuses — `navigating_to_pickup`,
 * `pickup_scanned` — and the customer's app and the supervisor's dashboard
 * both work in the six stages of the pipeline. Same job, two vocabularies, and
 * the courier could see only one of them: a supervisor moving an order to
 * *In Care* from the desk changed what the customer read and left no trace on
 * the phone carrying the bags.
 *
 * `toBookingStatus` is the same mapping the server and both other apps use, so
 * this cannot drift from what the customer sees.
 */
export default function CustomerStage({
  status,
  compact,
}: {
  status: OrderStatus;
  /** Drops the step counter, for rows that are already busy. */
  compact?: boolean;
}) {
  const stage = toBookingStatus(status);
  const index = BOOKING_STAGE_SEQUENCE.indexOf(stage);
  const cancelled = index < 0;

  return (
    <View style={[styles.pill, cancelled && styles.pillCancelled]}>
      <View style={[styles.dot, cancelled && styles.dotCancelled]} />
      <Text style={[styles.label, cancelled && styles.labelCancelled]} numberOfLines={1}>
        {compact ? stage : `Customer sees: ${stage}`}
      </Text>
      {!compact && !cancelled && (
        <Text style={styles.counter}>
          {index + 1}/{BOOKING_STAGE_SEQUENCE.length}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: tints.sage05,
    borderWidth: 1,
    borderColor: tints.sage20,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pillCancelled: { backgroundColor: tints.error05, borderColor: tints.error20 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.brandSage },
  dotCancelled: { backgroundColor: colors.statusError },
  label: { ...text.caption, fontWeight: '700', color: colors.textCharcoal },
  labelCancelled: { color: ink.error },
  counter: { ...text.micro, fontWeight: '800' },
});

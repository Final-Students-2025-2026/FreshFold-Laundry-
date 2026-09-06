/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { CalendarClock, Repeat, Share2, Trash2, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PICKUP_TIME_SLOTS, WEEKDAYS, describeSchedule } from '@freshfold/core';
import { Badge, Button, Card, EmptyState, Field, OptionRow, SectionLabel } from '../src/components/ui';
import { useT } from '../src/i18n';
import { useClient } from '../src/store/ClientStore';
import { useSession } from '../src/store/SessionStore';
import { colors, formatCedis } from '../src/theme';

/**
 * Standing orders and the referral code — the two things a membership plan
 * promised and the product never delivered.
 *
 * The plans screen has always advertised "Weekly door-side pickups — 4 a month"
 * and charged ₵149 a month for it. `includedPickups` appeared in a dozen places
 * and every one of them subtracted from it: nothing had ever scheduled a pickup.
 * So the customer who bought weekly collections opened the app every Sunday and
 * rebooked by hand, and the allowance they forgot expired at renewal — a
 * subscription whose unused half was revenue for work never done.
 *
 * The referral half is the other side of the same gap: loyalty tiers and
 * membership plans both reward somebody for already being a customer, and there
 * was nothing at all for bringing one in.
 */
export default function StandingScreen() {
  const router = useRouter();
  const { t, locale } = useT();
  const { isAuthenticated } = useSession();
  const {
    recurring,
    loadRecurring,
    saveRecurring,
    deleteRecurring,
    referral,
    loadReferral,
    claimReferral,
    addresses,
  } = useClient();

  const [weekday, setWeekday] = useState(2);
  const [slot, setSlot] = useState<string>(PICKUP_TIME_SLOTS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');

  useEffect(() => {
    void loadRecurring();
    void loadReferral();
  }, [loadRecurring, loadReferral]);

  const home = addresses.find((address) => address.isDefault) ?? addresses[0];

  const create = useCallback(async () => {
    if (!home) {
      setError(t('standing.needAddress'));
      return;
    }

    setBusy(true);
    setError('');

    try {
      await saveRecurring(`rec-${Date.now()}`, {
        weekday,
        pickupTime: slot,
        // The last order's services would be a better default; this screen keeps
        // it to one wash, which is what "weekly pickups" means on the plans page
        // and what the customer can then edit from the booking form.
        items: [{ serviceType: 'Washing (Machine & Hand Wash)', quantity: 1 }],
        address: home.address,
        suburb: home.suburb,
        active: true,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('standing.failed'));
    } finally {
      setBusy(false);
    }
  }, [home, weekday, slot, saveRecurring, t]);

  const remove = useCallback(
    (id: string) => {
      Alert.alert(t('standing.remove.title'), t('standing.remove.body'), [
        { text: t('common.keep'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => void deleteRecurring(id),
        },
      ]);
    },
    [deleteRecurring, t]
  );

  const claim = useCallback(async () => {
    setCodeError('');
    try {
      await claimReferral(codeInput.trim());
      setCodeInput('');
    } catch (failure) {
      setCodeError(failure instanceof Error ? failure.message : t('standing.referral.failed'));
    }
  }, [codeInput, claimReferral, t]);

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{t('standing.title')}</Text>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
            <X size={17} color={colors.textCharcoal} />
          </Pressable>
        </View>
        <View style={{ padding: 20 }}>
          <EmptyState
            title={t('standing.signedOut.title')}
            body={t('standing.signedOut.body')}
            action={t('common.signInCta')}
            onAction={() => router.push('/auth')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('standing.title')}</Text>
          <Text style={styles.headerSub}>{t('standing.subtitle')}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <X size={17} color={colors.textCharcoal} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ------------------------------------------------- standing orders */}
        <Card style={{ gap: 12 }}>
          <SectionLabel>{t('standing.yours')}</SectionLabel>

          {recurring.length === 0 ? (
            <Text style={styles.blurb}>{t('standing.none')}</Text>
          ) : (
            recurring.map((pickup) => (
              <View key={pickup.id} style={styles.row}>
                <Repeat size={15} color={colors.brandSage} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{describeSchedule(pickup)}</Text>
                  <Text style={styles.rowMeta}>
                    {pickup.address}
                    {pickup.lastBookedFor
                      ? ` · ${t('standing.lastBooked', { date: pickup.lastBookedFor })}`
                      : ` · ${t('standing.notYetBooked')}`}
                  </Text>
                </View>
                {!pickup.active && <Badge label={t('standing.paused')} tone="warning" />}
                <Pressable onPress={() => remove(pickup.id)} hitSlop={8}>
                  <Trash2 size={15} color={colors.statusError} />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        {/* ---------------------------------------------------------- add one */}
        <Card style={{ gap: 10 }}>
          <SectionLabel>{t('standing.add')}</SectionLabel>

          <View style={styles.dayStrip}>
            {WEEKDAYS.map((day, index) => {
              const active = index === weekday;
              return (
                <Pressable
                  key={day}
                  onPress={() => setWeekday(index)}
                  style={[styles.day, active && styles.dayActive]}
                >
                  <Text style={[styles.dayLabel, active && styles.dayLabelActive]}>
                    {day.slice(0, 3)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {PICKUP_TIME_SLOTS.map((option) => (
            <OptionRow
              key={option}
              title={option.split(' (')[0]}
              subtitle={option.match(/\((.*)\)/)?.[1]}
              selected={slot === option}
              onPress={() => setSlot(option)}
            />
          ))}

          {!!home && <Text style={styles.blurb}>{t('standing.collectFrom', { address: home.address })}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}

          <Button
            label={busy ? t('common.saving') : t('standing.create')}
            onPress={() => void create()}
            disabled={busy || !home}
            icon={<CalendarClock size={15} color="#FFFFFF" />}
          />
        </Card>

        {/* -------------------------------------------------------- referrals */}
        <Card style={{ gap: 10 }}>
          <SectionLabel>{t('standing.referral.title')}</SectionLabel>

          {referral ? (
            <>
              <Text style={styles.code}>{referral.code}</Text>
              <Text style={styles.blurb}>
                {t('standing.referral.blurb', {
                  reward: formatCedis(referral.reward, locale),
                  welcome: formatCedis(referral.welcome, locale),
                })}
              </Text>
              <Text style={styles.rowMeta}>
                {t('standing.referral.count', {
                  invited: referral.invited,
                  rewarded: referral.rewarded,
                })}
              </Text>
            </>
          ) : (
            <Text style={styles.blurb}>{t('standing.referral.pending')}</Text>
          )}

          <View style={{ gap: 6, marginTop: 4 }}>
            <Field
              label={t('standing.referral.claimLabel')}
              value={codeInput}
              onChangeText={(value) => setCodeInput(value.toUpperCase())}
              placeholder="ABC234"
              autoCapitalize="characters"
              icon={<Share2 size={15} color={colors.textMuted} />}
            />
            {!!codeError && <Text style={styles.error}>{codeError}</Text>}
            <Button
              label={t('standing.referral.claim')}
              variant="outline"
              size="sm"
              disabled={!codeInput.trim()}
              onPress={() => void claim()}
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  scroll: { padding: 20, gap: 14, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 19, fontWeight: '800', color: colors.textCharcoal },
  headerSub: { fontSize: 12, color: colors.textSlate, marginTop: 2 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgLinen,
  },

  blurb: { fontSize: 12, lineHeight: 18, color: colors.textSlate },
  error: { fontSize: 12, lineHeight: 18, color: colors.statusError },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { fontSize: 13, fontWeight: '700', color: colors.textCharcoal },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  dayStrip: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  dayActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  dayLabel: { fontSize: 11, fontWeight: '700', color: colors.textSlate },
  dayLabelActive: { color: '#FFFFFF' },

  code: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.brandSage,
  },
});

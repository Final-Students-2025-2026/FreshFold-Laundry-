/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, Clock, Package, X } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMonthClamped, membershipPlan, membershipSwitchQuote } from '@freshfold/core';
import { Icon } from '../src/components/Icon';
import { useT } from '../src/i18n';
import { Badge, Button, Card, Divider, SectionLabel } from '../src/components/ui';
import { SUBSCRIPTION_PLANS } from '../src/data/catalogue';
import { useClient } from '../src/store/ClientStore';
import { useSession } from '../src/store/SessionStore';
import { colors, formatCedis, radius, shadow, tints } from '../src/theme';

/**
 * Subscription plans — the website's Pricing section, as a sheet.
 *
 * The screen quotes; the server prices. Everything shown here — the fee, the
 * credit for a plan being replaced, what is actually due today — is computed by
 * `@freshfold/core`, which is the same module the server runs before it takes
 * any money. The two cannot disagree, and this one cannot grant itself a plan.
 */
export default function PlansScreen() {
  const router = useRouter();
  // This screen's own chrome is still English — only the plan copy that comes
  // out of the catalogue is translated. See `src/i18n/catalogue.ts`.
  const { c } = useT();
  const { isAuthenticated } = useSession();
  const { plan, walletBalance, subscribeToPlan, includedPickupsLeft } = useClient();

  const [selectedId, setSelectedId] = useState(
    plan?.planId ?? SUBSCRIPTION_PLANS.find((candidate) => candidate.popular)?.id ?? SUBSCRIPTION_PLANS[0].id
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  /** Set when the wallet is short, so the notice can offer the way out of it. */
  const [shortfall, setShortfall] = useState(0);

  const selected = SUBSCRIPTION_PLANS.find((candidate) => candidate.id === selectedId)!;
  const price = selected.monthlyPrice;
  const isCurrent = plan?.planId === selected.id && !plan?.cancelAtPeriodEnd;

  /**
   * Switching mid-month credits the unused part of the plan being replaced.
   *
   * Recomputed on every render rather than memoised on `now`: the number moves
   * with the clock, and a stale credit is a wrong price.
   */
  const quote = useMemo(
    () => membershipSwitchQuote(plan, membershipPlan(selected.id)!, new Date()),
    [plan, selected.id]
  );

  const subscribe = useCallback(async () => {
    if (!isAuthenticated) {
      router.replace({ pathname: '/auth', params: { reason: 'wallet' } });
      return;
    }

    setBusy(true);
    setNotice('');
    setShortfall(0);

    try {
      const result = await subscribeToPlan(selected.id);

      if (!result.ok) {
        if (result.reason === 'insufficient-funds') {
          const missing = result.shortfall ?? Math.max(0, quote.due - walletBalance);
          setShortfall(missing);
          setNotice(
            `Your wallet holds ${formatCedis(walletBalance)}. ${formatCedis(quote.due)} is due today — top up ${formatCedis(missing)} to start this plan.`
          );
        } else {
          setNotice(result.message);
        }
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } finally {
      setBusy(false);
    }
  }, [isAuthenticated, router, subscribeToPlan, selected.id, quote.due, walletBalance]);

  /** When the next month is taken — the running plan's date, or one from today. */
  const renewalDayLabel = useMemo(() => {
    const date = plan ? new Date(plan.renewsOn) : addMonthClamped(new Date());
    return date.toLocaleDateString([], { day: 'numeric', month: 'long' });
  }, [plan]);

  const topUp = useCallback(() => {
    // The notice used to name a number and stop there, leaving the customer to
    // find the wallet themselves.
    router.replace('/(tabs)/wallet');
  }, [router]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Membership plans</Text>
          <Text style={styles.headerSub}>Regular laundry, one monthly price.</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <X size={17} color={colors.textCharcoal} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {SUBSCRIPTION_PLANS.map((candidate) => {
          const active = candidate.id === selectedId;
          const current = plan?.planId === candidate.id;

          return (
            <Pressable
              key={candidate.id}
              onPress={() => {
                setSelectedId(candidate.id);
                setNotice('');
              }}
              style={({ pressed }) => [
                styles.planCard,
                active && styles.planCardActive,
                pressed && { opacity: 0.94 },
              ]}
            >
              <View style={styles.planHead}>
                <View style={[styles.planIcon, active && { backgroundColor: tints.gold18 }]}>
                  <Icon
                    name={candidate.iconName}
                    size={18}
                    color={active ? colors.brandGold : colors.brandSage}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <View style={styles.planTitleRow}>
                    <Text style={styles.planName}>{candidate.name}</Text>
                    {candidate.popular && <Badge label="Most chosen" tone="gold" />}
                    {current && (
                      <Badge
                        label={plan?.cancelAtPeriodEnd ? 'Ending' : 'Current'}
                        tone={plan?.cancelAtPeriodEnd ? 'warning' : 'success'}
                      />
                    )}
                  </View>
                  <Text style={styles.planTagline}>
                    {c(`plan.${candidate.id}.tagline`, candidate.tagline)}
                  </Text>
                </View>

                {active && <Check size={18} color={colors.brandSage} strokeWidth={3} />}
              </View>

              <View style={styles.priceRow}>
                <Text style={styles.price}>{candidate.price}</Text>
                <Text style={styles.billing}>{candidate.billing}</Text>
              </View>

              <View style={styles.capacityRow}>
                <View style={styles.capacityChip}>
                  <Package size={11} color={colors.textSlate} />
                  <Text style={styles.capacityText}>
                    {c(`plan.${candidate.id}.capacity`, candidate.capacity)}
                  </Text>
                </View>
                <View style={styles.capacityChip}>
                  <Clock size={11} color={colors.textSlate} />
                  <Text style={styles.capacityText}>
                    {c(`plan.${candidate.id}.turnaround`, candidate.turnaround)}
                  </Text>
                </View>
                {/* The allowance, on the plan actually being spent from. */}
                {current && (
                  <View style={styles.capacityChip}>
                    <Check size={11} color={colors.brandSage} />
                    <Text style={styles.capacityText}>
                      {includedPickupsLeft} of {candidate.includedPickups} pickups left
                    </Text>
                  </View>
                )}
              </View>

              {active && (
                <>
                  <Divider style={{ marginVertical: 12 }} />
                  <SectionLabel>What's included</SectionLabel>
                  <View style={{ gap: 8, marginTop: 9 }}>
                    {candidate.benefits.map((benefit, at) => (
                      <View key={benefit} style={styles.benefitRow}>
                        <View style={styles.benefitTick}>
                          <Check size={9} color="#FFFFFF" strokeWidth={3.5} />
                        </View>
                        <Text style={styles.benefitText}>
                          {c(`plan.${candidate.id}.benefit.${at}`, benefit)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </Pressable>
          );
        })}

        <Card tone="sunken" style={{ gap: 4, marginTop: 4 }}>
          <Text style={styles.footNoteTitle}>How billing works</Text>
          <Text style={styles.footNote}>
            The month is taken from your FreshFold wallet now and again on {renewalDayLabel}, and
            every booking under the plan is dispatched at elite priority. Included pickups cover the
            laundry itself — add-ons are still charged, at your member rate. Switching plans credits
            whatever is left of the month you have already paid for. Cancel any time from the Wallet
            tab: the plan runs to the end of that month, and nothing is taken after it.
          </Text>
          <Text style={styles.footNote}>
            A renewal that your wallet cannot cover ends the plan rather than running up a balance
            you owe.
          </Text>
          {/* Said plainly here rather than discovered afterwards. */}
          {quote.credit > quote.fee && (
            <Text style={styles.footNote}>
              Your current plan is worth {formatCedis(quote.credit)} for the rest of this month —
              more than {selected.name} costs. Today's charge is nothing, and the difference is not
              paid back, so switching later in the month may suit you better.
            </Text>
          )}
        </Card>

        {!!notice && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
            {shortfall > 0 && (
              <Button
                label="Top up wallet"
                variant="outline"
                size="sm"
                onPress={topUp}
                style={{ marginTop: 9, alignSelf: 'flex-start' }}
              />
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.footerLabel}>
            {quote.credit > 0 ? `${selected.name} — ${formatCedis(quote.credit)} credit` : selected.name}
          </Text>
          <Text style={styles.footerPrice}>
            {formatCedis(quote.due)}{' '}
            <Text style={styles.footerPer}>
              {quote.credit > 0 ? `today, then ${formatCedis(price)} / month` : '/ month'}
            </Text>
          </Text>
        </View>
        <Button
          label={
            isCurrent
              ? 'Current plan'
              : !isAuthenticated
                ? 'Sign in to start'
                : plan
                  ? 'Switch plan'
                  : 'Start plan'
          }
          onPress={subscribe}
          disabled={isCurrent}
          loading={busy}
          size="lg"
          style={{ minWidth: 150 }}
        />
      </View>
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
    paddingTop: 10,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 19, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.4 },
  headerSub: { fontSize: 11, color: colors.textSlate, marginTop: 2 },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { padding: 20, paddingTop: 4, paddingBottom: 30, gap: 12 },

  planCard: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 17,
    ...shadow.xs,
  },
  planCardActive: { borderColor: colors.brandSage, ...shadow.md },
  planHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  planIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  planName: { fontSize: 13.5, fontWeight: '800', color: colors.textCharcoal },
  planTagline: { fontSize: 10.5, color: colors.textSlate, marginTop: 3, lineHeight: 14.5 },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 14 },
  price: { fontSize: 25, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.8 },
  billing: { fontSize: 10.5, color: colors.textMuted },

  capacityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  capacityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bgLinen,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  capacityText: { fontSize: 9.5, color: colors.textSlate, fontWeight: '600' },

  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  benefitTick: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  benefitText: { flex: 1, fontSize: 11.5, color: colors.textCharcoal, lineHeight: 16 },

  footNoteTitle: { fontSize: 12, fontWeight: '800', color: colors.textCharcoal },
  footNote: { fontSize: 10.5, color: colors.textSlate, lineHeight: 15 },

  notice: {
    backgroundColor: tints.warning10,
    borderWidth: 1,
    borderColor: tints.warning30,
    borderRadius: radius.md,
    padding: 11,
  },
  noticeText: { fontSize: 11, color: colors.statusWarning, lineHeight: 15 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.cardPure,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingHorizontal: 20,
    paddingVertical: 13,
    ...shadow.lg,
  },
  footerLabel: { fontSize: 10.5, color: colors.textSlate },
  footerPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textCharcoal,
    letterSpacing: -0.5,
    marginTop: 1,
  },
  footerPer: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
});

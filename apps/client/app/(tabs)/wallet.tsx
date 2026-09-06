/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Crown,
  Gift,
  Lock,
  Plus,
  Sparkles,
  Wallet as WalletIcon,
} from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, LOYALTY_REWARDS, tierProgress } from '@freshfold/core';
import type { PaymentTransaction } from '@freshfold/core';
import { Icon } from '../../src/components/Icon';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ProgressBar,
  SectionHeader,
  SectionLabel,
  Sheet,
} from '../../src/components/ui';
import { SUBSCRIPTION_PLANS, nextTierAfter, tierForPoints } from '../../src/data/catalogue';
import { intlTag, useT, type Translate } from '../../src/i18n';
import { api } from '../../src/services/api';
import { paystackReturnUrl } from '../../src/services/checkout';
import { useClient } from '../../src/store/ClientStore';
import { useSession } from '../../src/store/SessionStore';
import { colors, formatCedis, radius, relativeTime, shadow, tints } from '../../src/theme';

/** Preset top-up amounts, in cedis. */
const TOP_UPS = [50, 100, 200, 500];

/**
 * Why a top-up call failed, in terms of the thing that actually broke.
 *
 * Three failures wore one message before, and only one of them was Paystack's.
 * A refused answer from the gateway, a dispatch server that is not running, and
 * a request that ran out of its eight seconds all told the customer to check
 * their connection — so the one case a developer needed to recognise, the
 * server being down, read as a phone problem. The server's address is in the
 * message for the same reason: on a phone it is the LAN address, and being
 * wrong about it is the usual cause.
 *
 * `reachable` is what stops the remaining overlap. A timeout by itself cannot
 * say which hop was slow: an unroutable address — a phone on cellular data with
 * the base URL derived from a `192.168.x` Expo host — drops packets rather than
 * refusing them, so the request hangs and aborts exactly as a slow gateway
 * would. The store's poll has already distinguished them, and when it says the
 * server is unreachable this stops blaming Paystack for a request Paystack
 * never received.
 *
 * `t` is passed in rather than read from a hook, because this is a function and
 * not a component.
 */
function gatewayProblem(t: Translate, err: unknown, reachable: boolean): string {
  // The server answered, so it is reachable and the complaint is really the
  // gateway's — including the 504 it now returns when Paystack stops answering.
  // Its sentence arrives in English; the frame around it is the booking flow's
  // key, because it is the same frame around the same kind of message.
  if (err instanceof ApiError) return t('book.pay.gateway', { message: err.message });

  if (!reachable) return t('wallet.gateway.unreachable', { url: api.baseUrl });

  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return t('wallet.gateway.timeout');
  }

  return t('wallet.gateway.offline', { url: api.baseUrl });
}

/**
 * Wallet & membership.
 *
 * The website splits this across the portal's wallet tab and the Membership
 * section; on a phone they belong together, because they are the same
 * question: what does this account hold, and what does it entitle me to.
 *
 * Everything here needs an account — the balance and the points live on the
 * account record — so signed out, this is a sign-in prompt rather than an
 * empty wallet.
 */
export default function WalletScreen() {
  const router = useRouter();
  const { isAuthenticated, account } = useSession();
  const {
    walletBalance,
    points,
    transactions,
    plan,
    includedPickupsLeft,
    planEndsOn,
    topUpWallet,
    redeemReward,
    cancelPlan,
    resumePlan,
    refresh,
    online,
    probed,
  } = useClient();
  const { t, locale, c } = useT();

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState(TOP_UPS[1]);
  const [busy, setBusy] = useState(false);
  /** Paystack's reference for the checkout in flight, once one exists. */
  const [checkoutRef, setCheckoutRef] = useState('');
  const [topUpNotice, setTopUpNotice] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The reward currently on the wire, so one tap cannot become two. */
  const [redeeming, setRedeeming] = useState<string | null>(null);

  const tier = useMemo(() => tierForPoints(points), [points]);
  const next = useMemo(() => nextTierAfter(tier), [tier]);

  // From core, so this bar and the website's read the same. Both surfaces used
  // to work the percentage out themselves against their own tier tables.
  const { pointsToNext: toNext, percent: tierPercent } = useMemo(
    () => tierProgress(points),
    [points]
  );

  const activePlan = useMemo(
    () => SUBSCRIPTION_PLANS.find((candidate) => candidate.id === plan?.planId),
    [plan?.planId]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  /**
   * Redeems, then says what the server did.
   *
   * The points come off there, so the balance on screen updates from the
   * account that comes back rather than from anything worked out here.
   */
  const onRedeem = useCallback(
    async (rewardId: string) => {
      setRedeeming(rewardId);
      try {
        const result = await redeemReward(rewardId);

        if (result.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          Alert.alert(t('wallet.rewards.doneTitle'), t('wallet.rewards.doneBody'));
        } else {
          // The server's refusal, in its own words.
          Alert.alert(t('wallet.rewards.failed'), result.message);
        }
      } finally {
        setRedeeming(null);
      }
    },
    [redeemReward, t]
  );

  /**
   * Cancelling asks first, and says what it will actually do.
   *
   * This was one unconfirmed tap that deleted the plan on the spot — no
   * confirmation, no refund, and priority gone the same second, while the plans
   * screen promised the customer keeps the month they paid for. It now ends at
   * the end of the paid period, and the dialog says so before anything happens.
   */
  const confirmCancel = useCallback(() => {
    if (!plan) return;

    const until = new Date(plan.renewsOn).toLocaleDateString(intlTag(locale));

    Alert.alert(
      t('wallet.plan.cancelTitle'),
      t('wallet.plan.cancelBody', { date: until }),
      [
        { text: t('wallet.plan.keep'), style: 'cancel' },
        {
          text: t('wallet.plan.cancelConfirm'),
          style: 'destructive',
          onPress: () => {
            setPlanBusy(true);
            void cancelPlan()
              .then((endsOn) => {
                if (endsOn) {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                } else {
                  Alert.alert(
                    t('wallet.plan.cancelFailedTitle'),
                    t('wallet.plan.cancelFailedBody')
                  );
                }
              })
              .finally(() => setPlanBusy(false));
          },
        },
      ]
    );
  }, [plan, cancelPlan, t, locale]);

  const keepPlan = useCallback(() => {
    setPlanBusy(true);
    void resumePlan()
      .then((ok) => {
        if (!ok) {
          Alert.alert(t('wallet.plan.resumeFailedTitle'), t('wallet.plan.resumeFailedBody'));
        }
      })
      .finally(() => setPlanBusy(false));
  }, [resumePlan, t]);

  const closeTopUp = useCallback(() => {
    setTopUpOpen(false);
    setCheckoutRef('');
    setTopUpNotice('');
  }, []);

  /**
   * Opens a Paystack checkout for the chosen amount.
   *
   * This screen used to credit the balance the moment the button was pressed —
   * it called the wallet route with an amount and nothing else, so the money
   * appeared without anyone ever having paid. Nothing moves now until Paystack
   * has taken the payment and the server has confirmed it did.
   *
   * Initializing and opening the browser fail differently, and are reported
   * differently: a blocked browser must not send someone off to try again when
   * a perfectly good transaction is already waiting for them.
   */
  const startTopUp = useCallback(async () => {
    setBusy(true);
    setTopUpNotice('');

    let checkout: { reference: string; authorization_url: string };

    try {
      checkout = await api.initializePayment({
        email: account?.email ?? '',
        amount,
        // Back into the app rather than the server's `APP_URL`, which on a
        // phone is a localhost page that does not exist. `flow` is only read if
        // the app was killed while the browser had the screen — see the
        // `paystack-success` route. Left unset under Expo Go, whose address is
        // not ours to hand out — see `paystackReturnUrl`.
        callback_url: paystackReturnUrl('wallet'),
        // The server refuses to credit a wallet from a reference that was not
        // opened as a top-up, so a booking payment cannot be replayed here.
        // A top-up names no booking and now cannot: the server writes
        // `booking_id` only for `purpose: 'booking'`, so this reference can
        // never also be spent settling an order.
        purpose: 'wallet_topup',
        display: { customer_name: account?.name ?? 'Patron' },
      });
    } catch (err) {
      setBusy(false);
      // Same test the Offline badge draws itself from: a negative is only worth
      // believing once the first poll has come back.
      setTopUpNotice(gatewayProblem(t, err, !(probed && !online)));
      return;
    }

    setCheckoutRef(checkout.reference);

    try {
      await WebBrowser.openBrowserAsync(checkout.authorization_url);
      setTopUpNotice(t('wallet.topUp.finishOnPage'));
    } catch {
      setTopUpNotice(t('wallet.topUp.browserFailed', { reference: checkout.reference }));
    } finally {
      setBusy(false);
    }
  }, [account?.email, account?.name, amount, online, probed, t]);

  /**
   * Claims the payment.
   *
   * The reference is all that is sent: the server verifies it with Paystack
   * itself and credits what Paystack says was collected, so a wrong amount
   * here could not become a wrong balance. Keyed on the reference too, so
   * tapping twice credits once.
   */
  const collectTopUp = useCallback(async () => {
    if (!checkoutRef) return;
    setBusy(true);

    try {
      await topUpWallet('Paystack', checkoutRef);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      closeTopUp();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      // The reference is kept, so this stays retryable: a payment that settled
      // is collectable later even if this attempt could not reach the server.
      setTopUpNotice(
        err instanceof ApiError
          ? err.message
          : t('wallet.topUp.confirmFailed', { url: api.baseUrl })
      );
    } finally {
      setBusy(false);
    }
  }, [checkoutRef, closeTopUp, topUpWallet, t]);

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('wallet.title')}</Text>
        </View>
        <View style={{ padding: 20 }}>
          <EmptyState
            icon={<Lock size={26} color={colors.brandStone} />}
            title={t('wallet.locked.title')}
            body={t('wallet.locked.body')}
            action={t('common.signInCta')}
            onAction={() => router.push({ pathname: '/auth', params: { reason: 'wallet' } })}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('wallet.title')}</Text>
          <Text style={styles.headerSub}>{account?.email}</Text>
        </View>
        {probed && !online && <Badge label={t('common.offline')} tone="warning" />}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandSage} />
        }
      >
        {/* --------------------------------------------------------- balance */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceHead}>
            <WalletIcon size={15} color="rgba(255,255,255,0.65)" />
            <Text style={styles.balanceLabel}>{t('wallet.balance.label')}</Text>
          </View>
          <Text style={styles.balanceValue}>{formatCedis(walletBalance, locale)}</Text>
          <Text style={styles.balanceHint}>{t('wallet.balance.hint')}</Text>

          <View style={styles.balanceActions}>
            <Button
              label={t('wallet.balance.topUp')}
              variant="gold"
              onPress={() => setTopUpOpen(true)}
              icon={<Plus size={15} color="#FFFFFF" />}
              style={{ flex: 1 }}
            />
            <Button
              label={t('wallet.balance.book')}
              variant="ghost"
              onPress={() => router.push('/(tabs)/book')}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        {/* --------------------------------------------------------- loyalty */}
        <View style={styles.section}>
          <SectionHeader title={t('wallet.tier.title')} caption={t('wallet.tier.caption')} />

          {/* The tier's card name, name, description and benefits are catalogue
              records with ids, so they are translated there rather than here. */}
          <View style={[styles.tierCard, { backgroundColor: tier.gradient[0] }]}>
            <View style={[styles.tierWash, { backgroundColor: tier.gradient[1] }]} />

            <View style={styles.tierHead}>
              <Crown size={16} color={tier.accent} />
              <Text style={[styles.tierCardName, { color: tier.accent }]}>{tier.cardName}</Text>
            </View>

            <Text style={[styles.tierName, { color: tier.textColor }]}>{tier.name}</Text>
            <Text style={[styles.tierDesc, { color: tier.textColor }]}>
              {c(`tier.${tier.id}.desc`, tier.description)}
            </Text>

            <View style={styles.tierPoints}>
              <Text style={[styles.tierPointsValue, { color: tier.textColor }]}>
                {points.toLocaleString(intlTag(locale))}
              </Text>
              <Text style={[styles.tierPointsLabel, { color: tier.accent }]}>
                {t('wallet.tier.lifetime')}
              </Text>
            </View>

            {next ? (
              <View style={{ gap: 6, marginTop: 12 }}>
                <ProgressBar percent={tierPercent} tone="gold" height={5} />
                <Text style={[styles.tierNext, { color: tier.accent }]}>
                  {t('wallet.tier.toNext', {
                    points: toNext.toLocaleString(intlTag(locale)),
                    tier: next.name,
                  })}
                </Text>
              </View>
            ) : (
              <Text style={[styles.tierNext, { color: tier.accent, marginTop: 12 }]}>
                {t('wallet.tier.top')}
              </Text>
            )}
          </View>

          <Card style={{ gap: 9, marginTop: 12 }}>
            <SectionLabel>{t('wallet.tier.benefits')}</SectionLabel>
            {tier.benefits.map((benefit, at) => (
              <View key={benefit} style={styles.benefitRow}>
                <Gift size={13} color={colors.brandGold} />
                <Text style={styles.benefitText}>
                  {c(`tier.${tier.id}.benefit.${at}`, benefit)}
                </Text>
              </View>
            ))}
            {tier.discountRate > 0 && (
              <>
                <Divider style={{ marginVertical: 3 }} />
                <Text style={styles.discountNote}>
                  {t('wallet.tier.discount', { percent: Math.round(tier.discountRate * 100) })}
                </Text>
              </>
            )}
          </Card>

          {/*
            Spending points, which only the website offered — and offered
            dishonestly: its buttons showed "Successfully redeemed" and deducted
            nothing, so the same voucher could be claimed forever. Both surfaces
            now post to `/api/accounts/wallet`, which takes the points.
          */}
          <Card style={{ gap: 10, marginTop: 12 }}>
            <SectionLabel>{t('wallet.rewards.title')}</SectionLabel>

            {/* `LOYALTY_REWARDS` is a core record set, shared with the desk
                console, so the reward names and descriptions stay in core and
                are translated by id with the rest of the catalogue copy. Only
                the frame around them is keyed here. */}
            {LOYALTY_REWARDS.map((reward) => {
              const affordable = points >= reward.cost;

              return (
                <View key={reward.id} style={styles.rewardRow}>
                  <View style={styles.rewardCopy}>
                    <Text style={styles.rewardName}>{reward.name}</Text>
                    <Text style={styles.rewardDesc}>{reward.description}</Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('wallet.rewards.redeem', {
                      name: reward.name,
                      cost: reward.cost,
                    })}
                    accessibilityState={{ disabled: !affordable || redeeming !== null }}
                    disabled={!affordable || redeeming !== null}
                    onPress={() => onRedeem(reward.id)}
                    style={({ pressed }) => [
                      styles.rewardButton,
                      !affordable && styles.rewardButtonOff,
                      pressed && affordable && { opacity: 0.75 },
                    ]}
                  >
                    {redeeming === reward.id ? (
                      <ActivityIndicator size="small" color={colors.textCharcoal} />
                    ) : (
                      <Text
                        style={[
                          styles.rewardButtonText,
                          !affordable && styles.rewardButtonTextOff,
                        ]}
                      >
                        {t('wallet.rewards.cost', {
                          points: reward.cost.toLocaleString(intlTag(locale)),
                        })}
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </View>

        {/* ----------------------------------------------------------- plan */}
        <View style={styles.section}>
          <SectionHeader
            title={t('wallet.plan.title')}
            caption={activePlan ? t('wallet.plan.activeCaption') : t('wallet.plan.caption')}
            action={activePlan ? undefined : t('wallet.plan.compare')}
            onAction={() => router.push('/plans')}
          />

          {activePlan && plan ? (
            <Card tone="gold" style={{ gap: 10 }}>
              <View style={styles.planHead}>
                <Icon name={activePlan.iconName} size={18} color={colors.brandGold} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>{activePlan.name}</Text>
                  <Text style={styles.planMeta}>
                    {/* The date is a phrase inside the line — "ends" and
                        "renews" are two keys — rather than a word glued to a
                        date, so a language can put the preposition its own
                        grammar wants in front of it. */}
                    {t('wallet.plan.meta', {
                      left: includedPickupsLeft,
                      total: activePlan.includedPickups,
                      when: planEndsOn
                        ? t('wallet.plan.ends', {
                            date: new Date(planEndsOn).toLocaleDateString(intlTag(locale)),
                          })
                        : t('wallet.plan.renews', {
                            date: new Date(plan.renewsOn).toLocaleDateString(intlTag(locale)),
                          }),
                    })}
                  </Text>
                </View>
                <Text style={styles.planPrice}>{formatCedis(plan.price, locale)}</Text>
              </View>

              {/* A cancellation already made, and the way back from it. */}
              {planEndsOn && (
                <Text style={styles.planNotice}>
                  {t('wallet.plan.cancelled', {
                    date: new Date(planEndsOn).toLocaleDateString(intlTag(locale)),
                  })}
                </Text>
              )}

              <Divider />

              <View style={{ flexDirection: 'row', gap: 9 }}>
                <Button
                  label={t('wallet.plan.change')}
                  variant="ghost"
                  size="sm"
                  onPress={() => router.push('/plans')}
                  style={{ flex: 1 }}
                />
                <Button
                  label={planEndsOn ? t('wallet.plan.keep') : t('wallet.plan.cancel')}
                  variant={planEndsOn ? 'outline' : 'danger'}
                  size="sm"
                  loading={planBusy}
                  onPress={planEndsOn ? keepPlan : confirmCancel}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          ) : (
            <Pressable onPress={() => router.push('/plans')}>
              <Card style={{ gap: 10 }}>
                <View style={styles.planHead}>
                  <Sparkles size={17} color={colors.brandSage} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{t('wallet.plan.none')}</Text>
                    <Text style={styles.planMeta}>
                      {t('wallet.plan.from', {
                        price: formatCedis(SUBSCRIPTION_PLANS[0].monthlyPrice, locale),
                      })}
                    </Text>
                  </View>
                </View>
                <Button
                  label={t('wallet.plan.explore')}
                  variant="outline"
                  size="sm"
                  onPress={() => router.push('/plans')}
                />
              </Card>
            </Pressable>
          )}
        </View>

        {/* ---------------------------------------------------------- ledger */}
        <View style={styles.section}>
          <SectionHeader
            title={t('wallet.statement.title')}
            caption={t('wallet.statement.caption')}
          />

          {transactions.length === 0 ? (
            <EmptyState
              icon={<WalletIcon size={24} color={colors.brandStone} />}
              title={t('wallet.statement.emptyTitle')}
              body={t('wallet.statement.emptyBody')}
            />
          ) : (
            <Card style={{ gap: 2 }}>
              {transactions.slice(0, 25).map((transaction, index) => (
                <React.Fragment key={transaction.reference}>
                  {index > 0 && <Divider style={{ marginVertical: 8 }} />}
                  <TransactionRow transaction={transaction} />
                </React.Fragment>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      {/* -------------------------------------------------------- top-up */}
      <Sheet visible={topUpOpen} onClose={closeTopUp}>
        <ScrollView contentContainerStyle={styles.topUp} keyboardShouldPersistTaps="handled">
          <Text style={styles.topUpTitle}>{t('wallet.topUp.title')}</Text>
          <Text style={styles.topUpBody}>{t('wallet.topUp.body')}</Text>

          <View style={styles.amountRow}>
            {TOP_UPS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setAmount(value)}
                disabled={!!checkoutRef}
                style={[
                  styles.amountCell,
                  amount === value && styles.amountCellActive,
                  !!checkoutRef && styles.amountCellLocked,
                ]}
              >
                <Text style={[styles.amountLabel, amount === value && { color: '#FFFFFF' }]}>
                  ₵{value}
                </Text>
              </Pressable>
            ))}
          </View>

          <Divider style={{ marginVertical: 4 }} />

          <View style={styles.topUpSummary}>
            <Text style={styles.topUpSummaryLabel}>{t('wallet.topUp.after')}</Text>
            <Text style={styles.topUpSummaryValue}>
              {formatCedis(walletBalance + amount, locale)}
            </Text>
          </View>

          {!!topUpNotice && <Text style={styles.topUpNotice}>{topUpNotice}</Text>}

          <Button
            label={
              checkoutRef
                ? t('book.pay.reopen')
                : t('wallet.topUp.pay', { amount: formatCedis(amount, locale) })
            }
            onPress={startTopUp}
            loading={busy && !checkoutRef}
            variant={checkoutRef ? 'ghost' : 'primary'}
            size="lg"
          />

          {!!checkoutRef && (
            <Button
              label={t('wallet.topUp.collect')}
              onPress={collectTopUp}
              loading={busy}
              size="lg"
            />
          )}

          <Button label={t('common.cancel')} variant="ghost" onPress={closeTopUp} />
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}

function TransactionRow({ transaction }: { transaction: PaymentTransaction }) {
  const { locale } = useT();

  // A top-up adds to the balance; everything else spends from it.
  //
  // The description is the server's sentence rather than this app's, and that is
  // what keeps this test safe: it is matched against the English the server
  // wrote, is never translated, and so the arrow keeps pointing the right way in
  // every language. The description, the method and the status are all rendered
  // as they arrive for the same reason — they are one vocabulary shared with the
  // dispatch board and the desk's mail.
  const inbound = transaction.description.toLowerCase().includes('top-up');

  return (
    <View style={styles.txnRow}>
      <View style={[styles.txnIcon, inbound && { backgroundColor: tints.success10 }]}>
        {inbound ? (
          <ArrowDownLeft size={13} color={colors.statusSuccess} />
        ) : (
          <ArrowUpRight size={13} color={colors.textSlate} />
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.txnDesc} numberOfLines={1}>
          {transaction.description}
        </Text>
        <Text style={styles.txnMeta} numberOfLines={1}>
          {transaction.method} · {transaction.reference} ·{' '}
          {relativeTime(transaction.timestamp, locale)}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.txnAmount, inbound && { color: colors.statusSuccess }]}>
          {inbound ? '+' : '−'} {formatCedis(transaction.amount, locale)}
        </Text>
        <Text style={styles.txnStatus}>{transaction.status}</Text>
      </View>
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
  headerSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },

  scroll: { padding: 20, paddingTop: 4, paddingBottom: 40 },

  balanceCard: {
    backgroundColor: colors.brandSageDeep,
    borderRadius: radius.xxl,
    padding: 20,
    gap: 3,
    ...shadow.md,
  },
  balanceHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  balanceLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.65)',
  },
  balanceValue: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1.2,
    marginTop: 6,
  },
  balanceHint: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  balanceActions: { flexDirection: 'row', gap: 9, marginTop: 16 },

  section: { marginTop: 28 },

  tierCard: { borderRadius: radius.xxl, padding: 20, overflow: 'hidden', ...shadow.md },
  tierWash: {
    position: 'absolute',
    right: -60,
    top: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    opacity: 0.85,
  },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tierCardName: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  tierName: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, marginTop: 12 },
  tierDesc: { fontSize: 11, opacity: 0.75, marginTop: 4, lineHeight: 15.5 },
  tierPoints: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 16 },
  tierPointsValue: { fontSize: 27, fontWeight: '800', letterSpacing: -0.8 },
  tierPointsLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tierNext: { fontSize: 10, fontWeight: '700' },

  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  benefitText: { flex: 1, fontSize: 11.5, color: colors.textCharcoal, lineHeight: 16 },
  discountNote: { fontSize: 10.5, color: colors.textSlate, lineHeight: 15 },

  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardCopy: { flex: 1, gap: 2 },
  rewardName: { fontSize: 12.5, fontWeight: '700', color: colors.textCharcoal },
  rewardDesc: { fontSize: 10.5, color: colors.textSlate, lineHeight: 14.5 },
  rewardButton: {
    minWidth: 78,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.brandGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardButtonOff: { backgroundColor: tints.stone35 },
  rewardButtonText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.textCharcoal,
    letterSpacing: 0.3,
  },
  rewardButtonTextOff: { color: colors.textMuted },

  planHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planName: { fontSize: 13, fontWeight: '800', color: colors.textCharcoal },
  planMeta: { fontSize: 10.5, color: colors.textSlate, marginTop: 2 },
  planPrice: { fontSize: 14, fontWeight: '800', color: colors.brandGold },
  planNotice: { fontSize: 10.5, color: colors.statusWarning, lineHeight: 15 },

  txnRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  txnIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: tints.stone35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txnDesc: { fontSize: 11.5, fontWeight: '700', color: colors.textCharcoal },
  txnMeta: { fontSize: 9.5, color: colors.textMuted, marginTop: 2 },
  txnAmount: { fontSize: 12, fontWeight: '800', color: colors.textCharcoal },
  txnStatus: { fontSize: 9, color: colors.textMuted, marginTop: 1 },

  topUp: { padding: 20, paddingTop: 8, gap: 11 },
  topUpTitle: { fontSize: 16, fontWeight: '800', color: colors.textCharcoal },
  topUpBody: { fontSize: 11, color: colors.textSlate, lineHeight: 15.5 },
  amountRow: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  amountCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
  },
  amountCellActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  // Once a checkout exists it is for a fixed amount, so the presets stop being
  // a choice — changing one here would only disagree with what Paystack charges.
  amountCellLocked: { opacity: 0.5 },
  amountLabel: { fontSize: 13, fontWeight: '800', color: colors.textCharcoal },

  topUpNotice: {
    fontSize: 11,
    lineHeight: 15.5,
    color: colors.textSlate,
    backgroundColor: tints.warning10,
    borderRadius: radius.lg,
    padding: 10,
  },

  topUpSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topUpSummaryLabel: { fontSize: 11, color: colors.textSlate },
  topUpSummaryValue: { fontSize: 17, fontWeight: '800', color: colors.textCharcoal },
});

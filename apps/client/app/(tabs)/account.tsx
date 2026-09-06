/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  Bell,
  Bot,
  ChevronRight,
  Repeat,
  LogOut,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  Settings,
  Star,
  Trash2,
  UserCog,
} from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MAX_SAVED_ADDRESSES } from '@freshfold/core';
import AddressSheet from '../../src/components/AddressSheet';
import NotificationsSheet from '../../src/components/NotificationsSheet';
import OrderCard from '../../src/components/OrderCard';
import {
  Badge,
  Button,
  Card,
  ConnectionPill,
  Divider,
  EmptyState,
  InitialsAvatar,
  SectionHeader,
} from '../../src/components/ui';
import { CONTACT, tierForPoints } from '../../src/data/catalogue';
import { intlTag, useT } from '../../src/i18n';
import { useClient, type SavedAddress } from '../../src/store/ClientStore';
import { useSession } from '../../src/store/SessionStore';
import { colors, formatCedis, radius, tints } from '../../src/theme';
import { API_BASE_URL } from '../../src/services/api';

/**
 * Account.
 *
 * A dashboard: who you are, what you have spent, where we collect from, the
 * last few orders and the ways to reach a human. Signed out it is a short pitch
 * and a sign-in button — the app stays usable either way, so there is nothing
 * to lock.
 *
 * Anything that *changes* the account lives on the settings screen, reached
 * from the gear in the header. The biometric switch used to sit down here in a
 * "Security" section of its own, which is how a read-only screen ends up with
 * one lonely control and no way to correct a mistyped name.
 */
export default function AccountScreen() {
  const router = useRouter();
  const { t, locale } = useT();
  const { account, isAuthenticated, signOut, resendVerification } = useSession();
  const {
    bookings,
    activeBookings,
    pastBookings,
    addresses,
    removeAddress,
    points,
    walletBalance,
    unreadCount,
    online,
    probed,
  } = useClient();

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  /** Open with an address to edit it, or with none to add one. */
  const [addressSheet, setAddressSheet] = useState<{ open: boolean; editing: SavedAddress | null }>({
    open: false,
    editing: null,
  });

  // The unconfirmed-email notice. `verifyNotice` holds whatever the server last
  // said — a cooldown message answers the question the customer is about to ask.
  const [verifySending, setVerifySending] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState('');

  const tier = useMemo(() => tierForPoints(points), [points]);
  const recent = useMemo(() => [...activeBookings, ...pastBookings].slice(0, 3), [
    activeBookings,
    pastBookings,
  ]);

  const lifetimeSpend = useMemo(
    () =>
      bookings
        .filter((booking) => booking.paymentStatus === 'Paid')
        .reduce((total, booking) => total + (booking.amount ?? 0), 0),
    [bookings]
  );

  const handleResendVerification = useCallback(async () => {
    setVerifySending(true);
    setVerifyNotice('');
    try {
      await resendVerification();
      setVerifyNotice(t('account.verify.sent'));
    } catch (error) {
      // The server's own wording, which carries the cooldown countdown. Left in
      // English knowingly: the desk writes these, and a sentence a customer can
      // read beats a guess at which of them this was.
      setVerifyNotice(error instanceof Error ? error.message : t('account.verify.failed'));
    } finally {
      setVerifySending(false);
    }
  }, [resendVerification, t]);

  const confirmSignOut = useCallback(() => {
    Alert.alert(t('account.signOutTitle'), t('account.signOutBody'), [
      { text: t('account.stay'), style: 'cancel' },
      { text: t('account.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  }, [signOut, t]);

  const confirmRemoveAddress = useCallback(
    (saved: SavedAddress) => {
      Alert.alert(t('addresses.confirmRemove'), saved.address, [
        { text: t('common.keep'), style: 'cancel' },
        { text: t('common.remove'), style: 'destructive', onPress: () => removeAddress(saved.id) },
      ]);
    },
    [removeAddress, t]
  );

  /**
   * Opens the address sheet, or says why it will not — the book is a column on
   * the account now, and the server refuses one longer than the ceiling.
   */
  const addAddress = useCallback(() => {
    if (addresses.length >= MAX_SAVED_ADDRESSES) {
      Alert.alert(t('account.addresses.title'), t('addresses.full', { max: MAX_SAVED_ADDRESSES }));
      return;
    }
    setAddressSheet({ open: true, editing: null });
  }, [addresses.length, t]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('account.title')}</Text>
        <ConnectionPill online={online} pending={!probed} />
        <Pressable
          onPress={() => setNotificationsOpen(true)}
          hitSlop={8}
          style={styles.bell}
          accessibilityLabel={t('account.notifications')}
        >
          <Bell size={17} color={colors.textCharcoal} />
          {unreadCount > 0 && <View style={styles.bellDot} />}
        </Pressable>
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={8}
          style={styles.bell}
          accessibilityLabel={t('settings.title')}
        >
          <Settings size={17} color={colors.textCharcoal} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/*
          ------------------------------------------- unconfirmed email
          Above the profile card, because the server refuses a booking from an
          unconfirmed account. Finding that out on the Book tab, with the form
          already filled in, is the version of this that loses the order.
        */}
        {isAuthenticated && account?.emailVerified === false && (
          <Card style={styles.verifyCard}>
            <View style={styles.verifyHeader}>
              <Mail size={16} color={colors.brandGold} />
              <Text style={styles.verifyTitle}>{t('account.verify.title')}</Text>
            </View>
            <Text style={styles.verifyBody}>
              {verifyNotice || t('account.verify.body', { email: account.email })}
            </Text>
            <Button
              label={verifySending ? t('common.sending') : t('account.verify.resend')}
              onPress={handleResendVerification}
              loading={verifySending}
            />
          </Card>
        )}

        {/* --------------------------------------------------------- profile */}
        {isAuthenticated && account ? (
          <Card style={{ gap: 14 }}>
            <View style={styles.profileRow}>
              <InitialsAvatar name={account.name} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{account.name}</Text>
                <Text style={styles.profileContact} numberOfLines={1}>
                  {account.email}
                </Text>
                <Text style={styles.profileContact}>{account.phone}</Text>
              </View>
              <Badge label={tier.cardName} tone="gold" />
            </View>

            <Divider />

            <View style={styles.statRow}>
              <Stat label={t('account.stats.orders')} value={String(bookings.length)} />
              {/*
                Grouped for the reading language rather than for the handset, so
                two customers reading the same screen in the same language see
                the same number — `1,240` in English, `1 240` in French.
              */}
              <Stat label={t('account.stats.points')} value={points.toLocaleString(intlTag(locale))} />
              <Stat label={t('account.stats.wallet')} value={formatCedis(walletBalance, locale)} />
              <Stat label={t('account.stats.spent')} value={formatCedis(lifetimeSpend, locale)} />
            </View>
          </Card>
        ) : (
          <Card style={{ gap: 12 }}>
            <View style={styles.profileRow}>
              <InitialsAvatar name={t('account.guestName')} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{t('common.guest')}</Text>
                <Text style={styles.profileContact}>{t('account.guestBody')}</Text>
              </View>
            </View>
            <Button label={t('common.signInCta')} onPress={() => router.push('/auth')} />
          </Card>
        )}

        {/* ---------------------------------------------------------- orders */}
        <View style={styles.section}>
          <SectionHeader
            title={t('account.orders.title')}
            caption={t('account.orders.caption', {
              active: activeBookings.length,
              past: pastBookings.length,
            })}
            action={bookings.length > 0 ? t('account.orders.seeAll') : undefined}
            onAction={() => router.push('/orders')}
          />

          {recent.length === 0 ? (
            <EmptyState
              icon={<Package size={24} color={colors.brandStone} />}
              title={t('account.orders.emptyTitle')}
              body={t('account.orders.emptyBody')}
              action={t('common.schedulePickup')}
              onAction={() => router.push('/(tabs)/book')}
            />
          ) : (
            <View style={{ gap: 11 }}>
              {recent.map((booking) => (
                <OrderCard
                  key={booking.id}
                  booking={booking}
                  onPress={() =>
                    router.push({ pathname: '/order/[id]', params: { id: booking.id } })
                  }
                />
              ))}
            </View>
          )}
        </View>

        {/* ------------------------------------------------------- addresses */}
        <View style={styles.section}>
          <SectionHeader
            title={t('account.addresses.title')}
            caption={t('account.addresses.caption')}
            action={t('common.add')}
            onAction={addAddress}
          />

          {addresses.length === 0 ? (
            <Pressable onPress={addAddress}>
              <Card tone="sunken" style={styles.addRow}>
                <Plus size={16} color={colors.brandSage} />
                <Text style={styles.addLabel}>{t('addresses.empty')}</Text>
              </Card>
            </Pressable>
          ) : (
            <View style={{ gap: 9 }}>
              {addresses.map((saved) => (
                <View key={saved.id} style={styles.addressRow}>
                  <View style={styles.addressIcon}>
                    <MapPin size={15} color={colors.brandSage} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.addressTitleRow}>
                      <Text style={styles.addressLabel}>{saved.label}</Text>
                      {saved.isDefault && <Badge label={t('common.default')} tone="sage" />}
                    </View>
                    <Text style={styles.addressText} numberOfLines={2}>
                      {[saved.address, saved.suburb, saved.city].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                  <View style={styles.addressActions}>
                    <Pressable
                      onPress={() => setAddressSheet({ open: true, editing: saved })}
                      hitSlop={8}
                      accessibilityLabel={t('addresses.edit', { label: saved.label })}
                    >
                      <Pencil size={14} color={colors.textSlate} />
                    </Pressable>
                    <Pressable
                      onPress={() => confirmRemoveAddress(saved)}
                      hitSlop={8}
                      accessibilityLabel={t('addresses.remove', { label: saved.label })}
                    >
                      <Trash2 size={15} color={colors.statusError} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/*
          -------------------------------------------------------- settings
          Shown to guests too: the addresses and the alert switches on that
          screen belong to the phone, not to an account.
        */}
        <View style={styles.section}>
          <Card style={{ gap: 2 }}>
            {/* The weekly pickups a membership plan has always sold and nothing
                ever scheduled, plus the referral code. */}
            <SupportRow
              icon={<Repeat size={15} color={colors.brandSage} />}
              label={t('standing.title')}
              caption={t('standing.subtitle')}
              onPress={() => router.push('/standing')}
            />
            <SupportRow
              icon={<Settings size={15} color={colors.brandSage} />}
              label={t('settings.title')}
              caption={t('account.settingsCaption')}
              onPress={() => router.push('/settings')}
            />
          </Card>
        </View>

        {/* --------------------------------------------------------- support */}
        <View style={styles.section}>
          <SectionHeader title={t('account.help.title')} caption={t('account.help.caption')} />
          <Card style={{ gap: 2 }}>
            <SupportRow
              icon={<Bot size={15} color={colors.brandSage} />}
              label={t('account.help.foldie')}
              caption={t('account.help.foldieCaption')}
              onPress={() => router.push('/concierge')}
            />
            {/* WhatsApp row hidden for now. */}
            <SupportRow
              icon={<Phone size={15} color={colors.brandSage} />}
              label={CONTACT.phone}
              caption={CONTACT.hours}
              onPress={() => Linking.openURL(`tel:${CONTACT.phone.replace(/\s/g, '')}`)}
            />
            <SupportRow
              icon={<Mail size={15} color={colors.brandSage} />}
              label={CONTACT.email}
              // The settings screen says this about the same address, so it is
              // one key rather than the same sentence written twice.
              caption={t('settings.about.email')}
              onPress={() => Linking.openURL(`mailto:${CONTACT.email}`)}
            />
            <SupportRow
              icon={<Star size={15} color={colors.brandSage} />}
              label={t('account.help.rate')}
              caption={t('account.help.rateCaption')}
              onPress={() =>
                Linking.openURL(
                  `mailto:${CONTACT.email}?subject=${encodeURIComponent(
                    t('account.help.feedbackSubject')
                  )}`
                )
              }
            />
          </Card>
        </View>

        {/* --------------------------------------------------------- session */}
        {isAuthenticated && (
          <View style={styles.section}>
            <Button
              label={t('account.signOut')}
              variant="danger"
              onPress={confirmSignOut}
              icon={<LogOut size={15} color={colors.statusError} />}
            />
          </View>
        )}

        <View style={styles.buildInfo}>
          <UserCog size={12} color={colors.textMuted} />
          <Text style={styles.buildText}>
            {/*
              Read from the manifest rather than typed in, which is also what the
              settings screen does — two build lines disagreeing about the version
              is worse than either of them being wrong.
            */}
            {t('account.build', {
              version: Constants.expoConfig?.version ?? '1.0.0',
              server: API_BASE_URL,
            })}
          </Text>
        </View>
      </ScrollView>

      {/* --------------------------------------------------------- sheets */}
      <NotificationsSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} />

      <AddressSheet
        visible={addressSheet.open}
        editing={addressSheet.editing}
        onClose={() => setAddressSheet({ open: false, editing: null })}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SupportRow({
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
      style={({ pressed }) => [styles.supportRow, pressed && { opacity: 0.78 }]}
    >
      <View style={styles.supportIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.supportLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.supportCaption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <ChevronRight size={14} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: colors.textCharcoal,
    letterSpacing: -0.5,
  },
  bell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgLinen,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brandGold,
    borderWidth: 1.5,
    borderColor: colors.bgLinen,
  },

  scroll: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  section: { marginTop: 28 },

  verifyCard: {
    gap: 10,
    backgroundColor: tints.gold08,
    borderColor: tints.gold35,
    marginBottom: 14,
  },
  verifyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyTitle: { fontSize: 13, fontWeight: '800', color: colors.textCharcoal },
  verifyBody: { fontSize: 10.5, color: colors.textSlate, lineHeight: 16 },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  profileName: { fontSize: 15, fontWeight: '800', color: colors.textCharcoal },
  profileContact: { fontSize: 10.5, color: colors.textSlate, marginTop: 2, lineHeight: 15 },

  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, gap: 3 },
  statValue: { fontSize: 14, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.3 },
  statLabel: {
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15 },
  addLabel: { fontSize: 12, fontWeight: '700', color: colors.brandSage },

  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 13,
  },
  addressIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  addressLabel: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  addressText: { fontSize: 10.5, color: colors.textSlate, marginTop: 2, lineHeight: 14.5 },
  addressActions: { flexDirection: 'row', alignItems: 'center', gap: 13 },

  supportRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  supportIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportLabel: { fontSize: 12, fontWeight: '700', color: colors.textCharcoal },
  supportCaption: { fontSize: 10, color: colors.textMuted, marginTop: 1 },

  buildInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 30,
  },
  buildText: { fontSize: 9, color: colors.textMuted },
});

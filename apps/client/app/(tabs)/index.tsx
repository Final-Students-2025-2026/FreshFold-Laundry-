/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  ArrowRight,
  Bell,
  Bot,
  ChevronRight,
  Clock,
  Mail,
  MapPin,
  Phone,
} from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CONTACT,
  CUSTOMER_SEGMENTS,
  HOW_IT_WORKS,
  SERVICES,
  SERVICE_CATEGORIES,
  WHY_CHOOSE_US,
  tierForPoints,
  type ClientService,
  type ServiceCategory,
} from '../../src/data/catalogue';
import { Icon } from '../../src/components/Icon';
import NotificationsSheet from '../../src/components/NotificationsSheet';
import { StageTimeline } from '../../src/components/StageTimeline';
import {
  Badge,
  Button,
  Card,
  ConnectionPill,
  IconButton,
  InitialsAvatar,
  SectionHeader,
} from '../../src/components/ui';
import { useClient } from '../../src/store/ClientStore';
import { useSession } from '../../src/store/SessionStore';
import { servicePriceLabel, useT, type TranslationKey } from '../../src/i18n';
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
 * Home.
 *
 * The website's landing page is a long scroll — hero, services, why us, how it
 * works, who it's for, testimonials, contact — and all of it is here, in the
 * same order, because that sequence is the sales argument. What is added on
 * top is the part a website cannot do well: the live strip for the order
 * currently in flight, pinned above the fold.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { account, isAuthenticated } = useSession();
  const { primaryBooking, activeBookings, unreadCount, online, probed, points, refresh } = useClient();
  const { t, locale, c } = useT();

  const [category, setCategory] = useState<ServiceCategory>('core');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const tier = useMemo(() => tierForPoints(points), [points]);

  const visibleServices = useMemo(
    () => SERVICES.filter((service) => service.category === category),
    [category]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  /**
   * Where a service card goes.
   *
   * Two of the eleven cannot be ordered — air drying comes with a wash, a
   * corporate contract is quoted case by case — so those open the concierge
   * instead of a booking form that would substitute a different service and put
   * a price on work nobody agreed to do.
   */
  const bookService = useCallback(
    (service?: ClientService) => {
      if (service && !service.bookable) {
        router.push('/concierge');
        return;
      }
      router.push({
        pathname: '/(tabs)/book',
        params: service ? { serviceId: service.id } : undefined,
      });
    },
    [router]
  );

  // Picked by the clock and then translated, rather than translated after the
  // fact, so a language can answer with `Maakye` where English says "Good
  // morning" instead of a rendering of the English words.
  const greeting = t(greetingKeyFor(new Date()));
  const firstName = account?.name?.split(/\s+/)[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandSage} />
        }
      >
        {/* ------------------------------------------------------ top bar */}
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>
              {/* The comma is in the string, because it is not where every
                  language puts it — and some would rather lead with the name. */}
              {firstName ? t('home.greetingNamed', { greeting, name: firstName }) : greeting}
            </Text>
            <View style={styles.topMeta}>
              <ConnectionPill online={online} pending={!probed} />
              {isAuthenticated && <Badge label={tier.cardName} tone="gold" />}
            </View>
          </View>

          <IconButton
            accessibilityLabel={t('account.notifications')}
            onPress={() => setNotificationsOpen(true)}
          >
            <Bell size={17} color={colors.textCharcoal} />
            {unreadCount > 0 && <View style={styles.bellDot} />}
          </IconButton>

          <Pressable onPress={() => router.push('/(tabs)/account')} hitSlop={6}>
            <InitialsAvatar name={account?.name ?? t('account.guestName')} size={38} />
          </Pressable>
        </View>

        {/* -------------------------------------------------- active order */}
        {primaryBooking ? (
          <Pressable
            onPress={() => router.push('/(tabs)/track')}
            style={({ pressed }) => [styles.liveCard, pressed && { opacity: 0.94 }]}
          >
            <View style={styles.liveHead}>
              <View style={styles.livePulse} />
              <Text style={styles.liveLabel}>{t('home.live.label')}</Text>
              <Text style={styles.liveRef}>{primaryBooking.id}</Text>
            </View>

            <Text style={styles.liveService} numberOfLines={1}>
              {primaryBooking.serviceType}
            </Text>

            <View style={{ marginTop: 12 }}>
              <StageTimeline
                stage={primaryBooking.status}
                dispatchStatus={primaryBooking.rider?.jobStatus}
                compact
              />
            </View>

            <View style={styles.liveFoot}>
              <Text style={styles.liveFootText}>
                {/*
                  The courier and the bike they are on. This line used to end
                  "· 12 min away", off a straight line to the door divided by an
                  assumed 18 km/h — and the timeline directly above already says
                  which stage the job is at, in the reader's own language.
                */}
                {primaryBooking.rider
                  ? t('home.live.courier', {
                      name: courierName(primaryBooking.rider, locale),
                      vehicle: courierVehicle(primaryBooking.rider, locale),
                    })
                  : t('home.live.assigning')}
              </Text>
              <View style={styles.liveCta}>
                <Text style={styles.liveCtaLabel}>{t('home.live.track')}</Text>
                <ArrowRight size={13} color={colors.brandSage} />
              </View>
            </View>

            {activeBookings.length > 1 && (
              // Two keys and the call site picks, rather than a plural rule. All
              // three languages split at exactly one, so `count === 1` is the whole
              // be English grammar imposed on dictionaries that cannot use it.
              <Text style={styles.liveMore}>
                {activeBookings.length === 2
                  ? t('home.live.moreOne')
                  : t('home.live.moreMany', { count: activeBookings.length - 1 })}
              </Text>
            )}
          </Pressable>
        ) : (
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>{t('home.hero.eyebrow')}</Text>
            {/* The line break moved into the string, so a translation breaks its
                own sentence where its own sentence divides. */}
            <Text style={styles.heroTitle}>{t('home.hero.title')}</Text>
            <Text style={styles.heroBody}>{t('home.hero.body')}</Text>
            <View style={styles.heroActions}>
              <Button
                label={t('common.schedulePickup')}
                onPress={() => bookService()}
                iconRight={<ArrowRight size={15} color="#FFFFFF" />}
                style={{ flex: 1 }}
              />
              <Button
                label={t('home.hero.plans')}
                variant="ghost"
                onPress={() => router.push('/plans')}
              />
            </View>
          </View>
        )}

        {/* ------------------------------------------------ quick actions */}
        <View style={styles.quickRow}>
          <QuickAction
            label={t('home.quick.book')}
            iconName="CalendarClock"
            onPress={() => bookService()}
          />
          <QuickAction
            label={t('home.quick.track')}
            iconName="Radar"
            onPress={() => router.push('/(tabs)/track')}
          />
          <QuickAction
            label={t('home.quick.wallet')}
            iconName="Wallet"
            onPress={() => router.push('/(tabs)/wallet')}
          />
          <QuickAction
            label={t('home.quick.foldie')}
            iconName="Sparkles"
            onPress={() => router.push('/concierge')}
          />
        </View>

        {/* ------------------------------------------------------ services */}
        <View style={styles.section}>
          <SectionHeader
            title={t('home.services.title')}
            caption={t('home.services.caption')}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {SERVICE_CATEGORIES.map((entry) => {
              const active = entry.id === category;
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => setCategory(entry.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {c(`category.${entry.id}.label`, entry.label)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.categoryBlurb}>
            {(() => {
              const entry = SERVICE_CATEGORIES.find((row) => row.id === category);
              return entry ? c(`category.${entry.id}.blurb`, entry.blurb) : null;
            })()}
          </Text>

          <View style={{ gap: 10, marginTop: 12 }}>
            {visibleServices.map((service) => (
              <Pressable
                key={service.id}
                onPress={() => bookService(service)}
                style={({ pressed }) => [styles.serviceCard, pressed && { opacity: 0.92 }]}
              >
                <Image source={{ uri: service.imageUrl }} style={styles.serviceImage} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.serviceName} numberOfLines={1}>
                    {service.name}
                  </Text>
                  <Text style={styles.serviceBody} numberOfLines={2}>
                    {c(`service.${service.id}.desc`, service.description)}
                  </Text>
                  <Text style={styles.servicePrice}>
                    {servicePriceLabel(t, c, locale, service)}
                  </Text>
                </View>
                <ChevronRight size={15} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* -------------------------------------------------- how it works */}
        <View style={styles.section}>
          <SectionHeader title={t('home.steps.title')} caption={t('home.steps.caption')} />
          <View style={{ gap: 9 }}>
            {HOW_IT_WORKS.map((step, index) => (
              <View key={step.id} style={styles.stepCard}>
                <View style={styles.stepIndex}>
                  <Text style={styles.stepIndexLabel}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{c(`step.${step.id}.title`, step.title)}</Text>
                  <Text style={styles.stepBody}>{c(`step.${step.id}.body`, step.body)}</Text>
                </View>
                <Icon name={step.iconName} size={17} color={colors.brandStone} />
              </View>
            ))}
          </View>
        </View>

        {/* ------------------------------------------------------- why us */}
        <View style={styles.section}>
          <SectionHeader title={t('home.why.title')} caption={t('home.why.caption')} />
          <View style={styles.grid}>
            {WHY_CHOOSE_US.map((reason) => (
              <Card key={reason.id} style={styles.gridCard}>
                <View style={styles.gridIcon}>
                  <Icon name={reason.iconName} size={16} color={colors.brandSage} />
                </View>
                <Text style={styles.gridTitle}>{c(`why.${reason.id}.title`, reason.title)}</Text>
                <Text style={styles.gridBody}>{c(`why.${reason.id}.body`, reason.body)}</Text>
              </Card>
            ))}
          </View>
        </View>

        {/* ----------------------------------------------------- segments */}
        <View style={styles.section}>
          <SectionHeader title={t('home.segments.title')} caption={t('home.segments.caption')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 20 }}
          >
            {CUSTOMER_SEGMENTS.map((segment) => (
              <Pressable
                key={segment.id}
                onPress={() =>
                  bookService(SERVICES.find((service) => service.id === segment.serviceId))
                }
                style={({ pressed }) => [styles.segmentCard, pressed && { opacity: 0.92 }]}
              >
                <View style={styles.segmentIcon}>
                  <Icon name={segment.iconName} size={17} color={colors.brandGold} />
                </View>
                <Text style={styles.segmentTitle}>
                  {c(`segment.${segment.id}.title`, segment.title)}
                </Text>
                <Text style={styles.segmentBody}>
                  {c(`segment.${segment.id}.body`, segment.body)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/*
          No testimonials section.

          What stood here was three invented customers — a creative director, a
          managing partner at a firm that does not exist, a luxury hotelier —
          each with five stars nobody awarded and a stock photograph of a real
          stranger used as their portrait. It had been translated into Spanish
          and French, which only meant the fiction existed in three languages.

          Removed rather than rewritten, because there is nothing to rewrite it
          from. When the shop has quotes from real customers who agreed to be
          quoted, this is where they go.
        */}

        {/* ------------------------------------------------------ contact */}
        <View style={styles.section}>
          <SectionHeader title={t('home.contact.title')} caption={t('home.contact.caption')} />
          <Card style={{ gap: 4 }}>
            <ContactRow
              icon={<Phone size={15} color={colors.brandSage} />}
              label={CONTACT.phone}
              caption={t('home.contact.phoneCaption')}
              onPress={() => Linking.openURL(`tel:${CONTACT.phone.replace(/\s/g, '')}`)}
            />
            {/* WhatsApp row hidden for now. */}
            <ContactRow
              icon={<Bot size={15} color={colors.brandSage} />}
              label={t('home.contact.foldie')}
              caption={t('home.contact.foldieCaption')}
              onPress={() => router.push('/concierge')}
            />
            <ContactRow
              icon={<Mail size={15} color={colors.brandSage} />}
              label={CONTACT.email}
              caption={t('home.contact.emailCaption')}
              onPress={() => Linking.openURL(`mailto:${CONTACT.email}`)}
            />
            <ContactRow
              icon={<MapPin size={15} color={colors.brandSage} />}
              label={CONTACT.address}
              caption={t('home.contact.addressCaption')}
            />
            <ContactRow
              icon={<Clock size={15} color={colors.brandSage} />}
              label={CONTACT.hours}
              caption={t('home.contact.hoursCaption')}
            />
          </Card>
        </View>

        <Text style={styles.footer}>{t('home.footer')}</Text>
      </ScrollView>

      <NotificationsSheet
        visible={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </SafeAreaView>
  );
}

function QuickAction({
  label,
  iconName,
  onPress,
}: {
  label: string;
  iconName: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.quickIcon}>
        <Icon name={iconName} size={17} color={colors.brandSage} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function ContactRow({
  icon,
  label,
  caption,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  caption: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.contactRow, pressed && onPress && { opacity: 0.75 }]}
    >
      <View style={styles.contactIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.contactCaption}>{caption}</Text>
      </View>
      {!!onPress && <ChevronRight size={14} color={colors.textMuted} />}
    </Pressable>
  );
}

/**
 * Which greeting the hour calls for.
 *
 * Returns the key rather than the words, so this stays a module-scope function
 * with no hook in it and the screen does the translating. The boundaries are the
 * English ones — noon and five — and a language that divides its day differently
 * would want those moved, not just the strings changed.
 */
function greetingKeyFor(now: Date): TranslationKey {
  const hour = now.getHours();
  if (hour < 12) return 'home.greeting.morning';
  if (hour < 17) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  scroll: { padding: 20, paddingBottom: 40, gap: 4 },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  greeting: { fontSize: 19, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.4 },
  topMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brandGold,
    borderWidth: 1.5,
    borderColor: colors.bgLinen,
  },

  hero: {
    backgroundColor: colors.textCharcoal,
    borderRadius: radius.xxl,
    padding: 22,
    gap: 8,
    ...shadow.md,
  },
  heroEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.brandGold,
  },
  heroTitle: {
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: '#FFFFFF',
    lineHeight: 31,
  },
  heroBody: { fontSize: 12.5, color: 'rgba(255,255,255,0.7)', lineHeight: 18 },
  heroActions: { flexDirection: 'row', gap: 9, marginTop: 8 },

  liveCard: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: tints.sage25,
    padding: 18,
    ...shadow.md,
  },
  liveHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  livePulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.statusSuccess },
  liveLabel: {
    flex: 1,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.statusSuccess,
  },
  liveRef: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8, color: colors.textMuted },
  liveService: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textCharcoal,
    marginTop: 8,
    letterSpacing: -0.3,
  },
  liveFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  liveFootText: { flex: 1, fontSize: 11, fontWeight: '600', color: colors.textSlate },
  liveCta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveCtaLabel: { fontSize: 11, fontWeight: '800', color: colors.brandSage },
  liveMore: { fontSize: 10, color: colors.textMuted, marginTop: 8 },

  quickRow: { flexDirection: 'row', gap: 9, marginTop: 16 },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: radius.lg,
    backgroundColor: colors.cardPure,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    ...shadow.xs,
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { fontSize: 10, fontWeight: '700', color: colors.textCharcoal },

  section: { marginTop: 30 },

  chipRow: { gap: 7, paddingRight: 20 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.bgLinen,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  chipActive: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  chipLabel: { fontSize: 11, fontWeight: '700', color: colors.textSlate },
  chipLabelActive: { color: '#FFFFFF' },
  categoryBlurb: { fontSize: 11, color: colors.textMuted, marginTop: 10 },

  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardPure,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 11,
    ...shadow.xs,
  },
  serviceImage: { width: 58, height: 58, borderRadius: radius.md, backgroundColor: colors.bgSand },
  serviceName: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  serviceBody: { fontSize: 10.5, color: colors.textSlate, lineHeight: 14.5 },
  servicePrice: { fontSize: 10.5, fontWeight: '800', color: colors.brandSage, marginTop: 1 },

  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 13,
  },
  stepIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: tints.sage12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndexLabel: { fontSize: 11, fontWeight: '800', color: colors.brandSage },
  stepTitle: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  stepBody: { fontSize: 10.5, color: colors.textSlate, marginTop: 2, lineHeight: 14.5 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCard: { width: '48%', gap: 6, padding: 14 },
  gridIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTitle: { fontSize: 12, fontWeight: '800', color: colors.textCharcoal, marginTop: 2 },
  gridBody: { fontSize: 10.5, color: colors.textSlate, lineHeight: 14.5 },

  segmentCard: {
    width: 190,
    gap: 6,
    padding: 15,
    borderRadius: radius.xl,
    backgroundColor: colors.cardPure,
    borderWidth: 1,
    borderColor: tints.gold35,
    ...shadow.xs,
  },
  segmentIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: tints.gold08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTitle: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal, marginTop: 2 },
  segmentBody: { fontSize: 10.5, color: colors.textSlate, lineHeight: 14.5 },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  contactIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: { fontSize: 12, fontWeight: '700', color: colors.textCharcoal },
  contactCaption: { fontSize: 10, color: colors.textMuted, marginTop: 1 },

  footer: {
    fontSize: 9.5,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 34,
    lineHeight: 15,
  },
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  Camera,
  Check,
  ChevronRight,
  Layers,
  MessageSquare,
  PenLine,
  Phone,
  QrCode,
  Receipt,
  RefreshCcw,
  Star,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiError,
  bagsForJob,
  canReschedule,
  checkCancel,
  serviceUnit,
  type Job,
  type JobStatus,
} from '@freshfold/core';

/**
 * Dispatch states in which the bags are still with the customer. `unassigned`
 * is included so the code is visible from the moment the booking exists —
 * customers look for it before a courier is even allocated.
 */
const COLLECTION_PENDING = new Set<JobStatus>([
  'unassigned',
  'assigned',
  'navigating_to_pickup',
  'arrived_at_pickup',
]);
import { CONTACT } from '../../src/data/catalogue';
import BagScanner from '../../src/components/BagScanner';
import DeliveryConfirm from '../../src/components/DeliveryConfirm';
import HandoffCard from '../../src/components/HandoffCard';
import IssueReporter from '../../src/components/IssueReporter';
import RescheduleSheet from '../../src/components/RescheduleSheet';
import { StageTimeline } from '../../src/components/StageTimeline';
import TrackingMap from '../../src/components/TrackingMap';
import { paymentTone } from '../../src/components/OrderCard';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  SectionLabel,
  Sheet,
} from '../../src/components/ui';
import { useClient } from '../../src/store/ClientStore';
import type { TranslationKey } from '../../src/i18n';
import {
  jobStatusLabel,
  paymentStatusLabel,
  stageLabel,
  describeOrder,
  unitLabel,
  useT,
} from '../../src/i18n';
import {
  colors,
  courierName,
  courierVehicle,
  formatCedis,
  formatDate,
  radius,
  shadow,
  tints,
} from '../../src/theme';

/**
 * One order, in full.
 *
 * Everything the client portal's detail view shows — stages, manifest,
 * finishing choices, proof of service, receipt — plus the three capabilities
 * lifted from the rider console: scan the bags, photograph a problem, sign at
 * the door.
 *
 * The `action` param lets the Track tab and a notification deep-link straight
 * into one of those sheets.
 */
export default function OrderDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; action?: string }>();
  const { t, locale } = useT();
  const {
    bookingById,
    loadBookingProof,
    verifiedBags,
    verifyBags,
    confirmDelivery,
    reportIssue,
    cancelBooking,
    rateBooking,
    rescheduleBooking,
    claims,
    loadClaims,
    messagesFor,
  } = useClient();

  const [sheet, setSheet] = useState<
    'scan' | 'issue' | 'sign' | 'receipt' | 'reschedule' | null
  >(null);

  const booking = bookingById(params.id);

  // This screen is the only one that shows the proof photographs, so it is the
  // one that pays for them. The polled list carries everything else.
  useEffect(() => {
    if (params.id) void loadBookingProof(params.id);
  }, [params.id, loadBookingProof]);

  // And the problems they have reported, which are not on the booking either —
  // a claim outlives the order it is about.
  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  // A deep link opens its sheet once the record is in the mirror.
  useEffect(() => {
    if (!booking || !params.action) return;
    if (params.action === 'scan' || params.action === 'issue' || params.action === 'sign') {
      setSheet(params.action);
    }
  }, [booking, params.action]);

  /**
   * The bag manifest.
   *
   * `Booking` is the customer projection and deliberately carries no dispatch
   * detail, so the bags are re-derived here with the very function the server
   * used to create them. It is deterministic on `(id, amount, serviceType)`,
   * which means these are the same codes printed on the same bags — no extra
   * endpoint, and no chance of the two lists disagreeing.
   */
  const bags = useMemo(
    () =>
      booking
        ? bagsForJob(booking.id, booking, booking.serviceType)
        : [],
    [booking]
  );

  const verified = booking ? (verifiedBags[booking.id] ?? []) : [];
  const thread = booking ? messagesFor(booking.id) : [];

  /** Whatever was actually captured at the two handovers, in the order it happened. */
  const proofShots = useMemo(() => {
    const proof = booking?.proof;
    if (!proof) return [];

    const shots: { label: string; uri?: string }[] = [
      { label: t('order.proof.pickupPhoto'), uri: proof.pickupPhoto },
      { label: t('order.proof.pickupSignature'), uri: proof.pickupSignature },
      { label: t('order.proof.deliveryPhoto'), uri: proof.deliveryPhoto },
      { label: t('order.proof.deliverySignature'), uri: proof.deliverySignature },
    ];

    return shots.filter((shot): shot is { label: string; uri: string } => !!shot.uri);
    // `t` is memoised on the locale, so this re-runs when the language changes
    // and not on every render.
  }, [booking?.proof, t]);

  const atTheDoor = booking?.rider?.jobStatus === 'arrived_at_delivery';
  const closed = booking?.status === 'Delivered' || booking?.status === 'Cancelled';

  /**
   * What the customer thought of the courier.
   *
   * `null` until they have pressed a star or we have loaded one they left
   * earlier — the row only appears on a delivered order with a courier on it,
   * which is the same pair of conditions the server checks.
   */
  const [stars, setStars] = useState<number | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingDone, setRatingDone] = useState(false);

  const rateable = booking?.status === 'Delivered' && !!booking?.rider?.id;

  const rate = useCallback(
    async (value: number) => {
      if (!booking || ratingBusy) return;

      // Optimistic: the star fills under the thumb. A failure puts it back
      // rather than leaving a rating on screen that was never recorded.
      const previous = stars;
      setStars(value);
      setRatingBusy(true);

      try {
        await rateBooking(booking.id, value);
        setRatingDone(true);
      } catch {
        setStars(previous);
      } finally {
        setRatingBusy(false);
      }
    },
    [booking, stars, ratingBusy, rateBooking]
  );

  /** Before the courier has taken the bags — the window the code is for. */
  const awaitingCollection =
    !closed &&
    !!booking &&
    COLLECTION_PENDING.has(booking.rider?.jobStatus ?? 'unassigned');

  /**
   * Whether this order can still be moved, and why not when it cannot.
   *
   * The same `canReschedule` the server runs, so the button appears exactly
   * when the route would accept the request. It reads dispatch state, which
   * `Booking` does not carry — the projection is deliberately free of it — so
   * the live status off the rider telemetry is folded onto a stand-in job.
   * `unassigned` when there is no telemetry, which is what a booking nobody has
   * accepted is.
   */
  const movable = useMemo(() => {
    if (!booking) return null;

    return canReschedule({
      status:
        booking.status === 'Cancelled'
          ? 'cancelled'
          : (booking.rider?.jobStatus ?? 'unassigned'),
      schedule: {
        pickupDate: booking.pickupDate,
        pickupTime: booking.pickupTime,
        deliveryDate: booking.deliveryDate,
        deliveryTime: booking.deliveryTime,
        rescheduleCount: booking.rescheduleCount,
      },
    } as Job);
  }, [booking]);

  /**
   * Whether this order can still be called off, and why not when it cannot.
   *
   * The same `checkCancel` the route runs, read off the same live dispatch
   * status `movable` uses. The button used to be unconditional and the write
   * behind it silently did nothing on a collected order — which read to the
   * customer as a cancellation that un-cancelled itself a few seconds later.
   */
  const cancellable = useMemo(() => {
    if (!booking) return null;

    return checkCancel(
      booking.status === 'Cancelled'
        ? 'cancelled'
        : (booking.rider?.jobStatus ?? 'unassigned')
    );
  }, [booking]);

  /** The problems reported against this order. */
  const mine = useMemo(
    () => claims.filter((claim) => claim.jobId === params.id),
    [claims, params.id]
  );

  const onCancel = useCallback(() => {
    if (!booking) return;

    Alert.alert(
      t('order.cancel.title'),
      t('order.cancel.body'),
      [
        { text: t('order.cancel.keep'), style: 'cancel' },
        {
          text: t('order.cancel.confirm'),
          style: 'destructive',
          /**
           * Awaited, and the screen only closes once the server has agreed.
           *
           * This used to fire and navigate away in the same breath, which was
           * survivable while the write silently did nothing and unforgivable now
           * that it can be refused: a courier who collected the bags a minute ago
           * makes this a 409, and the customer has to be standing in front of the
           * order to be told so.
           */
          onPress: () => {
            void (async () => {
              try {
                await cancelBooking(booking.id);
                router.back();
              } catch (failure) {
                // The server's own sentence when it wrote one — it knows whether
                // the bags are on a courier or the order is already delivered,
                // and either is more use than "that did not work".
                Alert.alert(
                  t('order.cancel.title'),
                  failure instanceof ApiError && failure.message
                    ? failure.message
                    : t('order.cancel.failed')
                );
              }
            })();
          },
        },
      ]
    );
  }, [booking, cancelBooking, router, t]);

  if (!booking) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title={t('order.title')} onBack={() => router.back()} />
        <View style={{ padding: 20 }}>
          <EmptyState
            title={t('order.missing.title')}
            body={t('order.missing.body')}
            action={t('common.back')}
            onAction={() => router.back()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        title={booking.id}
        subtitle={describeOrder(t, booking)}
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* --------------------------------------------------------- status */}
        <Card style={{ gap: 12 }}>
          <View style={styles.statusHead}>
            <Badge
              label={stageLabel(t, booking.status)}
              tone={
                booking.status === 'Delivered'
                  ? 'success'
                  : booking.status === 'Cancelled'
                    ? 'error'
                    : 'sage'
              }
            />
            {/* An order with no payment state recorded is one nobody has paid
                for, which is what `Pending` says — the same assumption
                `paymentTone` beside it already makes. */}
            <Badge
              label={paymentStatusLabel(t, booking.paymentStatus ?? 'Pending')}
              tone={paymentTone(booking)}
            />
            <Text style={styles.amount}>{formatCedis(booking.amount ?? 0, locale)}</Text>
          </View>

          <StageTimeline stage={booking.status} dispatchStatus={booking.rider?.jobStatus} />
        </Card>

        {/* ------------------------------------------------------------ map */}
        {!closed && <TrackingMap booking={booking} />}

        {/* Only until the bags are actually collected — after that the code
            has done its job and leaving it on screen just invites confusion
            with the delivery hand-off. */}
        {awaitingCollection && <HandoffCard booking={booking} />}

        {/* -------------------------------------------------------- actions */}
        {!closed && (
          <View>
            <SectionLabel>{t('order.section.actions')}</SectionLabel>
            <View style={{ gap: 9, marginTop: 10 }}>
              {atTheDoor && (
                <ActionRow
                  icon={<PenLine size={16} color={colors.brandSage} />}
                  title={t('order.sign.title')}
                  /*
                    Readable, because the whole point is that the customer
                    reads it out. It used to be masked to `••••`, which left
                    the one person who is supposed to hold the code unable to
                    see it — and the courier's app carrying it instead.
                  */
                  caption={
                    booking.deliveryOtp
                      ? t('order.sign.captionCode', { code: booking.deliveryOtp })
                      : t('order.sign.caption')
                  }
                  onPress={() => setSheet('sign')}
                  emphasis
                />
              )}
              <ActionRow
                icon={<QrCode size={16} color={colors.brandSage} />}
                title={t('order.scan.title')}
                caption={
                  // Two keys and a branch rather than a plural rule: the
                  // singular is its own string, so a language that says it
                  // differently can.
                  verified.length > 0
                    ? t('order.scan.checked', { count: verified.length, total: bags.length })
                    : bags.length === 1
                      ? t('order.scan.bagsOne')
                      : t('order.scan.bagsMany', { count: bags.length })
                }
                onPress={() => setSheet('scan')}
              />
              <ActionRow
                icon={<Camera size={16} color={colors.brandSage} />}
                // The control that opens the issue reporter, labelled the same
                // way as the tile that opens it from the track tab.
                title={t('track.action.issue')}
                caption={t('order.issue.caption')}
                onPress={() => setSheet('issue')}
              />
              <ActionRow
                icon={<MessageSquare size={16} color={colors.brandSage} />}
                title={t('track.action.chat')}
                caption={
                  thread.length === 1
                    ? t('track.action.chatOne')
                    : thread.length > 1
                      ? t('track.action.chatMany', { count: thread.length })
                      : t('order.chat.caption')
                }
                onPress={() => router.push({ pathname: '/chat', params: { id: booking.id } })}
              />
              {/*
                This said "Call {courier}" and dialled `booking.phone` — the
                customer's own number, so tapping it rang the phone in their
                hand. Couriers ride on their own handsets and their numbers are
                not the customer's to have, so the courier is reachable through
                the message thread above and the desk is reachable by phone.
              */}
              {!!booking.rider && (
                <ActionRow
                  icon={<Phone size={16} color={colors.brandSage} />}
                  title={t('order.call.title')}
                  caption={t('order.call.caption', {
                    name: courierName(booking.rider, locale),
                    vehicle: courierVehicle(booking.rider, locale),
                  })}
                  onPress={() =>
                    Linking.openURL(`tel:${CONTACT.phone.replace(/\s/g, '')}`)
                  }
                />
              )}
            </View>
          </View>
        )}

        {/* -------------------------------------------------------- manifest */}
        <Card style={{ gap: 11 }}>
          <View style={styles.cardHead}>
            <SectionLabel>{t('order.section.manifest')}</SectionLabel>
            <Text style={styles.cardHeadMeta}>
              {t('order.manifest.verified', { count: verified.length, total: bags.length })}
            </Text>
          </View>

          {bags.map((bag) => {
            const isVerified = verified.includes(bag.qrCode);
            return (
              <View key={bag.id} style={styles.bagRow}>
                <View style={[styles.bagIcon, isVerified && { backgroundColor: tints.success10 }]}>
                  <Layers
                    size={13}
                    color={isVerified ? colors.statusSuccess : colors.textSlate}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bagType} numberOfLines={1}>
                    {bag.type}
                  </Text>
                  {/* The bag's type and code are dispatch data, printed on the
                      bag itself. Only the frame around them is copy.

                      The count and the weight are only here once somebody at
                      the hub has taken them. Both used to be printed on every
                      bag from the moment of booking, derived from the digits of
                      the reference number — so this row showed a customer a
                      measurement of their laundry before anyone had touched it. */}
                  <Text style={styles.bagMeta}>
                    {bag.itemCount === undefined
                      ? t('order.bag.uncounted', { code: bag.qrCode })
                      : bag.weight
                        ? t('order.bag.meta', {
                            code: bag.qrCode,
                            items: bag.itemCount,
                            weight: bag.weight,
                          })
                        : t('order.bag.metaNoWeight', {
                            code: bag.qrCode,
                            items: bag.itemCount,
                          })}
                  </Text>
                </View>
                {isVerified && <Check size={14} color={colors.statusSuccess} strokeWidth={3} />}
              </View>
            );
          })}
        </Card>

        {/* ---------------------------------------------------------- detail */}
        <Card style={{ gap: 10 }}>
          <SectionLabel>{t('order.section.details')}</SectionLabel>
          {/* Four of these labels are the booking flow's own and one is the
              track tab's — the same field labelled the same way, so the same
              key. The service name, the plan id and the add-on names are
              catalogue data and are rendered as they arrive. */}
          <Row label={t('book.summary.service')} value={describeOrder(t, booking)} />
          <Row
            label={t('book.done.collection')}
            value={t('track.row.collectionValue', {
              date: formatDate(booking.pickupDate, locale),
              time: booking.pickupTime,
            })}
          />
          <Row
            label={t('book.done.return')}
            value={
              // The window when there is one. Records written before customers
              // could choose a return window genuinely have no hour to show, so
              // those keep the date alone rather than gaining an invented one.
              booking.deliveryTime
                ? t('track.row.collectionValue', {
                    date: formatDate(booking.deliveryDate, locale),
                    time: booking.deliveryTime,
                  })
                : formatDate(booking.deliveryDate, locale)
            }
          />
          <Row
            label={t('book.summary.address')}
            value={[booking.address, booking.suburb, booking.city].filter(Boolean).join(', ')}
          />
          {/* Only when there is more than one — "1 load" on every single-unit
              order is a row that says nothing. */}
          {(booking.quantity ?? 1) > 1 && (
            <Row
              label={t('order.row.quantity')}
              value={`${booking.quantity} ${unitLabel(t, serviceUnit(booking.serviceType), booking.quantity ?? 1)}`}
            />
          )}
          <Row label={t('order.row.booked')} value={formatDate(booking.createdAt, locale)} />
          {!!booking.planId && <Row label={t('order.row.plan')} value={booking.planId} />}
          {!!booking.specialInstructions && (
            <Row label={t('order.row.care')} value={booking.specialInstructions} />
          )}
          {!!booking.specialtyAddons?.length && (
            <Row label={t('book.summary.addons')} value={booking.specialtyAddons.join(', ')} />
          )}
          {!!booking.riderNote && (
            <Row label={t('order.row.courierNote')} value={booking.riderNote} />
          )}
          {!!booking.rider && (
            <Row
              label={t('order.row.courier')}
              value={t('order.row.courierValue', {
                name: courierName(booking.rider, locale),
                status: jobStatusLabel(t, booking.rider.jobStatus),
              })}
            />
          )}
        </Card>

        {/* ----------------------------------------------------------- proof */}
        {proofShots.length > 0 && (
          <Card style={{ gap: 10 }}>
            <SectionLabel>{t('order.section.proof')}</SectionLabel>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 9 }}
            >
              {proofShots.map((shot) => (
                <View key={shot.label} style={{ gap: 5 }}>
                  {/* A signature saved as a raw path — the fallback when the pad
                      could not rasterise — is a string, not an image source. */}
                  {shot.uri.startsWith('freshfold-signature:') ? (
                    <View style={[styles.proofImage, styles.proofVector]}>
                      <PenLine size={18} color={colors.brandStone} />
                      <Text style={styles.proofVectorLabel}>{t('order.proof.vector')}</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: shot.uri }} style={styles.proofImage} />
                  )}
                  <Text style={styles.proofCaption}>{shot.label}</Text>
                </View>
              ))}
            </ScrollView>
          </Card>
        )}

        {/*
          How the delivery went. Only on a delivered order with a courier
          recorded — the two things the server also insists on, so the row is
          never offered where it would be refused.

          Stars alone, with no comment box. The overwhelming majority of ratings
          anywhere are a tap and nothing more, and a text field would make this
          look like a form to fill in rather than a question to answer. A
          customer with something to say has the issue reporter above, which
          reaches the same desk and carries a photograph.
        */}
        {rateable && (
          <View style={{ gap: 9 }}>
            <SectionLabel>{t('order.rate.title')}</SectionLabel>
            <Card style={{ gap: 10 }}>
              <Text style={styles.rateCaption}>
                {ratingDone
                  ? t('order.rate.thanks')
                  : t('order.rate.prompt', { name: courierName(booking.rider) })}
              </Text>

              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => void rate(value)}
                    disabled={ratingBusy}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('order.rate.star', { count: value })}
                    style={styles.star}
                  >
                    <Star
                      size={26}
                      color={colors.brandGold}
                      fill={stars !== null && value <= stars ? colors.brandGold : 'transparent'}
                    />
                  </Pressable>
                ))}
              </View>
            </Card>
          </View>
        )}

        {/* ---------------------------------------------------------- claims */}
        {/*
          What became of a problem they reported.
          
          Before this, `IssueReporter` filed the report into the courier thread
          and stopped — so a customer who photographed a ruined shirt had no way
          of knowing whether anybody had looked at it, and the care copy's
          promise to re-treat "at our cost" had nothing behind it. The row says
          where the claim has got to and, once it is settled, what was done.
        */}
        {mine.length > 0 && (
          <Card style={{ gap: 10 }}>
            <SectionLabel>{t('order.claims.title')}</SectionLabel>
            {mine.map((claim) => (
              <View key={claim.id} style={styles.claimRow}>
                <Badge
                  label={t(`order.claims.status.${claim.status}` as TranslationKey)}
                  tone={
                    claim.status === 'resolved'
                      ? 'success'
                      : claim.status === 'rejected'
                        ? 'error'
                        : claim.status === 'upheld'
                          ? 'sage'
                          : 'warning'
                  }
                />
                <Text style={styles.claimText}>{claim.description}</Text>
                {!!claim.resolution && (
                  <Text style={styles.claimAnswer}>{claim.resolution}</Text>
                )}
                {claim.compensation > 0 && (
                  <Text style={styles.claimAnswer}>
                    {t('order.claims.credited', {
                      amount: formatCedis(claim.compensation, locale),
                    })}
                  </Text>
                )}
                {claim.retreatment && (
                  <Text style={styles.claimAnswer}>{t('order.claims.retreatment')}</Text>
                )}
              </View>
            ))}
          </Card>
        )}

        {/* --------------------------------------------------------- closing */}
        <View style={{ gap: 9 }}>
          <Button
            label={t('order.receipt.open')}
            variant="ghost"
            onPress={() => setSheet('receipt')}
            icon={<Receipt size={15} color={colors.textCharcoal} />}
          />
          {closed ? (
            <Button
              label={t('order.again')}
              onPress={() =>
                router.push({ pathname: '/(tabs)/book', params: { serviceId: booking.serviceType } })
              }
              icon={<RefreshCcw size={15} color="#FFFFFF" />}
            />
          ) : (
            <>
              {/* Offered only while the rules would accept it. A button that
                  opens a sheet whose every option the server refuses is worse
                  than no button — see `canReschedule`. */}
              {movable?.ok && (
                <Button
                  label={t('order.reschedule.action')}
                  variant="ghost"
                  onPress={() => setSheet('reschedule')}
                  icon={<CalendarClock size={15} color={colors.textCharcoal} />}
                />
              )}
              {/* Offered on the same rule as the reschedule button above, and
                  for the same reason: once the bags are on the courier the
                  route refuses this, and a button whose only outcome is a
                  refusal is worse than no button. The desk can still call it
                  off — which is what the refusal says. */}
              {cancellable?.ok && (
                <Button
                  label={t('order.cancel.action')}
                  variant="danger"
                  onPress={onCancel}
                  icon={<Ban size={15} color={colors.statusError} />}
                />
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* ---------------------------------------------------------- sheets */}
      <Sheet visible={sheet === 'scan'} onClose={() => setSheet(null)}>
        <BagScanner
          bags={bags}
          reference={booking.id}
          onCancel={() => setSheet(null)}
          onConfirm={(scanned) => {
            verifyBags(booking.id, scanned);
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'issue'} onClose={() => setSheet(null)}>
        <IssueReporter
          onCancel={() => setSheet(null)}
          onSubmit={(note, photoUri, kind) => {
            reportIssue(booking.id, note, photoUri, kind);
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'sign'} onClose={() => setSheet(null)}>
        <DeliveryConfirm
          customerName={booking.name}
          bagCount={bags.length}
          deliveryCode={booking.deliveryOtp}
          onCancel={() => setSheet(null)}
          onConfirm={async (signature, code) => {
            const ok = await confirmDelivery(booking.id, signature, code);
            if (ok) setSheet(null);
            return ok;
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'reschedule'} onClose={() => setSheet(null)}>
        <RescheduleSheet
          booking={booking}
          onCancel={() => setSheet(null)}
          onConfirm={async (change) => {
            // Rethrows on failure so the sheet stays open holding the server's
            // sentence — a window that filled while they were choosing is
            // something the customer has to see and act on.
            await rescheduleBooking(booking.id, change);
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'receipt'} onClose={() => setSheet(null)}>
        <View style={styles.receipt}>
          {/* The company's name, not a string in any language. */}
          <Text style={styles.receiptTitle}>FreshFold Laundry Co.</Text>
          <Text style={styles.receiptRef}>{booking.id}</Text>
          <Divider style={{ marginVertical: 12 }} />

          <Row label={t('book.summary.service')} value={describeOrder(t, booking)} />
          <Row label={t('order.receipt.collected')} value={formatDate(booking.pickupDate, locale)} />
          <Row label={t('order.receipt.returned')} value={formatDate(booking.deliveryDate, locale)} />
          {/* The method is a free-form string the server writes and is rendered
              as it arrives; the status beside it is a closed union, so it is
              translated. `Row` supplies the blank when there is no method. */}
          <Row label={t('order.receipt.method')} value={booking.paymentMethod ?? ''} />
          <Row
            label={t('order.receipt.status')}
            value={paymentStatusLabel(t, booking.paymentStatus ?? 'Pending')}
          />
          {!!booking.transactionRef && (
            <Row label={t('order.receipt.reference')} value={booking.transactionRef} />
          )}

          <Divider style={{ marginVertical: 12 }} />
          <Row
            label={t('book.summary.total')}
            value={formatCedis(booking.amount ?? 0, locale)}
            emphasis
          />

          <Button
            label={t('common.close')}
            variant="ghost"
            onPress={() => setSheet(null)}
            style={{ marginTop: 18 }}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function Header({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.headerButton}>
        <ArrowLeft size={17} color={colors.textCharcoal} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {!!subtitle && (
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

function ActionRow({
  icon,
  title,
  caption,
  onPress,
  emphasis,
}: {
  icon: React.ReactNode;
  title: string;
  caption: string;
  onPress: () => void;
  emphasis?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        emphasis && styles.actionRowEmphasis,
        pressed && { opacity: 0.87 },
      ]}
    >
      <View style={[styles.actionIcon, emphasis && { backgroundColor: colors.cardPure }]}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionCaption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <ChevronRight size={15} color={colors.textMuted} />
    </Pressable>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  const { t } = useT();

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueStrong]}>
        {value || t('common.blank')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  claimRow: { gap: 5, alignItems: 'flex-start' },
  claimText: { fontSize: 12.5, lineHeight: 18, color: colors.textCharcoal },
  claimAnswer: { fontSize: 11.5, lineHeight: 17, color: colors.textSlate },

  container: { flex: 1, backgroundColor: colors.bgIvory },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: colors.textCharcoal,
  },
  headerSub: { fontSize: 10.5, color: colors.textSlate, marginTop: 2 },

  scroll: { padding: 20, paddingTop: 4, paddingBottom: 40, gap: 14 },

  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rateCaption: { fontSize: 12, color: colors.textSlate, lineHeight: 16.5 },
  starRow: { flexDirection: 'row', gap: 6 },
  // 40pt of tappable area around a 26pt glyph: this is tapped once, in a hurry,
  // and a star that misses is a rating that never happens.
  star: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  amount: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '800', color: colors.textCharcoal },

  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeadMeta: { fontSize: 10, color: colors.textMuted },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
    ...shadow.xs,
  },
  actionRowEmphasis: { borderColor: tints.sage40, backgroundColor: tints.sage08 },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { fontSize: 12.5, fontWeight: '800', color: colors.textCharcoal },
  actionCaption: { fontSize: 10.5, color: colors.textSlate, marginTop: 2 },

  bagRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  bagIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    backgroundColor: tints.stone35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bagType: { fontSize: 12, fontWeight: '700', color: colors.textCharcoal },
  bagMeta: { fontSize: 9.5, color: colors.textMuted, marginTop: 2 },

  proofImage: { width: 128, height: 96, borderRadius: radius.md, backgroundColor: colors.bgSand },
  proofVector: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brandStone,
  },
  proofVectorLabel: { fontSize: 9, color: colors.textMuted },
  proofCaption: { fontSize: 9.5, color: colors.textSlate, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { width: 88, fontSize: 10.5, color: colors.textMuted },
  rowValue: { flex: 1, fontSize: 11.5, color: colors.textCharcoal, textAlign: 'right', lineHeight: 16 },
  rowValueStrong: { fontSize: 16, fontWeight: '800' },

  receipt: { padding: 24, paddingTop: 12, gap: 9 },
  receiptTitle: { fontSize: 16, fontWeight: '800', color: colors.textCharcoal, textAlign: 'center' },
  receiptRef: {
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
});

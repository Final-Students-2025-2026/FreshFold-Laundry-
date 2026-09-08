/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import {
  Bell,
  Camera as CameraIcon,
  CheckCircle2,
  IdCard,
  MapPin,
  MessageSquare,
  QrCode,
  ScanLine,
  Sparkles,
  UserCheck,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CameraCapture from '../../src/components/CameraCapture';
import CustomerStage from '../../src/components/CustomerStage';
import DropoffVerify from '../../src/components/DropoffVerify';
import HandoffVerify from '../../src/components/HandoffVerify';
import { KeyboardAvoider } from '../../src/components/KeyboardAvoider';
import LiveMap from '../../src/components/LiveMap';
import NotificationsSheet from '../../src/components/NotificationsSheet';
import QRScanner from '../../src/components/QRScanner';
import SignaturePad from '../../src/components/SignaturePad';
import {
  Avatar,
  Badge,
  Button,
  CodeInput,
  ConnectionPill,
  Input,
  LinkButton,
  Notice,
  StatTile,
} from '../../src/components/ui';
import { toBookingStatus } from '@freshfold/core';
import { useApp } from '../../src/store/AppStore';
import { colors, formatCedis, humanizeStatus, ink, radius, shadow, text, tints, touch } from '../../src/theme';

type ActiveModal =
  | 'handoff'
  | 'dropoff'
  | 'scanner'
  | 'pickup-camera'
  | 'delivery-camera'
  | 'signature'
  | null;

/** Avatar (40) + vertical padding (6 × 2) + border (1 × 2). */
const IDENTITY_CHIP_HEIGHT = 54;

export default function HomeScreen() {
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const {
    rider,
    orders,
    notifications,
    myOrders,
    activeOrder,
    focusedOrderId,
    focusOrder,
    canTakeMore,
    backlogOrders,
    connected,
    locationDenied,
    arrivalAutoConfirms,
    profileComplete,
    unreadCount,
    navigationTarget,
    arriveAtDestination,
    completeDelivery,
    completeDropoff,
    updateRider,
    acceptOrder,
    updateOrderStatus,
    sendRiderMessage,
    markNotificationRead,
  } = useApp();

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  /** Order whose collection code this courier has checked, this session. */
  const [handoffVerifiedFor, setHandoffVerifiedFor] = useState<string | null>(null);
  /**
   * Order whose bags this courier has counted off at the hub, this session.
   *
   * Local on purpose. The manifest check is the courier satisfying themselves
   * that what came off the bike is what went on it; the transition itself is
   * the hub's code, and that is dispatch's call, not this flag's.
   */
  const [dropoffBagsCheckedFor, setDropoffBagsCheckedFor] = useState<string | null>(null);

  // Delivery hand-off gate. The code is never on this device — it is typed
  // from what the customer says and checked by the server, so what is held
  // here is the attempt and whatever dispatch said about it.
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');
  const [handoverBusy, setHandoverBusy] = useState(false);
  /** True once the courier has said they cannot get a code at all. */
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // Offers the rider waved away this session.
  const [dismissedOfferIds, setDismissedOfferIds] = useState<string[]>([]);

  // A fresh order starts its gates closed again.
  useEffect(() => {
    setOtpInput('');
    setOtpError('');
    setOverrideMode(false);
    setOverrideReason('');
    setDropoffBagsCheckedFor(null);
  }, [activeOrder?.id]);

  /**
   * Enough to attempt the handover: four digits from the customer, or a
   * written reason for not having them. Whether the digits are *right* is
   * dispatch's call, not this console's.
   */
  const handoverReady = overrideMode ? overrideReason.trim().length >= 8 : otpInput.length === 4;

  /**
   * The next job worth putting in front of the courier.
   *
   * Gated on `canTakeMore` rather than on having no job at all: a round trip
   * parks a job at the hub for as long as the washing takes, and a courier
   * standing idle through that was capacity this console used to throw away.
   * What still blocks an offer is being mid-leg — on the road or at a door.
   */
  const offer = useMemo(
    () =>
      rider.isOnline && canTakeMore
        ? backlogOrders.find((o) => !dismissedOfferIds.includes(o.id))
        : undefined,
    [rider.isOnline, canTakeMore, backlogOrders, dismissedOfferIds]
  );

  /**
   * Whether the courier may proceed to the bags.
   *
   * A job carrying no `pickupOtp` predates this check — anything already in
   * the ledger before collection codes existed. Those are let through rather
   * than stranded at a gate they can never satisfy.
   */
  const handoffCleared =
    !activeOrder?.pickupOtp || handoffVerifiedFor === activeOrder?.id;

  const handleQrVerified = () => {
    if (!activeOrder) return;
    setActiveModal(null);

    if (activeOrder.status === 'arrived_at_pickup') {
      updateOrderStatus(activeOrder.id, 'pickup_scanned');
    } else if (activeOrder.status === 'arrived_at_laundry') {
      // Counting the bags off no longer moves the job. It used to, which meant
      // the middle hand-off completed on nothing but a manifest this phone had
      // generated for itself — the hub's code is what checks the load in now.
      setDropoffBagsCheckedFor(activeOrder.id);
    }
  };

  const handlePhotoCaptured = (uri: string) => {
    if (!activeOrder) return;
    setActiveModal(null);
    // Re-asserting the current status attaches the photo to the right slot.
    updateOrderStatus(activeOrder.id, activeOrder.status, uri);
  };

  const handleSignatureCaptured = (signature: string) => {
    if (!activeOrder) return;
    setActiveModal(null);

    if (activeOrder.status === 'pickup_scanned') {
      updateOrderStatus(activeOrder.id, 'picked_up', undefined, signature);
    } else if (activeOrder.status === 'arrived_at_delivery') {
      void finishDelivery(signature);
    }
  };

  /**
   * The handover itself.
   *
   * Everything else in this workflow is optimistic — the console moves and the
   * server catches up. This one waits, because the code is checked there and a
   * job shown as delivered that dispatch does not agree was delivered is worse
   * than a spinner.
   */
  const finishDelivery = async (signature?: string) => {
    if (!activeOrder) return;

    setHandoverBusy(true);
    const result = await completeDelivery(activeOrder.id, {
      code: overrideMode ? undefined : otpInput.trim(),
      overrideReason: overrideMode ? overrideReason.trim() : undefined,
      signature,
    });
    setHandoverBusy(false);

    if (!result.ok) {
      setOtpError(result.error);
      return;
    }

    setOtpError('');
    setOtpInput('');
    setOverrideMode(false);
    setOverrideReason('');
    // Distance is missing on purpose: the phone has been measuring the ride
    // between its own GPS fixes the whole way, and the job's booked figure is a
    // straight line drawn at booking time. Adding it here counted the trip
    // twice, badly. See `distanceDate` on `RiderState`.
    updateRider({
      todayEarnings: rider.todayEarnings + activeOrder.price,
      completedCount: rider.completedCount + 1,
    });
  };

  return (
    <View style={styles.container}>
      <LiveMap
        rider={rider}
        orders={orders}
        activeOrder={activeOrder}
        navigationTarget={navigationTarget}
        focusedOrderId={focusedOrderId ?? activeOrder?.id ?? null}
        // Selecting one of this courier's own pins moves the workflow sheet to
        // it as well, so the map and the sheet never disagree about which job
        // is in front of them. Tapping a pin from the open pool only previews.
        onSelectOrder={(order) => {
          if (myOrders.some((o) => o.id === order.id)) focusOrder(order.id);
        }}
        // Withheld until the profile is complete, so the map simply offers no
        // accept rather than one that refuses. The banner on Tasks and the
        // offer card above both explain why.
        onAcceptOrder={profileComplete ? acceptOrder : undefined}
        // Clears the floating identity chip and alert buttons below, which
        // occupy the same corner as the map's own GPS badge and controls.
        overlayTopOffset={IDENTITY_CHIP_HEIGHT + 10}
      />

      {/* Floating identity + alerts */}
      <SafeAreaView style={[styles.topBar, { pointerEvents: 'box-none' }]} edges={['top']}>
        <View style={styles.identityChip}>
          <Avatar uri={rider.avatar} size={40} />
          <View style={{ maxWidth: 140 }}>
            <Text style={styles.identityName} numberOfLines={1}>
              {rider.name || 'Setup profile'}
            </Text>
            <Text style={styles.identityId} numberOfLines={1}>
              {rider.employeeId || 'No ID yet'}
            </Text>
          </View>
          <ConnectionPill online={connected} />
        </View>

        <View style={styles.topActions}>
          <Pressable
            onPress={() => setShowNotifications(true)}
            accessibilityLabel="Open notifications"
            style={({ pressed }) => [styles.circleButton, pressed && styles.pressed]}
          >
            <Bell size={22} color={colors.textCharcoal} />
            {unreadCount > 0 && (
              <View style={styles.badgeDot}>
                <Text style={styles.badgeDotText}>{unreadCount}</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.push('/chat')}
            accessibilityLabel="Open dispatch chat"
            style={({ pressed }) => [styles.circleButton, pressed && styles.pressed]}
          >
            <MessageSquare size={22} color={colors.textCharcoal} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Shift control sheet */}
      <View style={styles.sheet}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 16 }}
          // Was a flat 330. The type is larger now and phones are not one
          // size: cap the sheet at 44% of the window so the workflow keeps the
          // room it needs on a small screen and uses it on a large one.
          style={{ maxHeight: Math.round(windowHeight * 0.44) }}
        >
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>
                {rider.isOnline ? "You're online" : "You're offline"}
              </Text>
              <Text style={styles.sheetSubtitle}>
                {rider.isOnline
                  ? 'Dispatch can send you jobs and the customer can see you moving.'
                  : 'Go online to be offered jobs.'}
              </Text>
            </View>

            <Pressable
              onPress={() => updateRider({ isOnline: !rider.isOnline })}
              style={({ pressed }) => [
                styles.onlinePill,
                rider.isOnline ? styles.onlinePillOn : styles.onlinePillOff,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.onlinePillLabel,
                  { color: rider.isOnline ? colors.statusSuccess : '#FFFFFF' },
                ]}
              >
                {rider.isOnline ? 'Online' : 'Go online'}
              </Text>
            </Pressable>
          </View>

          {rider.isOnline && (
            <View style={styles.statsRow}>
              <StatTile label="Delivered" value={`${rider.completedCount}`} />
              <StatTile label="Earned" value={formatCedis(rider.todayEarnings)} accent />
              <StatTile label="Ridden" value={`${rider.todayDistance.toFixed(1)} km`} />
            </View>
          )}

          {/*
            The job strip. Only worth the space once there is a choice to make —
            with one job it says nothing the workflow header does not.
          */}
          {rider.isOnline && myOrders.length > 1 && (
            <View style={styles.stripWrap}>
              <Text style={text.overline}>
                {myOrders.length} jobs in hand · tap to switch
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stripScroll}
                contentContainerStyle={styles.strip}
              >
                {myOrders.map((job) => {
                  const selected = job.id === activeOrder?.id;
                  const riding = navigationTarget?.orderId === job.id;

                  return (
                    <Pressable
                      key={job.id}
                      onPress={() => focusOrder(job.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${job.orderNumber}, ${toBookingStatus(job.status)}`}
                      style={({ pressed }) => [
                        styles.jobChip,
                        selected && styles.jobChipOn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.jobChipTop}>
                        {riding && <View style={styles.ridingDot} />}
                        <Text
                          style={[styles.jobChipRef, selected && styles.jobChipRefOn]}
                          numberOfLines={1}
                        >
                          {job.orderNumber}
                        </Text>
                      </View>
                      <Text
                        style={[styles.jobChipStage, selected && styles.jobChipStageOn]}
                        numberOfLines={1}
                      >
                        {toBookingStatus(job.status)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {rider.isOnline && activeOrder && (
            <View style={styles.workflow}>
              <View style={styles.workflowHeader}>
                <Text style={styles.workflowLabel} numberOfLines={1}>
                  {activeOrder.orderNumber}
                </Text>
                <Badge
                  label={humanizeStatus(activeOrder.status)}
                  tone={activeOrder.priority === 'elite' ? 'gold' : 'sage'}
                />
              </View>

              {/* The same job in the customer's six stages, so a stage moved
                  from the supervisor's desk shows up here too. */}
              <CustomerStage status={activeOrder.status} />

              {/* --- transit legs --- */}
              {activeOrder.status === 'assigned' && (
                <>
                  <Text style={styles.workflowBody}>
                    Proceed to <Text style={styles.strong}>{activeOrder.pickupAddress}</Text> for
                    pickup.
                  </Text>
                  <Button
                    label="Start navigation"
                    onPress={() => updateOrderStatus(activeOrder.id, 'navigating_to_pickup')}
                  />
                </>
              )}

              {/* Only for the job whose road it is — the courier may be
                  looking at a different card while riding this one. */}
              {navigationTarget?.orderId === activeOrder.id && (
                <>
                  <Text style={styles.workflowMuted}>
                    {locationDenied
                      ? 'Location is off, so the customer cannot see you moving. Confirm arrival by hand.'
                      : arrivalAutoConfirms
                        ? `In transit to ${navigationTarget.label}. Arrival is confirmed automatically as you reach it.`
                        : `In transit to ${navigationTarget.label}. Your GPS fix is too rough to confirm arrival on its own — use the button when you get there.`}
                  </Text>
                  <Button
                    label={
                      activeOrder.status === 'navigating_to_pickup'
                        ? 'Arrived at pickup'
                        : activeOrder.status === 'navigating_to_laundry'
                          ? 'Confirm arrival at hub'
                          : 'Confirm arrival at destination'
                    }
                    variant="outline"
                    onPress={arriveAtDestination}
                  />
                </>
              )}

              {/* --- pickup checklist --- */}
              {activeOrder.status === 'arrived_at_pickup' && !handoffCleared && (
                <>
                  <StepRow step={1} label="Check the customer's collection code" />
                  <Button
                    label="Check the collection code"
                    icon={ScanLine}
                    onPress={() => setActiveModal('handoff')}
                  />
                </>
              )}

              {activeOrder.status === 'arrived_at_pickup' && handoffCleared && (
                <>
                  <StepRow step={2} label="Scan the QR label on each bag" />
                  <Button
                    label="Scan the bag labels"
                    icon={QrCode}
                    onPress={() => setActiveModal('scanner')}
                  />
                </>
              )}

              {activeOrder.status === 'pickup_scanned' && !activeOrder.pickupPhoto && (
                <>
                  <StepRow step={3} label="Photograph the bags" />
                  <Button
                    label="Photograph the bags"
                    icon={CameraIcon}
                    onPress={() => setActiveModal('pickup-camera')}
                  />
                </>
              )}

              {activeOrder.status === 'pickup_scanned' && !!activeOrder.pickupPhoto && (
                <>
                  <StepRow step={4} label="Get the customer's signature" />
                  <Button
                    label="Get the signature"
                    icon={UserCheck}
                    onPress={() => setActiveModal('signature')}
                  />
                </>
              )}

              {/* --- transit to the hub --- */}
              {activeOrder.status === 'picked_up' && (
                <>
                  <Text style={styles.workflowBody}>
                    Bags are on the bike. Ride to the hub.
                  </Text>
                  <Button
                    label="Navigate to the hub"
                    onPress={() => updateOrderStatus(activeOrder.id, 'navigating_to_laundry')}
                  />
                </>
              )}

              {activeOrder.status === 'arrived_at_laundry' &&
                dropoffBagsCheckedFor !== activeOrder.id && (
                  <>
                    <StepRow step={1} label="Count the bags off against the manifest" />
                    <Button
                      label="Count the bags off"
                      icon={QrCode}
                      onPress={() => setActiveModal('scanner')}
                    />
                  </>
                )}

              {activeOrder.status === 'arrived_at_laundry' &&
                dropoffBagsCheckedFor === activeOrder.id && (
                  <>
                    <StepRow step={2} label="Ask the hub desk for their code" />
                    <Text style={styles.formNote}>
                      It is on the desk’s screen. This app is never told it — dispatch checks
                      what you send.
                    </Text>
                    <Button
                      label="Check the bags in"
                      icon={ScanLine}
                      onPress={() => setActiveModal('dropoff')}
                    />
                  </>
                )}

              {/* The hub's own leg. Nothing here is the courier's to press —
                  dispatch moves it through washing and finishing on its own
                  and files an alert when there is a delivery to ride. */}
              {(activeOrder.status === 'dropped_off' ||
                activeOrder.status === 'processing') && (
                <View style={styles.processingCard}>
                  <CheckCircle2 size={28} color={ink.success} />
                  <Text style={styles.processingTitle}>
                    {activeOrder.status === 'dropped_off'
                      ? 'Checked in at the hub'
                      : 'Being washed'}
                  </Text>
                  <Text style={styles.processingBody}>
                    The hub has the bags. Dispatch will alert you when they are washed and ready
                    to ride back — you can close the app until then.
                  </Text>
                </View>
              )}

              {activeOrder.status === 'ready_for_delivery' && (
                <>
                  <Text style={styles.workflowBody}>
                    Washed, folded and bagged. Ready to go back.
                  </Text>
                  <Button
                    label="Navigate to delivery"
                    variant="gold"
                    onPress={() => updateOrderStatus(activeOrder.id, 'navigating_to_delivery')}
                  />
                </>
              )}

              {/* --- delivery checklist --- */}
              {activeOrder.status === 'arrived_at_delivery' && !overrideMode && (
                <>
                  <View style={styles.otpHeader}>
                    <Text style={[styles.workflowBody, { flex: 1 }]}>
                      Ask the customer for their delivery code
                    </Text>
                    <LinkButton
                      label="Ask in chat"
                      onPress={() => {
                        sendRiderMessage(
                          'Hello, I am outside with your fresh laundry. Please read me the delivery code from your FreshFold app.'
                        );
                        // Open the thread the message just went into. Sending
                        // silently from here looked like a dead button, and the
                        // courier is standing at a door waiting on a reply.
                        router.push('/chat');
                      }}
                    />
                  </View>

                  <CodeInput
                    value={otpInput}
                    onChange={(next) => {
                      setOtpInput(next);
                      setOtpError('');
                    }}
                    failed={!!otpError}
                  />

                  <Text style={styles.formNote}>
                    It is on their order screen. This app is never told it — dispatch checks
                    what you type.
                  </Text>

                  <LinkButton
                    label="They cannot give me a code"
                    onPress={() => setOverrideMode(true)}
                  />
                </>
              )}

              {/* The documented exception: nobody in, a porter took it. */}
              {activeOrder.status === 'arrived_at_delivery' && overrideMode && (
                <>
                  <Text style={styles.workflowBody}>What happened at the door?</Text>
                  <Input
                    value={overrideReason}
                    onChangeText={(next) => {
                      setOverrideReason(next);
                      setOtpError('');
                    }}
                    placeholder="e.g. Nobody answered; left with the hostel porter, Mr Antwi"
                    multiline
                    style={styles.overrideInput}
                  />
                  <Text style={styles.formNote}>
                    This goes to the dispatch desk and onto the order permanently, and the
                    customer is told. Take the photo whatever you write.
                  </Text>

                  <LinkButton
                    label="They can give me the code after all"
                    onPress={() => {
                      setOverrideMode(false);
                      setOverrideReason('');
                      setOtpError('');
                    }}
                  />
                </>
              )}

              {activeOrder.status === 'arrived_at_delivery' && !!otpError && (
                <Notice icon={CheckCircle2} tone="error">
                  {otpError}
                </Notice>
              )}

              {activeOrder.status === 'arrived_at_delivery' &&
                handoverReady &&
                !activeOrder.deliveryPhoto && (
                  <>
                    <StepRow step={2} label="Photograph the delivered bags" />
                    <Button
                      label="Take the photo"
                      icon={CameraIcon}
                      onPress={() => setActiveModal('delivery-camera')}
                    />
                  </>
                )}

              {activeOrder.status === 'arrived_at_delivery' &&
                handoverReady &&
                !!activeOrder.deliveryPhoto && (
                  <>
                    <StepRow
                      step={3}
                      label={
                        overrideMode
                          ? 'Sign it off yourself and finish the drop'
                          : "Get the recipient's signature"
                      }
                    />
                    <Button
                      label={handoverBusy ? 'Confirming with dispatch…' : 'Collect drop signature'}
                      icon={UserCheck}
                      disabled={handoverBusy}
                      onPress={() => setActiveModal('signature')}
                    />
                  </>
                )}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Incoming job offer */}
      {offer && (
        <View style={styles.offerCard}>
          <View style={styles.offerHeader}>
            <View style={styles.offerEyebrowRow}>
              <Sparkles size={18} color={ink.gold} />
              <Text style={styles.offerEyebrow}>New job</Text>
            </View>
            
          </View>

          <View style={styles.offerTitleRow}>
            <Text style={styles.offerName} numberOfLines={1}>
              {offer.customerName}
            </Text>
            <Text style={styles.offerPrice}>{formatCedis(offer.price)}</Text>
          </View>

          <View style={styles.offerMetaRow}>
            <MapPin size={18} color={ink.sage} />
            <Text style={styles.offerMeta} numberOfLines={1}>
              {offer.pickupAddress}
            </Text>
          </View>
          <Text style={styles.offerSubMeta}>
            {offer.laundryType} • {offer.bagCount} bags • {offer.distance} km
          </Text>

          <View style={styles.offerActions}>
            <Button
              label="Decline"
              variant="ghost"
              onPress={() => setDismissedOfferIds((prev) => [...prev, offer.id])}
              style={{ flex: 1 }}
            />
            {profileComplete ? (
              <Button
                label="Accept job"
                onPress={() => acceptOrder(offer.id)}
                style={{ flex: 1.3 }}
              />
            ) : (
              // Sending the rider somewhere useful beats a dead button: the
              // offer is real and they want it, they just cannot take it yet.
              <Button
                label="Finish profile first"
                variant="gold"
                icon={IdCard}
                onPress={() => router.push('/(tabs)/profile')}
                style={{ flex: 1.3 }}
              />
            )}
          </View>
        </View>
      )}

      {/* Workflow modals */}
      <Modal
        visible={activeModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalScrim}>
          {/* The tap-to-dismiss target is a layer *behind* the sheet, not a
              wrapper around it. See `modalScrim` for why that distinction is
              what makes the bag checklist scroll. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={() => setActiveModal(null)}
          />

          {/* A modal is its own window, so the screen's avoider does not reach
              in — and the hub code and the override reason are typed here. */}
          <KeyboardAvoider style={styles.modalAvoider}>
            <View style={styles.modalBody}>
              {activeModal === 'handoff' && activeOrder && (
                <HandoffVerify
                  order={activeOrder}
                  onVerified={() => {
                    setHandoffVerifiedFor(activeOrder.id);
                    // Straight on to the bags — the courier is standing at the
                    // door and the two checks are one interaction to them.
                    setActiveModal('scanner');
                  }}
                  onCancel={() => setActiveModal(null)}
                />
              )}

              {activeModal === 'scanner' && activeOrder && (
                <QRScanner
                  order={activeOrder}
                  onScanComplete={handleQrVerified}
                  onCancel={() => setActiveModal(null)}
                />
              )}

              {activeModal === 'dropoff' && activeOrder && (
                <DropoffVerify
                  order={activeOrder}
                  onSubmit={(handover) => completeDropoff(activeOrder.id, handover)}
                  onDone={() => setActiveModal(null)}
                  onCancel={() => setActiveModal(null)}
                />
              )}

              {(activeModal === 'pickup-camera' || activeModal === 'delivery-camera') && (
                <CameraCapture
                  context={activeModal === 'pickup-camera' ? 'pickup' : 'delivery'}
                  title={
                    activeModal === 'pickup-camera'
                      ? 'Document garment condition'
                      : 'Proof of delivery'
                  }
                  onCapture={handlePhotoCaptured}
                  onCancel={() => setActiveModal(null)}
                />
              )}

              {activeModal === 'signature' && activeOrder && (
                <SignaturePad
                  customerName={activeOrder.customerName}
                  title={
                    activeOrder.status === 'pickup_scanned'
                      ? 'Pickup signature verification'
                      : 'Delivery receipt slip'
                  }
                  onSave={handleSignatureCaptured}
                  onCancel={() => setActiveModal(null)}
                />
              )}
            </View>
          </KeyboardAvoider>
        </View>
      </Modal>

      <NotificationsSheet
        visible={showNotifications}
        notifications={notifications}
        onClose={() => setShowNotifications(false)}
        onSelect={(notif) => {
          markNotificationRead(notif.id);
          setShowNotifications(false);
          if (notif.orderId) {
            focusOrder(notif.orderId);
            router.push('/(tabs)/assignments');
          }
        }}
      />
    </View>
  );
}

// `text` is the theme's type scale in this file, so the prop is `label`.
function StepRow({ step, label }: { step: number; label: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepBubble}>
        <Text style={styles.stepNumber}>{step}</Text>
      </View>
      <Text style={styles.stepText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  identityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.pill,
    paddingLeft: 6,
    // Tighter than the left: the connection pill sits on this edge and carries
    // its own padding.
    paddingRight: 8,
    paddingVertical: 6,
    ...shadow.md,
  },
  identityName: { ...text.caption, fontWeight: '800', color: colors.textCharcoal },
  identityId: { ...text.micro, marginTop: 1 },
  topActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  circleButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.statusError,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDotText: { ...text.micro, color: '#FFFFFF', fontWeight: '800' },

  sheet: {
    backgroundColor: colors.cardPure,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    ...shadow.lg,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetTitle: text.title,
  sheetSubtitle: { ...text.caption, marginTop: 3 },
  onlinePill: {
    minHeight: touch.min,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 18,
  },
  onlinePillOn: { backgroundColor: tints.success10, borderColor: tints.success30 },
  onlinePillOff: { backgroundColor: colors.textCharcoal, borderColor: colors.textCharcoal },
  onlinePillLabel: {
    ...text.bodyStrong,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  statsRow: { flexDirection: 'row', gap: 10 },

  stripWrap: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: 16,
  },
  // Cancels the sheet's own 18 of padding so the chips bleed to the screen
  // edges as they scroll — a half-visible chip reads as "more this way"
  // rather than as a clipping mistake — and puts it back inside the content.
  stripScroll: { marginHorizontal: -18 },
  strip: { gap: 10, paddingHorizontal: 18 },
  jobChip: {
    minWidth: 140,
    minHeight: touch.min,
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgLinen,
  },
  jobChipOn: {
    borderColor: colors.brandSage,
    backgroundColor: tints.sage15,
  },
  jobChipTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  /** Marks the job the courier is actually riding for. */
  ridingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brandGold,
  },
  jobChipRef: {
    ...text.caption,
    flexShrink: 1,
    fontWeight: '800',
    color: colors.textSlate,
  },
  jobChipRefOn: { color: colors.textCharcoal },
  jobChipStage: { ...text.micro, fontWeight: '600' },
  jobChipStageOn: { color: ink.sage },

  workflow: {
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: 16,
  },
  workflowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  workflowLabel: { ...text.overline, color: colors.textCharcoal },
  workflowBody: text.body,
  workflowMuted: { ...text.body, color: colors.textSlate },
  strong: { fontWeight: '700' },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bgLinen,
    borderRadius: radius.lg,
    padding: 12,
  },
  stepBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: { ...text.caption, color: '#FFFFFF', fontWeight: '800' },
  stepText: { ...text.body, flex: 1 },

  processingCard: {
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgLinen,
    borderWidth: 1,
    borderColor: colors.brandStone,
    borderRadius: radius.lg,
    padding: 18,
  },
  processingTitle: { ...text.strong, marginTop: 4 },
  processingBody: { ...text.caption, textAlign: 'center' },

  otpHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  overrideInput: {
    minHeight: 88,
    textAlignVertical: 'top',
    backgroundColor: colors.bgIvory,
  },
  formNote: text.caption,

  offerCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 24,
    backgroundColor: colors.cardPure,
    borderRadius: radius.xxl,
    borderWidth: 2,
    borderColor: colors.brandGold,
    padding: 18,
    gap: 8,
    ...shadow.lg,
  },
  offerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingBottom: 10,
  },
  offerEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Gold is the offer's border and its mark; the words are the readable ink.
  offerEyebrow: { ...text.overline, color: ink.gold },
  offerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  offerName: { ...text.title, flex: 1 },
  offerPrice: { ...text.title, color: ink.gold },
  offerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offerMeta: { ...text.body, flex: 1 },
  offerSubMeta: text.caption,
  offerActions: { flexDirection: 'row', gap: 12, marginTop: 10 },

  /**
   * The scrim is a plain view with the dismiss target layered underneath the
   * sheet, rather than a `Pressable` wrapped around it.
   *
   * A `Pressable` around the sheet takes the JS responder on touch-down for
   * every touch inside it, and `ScrollView` deliberately does not compete for
   * it — `onStartShouldSetResponder` returns false there, so a scroll view
   * yields to whatever is nested inside it. Granting the responder to an
   * ancestor blocks the native scroll gesture for the rest of that drag, so
   * the bag checklist in `QRScanner` was bounded, overflowing and completely
   * immovable: a rider on a six-bag job could see five of them and had no way
   * to reach the sixth, which is the one still waiting to be ticked off.
   *
   * Nothing above the sheet may be pressable for the same reason. `box-none`
   * on the avoider is what lets a tap on the empty space reach the dismiss
   * layer without putting a touch handler in the sheet's ancestry.
   */
  modalScrim: { flex: 1, backgroundColor: tints.scrim, justifyContent: 'flex-end' },
  /**
   * The workflow sheets are bounded here, and they were not before.
   *
   * `modalBody` had no height of its own and nothing above it had one either,
   * so a sheet taller than the screen simply laid itself out at full height
   * against a container pinned to the bottom — and everything past the top edge
   * went off the screen with nothing to scroll it back. The bag scanner is where
   * that showed: a viewfinder, a checklist and two buttons is already most of a
   * phone, and a courier with a large manifest lost the header and the mode
   * switch off the top while the list underneath scrolled two rows at a time.
   *
   * `flex: 1` on the avoider gives the percentage below something to resolve
   * against; `flexShrink` on the body is what makes the cap a constraint the
   * sheet's own children can respond to rather than a crop. See `QRScanner`,
   * which now gives its viewfinder up to keep the checklist usable.
   */
  modalAvoider: { flex: 1, justifyContent: 'flex-end', pointerEvents: 'box-none' },
  modalBody: { width: '100%', maxHeight: '92%', flexShrink: 1 },
});

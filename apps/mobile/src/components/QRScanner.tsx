/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ClipboardCheck, Layers, QrCode, ShieldCheck } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { classifyScan } from '../scan';
import { colors, ink, radius, text, tints, touch } from '../theme';
import { LaundryBag, Order } from '../types';
import { Button, Divider, SegmentedControl, SheetHeader } from './ui';

interface QRScannerProps {
  order: Order;
  onScanComplete: (scannedBags: LaundryBag[]) => void;
  onCancel?: () => void;
}

type ScannerMode = 'camera' | 'manual';

export default function QRScanner({ order, onScanComplete, onCancel }: QRScannerProps) {
  const [bags, setBags] = useState<LaundryBag[]>(() => order.bags.map((bag) => ({ ...bag })));
  // Opens on the checklist, not the camera. The bag manifest is derived from
  // the order — `bagsForJob` in the shared package — so `FF-BAG-…-A` exists as
  // a record, not as a sticker on a bag. Defaulting to the camera left riders
  // pointing at nothing and scanning the customer's collection QR instead.
  // The camera stays a tap away for when labels are actually printed.
  const [mode, setMode] = useState<ScannerMode>('manual');
  const [status, setStatus] = useState('Check each bag against the list, then confirm.');
  const [permission, requestPermission] = useCameraPermissions();
  // How much of the viewfinder survived the sheet's shrink. See `viewfinder`.
  const [viewfinderHeight, setViewfinderHeight] = useState(0);

  // The camera fires continuously; ignore repeats of a code we just handled.
  const lastCodeRef = useRef<{ value: string; at: number } | null>(null);

  const allScanned = bags.every((b) => b.scanned);

  const markScanned = useCallback((bagId: string) => {
    setBags((prev) => prev.map((b) => (b.id === bagId ? { ...b, scanned: true } : b)));
  }, []);

  // One bag at a time, deliberately: there is no control that clears the whole
  // manifest, so a rider has to look at every bag to get through this.
  const markByHand = (bag: LaundryBag) => {
    markScanned(bag.id);
    setStatus(`${bag.qrCode} accounted for.`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  // Ask for the camera as soon as the sheet opens: it is the intended path,
  // and a rider should not have to find a toggle to get to it.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);


  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      const now = Date.now();
      if (lastCodeRef.current?.value === data && now - lastCodeRef.current.at < 2000) return;
      lastCodeRef.current = { value: data, at: now };

      const result = classifyScan(data, bags);

      switch (result.kind) {
        case 'bag':
          markScanned(result.bag.id);
          setStatus(`Verified ${result.bag.qrCode} — ${result.bag.type}.`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          return;

        // A bag the rider has already checked off, read again because they left
        // the label in the frame or went back to confirm it. No haptic: this
        // comes round every couple of seconds while a label is held there, and
        // a bag buzzing on a loop reads as a fault.
        case 'bag-again':
          setStatus(`${result.bag.qrCode} is already accounted for.`);
          return;

        // The customer's collection QR is the other code in the room, and it is
        // the easiest thing to point at by mistake. Saying "unrecognised label"
        // to a rider who has just scanned the right customer reads like a
        // failure, so name what they actually scanned.
        case 'handoff':
          setStatus(
            result.payload.jobId === order.id
              ? `That is the collection code for this order, not a bag label. Tick the bags off below.`
              : `That is order ${result.payload.jobId}'s collection code, not a bag on ${order.orderNumber}.`
          );
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          return;

        default:
          setStatus(`Unrecognised label "${data}". Not part of ${order.orderNumber}.`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    },
    [bags, markScanned, order.id, order.orderNumber]
  );

  const enterCameraMode = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setMode('manual');
        setStatus('Camera access declined. Mark each bag by hand instead.');
        return;
      }
    }
    setMode('camera');
    setStatus('Camera live. Align a FreshFold bag label within the frame.');
  };

  const scannedCount = bags.filter((b) => b.scanned).length;

  // The placeholder is an overlay, so dropping a line from it cannot change the
  // box that was just measured — no layout loop. Unmeasured reads as roomy so
  // the common case does not flash the line away and back.
  const roomyViewfinder = viewfinderHeight === 0 || viewfinderHeight >= 212;

  return (
    <View style={styles.sheet}>
      <SheetHeader
        icon={QrCode}
        title="Scan the bag labels"
        subtitle={`${order.orderNumber} · ${bags.length} bags`}
      />

      <SegmentedControl
        value={mode}
        onChange={(next) => {
          if (next === 'camera') {
            void enterCameraMode();
          } else {
            setMode('manual');
            setStatus('Check each bag against the list, then confirm.');
          }
        }}
        options={[
          { id: 'manual' as ScannerMode, label: 'Check the list' },
          { id: 'camera' as ScannerMode, label: 'Scan a label' },
        ]}
      />

      {/* Viewfinder */}
      <View
        style={styles.viewfinder}
        onLayout={(e) => setViewfinderHeight(e.nativeEvent.layout.height)}
      >
        {mode === 'camera' && permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13', 'pdf417'] }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ) : (
          <View style={styles.viewfinderPlaceholder}>
            <QrCode size={52} color={colors.brandStone} />
            <Text style={styles.viewfinderTitle}>
              {mode === 'manual' ? 'Checking the manifest' : 'Camera not enabled'}
            </Text>
            {/* On a short sheet the box belongs to the icon, the title and the
                status pill. This line is the first thing to go: in manual mode
                it only restates what the pill underneath already says. */}
            {roomyViewfinder && (
              <Text style={styles.viewfinderBody}>
                {mode === 'manual'
                  ? 'Count the bags against the list below, then tick each one off.'
                  : 'Grant camera access to scan printed bag labels.'}
              </Text>
            )}
          </View>
        )}

        {/* Framing corners */}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />

        <View style={styles.statusPill}>
          <Text style={styles.statusText} numberOfLines={2}>
            {status}
          </Text>
        </View>
      </View>

      {/* Bag checklist */}
      <View style={styles.checklistHeader}>
        <Text style={text.overline}>
          Bags counted · {scannedCount} of {bags.length}
        </Text>
      </View>

      <ScrollView style={styles.bagList} contentContainerStyle={{ gap: 8 }}>
        {bags.map((bag) => (
          <View key={bag.id} style={[styles.bagRow, bag.scanned && styles.bagRowScanned]}>
            <View style={[styles.bagIcon, bag.scanned && styles.bagIconScanned]}>
              <Layers size={20} color={bag.scanned ? ink.success : colors.textSlate} />
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.bagTitleRow}>
                <Text style={styles.bagType} numberOfLines={1}>
                  {bag.type}
                </Text>
                <Text style={styles.bagWeight}>{bag.weight}</Text>
              </View>
              <Text style={styles.bagCode} numberOfLines={1}>
                {bag.qrCode} • {bag.itemCount} items
              </Text>
            </View>

            {bag.scanned ? (
              <View style={styles.verified}>
                <ClipboardCheck size={18} color={ink.success} />
                <Text style={styles.verifiedLabel}>Verified</Text>
              </View>
            ) : (
              // Only offered while marking by hand. Showing it beside a live
              // camera would turn scanning into the slower of two options.
              mode === 'manual' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${bag.type} as counted`}
                  onPress={() => markByHand(bag)}
                  style={({ pressed }) => [styles.scanChip, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.scanChipLabel}>Mark</Text>
                </Pressable>
              )
            )}
          </View>
        ))}
      </ScrollView>

      <Divider style={{ marginTop: 4 }} />

      <View style={styles.actions}>
        <Button label="Close" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label={`Confirm ${bags.length} bags`}
          onPress={() => onScanComplete(bags)}
          disabled={!allScanned}
          icon={ShieldCheck}
          style={{ flex: 1.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.cardPure,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 16,
    // Shrinkable, so the modal's cap reaches the checklist below instead of
    // pushing the header off the top of the screen. See `modalBody` in the
    // rider console.
    flexShrink: 1,
  },

  viewfinder: {
    aspectRatio: 16 / 10,
    // Gives its height up before the checklist does. A courier ticking twelve
    // bags off by hand needs the list far more than the framing corners.
    flexShrink: 2,
    /**
     * ...but not all of it. With nothing to stop it this collapsed to about
     * 127 on a six-bag job — the framing corners closed up on each other and
     * the status pill, which is anchored to the bottom of this same box, came
     * down on top of the placeholder text.
     *
     * This floor is that pill's band plus an icon and a title. The checklist
     * scrolls now, so it is the one that can afford to give: `bagList` has a
     * floor of its own and the two together stay inside the sheet's cap on a
     * short phone, which is the constraint that sets both numbers.
     */
    minHeight: 172,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  viewfinderPlaceholder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    // The status pill sits in the bottom 70 of this same box. Centre in what is
    // left rather than behind it.
    paddingBottom: 70,
    gap: 6,
  },
  viewfinderTitle: { ...text.strong, color: '#FFFFFF', marginTop: 8 },
  viewfinderBody: {
    ...text.caption,
    // On the near-black viewfinder, slate is unreadable — this is its own ground.
    color: 'rgba(255,255,255,0.78)',
    textAlign: 'center',
    maxWidth: 240,
  },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: colors.brandGold },
  cornerFailed: { borderColor: colors.statusError },
  cornerTL: { top: 20, left: 20, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 20, right: 20, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: {
    bottom: 20,
    left: 20,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 20,
    right: 20,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 6,
  },
  statusPill: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  statusPillFailed: { backgroundColor: 'rgba(169, 85, 85, 0.92)' },
  statusText: { ...text.caption, color: '#FFFFFF' },

  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  /**
   * Takes the room the sheet has spare rather than a fixed 200.
   *
   * 200 is about two of these rows — they carry a 44pt minimum for the thumb —
   * and it was 200 whether the job had two bags or fifteen. Combined with a
   * sheet that overflowed the screen rather than bounding itself, the courier's
   * manifest was a two-row window that would not scroll on the one job where
   * scrolling it mattered.
   *
   * The floor is the smaller half of a pair: it and `viewfinder`'s have to add
   * up to less than the room the sheet's cap leaves on the shortest phone we
   * run on, or neither can be honoured and the confirm buttons get pushed off
   * the bottom. It buys a row and a half, and the rest is a scroll away.
   */
  bagList: { flexShrink: 1, minHeight: 124 },
  bagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: touch.min,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgIvory,
  },
  bagRowScanned: {
    borderColor: tints.success30,
    backgroundColor: tints.success10,
  },
  bagIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tints.stone30,
  },
  bagIconScanned: { backgroundColor: tints.success10 },
  bagTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bagType: { ...text.bodyStrong, flexShrink: 1 },
  bagWeight: {
    ...text.micro,
    color: colors.textCharcoal,
    backgroundColor: colors.borderSoft,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  bagCode: { ...text.mono, marginTop: 3 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifiedLabel: { ...text.caption, fontWeight: '700', color: ink.success },
  scanChip: {
    minHeight: touch.min,
    justifyContent: 'center',
    backgroundColor: colors.brandSage,
    paddingHorizontal: 18,
    borderRadius: radius.md,
  },
  scanChipLabel: { ...text.bodyStrong, color: '#FFFFFF' },

  actions: { flexDirection: 'row', gap: 12 },
});

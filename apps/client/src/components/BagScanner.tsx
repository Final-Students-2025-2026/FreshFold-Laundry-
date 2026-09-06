/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ArrowRight, ClipboardCheck, Layers, QrCode, ShieldCheck } from 'lucide-react-native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LaundryBag } from '@freshfold/core';
import { useT } from '../i18n';
import { colors, radius, tints } from '../theme';
import { Button, Divider } from './ui';

/**
 * The customer's pass over their own bag manifest.
 *
 * The rider scans to claim the bags onto the job; this scans to check the same
 * codes independently — a count the customer can point at if something is
 * missing later. It writes nothing to the dispatch record for that reason: the
 * rider owns `bags`, and two surfaces writing one field would race. What it
 * produces is a line in the shared conversation, posted by the caller.
 */

interface BagScannerProps {
  bags: LaundryBag[];
  reference: string;
  onConfirm: (bags: LaundryBag[]) => void;
  onCancel?: () => void;
}

type ScannerMode = 'checklist' | 'camera';

export default function BagScanner({ bags: initial, reference, onConfirm, onCancel }: BagScannerProps) {
  const { t } = useT();
  const [bags, setBags] = useState<LaundryBag[]>(() => initial.map((bag) => ({ ...bag, scanned: false })));
  const [mode, setMode] = useState<ScannerMode>('checklist');
  /**
   * The line under the viewfinder. `null` is the opening hint rather than a copy
   * of it, so that hint follows the language while it is still the thing on
   * screen — a string captured into state at mount would not.
   */
  const [status, setStatus] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  // The camera fires continuously; ignore repeats of a code just handled.
  const lastCodeRef = useRef<{ value: string; at: number } | null>(null);

  const scannedCount = useMemo(() => bags.filter((bag) => bag.scanned).length, [bags]);
  const allScanned = bags.length > 0 && scannedCount === bags.length;

  const markScanned = useCallback((bagId: string) => {
    setBags((current) => current.map((bag) => (bag.id === bagId ? { ...bag, scanned: true } : bag)));
  }, []);

  const tickOff = (bag: LaundryBag) => {
    markScanned(bag.id);
    setStatus(t('scanner.hint.checked', { code: bag.qrCode }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const tickAll = () => {
    setBags((current) => current.map((bag) => ({ ...bag, scanned: true })));
    setStatus(t('scanner.hint.all'));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      const now = Date.now();
      if (lastCodeRef.current?.value === data && now - lastCodeRef.current.at < 2000) return;
      lastCodeRef.current = { value: data, at: now };

      const match = bags.find(
        (bag) => bag.qrCode.toLowerCase() === data.trim().toLowerCase() && !bag.scanned
      );

      if (match) {
        markScanned(match.id);
        setStatus(t('scanner.hint.verified', { code: match.qrCode, type: match.type }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        setStatus(t('scanner.hint.foreign', { code: data, reference }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    },
    [bags, markScanned, reference, t]
  );

  const enterCameraMode = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setStatus(t('scanner.hint.declined'));
        return;
      }
    }
    setMode('camera');
    setStatus(t('scanner.hint.live'));
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <QrCode size={20} color={colors.brandSage} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('scanner.title')}</Text>
          <Text style={styles.subtitle}>{reference}</Text>
        </View>
      </View>

      <View style={styles.modeToggle}>
        <Pressable
          onPress={() => setMode('checklist')}
          style={[styles.modeButton, mode === 'checklist' && styles.modeButtonActive]}
        >
          <Text style={[styles.modeLabel, mode === 'checklist' && styles.modeLabelActive]}>
            {t('scanner.mode.checklist')}
          </Text>
        </Pressable>
        <Pressable
          onPress={enterCameraMode}
          style={[styles.modeButton, mode === 'camera' && styles.modeButtonActive]}
        >
          <Text style={[styles.modeLabel, mode === 'camera' && styles.modeLabelActive]}>
            {t('scanner.mode.camera')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.viewfinder}>
        {mode === 'camera' && permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13', 'pdf417'] }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ) : (
          <View style={styles.viewfinderPlaceholder}>
            <QrCode size={40} color={tints.sage40} />
            <Text style={styles.viewfinderTitle}>{t('scanner.empty.title')}</Text>
            <Text style={styles.viewfinderBody}>{t('scanner.empty.body')}</Text>
          </View>
        )}

        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />

        <View style={styles.statusPill}>
          <Text style={styles.statusText} numberOfLines={2}>
            {status ?? t('scanner.hint.initial')}
          </Text>
        </View>
      </View>

      <View style={styles.checklistHeader}>
        <Text style={styles.checklistTitle}>
          {t('scanner.manifest', { count: scannedCount, total: bags.length })}
        </Text>
        {!allScanned && bags.length > 0 && (
          <Pressable onPress={tickAll} style={styles.tickAll} hitSlop={6}>
            <Text style={styles.tickAllLabel}>{t('scanner.tickAll')}</Text>
            <ArrowRight size={12} color={colors.brandSage} />
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.bagList} contentContainerStyle={{ gap: 8 }}>
        {bags.map((bag) => (
          <View key={bag.id} style={[styles.bagRow, bag.scanned && styles.bagRowScanned]}>
            <View style={[styles.bagIcon, bag.scanned && styles.bagIconScanned]}>
              <Layers size={14} color={bag.scanned ? colors.statusSuccess : colors.textSlate} />
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.bagTitleRow}>
                <Text style={styles.bagType} numberOfLines={1}>
                  {bag.type}
                </Text>
                {/* Only once it has been weighed. At the door it never has
                    been — counting and weighing happen at the hub — so this is
                    blank on the leg this screen is actually used for. */}
                {!!bag.weight && <Text style={styles.bagWeight}>{bag.weight}</Text>}
              </View>
              <Text style={styles.bagCode} numberOfLines={1}>
                {bag.itemCount === undefined
                  ? bag.qrCode
                  : t('scanner.bag.meta', { code: bag.qrCode, items: bag.itemCount })}
              </Text>
            </View>

            {bag.scanned ? (
              <View style={styles.verified}>
                <ClipboardCheck size={13} color={colors.statusSuccess} />
                <Text style={styles.verifiedLabel}>{t('scanner.checked')}</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => tickOff(bag)}
                style={({ pressed }) => [styles.tickChip, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.tickChipLabel}>{t('scanner.tick')}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>

      <Divider style={{ marginTop: 4 }} />

      <View style={styles.actions}>
        <Button label={t('common.close')} variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label={
            // Three states rather than a plural rule: nothing checked yet, one
            // bag, or a count.
            scannedCount === 0
              ? t('scanner.confirmNone')
              : scannedCount === 1
                ? t('scanner.confirmOne')
                : t('scanner.confirmMany', { count: scannedCount })
          }
          onPress={() => onConfirm(bags)}
          disabled={scannedCount === 0}
          icon={<ShieldCheck size={15} color="#FFFFFF" />}
          style={{ flex: 1.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Shrinkable, so the sheet's cap reaches the checklist below rather than
  // clipping the buttons at the bottom of this column. See `Sheet` in `./ui`.
  sheet: { padding: 20, paddingTop: 8, gap: 12, flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: colors.textCharcoal },
  subtitle: { fontSize: 10, color: colors.textSlate, marginTop: 2 },

  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bgLinen,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  modeButton: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  modeButtonActive: { backgroundColor: colors.cardPure },
  modeLabel: { fontSize: 11, fontWeight: '600', color: colors.textSlate },
  modeLabelActive: { color: colors.textCharcoal },

  viewfinder: {
    aspectRatio: 16 / 10,
    // Gives up its height before the checklist does. On a short screen a
    // slightly letterboxed viewfinder is a much better trade than a list of
    // bags with no room to show any of them.
    flexShrink: 2,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: '#141412',
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
    gap: 4,
  },
  viewfinderTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginTop: 6 },
  viewfinderBody: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    maxWidth: 230,
    lineHeight: 14,
  },
  corner: { position: 'absolute', width: 20, height: 20, borderColor: colors.brandGold },
  cornerTL: { top: 20, left: 20, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 6 },
  cornerTR: { top: 20, right: 20, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 6 },
  cornerBL: {
    bottom: 20,
    left: 20,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 20,
    right: 20,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 6,
  },
  statusPill: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  statusText: { color: '#FFFFFF', fontSize: 9.5, lineHeight: 13 },

  checklistHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checklistTitle: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textSlate,
  },
  tickAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tickAllLabel: { fontSize: 11, fontWeight: '700', color: colors.brandSage },

  /**
   * The list takes what room is left, rather than a fixed 170.
   *
   * `maxHeight: 170` was about two rows, and it was 170 whether the order had
   * two bags or twenty — so a large order's manifest was a two-row window onto a
   * long list, on a sheet whose own contents had already overflowed and been
   * clipped. Between the two, the thing a customer was trying to scroll would
   * not move.
   *
   * `flexShrink` lets it collapse into whatever the sheet has spare, and
   * `minHeight` keeps that from collapsing to nothing on a small screen — below
   * about three rows the list stops reading as a list. It scrolls inside that,
   * which is what it was always meant to do.
   */
  bagList: { flexShrink: 1, minHeight: 132 },
  bagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgIvory,
  },
  bagRowScanned: { borderColor: tints.success30, backgroundColor: tints.success10 },
  bagIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tints.stone35,
  },
  bagIconScanned: { backgroundColor: tints.success10 },
  bagTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bagType: { fontSize: 11.5, fontWeight: '700', color: colors.textCharcoal, flexShrink: 1 },
  bagWeight: {
    fontSize: 9,
    color: colors.textSlate,
    backgroundColor: colors.borderSoft,
    borderRadius: 3,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  bagCode: {
    fontSize: 9.5,
    color: colors.textSlate,
    marginTop: 2,
    ...Platform.select({ ios: { fontFamily: 'Menlo' }, android: { fontFamily: 'monospace' } }),
  },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedLabel: { fontSize: 9.5, fontWeight: '700', color: colors.statusSuccess },
  tickChip: {
    backgroundColor: colors.brandSage,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  tickChipLabel: { fontSize: 9.5, fontWeight: '700', color: '#FFFFFF' },

  actions: { flexDirection: 'row', gap: 10 },
});

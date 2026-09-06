/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Haptics from 'expo-haptics';
import { Check, KeyRound, Pencil, RotateCcw, ShieldCheck } from 'lucide-react-native';
import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useT } from '../i18n';
import { colors, radius, tints } from '../theme';
import { Button, Divider } from './ui';

/**
 * Signing for a delivery.
 *
 * The rider console captures a signature *from* the customer; here the
 * customer gives it directly, which is both the more honest chain of custody
 * and the reason this transition is theirs to make.
 *
 * The handover code is shown rather than asked for. It belongs to the customer
 * — the courier's console is never told it — so this screen's job is to put it
 * in front of them to read out, and to send it with the signature when they
 * sign for the order themselves.
 */

interface DeliveryConfirmProps {
  /** Commits the signature against this order's code. False if it is refused. */
  onConfirm: (signature: string, code: string) => Promise<boolean>;
  onCancel?: () => void;
  /** Printed under the signature line. Falls back to `sign.you` when absent. */
  customerName?: string;
  bagCount?: number;
  /** This order's delivery code — the customer's to read out. */
  deliveryCode?: string;
}

const PAD_HEIGHT = 170;

export default function DeliveryConfirm({
  onConfirm,
  onCancel,
  customerName,
  bagCount,
  deliveryCode,
}: DeliveryConfirmProps) {
  const { t } = useT();
  /** Completed strokes, plus the one currently under the finger. */
  const [strokes, setStrokes] = useState<string[]>([]);
  const [currentStroke, setCurrentStroke] = useState('');
  /**
   * Whether a finger is down on the pad, which is when the sheet must not
   * scroll. See the pan responder below.
   */
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const svgRef = useRef<Svg | null>(null);
  const strokeRef = useRef('');

  /**
   * The pad, and the four lines that stop the sheet eating the signature.
   *
   * This component renders inside a `ScrollView` — it has to, because the code
   * card, the pad, the notice and the buttons do not fit on a small phone — and
   * a scroll view and a drawing pad want the same gesture. Signing is a slow
   * vertical drag, which is precisely what a scroll view is watching for, so
   * every stroke was a race: sometimes a line, sometimes the sheet sliding under
   * the finger, most often a line that stopped dead the moment the scroll view
   * decided the drag was its. A customer signing their name got the first third
   * of it.
   *
   * `onPanResponderTerminationRequest` is the fix. It is the scroll view asking
   * to take the gesture over mid-stroke, and the answer is no — a signature is
   * not something to hand over halfway through. The capture variants claim the
   * touch on the way down rather than waiting to be offered it, and
   * `scrollEnabled` is switched off for the duration so nothing else is
   * competing. `onPanResponderTerminate` keeps whatever was drawn if the system
   * takes the gesture anyway — an incoming call, a notification shade — because
   * a partial signature the customer can see and clear is better than one that
   * vanishes.
   */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        // The pad is inside a modal sheet; without this a touch that starts on
        // the pad can still be treated as one on the scrim behind it.
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          strokeRef.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          setCurrentStroke(strokeRef.current);
          setDrawing(true);
        },

        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          strokeRef.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          setCurrentStroke(strokeRef.current);
        },

        onPanResponderRelease: () => {
          const finished = strokeRef.current;
          strokeRef.current = '';
          setCurrentStroke('');
          setDrawing(false);
          // A tap with no drag leaves a single moveto — not worth keeping.
          if (finished.includes('L')) setStrokes((current) => [...current, finished]);
        },

        onPanResponderTerminate: () => {
          const finished = strokeRef.current;
          strokeRef.current = '';
          setCurrentStroke('');
          setDrawing(false);
          if (finished.includes('L')) setStrokes((current) => [...current, finished]);
        },
      }),
    []
  );

  const hasSigned = strokes.length > 0 || currentStroke.includes('L');
  const ready = hasSigned && !!deliveryCode;

  const clear = () => {
    strokeRef.current = '';
    setCurrentStroke('');
    setStrokes([]);
  };

  /** Rasterises the pad, falling back to the vector if the SVG can't export. */
  const captureSignature = (): Promise<string> =>
    new Promise((resolve) => {
      const ref = svgRef.current as
        | (Svg & { toDataURL?: (callback: (base64: string) => void) => void })
        | null;

      const vector = `freshfold-signature:${strokes.join(' ')}`;
      if (!ref?.toDataURL) {
        resolve(vector);
        return;
      }

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(vector);
      }, 2500);

      ref.toDataURL((base64) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(`data:image/png;base64,${base64}`);
      });
    });

  const confirm = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError('');

    try {
      const signature = await captureSignature();
      const ok = await onConfirm(signature, deliveryCode ?? '');

      if (!ok) {
        setError(t('sign.refused'));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.sheet}
      keyboardShouldPersistTaps="handled"
      // Off while a stroke is in progress. The responder handlers above already
      // refuse to give the gesture up; this is the belt to that pair of braces,
      // and it is what stops the pad drifting under the finger on Android.
      scrollEnabled={!drawing}
    >
      <View style={styles.header}>
        <Pencil size={19} color={colors.brandSage} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('sign.title')}</Text>
          <Text style={styles.subtitle}>
            {/* Three keys and a branch rather than a plural rule. The English
                singular was wrong before this — a one-bag order read "Check
                all 1 bags" — and a language that says a counted noun
                differently should not have to inherit that. */}
            {bagCount === 1
              ? t('sign.subtitleOne')
              : bagCount
                ? t('sign.subtitleMany', { count: bagCount })
                : t('sign.subtitle')}
          </Text>
        </View>
      </View>

      {/* The code, to read out. Not a field: the customer is the one who has
          it, and typing it back to themselves proves nothing. */}
      <View style={styles.codeCard}>
        <KeyRound size={15} color={colors.brandSage} />
        <View style={{ flex: 1 }}>
          <Text style={styles.codeLabel}>{t('sign.code.label')}</Text>
          <Text style={styles.codeValue}>{deliveryCode ?? t('common.blank')}</Text>
        </View>
      </View>
      <Text style={styles.codeHint}>{t('sign.code.hint')}</Text>
      {/*
        An order with no code on it cannot be signed for — `ready` is false and
        the confirm button below is disabled. Said out loud rather than left as
        a button that does nothing when pressed: every code is minted with the
        booking, so a missing one means an order old enough to predate them, and
        the desk is the only way through.
      */}
      {!deliveryCode && <Text style={styles.codeError}>{t('sign.noCode')}</Text>}
      {!!error && <Text style={styles.codeError}>{error}</Text>}

      <View style={styles.pad} {...panResponder.panHandlers}>
        <View style={styles.signLine} pointerEvents="none">
          <Text style={styles.signHint}>{t('sign.here')}</Text>
          {/* The customer's own name when the caller knows it. The stand-in is
              a key rather than a prop default so it follows the language. */}
          <Text style={styles.signHintRight}>{customerName || t('sign.you')}</Text>
        </View>

        <Svg ref={svgRef} style={StyleSheet.absoluteFill} pointerEvents="none">
          {strokes.map((d, index) => (
            <Path
              key={index}
              d={d}
              stroke={colors.textCharcoal}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
          {currentStroke !== '' && (
            <Path
              d={currentStroke}
              stroke={colors.textCharcoal}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          )}
        </Svg>
      </View>

      <View style={styles.notice}>
        <ShieldCheck size={14} color={colors.brandSage} />
        <Text style={styles.noticeText}>{t('sign.notice')}</Text>
      </View>

      <Divider />

      <View style={styles.actions}>
        <Button
          label={t('sign.clear')}
          variant="ghost"
          onPress={clear}
          disabled={!hasSigned}
          icon={<RotateCcw size={14} color={colors.textCharcoal} />}
          style={{ flex: 1 }}
        />
        <Button
          label={t('sign.confirm')}
          onPress={confirm}
          disabled={!ready}
          loading={saving}
          icon={<Check size={15} color="#FFFFFF" />}
          style={{ flex: 1.5 }}
        />
      </View>

      {!!onCancel && (
        <Button label={t('sign.later')} variant="ghost" size="sm" onPress={onCancel} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: tints.sage08,
    borderWidth: 1,
    borderColor: tints.sage25,
    borderRadius: radius.lg,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  codeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  codeValue: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 8,
    color: colors.textCharcoal,
    marginTop: 2,
  },
  codeHint: { fontSize: 10, color: colors.textSlate, lineHeight: 14 },
  codeError: { fontSize: 10, fontWeight: '700', color: colors.statusError },

  sheet: { padding: 20, paddingTop: 8, gap: 13 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: colors.textCharcoal },
  subtitle: { fontSize: 10.5, color: colors.textSlate, marginTop: 3, lineHeight: 14.5 },

  pad: {
    height: PAD_HEIGHT,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brandStone,
    backgroundColor: colors.bgIvory,
    overflow: 'hidden',
  },
  signLine: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 34,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.brandStone,
    paddingBottom: 3,
  },
  signHint: { fontSize: 9, letterSpacing: 1, color: colors.brandStone, fontWeight: '700' },
  signHintRight: { fontSize: 8.5, color: colors.brandStone },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: tints.stone35,
    borderRadius: radius.md,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  noticeText: { flex: 1, fontSize: 10, color: colors.textSlate, lineHeight: 14 },

  actions: { flexDirection: 'row', gap: 10 },
});

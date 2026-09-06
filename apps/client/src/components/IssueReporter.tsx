/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera, Check, ImageIcon, RotateCcw, TriangleAlert } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ClaimKind } from '@freshfold/core';
import { useT } from '../i18n';
import { colors, radius, tints } from '../theme';
import { Button, Divider, Field } from './ui';

/**
 * Report a problem with a garment.
 *
 * The rider app's `CameraCapture` documents condition on the company's behalf;
 * this is the mirror of it — the customer documenting theirs. The photo is
 * optional here, unlike proof-of-service, because a complaint is worth sending
 * either way. What it will not accept is a stand-in image: the attachment ends
 * up on the job record, and a stock photo there reads as evidence.
 */

interface IssueReporterProps {
  /**
   * `kind` is which reason chip was tapped, as a `CLAIM_KINDS` value.
   *
   * Carried separately from the note because the two are used for different
   * things: the note is prose for a person to read in the thread, and the kind
   * is what the desk filters and counts on. Tapping a chip writes its words into
   * the note *and* sets this — the customer types over the words freely, and the
   * kind stays what they chose.
   */
  onSubmit: (note: string, photoUri: string | undefined, kind: ClaimKind) => void;
  onCancel?: () => void;
}

/**
 * Reasons worth one tap, drawn from what the care guarantee actually covers.
 *
 * Keys rather than sentences, because tapping one *writes* it into the note — the
 * chip is copy and payload at once, and what the desk reads on the job record is
 * whichever of these the customer chose. So the note can reach the desk in Spanish.
 * That is already true of the field below, where somebody types in the language
 * they think in, and the desk is in Accra; a canned reason that stayed English
 * would be the odd one out.
 */
const REASON_KEYS = [
  'issue.reason.stain',
  'issue.reason.missing',
  'issue.reason.damaged',
  'issue.reason.finish',
  'issue.reason.late',
] as const;

/**
 * Which claim each chip is, in the vocabulary the server counts on.
 *
 * The keys rather than the translated words, because a report filed in Spanish
 * has to land in the same bucket as one filed in English — matching on the
 * sentence would give the desk five categories per language.
 */
const REASON_KINDS: Record<(typeof REASON_KEYS)[number], ClaimKind> = {
  'issue.reason.stain': 'stain',
  'issue.reason.missing': 'missing',
  'issue.reason.damaged': 'damaged',
  'issue.reason.finish': 'finish',
  'issue.reason.late': 'late',
};

export default function IssueReporter({ onSubmit, onCancel }: IssueReporterProps) {
  const { t } = useT();
  const [note, setNote] = useState('');
  /** Which chip was tapped. `other` until one is, and again if it is untapped. */
  const [kind, setKind] = useState<ClaimKind>('other');
  const [captured, setCaptured] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // The photo goes onto the job record and into the courier's thread, so it has
  // to be a real one. A stock image attached to a complaint is worse than no
  // image — it looks like evidence. The report itself sends fine without a
  // photo; only fabricated ones are gone.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const takePicture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (photo?.uri) setCaptured(photo.uri);
      else setError(t('issue.camera.empty'));
    } catch {
      setError(t('issue.camera.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TriangleAlert size={19} color={colors.statusWarning} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('issue.title')}</Text>
          <Text style={styles.subtitle}>{t('issue.subtitle')}</Text>
        </View>
      </View>

      <View style={styles.reasonWrap}>
        {REASON_KEYS.map((key) => {
          const reason = t(key);
          const active = note === reason;
          return (
            <Pressable
              key={key}
              onPress={() => {
                setNote(active ? '' : reason);
                setKind(active ? 'other' : REASON_KINDS[key]);
              }}
              style={[styles.reasonChip, active && styles.reasonChipActive]}
            >
              <Text style={[styles.reasonLabel, active && styles.reasonLabelActive]}>{reason}</Text>
            </Pressable>
          );
        })}
      </View>

      <Field
        label={t('issue.field')}
        value={note}
        onChangeText={setNote}
        placeholder={t('issue.placeholder')}
        multiline
      />

      <View style={styles.viewfinder}>
        {captured ? (
          <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : permission?.granted ? (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
            <Pressable
              onPress={takePicture}
              accessibilityLabel={t('issue.camera.take')}
              style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </>
        ) : (
          <View style={styles.permissionPane}>
            <ImageIcon size={30} color="rgba(255,255,255,0.4)" />
            <Text style={styles.permissionTitle}>{t('issue.camera.title')}</Text>
            <Text style={styles.permissionBody}>{t('issue.camera.body')}</Text>
            <Button
              label={t('issue.camera.enable')}
              variant="outline"
              size="sm"
              onPress={() => void requestPermission()}
              style={{ marginTop: 8 }}
            />
          </View>
        )}

        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Divider />

      <View style={styles.actions}>
        {captured ? (
          <Button
            label={t('issue.retake')}
            variant="ghost"
            onPress={() => setCaptured(null)}
            icon={<RotateCcw size={14} color={colors.textCharcoal} />}
            style={{ flex: 1 }}
          />
        ) : (
          <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        )}
        <Button
          label={t('issue.send')}
          onPress={() => onSubmit(note.trim(), captured ?? undefined, kind)}
          disabled={!note.trim()}
          icon={<Check size={15} color="#FFFFFF" />}
          style={{ flex: 1.3 }}
        />
      </View>

      <View style={styles.assurance}>
        <Camera size={13} color={colors.brandSage} />
        <Text style={styles.assuranceText}>{t('issue.assurance')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, paddingTop: 8, gap: 13 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: colors.textCharcoal },
  subtitle: { fontSize: 10.5, color: colors.textSlate, marginTop: 3, lineHeight: 14.5 },

  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  reasonChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.bgLinen,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  reasonChipActive: { backgroundColor: tints.warning10, borderColor: tints.warning30 },
  reasonLabel: { fontSize: 10, fontWeight: '600', color: colors.textSlate },
  reasonLabelActive: { color: colors.statusWarning, fontWeight: '700' },

  viewfinder: {
    aspectRatio: 4 / 3,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: '#141412',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  shutter: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.statusError },

  permissionPane: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 3,
  },
  permissionTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginTop: 4 },
  permissionBody: { color: colors.textMuted, fontSize: 9.5, marginBottom: 8 },
  corner: { position: 'absolute', width: 16, height: 16, borderColor: 'rgba(255,255,255,0.45)' },
  cornerTL: { top: 14, left: 14, borderTopWidth: 2, borderLeftWidth: 2 },
  cornerTR: { top: 14, right: 14, borderTopWidth: 2, borderRightWidth: 2 },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: 2, borderLeftWidth: 2 },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: 2, borderRightWidth: 2 },

  error: { fontSize: 10.5, color: colors.statusError, lineHeight: 15 },
  actions: { flexDirection: 'row', gap: 10 },

  assurance: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 2 },
  assuranceText: { flex: 1, fontSize: 10, color: colors.textMuted, lineHeight: 14 },
});

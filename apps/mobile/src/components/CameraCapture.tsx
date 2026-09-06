/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera, Check, ImageIcon, RotateCcw } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, ink, radius, text } from '../theme';
import { Button, Divider, SheetHeader } from './ui';

interface CameraCaptureProps {
  onCapture: (photoUri: string) => void;
  onCancel?: () => void;
  title?: string;
  context?: 'pickup' | 'delivery';
}

export default function CameraCapture({
  onCapture,
  onCancel,
  title = 'Capture condition documentation',
  context = 'pickup',
}: CameraCaptureProps) {
  /**
   * Two forms of the same shot.
   *
   * `preview` is the on-device file the camera hands back, which is what the
   * viewfinder should render — pointing an `Image` at a multi-megabyte data URI
   * to draw a 4:3 thumbnail is wasteful when the file is right there.
   *
   * `encoded` is what actually leaves the phone. This used to submit the file
   * URI, which meant every proof photo on the job record was a path inside this
   * app's sandbox: unreadable by the customer's app, by the supervisor's desk,
   * and by this phone once the cache was cleared. The record said a photograph
   * was taken and nobody could ever look at it.
   */
  const [preview, setPreview] = useState<string | null>(null);
  const [encoded, setEncoded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // This attaches proof-of-service to the shared job record, so the only thing
  // it will accept is a photograph taken here and now. There is deliberately no
  // gallery, no stock image and no skip: a stand-in shot is worse than no
  // photo, because it looks like evidence.
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
      // Quality is deliberately low. This is a condition record, not a
      // portfolio piece, and it travels over whatever signal a courier has in
      // a stairwell — the server takes bodies up to 12mb and a full-quality
      // phone photo encodes to a good fraction of that on its own.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.4, base64: true });
      if (photo?.base64) {
        setPreview(photo.uri ?? null);
        setEncoded(`data:image/jpeg;base64,${photo.base64}`);
      } else if (photo?.uri) {
        // Encoding failed but the file exists. Submitting the path would put a
        // dead reference on the job, so treat it as no photo at all.
        setError('The photo could not be prepared for upload. Try again.');
      } else {
        setError('The camera returned nothing. Try again.');
      }
    } catch {
      setError('The camera is unavailable on this device. Call dispatch to record the handover.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader
        icon={Camera}
        title={title}
        subtitle={
          context === 'pickup'
            ? 'Show the bags as you found them'
            : 'Show the bags as you handed them over'
        }
      />

      <View style={styles.viewfinder}>
        {preview || encoded ? (
          <Image
            source={{ uri: preview ?? encoded! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : permission?.granted ? (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
            <Pressable
              onPress={takePicture}
              accessibilityLabel="Take photo"
              style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </>
        ) : (
          <View style={styles.permissionPane}>
            <ImageIcon size={44} color="rgba(255,255,255,0.55)" />
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionBody}>
              {context === 'pickup'
                ? 'A photograph of the bags at collection is part of the record.'
                : 'A photograph of the delivered garments is part of the record.'}
            </Text>
            <Button
              label="Enable camera"
              variant="outline"
              onPress={() => void requestPermission()}
              style={{ marginTop: 10 }}
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
        {encoded ? (
          <>
            <Button
              label="Retake"
              variant="ghost"
              onPress={() => {
                setPreview(null);
                setEncoded(null);
              }}
              icon={RotateCcw}
              style={{ flex: 1 }}
            />
            <Button
              label="Submit proof"
              onPress={() => onCapture(encoded)}
              icon={Check}
              style={{ flex: 1 }}
            />
          </>
        ) : (
          <Button label="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        )}
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
  },

  viewfinder: {
    aspectRatio: 4 / 3,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  shutter: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.statusError,
  },

  permissionPane: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 6,
  },
  permissionTitle: { ...text.strong, color: '#FFFFFF', marginTop: 6 },
  // The viewfinder is its own near-black ground; slate is unreadable on it.
  permissionBody: {
    ...text.caption,
    color: 'rgba(255,255,255,0.78)',
    textAlign: 'center',
    marginBottom: 8,
  },
  corner: { position: 'absolute', width: 20, height: 20, borderColor: 'rgba(255,255,255,0.55)' },
  cornerTL: { top: 14, left: 14, borderTopWidth: 2, borderLeftWidth: 2 },
  cornerTR: { top: 14, right: 14, borderTopWidth: 2, borderRightWidth: 2 },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: 2, borderLeftWidth: 2 },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: 2, borderRightWidth: 2 },

  error: { ...text.body, color: ink.error },
  actions: { flexDirection: 'row', gap: 12 },
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { KeyRound, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parseHandoffPayload, verifyHandoff } from '@freshfold/core';
import { colors, ink, radius, text } from '../theme';
import { Order } from '../types';
import { Button, CodeInput, Divider, Notice, SegmentedControl, SheetHeader } from './ui';

/**
 * Checking the customer's collection code before taking the bags.
 *
 * The customer's app and the website both show a four-digit code and a QR
 * carrying the same thing. Scanning is the fast path; typing exists because
 * cameras fail in the dark, in the rain, and on cracked screens, and a courier
 * standing at a door cannot be blocked by that.
 *
 * A scanned payload has to name *this* job — `verifyHandoff` enforces it. A
 * courier holding two orders for the same street cannot have one customer's
 * QR accepted against the other's job.
 */

interface HandoffVerifyProps {
  order: Order;
  onVerified: () => void;
  onCancel?: () => void;
}

type Mode = 'camera' | 'manual';

export default function HandoffVerify({ order, onVerified, onCancel }: HandoffVerifyProps) {
  const [mode, setMode] = useState<Mode>('camera');
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState(
    'Ask the customer to show their collection code, then scan it.'
  );
  const [failed, setFailed] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // The camera fires continuously; ignore repeats of a code just handled.
  const lastCodeRef = useRef<{ value: string; at: number } | null>(null);

  const accept = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onVerified();
  }, [onVerified]);

  const reject = useCallback((message: string) => {
    setFailed(true);
    setStatus(message);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }, []);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      const now = Date.now();
      if (lastCodeRef.current?.value === data && now - lastCodeRef.current.at < 2000) return;
      lastCodeRef.current = { value: data, at: now };

      if (verifyHandoff(data, { jobId: order.id, leg: 'pickup', code: order.pickupOtp })) {
        setFailed(false);
        setStatus('Code verified.');
        accept();
        return;
      }

      // Distinguish "somebody else's code" from "not one of ours at all" —
      // they call for completely different reactions at the door.
      const parsed = parseHandoffPayload(data);
      if (parsed && parsed.jobId !== order.id) {
        reject(`That code belongs to order ${parsed.jobId}, not ${order.orderNumber}.`);
      } else if (parsed) {
        reject('That code does not match this order. Ask the customer to refresh it.');
      } else {
        reject('That is not a FreshFold collection code.');
      }
    },
    [order.id, order.orderNumber, order.pickupOtp, accept, reject]
  );

  const submitTyped = () => {
    if (verifyHandoff(typed, { jobId: order.id, leg: 'pickup', code: order.pickupOtp })) {
      setFailed(false);
      accept();
    } else {
      reject('Those digits do not match. Ask the customer to read them again.');
    }
  };

  const enterCameraMode = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setMode('manual');
        setStatus('Camera access declined. Type the four digits instead.');
        return;
      }
    }
    setMode('camera');
    setStatus('Align the customer’s QR inside the frame.');
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader
        icon={ScanLine}
        title="Check the collection code"
        subtitle={`${order.orderNumber} · ${order.customerName}`}
      />

      <SegmentedControl
        value={mode}
        onChange={(next) => {
          if (next === 'camera') {
            void enterCameraMode();
          } else {
            setMode('manual');
            setStatus('Ask the customer to read out their four digits.');
          }
        }}
        options={[
          { id: 'camera' as Mode, label: 'Scan QR' },
          { id: 'manual' as Mode, label: 'Type the code' },
        ]}
      />

      {mode === 'camera' ? (
        <View style={styles.viewfinder}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
          ) : (
            <View style={styles.viewfinderPlaceholder}>
              <ScanLine size={48} color={colors.brandStone} />
              <Text style={styles.viewfinderTitle}>Camera not enabled</Text>
              <Text style={styles.viewfinderBody}>
                Grant access to scan, or switch to typing the code.
              </Text>
            </View>
          )}

          <View style={[styles.corner, styles.cornerTL, failed && styles.cornerFailed]} />
          <View style={[styles.corner, styles.cornerTR, failed && styles.cornerFailed]} />
          <View style={[styles.corner, styles.cornerBL, failed && styles.cornerFailed]} />
          <View style={[styles.corner, styles.cornerBR, failed && styles.cornerFailed]} />

          <View style={[styles.statusPill, failed && styles.statusPillFailed]}>
            <Text style={styles.statusText} numberOfLines={2}>
              {status}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.manualPane}>
          <KeyRound size={22} color={ink.sage} />
          <Text style={text.strong}>Four digits from the customer</Text>
          <CodeInput
            value={typed}
            onChange={(next) => {
              setTyped(next);
              setFailed(false);
            }}
            failed={failed}
            autoFocus
          />
          {failed && (
            <Notice icon={TriangleAlert} tone="error">
              {status}
            </Notice>
          )}
          <Button
            label="Check the code"
            onPress={submitTyped}
            disabled={typed.length < 4}
            icon={ShieldCheck}
            style={{ alignSelf: 'stretch' }}
          />
        </View>
      )}

      <Notice icon={ShieldCheck}>
        Do not collect without a matching code. If the customer cannot produce one, call
        dispatch rather than taking the bags.
      </Notice>

      <Divider />

      <Button label="Cancel" variant="ghost" onPress={onCancel} />
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
    aspectRatio: 16 / 11,
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

  manualPane: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgIvory,
  },
});

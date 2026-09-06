/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Building2, KeyRound, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parseHandoffPayload } from '@freshfold/core';
import { colors, ink, radius, text } from '../theme';
import { Order } from '../types';
import {
  Button,
  CodeInput,
  Divider,
  Input,
  LinkButton,
  Notice,
  SegmentedControl,
  SheetHeader,
} from './ui';

/**
 * Checking the load in at the laundry hub.
 *
 * The mirror of {@link HandoffVerify}, with one deliberate difference: this
 * console is never told what the code is. The hub desk's screen shows it, the
 * courier scans or types it, and the *server* decides — see the drop-off gate
 * in `routes/orders.ts`. A check that runs on the courier's device against a
 * code the courier's device was given is not a check, and the hub is the one
 * stop on the round trip with a desk, a screen and a signal, so insisting on
 * the network here costs nothing.
 *
 * What the device *can* do without the answer is read the payload: a scanned
 * QR names a job and a leg, so pointing the camera at the wrong order's code —
 * or at the customer's collection QR still sitting in the courier's hand — is
 * caught here rather than spent on a round trip.
 */

interface DropoffVerifyProps {
  order: Order;
  /** Resolves with dispatch's refusal rather than throwing, so it can be shown. */
  onSubmit: (
    payload: { code?: string; overrideReason?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => void;
  onCancel?: () => void;
}

type Mode = 'camera' | 'manual';

/** Enough of a sentence to be worth having on the record. Matches the server. */
const MIN_REASON = 8;

export default function DropoffVerify({ order, onSubmit, onDone, onCancel }: DropoffVerifyProps) {
  const [mode, setMode] = useState<Mode>('camera');
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState('Scan the code on the hub desk’s screen.');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [reason, setReason] = useState('');
  const [permission, requestPermission] = useCameraPermissions();

  // The camera fires continuously; ignore repeats of a code just handled.
  const lastCodeRef = useRef<{ value: string; at: number } | null>(null);

  const reject = useCallback((message: string) => {
    setFailed(true);
    setStatus(message);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }, []);

  /**
   * Hands the attempt to dispatch and waits. Every other transition in this app
   * is optimistic; this one is not, for the same reason the delivery hand-off
   * is not — a load shown as checked in that the hub does not agree arrived is
   * worse than a spinner.
   */
  const submit = useCallback(
    async (payload: { code?: string; overrideReason?: string }) => {
      if (busy) return;
      setBusy(true);
      setStatus('Confirming with dispatch…');
      setFailed(false);

      const result = await onSubmit(payload);
      setBusy(false);

      if (result.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onDone();
        return;
      }

      // Let the same code be re-scanned after a refusal — the desk may have
      // re-opened the right order in the meantime.
      lastCodeRef.current = null;
      reject(result.error);
    },
    [busy, onSubmit, onDone, reject]
  );

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (busy) return;

      const now = Date.now();
      if (lastCodeRef.current?.value === data && now - lastCodeRef.current.at < 2000) return;
      lastCodeRef.current = { value: data, at: now };

      const parsed = parseHandoffPayload(data);

      if (!parsed) {
        // Bag labels are the other codes in the room and they are on the very
        // bags being unloaded, so name what happened rather than saying the
        // scan failed.
        reject(
          data.trim().toUpperCase().startsWith('FF-BAG-')
            ? 'That is a bag label, not the hub’s screen. Scan the desk.'
            : 'That is not a FreshFold hand-off code.'
        );
        return;
      }

      if (parsed.jobId !== order.id) {
        reject(`That code belongs to order ${parsed.jobId}, not ${order.orderNumber}.`);
        return;
      }

      if (parsed.leg !== 'dropoff') {
        reject(
          parsed.leg === 'pickup'
            ? 'That is the customer’s collection code. Scan the hub desk’s screen.'
            : 'That is the delivery code, for when the laundry goes back.'
        );
        return;
      }

      void submit({ code: parsed.code });
    },
    [busy, order.id, order.orderNumber, reject, submit]
  );

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
    setFailed(false);
    setStatus('Align the hub’s QR inside the frame.');
  };

  const reasonReady = reason.trim().length >= MIN_REASON;

  return (
    <View style={styles.sheet}>
      <SheetHeader
        icon={Building2}
        title="Check the bags in"
        subtitle={`${order.orderNumber} · ${order.bagCount} bags`}
      />

      {overrideMode ? (
        /* The documented exception: no desk, no screen, nobody behind it. */
        <View style={styles.manualPane}>
          <TriangleAlert size={22} color={ink.error} />
          <Text style={text.strong}>Why is there no code?</Text>
          <Input
            value={reason}
            onChangeText={(next) => {
              setReason(next);
              setFailed(false);
            }}
            placeholder="e.g. Desk unattended after 21:00; left with the night supervisor"
            multiline
            style={[styles.reasonInput, failed && styles.reasonInputFailed]}
          />
          {failed && (
            <Notice icon={TriangleAlert} tone="error">
              {status}
            </Notice>
          )}
          <Text style={styles.note}>
            This goes to the dispatch desk and onto the order permanently, and the customer is
            told.
          </Text>
          <Button
            label={busy ? 'Confirming with dispatch…' : 'Check in without a code'}
            onPress={() => void submit({ overrideReason: reason.trim() })}
            disabled={!reasonReady || busy}
            icon={ShieldCheck}
            style={{ alignSelf: 'stretch' }}
          />
          <LinkButton
            label="The desk can give me the code after all"
            align="center"
            onPress={() => {
              setOverrideMode(false);
              setReason('');
              setFailed(false);
              setStatus('Scan the code on the hub desk’s screen.');
            }}
          />
        </View>
      ) : (
        <>
          <SegmentedControl
            value={mode}
            onChange={(next) => {
              if (next === 'camera') {
                void enterCameraMode();
              } else {
                setMode('manual');
                setFailed(false);
                setStatus('Ask the desk to read out their four digits.');
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
              <Text style={text.strong}>Four digits from the hub desk</Text>
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
                label={busy ? 'Confirming with dispatch…' : 'Check the code'}
                onPress={() => void submit({ code: typed.trim() })}
                disabled={typed.length < 4 || busy}
                icon={ShieldCheck}
                style={{ alignSelf: 'stretch' }}
              />
            </View>
          )}

          <Notice icon={ShieldCheck}>
            This console is never told the code — dispatch checks what you send. Unload the bags
            onto the counter before you scan.
          </Notice>

          <LinkButton
            label="There is nobody at the desk"
            align="center"
            onPress={() => setOverrideMode(true)}
          />
        </>
      )}

      <Divider />

      <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
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
  reasonInput: {
    alignSelf: 'stretch',
    minHeight: 92,
    textAlignVertical: 'top',
    borderWidth: 1.5,
    borderColor: colors.brandStone,
  },
  reasonInputFailed: { borderColor: colors.statusError },
  note: { ...text.caption, textAlign: 'center' },
});

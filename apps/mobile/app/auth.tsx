/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { AlertCircle, ScanFace } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, PHONE_DIGITS, limitPhoneInput } from '@freshfold/core';
import { KeyboardAvoider } from '../src/components/KeyboardAvoider';
import { Button, CodeInput, Field, Input, Notice } from '../src/components/ui';
import { REQUIRED_PROFILE_FIELDS, useApp } from '../src/store/AppStore';
import { useSession } from '../src/store/SessionStore';
import { colors, ink, radius, shadow, text, tints } from '../src/theme';

const PIN_DIGITS = 4;

export default function AuthScreen() {
  const router = useRouter();
  const { updateRider, profileComplete } = useApp();
  const { signIn, biometricEnabled, promptBiometric, rider, phase } = useSession();

  /** Employee ID, or the phone number on the employment record. */
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanningFace, setScanningFace] = useState(false);

  const landAfterLogin = useCallback(
    (complete: boolean) => {
      updateRider({ isOnline: true });
      // Land on Profile whenever anything dispatch requires is still missing —
      // otherwise the courier reaches the board only to find every accept
      // refused with no explanation.
      router.replace(complete ? '/(tabs)' : '/(tabs)/profile');
    },
    [router, updateRider]
  );

  const submit = useCallback(async () => {
    if (!identifier.trim() || pin.length !== PIN_DIGITS) {
      setAuthError(`Enter your employee ID and your ${PIN_DIGITS}-digit PIN.`);
      return;
    }

    setAuthError('');
    setBusy(true);

    try {
      const signedIn = await signIn(identifier, pin);
      setPin('');
      // The roster record decides where to land, not the store's copy — the
      // store has not seen this courier yet at this point in the render.
      landAfterLogin(
        REQUIRED_PROFILE_FIELDS.every((field) => String(signedIn[field] ?? '').trim())
      );
    } catch (error) {
      if (error instanceof ApiError) {
        setAuthError(
          error.status === 401
            ? 'That employee ID and PIN do not match.'
            : error.status === 403
              ? 'This courier is no longer on the roster. Speak to dispatch.'
              : error.message
        );
      } else {
        setAuthError('Could not reach dispatch. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [identifier, pin, signIn, landAfterLogin]);

  /**
   * Biometrics reopen a session; they do not create one.
   *
   * A face is not a credential the server can check, so this only works once a
   * courier has signed in on this device and the token is still valid. Without
   * that there is nobody to unlock as.
   */
  const authenticateWithBiometrics = async () => {
    if (!rider) {
      setAuthError('Sign in with your employee ID once on this device first.');
      return;
    }

    setScanningFace(true);
    try {
      const ok = await promptBiometric();
      if (!ok) {
        setAuthError('Biometric verification was not completed.');
        return;
      }
      landAfterLogin(profileComplete);
    } finally {
      setScanningFace(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>FreshFold Dispatch</Text>
            <Text style={text.heading}>Sign in</Text>
            <Text style={[text.body, { color: colors.textSlate }]}>
              Use the employee ID and PIN dispatch issued you.
            </Text>
          </View>

          <View style={styles.form}>
            {!!authError && <Notice icon={AlertCircle} tone="error">{authError}</Notice>}

            <Field
              label="Employee ID or phone"
              hint={`The ${PHONE_DIGITS}-digit number on your employment record works too.`}
            >
              <Input
                value={identifier}
                onChangeText={(value) => {
                  // One field, two kinds of answer. An employee ID has letters
                  // in it and is left alone; a number is a phone number, and a
                  // phone number is ten digits, so the eleventh never lands.
                  setIdentifier(/[a-z]/i.test(value) ? value : limitPhoneInput(value));
                  setAuthError('');
                }}
                placeholder="e.g. RIDER-204"
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </Field>

            <Field label="PIN" hint={`${pin.length} of ${PIN_DIGITS} digits`}>
              <CodeInput
                value={pin}
                onChange={(next) => {
                  setPin(next);
                  setAuthError('');
                }}
                digits={PIN_DIGITS}
                secure
                onSubmitEditing={submit}
              />
            </Field>

            <Button
              label="Sign in"
              onPress={submit}
              loading={busy}
              disabled={!identifier.trim() || pin.length !== PIN_DIGITS}
            />

            {biometricEnabled && (
              <View style={styles.biometric}>
                <Pressable
                  onPress={authenticateWithBiometrics}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock with Face ID"
                  style={({ pressed }) => [styles.faceButton, pressed && { opacity: 0.8 }]}
                >
                  <ScanFace size={34} color={ink.sage} />
                </Pressable>
                <Text style={[text.bodyStrong, { color: ink.sage }]}>Unlock with Face ID</Text>
                <Text style={[text.caption, { textAlign: 'center' }]}>
                  Reopens a session on a phone that has signed in before.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.legal}>
            <Text style={[text.caption, { textAlign: 'center' }]}>
              While you are online, this app shares your location with dispatch and with the
              customer whose laundry you are carrying.
            </Text>
            <Text style={[text.micro, { color: ink.sage }]}>FreshFold · Kumasi</Text>
          </View>
        </ScrollView>
      </KeyboardAvoider>

      {scanningFace && (
        <View style={styles.scanOverlay}>
          <View style={styles.scanBox}>
            <ScanFace size={52} color={colors.brandSage} />
          </View>
          <ActivityIndicator color={colors.brandStone} style={{ marginTop: 20 }} />
          <Text style={styles.scanTitle}>Checking your face…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'space-between', gap: 32 },

  intro: { gap: 6, marginTop: 16 },
  eyebrow: { ...text.overline, color: ink.sage },

  form: { gap: 20 },

  biometric: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  faceButton: {
    width: 76,
    height: 76,
    borderRadius: radius.xxl,
    backgroundColor: tints.sage10,
    borderWidth: 2,
    borderColor: tints.sage30,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },

  legal: { alignItems: 'center', gap: 8 },

  scanOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: tints.scrimDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBox: {
    width: 120,
    height: 120,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.brandSage,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTitle: {
    ...text.title,
    marginTop: 18,
    // On the deep scrim this sits on white, not on the light-ground inks.
    color: '#FFFFFF',
  },
});

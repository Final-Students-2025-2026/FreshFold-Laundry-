/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@freshfold/core';
import { KeyboardAvoider } from '../src/components/KeyboardAvoider';
import { Button, CodeInput, Field, Notice } from '../src/components/ui';
import { api } from '../src/services/api';
import { useSession } from '../src/store/SessionStore';
import { colors, ink, text, tints } from '../src/theme';

const PIN_DIGITS = 4;

/**
 * Replacing the temporary PIN a supervisor issued.
 *
 * There is no way past this screen. A courier signed in on a provisional
 * credential is one whose PIN a second person also knows — the supervisor who
 * read it out — so the console stays shut until only the courier knows it.
 */
export default function ChangePinScreen() {
  const router = useRouter();
  const { rider, token, applyRider, adoptToken } = useSession();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (currentPin.length !== PIN_DIGITS || newPin.length !== PIN_DIGITS) {
      setError(`Every PIN is ${PIN_DIGITS} digits.`);
      return;
    }
    if (newPin !== confirmPin) {
      setError('The two new PINs do not match.');
      return;
    }
    if (newPin === currentPin) {
      setError('Choose a PIN different from the temporary one.');
      return;
    }
    if (!token) {
      setError('Your session has expired. Sign in again.');
      return;
    }

    setError('');
    setBusy(true);

    try {
      const { token: replacement } = await api.changeRiderPin({ currentPin, newPin }, token);

      /**
       * Adopt the replacement before anything else uses the old one.
       *
       * Changing a PIN revokes every session signed in on it — that is what
       * makes the change mean something to a courier who was watched keying the
       * old one in — and this device's session goes with them. The route hands
       * back a fresh token for exactly this; without adopting it the next
       * request 401s on the phone of somebody who has just done the right thing.
       */
      await adoptToken(replacement);

      // The server has cleared the flag; mirror it locally so the gate opens
      // without waiting for the next poll.
      if (rider) applyRider({ ...rider, mustChangePin: false });

      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      router.replace('/(tabs)/profile');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 401 ? 'That is not your current PIN.' : err.message
        );
      } else {
        setError('Could not reach dispatch. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [currentPin, newPin, confirmPin, token, rider, applyRider, adoptToken, router]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoider>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.mark}>
            <KeyRound size={26} color={ink.sage} />
          </View>

          <Text style={text.heading}>Choose your own PIN</Text>
          <Text style={styles.body}>
            You signed in with a temporary PIN from your supervisor. They know it too, so it
            cannot stay. Pick one only you know — you will use it every shift.
          </Text>

          <View style={styles.form}>
            <PinField
              label="Temporary PIN"
              value={currentPin}
              onChange={(next) => {
                setCurrentPin(next);
                setError('');
              }}
            />
            <PinField
              label="New PIN"
              value={newPin}
              onChange={(next) => {
                setNewPin(next);
                setError('');
              }}
            />
            <PinField
              label="New PIN again"
              value={confirmPin}
              onChange={(next) => {
                setConfirmPin(next);
                setError('');
              }}
            />

            {!!error && <Notice icon={AlertCircle} tone="error">{error}</Notice>}

            <Button
              label="Set my PIN"
              onPress={submit}
              loading={busy}
              disabled={
                currentPin.length !== PIN_DIGITS ||
                newPin.length !== PIN_DIGITS ||
                confirmPin.length !== PIN_DIGITS
              }
            />
          </View>

          <View style={{ marginTop: 26 }}>
            <Notice icon={ShieldCheck}>
              Your PIN is hashed on the dispatch server. Nobody at FreshFold can read it back —
              a forgotten PIN is replaced, not recovered.
            </Notice>
          </View>
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

function PinField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={label}>
      <CodeInput value={value} onChange={onChange} digits={PIN_DIGITS} secure />
    </Field>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  scroll: { padding: 24, paddingTop: 40, gap: 6 },

  mark: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: tints.sage10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  body: { ...text.body, color: colors.textSlate, marginTop: 8 },

  form: { gap: 18, marginTop: 28 },
});

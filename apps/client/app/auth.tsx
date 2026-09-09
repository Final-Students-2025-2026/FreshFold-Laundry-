/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  AtSign,
  KeyRound,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiError,
  PHONE_DIGITS,
  PHONE_LENGTH_MESSAGE,
  isCompletePhone,
  limitPhoneInput,
  passwordProblem,
} from '@freshfold/core';
import { KeyboardAvoider } from '../src/components/KeyboardAvoider';
import { Button, Card, Field, Segmented } from '../src/components/ui';
import { useSession } from '../src/store/SessionStore';
import { colors, radius, shadow, tints } from '../src/theme';

type Mode = 'signin' | 'register';

/**
 * Sign in or open an account.
 *
 * The password goes straight to `/api/auth/*` and comes back as a bearer token;
 * it is never written to storage and never held after the request resolves.
 * Reachable from the account tab and from checkout — never forced, because a
 * booking does not require an account on any FreshFold surface.
 */
export default function AuthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; reason?: string }>();
  const {
    signIn,
    register,
    checkContact,
    requestPasswordReset,
  } = useSession();

  const [mode, setMode] = useState<Mode>(params.mode === 'register' ? 'register' : 'signin');
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  /** Shown after a reset request, in place of the form's usual chatter. */
  const [resetNotice, setResetNotice] = useState('');

  const done = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  /**
   * Edits the contact, and drops anything said about the previous one.
   *
   * The reset confirmation names the address it was sent to, so the moment
   * that address stops being what is in the field the notice is answering a
   * question nobody asked — and a customer correcting a typo was left reading
   * a confirmation for the typo.
   */
  const changeIdentifier = useCallback((next: string) => {
    setIdentifier(next);
    setResetNotice('');
  }, []);

  /** Tells the customer which door they are at before they type a password. */
  const probeContact = useCallback(async () => {
    const value = identifier.trim();
    if (!value) return;

    try {
      const status = await checkContact(value);
      if (!status.exists) {
        setHint('No account with that contact yet — switch to “Create account” below.');
      } else if (!status.hasPassword) {
        setHint('That contact has a booking but no password yet. Create one to claim it.');
      } else {
        // This branch used to clear the hint and say nothing at all, which left
        // the one person the link could help — the customer who has an account
        // and cannot remember its password — staring at a control that appeared
        // to do nothing.
        setHint('You have an account with a password. Forgotten it? Use “Reset it” above.');
      }
    } catch {
      // Offline. Let the sign-in attempt itself produce the error.
      setHint('');
    }
  }, [identifier, checkContact]);

  /**
   * Asks for a reset link.
   *
   * The confirmation is deliberately the same whether or not that contact has
   * an account: the server will not say, and a message here that varied would
   * hand back exactly what the server refused to.
   */
  const requestReset = useCallback(async () => {
    const value = identifier.trim();

    if (!value) {
      setError('Type your email or phone above first, then tap “Reset it”.');
      return;
    }

    setError('');
    setHint('');
    setResetBusy(true);

    try {
      await requestPasswordReset(value);
      setResetNotice(
        `If ${value} has a FreshFold account, a reset link is on its way. It is good for one hour.`
      );
    } catch {
      setError('Could not reach FreshFold. Check your connection and try again.');
    } finally {
      setResetBusy(false);
    }
  }, [identifier, requestPasswordReset]);

  const submit = useCallback(async () => {
    setError('');
    setBusy(true);

    try {
      if (mode === 'signin') {
        if (!identifier.trim() || !password) {
          setError('Enter your email or phone number, and your password.');
          return;
        }
        await signIn(identifier.trim(), password);
      } else {
        if (!name.trim() || !email.trim() || !phone.trim() || !password) {
          setError('Every field is needed to open an account.');
          return;
        }
        if (!isCompletePhone(phone)) {
          setError(PHONE_LENGTH_MESSAGE);
          return;
        }
        // The shared rule rather than this screen's own idea of it: the
        // website asked for five and this asked for six, and the server
        // decided both.
        const weak = passwordProblem(password);
        if (weak) {
          setError(weak);
          return;
        }
        if (password !== confirm) {
          setError('Those two passwords do not match.');
          return;
        }
        await register({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          password,
        });
      }

      setPassword('');
      setConfirm('');
      done();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? 'That password does not match our records.'
            : err.status === 409
              ? 'An account already exists for that contact. Sign in instead.'
              : err.message
        );
      } else {
        setError('Could not reach FreshFold. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [mode, identifier, password, name, email, phone, confirm, signIn, register, done]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
              <ArrowLeft size={17} color={colors.textCharcoal} />
            </Pressable>
            <View style={styles.brandMark}>
              <Sparkles size={16} color="#FFFFFF" />
            </View>
          </View>

          <Text style={styles.title}>
            {mode === 'signin' ? 'Welcome back' : 'Open your account'}
          </Text>
          <Text style={styles.subtitle}>
            {params.reason === 'wallet'
              ? 'Wallet, loyalty points and membership live on your account. Sign in to use them.'
              : mode === 'signin'
                ? 'Your orders, wallet and loyalty tier, on every device you sign in from.'
                : 'One account for booking, tracking, your wallet and your membership.'}
          </Text>

          <Segmented<Mode>
            options={[
              { id: 'signin', label: 'Sign in' },
              { id: 'register', label: 'Create account' },
            ]}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError('');
              setHint('');
              // The notice belongs to the sign-in form. Left standing, it came
              // back on the way through "Create account" and out again, long
              // after it meant anything.
              setResetNotice('');
            }}
            style={{ marginTop: 20, marginBottom: 18 }}
          />

          <Card style={{ gap: 14 }}>
            {mode === 'signin' ? (
              <>
                <Field
                  label="Email or phone"
                  value={identifier}
                  onChangeText={changeIdentifier}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  icon={<AtSign size={15} color={colors.textMuted} />}
                  hint={hint || undefined}
                />
                <View>
                  <View style={styles.passwordLabelRow}>
                    <Pressable onPress={requestReset} hitSlop={8} disabled={resetBusy}>
                      <Text style={[styles.link, styles.resetLink, resetBusy && { opacity: 0.5 }]}>
                        {resetBusy ? 'Sending…' : 'Forgotten it? Reset it'}
                      </Text>
                    </Pressable>
                  </View>
                  <Field
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    secureTextEntry
                    autoCapitalize="none"
                    icon={<KeyRound size={15} color={colors.textMuted} />}
                  />
                </View>

                {/* The link went out — or would have, if that contact exists. */}
                {!!resetNotice && (
                  <View style={styles.resetNotice}>
                    <Text style={styles.resetNoticeText}>{resetNotice}</Text>
                  </View>
                )}

                <Pressable onPress={probeContact} hitSlop={6}>
                  <Text style={styles.link}>Not sure if you have an account?</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Field
                  label="Full name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Ama Mensah"
                  autoCapitalize="words"
                  icon={<User size={15} color={colors.textMuted} />}
                />
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  icon={<Mail size={15} color={colors.textMuted} />}
                />
                <Field
                  label="Phone"
                  value={phone}
                  onChangeText={(next) => setPhone(limitPhoneInput(next))}
                  placeholder={`${PHONE_DIGITS} digits — e.g. 0550001234`}
                  keyboardType="phone-pad"
                  maxLength={PHONE_DIGITS}
                  icon={<Phone size={15} color={colors.textMuted} />}
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least six characters"
                  secureTextEntry
                  autoCapitalize="none"
                  icon={<KeyRound size={15} color={colors.textMuted} />}
                />
                <Field
                  label="Confirm password"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Type it once more"
                  secureTextEntry
                  autoCapitalize="none"
                  icon={<KeyRound size={15} color={colors.textMuted} />}
                />
              </>
            )}

            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Button
              label={mode === 'signin' ? 'Sign in' : 'Create account'}
              onPress={submit}
              loading={busy}
              size="lg"
            />

            {/*
              A biometric button used to sit here, and could not work: a
              biometric proves who is holding the phone, not what the password
              is, so there was nothing for it to sign in *with*. It now guards
              the session it can actually speak for — see `AppLock`.
            */}
          </Card>

          <View style={styles.assurance}>
            <ShieldCheck size={14} color={colors.brandSage} />
            <Text style={styles.assuranceText}>
              Your password is checked on our servers and never stored on this device — only a
              session token is.
            </Text>
          </View>

          <Pressable onPress={() => router.replace('/(tabs)')} hitSlop={8} style={styles.guest}>
            <Text style={styles.guestLabel}>Continue browsing without an account</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  scroll: { padding: 20, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.xs,
  },

  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.textCharcoal,
    marginTop: 26,
  },
  subtitle: { fontSize: 12.5, color: colors.textSlate, marginTop: 6, lineHeight: 18 },

  link: { fontSize: 11, fontWeight: '700', color: colors.brandSage },

  // Sits above the password field, right-aligned — where the eye goes when the
  // password in your head turns out to be the wrong one.
  passwordLabelRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  resetLink: { fontSize: 10.5, color: colors.brandGold },

  resetNotice: {
    backgroundColor: tints.sage08,
    borderWidth: 1,
    borderColor: tints.sage08,
    borderRadius: radius.md,
    padding: 11,
  },
  resetNoticeText: { fontSize: 11, color: colors.textCharcoal, lineHeight: 16 },

  errorBox: {
    backgroundColor: tints.error08,
    borderWidth: 1,
    borderColor: tints.error25,
    borderRadius: radius.md,
    padding: 10,
  },
  errorText: { fontSize: 11.5, color: colors.statusError, lineHeight: 16 },

  assurance: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  assuranceText: { flex: 1, fontSize: 10.5, color: colors.textSlate, lineHeight: 15 },

  guest: { alignItems: 'center', marginTop: 22 },
  guestLabel: { fontSize: 11.5, fontWeight: '700', color: colors.textSlate },
});

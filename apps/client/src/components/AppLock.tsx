/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fingerprint, Sparkles } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { usePreferences } from '../store/PreferencesStore';
import { useSession } from '../store/SessionStore';
import { colors, radius, tints } from '../theme';
import { Button } from './ui';

/**
 * The lock the biometric switch in settings promises.
 *
 * The switch has existed for a while and only ever wrote a preference: the
 * sign-in screen offered a biometric button, but a signed-in customer never
 * sees the sign-in screen, so turning "unlock with biometrics" on protected
 * nothing. Someone who picked up an unlocked phone got the orders, the wallet
 * balance and the saved addresses. This is the missing half — the thing the
 * switch says it does.
 *
 * Mounted beside the router rather than inside a screen, because a lock that
 * any route can be underneath has to be above all of them. It renders nothing
 * at all when unlocked, which is nearly always.
 *
 * What it deliberately does not do is stand between a guest and the app. A
 * booking needs no account on any FreshFold surface, and there is nothing on
 * the device to protect until someone signs in.
 */

/**
 * How long the app may be away before it locks again.
 *
 * A lock that snaps shut the instant the app loses focus locks the customer out
 * while they are fetching the delivery code out of their SMS, which teaches them
 * to turn the switch off. Long enough to step out to another app and come back;
 * short enough that a phone left on a table is not open.
 */
const GRACE_MS = 60_000;

export default function AppLock() {
  const { biometricEnabled, hydrated } = usePreferences();
  const { phase, isAuthenticated, biometricAvailable, biometricChecked, promptBiometric, signOut } =
    useSession();
  const { t } = useT();

  const [locked, setLocked] = useState(false);
  /** Whether the launch decision has been made. It is made exactly once. */
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Whether there is anything to lock.
   *
   * Both halves are restored asynchronously — the preference out of storage, the
   * session out of storage and then off the server — so this is false during the
   * first frames of a launch that will end up locked. Hence `armed`: the
   * decision waits for both to settle instead of being taken on a default.
   */
  const shouldLock = hydrated && phase !== 'restoring' && isAuthenticated && biometricEnabled;

  /** Read from inside the `AppState` listener, which subscribes once. */
  const shouldLockRef = useRef(shouldLock);
  useEffect(() => {
    shouldLockRef.current = shouldLock;
  }, [shouldLock]);

  /** When the app went away, or null while it is here. */
  const leftAt = useRef<number | null>(null);

  // Lock on launch, once the two async restores have both reported.
  useEffect(() => {
    if (armed) return;
    if (!hydrated || phase === 'restoring') return;
    setArmed(true);
    if (shouldLock) setLocked(true);
  }, [armed, hydrated, phase, shouldLock]);

  // Nothing signed in, nothing to protect — and this is also what clears the
  // lock when the way out of it was signing out.
  useEffect(() => {
    if (isAuthenticated) return;
    setLocked(false);
    setFailed(false);
  }, [isAuthenticated]);

  const attempt = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await promptBiometric({
        message: t('lock.prompt'),
        fallback: t('lock.fallback'),
      });
      if (ok) {
        setLocked(false);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }, [promptBiometric, t]);

  /*
   * Prompt as soon as the lock appears, so unlocking is one glance rather than a
   * tap and then a glance. Not retried on its own after a refusal: a prompt that
   * reappears the moment it is dismissed is a prompt the customer cannot get out
   * of to reach the sign-out escape below it.
   */
  useEffect(() => {
    if (!locked || busy || failed) return;
    if (!biometricAvailable) return;
    void attempt();
  }, [locked, busy, failed, biometricAvailable, attempt]);

  // Re-lock on return, if the app was away long enough to have changed hands.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        if (leftAt.current === null) leftAt.current = Date.now();
        return;
      }

      /*
       * Only `background` counts as leaving. iOS reports `inactive` for a
       * notification pulled halfway down, for the app switcher, and for the
       * system biometric sheet itself — treating those as departures would lock
       * the app behind the very prompt that is unlocking it.
       */
      if (next !== 'active') return;

      const away = leftAt.current;
      leftAt.current = null;
      if (away === null) return;
      if (Date.now() - away < GRACE_MS) return;
      if (!shouldLockRef.current) return;

      setFailed(false);
      setLocked(true);
    });

    return () => subscription.remove();
  }, []);

  /*
   * Android's back gesture still drives the router underneath a lock that is
   * only drawn on top of it. Swallowing it while locked keeps the screen the
   * customer left the one they come back to, instead of whichever screen the
   * invisible stack was popped to.
   */
  useEffect(() => {
    if (!locked) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [locked]);

  const leave = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }, [signOut]);

  if (!locked) return null;

  /**
   * The biometric went away after the switch was turned on — unenrolled, or the
   * sensor is not answering. There is then no way to prove who is holding the
   * phone, so the lock stays shut and signing out is the way past it. Only said
   * once the probe has actually reported, so a slow sensor does not get accused
   * of being absent.
   */
  const unavailable = biometricChecked && !biometricAvailable;

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.card}>
        <View style={styles.mark}>
          <Sparkles size={20} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>{t('lock.title')}</Text>
        <Text style={styles.body}>{t('lock.body')}</Text>

        {unavailable ? (
          <Text style={styles.warning}>{t('lock.unavailable')}</Text>
        ) : (
          <>
            {failed && <Text style={styles.warning}>{t('lock.failed')}</Text>}
            <Button
              label={failed ? t('lock.retry') : t('lock.unlock')}
              onPress={() => void attempt()}
              loading={busy}
              size="lg"
              icon={<Fingerprint size={15} color="#FFFFFF" />}
              style={{ alignSelf: 'stretch' }}
            />
          </>
        )}

        <Pressable onPress={() => void leave()} disabled={busy} hitSlop={8} style={styles.signOut}>
          <Text style={styles.signOutLabel}>{t('lock.signOut')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bgIvory,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    // Opaque and on top of every route. `elevation` is what Android orders
    // siblings by; without it the router's own surfaces can paint over this.
    zIndex: 100,
    elevation: 24,
  },
  card: { alignItems: 'center', gap: 12, maxWidth: 340, width: '100%' },
  mark: {
    width: 46,
    height: 46,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.3 },
  body: {
    fontSize: 11.5,
    color: colors.textSlate,
    lineHeight: 16.5,
    textAlign: 'center',
    marginBottom: 4,
  },
  warning: {
    fontSize: 10.5,
    color: colors.statusError,
    lineHeight: 14.5,
    textAlign: 'center',
    backgroundColor: tints.error08,
    borderWidth: 1,
    borderColor: tints.error25,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  signOut: { paddingVertical: 10, paddingHorizontal: 14, marginTop: 2 },
  signOutLabel: { fontSize: 11, fontWeight: '700', color: colors.textSlate },
});

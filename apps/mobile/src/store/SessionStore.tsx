/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, type RiderState } from '@freshfold/core';
import { api } from '../services/api';
import { clearSecret, readSecret, writeSecret } from '../services/secrets';

/**
 * Which courier is signed in on this device.
 *
 * The PIN goes to `/api/riders/login`, is compared server-side against the
 * roster, and comes back as a bearer token. The PIN itself is never stored and
 * is not retained after the request resolves — only the token and the courier's
 * own record are kept, and the token is what authorises every position update
 * the console publishes.
 *
 * This replaces a hard-coded rider id and a PIN checked against a list in the
 * app bundle, where every install was the same courier and the "login" proved
 * nothing.
 */

const KEYS = {
  token: 'freshfold_rider_token',
  rider: 'freshfold_rider_session',
  biometric: 'freshfold_rider_biometric',
} as const;

export type SessionPhase = 'restoring' | 'signedOut' | 'signedIn';

interface SessionState {
  phase: SessionPhase;
  /** The signed-in courier, or null. The store reads its id from here. */
  rider: RiderState | null;
  token: string | null;
  isAuthenticated: boolean;

  biometricAvailable: boolean;
  biometricEnabled: boolean;
  setBiometricEnabled: (enabled: boolean) => void;
  /** Prompts for the device biometric. Resolves false if it fails or is off. */
  promptBiometric: () => Promise<boolean>;

  /** `identifier` is an employee ID or the courier's phone number. */
  signIn: (identifier: string, pin: string) => Promise<RiderState>;
  signOut: () => Promise<void>;
  /** Locks the console without forgetting who is signed in. */
  lock: () => void;
  /**
   * Adopts a token the server has just issued in place of the current one.
   *
   * Changing a PIN revokes every session on the old one, including this
   * device's, so the route hands back a replacement. Without this the courier
   * would be signed out by the act of securing their own account.
   */
  adoptToken: (next: string) => Promise<void>;
  /** Local echo of a profile change the store has just written. */
  applyRider: (rider: RiderState) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<SessionPhase>('restoring');
  const [rider, setRider] = useState<RiderState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);

  // Restore on launch. The cached record paints immediately, then the token is
  // re-validated against the roster — a courier taken off it is signed out
  // rather than left holding a console that looks live.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [storedToken, storedRider, storedBiometric] = await Promise.all([
        readSecret(KEYS.token),
        AsyncStorage.getItem(KEYS.rider),
        readSecret(KEYS.biometric),
      ]);

      if (cancelled) return;
      setBiometricEnabledState(storedBiometric === 'true');

      if (!storedToken) {
        setPhase('signedOut');
        return;
      }

      setToken(storedToken);
      if (storedRider) {
        try {
          setRider(JSON.parse(storedRider) as RiderState);
        } catch {
          /* Corrupt cache; the re-validation below replaces it anyway. */
        }
      }

      try {
        const fresh = await api.riderMe(storedToken);
        if (cancelled) return;
        setRider(fresh);
        setPhase('signedIn');
        void AsyncStorage.setItem(KEYS.rider, JSON.stringify(fresh));
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          // Expired, revoked, or off the roster. Either way this device is no
          // longer a courier.
          setToken(null);
          setRider(null);
          setPhase('signedOut');
          void Promise.all([clearSecret(KEYS.token), AsyncStorage.removeItem(KEYS.rider)]);
        } else {
          // Server unreachable. Keep the cached identity rather than locking a
          // courier out of their own job because the signal dropped.
          setPhase(storedRider ? 'signedIn' : 'signedOut');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!cancelled) setBiometricAvailable(hasHardware && enrolled);
    })().catch(() => {
      if (!cancelled) setBiometricAvailable(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback<SessionState['signIn']>(async (identifier, pin) => {
    const session = await api.riderLogin({ identifier: identifier.trim(), pin });

    setToken(session.token);
    setRider(session.rider);
    setLocked(false);
    setPhase('signedIn');

    // The token goes to the keychain, the courier record to ordinary storage.
    // They cannot share a `multiSet` any more, and should not: one of them is a
    // credential and the other is a copy of what that credential fetches.
    await Promise.all([
      writeSecret(KEYS.token, session.token),
      AsyncStorage.setItem(KEYS.rider, JSON.stringify(session.rider)),
    ]);

    return session.rider;
  }, []);

  const adoptToken = useCallback(async (next: string) => {
    setToken(next);
    await writeSecret(KEYS.token, next);
  }, []);

  const signOut = useCallback(async () => {
    const current = token;

    setToken(null);
    setRider(null);
    setLocked(false);
    setPhase('signedOut');
    await Promise.all([clearSecret(KEYS.token), AsyncStorage.removeItem(KEYS.rider)]);

    if (current) {
      try {
        await api.riderLogout(current);
      } catch {
        // Already signed out locally; a failed revoke leaves a token to expire.
      }
    }
  }, [token]);

  const lock = useCallback(() => setLocked(true), []);

  const applyRider = useCallback((next: RiderState) => {
    setRider(next);
    void AsyncStorage.setItem(KEYS.rider, JSON.stringify(next));
  }, []);

  const setBiometricEnabled = useCallback((enabled: boolean) => {
    setBiometricEnabledState(enabled);
    void writeSecret(KEYS.biometric, String(enabled));
  }, []);

  const promptBiometric = useCallback(async () => {
    if (!biometricAvailable) return false;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock the rider console',
        fallbackLabel: 'Use access PIN',
      });
      if (result.success) setLocked(false);
      return result.success;
    } catch {
      return false;
    }
  }, [biometricAvailable]);

  const value = useMemo<SessionState>(
    () => ({
      phase,
      rider,
      token,
      isAuthenticated: phase === 'signedIn' && !!rider && !locked,
      biometricAvailable,
      biometricEnabled,
      setBiometricEnabled,
      promptBiometric,
      signIn,
      signOut,
      adoptToken,
      lock,
      applyRider,
    }),
    [
      phase,
      rider,
      token,
      locked,
      biometricAvailable,
      biometricEnabled,
      setBiometricEnabled,
      promptBiometric,
      signIn,
      signOut,
      adoptToken,
      lock,
      applyRider,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as LocalAuthentication from 'expo-local-authentication';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, type UserAccount } from '@freshfold/core';
import { api } from '../services/api';
import { STORAGE_KEYS, readJson, remove, writeJson } from '../services/storage';
import { clearSecret, readSecret, writeSecret } from '../services/secrets';

/**
 * Who is signed in on this device.
 *
 * Credentials never live here. A sign-in posts the attempt to
 * `/api/auth/login`, which compares it server-side and returns a bearer token;
 * this store keeps the token and the profile, exactly as the website's store
 * does. The password is not retained after the request completes.
 *
 * The app is usable signed out — the marketing catalogue and the booking flow
 * both work for a visitor, matching the website, where a booking does not
 * require an account. `isGuest` is that state, and it is distinct from
 * "still restoring", so the router doesn't flash the sign-in screen on launch.
 */

export type SessionPhase = 'restoring' | 'guest' | 'authenticated';

interface SessionState {
  phase: SessionPhase;
  account: UserAccount | null;
  token: string | null;
  isAuthenticated: boolean;

  /**
   * Whether the device can do Face ID / fingerprint at all.
   *
   * Whether the customer has *opted into* it is a preference, and lives in
   * `PreferencesStore` — this store only owns the `expo-local-authentication`
   * calls.
   */
  biometricAvailable: boolean;
  /**
   * Whether the check above has actually run.
   *
   * `biometricAvailable` is false both while the probe is in flight and when the
   * answer is no, and the lock screen has to tell those apart: it must not tell
   * a customer their sensor is gone during the two frames before the sensor
   * answers.
   */
  biometricChecked: boolean;
  /**
   * Prompts for the device biometric. Resolves false if it fails or is off.
   *
   * The wording is the caller's, because this store has no dictionary and the
   * sheet is the customer's own language everywhere else. The device passcode
   * fallback is left enabled: it authenticates the person holding the phone just
   * as well, and a lock with no second route is a lock that strands whoever's
   * sensor is wet.
   */
  promptBiometric: (prompt?: { message: string; fallback: string }) => Promise<boolean>;

  signIn: (identifier: string, password: string) => Promise<UserAccount>;
  register: (payload: {
    name: string;
    email: string;
    phone: string;
    password: string;
  }) => Promise<UserAccount>;
  /** Does this contact already have a login? Lets the UI offer the right path. */
  checkContact: (identifier: string) => Promise<{ exists: boolean; hasPassword: boolean }>;
  /**
   * Mails a reset link to whatever address is on the account.
   *
   * Resolves the same way for a contact with no account as for one with a
   * password — the server refuses to distinguish them, so neither can this.
   * Rejects only when the request could not be made at all.
   */
  requestPasswordReset: (identifier: string) => Promise<void>;
  /**
   * Asks for another email-confirmation link.
   *
   * Rejects with the server's own message when the address is already
   * confirmed or the resend cooldown is still running, both of which are worth
   * showing the customer rather than flattening into "something went wrong".
   */
  resendVerification: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Closes the account on the server, then signs this device out of it.
   *
   * Rejects with the server's own `ApiError`: a 409 while a pickup is still out
   * carries the sentence worth showing, so a caller should surface
   * `error.message` rather than flatten it. Nothing local is touched unless the
   * server agreed — a refusal leaves the customer signed into an account that
   * still exists.
   *
   * Clears this store's two keys only. The orders, messages, addresses and
   * pending writes on the device belong to the client store, which owns those
   * keys and drops them through `forgetLocalData` — the screen doing the
   * deleting calls both.
   */
  deleteAccount: () => Promise<void>;
  /** Continue without an account — bookings still work. */
  continueAsGuest: () => void;
  /** Local profile update, mirrored to `/api/accounts` by the client store. */
  applyAccount: (account: UserAccount) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<SessionPhase>('restoring');
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricChecked, setBiometricChecked] = useState(false);

  // Restore on launch: the cached profile paints immediately, then the token is
  // re-validated. A token the server no longer honours drops the session rather
  // than leaving the app showing someone who is not really signed in.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [storedToken, storedAccount] = await Promise.all([
        readSecret(STORAGE_KEYS.token),
        readJson<UserAccount | null>(STORAGE_KEYS.account, null),
      ]);

      if (cancelled) return;

      if (!storedToken) {
        setPhase('guest');
        return;
      }

      setAccount(storedAccount);
      setToken(storedToken);

      try {
        const fresh = await api.me(storedToken);
        if (cancelled) return;
        setAccount(fresh);
        setPhase('authenticated');
        void writeJson(STORAGE_KEYS.account, fresh);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setAccount(null);
          setToken(null);
          setPhase('guest');
          void Promise.all([clearSecret(STORAGE_KEYS.token), remove(STORAGE_KEYS.account)]);
        } else {
          // Server unreachable — keep the cached profile rather than signing
          // someone out every time their connection drops.
          setPhase(storedAccount ? 'authenticated' : 'guest');
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
      if (!cancelled) {
        setBiometricAvailable(hasHardware && enrolled);
        setBiometricChecked(true);
      }
    })().catch(() => {
      if (!cancelled) {
        setBiometricAvailable(false);
        setBiometricChecked(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((next: { token: string; account: UserAccount }) => {
    setToken(next.token);
    setAccount(next.account);
    setPhase('authenticated');
    void writeSecret(STORAGE_KEYS.token, next.token);
    void writeJson(STORAGE_KEYS.account, next.account);
    return next.account;
  }, []);

  const signIn = useCallback<SessionState['signIn']>(
    async (identifier, password) => adopt(await api.login({ identifier, password })),
    [adopt]
  );

  const register = useCallback<SessionState['register']>(
    async (payload) => adopt(await api.register(payload)),
    [adopt]
  );

  const checkContact = useCallback<SessionState['checkContact']>(
    (identifier) => api.authStatus(identifier),
    []
  );

  const requestPasswordReset = useCallback<SessionState['requestPasswordReset']>(
    async (identifier) => {
      await api.requestPasswordReset(identifier);
    },
    []
  );

  const resendVerification = useCallback<SessionState['resendVerification']>(async () => {
    if (!token) throw new Error('Sign in to request a new link.');
    await api.resendVerification(token);
  }, [token]);

  const signOut = useCallback(async () => {
    const current = token;

    setAccount(null);
    setToken(null);
    setPhase('guest');
    await Promise.all([clearSecret(STORAGE_KEYS.token), remove(STORAGE_KEYS.account)]);

    if (current) {
      try {
        await api.logout(current);
      } catch {
        // Already signed out locally; a failed revoke just leaves a token to
        // expire on its own.
      }
    }
  }, [token]);

  /**
   * The server closes the account, and only then does the device let go.
   *
   * No `api.logout` afterwards: the delete revoked every session for this
   * account, the caller's included, so there is nothing left to revoke and the
   * call would only 401.
   */
  const deleteAccount = useCallback<SessionState['deleteAccount']>(async () => {
    if (!token) throw new Error('Sign in to close your account.');

    await api.deleteOwnAccount(token);

    setAccount(null);
    setToken(null);
    setPhase('guest');
    await Promise.all([clearSecret(STORAGE_KEYS.token), remove(STORAGE_KEYS.account)]);
  }, [token]);

  const continueAsGuest = useCallback(() => setPhase('guest'), []);
  const applyAccount = useCallback((next: UserAccount) => {
    setAccount(next);
    void writeJson(STORAGE_KEYS.account, next);
  }, []);

  const promptBiometric = useCallback<SessionState['promptBiometric']>(
    async (prompt) => {
      if (!biometricAvailable) return false;
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: prompt?.message ?? 'Unlock FreshFold',
          fallbackLabel: prompt?.fallback ?? 'Use device passcode',
        });
        return result.success;
      } catch {
        return false;
      }
    },
    [biometricAvailable]
  );

  const value = useMemo<SessionState>(
    () => ({
      phase,
      account,
      token,
      isAuthenticated: phase === 'authenticated' && !!account,
      biometricAvailable,
      biometricChecked,
      promptBiometric,
      signIn,
      register,
      checkContact,
      requestPasswordReset,
      resendVerification,
      signOut,
      deleteAccount,
      continueAsGuest,
      applyAccount,
    }),
    [
      phase,
      account,
      token,
      biometricAvailable,
      biometricChecked,
      promptBiometric,
      signIn,
      register,
      checkContact,
      requestPasswordReset,
      resendVerification,
      signOut,
      deleteAccount,
      continueAsGuest,
      applyAccount,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

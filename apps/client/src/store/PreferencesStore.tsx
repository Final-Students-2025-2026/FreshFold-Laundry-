/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Notification } from '@freshfold/core';
import { LOCALES, type Locale } from '../i18n/locales';
import { STORAGE_KEYS, readJson, writeJson } from '../services/storage';

/**
 * How this device is set up, as against who is signed in on it.
 *
 * These are the settings screen's own state, and every one of them is
 * device-local by necessity: `UserAccount` has no preferences field, so there is
 * nowhere on the server to put them. That is the right answer for most of them
 * anyway — biometric unlock is a property of the handset, and a customer reading
 * in Spanish on their phone has not said anything about the browser they use.
 *
 * One owner for `STORAGE_KEYS.preferences`, deliberately. `biometricEnabled`
 * used to be written here by `SessionStore` with a whole-object `writeJson`,
 * which is why it had to move: two providers writing one key that way delete
 * each other's fields.
 */

/** Follow the OS, or override it. */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * The reading language. `system` takes the device's own, which is what a fresh
 * install gets.
 *
 * Built from `Locale` rather than written out again, so publishing a sixth
 * language is one edit in `src/i18n/locales.ts`. Spelling the union twice is how
 * you end up with a picker offering a language the validator below quietly
 * refuses to store.
 */
export type LocalePreference = 'system' | Locale;

/**
 * The alert kinds a customer may silence.
 *
 * `Notification['type']` has a fourth, `system`, and it is missing here on
 * purpose: those are the notices the desk uses to reach everybody — a closure,
 * a service change — and a switch that hides them would hide the one message
 * that most needed reading.
 */
export type AlertKind = 'order' | 'message' | 'alert';

export interface Preferences {
  /** Whether the customer has opted into Face ID / fingerprint. */
  biometricEnabled: boolean;
  /** Which alert kinds reach the notifications feed and the bell. */
  alertTypes: Record<AlertKind, boolean>;
  theme: ThemePreference;
  locale: LocalePreference;
}

interface PreferencesState extends Preferences {
  /** False until AsyncStorage has been read, as in the client store. */
  hydrated: boolean;
  setBiometricEnabled: (enabled: boolean) => void;
  setAlertType: (kind: AlertKind, enabled: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: LocalePreference) => void;
  /** Whether a notification of this type should be shown and counted. */
  allowsAlert: (type: Notification['type']) => boolean;
}

const ALERT_KINDS: AlertKind[] = ['order', 'message', 'alert'];

const DEFAULTS: Preferences = {
  biometricEnabled: false,
  alertTypes: { order: true, message: true, alert: true },
  theme: 'system',
  locale: 'system',
};

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];
const LOCALE_PREFERENCES: LocalePreference[] = ['system', ...LOCALES];

/**
 * Reads whatever is in storage into the current shape.
 *
 * Every field is validated rather than trusted, because the file on disk was
 * written by an older build — the first one held `{ biometricEnabled }` and
 * nothing else — and because a later build will add fields this one has never
 * heard of. Anything unrecognised falls back to the default instead of putting
 * a bad value on screen.
 */
function coerce(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return DEFAULTS;
  const stored = raw as Partial<Preferences>;

  const alertTypes = { ...DEFAULTS.alertTypes };
  if (stored.alertTypes && typeof stored.alertTypes === 'object') {
    for (const kind of ALERT_KINDS) {
      const value = stored.alertTypes[kind];
      if (typeof value === 'boolean') alertTypes[kind] = value;
    }
  }

  return {
    biometricEnabled: stored.biometricEnabled === true,
    alertTypes,
    theme: THEMES.includes(stored.theme as ThemePreference)
      ? (stored.theme as ThemePreference)
      : DEFAULTS.theme,
    locale: LOCALE_PREFERENCES.includes(stored.locale as LocalePreference)
      ? (stored.locale as LocalePreference)
      : DEFAULTS.locale,
  };
}

const PreferencesContext = createContext<PreferencesState | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  /**
   * Changes made before the stored file came back, kept so they can be replayed.
   *
   * The read below is asynchronous, so in principle a switch could be flipped
   * while it is still in flight, and landing the stored value on top of that
   * would silently undo it. Discarding the stored value instead — which is what
   * this used to do — is the worse trade: one file holds the language, the
   * theme, the biometric opt-in *and* all three alert toggles, so an early tap
   * on any one of them threw away the other five, and the persist effect below
   * then wrote those defaults back over what the customer had actually chosen.
   *
   * So neither side is dropped. The stored file is the base and the early
   * changes go on top of it, which is the order they would have happened in had
   * the read been instant. Every patch here is an idempotent field set, so
   * replaying one that already reached `preferences` lands on the same value.
   */
  const early = useRef<((current: Preferences) => Preferences)[]>([]);

  /** Mirrors `hydrated` for `update`, which must not re-create itself on it. */
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await readJson<unknown>(STORAGE_KEYS.preferences, null);
      if (cancelled) return;

      const base = coerce(stored);
      setPreferences(early.current.reduce((current, patch) => patch(current), base));
      early.current = [];

      // Before `setHydrated`, so a change arriving between the two is treated as
      // what it is — a change to a hydrated store — rather than queued a second
      // time into a list nothing will replay again.
      hydratedRef.current = true;
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist after hydration only — writing before it would race the read. The
  // one write this fires on hydration itself is worth having: it migrates a
  // file left by an older build into the current shape.
  useEffect(() => {
    if (!hydrated) return;
    void writeJson(STORAGE_KEYS.preferences, preferences);
  }, [hydrated, preferences]);

  const update = useCallback((patch: (current: Preferences) => Preferences) => {
    if (!hydratedRef.current) early.current.push(patch);
    setPreferences((current) => {
      const next = patch(current);
      return next === current ? current : next;
    });
  }, []);

  const setBiometricEnabled = useCallback(
    (enabled: boolean) => update((current) => ({ ...current, biometricEnabled: enabled })),
    [update]
  );

  const setAlertType = useCallback(
    (kind: AlertKind, enabled: boolean) =>
      update((current) => ({
        ...current,
        alertTypes: { ...current.alertTypes, [kind]: enabled },
      })),
    [update]
  );

  const setTheme = useCallback(
    (theme: ThemePreference) => update((current) => ({ ...current, theme })),
    [update]
  );

  const setLocale = useCallback(
    (locale: LocalePreference) => update((current) => ({ ...current, locale })),
    [update]
  );

  const allowsAlert = useCallback(
    (type: Notification['type']) =>
      // `system` is not in `alertTypes` and is never filtered — see AlertKind.
      type === 'system' ? true : preferences.alertTypes[type] !== false,
    [preferences.alertTypes]
  );

  const value = useMemo<PreferencesState>(
    () => ({
      ...preferences,
      hydrated,
      setBiometricEnabled,
      setAlertType,
      setTheme,
      setLocale,
      allowsAlert,
    }),
    [preferences, hydrated, setBiometricEnabled, setAlertType, setTheme, setLocale, allowsAlert]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesState {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}

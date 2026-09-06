/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A thin JSON layer over AsyncStorage.
 *
 * The website's store reads `localStorage` synchronously, which lets its first
 * paint have data. AsyncStorage has no synchronous read, so the store built on
 * top of this hydrates once at startup and holds the mirror in memory
 * afterwards — every read after hydration is synchronous again.
 */

export const STORAGE_KEYS = {
  bookings: 'freshfold_client_bookings',
  account: 'freshfold_client_account',
  token: 'freshfold_client_token',
  queue: 'freshfold_client_queue',
  messages: 'freshfold_client_messages',
  notifications: 'freshfold_client_notifications',
  transactions: 'freshfold_client_transactions',
  addresses: 'freshfold_client_addresses',
  preferences: 'freshfold_client_preferences',
  /**
   * Per-booking tracking grants, by booking id.
   *
   * A visitor books without an account, so a session is not what entitles them
   * to read the order back — this is. The server hands one over with the 201, and
   * it is the only claim the device has on that pickup until the customer sets a
   * password from the emailed link.
   */
  trackingTokens: 'freshfold_client_tracking_tokens',
  /**
   * Where the membership used to live.
   *
   * A plan is a paid entitlement and now belongs to the account on the server —
   * this key is only read to delete it, so a device that subscribed under the
   * old build stops showing a plan the server does not know about. Remove the
   * cleanup, and this key, once no install predates the change.
   */
  legacyPlan: 'freshfold_client_plan',
} as const;

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Corrupt payload or storage unavailable. The in-memory mirror is still
    // authoritative for this session, so carry on with the fallback.
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Quota or storage disabled — see readJson. */
  }
}

export async function readString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writeString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* see writeJson */
  }
}

export async function remove(...keys: string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {
    /* see writeJson */
  }
}

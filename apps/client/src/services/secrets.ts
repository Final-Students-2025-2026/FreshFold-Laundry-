/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Where a bearer token lives on this device.
 *
 * Separate from `./storage` on purpose, and the separation is the point.
 * AsyncStorage is an unencrypted store in the app sandbox — a SQLite file on
 * Android, a plist-backed file on iOS — and the session token was sitting in
 * it. That token is good for a week and reads the customer's saved addresses,
 * their whole order history and their wallet, so it was readable from an
 * unencrypted device backup, from any process on a rooted or jailbroken
 * handset, and over `adb` on a debuggable build.
 *
 * Everything else the app caches — orders, messages, addresses, the queue of
 * pending writes — stays where it was. Those are a copy of what the token can
 * already fetch; the token is the thing that fetches them.
 *
 * The web app reasoned about exactly this in `apps/web/src/services/store.ts`
 * and landed somewhere different for a good reason: a browser has no keychain,
 * so the choice there is only between one script-readable box and another.
 * A phone does have one, and this is it.
 */

/** iOS Keychain and Android EncryptedSharedPreferences; neither exists on web. */
const NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Reads a secret, moving it out of AsyncStorage the first time if it is still
 * there.
 *
 * The migration is what stops this change signing everybody out. An install
 * that predates it has a perfectly good token in the old place; finding
 * nothing in the keychain and stopping there would have logged out every
 * existing customer on upgrade, which is the kind of security fix people
 * remember for the wrong reason.
 *
 * The plaintext copy is deleted once the secure one is written, and in that
 * order: a crash between the two leaves the token readable in the old place,
 * which is where it already was, while the reverse would lose the session
 * outright.
 */
export async function readSecret(key: string): Promise<string | null> {
  if (!NATIVE) return readWebFallback(key);

  try {
    const secure = await SecureStore.getItemAsync(key);
    if (secure !== null) return secure;
  } catch {
    // Keychain unavailable on this device. Fall through to the legacy read so
    // an existing session still restores; nothing new is written in plaintext.
  }

  let legacy: string | null = null;
  try {
    legacy = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }

  if (legacy === null) return null;

  try {
    await SecureStore.setItemAsync(key, legacy);
    await AsyncStorage.removeItem(key);
  } catch {
    // Could not move it. Returning it anyway keeps the customer signed in; the
    // next launch tries the migration again.
  }

  return legacy;
}

/**
 * Writes a secret.
 *
 * **On a phone this never falls back to plaintext.** If the keychain refuses,
 * the token simply is not persisted: the customer stays signed in for this
 * session, because the token is in memory, and signs in again next launch.
 * That is a worse morning than a silent write to AsyncStorage would be, and it
 * is the right trade — a token quietly stored in the clear is indistinguishable
 * from one stored properly until somebody dumps the device, which is exactly
 * the failure this module exists to remove.
 */
export async function writeSecret(key: string, value: string): Promise<void> {
  if (!NATIVE) {
    await writeWebFallback(key, value);
    return;
  }

  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.warn(
      `[secrets] could not write ${key} to the keychain; this session will not survive a restart.`,
      error
    );
  }
}

/** Clears a secret from both stores, so a sign-out leaves nothing behind. */
export async function clearSecret(...keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      if (NATIVE) {
        // Both, deliberately: an install that has not been read since the
        // migration landed may still have the old plaintext copy, and signing
        // out has to remove that too.
        await SecureStore.deleteItemAsync(key).catch(() => {});
      }
      await AsyncStorage.removeItem(key).catch(() => {});
    })
  );
}

/**
 * Web has no keychain, so the token goes where every other browser session
 * token goes.
 *
 * Stated rather than hidden: this is not a secure store, it is the platform's
 * own boundary. Any script running on this origin can read it, which is the
 * same exposure the website itself has and documents. The native path above is
 * the one this module was written for.
 */
async function readWebFallback(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeWebFallback(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* Quota, or storage disabled in this browser. */
  }
}

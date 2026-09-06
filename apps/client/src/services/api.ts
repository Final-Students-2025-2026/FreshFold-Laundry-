/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Constants from 'expo-constants';
import { createClient } from '@freshfold/core';

/**
 * The customer app's connection to the dispatch server.
 *
 * Same resolution strategy as the rider app: a phone cannot reach `localhost`
 * on your laptop, so the address has to be a LAN one, and rather than making
 * that a setup step it is derived from the Expo dev server the app was loaded
 * from — which in every normal development setup is the same machine the
 * dispatch server runs on.
 */

const DEFAULT_PORT = 4000;

function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  // e.g. "192.168.1.42:8081" while running under Expo Go.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${DEFAULT_PORT}`;

  // Standalone build with nothing configured. Works in a simulator; a real
  // device needs EXPO_PUBLIC_API_URL set.
  return `http://localhost:${DEFAULT_PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();

/**
 * Eight seconds is the budget for a request the server is awake to serve. The
 * far longer budget for one that has to wake it first is `createClient`'s own
 * — see `COLD_START_TIMEOUT_MS` — and it is spent only on a host that can sleep.
 * The Render URL an EAS build is pointed at can; the LAN address a dev gets
 * cannot, so a phone on the wrong Wi-Fi still says so in eight seconds rather
 * than in a minute.
 */
export const api = createClient({ baseUrl: API_BASE_URL, timeoutMs: 8000 });

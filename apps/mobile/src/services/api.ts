/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Constants from 'expo-constants';
import { createClient } from '@freshfold/core';

/**
 * The rider app's connection to the dispatch server.
 *
 * A phone cannot reach `localhost` on your laptop, so the address has to be a
 * LAN one. Rather than making that a setup step, the default is derived from
 * the Expo dev server the app was loaded from — which is running on the same
 * machine as the dispatch server in every normal development setup.
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
 * Six seconds is the budget for a request the server is awake to serve, which
 * is the right patience for the four-second poll and is argued for below.
 * Waking a sleeping Render instance is a different job and gets its own minute
 * inside `createClient` — see `COLD_START_TIMEOUT_MS`. Only the hosted URL an
 * EAS build carries can be asleep, so a dev's LAN address is untouched by it.
 */
export const api = createClient({ baseUrl: API_BASE_URL, timeoutMs: 6000 });

/**
 * The same server, for the calls that are allowed to take their time.
 *
 * Six seconds is the right patience for the four-second poll: a board that has
 * not arrived by then is one the next tick will fetch anyway. It is the wrong
 * patience for everything else, for two reasons that compound.
 *
 * A write is slow in proportion to the job it lands on, not to what it carries:
 * the store keeps a job as one document and rewrites the whole of it, base64
 * proof photographs included, inside the transaction that moves the status. A
 * measured status write against a job holding a pickup and a delivery photo
 * took over six seconds *on localhost*, with no network in it at all.
 *
 * And a write has no second chance. A poll that gives up is repeated four
 * seconds later; a hand-off that gives up has already changed the board and
 * been reported to the courier as lost — which is how a delivery the customer
 * has been told is complete ends up back on the board asking to be redone.
 */
export const patientApi = createClient({ baseUrl: API_BASE_URL, timeoutMs: 30000 });

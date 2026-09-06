/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Constants from 'expo-constants';
import * as Linking from 'expo-linking';

import { ownsAddress } from './schemes';

/** Which checkout the browser took the screen for. */
export type CheckoutFlow = 'wallet' | 'book';

/** The URL schemes this build registered, as `app.config.js` declares them. */
function declaredSchemes(): string[] {
  const declared = Constants.expoConfig?.scheme;
  if (Array.isArray(declared)) return declared;
  return declared ? [declared] : [];
}

/**
 * Where Paystack should send the customer once the payment is done — or
 * nothing, when this build has no address of its own to offer.
 *
 * A build that owns its scheme gets the deep link it has always had:
 * `freshfoldclient://paystack-success?flow=…`, which the OS hands back to the
 * app and `app/paystack-success.tsx` turns into a return to the screen that
 * opened the checkout. Standalone, EAS preview and development builds all
 * qualify.
 *
 * Expo Go does not, and asking anyway is what broke every card payment made
 * from it. `Linking.createURL` answers with whatever scheme is carrying the
 * app, and under Expo Go that is Expo Go's own `exp://<dev-host>:8081/--/…`.
 * `/paystack/initialize` carries no session, so a callback the server cannot
 * tie to one of our own apps is an open redirect on the real gateway at the
 * highest-trust moment in the flow; production therefore refuses `exp`
 * outright — see `callbackPolicy` in apps/server/src/routes/integrations.ts,
 * and the customer app's `.env` points at that production server. The refusal
 * came back as "that is not a return address this server will send a customer
 * to", printed under the Pay button, and no top-up or card booking could be
 * started at all.
 *
 * Sending nothing is not a silent downgrade of that check. The server falls
 * back to its own `APP_URL`, the checkout opens, and the customer finishes on
 * the page and confirms with the button the sheet already shows — the same path
 * a browser that refuses to open takes. A real build still names its own scheme,
 * so a deployment that has the allow-list wrong still fails loudly, in test,
 * rather than quietly in front of someone paying.
 */
export function paystackReturnUrl(flow: CheckoutFlow): string | undefined {
  const url = Linking.createURL('paystack-success', { queryParams: { flow } });
  return ownsAddress(url, declaredSchemes()) ? url : undefined;
}

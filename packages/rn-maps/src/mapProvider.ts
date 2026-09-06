/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Platform } from 'react-native';
import { PROVIDER_DEFAULT, PROVIDER_GOOGLE, type Provider } from 'react-native-maps';

/**
 * One map vendor across the product.
 *
 * The courier's map, the customer's map and the supervisor's console all draw
 * Google roads, so a pin discussed over the phone means the same thing on all
 * three screens — the same reason ride-hailing apps do not switch vendors
 * between platforms.
 *
 * The exception is iOS without a key. Google Maps on iOS needs one compiled
 * into the binary (`EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`, wired through each app's
 * `app.config.js`), and asking for `PROVIDER_GOOGLE` without it renders a blank
 * grey rectangle rather than falling back on its own. Apple Maps is a map; a
 * grey rectangle is not.
 */
export const MAP_PROVIDER: Provider = Platform.select<Provider>({
  android: PROVIDER_GOOGLE,
  ios: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ? PROVIDER_GOOGLE : PROVIDER_DEFAULT,
  default: PROVIDER_DEFAULT,
});

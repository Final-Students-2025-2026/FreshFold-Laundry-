/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import MapFallback from './MapFallback';

/** `react-native-maps` has no web implementation, so the browser gets the panel. */
export default function LiveMapWeb(props: React.ComponentProps<typeof MapFallback>) {
  return (
    <MapFallback
      {...props}
      notice="Live tiles render on iOS and Android. Open the app in Expo Go to see the map."
    />
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import PickupPinPanel, { type PickupPinPickerProps } from './PickupPinPanel';

/**
 * `react-native-maps` has no web implementation — importing it here is a
 * bundling failure rather than a runtime one, which is why this file exists at
 * all. The browser still sets a real pin: the device fix works through the
 * browser's own geolocation, and the suburb centre is always available.
 */
export default function PickupPinPickerWeb(props: PickupPinPickerProps) {
  return (
    <PickupPinPanel
      {...props}
      notice="The Google map renders on iOS and Android; open the app in Expo Go for it."
    />
  );
}

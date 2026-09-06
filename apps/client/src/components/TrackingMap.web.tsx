/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import MapPanel from './MapPanel';
import { useT } from '../i18n';

/** `react-native-maps` has no web implementation, so the browser gets the panel. */
export default function TrackingMapWeb(props: React.ComponentProps<typeof MapPanel>) {
  const { t } = useT();

  return <MapPanel {...props} notice={t('map.expoNotice')} />;
}

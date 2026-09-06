/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useApp } from '../store/AppStore';
import { colors } from '../theme';

/**
 * Swipe down to pull the board now.
 *
 * The console already polls every four seconds, so this is not how a courier
 * gets fresh data — it is how they *check*. Standing at a door wondering
 * whether dispatch has assigned the vehicle yet, the honest answer is a
 * gesture away rather than a wait of unknown length, and the spinner lasting
 * exactly as long as the round trip is what makes the answer believable.
 *
 * A minimum visible spell is deliberate: a refresh that resolves in 40ms reads
 * as a control that did nothing at all.
 */
const MINIMUM_SPINNER_MS = 450;

export function usePullToRefresh(): React.ReactElement<RefreshControlProps> {
  const { refresh } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  /** Guards against a second pull landing while the first is still out. */
  const inFlight = useRef(false);

  const onRefresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);

    const started = Date.now();
    try {
      await refresh();
    } finally {
      const elapsed = Date.now() - started;
      setTimeout(
        () => {
          setRefreshing(false);
          inFlight.current = false;
        },
        Math.max(0, MINIMUM_SPINNER_MS - elapsed)
      );
    }
  }, [refresh]);

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.brandSage}
      colors={[colors.brandSage]}
      progressBackgroundColor={colors.cardPure}
    />
  );
}

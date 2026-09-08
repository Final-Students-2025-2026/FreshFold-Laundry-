/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardEvent,
  Platform,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Lifts its contents clear of the soft keyboard.
 *
 * This exists instead of React Native's `KeyboardAvoidingView`, which cannot
 * work in either app: both run edge-to-edge on Android (`edgeToEdgeEnabled` in
 * app.config.js, and since SDK 54 there is no way out of it), and an edge-to-edge
 * window is never resized when the keyboard opens. `KeyboardAvoidingView`
 * works out how far to move by comparing its own bottom edge against the
 * keyboard's reported top, and on Android that top is reported as the bottom
 * of the window that never shrank — so it computes an overlap of zero and
 * leaves every composer and form sitting underneath the keyboard. Passing
 * `behavior={undefined}` there, as these screens used to, made that explicit.
 *
 * The measurement below is the one that holds on both platforms: how far the
 * keyboard reaches up from the bottom of the screen, less whatever already
 * sits between this view and that bottom edge — a tab bar, a safe-area inset,
 * or the shrunken window if a future Android build does resize after all.
 * Nothing is assumed about the surrounding layout, so a view already clear of
 * the keyboard is left where it is.
 *
 * Kept in step with the copy in the customer app, alongside `ui.tsx` and the
 * theme: the two apps share a look, not a bundle.
 */

/** iOS announces the keyboard before it moves; Android only once it has. */
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

export function KeyboardAvoider({
  children,
  style,
  offset = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Extra breathing room between the content and the keyboard. */
  offset?: number;
}) {
  const insets = useSafeAreaInsets();
  const viewRef = useRef<View | null>(null);
  const eventRef = useRef<KeyboardEvent | null>(null);
  const [overlap, setOverlap] = useState(0);

  const measure = useCallback(() => {
    const event = eventRef.current;
    if (!event) {
      setOverlap(0);
      return;
    }

    const node = viewRef.current;
    if (!node) return;

    node.measureInWindow((_x, y, _width, height) => {
      // The keyboard may have closed while the measurement was in flight.
      if (!eventRef.current) return;

      const screen = Dimensions.get('screen').height;

      // How far up the screen the keyboard reaches. iOS reports the top edge
      // of the keyboard; Android reports its height above the navigation bar,
      // which the keyboard is drawn over.
      const reach =
        Platform.OS === 'ios'
          ? screen - event.endCoordinates.screenY
          : event.endCoordinates.height + insets.bottom;

      const below = Math.max(screen - (y + height), 0);

      setOverlap(Math.max(reach - below + offset, 0));
    });
  }, [insets.bottom, offset]);

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, (event) => {
      eventRef.current = event;
      // Rides the keyboard's own curve and duration where the platform gives
      // us one, so the content and the keyboard move together.
      Keyboard.scheduleLayoutAnimation(event);
      measure();
    });

    const hide = Keyboard.addListener(HIDE_EVENT, (event) => {
      eventRef.current = null;
      Keyboard.scheduleLayoutAnimation(event);
      setOverlap(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [measure]);

  return (
    <View
      ref={viewRef}
      // A composer that grows, a rotation, a header that changes height: the
      // view has moved, so what the keyboard covers of it has changed too.
      onLayout={measure}
      style={[{ flex: 1 }, style, { paddingBottom: overlap }]}
    >
      {children}
    </View>
  );
}

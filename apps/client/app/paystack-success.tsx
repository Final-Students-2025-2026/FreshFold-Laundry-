/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../src/theme';

/**
 * Where Paystack sends the customer back to.
 *
 * Both checkouts hand Paystack this app's own `paystack-success` deep link as
 * their `callback_url` — see `paystackReturnUrl`, which withholds it under Expo
 * Go, where the only address on offer belongs to Expo Go rather than to us. A
 * completed payment then redirects the browser to
 * `freshfoldclient://paystack-success` and the OS hands that to this app. Until
 * this file existed that URL matched no route — the root layout names its
 * screens explicitly and there is no `+not-found` — so the one customer we most
 * wanted to reassure, the one who had just paid, arrived at expo-router's
 * unmatched-route screen instead.
 *
 * It deliberately does not collect the payment. The reference belongs to the
 * screen that opened the checkout, together with the amount or the booking it
 * settles, and that screen already has an “I have paid” button wired to it. So
 * the job here is only to hand the customer back to it — and by `back()` rather
 * than a fresh navigation, precisely because a remount would drop that
 * reference and take the button with it.
 *
 * `flow` is the cold-start fallback. If the OS reclaimed the app while the
 * browser was in front there is nothing beneath this screen to return to, and
 * the query param is the only surviving record of which checkout this was.
 * Nothing is collectable in that case — the reference went with the process —
 * but the customer at least lands where they were working rather than nowhere.
 */
export default function PaystackSuccess() {
  const router = useRouter();
  const { flow } = useLocalSearchParams<{ flow?: string }>();

  useEffect(() => {
    // iOS leaves the browser sheet sitting over the app after a redirect.
    // Android's custom tab is already behind us by the time the intent lands,
    // and rejects this call rather than implementing it.
    WebBrowser.dismissBrowser().catch(() => {});

    if (router.canGoBack()) router.back();
    else if (flow === 'book') router.replace('/(tabs)/book');
    else router.replace('/(tabs)/wallet');
  }, [flow, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.brandSage} />
      <Text style={styles.label}>Returning you to FreshFold…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgIvory,
    gap: 12,
  },
  label: { fontSize: 12.5, color: colors.textSlate },
});

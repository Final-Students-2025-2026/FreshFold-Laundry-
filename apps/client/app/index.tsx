/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useClient } from '../src/store/ClientStore';
import { useSession } from '../src/store/SessionStore';
import { colors, tints } from '../src/theme';

/**
 * The launch gate.
 *
 * Two things have to settle before the app can route: the stored session
 * (which decides whether we know who this is) and the cached ledger (so the
 * first painted screen has data instead of an empty state that fills in a
 * frame later). Both are fast — this is a splash, not a loading screen.
 *
 * Note that a guest is *not* redirected to sign-in. The website takes bookings
 * from visitors who have no account, and so does this app; `/auth` is offered
 * from the account tab and from checkout, not imposed at the door.
 */
export default function Launch() {
  const { phase } = useSession();
  const { hydrated } = useClient();

  if (phase !== 'restoring' && hydrated) return <Redirect href="/(tabs)" />;

  return (
    <View style={styles.container}>
      <View style={styles.mark}>
        <View style={styles.markInner} />
      </View>
      <Text style={styles.wordmark}>FreshFold</Text>
      <Text style={styles.tagline}>Boutique fabric care, tracked to your door</Text>
      <ActivityIndicator color={colors.brandSage} style={{ marginTop: 22 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgIvory,
    gap: 4,
  },
  mark: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  markInner: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: tints.stone35,
    backgroundColor: 'transparent',
  },
  wordmark: {
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.textCharcoal,
  },
  tagline: { fontSize: 11.5, color: colors.textSlate },
});

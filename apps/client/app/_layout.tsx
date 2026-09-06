/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppLock from '../src/components/AppLock';
import { ClientProvider } from '../src/store/ClientStore';
import { PreferencesProvider } from '../src/store/PreferencesStore';
import { SessionProvider } from '../src/store/SessionStore';
import { colors } from '../src/theme';

/**
 * `ClientProvider` sits *inside* `SessionProvider` because the data layer needs
 * to know who is signed in: bookings are scoped by email server-side, and the
 * wallet writes through the session's account record.
 *
 * `PreferencesProvider` is outermost because it depends on neither and both
 * read from it — the app lock reads whether biometric unlock is on, and the data
 * layer filters the alerts feed by which kinds the customer wants.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PreferencesProvider>
          <SessionProvider>
            <ClientProvider>
              <StatusBar style="dark" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bgIvory },
                  animation: 'fade',
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="auth" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="order/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="orders" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
                {/*
                  Paystack's return leg. Not reached from inside the app — the
                  browser deep-links into it — and it pops itself the moment it
                  mounts, so it animates not at all rather than fading in over
                  the screen it is about to reveal again.
                */}
                <Stack.Screen name="paystack-success" options={{ animation: 'none' }} />
                <Stack.Screen
                  name="chat"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen
                  name="concierge"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen
                  name="plans"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
              </Stack>
              {/*
                Last, and so on top of every route: the lock has to cover
                whichever screen the app was left on. It draws nothing while
                unlocked.
              */}
              <AppLock />
            </ClientProvider>
          </SessionProvider>
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

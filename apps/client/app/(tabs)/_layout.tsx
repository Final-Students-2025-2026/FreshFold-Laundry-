/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tabs } from 'expo-router';
import { CalendarPlus, House, Radar, User, Wallet } from 'lucide-react-native';
import React from 'react';
import { Platform, Text, View } from 'react-native';
import { useClient } from '../../src/store/ClientStore';
import { colors } from '../../src/theme';

/**
 * Five tabs, one per thing a customer actually comes here to do: look around,
 * book, watch it happen, deal with money, manage the account.
 *
 * There is no auth redirect on this layout — unlike the rider console, which
 * locks itself when the session drops. Browsing and booking work signed out.
 */
export default function TabsLayout() {
  const { activeBookings } = useClient();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandSage,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.cardPure,
          borderTopColor: colors.borderSoft,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 86 : 64,
          paddingTop: 7,
        },
        tabBarLabelStyle: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.2 },
        sceneStyle: { backgroundColor: colors.bgIvory },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <House size={19} color={color} />,
        }}
      />
      <Tabs.Screen
        name="book"
        options={{
          title: 'Book',
          tabBarIcon: ({ color }) => <CalendarPlus size={19} color={color} />,
        }}
      />
      <Tabs.Screen
        name="track"
        options={{
          title: 'Track',
          tabBarIcon: ({ color }) => (
            <View>
              <Radar size={19} color={color} />
              {activeBookings.length > 0 && <ActiveDot count={activeBookings.length} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color }) => <Wallet size={19} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <User size={19} color={color} />,
        }}
      />
    </Tabs>
  );
}

/** Count of jobs in flight, so the tab says there is something to look at. */
function ActiveDot({ count }: { count: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: -5,
        right: -9,
        minWidth: 15,
        height: 15,
        paddingHorizontal: 3,
        borderRadius: 8,
        backgroundColor: colors.brandGold,
        borderWidth: 1.5,
        borderColor: colors.cardPure,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 8, fontWeight: '800', color: '#FFFFFF' }}>{count}</Text>
    </View>
  );
}

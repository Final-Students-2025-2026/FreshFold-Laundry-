/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { Bell, CheckCheck, CircleAlert, MessageSquare, Package } from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Notification } from '@freshfold/core';
import { useClient } from '../store/ClientStore';
import { colors, radius, tints } from '../theme';
import { Divider, EmptyState, Sheet } from './ui';

/**
 * The alerts inbox, ported from the rider console.
 *
 * Notifications are server-side and shared: the one raised when a booking is
 * created is the same record the rider app shows. The customer's copy is
 * filtered to jobs they own before it ever reaches this sheet — see `pull` in
 * the client store.
 */
export default function NotificationsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { notifications, markNotificationRead, markAllNotificationsRead, unreadCount } = useClient();

  const open = (notification: Notification) => {
    markNotificationRead(notification.id);
    if (notification.orderId) {
      onClose();
      router.push({ pathname: '/order/[id]', params: { id: notification.orderId } });
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} maxHeight="80%">
      <View style={styles.header}>
        <Bell size={17} color={colors.brandSage} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
          </Text>
        </View>
        {unreadCount > 0 && (
          <Pressable onPress={markAllNotificationsRead} hitSlop={8} style={styles.markAll}>
            <CheckCheck size={13} color={colors.brandSage} />
            <Text style={styles.markAllLabel}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      <Divider />

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {notifications.length === 0 ? (
          <EmptyState
            icon={<Bell size={26} color={colors.brandStone} />}
            title="Nothing yet"
            body="Updates about your collections and deliveries will appear here."
          />
        ) : (
          notifications.map((notification) => (
            <Pressable
              key={notification.id}
              onPress={() => open(notification)}
              style={({ pressed }) => [
                styles.row,
                !notification.read && styles.rowUnread,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={[styles.icon, iconTone(notification.type)]}>
                <NotificationIcon type={notification.type} />
              </View>

              <View style={{ flex: 1 }}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {notification.title}
                  </Text>
                  <Text style={styles.rowTime}>{notification.timestamp}</Text>
                </View>
                <Text style={styles.rowBody} numberOfLines={2}>
                  {notification.body}
                </Text>
              </View>

              {!notification.read && <View style={styles.unreadDot} />}
            </Pressable>
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}

function NotificationIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'order':
      return <Package size={14} color={colors.brandSage} />;
    case 'message':
      return <MessageSquare size={14} color={colors.statusInfo} />;
    case 'alert':
      return <CircleAlert size={14} color={colors.statusWarning} />;
    default:
      return <Bell size={14} color={colors.textSlate} />;
  }
}

function iconTone(type: Notification['type']) {
  switch (type) {
    case 'order':
      return { backgroundColor: tints.sage12 };
    case 'message':
      return { backgroundColor: tints.info10 };
    case 'alert':
      return { backgroundColor: tints.warning10 };
    default:
      return { backgroundColor: tints.stone35 };
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { fontSize: 15, fontWeight: '800', color: colors.textCharcoal },
  subtitle: { fontSize: 10.5, color: colors.textSlate, marginTop: 1 },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markAllLabel: { fontSize: 10.5, fontWeight: '700', color: colors.brandSage },

  list: { padding: 16, gap: 8, paddingBottom: 28 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
  },
  rowUnread: { borderColor: tints.sage25, backgroundColor: tints.sage05 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { flex: 1, fontSize: 12, fontWeight: '800', color: colors.textCharcoal },
  rowTime: { fontSize: 9, color: colors.textMuted },
  rowBody: { fontSize: 10.5, color: colors.textSlate, marginTop: 2, lineHeight: 14.5 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.brandSage },
});

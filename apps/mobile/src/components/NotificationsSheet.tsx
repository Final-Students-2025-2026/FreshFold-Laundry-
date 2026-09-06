/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BellOff } from 'lucide-react-native';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, ink, radius, shadow, text, tints, touch } from '../theme';
import { Notification } from '../types';

interface NotificationsSheetProps {
  visible: boolean;
  notifications: Notification[];
  onClose: () => void;
  onSelect: (notif: Notification) => void;
}

export default function NotificationsSheet({
  visible,
  notifications,
  onClose,
  onSelect,
}: NotificationsSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <Pressable style={styles.panel} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <Text style={text.title}>Alerts</Text>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                hitSlop={touch.slop}
                style={styles.closeButton}
              >
                <Text style={styles.close}>Close</Text>
              </Pressable>
            </View>

            {notifications.length === 0 ? (
              <View style={styles.empty}>
                <BellOff size={34} color={colors.brandStone} />
                <Text style={styles.emptyText}>No alerts right now.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 8 }}>
                {notifications.map((notif) => (
                  <Pressable
                    key={notif.id}
                    onPress={() => onSelect(notif)}
                    style={({ pressed }) => [
                      styles.row,
                      !notif.read && styles.rowUnread,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <View style={styles.rowHeader}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {notif.title}
                      </Text>
                      <Text style={styles.rowTime}>{notif.timestamp}</Text>
                    </View>
                    <Text style={styles.rowBody}>{notif.body}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: tints.scrim },
  safe: { paddingHorizontal: 12 },
  panel: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.xxl,
    padding: 16,
    gap: 10,
    ...shadow.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingBottom: 8,
  },
  closeButton: { minHeight: touch.min, justifyContent: 'center' },
  close: { ...text.bodyStrong, color: ink.sage },

  row: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgIvory,
    padding: 14,
    gap: 4,
  },
  rowUnread: { backgroundColor: tints.sage05, borderColor: tints.sage20 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  rowTitle: { ...text.bodyStrong, flex: 1 },
  rowTime: text.micro,
  rowBody: text.caption,

  empty: { alignItems: 'center', gap: 10, paddingVertical: 34 },
  emptyText: text.body,
});

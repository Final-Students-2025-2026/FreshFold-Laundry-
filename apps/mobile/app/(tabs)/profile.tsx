/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { AlertCircle, ScanFace, Star } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoider } from '../../src/components/KeyboardAvoider';
import {
  Avatar,
  Button,
  Card,
  Field,
  Input,
  LockedValue,
  Notice,
  StatTile,
} from '../../src/components/ui';
import { usePullToRefresh } from '../../src/hooks/usePullToRefresh';
import { useApp } from '../../src/store/AppStore';
import { useSession } from '../../src/store/SessionStore';
import { DEFAULT_AVATAR, colors, ink, radius, text, touch } from '../../src/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { rider, updateRider, profileComplete } = useApp();
  const { signOut, lock, biometricEnabled, setBiometricEnabled } = useSession();
  const refreshControl = usePullToRefresh();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rider.name);
  const [avatar, setAvatar] = useState(rider.avatar);

  useEffect(() => {
    setName(rider.name);
    setAvatar(rider.avatar);
  }, [rider]);

  // A rider without a saved name has to complete the form before anything else.
  // The form stays open, with no way to dismiss it, until dispatch has
  // everything it needs — same rule the accept gate uses.
  const mustSetUp = !profileComplete;
  const showForm = editing || mustSetUp;

  /**
   * All this form can complete is the courier's own name. The employee ID and
   * the vehicle were both set by a supervisor — dispatch still requires all
   * three before a job can be accepted (`REQUIRED_PROFILE_FIELDS` in the
   * store), but only one of them is this screen's to fill.
   */
  const formComplete = !!name.trim();
  /** Nothing the courier can do about this one; the roster desk assigns it. */
  const awaitingVehicle = !rider.vehicle.trim() || !rider.vehiclePlate.trim();

  const save = () => {
    if (!formComplete) return;
    updateRider({
      name: name.trim(),
      avatar: avatar.trim() || DEFAULT_AVATAR,
    });
    setEditing(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {showForm ? (
            <Card style={{ gap: 16 }}>
              <Text style={text.title}>
                {mustSetUp ? 'Set up your profile' : 'Edit your profile'}
              </Text>

              <Field label="Employee ID" locked>
                <LockedValue value={rider.employeeId || '—'} />
              </Field>

              <Field label="Full name">
                <Input
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Emmanuel Boateng"
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </Field>

              <Field label="Vehicle" locked>
                <LockedValue value={rider.vehicle || 'Not assigned yet'} />
              </Field>
              <Field label="Plate" locked>
                <LockedValue value={rider.vehiclePlate || 'Not assigned yet'} />
              </Field>

              <Field label="Photo URL (optional)">
                <Input
                  value={avatar}
                  onChangeText={setAvatar}
                  placeholder="https://…"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>

              <View style={styles.formActions}>
                {!mustSetUp && (
                  <Button
                    label="Cancel"
                    variant="ghost"
                    onPress={() => setEditing(false)}
                    style={{ flex: 1 }}
                  />
                )}
                <Button
                  label="Save profile"
                  onPress={save}
                  disabled={!formComplete}
                  style={{ flex: 1.4 }}
                />
              </View>

              {!formComplete && (
                <Notice icon={AlertCircle}>
                  Your name is needed before you can accept jobs — customers are shown it when you
                  are on the way.
                </Notice>
              )}

              {awaitingVehicle && (
                <Notice icon={AlertCircle} tone="warning">
                  No vehicle is assigned to you yet. Dispatch assigns it from the roster desk, and
                  jobs stay locked until they have — ask your supervisor.
                </Notice>
              )}
            </Card>
          ) : (
            <Card style={styles.identityCard}>
              <Avatar uri={rider.avatar} size={72} style={{ borderWidth: 2 }} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {rider.name}
                </Text>
                <Text style={styles.vehicle} numberOfLines={1}>
                  {rider.vehicle || 'No vehicle on file'}
                </Text>
                <Text style={styles.plate}>Plate: {rider.vehiclePlate || '—'}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit your profile"
                onPress={() => setEditing(true)}
                style={({ pressed }) => [styles.editChip, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.editLabel}>Edit</Text>
              </Pressable>
            </Card>
          )}

          <Card style={{ gap: 16 }}>
            <View style={styles.metricsHeader}>
              <Star size={20} color={colors.brandGold} fill={colors.brandGold} />
              <Text style={text.title}>Your record</Text>
            </View>

            <View style={styles.metricsGrid}>
              <StatTile label="Rating" value={`${rider.rating} ★`} style={styles.metric} />
              <StatTile label="On time" value={`${rider.onTimeRate}%`} style={styles.metric} />
              <StatTile label="Accepted" value={`${rider.acceptanceRate}%`} style={styles.metric} />
              <StatTile label="Completed" value={`${rider.completionRate}%`} style={styles.metric} />
            </View>
          </Card>

          <Card style={{ gap: 6 }}>
            <Text style={text.title}>Settings</Text>

            <ConfigRow label="Location sharing" value="On while online" tone="success" />

            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Face ID unlock</Text>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: biometricEnabled }}
                accessibilityLabel="Face ID unlock"
                onPress={() => setBiometricEnabled(!biometricEnabled)}
                style={[styles.toggle, biometricEnabled && styles.toggleOn]}
              >
                <Text style={[styles.toggleLabel, biometricEnabled && styles.toggleLabelOn]}>
                  {biometricEnabled ? 'On' : 'Off'}
                </Text>
              </Pressable>
            </View>

            <ConfigRow label="Offline cache" value="Ready" />
            <ConfigRow label="Shift" value="08:00 – 22:00" tone="sage" last />
          </Card>

          {biometricEnabled && (
            <Button
              label="Lock the app"
              variant="outline"
              icon={ScanFace}
              onPress={() => {
                lock();
                router.replace('/auth');
              }}
            />
          )}

          <Button
            label="Log out"
            variant="danger"
            onPress={() => {
              updateRider({ isOnline: false });
              signOut();
              router.replace('/auth');
            }}
          />
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

function ConfigRow({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'sage';
  last?: boolean;
}) {
  const color =
    tone === 'success' ? ink.success : tone === 'sage' ? ink.sage : colors.textSlate;

  return (
    <View style={[styles.configRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.configLabel}>{label}</Text>
      <Text style={[styles.configValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  scroll: { padding: 18, gap: 16, paddingBottom: 40 },

  formActions: { flexDirection: 'row', gap: 12, marginTop: 4 },

  identityCard: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  name: text.title,
  vehicle: text.body,
  plate: {
    ...text.caption,
    alignSelf: 'flex-start',
    fontWeight: '700',
    color: colors.textCharcoal,
    backgroundColor: colors.bgLinen,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  editChip: {
    minHeight: touch.min,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    paddingHorizontal: 16,
  },
  editLabel: { ...text.bodyStrong },

  metricsHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexGrow: 1, flexBasis: '45%' },

  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: touch.min,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  configLabel: { ...text.body, flex: 1 },
  configValue: { ...text.bodyStrong },
  toggle: {
    minHeight: touch.min,
    justifyContent: 'center',
    backgroundColor: colors.borderSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
  },
  toggleOn: { backgroundColor: colors.brandSage },
  toggleLabel: { ...text.bodyStrong, color: colors.textSlate },
  toggleLabelOn: { color: '#FFFFFF' },
});

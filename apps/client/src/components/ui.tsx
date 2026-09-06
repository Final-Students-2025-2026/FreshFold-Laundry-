/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ActivityIndicator,
  Image,
  ImageStyle,
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_AVATAR, colors, radius, shadow, tints } from '../theme';
import { KeyboardAvoider, useKeyboardVisible } from './KeyboardAvoider';

/* ------------------------------------------------------------------ layout */

export function Card({
  children,
  style,
  tone = 'plain',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'plain' | 'sage' | 'gold' | 'sunken';
}) {
  return <View style={[styles.card, cardTones[tone], style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

/** A section heading with an optional trailing action, used down every screen. */
export function SectionHeader({
  title,
  caption,
  action,
  onAction,
}: {
  title: string;
  caption?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!caption && <Text style={styles.sectionCaption}>{caption}</Text>}
      </View>
      {!!action && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ----------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'gold' | 'outline' | 'ghost' | 'danger' | 'dark';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  iconRight,
  disabled,
  loading,
  size = 'md',
  style,
  textStyle,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      // `Pressable`'s own `disabled` prop is what does the work: it blocks the
      // press, sets `accessibilityState.disabled` on native, and is the only
      // route by which react-native-web emits `aria-disabled` and drops the
      // element out of the tab order. Setting `accessibilityState` by hand and
      // withholding `onPress` — as this did — makes the button inert but still
      // announces it as enabled and leaves it keyboard-focusable.
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        buttonSizes[size].container,
        buttonVariants[variant].container,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={buttonVariants[variant].label.color} />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.buttonLabel,
              buttonSizes[size].label,
              buttonVariants[variant].label,
              textStyle,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {iconRight}
        </>
      )}
    </Pressable>
  );
}

/** Circular icon-only control used in headers and on the map. */
export function IconButton({
  children,
  onPress,
  tone = 'linen',
  size = 38,
  accessibilityLabel,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  tone?: 'linen' | 'sage' | 'white';
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        iconButtonTones[tone],
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ badges */

export type BadgeTone = 'sage' | 'gold' | 'success' | 'muted' | 'error' | 'warning' | 'info';

export function Badge({
  label,
  tone = 'sage',
  icon,
  style,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, badgeTones[tone].container, style]}>
      {icon}
      <Text style={[styles.badgeLabel, badgeTones[tone].label]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({
  uri,
  size = 40,
  style,
}: {
  uri?: string;
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={{ uri: uri || DEFAULT_AVATAR }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: colors.brandStone,
          backgroundColor: colors.bgLinen,
        },
        style,
      ]}
    />
  );
}

/** Initials disc for a customer with no photo. */
export function InitialsAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tints.sage12,
        borderWidth: 1,
        borderColor: tints.sage25,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.34, fontWeight: '800', color: colors.brandSage }}>
        {initials || 'FF'}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------- form */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'sentences',
  multiline,
  editable = true,
  maxLength,
  icon,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad' | 'numeric';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  editable?: boolean;
  /** Hard cap on what the field will hold — a phone number's ten digits. */
  maxLength?: number;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View
        style={[
          styles.fieldBox,
          multiline && { alignItems: 'flex-start', paddingVertical: 10 },
          !!error && { borderColor: tints.error25, backgroundColor: tints.error08 },
          !editable && { backgroundColor: colors.bgLinen },
        ]}
      >
        {icon}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline={multiline}
          editable={editable}
          maxLength={maxLength}
          style={[styles.fieldInput, multiline && { height: 78, textAlignVertical: 'top' }]}
        />
      </View>
      {!!error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : (
        !!hint && <Text style={styles.fieldHint}>{hint}</Text>
      )}
    </View>
  );
}

/** Horizontal segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tappable row used for pickers, settings and list navigation. */
export function OptionRow({
  title,
  subtitle,
  icon,
  selected,
  trailing,
  onPress,
  disabled,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  selected?: boolean;
  trailing?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      // These rows are the app's pickers — payment method, suburb, service —
      // so which one is chosen, and which is unavailable, both have to be
      // announced rather than only tinted. `disabled` is what reaches the DOM;
      // see the note on `Button`.
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        selected && styles.optionRowSelected,
        disabled && { opacity: 0.45 },
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      {!!icon && <View style={styles.optionIcon}>{icon}</View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.optionSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

/* ---------------------------------------------------------------- feedback */

export function EmptyState({
  icon,
  title,
  body,
  action,
  onAction,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Card style={styles.emptyState}>
      {icon}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {!!action && (
        <Button label={action} variant="outline" size="sm" onPress={onAction} style={{ marginTop: 6 }} />
      )}
    </Card>
  );
}

/** Thin progress track used for stages, points and plan capacity. */
export function ProgressBar({
  percent,
  tone = 'sage',
  height = 6,
}: {
  percent: number;
  tone?: 'sage' | 'gold' | 'success';
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const fill =
    tone === 'gold' ? colors.brandGold : tone === 'success' ? colors.statusSuccess : colors.brandSage;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped), min: 0, max: 100 }}
      style={[styles.progressTrack, { height, borderRadius: height }]}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: '100%',
          backgroundColor: fill,
          borderRadius: height,
        }}
      />
    </View>
  );
}

/**
 * Bottom sheet.
 *
 * A plain `Modal` with a scrim rather than a gesture-driven library: every
 * sheet in this app is a short, deliberate task (scan bags, sign, pick a
 * method), and a dismissable overlay is both lighter and less likely to eat a
 * signature stroke mid-drag.
 *
 * The keyboard is handled here rather than by each caller: a `Modal` is its
 * own window, so nothing a screen wraps around it reaches inside, and half the
 * sheets in the app (the address form, the top-up amount, the issue report)
 * are forms that were being typed into from underneath the keys.
 */
export function Sheet({
  visible,
  onClose,
  children,
  maxHeight = '92%',
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number | `${number}%`;
}) {
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoider style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        {/* The inset the home indicator needs is space the keyboard is already
            covering once it is up, and keeping it there floats the sheet. */}
        <View style={{ maxHeight, paddingBottom: keyboardUp ? 0 : insets.bottom }}>
          <View style={styles.sheetBody}>
            <View style={styles.sheetGrabber} />
            {children}
          </View>
        </View>
      </KeyboardAvoider>
    </Modal>
  );
}

/** Sheet variant that scrolls its contents — for pickers with many rows. */
export function ScrollSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <Text style={styles.sheetTitle}>{title}</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Sheet>
  );
}

/**
 * Small pill for connection state, shown in screen headers.
 *
 * `pending` is the state before the first poll has come back either way, and it
 * exists because "not yet known" is not the same as "offline". The pill had two
 * states and `online` starts false, so every cold start accused the server of
 * being unreachable — in a warning colour — for as long as the first round trip
 * took, which on a phone is easily a few seconds and on a slow connection is
 * exactly when a customer is most likely to believe it.
 */
export function ConnectionPill({ online, pending }: { online: boolean; pending?: boolean }) {
  const tone = pending
    ? colors.textSlate
    : online
      ? colors.statusSuccess
      : colors.statusWarning;

  return (
    <View style={[styles.connPill, !online && !pending && { backgroundColor: tints.warning10 }]}>
      <View style={[styles.connDot, { backgroundColor: tone }]} />
      <Text style={[styles.connLabel, { color: tone }]}>
        {pending ? 'Connecting…' : online ? 'Live' : 'Offline'}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 16,
    ...shadow.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSoft,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textSlate,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.2 },
  sectionCaption: { fontSize: 11, color: colors.textSlate, marginTop: 2 },
  sectionAction: { fontSize: 11, fontWeight: '700', color: colors.brandSage },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontWeight: '700', letterSpacing: 0.4 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  fieldLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textSlate,
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.cardPure,
    paddingHorizontal: 12,
  },
  fieldInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 13.5,
    color: colors.textCharcoal,
  },
  fieldHint: { fontSize: 10, color: colors.textMuted },
  fieldError: { fontSize: 10, color: colors.statusError, fontWeight: '600' },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.bgLinen,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.cardPure, ...shadow.xs },
  segmentLabel: { fontSize: 11, fontWeight: '700', color: colors.textSlate },
  segmentLabelActive: { color: colors.textCharcoal },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
  },
  optionRowSelected: { borderColor: colors.brandSage, backgroundColor: tints.sage05 },
  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: { fontSize: 12.5, fontWeight: '700', color: colors.textCharcoal },
  optionSubtitle: { fontSize: 10.5, color: colors.textSlate, marginTop: 2, lineHeight: 14 },

  emptyState: { alignItems: 'center', paddingVertical: 36, gap: 6 },
  emptyTitle: { fontSize: 13.5, fontWeight: '800', color: colors.textCharcoal, marginTop: 4 },
  emptyBody: {
    fontSize: 11.5,
    color: colors.textSlate,
    textAlign: 'center',
    paddingHorizontal: 22,
    lineHeight: 16,
  },

  progressTrack: { width: '100%', backgroundColor: colors.bgSand, overflow: 'hidden' },

  sheetBackdrop: { flex: 1, backgroundColor: tints.scrim, justifyContent: 'flex-end' },
  sheetBody: {
    backgroundColor: colors.cardPure,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    /**
     * Without this the sheet's `maxHeight` was a crop, not a constraint.
     *
     * `flexShrink` defaults to 0 in React Native, so a sheet whose contents came
     * to more than the cap laid itself out at full height and had the bottom
     * cut off — and because a `Sheet` is a plain `View`, there was nothing to
     * scroll to reach what had been cut. On a small phone that took the buttons
     * off the bag scanner: the list of bags to tick was there, the confirm was
     * not, and the sheet would not move.
     *
     * Shrinkable, the cap propagates inward instead, and a child that says it
     * can shrink — the scanner's checklist, the picker's list — gives up the
     * room and scrolls within what is left.
     */
    flexShrink: 1,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brandStone,
    marginBottom: 8,
  },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: colors.textCharcoal },

  connPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: tints.success10,
  },
  connDot: { width: 6, height: 6, borderRadius: 3 },
  connLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
});

const cardTones: Record<string, ViewStyle> = {
  plain: {},
  sage: { backgroundColor: tints.sage05, borderColor: tints.sage18 },
  gold: { backgroundColor: tints.gold08, borderColor: tints.gold35 },
  sunken: { backgroundColor: colors.bgLinen, borderColor: colors.borderSoft, ...shadow.xs },
};

const buttonSizes: Record<string, { container: ViewStyle; label: TextStyle }> = {
  sm: {
    container: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.md },
    label: { fontSize: 11 },
  },
  md: { container: { paddingVertical: 13, paddingHorizontal: 16 }, label: { fontSize: 12.5 } },
  lg: { container: { paddingVertical: 16, paddingHorizontal: 20 }, label: { fontSize: 13.5 } },
};

const buttonVariants: Record<ButtonVariant, { container: ViewStyle; label: TextStyle }> = {
  primary: {
    container: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
    label: { color: '#FFFFFF' },
  },
  gold: {
    container: { backgroundColor: colors.brandGold, borderColor: colors.brandGold },
    label: { color: '#FFFFFF' },
  },
  dark: {
    container: { backgroundColor: colors.textCharcoal, borderColor: colors.textCharcoal },
    label: { color: '#FFFFFF' },
  },
  outline: {
    container: { backgroundColor: 'transparent', borderColor: colors.brandSage },
    label: { color: colors.brandSage },
  },
  ghost: {
    container: { backgroundColor: colors.bgLinen, borderColor: colors.borderSoft },
    label: { color: colors.textCharcoal },
  },
  danger: {
    container: { backgroundColor: 'transparent', borderColor: tints.error25 },
    label: { color: colors.statusError },
  },
};

const iconButtonTones: Record<string, ViewStyle> = {
  linen: { backgroundColor: colors.bgLinen, borderWidth: 1, borderColor: colors.borderSoft },
  sage: { backgroundColor: colors.brandSage },
  white: { backgroundColor: colors.cardPure, ...shadow.md },
};

const badgeTones: Record<BadgeTone, { container: ViewStyle; label: TextStyle }> = {
  sage: { container: { backgroundColor: tints.sage12 }, label: { color: colors.brandSage } },
  gold: { container: { backgroundColor: tints.gold18 }, label: { color: colors.brandGold } },
  success: {
    container: { backgroundColor: tints.success10 },
    label: { color: colors.statusSuccess },
  },
  warning: {
    container: { backgroundColor: tints.warning10 },
    label: { color: colors.statusWarning },
  },
  info: { container: { backgroundColor: tints.info10 }, label: { color: colors.statusInfo } },
  muted: { container: { backgroundColor: tints.stone35 }, label: { color: colors.textSlate } },
  error: { container: { backgroundColor: tints.error08 }, label: { color: colors.statusError } },
};

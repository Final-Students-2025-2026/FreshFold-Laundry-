/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ActivityIndicator,
  Image,
  ImageStyle,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { DEFAULT_AVATAR, colors, ink, radius, shadow, text, tints, touch } from '../theme';

/** Any lucide icon. Passed as the component, not an element — see {@link Button}. */
type IconType = React.ComponentType<{ size?: number; color?: string }>;

/* ------------------------------------------------------------------ layout */

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
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
  return <Text style={[text.overline, style]}>{children}</Text>;
}

/**
 * The header every bottom-sheet in this app opens with: mark, what this is,
 * and which job it is about.
 */
export function SheetHeader({
  icon: Icon,
  title,
  subtitle,
  tone = 'sage',
}: {
  icon: IconType;
  title: string;
  subtitle?: string;
  tone?: 'sage' | 'error';
}) {
  return (
    <View style={styles.sheetHeader}>
      <View style={[styles.sheetMark, tone === 'error' && styles.sheetMarkError]}>
        <Icon size={22} color={tone === 'error' ? ink.error : ink.sage} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={text.title}>{title}</Text>
        {!!subtitle && (
          <Text style={[text.caption, { marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * A standing advisory — the rule that applies whatever the courier does next.
 * Not an error and not a hint: it stays on screen the whole time.
 */
export function Notice({
  icon: Icon,
  children,
  tone = 'neutral',
}: {
  icon: IconType;
  children: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'error';
}) {
  const palette = noticeTones[tone];
  return (
    <View style={[styles.notice, palette.container]}>
      <Icon size={18} color={palette.icon} />
      <Text style={[text.caption, { flex: 1, color: palette.text }]}>{children}</Text>
    </View>
  );
}

/* ----------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'gold' | 'outline' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon: Icon,
  disabled,
  loading,
  size = 'comfortable',
  style,
  textStyle,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /**
   * The icon *component*, not an element. Passing `<Check color="#fff" />` let
   * a caller hand a white icon to the gold variant, whose label is charcoal —
   * so the button now colours its own icon and they can never disagree.
   */
  icon?: IconType;
  disabled?: boolean;
  loading?: boolean;
  /** `compact` still clears the 44pt floor; it is for buttons sitting in a row. */
  size?: 'comfortable' | 'compact';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const isDisabled = disabled || loading;
  const { container, label: labelStyle } = buttonVariants[variant];
  // `TextStyle.color` widens to `ColorValue`; every value here is a plain hex.
  const labelColor = labelStyle.color as string;

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
        { minHeight: size === 'compact' ? touch.min : touch.comfortable },
        container,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        <>
          {Icon && <Icon size={18} color={labelColor} />}
          <Text style={[styles.buttonLabel, labelStyle, textStyle]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * An inline text action.
 *
 * These were bare `Pressable`s around a `Text` with `hitSlop={6}` — a target
 * about 14pt tall for things like "They cannot give me a code", which is the
 * escape hatch a courier reaches for while standing at a door nobody answered.
 */
export function LinkButton({
  label,
  onPress,
  tone = 'sage',
  align = 'left',
  style,
}: {
  label: string;
  onPress?: () => void;
  tone?: 'sage' | 'gold';
  align?: 'left' | 'center';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={touch.slop}
      style={({ pressed }) => [
        styles.link,
        align === 'center' && { alignSelf: 'center' },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Text style={[text.bodyStrong, { color: tone === 'gold' ? ink.gold : ink.sage }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A selectable pill — filters, quick replies, job switching. */
export function Chip({
  label,
  onPress,
  selected,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      <Text
        style={[text.caption, styles.chipLabel, selected && styles.chipLabelSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Two mutually exclusive ways to do the same job — "Scan QR" / "Type the code".
 * Was hand-rolled identically in the bag scanner and both hand-off sheets.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.id)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[text.bodyStrong, !active && { color: colors.textSlate }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ inputs */

/** A labelled field. `hint` sits under the input; `error` replaces it. */
export function Field({
  label,
  hint,
  error,
  locked,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Renders the label as assigned-elsewhere rather than empty-and-editable. */
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={text.overline}>{locked ? `${label} · assigned` : label}</Text>
      {children}
      {!!error && <Text style={[text.caption, { color: ink.error }]}>{error}</Text>}
      {!error && !!hint && <Text style={text.caption}>{hint}</Text>}
    </View>
  );
}

export function Input({ style, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textSlate}
      style={[styles.input, style]}
      {...props}
    />
  );
}

/** A value the courier may read but not change. */
export function LockedValue({ value }: { value: string }) {
  return <Text style={[styles.input, styles.inputLocked]}>{value}</Text>;
}

/**
 * The four digits, however they arrive.
 *
 * The collection code, the hub's check-in code, the delivery code, the access
 * PIN and both new PINs are all this control. It had five separate
 * implementations at four different sizes; the digits are the whole point of
 * the screen they appear on, so here they are at `display`.
 */
export function CodeInput({
  value,
  onChange,
  digits = 4,
  failed,
  secure,
  autoFocus,
  onSubmitEditing,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  digits?: number;
  failed?: boolean;
  secure?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, digits))}
      placeholder={'0'.repeat(digits)}
      placeholderTextColor={colors.brandStone}
      keyboardType="number-pad"
      secureTextEntry={secure}
      maxLength={digits}
      autoFocus={autoFocus}
      onSubmitEditing={onSubmitEditing}
      accessibilityLabel={`${digits}-digit code`}
      style={[styles.codeInput, failed && styles.codeInputFailed, style]}
    />
  );
}

/* ------------------------------------------------------------------ badges */

export function Badge({
  label,
  tone = 'sage',
  style,
}: {
  label: string;
  tone?: 'sage' | 'gold' | 'success' | 'muted' | 'error';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, badgeTones[tone].container, style]}>
      <Text style={[styles.badgeLabel, badgeTones[tone].label]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ figures */

/** A single measured figure. Home's shift stats and Profile's metrics grid. */
export function StatTile({
  label,
  value,
  accent,
  style,
}: {
  label: string;
  value: string;
  /** Money. Gold is the brand's colour for it — as a rule, drawn in `ink.gold`. */
  accent?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.statTile, style]}>
      <Text style={text.overline} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[text.strong, accent && { color: ink.gold }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({
  uri,
  size = 44,
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
          borderColor: colors.brandSage,
          backgroundColor: colors.bgLinen,
        },
        style,
      ]}
    />
  );
}

/* --------------------------------------------------------------- presence */

/**
 * Whether the console is talking to the dispatch server.
 *
 * The store has always tracked this, but nothing rendered it, so a console that
 * could not reach the server looked identical to one that could — it just kept
 * showing the last board it had cached. A job booked on the website or in the
 * customer app would simply never appear, with nothing on screen to say why.
 */
export function ConnectionPill({
  online,
  style,
}: {
  online: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={
        online ? 'Connected to dispatch' : 'Offline — showing the last cached board'
      }
      style={[styles.connPill, online ? styles.connPillOnline : styles.connPillOffline, style]}
    >
      <View
        style={[
          styles.connDot,
          { backgroundColor: online ? colors.statusSuccess : colors.statusWarning },
        ]}
      />
      <Text style={[styles.connLabel, { color: online ? ink.success : ink.warning }]}>
        {online ? 'Live' : 'Offline'}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------- empty state */

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card style={styles.emptyState}>
      {icon}
      <Text style={[text.strong, { marginTop: 4 }]}>{title}</Text>
      <Text style={[text.caption, { textAlign: 'center' }]}>{body}</Text>
    </Card>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardPure,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 18,
    ...shadow.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSoft,
  },

  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetMark: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: tints.sage10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetMarkError: { backgroundColor: tints.error05 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  link: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: touch.min,
  },

  chip: {
    justifyContent: 'center',
    minHeight: touch.min,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
  },
  chipSelected: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
  chipLabel: { fontWeight: '700', color: colors.textCharcoal },
  chipLabelSelected: { color: '#FFFFFF' },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.bgLinen,
    borderRadius: radius.lg,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.cardPure, ...shadow.xs },

  input: {
    minHeight: touch.min,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.cardPure,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textCharcoal,
  },
  inputLocked: {
    backgroundColor: colors.bgLinen,
    color: colors.textSlate,
    fontWeight: '700',
    textAlignVertical: 'center',
  },
  codeInput: {
    alignSelf: 'stretch',
    minHeight: 68,
    textAlign: 'center',
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: 10,
    color: colors.textCharcoal,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.brandStone,
    backgroundColor: colors.cardPure,
  },
  codeInputFailed: { borderColor: colors.statusError },

  badge: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  statTile: {
    flex: 1,
    gap: 4,
    backgroundColor: colors.bgIvory,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },

  connPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  connPillOnline: { backgroundColor: tints.success10, borderColor: tints.success30 },
  connPillOffline: { backgroundColor: tints.warning10, borderColor: tints.warning30 },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  connLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 44,
    gap: 6,
  },
});

const noticeTones: Record<
  'neutral' | 'warning' | 'error',
  { container: ViewStyle; icon: string; text: string }
> = {
  neutral: {
    container: { backgroundColor: colors.bgLinen, borderColor: colors.borderSoft },
    icon: ink.sage,
    text: colors.textSlate,
  },
  warning: {
    container: { backgroundColor: tints.warning10, borderColor: tints.warning30 },
    icon: ink.warning,
    text: ink.warning,
  },
  error: {
    container: { backgroundColor: tints.error05, borderColor: tints.error30 },
    icon: ink.error,
    text: ink.error,
  },
};

/**
 * Note which labels are white and which are charcoal.
 *
 * White on `brandGold` is 2.36:1 — it failed AA badly, and the gold button is
 * the one that starts a delivery. The fill is the brand's and stays; the label
 * is charcoal on it, at 6.99:1. See the `ink` note in `theme.ts`.
 */
const buttonVariants: Record<ButtonVariant, { container: ViewStyle; label: TextStyle }> = {
  primary: {
    container: { backgroundColor: colors.brandSage, borderColor: colors.brandSage },
    label: { color: '#FFFFFF' },
  },
  gold: {
    container: { backgroundColor: colors.brandGold, borderColor: colors.brandGold },
    label: { color: colors.textCharcoal },
  },
  outline: {
    container: { backgroundColor: 'transparent', borderColor: colors.brandSage },
    label: { color: ink.sage },
  },
  ghost: {
    container: { backgroundColor: colors.bgLinen, borderColor: colors.borderSoft },
    label: { color: colors.textCharcoal },
  },
  danger: {
    container: { backgroundColor: 'transparent', borderColor: tints.error30 },
    label: { color: ink.error },
  },
};

const badgeTones: Record<string, { container: ViewStyle; label: TextStyle }> = {
  sage: { container: { backgroundColor: tints.sage15 }, label: { color: ink.sage } },
  gold: { container: { backgroundColor: tints.gold15 }, label: { color: ink.gold } },
  success: {
    container: { backgroundColor: tints.success10 },
    label: { color: ink.success },
  },
  muted: {
    container: { backgroundColor: tints.stone30 },
    label: { color: colors.textSlate },
  },
  error: {
    container: { backgroundColor: tints.error05 },
    label: { color: ink.error },
  },
};

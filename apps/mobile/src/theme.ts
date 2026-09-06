/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Platform, TextStyle } from 'react-native';

/**
 * Brand palette for the rider console.
 *
 * These accents are deliberately *not* the same hex values as the website's
 * (`apps/web/src/index.css`): sage is `#6F7A63` here against ivory, `#5A5A40`
 * there against near-black. Same brand role, tuned for opposite backgrounds —
 * lifting one set into the shared package would break contrast on whichever
 * surface lost. The colours to keep in step are the *roles*, not the values.
 */
export const colors = {
  bgIvory: '#FAF9F6',
  bgLinen: '#F3F1EC',
  cardPure: '#FFFFFF',

  textCharcoal: '#1F1F1F',
  /**
   * The muted ink, darkened from `#6B7280`.
   *
   * It was 4.28:1 on `bgLinen` — under AA — and linen is a real surface here:
   * step rows, notices, the quick-reply bar, locked fields, the segmented
   * control. Every caption, hint and overline in the app is this colour, so one
   * value was failing in seven places. `#5F6672` is the same cool grey and
   * clears 4.5:1 on all three grounds (5.12 linen / 5.49 ivory / 5.78 white).
   */
  textSlate: '#5F6672',
  borderSoft: '#E5E7EB',

  brandSage: '#6F7A63',
  brandStone: '#D8D3CC',
  brandGold: '#C5A46D',

  statusSuccess: '#4F8A5B',
  statusWarning: '#C89B4A',
  statusError: '#B85C5C',
  statusInfo: '#5D7A8A',
} as const;

/**
 * The same brand colours, dark enough to be read as text on our light grounds.
 *
 * `PRODUCT.md` writes this rule for the website, where sage is 2.4:1 on
 * charcoal and is therefore "a *fill* that carries white text, not an ink".
 * This console has the same problem mirrored onto a light ground, and the worst
 * offender is gold: `brandGold` is **2.24:1 on ivory**, and it was carrying the
 * order number on every card, the "Ask in chat" and "They cannot give me a
 * code" links, and the delivery button's white label (2.36:1). A courier
 * standing in Kumasi sun could not read any of it.
 *
 * So the fills above keep their exact values and these carry the text. Each is
 * its own hue scaled down until it clears 4.5:1 against `bgLinen`, the darkest
 * of the three grounds — which means it also clears it on ivory and on white.
 *
 * The rule, in one line: **gold is a fill, never an ink**, and a gold fill
 * carries `textCharcoal` (6.99:1), never white.
 */
export const ink = {
  sage: '#67715C',
  gold: '#816B47',
  success: '#467950',
  warning: '#886932',
  error: '#A95555',
  info: '#577281',
} as const;

/**
 * Translucent variants. React Native has no `bg-brand-sage/10` shorthand, so the
 * handful of tints used across the app are pre-mixed here.
 */
export const tints = {
  sage05: 'rgba(111, 122, 99, 0.05)',
  sage10: 'rgba(111, 122, 99, 0.10)',
  sage15: 'rgba(111, 122, 99, 0.15)',
  sage20: 'rgba(111, 122, 99, 0.20)',
  sage30: 'rgba(111, 122, 99, 0.30)',
  gold05: 'rgba(197, 164, 109, 0.05)',
  gold15: 'rgba(197, 164, 109, 0.15)',
  gold30: 'rgba(197, 164, 109, 0.30)',
  success10: 'rgba(79, 138, 91, 0.10)',
  success30: 'rgba(79, 138, 91, 0.30)',
  warning10: 'rgba(200, 155, 74, 0.10)',
  warning30: 'rgba(200, 155, 74, 0.30)',
  error05: 'rgba(184, 92, 92, 0.05)',
  error20: 'rgba(184, 92, 92, 0.20)',
  error30: 'rgba(184, 92, 92, 0.30)',
  stone30: 'rgba(216, 211, 204, 0.45)',
  scrim: 'rgba(0, 0, 0, 0.55)',
  scrimDeep: 'rgba(0, 0, 0, 0.78)',
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  xxl: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Hit geometry.
 *
 * `min` is the 44pt floor every platform's guidelines agree on, and it is not
 * negotiable here: this console is worked one-handed, at a doorstep, often in
 * the rain, sometimes wearing a glove. `comfortable` is what the primary action
 * on a screen gets — the button that moves the job forward is always the
 * easiest thing on screen to hit.
 *
 * `slop` is for text links, which cannot be padded to 44 without wrecking the
 * line they sit in; it buys the same target invisibly.
 */
export const touch = {
  min: 44,
  comfortable: 52,
  slop: { top: 12, bottom: 12, left: 12, right: 12 },
} as const;

/**
 * The web build loaded Inter / Manrope / Space Grotesk from Google Fonts. On
 * device we stay on the platform UI font (San Francisco / Roboto) and carry the
 * brand's character through weight and letter-spacing instead — no font files to
 * bundle, no flash of unstyled text.
 */
export const fonts = {
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

/**
 * The type scale. Seven steps, and nothing outside them.
 *
 * The console used to carry twenty-one distinct font sizes — 7.5, 8, 8.5, 9,
 * 9.5, 10, 10.5 and up — because every screen picked its own. Ninety-three of
 * roughly a hundred and eighty declarations were under 11px. `PRODUCT.md` sets
 * "no text below 12px" for the marketing page; the app a courier reads at arm's
 * length on a moving bike was set smaller than that, so 12 is the floor here
 * and it is what `micro` means.
 *
 * Spread a preset and override nothing but colour:
 *
 *     text: { ...text.body, color: ink.sage }
 */
const scale = {
  micro: { fontSize: 12, lineHeight: 16 },
  caption: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 21 },
  strong: { fontSize: 17, lineHeight: 23 },
  title: { fontSize: 20, lineHeight: 26 },
  heading: { fontSize: 26, lineHeight: 32 },
  display: { fontSize: 34, lineHeight: 40 },
} as const;

export const text = {
  /** Uppercase micro-label for section headers. The floor size, so it is spaced. */
  overline: {
    ...scale.micro,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textSlate,
  } as TextStyle,
  /** Timestamps, units, counters — anything read after the thing it annotates. */
  micro: { ...scale.micro, color: colors.textSlate } as TextStyle,
  /** Supporting text: subtitles, hints, notes. */
  caption: { ...scale.caption, color: colors.textSlate } as TextStyle,
  /** The default. Instructions, addresses, message text, form values. */
  body: { ...scale.body, color: colors.textCharcoal } as TextStyle,
  /** Body weight-emphasised, for the one phrase in a block that carries it. */
  bodyStrong: { ...scale.body, fontWeight: '700', color: colors.textCharcoal } as TextStyle,
  /** Card titles, list-row primaries, the name of the thing. */
  strong: { ...scale.strong, fontWeight: '700', color: colors.textCharcoal } as TextStyle,
  /** Sheet and section titles. */
  title: { ...scale.title, fontWeight: '800', color: colors.textCharcoal } as TextStyle,
  /** One per screen, at the top. */
  heading: {
    ...scale.heading,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.textCharcoal,
  } as TextStyle,
  /** Figures that are the point of the screen: codes, totals. */
  display: { ...scale.display, fontWeight: '800', color: colors.textCharcoal } as TextStyle,
  /** Coordinates and bag labels — aligned digits, so monospaced. */
  mono: { ...scale.caption, fontFamily: fonts.mono, color: colors.textSlate } as TextStyle,
} as const;

/**
 * Soft elevation used on cards and floating pills.
 *
 * Deliberately typed narrower than `ViewStyle`: these get spread into text and
 * input styles too, and a full `ViewStyle` drags in web-only properties that
 * `TextStyle` refuses.
 */
interface Shadow {
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: { width: number; height: number };
  elevation?: number;
}

export const shadow: Record<'xs' | 'md' | 'lg', Shadow> = {
  xs: Platform.select<Shadow>({
    ios: {
      shadowColor: '#1F1F1F',
      shadowOpacity: 0.05,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
    },
    android: { elevation: 1 },
    default: {},
  })!,
  md: Platform.select<Shadow>({
    ios: {
      shadowColor: '#1F1F1F',
      shadowOpacity: 0.1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 4 },
    default: {},
  })!,
  lg: Platform.select<Shadow>({
    ios: {
      shadowColor: '#1F1F1F',
      shadowOpacity: 0.18,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 10 },
    default: {},
  })!,
};

/** Fallback rider portrait, kept from the web build. */
export const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200';

/**
 * `navigating_to_pickup` -> `Navigating to pickup`. Re-exported from the shared
 * package so the rider console and the client portal label a status the same.
 */
export { humanizeStatus } from '@freshfold/core';

export function formatCedis(amount: number): string {
  return `GH₵ ${amount.toFixed(2)}`;
}

export function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

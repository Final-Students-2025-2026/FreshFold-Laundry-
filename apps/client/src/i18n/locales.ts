/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which languages the app reads in, and how a handset's own setting maps onto
 * them.
 *
 * Three: English, Spanish and French. The app shipped for a while with Twi, Ga
 * and Ewe alongside these — they were withdrawn rather than finished, because a
 * language offered in a picker and then only a fifth written is a worse promise
 * than one not offered at all.
 *
 * Kept in its own module, apart from both the dictionaries and the React hook,
 * so that `theme.ts` — which every screen in the app imports — can take the
 * `Locale` type and the number formats without dragging three dictionaries and
 * React through the module graph behind them.
 */

export type Locale = 'en' | 'fr' | 'es';

/** In the order the picker shows them. English first, then alphabetically. */
export const LOCALES: Locale[] = ['en', 'es', 'fr'];

/**
 * What to call each language on screen.
 *
 * `name` is the endonym — what speakers call the language themselves — because
 * a list of languages written in a language you cannot read is not a list you
 * can choose from. `english` sits under it for the same reason in reverse: a
 * customer who has landed in the wrong one needs to find their way back out.
 */
export const LOCALE_LABELS: Record<Locale, { name: string; english: string }> = {
  en: { name: 'English', english: 'English' },
  es: { name: 'Español', english: 'Spanish' },
  fr: { name: 'Français', english: 'French' },
};

/**
 * `es-MX` -> `es`. Anything we do not publish reads as English.
 *
 * The region is dropped deliberately. There is one Spanish dictionary and one
 * French one, written to be read anywhere they are spoken, so `es-AR`, `es-ES`
 * and `es-419` all resolve to the same file — matching on the region would only
 * create a way to miss.
 *
 * Split off from {@link deviceLocale} so the mapping can be exercised without a
 * device to set the language on.
 */
export function localeFromTag(tag: string): Locale {
  const primary = tag.toLowerCase().split(/[-_]/)[0] ?? '';

  switch (primary) {
    case 'fr':
      return 'fr';
    case 'es':
      return 'es';
    default:
      return 'en';
  }
}

/**
 * The handset's language, as one of ours.
 *
 * Read through `Intl` rather than through `expo-localization`. The dependency
 * would give a more precise answer than this one; in this product it would not
 * give a *different* answer. A phone sold in Ghana reports `en-GH`, so detection
 * lands on English for very nearly every customer however it is read — the
 * picker in settings is what actually moves somebody into Spanish or French, and
 * that is the mechanism worth getting right.
 *
 * A runtime without `Intl` therefore costs nothing: English is where detection
 * was going anyway.
 */
export function deviceLocale(): Locale {
  try {
    return localeFromTag(Intl.DateTimeFormat().resolvedOptions().locale ?? '');
  } catch {
    return 'en';
  }
}

/**
 * The language to actually render in.
 *
 * Takes `Locale | 'system'` rather than importing `LocalePreference`, which is
 * the same union — the preferences store is a React module, and this one is
 * deliberately not.
 */
export function resolveLocale(preference: Locale | 'system'): Locale {
  return preference === 'system' ? deviceLocale() : preference;
}

/**
 * The BCP 47 tag to hand `Intl` for dates and times.
 *
 * Every language here has full date data in `Intl`, so each gets its own tag and
 * a customer reading in Spanish sees `mar, 11 ago` rather than `Tue, 11 Aug`.
 *
 * The region on each is a choice about *format*, not about who is reading:
 * `es-ES` and `fr-FR` both write day-month-year, which is what Ghana writes, so
 * a date is legible to the same reader whichever of the three they pick. English
 * stays on `en-GH` for the same reason — `en-US` would put the month first and
 * be the odd one out.
 *
 * The tag is fixed per language rather than taken from the handset so that two
 * customers reading the same screen in the same language see the same thing.
 */
export function intlTag(locale: Locale): string {
  switch (locale) {
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    default:
      return 'en-GH';
  }
}

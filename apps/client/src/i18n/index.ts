/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  bookingItems,
  pluraliseUnit,
  serviceTakesQuantity,
  serviceUnit,
  type BookingItem,
} from '@freshfold/core';
import { useCallback, useMemo } from 'react';
import { usePreferences } from '../store/PreferencesStore';
import { resolveLocale, type Locale } from './locales';
import { formatCedis } from '../theme';
import { catalogueText } from './catalogue';
import { translate, type Translate } from './translate';
import type { TranslationKey } from './en';

/**
 * Reading the app in one language.
 *
 * Scoped to this app on purpose. Neither the customer-facing copy in
 * `src/data/catalogue.ts` nor the strings in `packages/core` come through here,
 * and both read in English in every language. The catalogue is unfinished work.
 * Core is deliberate: the desk console and the rider
 * app import the same package, and neither is being translated, so moving those
 * strings behind a lookup would put a Ghanaian-language dictionary in the way of
 * two English-only surfaces for no gain.
 *
 * Where a core string is customer-facing all the same — the phone-length
 * message is the one so far — the *logic* stays in core and the *wording* gets a
 * key here, which is what `settings.details.phoneLength` is.
 */
export function useT(): { t: Translate; locale: Locale; c: CatalogueText } {
  const { locale: preference } = usePreferences();

  const locale = useMemo(() => resolveLocale(preference), [preference]);

  // Stable per language, so a screen that passes `t` into a `useMemo` or a
  // child's props does not re-render on every keystroke elsewhere.
  const t = useCallback<Translate>((key, values) => translate(locale, key, values), [locale]);

  /**
   * The catalogue lookup, bound to the same language.
   *
   * A second function rather than more keys on `t`, because the two are not the
   * same kind of thing: `t` takes a `TranslationKey` the compiler knows, and
   * fails the build if the key does not exist. `c` takes a string key and the
   * English to fall back to — the catalogue has no English dictionary to check
   * a key against, by design. See `./catalogue`.
   */
  const c = useCallback<CatalogueText>(
    (key, english) => catalogueText(locale, key, english),
    [locale]
  );

  return useMemo(() => ({ t, locale, c }), [t, locale, c]);
}

/** `c('service.washing.desc', service.description)`. */
export type CatalogueText = (key: string, english: string) => string;

/**
 * The price advert on a service card, in the customer's language.
 *
 * Core's `priceLabel` builds the English — `From ₵30 / load`, or the service's
 * own note where it has one — and is shared with the desk console and the rider
 * app, both of which are English. This is the customer's version of the same
 * sentence: the amount formatted for their locale, the unit through
 * {@link unitLabel}, and the whole frame from `service.priceFrom`.
 *
 * A service with a `priceNote` — "Included with Wash", "Complimentary" — has no
 * price to format, so the note is looked up as catalogue copy instead.
 */
export function servicePriceLabel(
  t: Translate,
  c: CatalogueText,
  locale: Locale,
  service: { id: string; price: number; unit: string; priceNote?: string }
): string {
  if (service.priceNote) return c(`service.${service.id}.note`, service.priceNote);

  return t('service.priceFrom', {
    amount: formatCedis(service.price, locale),
    unit: unitLabel(t, service.unit, 1),
  });
}

/**
 * The customer-facing word for a service's unit: `load` -> `cargas`.
 *
 * The `unit` on a `ServiceDefinition` is dispatch data and stays English — it is
 * part of a record the desk console and the server read too. This is the one
 * place it becomes copy, and it is why the booking screen does not use core's
 * `pluraliseUnit`: that adds an `s`, which is the right rule for exactly one of
 * the three languages here.
 *
 * A unit with no key falls back to core's English pluralisation rather than
 * rendering a raw key. A service added with a unit nobody has translated should
 * read a little oddly, not break the sentence around it.
 */
export function unitLabel(t: Translate, unit: string, count: number): string {
  const id = unit.trim().toLowerCase();
  const key = `unit.${id}.${count === 1 ? 'one' : 'many'}` as TranslationKey;
  const translated = t(key);

  // `translate` returns the key itself when neither the language nor English
  // has it, which is the signal that this unit is not in the block.
  return translated === key ? pluraliseUnit(unit, count) : translated;
}

/**
 * The order's services in one line, in the customer's language.
 *
 * The localised sibling of core's `describeItems`. That one is English and
 * serves the staff surfaces — the courier's job card, the desk board, the
 * confirmation email — which are English whatever the customer reads in. This
 * one is what the customer's own screens print, so its units come through
 * {@link unitLabel}: `2 cargas · Washing (Machine & Hand Wash)`.
 *
 * The service *name* stays English in both, because it is the wire value a
 * booking stores in `serviceType`. Only the count and its unit are translated —
 * which is the honest half, and it is the half that changes per order.
 */
export function describeOrder(
  t: Translate,
  booking: { items?: BookingItem[]; serviceType?: string; quantity?: number }
): string {
  const items = bookingItems(booking);
  if (items.length === 0) return '';

  return items
    .map((item) => {
      if (!serviceTakesQuantity(item.serviceType) || item.quantity <= 1) return item.serviceType;
      return `${item.quantity} ${unitLabel(t, serviceUnit(item.serviceType), item.quantity)} · ${item.serviceType}`;
    })
    .join(' + ');
}

export {
  LOCALES,
  LOCALE_LABELS,
  deviceLocale,
  intlTag,
  localeFromTag,
  resolveLocale,
  type Locale,
} from './locales';
export { coverage, translate, type Translate, type TranslateValues } from './translate';
export { CATALOGUE_KEYS, catalogueCoverage, catalogueText } from './catalogue';
export {
  jobStatusLabel,
  paymentStatusLabel,
  stageCopy,
  stageLabel,
} from './status';
export type { TranslationKey } from './en';

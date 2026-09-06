/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What is left to translate, per language.
 *
 * Run with `npm run i18n --workspace @freshfold/client`, or
 * `npm run i18n --workspace @freshfold/client -- es` for one language's
 * outstanding keys, ready to paste into a translator's brief.
 *
 * This is a report, not a check: it never fails. An incomplete dictionary is a
 * known state of the product rather than a broken build — `translate` falls back
 * key by key, and the settings screen badges each language and warns when the
 * one on screen is a draft.
 *
 * All three are complete today. This exists for the state after somebody adds a
 * string to `en`: it names exactly which keys the other two are now missing,
 * which is the difference between "Spanish needs finishing" and a list somebody
 * who speaks Spanish can actually work through.
 *
 * The keys come out grouped by their prefix, because that is roughly a screen:
 * a translator who takes `book.*` in one sitting produces a consistent booking
 * flow, where the same person working down a flat alphabetical list produces
 * one consistent 'a' and one consistent 'b'.
 */

import { en, type TranslationKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { CATALOGUE_KEYS, catalogueCoverage } from './catalogue';
import { LOCALES, LOCALE_LABELS, type Locale } from './locales';

const DICTIONARIES: Record<Locale, Partial<Record<TranslationKey, string>>> = { en, es, fr };

/**
 * Keys deliberately left in English, and so not counted as missing.
 *
 * The same list `translate.ts` keeps, for the same reason: the delete-confirmation
 * word is both what the customer types and what the code compares against, so
 * translating one half of that pair breaks the gate. Duplicated rather than
 * exported across, because a report reaching into the runtime module to borrow a
 * private constant is a worse coupling than two short arrays.
 */
const UNTRANSLATED: TranslationKey[] = ['settings.danger.confirmWord'];

const KEYS = (Object.keys(en) as TranslationKey[]).filter((key) => !UNTRANSLATED.includes(key));

function missingFor(locale: Locale): TranslationKey[] {
  const dictionary = DICTIONARIES[locale];
  return KEYS.filter((key) => !dictionary[key]);
}

/** `book.contact.email` -> `book`. Roughly one screen per group. */
function group(key: string): string {
  return key.split('.')[0] ?? key;
}

function bar(fraction: number, width = 24): string {
  const filled = Math.round(fraction * width);
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
}

const only = process.argv[2] as Locale | undefined;

if (only && !LOCALES.includes(only)) {
  console.error(`Unknown language "${only}". Try one of: ${LOCALES.join(', ')}`);
  process.exit(1);
}

if (!only) {
  console.log(`FreshFold customer app — translation coverage (${KEYS.length} keys)\n`);

  for (const locale of LOCALES) {
    const missing = missingFor(locale);
    const written = KEYS.length - missing.length;
    const fraction = written / KEYS.length;
    console.log(
      `  ${locale.padEnd(4)} ${LOCALE_LABELS[locale].english.padEnd(12)} ` +
        `${bar(fraction)} ${String(Math.round(fraction * 100)).padStart(3)}%  ` +
        `${String(written).padStart(4)}/${KEYS.length}` +
        (missing.length ? `  (${missing.length} to write)` : '')
    );
  }

  /**
   * The catalogue, counted separately.
   *
   * A different kind of dictionary and so a different number: it has no English
   * map to measure against — the English lives in the data and is passed in as
   * the fallback — so Spanish is the yardstick, and this says whether the others
   * have fallen behind it. See `./catalogue`.
   */
  console.log(`\nService catalogue (${CATALOGUE_KEYS.length} strings)\n`);
  for (const locale of LOCALES) {
    const fraction = catalogueCoverage(locale);
    console.log(
      `  ${locale.padEnd(4)} ${LOCALE_LABELS[locale].english.padEnd(12)} ` +
        `${bar(fraction)} ${String(Math.round(fraction * 100)).padStart(3)}%` +
        (locale === 'en' ? '  (the source: the data itself)' : '')
    );
  }

  console.log('\nFor one language\'s outstanding keys:');
  console.log('  npm run i18n --workspace @freshfold/client -- es\n');
} else {
  const missing = missingFor(only);
  const label = LOCALE_LABELS[only];

  console.log(`${label.name} (${label.english}) — ${missing.length} keys left of ${KEYS.length}\n`);

  if (missing.length === 0) {
    console.log('  Nothing outstanding.\n');
  } else {
    const byGroup = new Map<string, TranslationKey[]>();
    for (const key of missing) {
      const name = group(key);
      byGroup.set(name, [...(byGroup.get(name) ?? []), key]);
    }

    // Biggest groups first: a translator with an hour should spend it on the
    // screen with forty missing strings, not the one with two.
    const ordered = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [name, keys] of ordered) {
      console.log(`  ${name}  (${keys.length})`);
      for (const key of keys) {
        // The English beside the key, because a key on its own is not something
        // anybody can translate.
        console.log(`    '${key}':  ${JSON.stringify(en[key])}`);
      }
      console.log('');
    }
  }
}

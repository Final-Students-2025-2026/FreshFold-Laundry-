/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * That the session token never lands in plaintext storage.
 *
 * Run with `npm run check --workspace @freshfold/mobile`.
 *
 * AsyncStorage is an unencrypted store in the app sandbox — a SQLite file on
 * Android, a plist-backed file on iOS — and the bearer token was sitting in it.
 * That token is good for a week, so it was readable from an unencrypted device
 * backup, from any process on a rooted or jailbroken handset, and over `adb` on
 * a debuggable build. It now goes to the platform keychain through
 * `src/services/secrets.ts`, and everything else the console caches stays where
 * it was.
 *
 * Plain Node rather than a `.check.ts`, because this app has no TypeScript
 * runner and one is not worth adding for a source scan.
 *
 * The scan is the useful half. The keychain call itself cannot be exercised
 * here — it needs a device — so what is asserted instead is the property that
 * actually regresses: somebody adds a second place the token is written, six
 * months from now, reaching for the storage helper next to it because that is
 * what everything else in the file uses. Keys are matched by *shape* rather
 * than by name, so a secret added later is covered without anyone remembering
 * to come back here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`)
  );
}

const checkTrue = (label, actual) => check(label, actual, true);

function section(title) {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 55 - title.length))}`);
}

/** Every .ts/.tsx under the app, minus the module that is allowed to do this. */
function sources(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const SECRETS_MODULE = path.join(APP, 'src', 'services', 'secrets.ts');

/** A key whose name says it holds a credential. */
const SECRET_KEY = /\b(?:STORAGE_KEYS|KEYS)\.(?:token|biometric)\b/;

/** A write to unencrypted storage. */
const PLAINTEXT_WRITE = /AsyncStorage\.(?:setItem|multiSet)|\bwriteString\(|\bwriteJson\(/;

// ---------------------------------------------------------------------------
section('the secure module is wired up');

checkTrue('src/services/secrets.ts exists', fs.existsSync(SECRETS_MODULE));

const secrets = fs.existsSync(SECRETS_MODULE) ? fs.readFileSync(SECRETS_MODULE, 'utf8') : '';
checkTrue("it uses expo-secure-store", secrets.includes("from 'expo-secure-store'"));

const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
checkTrue(
  'expo-secure-store is a dependency',
  typeof pkg.dependencies?.['expo-secure-store'] === 'string'
);

const config = fs.readFileSync(path.join(APP, 'app.config.js'), 'utf8');
checkTrue("...and registered as a config plugin", config.includes("'expo-secure-store'"));

section('and nothing else writes a credential in the clear');

/**
 * The assertion this file exists for. A line that names a secret key and writes
 * it through the unencrypted store is the bug, wherever it turns up.
 */
const offenders = [];
for (const file of sources(path.join(APP, 'src')).concat(sources(path.join(APP, 'app')))) {
  if (path.resolve(file) === path.resolve(SECRETS_MODULE)) continue;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (SECRET_KEY.test(line) && PLAINTEXT_WRITE.test(line)) {
      offenders.push(`${path.relative(APP, file)}:${i + 1}`);
    }
  });
}

check('no plaintext write of a credential key', offenders, []);

/**
 * And the scan is checked against itself. A regex that matches nothing would
 * pass the assertion above for the wrong reason and keep passing forever, so
 * both halves of it are proved to still fire on a line that should trip them.
 */
section('...and the scan can still see one');

checkTrue(
  'the key pattern still matches',
  SECRET_KEY.test('await AsyncStorage.setItem(KEYS.token, next);')
);
checkTrue(
  'the write pattern still matches',
  PLAINTEXT_WRITE.test('await AsyncStorage.setItem(KEYS.token, next);')
);
checkTrue(
  'and it ignores a secure write',
  !PLAINTEXT_WRITE.test('await writeSecret(KEYS.token, next);')
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

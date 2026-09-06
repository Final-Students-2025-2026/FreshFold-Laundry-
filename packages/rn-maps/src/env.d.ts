/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `process.env` in a React Native bundle is not Node's.
 *
 * Metro's Babel transform inlines `EXPO_PUBLIC_*` values at build time from the
 * environment of whichever app is bundling this package; there is no `process`
 * at runtime. Declared here rather than depending on `@types/node`, which would
 * promise this package a whole runtime it does not have — and would typecheck
 * `fs` and `path` calls that would fail on a phone.
 */
declare const process: { env: Record<string, string | undefined> };

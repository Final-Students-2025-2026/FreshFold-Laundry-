/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether an address is one this build can honestly claim as its own.
 *
 * Pure, and takes the schemes rather than reading the Expo config, so
 * `checkout.check.ts` can state a build and assert against it instead of faking
 * a native module. The server's half of the same rule — `isAllowedCallback` in
 * apps/server/src/routes/integrations.ts — is split from its environment the
 * same way, and for the same reason.
 *
 * An http(s) URL passes whatever the schemes say: that is the Expo web build
 * returning to the origin it is served from, and the server checks it against
 * `CORS_ORIGINS` exactly as it checks the website's.
 */
export function ownsAddress(url: string, schemes: readonly string[]): boolean {
  if (/^https?:/i.test(url)) return true;

  const address = url.toLowerCase();
  return schemes.some((scheme) => !!scheme && address.startsWith(`${scheme.toLowerCase()}:`));
}

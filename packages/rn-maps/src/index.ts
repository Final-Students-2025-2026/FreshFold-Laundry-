/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Map wiring shared by the rider app and the customer app.
 *
 * Deliberately not part of `@freshfold/core`: everything here needs React and
 * `react-native-maps`, and core is imported by the dispatch server, which needs
 * neither and should not carry them into its bundle.
 *
 * Import this only from modules the web build cannot reach — a component with a
 * `.web.tsx` twin, or something reached solely through one. `MAP_PROVIDER`
 * pulls in `react-native-maps`, which has no web implementation and fails the
 * Expo web bundle outright rather than at runtime, so it takes the whole
 * customer site down with it. Today the two `useRoadRoute` bindings satisfy
 * that because only `LiveMap.tsx` and `TrackingMap.tsx` import them, and both
 * are swapped out on web.
 */

export { MAP_PROVIDER } from './mapProvider';
export {
  createUseRoadRoute,
  type DirectionsFetcher,
  type UseRoadRoute,
} from './useRoadRoute';

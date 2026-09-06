/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createUseRoadRoute } from '@freshfold/rn-maps';
import { api } from '../services/api';

/**
 * The road between here and the destination, bound to this app's dispatch
 * client. The hook itself lives in `@freshfold/rn-maps`, because the customer
 * app draws the same line off the same server route.
 */
export const useRoadRoute = createUseRoadRoute(api.getDirections);

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createUseRoadRoute } from '@freshfold/rn-maps';
import { api } from '../services/api';

/**
 * The road the courier is riding to get here, bound to this app's dispatch
 * client. The hook itself lives in `@freshfold/rn-maps` — it is the same road
 * the courier's own console draws, off the same server route, so the line the
 * customer watches is the line the courier was given.
 */
export const useRoadRoute = createUseRoadRoute(api.getDirections);

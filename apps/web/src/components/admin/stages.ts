/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JobStatus } from '@freshfold/core';

/**
 * When the hub's drop-off code is worth putting on screen.
 *
 * From the moment the bags are on the bike to the moment they are checked in.
 * Earlier it is noise on a row a dispatcher is reading for something else, and
 * once the job is `dropped_off` the code has been spent — leaving it up would
 * invite the desk to read it out for a load that already arrived.
 *
 * Keyed off the courier's own status rather than the coarse customer stage,
 * which lumps the whole collection leg into one word. No courier on the job
 * means nobody to check in, so nothing is shown.
 *
 * Shared rather than declared twice. Two panes show this code now — the Hub
 * desk, where the courier is actually standing, and the Pipeline row a
 * dispatcher drills into — and a second copy of the gate is a second answer to
 * "is the code on screen while somebody is waiting for it", which is the one
 * question it exists to settle.
 */
export const HUB_LEG: JobStatus[] = ['picked_up', 'navigating_to_laundry', 'arrived_at_laundry'];

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseHandoffPayload, type HandoffPayload, type LaundryBag } from '@freshfold/core';

/**
 * What the courier just pointed the camera at.
 *
 * A plain function, free of React Native, for the same reason the workload
 * rules are — see `store/workload.ts`. Deciding what a scan *means* is exactly
 * the part worth being able to run without a camera, a bag and a doorstep.
 *
 * There are three codes in play at a collection: the labels on this order's
 * bags, the customer's collection QR, and whatever else happens to be printed
 * on a box in the hallway. They call for three different things to be said.
 */
export type ScanResult =
  /** A bag on this order's manifest that had not been checked off yet. */
  | { kind: 'bag'; bag: LaundryBag }
  /** One of this order's bags, already accounted for. */
  | { kind: 'bag-again'; bag: LaundryBag }
  /** A FreshFold hand-off code — this order's or another's. */
  | { kind: 'handoff'; payload: HandoffPayload }
  | { kind: 'unknown' };

export function classifyScan(data: string, bags: LaundryBag[]): ScanResult {
  const code = data.trim().toLowerCase();

  /**
   * Matched against the whole manifest, not only what is still outstanding.
   *
   * The camera fires continuously, so a label held in the frame is read again
   * every few hundred milliseconds, and a courier double-checking a bag they
   * ticked off by hand scans one that is already marked. Keying this lookup on
   * `!scanned` dropped both cases through to `unknown`, and the scanner
   * answered a correct scan with "unrecognised label" — telling a courier
   * holding the right bag that it belonged to some other order.
   */
  const bag = bags.find((b) => b.qrCode.toLowerCase() === code);
  if (bag) return { kind: bag.scanned ? 'bag-again' : 'bag', bag };

  const payload = parseHandoffPayload(data);
  if (payload) return { kind: 'handoff', payload };

  return { kind: 'unknown' };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Coords } from './types';

/**
 * Address lookup, for the two booking forms.
 *
 * The pickup pin exists because a typed address is not a doorstep. That stays
 * true — a hostel block and room number is something no geocoder knows — but
 * it does not follow that the map should open over the middle of campus and
 * wait. Most people type somewhere Google has heard of before they add the
 * room, and starting the pin at that building instead of two kilometres away
 * is the difference between a nudge and a drag.
 *
 * So this narrows, it does not decide. A suggestion moves the camera and
 * places a provisional pin; the customer still confirms it against what is
 * under the crosshair. The room number is theirs to type either way.
 *
 * Served by the dispatch server so the billed key stays out of three client
 * bundles, exactly as the directions proxy does.
 */

/** One row in the dropdown. */
export interface PlaceSuggestion {
  /** Opaque Google place id, exchanged for coordinates on selection. */
  id: string;
  /** The name, bolded in Google's own UI — "Evandy Hostel". */
  primary: string;
  /** The context under it — "Ayeduase, Kumasi". Sometimes empty. */
  secondary: string;
  /**
   * `landmark` when this came from FreshFold's own table rather than Google.
   * Those are the fifteen halls and hostels the couriers actually serve, they
   * cost nothing to look up, and they should sit above the general results.
   */
  source: 'landmark' | 'google';
  /**
   * Present on `landmark` rows, which already know where they are and need no
   * second call to find out.
   */
  coords?: Coords;
}

/** What a suggestion turns into once chosen. */
export interface PlaceDetail {
  id: string;
  /** Google's formatted address, offered to the customer to accept or rewrite. */
  address: string;
  coords: Coords;
}

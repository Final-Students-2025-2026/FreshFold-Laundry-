/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Location from 'expo-location';
import { Crosshair, MapPin } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { anchorForSuburb, isOutsideServiceArea, metresBetween, type Coords } from '@freshfold/core';
import { colors, radius, shadow, tints } from '../theme';

/**
 * The map-less half of the pickup pin picker.
 *
 * Lives in its own module because the web build must never reach
 * `react-native-maps` — importing it there is a bundling error, not something
 * a runtime boundary can catch. `PickupPinPicker.web.tsx` renders this alone;
 * the native picker renders it as its fallback when the map fails to mount.
 *
 * Everything the map can decide can be decided here too: the device's own fix,
 * or the centre of the chosen suburb. The latter is the old derived-pin
 * behaviour, except chosen out loud instead of assumed.
 */

export interface PickupPinPickerProps {
  /** The pin as it stands, or null while nothing has been placed. */
  value: Coords | null;
  onChange: (next: Coords) => void;
  /** Centres the map before a pin exists, and labels the fallback action. */
  suburb: string;
  /**
   * Offered the street the pin is standing on, when the customer taps to
   * accept it. The address field is theirs to write — a hostel block and room
   * number is something no geocoder knows — so this only ever fills it on
   * request.
   */
  onAddressSuggested?: (address: string) => void;
  /**
   * The typed address, watched for a hostel this product already knows the
   * coordinates of. Nothing is read out of it beyond that match.
   */
  address?: string;
  /**
   * How the current pin came to be, for the read-back. A pin the customer
   * placed themselves needs no explanation; one that appeared under them does.
   */
  origin?: PinOrigin;
  onOriginChange?: (next: PinOrigin) => void;
}

export type PinOrigin = 'map' | 'device' | 'suburb' | 'landmark' | 'place' | null;

const ORIGIN_NOTE: Record<Exclude<PinOrigin, null | 'map'>, string> = {
  device: 'From your device location.',
  suburb: 'The middle of the suburb — move the map to your gate.',
  landmark: 'Matched from the address you typed — check it is the right gate.',
  place: 'From the address you chose — check it is the right gate.',
};

/** How close to the suburb anchor still counts as "roughly the suburb". */
const ANCHOR_TOLERANCE_M = 30;

/** Shared with the website's booking form, which takes its suburb as free text. */
export const anchorFor = anchorForSuburb;

/**
 * Asks the device where it is.
 *
 * A fix from outside the service area is refused rather than pinned: a
 * customer booking from Accra for a Kumasi address would otherwise send the
 * courier 250 km down the N6.
 */
export function useDeviceFix(onChange: (next: Coords) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const locate = useCallback(async () => {
    setBusy(true);
    setError('');

    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        setError('Location is off for FreshFold. Place the pin by hand, or turn it on in Settings.');
        return;
      }

      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords: Coords = { lat: fix.coords.latitude, lng: fix.coords.longitude };

      if (isOutsideServiceArea(coords)) {
        setError('That puts you outside our Kumasi service area. Place the pin by hand instead.');
        return;
      }

      onChange(coords);
    } catch {
      setError('Could not read your location just now. Place the pin by hand instead.');
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  return { locate, busy, error };
}

/**
 * What is at the pin, in words.
 *
 * The same read-back a ride-hailing app puts under its centre pin: proof the
 * customer is looking at the right street before a courier is sent to it. It
 * uses the platform geocoder rather than a billed Geocoding API call, so it is
 * free, offline-capable on most devices, and absent on web — where the catch
 * below simply leaves the label empty rather than pretending.
 *
 * Debounced, because a drag across a suburb would otherwise queue a lookup per
 * frame.
 */
export function useNearestAddress(pin: Coords | null): string {
  const [label, setLabel] = useState('');
  const lat = pin?.lat;
  const lng = pin?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      setLabel('');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (cancelled || !place) return;

        const parts = [place.name, place.street, place.district || place.subregion]
          .map((part) => part?.trim())
          .filter((part): part is string => !!part);

        setLabel([...new Set(parts)].join(', '));
      } catch {
        // No geocoder on this platform. The coordinate readout still stands.
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lat, lng]);

  return label;
}

/** The read-back, with the one-tap offer to adopt it as the address. */
export function NearestAddress({
  pin,
  onAddressSuggested,
}: {
  pin: Coords | null;
  onAddressSuggested?: (address: string) => void;
}) {
  const nearest = useNearestAddress(pin);
  if (!nearest) return null;

  return (
    <View style={styles.nearestRow}>
      <MapPin size={12} color={colors.textSlate} />
      <Text style={styles.nearestText} numberOfLines={2}>
        {nearest}
      </Text>
      {!!onAddressSuggested && (
        <Pressable onPress={() => onAddressSuggested(nearest)} hitSlop={6}>
          <Text style={styles.nearestAction}>Use</Text>
        </Pressable>
      )}
    </View>
  );
}

export function LocateButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.locateButton, pressed && { opacity: 0.9 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Crosshair size={14} color="#FFFFFF" />
      )}
      <Text style={styles.locateLabel}>{busy ? 'Finding you…' : 'Use my current location'}</Text>
    </Pressable>
  );
}

/** What was chosen, in words a customer can sanity-check. */
export function PinReadout({
  value,
  suburb,
  origin = null,
}: {
  value: Coords | null;
  suburb: string;
  origin?: PinOrigin;
}) {
  if (!value) {
    return (
      <Text style={styles.readoutEmpty}>
        No pin yet — the courier needs one to find your door.
      </Text>
    );
  }

  const fromAnchor = metresBetween(value, anchorFor(suburb));
  const note = origin && origin !== 'map' ? ORIGIN_NOTE[origin] : null;

  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.readout}>
        Pinned at {value.lat.toFixed(5)}° N, {Math.abs(value.lng).toFixed(5)}° W ·{' '}
        {fromAnchor < ANCHOR_TOLERANCE_M
          ? `the centre of ${suburb}`
          : `${formatDistance(fromAnchor)} from the centre of ${suburb}`}
      </Text>
      {/* Where the pin came from, when the customer did not put it there. A pin
          that appears without explanation is the same unexamined guess the
          derived location used to be. */}
      {!!note && <Text style={styles.readoutNote}>{note}</Text>}
    </View>
  );
}

function formatDistance(metres: number): string {
  return metres < 950 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

export default function PickupPinPanel({
  value,
  onChange,
  suburb,
  onAddressSuggested,
  origin = null,
  onOriginChange,
  notice,
}: PickupPinPickerProps & { notice?: string }) {
  const { locate, busy, error } = useDeviceFix(
    useCallback(
      (next: Coords) => {
        onChange(next);
        onOriginChange?.('device');
      },
      [onChange, onOriginChange]
    )
  );

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Pickup pin</Text>
      <Text style={styles.panelBody}>
        {notice ?? 'The Google map renders on iOS and Android.'} You can still set the exact
        point from this device, or fall back to the middle of the suburb — the courier will have to
        phone you for the rest.
      </Text>

      <LocateButton onPress={locate} busy={busy} />

      <Pressable
        onPress={() => {
          onChange({ ...anchorFor(suburb) });
          onOriginChange?.('suburb');
        }}
        style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.85 }]}
      >
        <MapPin size={14} color={colors.textCharcoal} />
        <Text style={styles.secondaryLabel}>Use the centre of {suburb}</Text>
      </Pressable>

      {!!error && <Text style={styles.error}>{error}</Text>}
      <NearestAddress pin={value} onAddressSuggested={onAddressSuggested} />
      <PinReadout value={value} suburb={suburb} origin={origin} />
    </View>
  );
}

export const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgLinen,
    padding: 13,
    gap: 9,
    ...shadow.xs,
  },
  panelTitle: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  panelBody: { fontSize: 10.5, color: colors.textCharcoal, lineHeight: 14.5 },

  locateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.brandSage,
    borderRadius: radius.lg,
    paddingVertical: 11,
  },
  locateLabel: { fontSize: 11.5, fontWeight: '800', color: '#FFFFFF' },

  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 10,
  },
  secondaryLabel: { fontSize: 11, fontWeight: '700', color: colors.textCharcoal },

  nearestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.cardPure,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  nearestText: { flex: 1, fontSize: 10.5, color: colors.textCharcoal, lineHeight: 14 },
  nearestAction: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.brandSage,
  },

  readout: { fontSize: 10, color: colors.textSlate, lineHeight: 14 },
  readoutNote: { fontSize: 10, color: colors.brandGold, lineHeight: 14 },
  readoutEmpty: { fontSize: 10, color: colors.textMuted, lineHeight: 14 },
  error: {
    fontSize: 10,
    color: colors.statusError,
    lineHeight: 14,
    backgroundColor: tints.error08,
    borderRadius: radius.md,
    padding: 8,
  },

  mapWrapper: {
    height: 220,
    borderRadius: radius.xxl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgSand,
    ...shadow.xs,
  },
  mapHintOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: colors.cardPure,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  mapHintText: { fontSize: 10.5, fontWeight: '700', color: colors.textCharcoal },
  /**
   * Dead centre of the map, lifted by half the pin plus its stem so the point
   * of the stem — not the middle of the badge — sits on the coordinate the map
   * is centred on.
   */
  centrePin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -14,
    marginTop: -34,
    alignItems: 'center',
  },
  pinStem: {
    width: 2,
    height: 6,
    backgroundColor: colors.brandGold,
  },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: colors.brandGold,
    ...shadow.md,
  },
});

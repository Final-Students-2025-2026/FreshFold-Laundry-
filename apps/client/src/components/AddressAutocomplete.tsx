/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MapPin, Star } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PlaceDetail, PlaceSuggestion } from '@freshfold/core';
import { api } from '../services/api';
import { colors, radius, shadow, tints } from '../theme';
import { Field } from './ui';

/**
 * The pickup address, with the map's help.
 *
 * Still free text, and deliberately so — "Block B, Room 304" is the half of a
 * KNUST address no lookup service has heard of, and the courier reads it at the
 * door. What the lookup adds is the other half: choosing "Evandy Hostel" from
 * the list puts the pin on Evandy Hostel, so the room number gets typed onto an
 * address already in the right place rather than after dragging a map across
 * campus.
 *
 * FreshFold's own hostels answer first and cost nothing; Google covers the
 * rest, restricted to the service area. Both come through the dispatch server,
 * so no billed key ships in this bundle.
 */

interface AddressAutocompleteProps {
  value: string;
  onChangeText: (next: string) => void;
  /** Fired when a suggestion is chosen, with the address and its coordinate. */
  onPlaceSelected: (detail: PlaceDetail) => void;
  label?: string;
  placeholder?: string;
  hint?: string;
}

/** Long enough that the list is not rebuilt on every keystroke. */
const DEBOUNCE_MS = 300;

export default function AddressAutocomplete({
  value,
  onChangeText,
  onPlaceSelected,
  label = 'Pickup address',
  placeholder,
  hint,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);

  /**
   * Google bills a lookup as one search when the keystrokes and the detail
   * call that ends it share a token, and as one autocomplete per keystroke
   * when they do not.
   */
  const sessionRef = useRef(newSession());

  /** Set while a selection is applied, so the effect does not re-open the list. */
  const justSelected = useRef(false);

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }

    const query = value.trim();
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const next = await api.searchPlaces(query, sessionRef.current);
        if (!cancelled) setSuggestions(next);
      } catch {
        // Offline, rate-limited, or no key configured. This is still a text
        // field and the pin can still be placed by hand.
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  const choose = async (suggestion: PlaceSuggestion) => {
    justSelected.current = true;
    setSuggestions([]);

    // A landmark already knows where it is; asking the server would be a round
    // trip to re-read a table this app already ships.
    if (suggestion.source === 'landmark' && suggestion.coords) {
      onPlaceSelected({
        id: suggestion.id,
        address: suggestion.primary,
        coords: suggestion.coords,
      });
      return;
    }

    setBusy(true);
    try {
      const detail = await api.getPlace(suggestion.id, sessionRef.current);
      onPlaceSelected(detail);
    } catch {
      // The lookup failed after they picked a row. Take the text — it is what
      // they chose — and leave the pin to them.
      onChangeText(suggestion.primary);
    } finally {
      setBusy(false);
      sessionRef.current = newSession();
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        hint={hint}
        icon={
          busy ? (
            <ActivityIndicator size="small" color={colors.brandSage} />
          ) : (
            <MapPin size={15} color={colors.textMuted} />
          )
        }
      />

      {suggestions.length > 0 && (
        <View style={styles.list}>
          {suggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion.id}
              onPress={() => void choose(suggestion)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowDivided,
                pressed && { backgroundColor: tints.sage08 },
              ]}
            >
              {suggestion.source === 'landmark' ? (
                <Star size={13} color={colors.brandGold} fill={colors.brandGold} />
              ) : (
                <MapPin size={13} color={colors.textMuted} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.primary} numberOfLines={1}>
                  {suggestion.primary}
                </Text>
                {!!suggestion.secondary && (
                  <Text style={styles.secondary} numberOfLines={1}>
                    {suggestion.secondary}
                  </Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function newSession(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

const styles = StyleSheet.create({
  list: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
    overflow: 'hidden',
    ...shadow.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  primary: { fontSize: 11.5, fontWeight: '700', color: colors.textCharcoal },
  secondary: { fontSize: 10, color: colors.textSlate, marginTop: 1 },
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SERVICE_SUBURBS, deriveSuburb, type Coords } from '@freshfold/core';
import { useT } from '../i18n';
import { useClient, type SavedAddress } from '../store/ClientStore';
import { colors, radius, tints } from '../theme';
import AddressAutocomplete from './AddressAutocomplete';
import { Button, Field, SectionLabel, Sheet } from './ui';

/**
 * Add or change a saved pickup address.
 *
 * Lifted out of the account tab, which had this form inline and could only add.
 * The settings screen needs to edit as well — an address is a hostel block and a
 * room number, and a room number changes every year — and two copies of a form
 * that writes the same record is how they drift apart.
 *
 * Pass `editing` to change an address, or leave it undefined to add one.
 *
 * The address field is the booking screen's, lookup and all: choosing a place
 * from the list is what gives a saved address the doorstep pin, and the pin is
 * what makes the collection zone certain rather than guessed. When there is no
 * pin and the text matches nothing in the landmark table, the zone is asked for
 * — see the note on `zone` below. One of the three has to answer, because
 * `normaliseAddresses` drops an entry with no zone and a form that closed on a
 * dropped entry would be indistinguishable from one that saved it.
 */
export default function AddressSheet({
  visible,
  onClose,
  editing,
}: {
  visible: boolean;
  onClose: () => void;
  editing?: SavedAddress | null;
}) {
  const { addresses, saveAddress } = useClient();
  const { t } = useT();

  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Kumasi');
  const [coords, setCoords] = useState<Coords | undefined>(undefined);
  /**
   * The text of the place chosen from the list, lowercased, while its pin is
   * still the one in `coords`. Empty when the pin was inherited from the record
   * or when there is no pin.
   *
   * It exists to answer "is this pin still about this address?". The room number
   * gets typed onto the end of the place name, so the name staying inside the
   * text is what keeps the pin honest — and a customer who clears the field and
   * types a different building has to lose it, or the courier is sent to the
   * last one they picked with nothing on screen saying so.
   */
  const [placedFor, setPlacedFor] = useState('');
  /**
   * The zone the customer picked by hand, used only when nothing else can tell.
   *
   * Seeded from the record being edited rather than blanked, so changing a room
   * number on an address whose text never matched a landmark does not make them
   * re-answer a question they already answered.
   */
  const [zone, setZone] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Seeded when the sheet opens rather than on every render, so typing is not
  // fighting the props. Closing and reopening is what resets it, which is also
  // what clears a half-typed address the customer abandoned.
  useEffect(() => {
    if (!visible) return;
    setLabel(editing?.label ?? '');
    setAddress(editing?.address ?? '');
    setCity(editing?.city ?? 'Kumasi');
    setCoords(editing?.coords ? { ...editing.coords } : undefined);
    setPlacedFor('');
    setZone(editing?.suburb ?? '');
    setError(null);
  }, [visible, editing]);

  /**
   * The collection zone, read out of what the customer has actually told us.
   *
   * A pin beats the landmark table and the table beats nothing — see
   * `deriveSuburb`. The pin is either the one already on the record or the one
   * that came with a place chosen from the list, and either way it decides the
   * zone on geometry rather than on a spelling.
   */
  const derived = useMemo(() => deriveSuburb(coords ?? null, address), [coords, address]);

  /**
   * What will be saved. The derived zone wins when there is one: it and the pin
   * come from the same place, so they cannot disagree, whereas a hand-picked
   * zone and a pin can.
   */
  const suburb = derived || zone;

  const commit = () => {
    const trimmed = address.trim();
    if (!trimmed) {
      setError(t('address.error.address'));
      return;
    }
    // Refused rather than saved blank, and refused *here*, with the sheet still
    // open: the shared rules drop an entry with no zone, so closing on one
    // would show the customer a book that never gained the address they just
    // typed and no reason why.
    if (!suburb) {
      setError(t('address.error.zone'));
      return;
    }

    saveAddress({
      // Editing keeps the id, so this replaces the record rather than adding a
      // second one — and keeps `isDefault`, which this form does not ask about
      // and must not silently drop.
      id: editing?.id ?? `addr-${Date.now()}`,
      // Falls back to the collection zone before it falls back to a generic
      // word, so an unnamed address reads as "Ayeduase" rather than as
      // "Pickup address". The generic word is translated and then *stored*,
      // which is deliberate: from the moment it is saved this is the customer's
      // own label, the same as one they typed, and relabelling their records
      // behind them when they change language would be the stranger behaviour.
      label: label.trim() || suburb || t('address.fallbackLabel'),
      address: trimmed,
      suburb,
      city: city.trim(),
      coords,
      isDefault: editing ? editing.isDefault : addresses.length === 0,
    });

    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{editing ? t('address.edit') : t('address.add')}</Text>

        <Field
          label={t('address.label')}
          value={label}
          onChangeText={setLabel}
          placeholder={t('address.labelPlaceholder')}
        />

        <AddressAutocomplete
          label={t('address.address')}
          value={address}
          onChangeText={(next) => {
            setAddress(next);
            if (error) setError(null);
            // The place's name is gone from the text, so the text is about
            // somewhere else and its pin has to go with it.
            if (placedFor && !next.toLowerCase().includes(placedFor)) {
              setCoords(undefined);
              setPlacedFor('');
            }
          }}
          onPlaceSelected={(detail) => {
            setAddress(detail.address);
            setCoords(detail.coords);
            setPlacedFor(detail.address.trim().toLowerCase());
            setError(null);
          }}
          placeholder={t('address.addressPlaceholder')}
          // The booking screen's sentence, borrowed rather than restated. It is
          // the same advice about the same field, and the same sentence written
          // into a second key is the same sentence to keep in step across five
          // dictionaries.
          hint={t('book.address.hint')}
        />

        {/* The suburb sheet used to sit here, and asked every time. It is read
            off the pin or the landmark table now, and only asked for when
            neither of those can answer. */}
        <Field
          label={t('address.city')}
          value={city}
          onChangeText={setCity}
          placeholder={t('address.cityPlaceholder')}
        />

        {!derived && (
          <View style={{ gap: 7 }}>
            <Text style={styles.zoneLabel}>{t('address.zone')}</Text>
            <Text style={styles.zoneHint}>{t('address.zoneHint')}</Text>
            <View style={styles.zoneWrap}>
              {SERVICE_SUBURBS.map((name) => {
                const selected = zone === name;
                return (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setZone(name);
                      setError(null);
                    }}
                    style={({ pressed }) => [
                      styles.zoneChip,
                      selected && styles.zoneChipActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.zoneChipLabel, selected && styles.zoneChipLabelActive]}>
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <SectionLabel>
          {placedFor
            ? t('address.pinPlaced')
            : coords
              ? t('address.pinKept')
              : t('address.pinDerived')}
        </SectionLabel>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.actions}>
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={onClose}
            style={{ flex: 1 }}
          />
          <Button
            label={editing ? t('address.saveChanges') : t('address.save')}
            onPress={commit}
            disabled={!address.trim()}
            style={{ flex: 1.3 }}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, paddingTop: 8, gap: 13 },
  title: { fontSize: 16, fontWeight: '800', color: colors.textCharcoal },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },

  zoneLabel: { fontSize: 11, fontWeight: '700', color: colors.textCharcoal },
  zoneHint: { fontSize: 10, color: colors.textSlate, lineHeight: 14 },
  zoneWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  zoneChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.bgLinen,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  zoneChipActive: { backgroundColor: tints.sage12, borderColor: tints.sage25 },
  zoneChipLabel: { fontSize: 10.5, fontWeight: '600', color: colors.textSlate },
  zoneChipLabelActive: { color: colors.brandSage, fontWeight: '700' },

  error: { fontSize: 10.5, color: colors.statusError, lineHeight: 14.5 },
});

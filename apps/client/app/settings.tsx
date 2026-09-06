/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  CircleAlert,
  Clock,
  Fingerprint,
  KeyRound,
  Languages,
  Mail,
  MapPin,
  MessageSquare,
  Package,
  Pencil,
  Phone,
  Plus,
  Server,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  UserCog,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiError,
  MAX_SAVED_ADDRESSES,
  PHONE_DIGITS,
  isCompletePhone,
  limitPhoneInput,
  membershipPlan,
} from '@freshfold/core';
import AddressSheet from '../src/components/AddressSheet';
import {
  Badge,
  Button,
  Card,
  Divider,
  Field,
  OptionRow,
  SectionHeader,
  Sheet,
} from '../src/components/ui';
import { CONTACT } from '../src/data/catalogue';
import {
  LOCALES,
  LOCALE_LABELS,
  coverage,
  deviceLocale,
  useT,
  type TranslationKey,
} from '../src/i18n';
import { API_BASE_URL } from '../src/services/api';
import { useClient, type SavedAddress } from '../src/store/ClientStore';
import { usePreferences, type AlertKind } from '../src/store/PreferencesStore';
import { useSession } from '../src/store/SessionStore';
import { colors, formatCedis, radius, tints } from '../src/theme';

/**
 * Settings.
 *
 * A separate screen rather than more rows on the account tab, which is a
 * dashboard: it answers "how are my orders", and the things that change an
 * account do not belong in the middle of that answer.
 *
 * Every control here writes something. The account tab used to carry a lone
 * biometric switch and no way to correct a mistyped name; the website's own
 * settings tab is worse — editable fields over a Save button that sets a success
 * message and writes nothing. So the rule for this screen is that nothing lands
 * on it before the write behind it exists, which is why appearance is not here
 * yet.
 *
 * Usable signed out, like every other screen in this app: the saved addresses
 * are device-local and pre-fill a visitor's booking just as they do a
 * customer's.
 *
 * This is also the first screen to read its copy through `useT()`, deliberately:
 * it hosts the language picker, so it is the one screen where changing the
 * setting has to visibly do something the moment it is tapped.
 */

/**
 * Keys rather than strings, because this array is module-scope and `t` is not.
 * The rows read in whatever language is current at render.
 */
const ALERT_ROWS: { kind: AlertKind; title: TranslationKey; caption: TranslationKey }[] = [
  { kind: 'order', title: 'settings.alerts.order', caption: 'settings.alerts.orderCaption' },
  { kind: 'message', title: 'settings.alerts.message', caption: 'settings.alerts.messageCaption' },
  { kind: 'alert', title: 'settings.alerts.alert', caption: 'settings.alerts.alertCaption' },
];

/**
 * What the handset asks for, read once.
 *
 * Changing the OS language restarts a React Native app, so there is nothing to
 * re-read and no reason to hold it in state.
 */
const DEVICE_LANGUAGE = LOCALE_LABELS[deviceLocale()].name;

export default function SettingsScreen() {
  const router = useRouter();
  const { t, locale } = useT();
  const { account, isAuthenticated, biometricAvailable, deleteAccount, requestPasswordReset } =
    useSession();
  const {
    addresses,
    saveAddress,
    removeAddress,
    saveProfile,
    walletBalance,
    plan,
    forgetLocalData,
  } = useClient();
  const {
    biometricEnabled,
    setBiometricEnabled,
    alertTypes,
    setAlertType,
    locale: localePreference,
    setLocale,
  } = usePreferences();

  const [name, setName] = useState(account?.name ?? '');
  const [phone, setPhone] = useState(limitPhoneInput(account?.phone ?? ''));
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');

  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState('');

  const [sheet, setSheet] = useState<{ open: boolean; editing: SavedAddress | null }>({
    open: false,
    editing: null,
  });

  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  /**
   * Seeded from the account, and re-seeded only when it is a different account.
   *
   * Deliberately keyed on the email rather than on `account`: the data layer
   * re-applies the profile whenever a poll or a wallet payment brings back a
   * fresh copy, and re-seeding on that would wipe out whatever was half-typed
   * at the moment it landed.
   *
   * `resetNotice` is cleared here too. It names the address the link went to, so
   * carrying it across a change of account would show one customer's email
   * on another customer's settings screen.
   */
  useEffect(() => {
    setName(account?.name ?? '');
    setPhone(limitPhoneInput(account?.phone ?? ''));
    setProfileError('');
    setProfileNotice('');
    setResetNotice('');
  }, [account?.email]);

  // Both sides through `limitPhoneInput`, so a stored `+233 24 456 7801` and a
  // typed `0244567801` compare equal rather than reading as an edit.
  const phoneChanged = phone !== limitPhoneInput(account?.phone ?? '');
  const dirty = name.trim() !== (account?.name ?? '').trim() || phoneChanged;

  const saveDetails = useCallback(async () => {
    const trimmed = name.trim();
    const numberChanged = phoneChanged;

    setProfileError('');
    setProfileNotice('');

    if (!trimmed) {
      setProfileError(t('settings.details.nameBlank'));
      return;
    }
    if (!isCompletePhone(phone)) {
      // The check is `isCompletePhone` from the shared package, so the app
      // validates a number one way; only the sentence about it is local, because
      // core's copy is read by the desk console and the rider app too.
      setProfileError(t('settings.details.phoneLength', { digits: PHONE_DIGITS }));
      return;
    }

    setSaving(true);
    try {
      await saveProfile({ name: trimmed, phone });
      setProfileNotice(
        numberChanged
          ? // Worth saying plainly: dispatch finds a visitor's orders by the
            // number they booked on, so moving the number moves which of them
            // this account can see.
            t('settings.details.savedNewPhone')
          : t('settings.details.saved')
      );
    } catch (error) {
      setProfileError(
        error instanceof ApiError
          ? // The server's own sentence, which for a number already in use
            // names that specifically. Untranslated, and knowingly: the desk
            // writes these, and an English sentence a customer can read beats a
            // guess at what the server meant.
            error.message
          : t('settings.details.failed')
      );
    } finally {
      setSaving(false);
    }
  }, [name, phone, phoneChanged, saveProfile, t]);

  /**
   * Mails a reset link.
   *
   * There is no change-password endpoint for a customer, so this is the whole
   * of it — and the row says so rather than pretending to a form. The wording
   * drops the sign-in screen's "if that contact has an account" hedge, which
   * exists there to avoid confirming who is registered: here we are signed in
   * as the account, so there is nothing left to withhold.
   */
  const sendResetLink = useCallback(async () => {
    if (!account) return;

    setResetBusy(true);
    setResetNotice('');
    try {
      await requestPasswordReset(account.email);
      setResetNotice(t('settings.security.resetSent', { email: account.email }));
    } catch {
      setResetNotice(t('common.unreachable'));
    } finally {
      setResetBusy(false);
    }
  }, [account, requestPasswordReset, t]);

  const confirmRemoveAddress = useCallback(
    (saved: SavedAddress) => {
      Alert.alert(t('addresses.confirmRemove'), saved.address, [
        { text: t('common.keep'), style: 'cancel' },
        { text: t('common.remove'), style: 'destructive', onPress: () => removeAddress(saved.id) },
      ]);
    },
    [removeAddress, t]
  );

  /**
   * Opens the address sheet, or says why it will not.
   *
   * The book has a ceiling now that it is a column on the account, and the
   * server refuses a longer one — so the Add button has to answer for it here.
   * A sheet that opened, took an address and then quietly dropped it would be
   * the worse version of this.
   */
  const addAddress = useCallback(() => {
    if (addresses.length >= MAX_SAVED_ADDRESSES) {
      Alert.alert(
        t('settings.addresses.title'),
        t('addresses.full', { max: MAX_SAVED_ADDRESSES })
      );
      return;
    }
    setSheet({ open: true, editing: null });
  }, [addresses.length, t]);

  /**
   * Closes the account, then takes it off this device.
   *
   * The order is the point. `deleteAccount` is the call that can be refused — a
   * pickup still out comes back 409 — and a device wiped ahead of that refusal
   * would have thrown away the orders of an account that still exists. So
   * nothing local is touched until the server has agreed, and then all three
   * pieces go: the session, the mirrored orders and addresses, and the biometric
   * opt-in, which was consent to unlock an account there no longer is.
   */
  const confirmDelete = useCallback(async () => {
    setDeleteError('');
    setDeleting(true);
    try {
      await deleteAccount();
      await forgetLocalData();
      setBiometricEnabled(false);
      setDangerOpen(false);
      // `replace`, not `push`: leaving this screen on the stack would let a back
      // swipe return to a signed-in account's controls.
      router.replace('/');
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? // The live-order refusal names the open orders in its own sentence,
            // and it is the one thing here the customer can act on.
            error.message
          : t('settings.danger.failed')
      );
    } finally {
      setDeleting(false);
    }
  }, [deleteAccount, forgetLocalData, setBiometricEnabled, router, t]);

  // The account carries only the plan id, so the readable name comes from the
  // catalogue — and is left blank rather than guessed if the id is one this
  // build does not know.
  const planName = membershipPlan(plan?.planId)?.name ?? '';

  /**
   * The word to type to close the account, from the dictionary rather than a
   * literal.
   *
   * One lookup feeding the label, the placeholder and the comparison, so a
   * translated prompt can never ask for a word the check would refuse. Every
   * non-English file leaves the key out, so in practice this is always `DELETE`.
   */
  const confirmToken = t('settings.danger.confirmWord');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.back}
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={17} color={colors.textCharcoal} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('settings.title')}</Text>
          <Text style={styles.headerSub}>
            {isAuthenticated && account ? account.email : t('common.guest')}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* --------------------------------------------------------- profile */}
        {isAuthenticated && account ? (
          <View>
            <SectionHeader
              title={t('settings.details.title')}
              caption={t('settings.details.caption')}
            />
            <Card style={{ gap: 13 }}>
              <Field
                label={t('settings.details.name')}
                value={name}
                onChangeText={setName}
                placeholder={t('settings.details.namePlaceholder')}
                autoCapitalize="words"
              />
              <Field
                label={t('settings.details.phone')}
                value={phone}
                onChangeText={(next) => setPhone(limitPhoneInput(next))}
                placeholder={t('settings.details.phonePlaceholder', { digits: PHONE_DIGITS })}
                keyboardType="phone-pad"
                maxLength={PHONE_DIGITS}
                icon={<Phone size={15} color={colors.textMuted} />}
              />
              <Field
                label={t('settings.details.email')}
                value={account.email}
                onChangeText={() => {}}
                editable={false}
                hint={t('settings.details.emailHint')}
                icon={<Mail size={15} color={colors.textMuted} />}
              />

              {!!profileError && <Text style={styles.error}>{profileError}</Text>}
              {/* Withdrawn as soon as the form is dirty again: it says what was
                  saved, and once the fields have moved on it is describing
                  something other than what is on screen. */}
              {!!profileNotice && !profileError && !dirty && (
                <Text style={styles.notice}>{profileNotice}</Text>
              )}

              <Button
                label={saving ? t('common.saving') : t('settings.details.save')}
                onPress={saveDetails}
                disabled={!dirty}
                loading={saving}
              />
            </Card>
          </View>
        ) : (
          <Card style={{ gap: 12 }}>
            <Text style={styles.guestTitle}>{t('settings.guestCard.title')}</Text>
            <Text style={styles.guestBody}>{t('settings.guestCard.body')}</Text>
            <Button label={t('common.signInCta')} onPress={() => router.push('/auth')} />
          </Card>
        )}

        {/* -------------------------------------------------------- security */}
        {isAuthenticated && account && (
          <View style={styles.section}>
            <SectionHeader title={t('settings.security.title')} />
            <Card style={{ gap: 4 }}>
              <SwitchRow
                icon={<Fingerprint size={15} color={colors.brandSage} />}
                title={t('settings.security.biometric')}
                caption={
                  biometricAvailable
                    ? t('settings.security.biometricOn')
                    : t('settings.security.biometricOff')
                }
                value={biometricEnabled}
                onValueChange={setBiometricEnabled}
                disabled={!biometricAvailable}
              />

              <Divider style={{ marginVertical: 6 }} />

              <Pressable
                onPress={sendResetLink}
                disabled={resetBusy}
                style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.78 }]}
              >
                <View style={styles.rowIcon}>
                  <KeyRound size={15} color={colors.brandSage} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {resetBusy ? t('common.sending') : t('settings.security.reset')}
                  </Text>
                  <Text style={styles.rowCaption}>
                    {resetNotice || t('settings.security.resetCaption')}
                  </Text>
                </View>
              </Pressable>

              <Divider style={{ marginVertical: 6 }} />

              <View style={styles.assuranceRow}>
                <ShieldCheck size={14} color={colors.brandSage} />
                <Text style={styles.assuranceText}>{t('settings.security.assurance')}</Text>
              </View>
            </Card>
          </View>
        )}

        {/* ------------------------------------------------------- addresses */}
        <View style={styles.section}>
          <SectionHeader
            title={t('settings.addresses.title')}
            caption={t('settings.addresses.caption')}
            action={t('common.add')}
            onAction={addAddress}
          />

          {addresses.length === 0 ? (
            <Pressable onPress={addAddress}>
              <Card tone="sunken" style={styles.addRow}>
                <Plus size={16} color={colors.brandSage} />
                <Text style={styles.addLabel}>{t('addresses.empty')}</Text>
              </Card>
            </Pressable>
          ) : (
            <View style={{ gap: 8 }}>
              {addresses.map((saved) => (
                <OptionRow
                  key={saved.id}
                  title={saved.label}
                  subtitle={[saved.address, saved.suburb, saved.city].filter(Boolean).join(', ')}
                  icon={<MapPin size={15} color={colors.brandSage} />}
                  selected={saved.isDefault}
                  // The store collapses this to exactly one default, so there is
                  // nothing to clear first.
                  onPress={() => saveAddress({ ...saved, isDefault: true })}
                  trailing={
                    <View style={styles.rowActions}>
                      {saved.isDefault && <Badge label={t('common.default')} tone="sage" />}
                      <Pressable
                        onPress={() => setSheet({ open: true, editing: saved })}
                        hitSlop={8}
                        accessibilityLabel={t('addresses.edit', { label: saved.label })}
                      >
                        <Pencil size={14} color={colors.textSlate} />
                      </Pressable>
                      <Pressable
                        onPress={() => confirmRemoveAddress(saved)}
                        hitSlop={8}
                        accessibilityLabel={t('addresses.remove', { label: saved.label })}
                      >
                        <Trash2 size={14} color={colors.statusError} />
                      </Pressable>
                    </View>
                  }
                />
              ))}
            </View>
          )}
        </View>

        {/*
          ---------------------------------------------------------- alerts
          Signed in only: the feed is pulled with the session and marked read
          against it, so a guest has nothing to filter.
        */}
        {isAuthenticated && (
          <View style={styles.section}>
            <SectionHeader
              title={t('settings.alerts.title')}
              // Said plainly because it is not what a settings screen usually
              // means here: the app has no push library, so these switches
              // govern the bell inside the app and nothing else. A row labelled
              // "push notifications" would be promising something that cannot
              // happen.
              caption={t('settings.alerts.caption')}
            />
            <Card style={{ gap: 4 }}>
              {ALERT_ROWS.map((row, index) => (
                <View key={row.kind}>
                  {index > 0 && <Divider style={{ marginVertical: 6 }} />}
                  <SwitchRow
                    icon={<AlertIcon kind={row.kind} />}
                    title={t(row.title)}
                    caption={t(row.caption)}
                    value={alertTypes[row.kind]}
                    onValueChange={(next) => setAlertType(row.kind, next)}
                  />
                </View>
              ))}

              <Divider style={{ marginVertical: 6 }} />

              <View style={styles.assuranceRow}>
                <Bell size={14} color={colors.brandSage} />
                <Text style={styles.assuranceText}>{t('settings.alerts.assurance')}</Text>
              </View>
            </Card>
          </View>
        )}

        {/*
          -------------------------------------------------------- language
          Shown to guests as well: reading the app is not something you should
          have to have an account to do in your own language.

          Each option is named in its own language first, because a list of
          languages written in one you cannot read is not a list you can choose
          from. The English name sits underneath so somebody who has landed in
          the wrong one can find their way back out.
        */}
        <View style={styles.section}>
          <SectionHeader
            title={t('settings.language.title')}
            caption={t('settings.language.caption')}
          />
          <View style={{ gap: 8 }}>
            <OptionRow
              title={t('settings.language.system')}
              subtitle={t('settings.language.systemCaption', { language: DEVICE_LANGUAGE })}
              icon={<Smartphone size={15} color={colors.brandSage} />}
              selected={localePreference === 'system'}
              onPress={() => setLocale('system')}
            />

            {LOCALES.map((option) => {
              const label = LOCALE_LABELS[option];
              return (
                <OptionRow
                  key={option}
                  title={label.name}
                  // Nothing under English, where the endonym and the English
                  // name are the same word and repeating it reads as a mistake.
                  subtitle={label.name === label.english ? undefined : label.english}
                  icon={<Languages size={15} color={colors.brandSage} />}
                  selected={localePreference === option}
                  onPress={() => setLocale(option)}
                  trailing={
                    coverage(option) < 1 ? (
                      <Badge label={t('settings.language.partial')} tone="warning" />
                    ) : undefined
                  }
                />
              );
            })}
          </View>

          {/*
            Keyed on the language actually being rendered, not on the one tapped,
            so it covers "follow this phone" landing on a part-written language
            too.

            Silent today: Spanish and French are both complete, so `coverage` is
            1 for all three and this renders nothing. It stays because the state
            it describes returns the moment somebody adds a string to `en` — and
            a customer reading a half-translated screen should be told the copy
            is unfinished, since one who knows reports the wording and one who
            does not reports the app.
          */}
          {coverage(locale) < 1 && (
            <Card tone="sunken" style={styles.draftCard}>
              <TriangleAlert size={14} color={colors.brandGold} />
              <Text style={styles.draftText}>
                {t('settings.language.draft', { language: LOCALE_LABELS[locale].name })}
              </Text>
            </Card>
          )}
        </View>

        {/* ----------------------------------------------------------- about */}
        <View style={styles.section}>
          <SectionHeader title={t('settings.about.title')} caption={t('settings.about.caption')} />
          <Card style={{ gap: 2 }}>
            <InfoRow
              icon={<UserCog size={15} color={colors.brandSage} />}
              label={t('settings.about.version')}
              value={Constants.expoConfig?.version ?? '1.0.0'}
            />
            <InfoRow
              icon={<Server size={15} color={colors.brandSage} />}
              label={t('settings.about.server')}
              value={API_BASE_URL}
            />
            <InfoRow
              icon={<Clock size={15} color={colors.brandSage} />}
              label={t('settings.about.hours')}
              value={CONTACT.hours}
            />

            <Divider style={{ marginVertical: 6 }} />

            <Pressable
              onPress={() => Linking.openURL(`tel:${CONTACT.phone.replace(/\s/g, '')}`)}
              style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.78 }]}
            >
              <View style={styles.rowIcon}>
                <Phone size={15} color={colors.brandSage} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{CONTACT.phone}</Text>
                <Text style={styles.rowCaption}>{t('settings.about.call')}</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => Linking.openURL(`mailto:${CONTACT.email}`)}
              style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.78 }]}
            >
              <View style={styles.rowIcon}>
                <Mail size={15} color={colors.brandSage} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{CONTACT.email}</Text>
                <Text style={styles.rowCaption}>{t('settings.about.email')}</Text>
              </View>
            </Pressable>
          </Card>

          {/*
            No Terms or Privacy rows. FreshFold has no such documents written,
            and a row linking to a URL that does not exist is worse than no row.
            Both are needed before an App Store submission.
          */}
        </View>

        {/*
          ------------------------------------------------------ danger zone
          Last, and signed in only — there is nothing to close otherwise. An
          app that lets people sign up has to let them close the account from
          inside it, and a mail-the-desk row is not that.
        */}
        {isAuthenticated && account && (
          <View style={styles.section}>
            <SectionHeader title={t('settings.danger.title')} />
            <Card style={styles.dangerCard}>
              <View style={styles.assuranceRow}>
                <TriangleAlert size={14} color={colors.statusError} />
                <Text style={styles.dangerText}>{t('settings.danger.body')}</Text>
              </View>

              <Button
                label={t('settings.danger.action')}
                variant="danger"
                icon={<Trash2 size={15} color={colors.statusError} />}
                onPress={() => {
                  setConfirmWord('');
                  setDeleteError('');
                  setDangerOpen(true);
                }}
              />
            </Card>
          </View>
        )}
      </ScrollView>

      <AddressSheet
        visible={sheet.open}
        editing={sheet.editing}
        onClose={() => setSheet({ open: false, editing: null })}
      />

      {/*
        A sheet with a word to type, not an `Alert` with two buttons. Every other
        confirmation in this app is an `Alert` because every other one is
        reversible — an address can be added back, a booking can be rebooked.
        This one takes the history with it, so it asks for something that cannot
        be done by tapping in the wrong place, and it says what goes before it
        asks.
      */}
      <Sheet visible={dangerOpen} onClose={() => setDangerOpen(false)}>
        <ScrollView contentContainerStyle={styles.dangerSheet} keyboardShouldPersistTaps="handled">
          <Text style={styles.sheetTitle}>{t('settings.danger.confirmTitle')}</Text>
          <Text style={styles.sheetBody}>
            {t('settings.danger.confirmBody', {
              email: account?.email ?? t('settings.danger.yourAccount'),
            })}
          </Text>

          {/*
            Named in cedis, because "forfeited" is easy to skim past and a number
            is not. There is no refund path — building one is a different job —
            and refusing to close the account over a balance would trap the
            person asking to leave, so the server goes ahead and this is where
            they hear it first.
          */}
          {walletBalance > 0 && (
            <View style={styles.forfeitRow}>
              <TriangleAlert size={14} color={colors.statusError} />
              <Text style={styles.forfeitText}>
                {t('settings.danger.wallet', { amount: formatCedis(walletBalance, locale) })}
              </Text>
            </View>
          )}

          {!!plan && (
            <View style={styles.forfeitRow}>
              <TriangleAlert size={14} color={colors.statusError} />
              <Text style={styles.forfeitText}>
                {/*
                  Two keys rather than one with an optional clause: a plan whose
                  id this build does not recognise has no readable name, and
                  "Your membership () ends immediately" is worse than a sentence
                  that simply does not name it.
                */}
                {t(planName ? 'settings.danger.planNamed' : 'settings.danger.plan', {
                  plan: planName,
                })}
              </Text>
            </View>
          )}

          <Field
            label={t('settings.danger.typeToConfirm', { word: confirmToken })}
            value={confirmWord}
            onChangeText={setConfirmWord}
            placeholder={confirmToken}
            autoCapitalize="characters"
          />

          {!!deleteError && <Text style={styles.error}>{deleteError}</Text>}

          <View style={styles.sheetActions}>
            <Button
              label={t('settings.danger.keep')}
              variant="ghost"
              onPress={() => setDangerOpen(false)}
              disabled={deleting}
              style={{ flex: 1 }}
            />
            <Button
              label={deleting ? t('settings.danger.deleting') : t('settings.danger.delete')}
              variant="danger"
              onPress={confirmDelete}
              // Case-insensitive: the gate exists to stop a stray tap, not to
              // test typing.
              disabled={confirmWord.trim().toUpperCase() !== confirmToken.toUpperCase()}
              loading={deleting}
              style={{ flex: 1.3 }}
            />
          </View>
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}

/** The icon the notifications sheet already uses for this kind. */
function AlertIcon({ kind }: { kind: AlertKind }) {
  if (kind === 'order') return <Package size={15} color={colors.brandSage} />;
  if (kind === 'message') return <MessageSquare size={15} color={colors.statusInfo} />;
  return <CircleAlert size={15} color={colors.statusWarning} />;
}

function SwitchRow({
  icon,
  title,
  caption,
  value,
  onValueChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  caption: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowCaption}>{caption}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.brandSage, false: colors.bgSand }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.actionRow}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowCaption} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 19, fontWeight: '800', color: colors.textCharcoal, letterSpacing: -0.4 },
  headerSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },

  scroll: { padding: 20, paddingTop: 4, paddingBottom: 44 },
  section: { marginTop: 28 },

  guestTitle: { fontSize: 14, fontWeight: '800', color: colors.textCharcoal },
  guestBody: { fontSize: 10.5, color: colors.textSlate, lineHeight: 16 },

  error: { fontSize: 10.5, color: colors.statusError, lineHeight: 15 },
  notice: { fontSize: 10.5, color: colors.brandSage, lineHeight: 15 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 12.5, fontWeight: '700', color: colors.textCharcoal },
  rowCaption: { fontSize: 10, color: colors.textSlate, marginTop: 2, lineHeight: 14 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  assuranceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  assuranceText: { flex: 1, fontSize: 10, color: colors.textMuted, lineHeight: 14.5 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15 },
  addLabel: { fontSize: 12, fontWeight: '700', color: colors.brandSage },

  draftCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 10,
    borderColor: tints.gold18,
  },
  draftText: { flex: 1, fontSize: 10, color: colors.textSlate, lineHeight: 14.5 },

  dangerCard: { gap: 14, borderColor: tints.error25 },
  dangerText: { flex: 1, fontSize: 10, color: colors.textSlate, lineHeight: 14.5 },

  dangerSheet: { padding: 20, paddingTop: 8, gap: 13 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: colors.textCharcoal },
  sheetBody: { fontSize: 11, color: colors.textSlate, lineHeight: 16.5 },
  forfeitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: tints.error08,
  },
  forfeitText: { flex: 1, fontSize: 10.5, color: colors.textCharcoal, lineHeight: 15 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});

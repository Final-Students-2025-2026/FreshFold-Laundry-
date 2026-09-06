/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { Activity, ArrowLeft, Bot, Send } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Message, MessageSender } from '@freshfold/core';
import { KeyboardAvoider } from '../src/components/KeyboardAvoider';
import { EmptyState } from '../src/components/ui';
import { useClient } from '../src/store/ClientStore';
import { colors, courierName, radius, shadow, tints } from '../src/theme';

/**
 * One conversation per job, shared by all three surfaces.
 *
 * The rider writes into this thread from the companion app, dispatch narrates
 * every status transition into it server-side, and the customer writes here.
 * There is no separate customer-support inbox for exactly that reason — the
 * courier, the hub and the customer are already talking in one place, and the
 * desk reads these same threads from its own Inbox pane rather than a channel
 * of its own.
 */

const QUICK_REPLIES = [
  'I am at the address, come up to the second floor.',
  'Please leave it with the front desk.',
  'Running ten minutes late — can you wait?',
  'What time should I expect the return?',
];

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { messagesFor, sendMessage, bookingById, primaryBooking } = useClient();

  const orderId = params.id ?? primaryBooking?.id;
  const booking = orderId ? bookingById(orderId) : undefined;

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView | null>(null);

  // Server order, left alone. `timestamp` is a display label like "3:28 AM",
  // and sorting on it put every single-digit hour after every zero-padded one —
  // a note from the morning landed under this evening's. The server already
  // returns each thread by insertion, which is the only ordering that survives
  // both a leading zero and midnight.
  const thread = useMemo(
    () => (orderId ? messagesFor(orderId) : []),
    [orderId, messagesFor]
  );

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 90);
    return () => clearTimeout(timer);
  }, [thread.length]);

  const send = (text?: string) => {
    const body = (text ?? draft).trim();
    if (!body || !orderId) return;
    sendMessage(orderId, body);
    setDraft('');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ArrowLeft size={17} color={colors.textCharcoal} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {booking?.rider ? courierName(booking.rider) : 'FreshFold concierge'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {orderId ? `Order ${orderId}` : 'No order selected'}
          </Text>
        </View>

        <Pressable
          onPress={() => router.replace('/concierge')}
          hitSlop={8}
          style={styles.livePill}
          accessibilityLabel="Ask Foldie instead"
        >
          <Bot size={15} color={colors.brandSage} />
        </Pressable>
      </View>

      <KeyboardAvoider offset={8}>
        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          keyboardShouldPersistTaps="handled"
        >
          {!orderId ? (
            <EmptyState
              icon={<Activity size={24} color={colors.brandStone} />}
              title="No order to talk about"
              body="Book a pickup and this becomes the thread you share with your courier and the hub."
              action="Schedule a pickup"
              onAction={() => router.replace('/(tabs)/book')}
            />
          ) : thread.length === 0 ? (
            <Text style={styles.emptyThread}>
              Nothing said yet. Anything you write here reaches your courier and the concierge desk.
            </Text>
          ) : (
            thread.map((message) => <Bubble key={message.id} message={message} />)
          )}
        </ScrollView>

        {!!orderId && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRow}
              style={styles.quickBar}
            >
              {QUICK_REPLIES.map((reply) => (
                <Pressable
                  key={reply}
                  onPress={() => send(reply)}
                  style={({ pressed }) => [styles.quickChip, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.quickLabel}>{reply}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write a message…"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                onSubmitEditing={() => send()}
                returnKeyType="send"
              />
              <Pressable
                onPress={() => send()}
                accessibilityLabel="Send message"
                style={({ pressed }) => [styles.sendButton, pressed && { opacity: 0.85 }]}
              >
                <Send size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

function Bubble({ message }: { message: Message }) {
  const mine = message.sender === 'customer';

  return (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
      <Text style={[styles.bubbleMeta, mine && styles.bubbleMetaMine]}>
        {mine ? 'You' : senderLabel(message.sender)} · {message.timestamp}
      </Text>
      <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.text}</Text>
    </View>
  );
}

function senderLabel(sender: MessageSender): string {
  switch (sender) {
    case 'rider':
      return 'Courier';
    case 'dispatcher':
      return 'Dispatch';
    case 'laundry_center':
      return 'The hub';
    default:
      return 'You';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.cardPure,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgLinen,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 13, fontWeight: '800', color: colors.textCharcoal },
  headerSubtitle: { fontSize: 9.5, color: colors.textMuted, marginTop: 1 },
  livePill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },

  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10, paddingBottom: 8 },
  emptyThread: {
    fontSize: 11.5,
    color: colors.textSlate,
    textAlign: 'center',
    marginTop: 30,
    paddingHorizontal: 24,
    lineHeight: 17,
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: radius.xl,
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 3,
    ...shadow.xs,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.brandSage,
    borderTopRightRadius: 5,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.cardPure,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderTopLeftRadius: 5,
  },
  bubbleMeta: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  bubbleMetaMine: { color: 'rgba(255,255,255,0.8)' },
  bubbleText: { fontSize: 12, lineHeight: 17, color: colors.textCharcoal },
  bubbleTextMine: { color: '#FFFFFF' },

  quickBar: {
    maxHeight: 48,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.cardPure,
  },
  quickRow: { gap: 7, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  quickChip: {
    backgroundColor: colors.bgLinen,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickLabel: { fontSize: 10, fontWeight: '600', color: colors.textCharcoal },

  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.cardPure,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    padding: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.bgIvory,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13,
    color: colors.textCharcoal,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

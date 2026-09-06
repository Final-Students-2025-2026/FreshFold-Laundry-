/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRouter } from 'expo-router';
import { Bot, Send, Sparkles, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ChatMessage } from '@freshfold/core';
import { KeyboardAvoider } from '../src/components/KeyboardAvoider';
import { api } from '../src/services/api';
import { useClient } from '../src/store/ClientStore';
import { useSession } from '../src/store/SessionStore';
import { colors, radius, shadow, tints } from '../src/theme';

/**
 * Foldie — the concierge assistant, the website's `ChatbotWidget` as a screen.
 *
 * Backed by `/api/chat`, which is Gemini server-side. The history is kept in
 * this component rather than the store on purpose: it is a conversation about
 * the service, not a record of the order, and it should not outlive the sheet.
 *
 * Nothing here can act on the account. If Foldie is asked to cancel an order or
 * move money, the honest answer is to point at the screen that does it, which
 * is what the opening prompt sets up.
 */

const OPENERS = [
  'How much would washing and ironing a week of shirts cost?',
  'What is the difference between the Student and Professional plans?',
  'Can you collect from Ayeduase this evening?',
  'How do you treat a red wine stain on silk?',
];

interface Bubble extends ChatMessage {
  id: string;
  failed?: boolean;
}

export default function ConciergeScreen() {
  const router = useRouter();
  const { account } = useSession();
  const { primaryBooking } = useClient();

  const [messages, setMessages] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 90);
    return () => clearTimeout(timer);
  }, [messages.length, thinking]);

  const ask = useCallback(
    async (text?: string) => {
      const body = (text ?? draft).trim();
      if (!body || thinking) return;

      const question: Bubble = { id: `u-${Date.now()}`, role: 'user', content: body };
      const history = [...messages, question];

      setMessages(history);
      setDraft('');
      setThinking(true);

      try {
        const { reply } = await api.chat(
          history.map(({ role, content }) => ({ role, content }))
        );
        setMessages((current) => [
          ...current,
          { id: `a-${Date.now()}`, role: 'assistant', content: reply },
        ]);
      } catch {
        setMessages((current) => [
          ...current,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content:
              'I cannot reach the concierge service right now. The desk is on +233 200957165, or leave a message on your order and someone will pick it up.',
            failed: true,
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [draft, thinking, messages]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Bot size={17} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Foldie</Text>
          <Text style={styles.headerSubtitle}>
            {thinking ? 'Thinking…' : 'Concierge assistant'}
          </Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <X size={17} color={colors.textCharcoal} />
        </Pressable>
      </View>

      <KeyboardAvoider offset={8}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && (
            <View style={styles.intro}>
              <View style={styles.introMark}>
                <Sparkles size={20} color={colors.brandSage} />
              </View>
              <Text style={styles.introTitle}>
                Hello{account?.name ? `, ${account.name.split(/\s+/)[0]}` : ''}.
              </Text>
              <Text style={styles.introBody}>
                Ask me about services, pricing, fabrics or collection windows.
                {primaryBooking
                  ? ` For anything about order ${primaryBooking.id} specifically, the conversation on that order reaches your actual courier.`
                  : ''}
              </Text>

              <View style={styles.openerWrap}>
                {OPENERS.map((opener) => (
                  <Pressable
                    key={opener}
                    onPress={() => ask(opener)}
                    style={({ pressed }) => [styles.opener, pressed && { opacity: 0.82 }]}
                  >
                    <Text style={styles.openerLabel}>{opener}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {messages.map((message) => {
            const mine = message.role === 'user';
            return (
              <View
                key={message.id}
                style={[
                  styles.bubble,
                  mine ? styles.bubbleMine : styles.bubbleTheirs,
                  message.failed && styles.bubbleFailed,
                ]}
              >
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                  {message.content}
                </Text>
              </View>
            );
          })}

          {thinking && (
            <View style={[styles.bubble, styles.bubbleTheirs, styles.typing]}>
              <ActivityIndicator size="small" color={colors.brandSage} />
              <Text style={styles.typingLabel}>Foldie is typing</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask Foldie anything…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            onSubmitEditing={() => ask()}
            returnKeyType="send"
            editable={!thinking}
          />
          <Pressable
            onPress={() => ask()}
            accessibilityLabel="Send"
            style={({ pressed }) => [
              styles.sendButton,
              (thinking || !draft.trim()) && { opacity: 0.45 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Send size={16} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgIvory },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.cardPure,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandSage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 14, fontWeight: '800', color: colors.textCharcoal },
  headerSubtitle: { fontSize: 9.5, color: colors.textMuted, marginTop: 1 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgLinen,
    alignItems: 'center',
    justifyContent: 'center',
  },

  thread: { padding: 16, gap: 10, paddingBottom: 12 },

  intro: { alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 6 },
  introMark: {
    width: 52,
    height: 52,
    borderRadius: 20,
    backgroundColor: tints.sage08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textCharcoal,
    letterSpacing: -0.4,
    marginTop: 6,
  },
  introBody: {
    fontSize: 11.5,
    color: colors.textSlate,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 12,
  },
  openerWrap: { gap: 8, width: '100%', marginTop: 14 },
  opener: {
    backgroundColor: colors.cardPure,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadow.xs,
  },
  openerLabel: { fontSize: 11.5, color: colors.textCharcoal, lineHeight: 16 },

  bubble: {
    maxWidth: '86%',
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 11,
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
  bubbleFailed: { borderColor: tints.warning30, backgroundColor: tints.warning10 },
  bubbleText: { fontSize: 12.5, lineHeight: 18, color: colors.textCharcoal },
  bubbleTextMine: { color: '#FFFFFF' },

  typing: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  typingLabel: { fontSize: 11, color: colors.textSlate },

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

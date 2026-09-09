import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, User, AlertCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useIntent } from '../intent';
import { failureMessage } from '@freshfold/core';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatbotWidgetProps {
  /** Which section the reader is in, so the openers can be about it. */
  activeSection: string;
  onOpenBooking: () => void;
}

/**
 * The openers, chosen for where the reader is and what they have already done.
 *
 * There used to be five fixed ones — "What suburbs do you service?", "Tell me
 * about sneaker restoration" — shown to everybody in every state. One of them
 * asked about a service the shop does not offer, and the area question was put
 * to people who had just used the area check three sections earlier. A prompt
 * that is not about what you are reading is furniture; it is the reason this
 * widget was the least-touched interactive thing on a page full of them.
 *
 * Kept to four, and the order matters — the first is the one most likely to be
 * the actual question.
 */
function openers(section: string, hasOrder: boolean, knowsArea: boolean): string[] {
  const prompts: string[] = [];

  if (hasOrder) {
    prompts.push('What does my order come to?');
    prompts.push('When would I get it back?');
  }

  switch (section) {
    case 'services':
      prompts.push('What is included in a wash?', 'Do you do bed sheets and duvets?');
      break;
    case 'subscriptions':
      prompts.push('Which plan would suit me?', 'Can I stop a plan whenever I like?');
      break;
    case 'membership':
      prompts.push('How do the loyalty points work?', 'What do I get at the next tier?');
      break;
    case 'how-it-works':
      prompts.push('How do I track my laundry?', 'What if something is stained?');
      break;
    case 'target-customers':
      prompts.push('Do you take business accounts?', 'How does it work for a hostel room?');
      break;
    case 'contact':
      prompts.push('Where exactly is the shop?', 'What are your opening hours?');
      break;
    default:
      prompts.push('What does a load of washing cost?', 'How soon can you collect?');
  }

  if (!knowsArea) prompts.push('Do you collect from my area?');
  prompts.push('How do I pay?');

  // First four, no repeats — the branches above can suggest the same question
  // twice for a reader who has both an order and a section opinion.
  return [...new Set(prompts)].slice(0, 4);
}

export default function ChatbotWidget({ activeSection, onOpenBooking }: ChatbotWidgetProps) {
  const { intent } = useIntent();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hello — I'm Foldie. Ask me what something costs, when you would get it back, or whether we collect from your area.",
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of message list on updates
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  /**
   * One turn, given the whole conversation to send.
   *
   * The history is passed in rather than appended in here, which is what makes
   * retry correct: the failed turn already ends with the customer's message, so
   * retrying is sending the same array again. It used to call the send path
   * with the last message's text, which appended a second copy of the question
   * to the transcript every time somebody pressed Retry.
   */
  const ask = async (history: Message[]) => {
    setMessages(history);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          history,
          /**
           * What the page already knows, sent as fields rather than prose.
           *
           * The server re-prices the basket and checks the suburb against its
           * own tables before any of it reaches the model — see
           * `describeContext`. Sending a sentence would be handing a caller a
           * pen and the model's instructions.
           */
          context: {
            section: activeSection,
            items: intent.items,
            suburb: intent.suburb,
            plan: intent.plan,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong at our end.');
      }

      setMessages([...history, { role: 'assistant', content: data.reply }]);
    } catch (err: any) {
      console.error('Chatbot API Error:', err);
      setErrorMessage(
        failureMessage(err, 'We could not reach the shop just then. Try again in a moment.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;
    setInputValue('');
    void ask([...messages, { role: 'user', content: textToSend }]);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(inputValue);
  };

  const prompts = openers(activeSection, intent.items.length > 0, Boolean(intent.suburb));

  // Lifted on phones to clear the sticky booking bar, which owns the bottom
  // edge there. `--z-floating` keeps the two on one scale.
  return (
    <div
      className="fixed bottom-[5.5rem] right-5 z-[var(--z-floating)] flex flex-col items-end sm:bottom-6 sm:right-6"
      id="ai-chatbot-widget"
    >
      {/* Animated Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="flex h-[min(32rem,70svh)] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-brand-charcoal text-left shadow-2xl mb-4 sm:w-[23.75rem]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 bg-brand-card px-4 py-3.5">
              <div>
                <h3 className="text-[15px] font-medium text-white">Ask us anything</h3>
                <p className="mt-0.5 text-[13px] text-brand-text-muted">
                  Foldie answers; the desk answers what Foldie cannot
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1.5 text-brand-text-muted transition-colors hover:bg-white/5 hover:text-white"
                id="close-chatbot"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Message Pane */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`flex max-w-[85%] gap-2.5 ${
                      msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    <div
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-medium ${
                        msg.role === 'user'
                          ? 'border-brand-sage bg-brand-sage/20 text-brand-text-light'
                          : 'border-brand-gold/30 bg-brand-gold/10 text-brand-gold'
                      }`}
                    >
                      {msg.role === 'user' ? <User className="h-3.5 w-3.5" /> : 'F'}
                    </div>

                    <div
                      className={`rounded-xl p-3 text-body ${
                        msg.role === 'user'
                          ? 'rounded-tr-none bg-brand-sage text-white'
                          : 'rounded-tl-none border border-white/10 bg-brand-card text-brand-text-light'
                      }`}
                    >
                      <div className="whitespace-pre-line">{msg.content}</div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Loader */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex max-w-[85%] flex-row gap-2.5">
                    <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-brand-gold/30 bg-brand-gold/10 text-[12px] font-medium text-brand-gold">
                      F
                    </div>
                    <div className="flex items-center space-x-1 rounded-xl rounded-tl-none border border-white/10 bg-brand-card p-3">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-gold [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-gold [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-gold" />
                    </div>
                  </div>
                </div>
              )}

              {/*
                What went wrong, in the customer's terms.

                This used to render the server's message and, when it mentioned
                settings, a note telling the reader to open Settings, find
                Secrets and define `GEMINI_API_KEY` — our deployment's
                configuration, shown to somebody asking about a duvet. The
                server no longer sends that and this no longer offers to
                explain it; a phone number is the useful fallback.
              */}
              {errorMessage && (
                <div
                  role="status"
                  className="space-y-2.5 rounded-xl border border-brand-gold/25 bg-brand-gold/5 p-3.5"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" />
                    <p className="text-body text-brand-text-light">{errorMessage}</p>
                  </div>
                  <button
                    onClick={() => void ask(messages)}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5 rounded-md border border-brand-gold/30 bg-brand-gold/15 px-2.5 py-1.5 text-body text-brand-gold-light transition-colors hover:bg-brand-gold/25 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Try again</span>
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/*
              Where the conversation goes.

              A bubble that can only talk is the same dead end as a price that
              cannot be booked. Someone who has just been told what their wash
              costs should not have to close this and go looking for the form.
            */}
            <div className="border-t border-white/10 bg-black/20 px-3 py-2.5">
              <div className="flex flex-wrap gap-1.5">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    disabled={isLoading}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-body text-brand-text-light transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenBooking();
                }}
                className="mt-2 w-full rounded-md bg-brand-gold px-4 py-2.5 text-[15px] font-semibold text-brand-charcoal transition-colors hover:bg-brand-gold-light"
              >
                {intent.items.length > 0 ? 'Book this order' : 'Book a pickup'}
              </button>
            </div>

            {/* Input Form */}
            <form
              onSubmit={handleFormSubmit}
              className="flex gap-2 border-t border-white/10 bg-brand-card p-3"
            >
              <label htmlFor="chat-input" className="sr-only">
                Your question
              </label>
              <input
                id="chat-input"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about prices, days, areas…"
                disabled={isLoading}
                className="flex-1 rounded-xl border border-white/10 bg-brand-charcoal px-3 py-2.5 text-body text-white placeholder:text-brand-text-muted transition-colors focus:border-brand-gold focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-sage text-white transition-colors hover:bg-brand-sage-light disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-brand-gold text-brand-charcoal shadow-2xl transition-colors duration-200 hover:bg-brand-gold-light"
        aria-label={isOpen ? 'Close the question box' : 'Ask us a question'}
        aria-expanded={isOpen}
        id="chatbot-toggle-button"
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </button>
    </div>
  );
}

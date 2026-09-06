import React, { useState, useEffect, useRef } from 'react';
import { ApiError, isEmailShaped } from '@freshfold/core';
import { SCHEDULE, SHOP, openAt } from '../shop';
import { api } from '../services/store';
import Reveal from './ui/Reveal';
import AreaCheck from './ui/AreaCheck';

interface ContactProps {
  onOpenBooking: () => void;
}

export default function Contact({ onOpenBooking }: ContactProps) {
  const [inquiryName, setInquiryName] = useState('');
  const [inquiryEmail, setInquiryEmail] = useState('');
  const [inquiryMsg, setInquiryMsg] = useState('');
  const [formError, setFormError] = useState('');
  /**
   * Where the enquiry has got to.
   *
   *   idle      nothing sent yet, or the last outcome has been cleared
   *   sending   the request is out
   *   sent      recorded, and the desk has been emailed
   *   queued    recorded, but the email did not go — see the note on `delivered`
   *
   * `sent` and `queued` are separate because they are different promises. This
   * used to be one boolean that was set unconditionally after assigning a
   * `mailto:` URL, which is how the form came to announce a send on a machine
   * that had done nothing at all.
   */
  const [formState, setFormState] = useState<'idle' | 'sending' | 'sent' | 'queued'>('idle');
  const [isOpenNow, setIsOpenNow] = useState(() => openAt(new Date()));

  /**
   * The handle for the timer that clears the outcome message.
   *
   * Kept so it can be cancelled: a visitor who sends an enquiry and scrolls
   * away unmounts this section, and a timer still holding a `setState` on it is
   * work scheduled against a component that has gone.
   */
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  // Re-checked every minute so the badge turns over on the half hour as well as
  // on the hour — `closes` is 20:30 on a weekday, and an hourly tick would have
  // reported the desk open for the last thirty minutes of every evening.
  useEffect(() => {
    const tick = () => setIsOpenNow(openAt(new Date()));
    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleSendInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formState === 'sending') return;

    // Reported in the form, not through `alert()`. A browser dialog steals the
    // focus, cannot be styled, cannot be read by anything pointing at the
    // field that is wrong, and on some mobile browsers it arrives after the
    // keyboard has already closed over the answer.
    if (!inquiryName.trim() || !inquiryMsg.trim()) {
      setFormError('We need a name and a message before we can send this.');
      return;
    }

    /**
     * The address is optional, and checked when there is one.
     *
     * The same rule `POST /api/contact` applies, from the same function, so the
     * two surfaces cannot come to disagree about what an address is — and it is
     * worth catching here because a typo means the reply has nowhere to go and
     * the sender never finds out: the bounce arrives at the laundry.
     */
    if (inquiryEmail.trim() && !isEmailShaped(inquiryEmail)) {
      setFormError('That email address does not look right. Check it, or leave it blank.');
      return;
    }

    setFormError('');
    setFormState('sending');

    /**
     * The enquiry goes to the dispatch server, which records it and then emails
     * the desk.
     *
     * This used to build a `mailto:` URL and assign it to `window.location`,
     * handing the message to whatever mail client the visitor's browser had
     * registered. On a phone that opens Gmail; on a desktop browser with no
     * handler it is a silent no-op — no dialog, no navigation, nothing in the
     * console — and the form said "Your mail app is open" either way. It cannot
     * be feature-detected, so the only honest fix was to stop guessing and send
     * the thing ourselves.
     */
    try {
      const { delivered } = await api.sendEnquiry({
        name: inquiryName.trim(),
        email: inquiryEmail.trim() || undefined,
        message: inquiryMsg.trim(),
      });

      setInquiryName('');
      setInquiryEmail('');
      setInquiryMsg('');

      // Recorded either way — `delivered` says only whether the desk has been
      // emailed about it yet, and the two are told apart rather than rolled
      // into one cheerful sentence.
      setFormState(delivered ? 'sent' : 'queued');

      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setFormState('idle'), 8000);
    } catch (error) {
      setFormState('idle');

      /**
       * The server's own sentence when it wrote one — the length caps and the
       * hourly limit are all phrased for somebody to read — and a plain
       * statement of the truth when nothing answered at all.
       *
       * Nothing is silently retried. The enquiry is not on the server, saying
       * otherwise is what got this form into trouble in the first place, and
       * the mail link beside this message is a route that does not depend on us
       * being reachable.
       */
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'We could not reach the shop just now. Check your connection and try again, or email us directly.'
      );
    }
  };

  const fieldClass =
    'mt-2 w-full rounded-md border border-white/15 bg-brand-card px-4 py-3 text-[15px] text-white placeholder:text-brand-text-muted transition-colors duration-200 focus:border-brand-gold focus:outline-none';
  const labelClass = 'block text-[13px] font-medium text-brand-text-light';

  return (
    <section
      id="contact"
      className="border-b border-white/10 bg-brand-charcoal py-20 font-ui sm:py-28"
    >
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <Reveal className="max-w-[46ch]">
          <h2 className="font-display text-section font-medium text-white text-balance">
            Come by, call, or write.
          </h2>
          <p className="mt-5 text-lead text-brand-text-muted">
            The desk answers during shop hours. For anything unusual — a contract, a delicate, a
            volume we have not seen before — a message is the fastest way to a real answer.
          </p>
        </Reveal>

        <Reveal className="mt-12">
          <AreaCheck onBook={onOpenBooking} />
        </Reveal>

        <div className="mt-12 grid gap-12 lg:grid-cols-12 lg:gap-14" id="contact-bento">
          {/* The form */}
          <div className="lg:col-span-7" id="contact-form-card">
            <form onSubmit={handleSendInquiry} noValidate className="max-w-[42rem]">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="inquiry-name">
                    Your name
                  </label>
                  <input
                    id="inquiry-name"
                    type="text"
                    value={inquiryName}
                    onChange={(e) => setInquiryName(e.target.value)}
                    placeholder="Gloria Sarpong"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="inquiry-email">
                    Email <span className="text-brand-text-muted">(optional)</span>
                  </label>
                  <input
                    id="inquiry-email"
                    type="email"
                    value={inquiryEmail}
                    onChange={(e) => setInquiryEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="mt-6">
                <label className={labelClass} htmlFor="inquiry-message">
                  What do you need?
                </label>
                <textarea
                  id="inquiry-message"
                  rows={5}
                  value={inquiryMsg}
                  onChange={(e) => setInquiryMsg(e.target.value)}
                  placeholder="How much you send in a week, what is in it, and when you need it back."
                  className={`${fieldClass} resize-y`}
                />
              </div>

              {/* One live region for every outcome, so a screen reader hears
                  the result of pressing the button whichever way it went. */}
              <p aria-live="polite" className="mt-4 min-h-[1.5rem] text-body">
                {formError && (
                  <span className="text-brand-gold">
                    {formError}{' '}
                    {/* A route that does not depend on us being reachable. A
                        link they choose to click, rather than the navigation
                        this form used to perform on their behalf and call a
                        send. */}
                    <a
                      href={`mailto:${SHOP.email}`}
                      className="underline decoration-brand-gold/40 underline-offset-4 hover:decoration-brand-gold"
                    >
                      {SHOP.email}
                    </a>
                  </span>
                )}
                {formState === 'sent' && (
                  <span className="text-brand-sage-light">
                    Sent. The desk has it and will come back to you.
                  </span>
                )}
                {/* Recorded, but nobody has been emailed yet. Said plainly:
                    the message is safe and the answer may be slower, which is
                    a different promise from the one above. */}
                {formState === 'queued' && (
                  <span className="text-brand-sage-light">
                    We have your message. Our mail is playing up, so the reply may take a little
                    longer than usual.
                  </span>
                )}
              </p>

              <button
                type="submit"
                disabled={formState === 'sending'}
                className="mt-2 rounded-md bg-brand-gold px-6 py-3.5 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light disabled:cursor-not-allowed disabled:opacity-60"
              >
                {formState === 'sending' ? 'Sending…' : 'Send it'}
              </button>
            </form>
          </div>

          {/* The shop */}
          <div className="lg:col-span-4 lg:col-start-9">
            <div className="flex items-baseline justify-between gap-4 border-b border-white/15 pb-4">
              <h3 className="font-display text-[25px] font-medium text-white">Hours</h3>
              <span className="flex items-center gap-2 text-body">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    isOpenNow ? 'bg-brand-sage-light' : 'bg-brand-gold'
                  }`}
                />
                <span className={isOpenNow ? 'text-brand-sage-light' : 'text-brand-gold'}>
                  {isOpenNow ? 'Open now' : 'Closed now'}
                </span>
              </span>
            </div>

            <dl>
              {SCHEDULE.map((row) => (
                <div
                  key={row.days}
                  className="flex items-baseline justify-between gap-4 border-b border-white/10 py-3"
                >
                  <dt className="text-body text-brand-text-muted">{row.days}</dt>
                  <dd className="text-[15px] text-white tnum">{row.hours.label}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 space-y-6">
              <div>
                <h3 className="text-[13px] font-medium text-brand-text-muted">The shop</h3>
                <p className="mt-2 max-w-[34ch] text-[15px] leading-relaxed text-white">
                  {SHOP.addressLine1}
                  <br />
                  {SHOP.addressLine2}
                </p>
              </div>
              <div>
                <h3 className="text-[13px] font-medium text-brand-text-muted">Phone</h3>
                <a
                  href={`tel:${SHOP.phone}`}
                  className="mt-2 block text-[15px] text-brand-gold underline decoration-brand-gold/40 underline-offset-4 hover:decoration-brand-gold tnum"
                >
                  {SHOP.phoneLabel}
                </a>
              </div>
              <div>
                <h3 className="text-[13px] font-medium text-brand-text-muted">Email</h3>
                <a
                  href={`mailto:${SHOP.email}`}
                  className="mt-2 block break-all text-[15px] text-brand-gold underline decoration-brand-gold/40 underline-offset-4 hover:decoration-brand-gold"
                >
                  {SHOP.email}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  MEMBERSHIP_PLANS,
  PAYMENT_PURPOSES,
  SCENTS,
  SERVICE_CATALOGUE,
  SERVICE_SUBURBS,
  buildPaymentMetadata,
  clampQuantity,
  isPaymentPurpose,
  paymentPurpose,
  priceBreakdown,
  priceLabel,
  serviceByName,
  type PaymentDisplayFields,
  type PaymentPurpose,
} from '@freshfold/core';
import { guard } from '../helpers';
import { rateLimit } from '../rateLimit';
import { topUp } from '../wallet';

/**
 * Third-party integrations, carried over unchanged from the original web
 * server: the Gemini-backed concierge chatbot and Paystack payment
 * initialize/verify. Both keep their secrets server-side, which is why they
 * live here and not in the browser bundle.
 */

export const chatRouter = Router();

/**
 * What the concierge is allowed to say we sell, generated from the catalogue.
 *
 * The instruction below used to list the services by hand, and it had drifted
 * into advertising a different business: "sneaker restoration", "gentle dry
 * cleaning", "couture/delicate care" and three scents ("Alpine Fresh",
 * "Sandalwood Silk") that appear in no table anywhere. A customer who asked the
 * bubble about any of them was quoted a service the booking form cannot place
 * and the shop does not do.
 *
 * Built from `SERVICE_CATALOGUE` for the same reason every price on the
 * marketing page is: the advert and the checkout have to be the same number,
 * and a prose copy of a table is a copy that can drift.
 */
const SERVICE_LINES = SERVICE_CATALOGUE.map(
  (service) =>
    `  - ${service.name} — ${priceLabel(service)}${
      service.bookable ? '' : ' (not bookable online; the desk quotes this one)'
    }`
).join('\n');

const PLAN_LINES = MEMBERSHIP_PLANS.map(
  (plan) =>
    `  - ${plan.name}: \u20b5${plan.price} a month, ${plan.includedPickups} pickups included, ` +
    `${Math.round(plan.overageDiscount * 100)}% off anything past them`
).join('\n');

const SCENT_LINE = SCENTS.map(
  (scent) => `${scent.label}${scent.surcharge ? ` (+\u20b5${scent.surcharge})` : ' (no charge)'}`
).join(', ');

/**
 * Foldie, rewritten to sound like the shop it works for.
 *
 * The old persona was "an elite luxury hotel concierge" for an "ultra-premium
 * garment care" business, which is the exact register `PRODUCT.md` names as an
 * anti-reference: it is a Kumasi laundry charging \u20b530 a load, and borrowed
 * luxury vocabulary reads as insecurity rather than prestige. Worse, a chat
 * bubble is the one surface where a visitor asks a direct question and expects
 * a direct answer, so it is the worst place on the site to be florid.
 */
const SYSTEM_INSTRUCTION = `You are Foldie, who answers questions on the FreshFold Laundry Co. website.

FreshFold is a laundry in Kumasi, Ghana. The shop is at Wagyingo Opal, Ayeduase-Kotei, beside the Benab filling station. We collect laundry from the customer, wash and press it, and bring it back the next day. Pickup and delivery are free.

How to speak:
- Like a good shopkeeper who knows the trade: say the price, say the day, do not oversell.
- Plain sentences. Short. No word a customer would not say back to you.
- Never call anything "premium", "luxury", "bespoke", "exclusive", "elite" or "couture". Never call yourself a concierge, an ambassador or a specialist.
- Confidence comes from being specific — "\u20b530 a load, back tomorrow, pickup is free" — not from adjectives.
- A number beats an adjective. If you cannot answer with a price, a day, an address or a count, say you will find out rather than filling the gap.

What is true, and the only things you may state as fact:
- Services and prices:
${SERVICE_LINES}
- Turnaround is next day as standard. Same-day is the express service and costs more. The booking form's earliest collection is tomorrow.
- Collection windows are 08:00-11:00, 12:00-15:00 and 17:30-20:30, seven days a week.
- Areas we collect from: ${SERVICE_SUBURBS.join(', ')}.
- Scents: ${SCENT_LINE}. Starch: none, light or medium.
- Monthly plans:
${PLAN_LINES}
- Loyalty is earned, not bought: one point per cedi spent, and the tier discount comes off later orders. There is nothing to sign up for and nothing to buy.
- Customers with an order can open the client portal to set a password, track the order on a live map, message the desk and see their points. Riders carry a companion app, so the progress shown is reported from the courier's own device.
- To book, tell them to press "Book a pickup". It pre-fills from their account if they are signed in.

If you are asked something outside this list — a service we do not offer, a price not written above, whether we can reach an area not listed, anything about a specific person's order — say you do not know and point them at the desk on +233 20 095 7165 or the message form at the bottom of the page. Do not guess, and do not invent services, prices, discounts, guarantees or statistics.

Keep answers to a few sentences unless asked for more.`;

/**
 * The concierge's ceiling.
 *
 * Open by necessity, like the directions and places proxies: the chat bubble sits
 * on the marketing page in front of visitors who have no account, and requiring
 * one would be requiring an account to ask a question. Unlike those two it had no
 * limit at all — so it was an unmetered generation endpoint on our key, taking
 * arbitrary prompts from anybody who found it.
 *
 * Twelve a minute is a conversation. It is not a way to spend the month's quota
 * on somebody else's workload.
 */
const chatLimit = rateLimit({
  max: 12,
  windowMs: 60 * 1000,
  message: 'You are asking rather quickly. Give the concierge a moment.',
});

/**
 * Longest exchange worth forwarding.
 *
 * The whole conversation is re-sent on every turn, and the caller composes it, so
 * without a bound a single request can carry as many tokens as it likes.
 */
const MAX_HISTORY_TURNS = 40;
const MAX_MESSAGE_CHARS = 4000;

/**
 * What the visitor was doing on the page when they opened the bubble.
 *
 * The concierge used to answer every question from a cold start, which on a
 * page where someone has just priced an order and confirmed their area means
 * asking them for all of it again. This is the same shared intent the booking
 * form opens with, so "what would that cost me?" has an antecedent.
 *
 * Taken as **structure and rebuilt here**, never as a sentence the client
 * composed. Everything on this route ends up inside a system instruction, and a
 * free-text `context` field would be an open channel from any caller straight
 * into the model's instructions — the whole point of validating each field
 * against the same tables the shop actually runs on is that nothing reaches the
 * prompt that the catalogue cannot vouch for.
 */
interface RawContext {
  section?: unknown;
  items?: unknown;
  suburb?: unknown;
  plan?: unknown;
}

/** The sections of the marketing page, as the page's own anchors name them. */
const SECTIONS: Record<string, string> = {
  hero: 'the top of the page',
  services: 'the price list',
  subscriptions: 'the monthly plans',
  membership: 'the loyalty tiers',
  'why-choose-us': 'what we promise',
  'how-it-works': 'how the process works',
  'target-customers': 'who we wash for',
  contact: 'the contact details',
};

function describeContext(raw: RawContext | undefined): string {
  if (!raw || typeof raw !== 'object') return '';

  const notes: string[] = [];

  const section = typeof raw.section === 'string' ? SECTIONS[raw.section] : undefined;
  if (section) notes.push(`They are reading ${section}.`);

  /**
   * The basket, re-priced here rather than trusted.
   *
   * A total is the one thing in this payload a caller could gain anything by
   * lying about, and `priceBreakdown` is a pure function over the same
   * catalogue the checkout uses — so there is no reason to accept theirs.
   */
  const lines = Array.isArray(raw.items) ? raw.items.slice(0, 6) : [];
  const items = lines
    .map((line) => {
      const serviceType =
        line && typeof line === 'object' && typeof (line as { serviceType?: unknown }).serviceType === 'string'
          ? (line as { serviceType: string }).serviceType
          : '';
      if (!serviceByName(serviceType)) return null;
      return {
        serviceType,
        quantity: clampQuantity((line as { quantity?: unknown }).quantity, serviceType),
      };
    })
    .filter((line): line is { serviceType: string; quantity: number } => line !== null);

  if (items.length > 0) {
    const listed = items.map((line) => `${line.quantity} \u00d7 ${line.serviceType}`).join(', ');
    const total = priceBreakdown({ serviceType: items[0].serviceType, items }).gross;
    notes.push(
      `They have built an order on the page: ${listed}. That prices at \u20b5${total}, ` +
        `collection and delivery included. If they ask what it costs, that is the number.`
    );
  }

  const suburb =
    typeof raw.suburb === 'string' && SERVICE_SUBURBS.includes(raw.suburb) ? raw.suburb : '';
  if (suburb) notes.push(`They have confirmed we collect from ${suburb}, so do not ask where they are.`);

  const plan =
    typeof raw.plan === 'string' && MEMBERSHIP_PLANS.some((entry) => entry.name === raw.plan)
      ? raw.plan
      : '';
  if (plan) notes.push(`They were looking at the ${plan}.`);

  if (notes.length === 0) return '';

  return `\n\nWhat this visitor has already done on the page (do not repeat it back as a list, just do not ask them for it again):\n${notes
    .map((note) => `- ${note}`)
    .join('\n')}`;
}

chatRouter.post(
  '/',
  chatLimit,
  guard(async (req, res) => {
    const { history, context } = req.body as {
      history?: { role: string; content: string }[];
      context?: RawContext;
    };
    if (!history || !Array.isArray(history)) {
      res.status(400).json({ error: 'Invalid history format. Must be an array of messages.' });
      return;
    }

    if (history.length > MAX_HISTORY_TURNS) {
      res.status(413).json({ error: 'That conversation is too long. Start a new one.' });
      return;
    }

    if (history.some((message) => (message?.content?.length ?? 0) > MAX_MESSAGE_CHARS)) {
      res.status(413).json({ error: 'That message is too long for the concierge.' });
      return;
    }

    /**
     * A missing key is our problem, and it used to be described to the customer.
     *
     * The old body named the environment variable and the file to put it in,
     * and the chat bubble rendered that verbatim to whoever was asking about a
     * duvet — an operational detail about our deployment, handed to strangers,
     * in the voice of an answer. The operator needs it; the customer needs to
     * know to phone the shop.
     */
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set — the concierge cannot answer. Set it in apps/server/.env.');
      res.status(503).json({
        error: 'The assistant is offline at the moment. Call the desk on +233 20 095 7165 and we will answer straight away.',
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'freshfold-dispatch' } },
    });

    const contents = history.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION + describeContext(context),
        temperature: 0.7,
      },
    });

    res.json({
      reply: response.text || 'I apologize, but I am unable to process that request right now.',
    });
  })
);

export const paystackRouter = Router();

/**
 * How long either Paystack call gets before we stop waiting on it.
 *
 * Node's `fetch` has no total-request deadline of its own, so without this a
 * Paystack that accepts the connection and then says nothing holds the handler
 * open indefinitely — well past the 8 seconds both apps' API clients abort at.
 * The customer then reads their own client's timeout as the gateway being slow,
 * while this side has no record of anything having gone wrong at all.
 *
 * Under that 8s budget deliberately, and by enough to answer: the caller has to
 * *receive* the 504 below, which it cannot do if we are still waiting when it
 * gives up.
 */
const PAYSTACK_TIMEOUT_MS = 6000;

/** The rejection `AbortSignal.timeout` raises when its deadline passes. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** The envelope both Paystack endpoints answer in. `data` differs per call. */
interface PaystackBody<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

/**
 * The purposes, and the two the settlement routes name individually.
 *
 * `PAYMENT_PURPOSES` lives in `@freshfold/core` beside the payload the clients
 * build, so the value a checkout declares and the value this server gates on
 * are one definition rather than two that agree today. The two routes that
 * spend a reference — `/accounts/wallet` and `/bookings/:id/payment` — import
 * these constants rather than spelling out string literals of their own, which
 * is what let their gates drift into being mutually satisfiable.
 */
export const TOPUP_PURPOSE: PaymentPurpose = 'wallet_topup';
export const BOOKING_PURPOSE: PaymentPurpose = 'booking';

/**
 * Where Paystack is allowed to send the customer when the payment is done.
 *
 * `callback_url` was passed to Paystack exactly as it arrived, on an endpoint
 * that is deliberately unauthenticated. So anybody could mint a checkout
 * pointing anywhere: send a customer a link on `checkout.paystack.co` — a real
 * gateway, a real payment, a correct padlock — and have the browser land on
 * their own page the instant the money went through. That is the highest-trust
 * moment in the whole flow and the best possible place to ask someone to
 * "re-enter your card to confirm".
 *
 * It cannot simply be dropped. The customer app passes a deep link back into
 * itself, because Paystack following `APP_URL` would drop a phone on a web page
 * that is not the app; and the website passes its own origin, because in
 * development `APP_URL` is the API's own host and not where the site is served
 * from. So the fix is an allow-list rather than a removal.
 *
 * An app carried by something whose scheme is not its own sends no callback at
 * all rather than offering one it cannot claim: under Expo Go the address on
 * offer is `exp://<dev-host>/--/…`, which is Expo Go's, and the customer app
 * withholds it — see `paystackReturnUrl` in apps/client. Which is why `exp`
 * stays out of the production list rather than being added to it to make the
 * development harness work.
 *
 * Two kinds of destination are allowed, and nothing else:
 *
 *  - **An http(s) origin we already trust.** `CORS_ORIGINS` is exactly the
 *    right list and already has to be maintained: an origin trusted enough to
 *    call this API is trusted enough to be returned to. `APP_URL`'s own origin
 *    is always allowed, so a correct deployment needs no new configuration.
 *  - **One of our apps' own URL schemes.** `freshfoldclient://…` for the
 *    customer app. `APP_LINK_SCHEMES` overrides the default when a build uses
 *    another one.
 *
 * Everything else is refused, which includes `javascript:` and `data:` — they
 * would have to be named in an allow-list to pass, and they never will be.
 */
const DEFAULT_APP_SCHEMES = ['freshfoldclient'];

/** The customer app under Expo Go, which is `exp://host:port/--/path`. */
const DEV_APP_SCHEMES = ['exp'];

export interface CallbackPolicy {
  /** Allowed http(s) origins, lowercased, e.g. `https://freshfold.example`. */
  origins: string[];
  /** Allowed custom URL schemes, without the colon. */
  schemes: string[];
  /**
   * Whether any http(s) origin is acceptable.
   *
   * True only outside production with no `CORS_ORIGINS` set — the same posture
   * the CORS middleware itself takes in `index.ts`, and for the same reason: a
   * phone on the LAN, a Vite dev server and an Expo web build are three origins
   * nobody wants to enumerate to run the thing locally. In production this is
   * always false.
   */
  anyOrigin: boolean;
}

/** Reads the policy out of the environment. */
export function callbackPolicy(): CallbackPolicy {
  const production = process.env.NODE_ENV === 'production';

  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins = new Set<string>();
  for (const origin of configured) {
    try {
      origins.add(new URL(origin).origin.toLowerCase());
    } catch {
      // A malformed entry is the operator's typo. Skipped rather than fatal:
      // the rest of the list is still good, and CORS itself ignores it too.
    }
  }

  if (process.env.APP_URL) {
    try {
      origins.add(new URL(process.env.APP_URL).origin.toLowerCase());
    } catch {
      /* same */
    }
  }

  const schemes = (process.env.APP_LINK_SCHEMES ?? '')
    .split(',')
    .map((scheme) => scheme.trim().replace(/:$/, '').toLowerCase())
    .filter(Boolean);

  return {
    origins: [...origins],
    schemes: schemes.length > 0 ? schemes : [...DEFAULT_APP_SCHEMES, ...(production ? [] : DEV_APP_SCHEMES)],
    anyOrigin: !production && configured.length === 0,
  };
}

/**
 * Whether Paystack may return the customer to this URL.
 *
 * Pure, and takes the policy rather than reading the environment, so the checks
 * can state a policy and assert against it rather than mutating `process.env`.
 */
export function isAllowedCallback(raw: string, policy: CallbackPolicy): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL at all — which includes a bare path. Paystack needs an absolute
    // destination, so there is nothing sensible to resolve it against.
    return false;
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (policy.anyOrigin) return true;
    return policy.origins.includes(url.origin.toLowerCase());
  }

  return policy.schemes.includes(url.protocol.replace(/:$/, '').toLowerCase());
}

/**
 * Opens a checkout.
 *
 * Left open, because the customer paying for a booking on the website may well
 * not have an account yet — that is the funnel. What it can do in the wrong hands
 * is bounded: it creates a payment *intent* on the merchant account and returns a
 * URL, so the cost of abuse is noise in the Paystack dashboard and quota, not
 * money moving. Nothing is credited anywhere until `/accounts/wallet` re-verifies
 * the reference and matches the payer against a session.
 *
 * The window is what stops it being an unbounded way to manufacture that noise.
 *
 * ---
 *
 * **The metadata is built here, and is not the caller's to write.**
 *
 * It used to be: `metadata` was taken from the request body and forwarded to
 * Paystack verbatim, and Paystack echoed it back on both the webhook and the
 * verify. Two settlement paths then read that echo as their only evidence of
 * what the money was for — the wallet refusing anything but
 * `type: 'wallet_topup'`, the booking refusing anything whose `booking_id` was
 * not its own. Each was written to stop the *other* path replaying a reference,
 * and each says so in its own comment.
 *
 * Neither stopped one intent carrying both keys, because the caller composed
 * them. A customer could open a checkout with
 * `{ type: 'wallet_topup', booking_id: 'FFC-482013' }`, pay ₵200 once, credit
 * ₵200 to their wallet, and then spend the same reference settling the ₵200
 * booking — and because `transactions.upsert` conflicts on the reference, the
 * second claim overwrote the ledger row left by the first. One payment, two
 * settlements, and a statement that showed one movement.
 *
 * So the caller now says only what it *wants* — `purpose`, and the booking it
 * names — and the two authoritative keys are written from that, here, where
 * they cannot both be set. Anything else the caller sends for the merchant
 * dashboard's benefit goes under `display`, which nothing gates on.
 */
paystackRouter.post(
  '/initialize',
  rateLimit({
    max: 10,
    windowMs: 60 * 1000,
    message: 'Too many payment attempts. Try again in a minute.',
  }),
  guard(async (req, res) => {
    const { email, amount, purpose, bookingId, display, callback_url } = req.body as {
      email?: string;
      amount?: number;
      purpose?: unknown;
      bookingId?: unknown;
      display?: Record<string, unknown>;
      callback_url?: string;
    };

    if (!email || !amount) {
      res.status(400).json({ error: 'Email and amount (in GHS) are required.' });
      return;
    }

    if (!isPaymentPurpose(purpose)) {
      res.status(400).json({
        error: `A payment needs a purpose of ${PAYMENT_PURPOSES.join(' or ')}.`,
        reason: 'purpose-required',
      });
      return;
    }

    // A booking payment names the booking from the outset. Without it the
    // settlement route has nothing to match against and would refuse the
    // payment after it had been collected, which is the worst moment to find out.
    if (purpose === 'booking' && (typeof bookingId !== 'string' || !bookingId.trim())) {
      res.status(400).json({
        error: 'A payment for a booking needs the booking it is paying for.',
        reason: 'booking-id-required',
      });
      return;
    }

    /**
     * Where the customer is sent afterwards, checked against the allow-list.
     *
     * Refused loudly rather than quietly swapped for `APP_URL`. A rejected
     * callback is one of two things — an attacker pointing a real checkout at
     * their own page, or a deployment whose `CORS_ORIGINS` does not list the
     * site it serves — and silently redirecting a customer on a phone to a web
     * page fixes neither. See {@link callbackPolicy} for what is allowed.
     */
    if (callback_url !== undefined) {
      if (typeof callback_url !== 'string' || !isAllowedCallback(callback_url, callbackPolicy())) {
        res.status(400).json({
          error: 'That is not a return address this server will send a customer to.',
          reason: 'callback-not-allowed',
        });
        return;
      }
    }

    /**
     * The metadata Paystack will echo back, built rather than forwarded.
     *
     * `type` is a single field with one value, and `booking_id` is written only
     * on the branch that set `type` to `booking` — so the two gates downstream
     * are mutually exclusive by construction rather than by agreement.
     *
     * `display` is nested deliberately. The website sends a customer name, a
     * phone number and a service label so the merchant dashboard is readable,
     * and none of that should ever sit at the same level as the two keys that
     * decide where money lands. A caller putting `type` inside `display` is
     * writing a field nothing reads.
     */
    const metadata = buildPaymentMetadata(
      purpose,
      typeof bookingId === 'string' ? bookingId : undefined,
      display as PaymentDisplayFields | undefined
    );

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      res.status(500).json({
        error:
          'PAYSTACK_SECRET_KEY is not set on the dispatch server. Add it to apps/server/.env to enable online payments.',
      });
      return;
    }

    // The whole exchange is inside the try, not just the headers: the deadline
    // runs from the moment the signal is made, so it can also fire part-way
    // through reading the body, and that rejects here rather than at `fetch`.
    let ok: boolean;
    let data: PaystackBody<{ authorization_url: string; access_code: string; reference: string }>;

    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          // Paystack bills in the minor unit: 1 GHS = 100 pesewas.
          amount: Math.round(Number(amount) * 100),
          currency: 'GHS',
          metadata,
          // Checked against the allow-list above, so by this line it is either
          // one of ours or absent.
          callback_url:
            callback_url || (process.env.APP_URL ? `${process.env.APP_URL}#paystack-success` : undefined),
        }),
        signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
      });

      ok = response.ok;
      data = (await response.json()) as PaystackBody<{
        authorization_url: string;
        access_code: string;
        reference: string;
      }>;
    } catch (error) {
      if (!isTimeout(error)) throw error;

      // Nothing to reconcile, which is why this can simply say "try again": a
      // transaction Paystack may have created here is one whose URL nobody
      // received, and an intent nobody pays on never moves money.
      console.warn(`[paystack] initialize for ${email.trim()} timed out after ${PAYSTACK_TIMEOUT_MS}ms.`);
      res.status(504).json({
        error: 'Paystack did not answer in time. Nothing was charged — try again.',
        reason: 'gateway-timeout',
      });
      return;
    }

    if (!ok || !data.status || !data.data) {
      res.status(400).json({
        error: data.message || 'Failed to initialize Paystack transaction.',
        details: data,
      });
      return;
    }

    res.json({
      status: true,
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
    });
  })
);

/**
 * What Paystack says about a reference, in the shape callers actually need.
 *
 * `amount` is converted back out of the minor unit here, once, so nothing
 * downstream has to remember that Paystack counts in pesewas. `email` is the
 * customer the transaction was created for — the wallet route matches it
 * against the session, so one customer cannot claim another's payment.
 */
export interface PaystackVerification {
  /** Paystack's own transaction status: `success`, `failed`, `abandoned`… */
  paid: boolean;
  status: string;
  /** Amount actually collected, in cedis. */
  amount: number;
  currency: string;
  email: string;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export type PaystackVerifyResult =
  | { ok: true; verification: PaystackVerification }
  | { ok: false; status: number; error: string; details?: unknown };

/**
 * Asks Paystack whether a reference was paid.
 *
 * Shared by the verify route below and by the wallet top-up, which must not
 * take the client's word for it: the balance is credited from `amount` here,
 * never from the amount in the request body.
 */
export async function verifyPaystackTransaction(
  reference: string
): Promise<PaystackVerifyResult> {
  if (!reference?.trim()) {
    return { ok: false, status: 400, error: 'Transaction reference is required.' };
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error:
        'PAYSTACK_SECRET_KEY is not set on the dispatch server. Add it to apps/server/.env to enable online payments.',
    };
  }

  // Headers and body both inside the try — see the note on the initialize call.
  let ok: boolean;
  let body: PaystackBody<Record<string, unknown>>;

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference.trim())}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret.trim()}` },
        signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
      }
    );

    ok = response.ok;
    body = (await response.json()) as PaystackBody<Record<string, unknown>>;
  } catch (error) {
    if (!isTimeout(error)) throw error;

    // Retryable, and says so: the caller's payment may well have settled, and
    // the only thing that has failed is our asking about it. Both settlement
    // paths key on this reference and `topUp` ignores one already in the
    // ledger, so trying again — or the webhook arriving first — credits once.
    console.warn(`[paystack] verify of ${reference.trim()} timed out after ${PAYSTACK_TIMEOUT_MS}ms.`);
    return {
      ok: false,
      status: 504,
      error:
        'Paystack did not answer in time, so this payment could not be confirmed. If you were charged, the money is safe — try again in a moment.',
    };
  }

  if (!ok || !body.status || !body.data) {
    return {
      ok: false,
      status: 400,
      error: body.message || 'Paystack verification failed.',
      details: body,
    };
  }

  const data = body.data;
  const status = typeof data.status === 'string' ? data.status : 'unknown';
  const customer = (data.customer ?? {}) as { email?: unknown };

  return {
    ok: true,
    verification: {
      paid: status === 'success',
      status,
      amount: typeof data.amount === 'number' ? data.amount / 100 : 0,
      currency: typeof data.currency === 'string' ? data.currency : 'GHS',
      email: typeof customer.email === 'string' ? customer.email : '',
      metadata: (data.metadata ?? {}) as Record<string, unknown>,
      raw: data,
    },
  };
}

/**
 * Constant-time compare of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch rather than returning false,
 * and a forged header is exactly where a length mismatch comes from.
 */
function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Paystack's own notification that a payment settled.
 *
 * The reason this exists: until now a top-up was only credited when the
 * customer came back and tapped "I have paid". Someone who paid and then
 * closed the app, lost signal, or had their battery die had money with
 * Paystack and nothing in their wallet until they thought to return. This
 * arrives whether or not anyone is holding the phone.
 *
 * It does not replace the verify-on-return path, it races it. Both call
 * `topUp` with Paystack's reference, and `topUp` ignores a reference already
 * in the ledger — so whichever gets there first credits, and the other is a
 * no-op. That is also what makes Paystack's own retries harmless.
 *
 * The body is the raw bytes, not parsed JSON: the signature is over exactly
 * what was sent, and `JSON.parse` followed by `JSON.stringify` is not
 * guaranteed to reproduce it. See the `express.raw` mount in `index.ts`.
 */
paystackRouter.post(
  '/webhook',
  guard(async (req, res) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      // 500, not 200: this is our misconfiguration, and Paystack retrying is
      // the behaviour we want once the key is in place.
      console.error('[paystack] webhook received but PAYSTACK_SECRET_KEY is not set.');
      res.status(500).json({ error: 'Webhook not configured.' });
      return;
    }

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = req.get('x-paystack-signature') ?? '';
    const expected = createHmac('sha512', secret.trim()).update(raw).digest('hex');

    if (!signature || !signatureMatches(expected, signature)) {
      // Anyone can POST here; only Paystack can sign. Refuse quietly — an
      // unsigned caller learns nothing about what a signed one would get.
      res.status(401).json({ error: 'Invalid signature.' });
      return;
    }

    let event: { event?: string; data?: Record<string, unknown> };
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Malformed webhook body.' });
      return;
    }

    // Everything below is acknowledged with 200 whether or not it moves money.
    // A non-2xx makes Paystack retry, and retrying will not fix an event this
    // server has no interest in.
    if (event.event !== 'charge.success' || !event.data) {
      res.json({ received: true, applied: false, reason: 'event-ignored' });
      return;
    }

    const data = event.data;
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const customer = (data.customer ?? {}) as { email?: unknown };
    const reference = typeof data.reference === 'string' ? data.reference : '';
    const email = typeof customer.email === 'string' ? customer.email : '';
    const amount = typeof data.amount === 'number' ? data.amount / 100 : 0;

    // A booking's payment is not a wallet credit. Same gate the wallet route
    // applies, for the same reason: without it, paying for a wash would also
    // put its value in the wallet.
    //
    // Read through `paymentPurpose` rather than off the object: it is the same
    // reader both settlement routes use, and it answers null for anything that
    // is not a purpose from the shared list — so a stray key on a legacy
    // payment cannot be accepted here by a spelling that happens to match.
    if (paymentPurpose(metadata) !== TOPUP_PURPOSE) {
      res.json({ received: true, applied: false, reason: 'not-a-topup' });
      return;
    }

    if (!reference || !email || amount <= 0) {
      console.warn(`[paystack] charge.success for ${reference || 'no reference'} is unusable.`);
      res.json({ received: true, applied: false, reason: 'incomplete-event' });
      return;
    }

    const outcome = await topUp({ email, amount, method: 'Paystack', reference });

    if (!outcome.ok) {
      // Logged rather than retried. `no-account` is the realistic case — a
      // payment made against an email this server has never seen — and no
      // number of retries will conjure the account.
      console.error(`[paystack] could not credit ${email} for ${reference}: ${outcome.reason}`);
      res.json({ received: true, applied: false, reason: outcome.reason });
      return;
    }

    console.log(`[paystack] credited ${email} ₵${amount.toFixed(2)} from ${reference}.`);
    res.json({ received: true, applied: true });
  })
);

/**
 * What a reference was worth, in the four fields a caller actually reads.
 *
 * This used to answer with `verification.raw` — Paystack's entire transaction
 * object — to anybody who asked, with no session and no check that the reference
 * had anything to do with them. That payload carries the paying customer's email,
 * phone and name, the IP the payment was made from, and an `authorization` block
 * with the card's bank, BIN and last four digits.
 *
 * All three callers read `status` and `reference` and nothing else; the two that
 * settle money do it through `/accounts/wallet`, which re-verifies server-side and
 * matches the payer against the session. So the rest of that object was never
 * being used for anything — it was only being published.
 *
 * Still open, deliberately: a guest pays for a booking and has to be able to ask
 * whether it went through. A reference is Paystack's own opaque string rather
 * than something walkable, and what this now says about one is no more than
 * whoever is holding it already knows.
 */
paystackRouter.get(
  '/verify/:reference',
  rateLimit({
    max: 20,
    windowMs: 60 * 1000,
    message: 'Too many verification attempts. Try again in a minute.',
  }),
  guard(async (req, res) => {
    const result = await verifyPaystackTransaction(req.params.reference);

    if (!result.ok) {
      res.status(result.status).json({ error: result.error, details: result.details });
      return;
    }

    const { paid, status, amount, currency } = result.verification;

    res.json({
      status: true,
      data: { status, reference: req.params.reference.trim(), paid, amount, currency },
    });
  })
);

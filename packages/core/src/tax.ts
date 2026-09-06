/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ghanaian indirect tax on a laundry bill.
 *
 * There was none. Not "the rate was wrong" — a grep for `VAT`, `tax`, `levy` or
 * `NHIL` across the whole repository returned nothing, so every price in the
 * catalogue, every quote both booking forms showed, every amount written onto a
 * job and every receipt the customer was emailed was a bare number with no tax
 * line anywhere near it. A service business in Ghana charging ₵30 for a load of
 * washing owes tax on it whether or not its software has heard of tax.
 *
 * ---------------------------------------------------------------------------
 * How the arithmetic works, and why it is not one multiplication
 * ---------------------------------------------------------------------------
 *
 * Ghana does not levy a single rate. It levies a group of flat levies on the
 * taxable value, and then charges VAT on the taxable value *plus those levies* —
 * so the levies are inside the VAT base and the effective rate is more than the
 * sum of the parts. Writing it as one combined percentage is the mistake this
 * module exists to make impossible: the combined figure changes whenever any
 * component moves, and a hard-coded 21.9% silently becomes wrong the morning a
 * budget changes one of the four numbers behind it.
 *
 * So: {@link LEVIES} are the flat ones, {@link VAT_RATE} is charged on the
 * subtotal after them, and {@link taxOn} composes the two in that order.
 *
 * ---------------------------------------------------------------------------
 * Inclusive by default, and why
 * ---------------------------------------------------------------------------
 *
 * The catalogue advertises "FROM ₵30 / LOAD" on the marketing site, in the app,
 * and in the chatbot's answers. Those numbers have been quoted to customers, and
 * treating them as tax-exclusive would raise every bill in the product by about
 * a fifth without anybody deciding to — which is a pricing decision, not a
 * software one, and not one this module gets to make on the way past.
 *
 * So the default is {@link TaxMode} `inclusive`: the customer pays exactly what
 * they paid before, and the tax is *extracted* from that figure and disclosed on
 * the invoice rather than added to it. That makes the receipt correct without
 * making it more expensive.
 *
 * `TAX_MODE=exclusive` in the server's environment switches to charging on top,
 * for an operation that decides its listed prices are net. That is the switch to
 * flip after talking to an accountant, not before.
 *
 * ---------------------------------------------------------------------------
 * The rates below need confirming
 * ---------------------------------------------------------------------------
 *
 * They are the standard rates for a VAT-registered supplier of services at the
 * time of writing, and they are the part of this file most likely to be out of
 * date by the time anybody reads it — rates move with budgets, and the flat-rate
 * scheme applies to some businesses and not others. `TAX_*` environment
 * variables override every one of them without a deploy, and
 * `TAX_REGISTERED=false` turns the whole thing off for a business below the
 * registration threshold, which a new laundry may well be.
 *
 * Nothing here is tax advice. It is arithmetic with the numbers somebody else
 * supplies.
 */

import { roundCedis } from './membership';
import type { TaxLine } from './types';

export type { TaxLine };

/** One flat levy charged on the taxable value, before VAT. */
export interface TaxLevy {
  id: string;
  /** As it must appear on the invoice. */
  label: string;
  /** A fraction: `0.025` is 2.5%. */
  rate: number;
}

/**
 * The levies charged on the taxable value, before VAT applies.
 *
 * Each is a separate line because each must appear separately on a VAT invoice —
 * a single "levies 6%" row is not an invoice a customer can check, and the three
 * are legislated separately and move separately.
 */
export const LEVIES: readonly TaxLevy[] = [
  { id: 'nhil', label: 'NHIL', rate: 0.025 },
  { id: 'getfund', label: 'GETFund Levy', rate: 0.025 },
  { id: 'covid', label: 'COVID-19 Health Recovery Levy', rate: 0.01 },
] as const;

/** VAT, charged on the taxable value *plus* the levies above. */
export const VAT_RATE = 0.15;

/**
 * Whether the listed price already contains the tax.
 *
 * `inclusive` — the price is what the customer pays, and the tax is extracted
 * from it for the invoice. This is the default: see the header.
 *
 * `exclusive` — the price is net, and the tax is added on top.
 */
export type TaxMode = 'inclusive' | 'exclusive';

export const DEFAULT_TAX_MODE: TaxMode = 'inclusive';

/** How the rates stood when a bill was worked out. */
export interface TaxRates {
  levies: readonly TaxLevy[];
  vat: number;
  mode: TaxMode;
  /**
   * False for a business below the VAT registration threshold, which is a real
   * state for a new laundry rather than a hypothetical one. Everything below
   * returns zeros and the invoice carries no tax lines at all — which is what a
   * non-registered supplier's invoice must look like. Showing "VAT ₵0.00" would
   * be a claim to be registered.
   */
  registered: boolean;
}

export const DEFAULT_TAX_RATES: TaxRates = {
  levies: LEVIES,
  vat: VAT_RATE,
  mode: DEFAULT_TAX_MODE,
  registered: true,
};

export interface TaxBreakdown {
  /** The value the tax is computed on, exclusive of all of it. */
  net: number;
  /** The levies, then VAT, in the order they are charged. */
  lines: TaxLine[];
  /** Everything in `lines`, summed. */
  tax: number;
  /** What the customer pays. */
  gross: number;
  /** Which rates produced this, so a stored invoice can be re-read years later. */
  rates: TaxRates;
}

/**
 * The combined rate, derived rather than declared.
 *
 * Exported because it is genuinely useful for a summary line — "prices include
 * 21.9% tax" — but never used to compute anything. Deriving it here means it
 * cannot disagree with the components, which a hard-coded copy would the first
 * time one of them moved.
 */
export function effectiveRate(rates: TaxRates = DEFAULT_TAX_RATES): number {
  if (!rates.registered) return 0;

  const levies = rates.levies.reduce((sum, levy) => sum + levy.rate, 0);
  // VAT applies to the taxable value plus the levies, which is what makes this
  // more than `levies + vat`.
  return levies + rates.vat * (1 + levies);
}

/**
 * Splits an amount into net, tax and gross.
 *
 * `amount` is read according to `rates.mode`: it is the gross when inclusive and
 * the net when exclusive. That is the one thing a caller must get right, and it
 * is why the mode travels on the rates rather than being a separate argument
 * somebody can forget.
 *
 * Every line is rounded to the cedi's hundredth as it is produced, and the total
 * is the sum of the rounded lines rather than a rounding of the true total. That
 * is deliberate and it is what makes an invoice add up when a customer checks it
 * with a calculator: a total computed independently of its lines disagrees with
 * them by a pesewa often enough to generate correspondence.
 */
export function taxOn(amount: number, rates: TaxRates = DEFAULT_TAX_RATES): TaxBreakdown {
  const value = Number.isFinite(amount) && amount > 0 ? roundCedis(amount) : 0;

  if (!rates.registered) {
    return { net: value, lines: [], tax: 0, gross: value, rates };
  }

  /**
   * The net, provisionally.
   *
   * In inclusive mode this is the extraction from a price that already contains
   * the tax; in exclusive mode the amount *is* the net and nothing is extracted.
   * Either way it is what the levy lines are computed from.
   */
  const provisionalNet =
    rates.mode === 'inclusive' ? roundCedis(value / (1 + effectiveRate(rates))) : value;

  const lines: TaxLine[] = rates.levies.map((levy) => ({
    id: levy.id,
    label: levy.label,
    rate: levy.rate,
    amount: roundCedis(provisionalNet * levy.rate),
  }));

  // VAT on the taxable value plus the levies — computed from the *rounded* levy
  // lines, so the VAT a customer can recompute from the invoice is the VAT on
  // it.
  const leviesTotal = lines.reduce((sum, line) => sum + line.amount, 0);

  lines.push({
    id: 'vat',
    label: 'VAT',
    rate: rates.vat,
    amount: roundCedis((provisionalNet + leviesTotal) * rates.vat),
  });

  const tax = roundCedis(lines.reduce((sum, line) => sum + line.amount, 0));

  /**
   * Which of the three numbers absorbs the rounding, and why it is the net.
   *
   * There is no arrangement in which all three of these hold at once: the gross
   * is exactly the figure that came in, every line recomputes exactly from the
   * net, and the rounded lines sum to the difference. Something has to give, and
   * which one is a decision about who is inconvenienced.
   *
   * Inclusive mode gives on the net. The gross is what the customer was quoted
   * and what leaves their wallet, so it has to be exact to the pesewa — a bill
   * that arrives at ₵99.99 for a ₵100 order is a support conversation, and one
   * that arrives at ₵100.01 is worse. The net is then the remainder, which keeps
   * `net + tax = gross` true on the document. The cost is that recomputing a
   * levy line from the printed net can be a pesewa out on some totals, which is
   * the least consequential of the three.
   *
   * Exclusive mode gives nothing away: the net is the input and is already
   * exact, so the gross is simply what it adds up to.
   */
  const gross = rates.mode === 'inclusive' ? value : roundCedis(value + tax);
  const net = roundCedis(gross - tax);

  return { net, lines, tax, gross, rates };
}

/**
 * The rates as the environment describes them, falling back to the defaults.
 *
 * Lives here rather than in the server so that the check suite can exercise the
 * parsing — a misread environment variable would silently change every bill in
 * the product, which is the sort of thing that should have an assertion on it.
 * Takes the environment as an argument for the same reason.
 *
 * Anything unparseable falls back rather than throwing. A typo in a tax rate is
 * bad; a server that will not boot because of one is worse, and the warning says
 * which variable to look at.
 */
export function ratesFromEnv(env: Record<string, string | undefined>): TaxRates {
  const rate = (name: string, fallback: number): number => {
    const raw = env[name];
    if (!raw?.trim()) return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      console.warn(
        `[tax] ${name}="${raw}" is not a rate between 0 and 1. Using ${fallback}. ` +
          'Rates are fractions: 0.15 is 15%.'
      );
      return fallback;
    }
    return parsed;
  };

  return {
    levies: LEVIES.map((levy) => ({
      ...levy,
      rate: rate(`TAX_${levy.id.toUpperCase()}_RATE`, levy.rate),
    })),
    vat: rate('TAX_VAT_RATE', VAT_RATE),
    mode: env.TAX_MODE === 'exclusive' ? 'exclusive' : DEFAULT_TAX_MODE,
    // Opt *out*, not opt in. A registered business that forgot to set a variable
    // should over-document its invoices rather than issue them with no tax on.
    registered: env.TAX_REGISTERED !== 'false',
  };
}

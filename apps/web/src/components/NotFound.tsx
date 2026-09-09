/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, Compass } from 'lucide-react';
import { navigate } from '../route';

/**
 * What an address that names nothing looks like.
 *
 * ## Why this exists at all
 *
 * Every unmatched path used to render the marketing page. That is the same
 * thing a *correct* address renders, so the site had no way of saying "you are
 * not where you think you are" — and the person worst served by that was
 * whoever was trying to reach a page that is only ever arrived at by typing.
 * The supervisor desk is exactly that page: `/admni`, or `/Admin` before the
 * router folded case, put a hero and a price list on screen, which reads as the
 * desk having been removed rather than as a typo. It was reported as the desk
 * being broken, and it was not.
 *
 * ## What it deliberately does not say
 *
 * It does not name the desk, or list the addresses that do work. This page is
 * served to anyone who mistypes anything, crawlers included, and a staff-only
 * console has no business being advertised by the 404 — the reasoning is the
 * same one that keeps it out of the header and the footer. Someone who knows
 * the desk exists learns what they needed to know (this address is wrong);
 * someone who does not learns nothing new.
 *
 * The way back is a real navigation rather than an `<a href="/">`, so it goes
 * through the same history the rest of the site uses and Back behaves.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-brand-charcoal px-5 font-ui text-white">
      <div className="w-full max-w-[34rem] text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-brand-gold/30 bg-brand-gold/10 text-brand-gold">
          <Compass aria-hidden="true" className="h-5 w-5" />
        </span>

        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-brand-text-muted">
          Page not found
        </p>

        <h1 className="mt-3 font-display text-[32px] font-medium leading-tight text-white sm:text-[38px]">
          There is nothing at this address.
        </h1>

        <p className="mx-auto mt-4 max-w-[42ch] text-body text-brand-text-muted">
          The link may be mistyped, or it may point at something that has since moved. Your orders
          and your account are unaffected.
        </p>

        <button
          type="button"
          onClick={() => navigate('home')}
          className="mt-8 inline-flex items-center justify-center gap-2 rounded-md bg-brand-gold px-5 py-3 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to FreshFold
        </button>
      </div>
    </main>
  );
}

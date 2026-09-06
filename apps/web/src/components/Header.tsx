import { useState, useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import { priceBreakdown } from '@freshfold/core';
import { useIntent } from '../intent';
import { useDialog } from './ui/useDialog';

interface HeaderProps {
  onOpenBooking: () => void;
  onOpenPortal: () => void;
  onScrollToSection: (sectionId: string) => void;
  activeSection: string;
}

/**
 * Section labels, in page order.
 *
 * Plain nouns. They used to be "Philosophy", "Sectors" and "Process", which is
 * a nav that makes a customer guess where the prices are.
 *
 * `primary` is what the bar carries; the drawer carries the lot. The bar had
 * all seven, at one weight, which is a menu that has not decided what the page
 * is for — "Why us" and "Who we serve" are the two nobody navigates to on
 * purpose, and putting them beside "Prices" costs "Prices" some of its
 * salience. Nothing becomes unreachable: they are still sections on the page,
 * still in the drawer, and still where scrolling puts you.
 */
const NAV_ITEMS = [
  { id: 'services', label: 'Prices', primary: true },
  { id: 'subscriptions', label: 'Plans', primary: true },
  { id: 'how-it-works', label: 'How it works', primary: true },
  { id: 'membership', label: 'Rewards', primary: true },
  { id: 'why-choose-us', label: 'Why us', primary: false },
  { id: 'target-customers', label: 'Who we serve', primary: true },
  { id: 'contact', label: 'Contact', primary: true },
];

const BAR_ITEMS = NAV_ITEMS.filter((item) => item.primary);

export default function Header({
  onOpenBooking,
  onOpenPortal,
  onScrollToSection,
  activeSection,
}: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { intent } = useIntent();
  const progress = useRef<HTMLDivElement | null>(null);

  /**
   * How far down the page the reader is, as a line under the header.
   *
   * This page is eight sections and several thousand pixels of scroll, and the
   * header's only sense of place was which label was lit. A position line is
   * the cheapest honest answer to "how much of this is there", and it is the
   * kind of ambient feedback that makes a long page feel navigable rather than
   * endless.
   *
   * Written straight to the node as a `transform`, never through state: this
   * fires on every scroll frame, and re-rendering the whole header sixty times
   * a second to move a line is how a marketing page ends up janky on the
   * mid-range Android it is mostly read on. `scaleX` stays on the compositor.
   */
  useEffect(() => {
    let queued = false;

    const apply = () => {
      queued = false;
      setIsScrolled(window.scrollY > 24);

      const node = progress.current;
      if (!node) return;
      const doc = document.documentElement;
      const runway = doc.scrollHeight - doc.clientHeight;
      node.style.transform = `scaleX(${runway > 0 ? Math.min(1, window.scrollY / runway) : 0})`;
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /**
   * The drawer's keyboard behaviour, shared with every other overlay here.
   *
   * It had two of the four: the scroll lock, so the page did not move behind
   * it, and Escape. It did not trap focus — Tab left the open drawer and
   * walked the marketing page underneath it, which is covered — and it never
   * gave focus back, so dismissing the drawer dropped the keyboard at the top
   * of the document and the next Tab started over from the wordmark.
   *
   * `useDialog` no-ops entirely while `open` is false, so this is safe to call
   * unconditionally. See ui/useDialog.
   */
  const drawer = useDialog<HTMLDivElement>({
    open: mobileMenuOpen,
    onClose: () => setMobileMenuOpen(false),
  });

  /**
   * The order the reader has built, carried into the button that books it.
   *
   * The header CTA said "Book a pickup" to everybody in every state, including
   * to someone who had just spent a minute assembling ₵130 of laundry three
   * sections below. A button that already knows what it is for is a smaller
   * ask than one that starts the conversation over — the sticky bar on phones
   * has worked this way since it was written, and there was no reason the
   * header should not.
   */
  const lines = intent.items;
  const orderTotal =
    lines.length > 0
      ? priceBreakdown({ serviceType: lines[0].serviceType, items: lines }).gross
      : 0;

  return (
    <header
      id="main-header"
      /* `below-banner` keeps this clear of the connection banner when there
         is one, and resolves to `top: 0` when there is not. See index.css. */
      className={`below-banner fixed inset-x-0 z-[var(--z-header)] font-ui transition-[padding,background-color,border-color,top] duration-300 ${
        isScrolled || mobileMenuOpen
          ? 'border-b border-white/10 bg-brand-charcoal/90 py-3 backdrop-blur-xl'
          : 'border-b border-transparent py-5'
      }`}
    >
      <div className="mx-auto flex max-w-[88rem] items-center gap-6 px-5 sm:px-8">
        {/* Wordmark */}
        <button
          onClick={() => {
            setMobileMenuOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="group flex shrink-0 items-center gap-2.5"
          id="logo-button"
          aria-label="FreshFold — back to top"
        >
          <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-sage text-[15px] font-bold text-white transition-colors duration-200 group-hover:bg-brand-gold group-hover:text-brand-charcoal fs-expanded">
            FF
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-white fs-semi">
            FreshFold
          </span>
        </button>

        {/*
          Desktop navigation, from `lg` rather than `xl`.

          It used to appear only past 1280px, which handed every 1024–1279px
          laptop — a thoroughly ordinary window — the phone's hamburger on a
          screen with room for the whole menu. Six labels at 13.5px, a wordmark
          and two buttons fit inside 1024 with room to spare; the seventh was
          what made it not fit, and it is the one that belongs in the drawer.
        */}
        <nav
          className="ml-2 hidden flex-1 items-center gap-1 lg:flex"
          id="desktop-nav"
          aria-label="Sections"
        >
          {BAR_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onScrollToSection(item.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`relative rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors duration-200 ${
                  isActive ? 'text-white' : 'text-brand-text-muted hover:text-white'
                }`}
                id={`nav-${item.id}`}
              >
                {item.label}
                {/* Brass, and two pixels of it. The comment here used to
                    describe a dot while the code drew a 1px hairline, which at
                    this width reads as an artefact rather than as a mark. Sage
                    is not an option: it sits at 2.4:1 on charcoal and is
                    simply not visible as a rule. */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3 -bottom-0.5 h-0.5 origin-left rounded-full bg-brand-gold transition-transform duration-300 ${
                    isActive ? 'scale-x-100' : 'scale-x-0'
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Desktop actions */}
        <div className="ml-auto hidden items-center gap-2 lg:flex" id="desktop-cta-buttons">
          <button
            onClick={onOpenPortal}
            className="rounded-md px-3.5 py-2.5 text-[13.5px] font-medium text-brand-text-muted transition-colors duration-200 hover:text-white"
            id="cta-portal-desktop"
          >
            Track an order
          </button>
          {/* The supervisor desk is staff-only, so it is not advertised in the
              customer-facing nav or the footer; `#admin` still opens it for
              anyone who types it, behind a real login. */}
          <button
            onClick={onOpenBooking}
            className="flex items-center gap-2 rounded-md bg-brand-gold px-5 py-2.5 text-[13.5px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
            id="cta-schedule-desktop"
          >
            <span>{lines.length > 0 ? 'Book your order' : 'Book a pickup'}</span>
            {lines.length > 0 && (
              <span className="rounded bg-brand-charcoal/15 px-1.5 py-0.5 tnum">₵{orderTotal}</span>
            )}
          </button>
        </div>

        {/* Mobile actions */}
        <div className="ml-auto flex items-center gap-2 lg:hidden">
          <button
            onClick={onOpenBooking}
            className="flex items-center gap-1.5 rounded-md bg-brand-gold px-4 py-2 text-[13px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
          >
            <span>Book</span>
            {lines.length > 0 && <span className="tnum">₵{orderTotal}</span>}
          </button>
          <button
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center rounded-md border border-white/12 text-white"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-drawer"
            id="mobile-menu-trigger"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/*
        How far down the page the reader is.

        Under everything, hairline thin, and only once the page has actually
        been scrolled — a full-width brass rule sitting at zero under a hero
        nobody has moved yet is a decoration, not a reading.
      */}
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity duration-300 ${
          isScrolled ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div
          ref={progress}
          className="h-full w-full origin-left scale-x-0 bg-brand-gold/70"
        />
      </div>

      {/* Mobile drawer */}
      {/* Anchored to the header rather than to the viewport: the header is
          already `fixed`, so `top-full` puts the drawer exactly under it at
          whichever of the two header heights is current, with no magic number
          to keep in step. */}
      <div
        ref={drawer}
        id="mobile-drawer"
        hidden={!mobileMenuOpen}
        tabIndex={-1}
        className="absolute inset-x-0 top-full max-h-[calc(100svh-3.75rem)] overflow-y-auto border-t border-white/10 bg-brand-charcoal outline-none lg:hidden"
      >
        <nav className="px-5 pb-8 pt-2" aria-label="All sections">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setMobileMenuOpen(false);
                onScrollToSection(item.id);
              }}
              className={`flex w-full items-center justify-between border-b border-white/10 py-4 text-left text-[19px] font-medium tracking-[-0.02em] ${
                activeSection === item.id ? 'text-brand-gold' : 'text-white'
              }`}
              id={`nav-mobile-${item.id}`}
            >
              {item.label}
              <span className="text-label text-brand-text-muted">
                {activeSection === item.id ? 'Here' : ''}
              </span>
            </button>
          ))}

          {/* The order, where the drawer can show it in full rather than as a
              number on a button. */}
          {lines.length > 0 && (
            <div className="mt-6 rounded-md border border-white/15 p-4">
              <p className="text-[13px] font-medium text-brand-text-muted">Your order so far</p>
              <ul className="mt-2 space-y-1">
                {lines.map((line) => (
                  <li key={line.serviceType} className="text-body text-brand-text-light">
                    {line.quantity} &times; {line.serviceType}
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-white/10 pt-3 text-[17px] font-semibold text-brand-gold tnum">
                ₵{orderTotal}
              </p>
            </div>
          )}

          <button
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenPortal();
            }}
            className="mt-6 w-full rounded-md border border-white/15 py-3.5 text-[15px] font-medium text-white"
            id="cta-portal-mobile"
          >
            Track an order
          </button>
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenBooking();
            }}
            className="mt-2.5 w-full rounded-md bg-brand-gold py-3.5 text-[15px] font-semibold text-brand-charcoal"
            id="cta-schedule-mobile"
          >
            {lines.length > 0 ? `Book your order — ₵${orderTotal}` : 'Book a pickup'}
          </button>

          <p className="mt-6 text-body text-brand-text-muted">
            Wagyingo Opal, Ayeduase-Kotei — beside the Benab filling station.
            <br />
            <a href="tel:+233200957165" className="text-brand-gold">
              +233 20 095 7165
            </a>
          </p>
        </nav>
      </div>
    </header>
  );
}

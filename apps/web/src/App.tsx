import React, { Suspense, lazy, useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import Services from './components/Services';
import Pricing from './components/Pricing';
import Membership from './components/Membership';
import WhyChooseUs from './components/WhyChooseUs';
import HowItWorks from './components/HowItWorks';
import TargetCustomers from './components/TargetCustomers';
import Contact from './components/Contact';
import Footer from './components/Footer';
import { Booking } from './types';
import * as store from './services/store';
import { ArrowUp } from 'lucide-react';
import { priceBreakdown } from '@freshfold/core';
import { useIntent } from './intent';
import NextCollection from './components/ui/NextCollection';
import ErrorBoundary from './components/ui/ErrorBoundary';
import Pending from './components/ui/Pending';
import ConnectionBanner from './components/ui/ConnectionBanner';
import { useScrollSpy, useScrolledPast, scrollToSection } from './components/ui/scroll';
import { currentRoute, navigate, normaliseUrl, subscribeToRoute, type Route } from './route';
import { track } from './services/analytics';

/**
 * The four heavy surfaces, split out of the first load.
 *
 * All of these are already conditional — the portal renders behind `#portal`,
 * the desk behind `#admin`, the booking form behind a button — but a static
 * import puts them in the entry chunk regardless, so every visitor to the
 * marketing page was downloading the supervisor dashboard, the client portal
 * and the Google Maps bindings before the hero rendered. That was the
 * bulk of a 1.5 MB single chunk.
 *
 * `lazy` makes the conditional render the thing that fetches them. A visitor who
 * never opens the portal never pays for it; one who does waits on a chunk over a
 * connection that has already warmed up, behind the `Suspense` fallback below.
 *
 * `Contact`, `Hero` and the rest stay static: they are the page.
 */
const BookingModal = lazy(() => import('./components/BookingModal'));
const ClientPortal = lazy(() => import('./components/ClientPortal'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AdminLogin = lazy(() => import('./components/AdminLogin'));
const ChatbotWidget = lazy(() => import('./components/ChatbotWidget'));
const PaystackReturn = lazy(() => import('./components/PaystackReturn'));

/**
 * The wrapper every one of those lazy screens is mounted behind.
 *
 * It used to be `<Suspense fallback={null}>` and nothing else, which had two
 * failure modes and no way to tell them apart from the outside:
 *
 *  - **Slow.** `null` meant pressing "Book a pickup" produced no visible
 *    change until the chunk landed. On a desk connection that is 200ms and the
 *    empty space is the honest intermediate state. On Kumasi mobile data it is
 *    seconds, and a button that does nothing for seconds gets pressed again.
 *    `Pending` waits 260ms before it says anything, so the fast case is
 *    unchanged and only the slow one grows an acknowledgement.
 *  - **Broken.** A chunk that never arrives — a dropped connection, a deploy
 *    that rotated the hashed filenames under a tab left open overnight —
 *    throws. With no boundary anywhere in the tree, React unmounted the whole
 *    app and the customer was left looking at an empty dark page, with no
 *    message and nothing in any log.
 */
const Deferred = ({
  children,
  context,
  label,
  onDismiss,
}: {
  children: React.ReactNode;
  context: string;
  label?: string;
  onDismiss?: () => void;
}) => (
  <ErrorBoundary context={context} onDismiss={onDismiss}>
    <Suspense fallback={<Pending label={label} />}>{children}</Suspense>
  </ErrorBoundary>
);

/** The sections the header nav lights up, in page order. */
const SECTIONS = [
  'hero',
  'services',
  'subscriptions',
  'membership',
  'why-choose-us',
  'how-it-works',
  'target-customers',
  'contact',
] as const;
export default function App() {
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  /**
   * What the visitor has told the page so far.
   *
   * `App` used to hold a service name and a count and thread them into the
   * booking form as props — the only one of the page's nine interactive
   * controls whose answer survived being scrolled past. Every control now
   * writes into the shared intent instead, and this reads it for the one thing
   * `App` itself renders: the standing offer at the bottom of a phone.
   */
  const { intent } = useIntent();
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  /** The subset of the ledger this browser is entitled to see. See the notifier. */
  const [ownBookings, setOwnBookings] = useState<Booking[]>([]);

  /**
   * Where the browser is, as one value rather than six pieces of state.
   *
   * All the parsing lives in `route.ts` now — including the legacy `#portal`
   * and `#paystack-success` fragment forms, which are still in emails already
   * sent and in the payment callback allowlist, and are normalised to their
   * path equivalents on arrival. See that file.
   */
  const [route, setRoute] = useState<Route>(currentRoute);

  const isPortalOpen = route.name === 'portal';
  const isAdminOpen = route.name === 'admin';
  const isPaystackReturn = route.name === 'paystack-success';

  /**
   * Which section the header nav lights up, and whether the page has been
   * scrolled far enough for the floating controls to be worth showing.
   *
   * Both used to come out of one `scroll` handler that read `offsetTop` off
   * eight elements per event — a synchronous layout on every scroll event, and
   * the reason this page stuttered on a mid-range Android. See
   * `components/ui/scroll.ts`.
   */
  const activeSection = useScrollSpy(SECTIONS, 'hero');
  const showScrollTop = useScrolledPast(500);

  /**
   * Whether the desk session has been checked with the server yet.
   *
   * Three states, and the distinction matters: `null` means we have not asked,
   * so the dashboard must not render even for a moment; `false` means asked and
   * refused, so show the login. Rendering the dashboard first and hiding it
   * afterwards would put the whole ledger on screen for a frame.
   */
  const [isSupervisor, setIsSupervisor] = useState<boolean | null>(null);

  // Re-validate the stored desk token whenever the admin route is entered. It
  // is checked against the server every time rather than trusted from storage —
  // a revoked supervisor should not keep a working dashboard.
  useEffect(() => {
    if (!isAdminOpen) return;

    let cancelled = false;
    setIsSupervisor(null);

    store
      .restoreAdminSession()
      .then((supervisor) => {
        if (!cancelled) setIsSupervisor(Boolean(supervisor));
      })
      .catch(() => {
        if (!cancelled) setIsSupervisor(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdminOpen]);

  /**
   * The same check, for the rest of the shift.
   *
   * The one above runs when the route is entered and never again, while the
   * desk session lasts twelve hours — so the expiry lands on a board that is
   * already open, nearly every time. `store.pull` marks it when the server
   * refuses the token and notifies, which is this subscription: the desk drops
   * back to the sign-in form instead of sitting on a stale board blaming the
   * connection for a session that had simply run out.
   */
  useEffect(() => {
    if (!isAdminOpen) return;

    return store.subscribe(() => {
      if (store.isAdminSessionExpired()) setIsSupervisor(false);
    });
  }, [isAdminOpen]);

  // The booking ledger lives on the dispatch server. Read the cached mirror
  // immediately so the first paint has data, then subscribe: every poll that
  // brings back a rider's progress re-renders the portal and the live map.
  useEffect(() => {
    const sync = () => {
      setActiveBookings(store.readBookings());
      setOwnBookings(store.readOwnBookings());
    };

    sync();

    const unsubscribe = store.subscribe(sync);
    const stopSync = store.startSync();

    return () => {
      unsubscribe();
      stopSync();
    };
  }, []);

  /**
   * The one order the floating notifier offers to track: this visitor's own,
   * still in flight, furthest along.
   */
  const trackableBooking =
    ownBookings.find(
      (booking) => booking.status !== 'Delivered' && booking.status !== 'Cancelled'
    ) ?? null;

  /**
   * Follow the URL, however it changed.
   *
   * One subscription covering `popstate` (the Back button), the app's own
   * `navigate()` calls, and `hashchange` for an emailed `#portal?setup=…` link
   * opened in a tab that is already loaded. See `route.ts`.
   */
  useEffect(() => {
    const sync = () => {
      // Also on every change, not only before the first render in main.tsx: an
      // emailed `/#portal?setup=…` link opened in a tab that is already on the
      // site arrives as a `hashchange`, and without this it would keep the
      // fragment form for the rest of the session.
      normaliseUrl();
      setRoute(currentRoute());
    };
    sync();
    return subscribeToRoute(sync);
  }, []);

  /**
   * Keep the portal and the desk out of a search index.
   *
   * `robots.txt` disallows both paths, but a `Disallow` is a request not to
   * crawl rather than a promise not to index — a URL somebody linked to can
   * still be listed, with a title Google guesses. `noindex` is the part that
   * actually keeps a customer's account page out of a result, and because this
   * is one HTML document serving every route, it has to be set as the route
   * changes rather than in the head.
   */
  useEffect(() => {
    const shouldIndex = route.name === 'home';
    let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');

    if (shouldIndex) {
      tag?.remove();
      return;
    }

    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'robots';
      document.head.appendChild(tag);
    }
    tag.content = 'noindex, nofollow';
  }, [route.name]);

  /**
   * Opens the booking form, remembering which control opened it.
   *
   * A factory rather than a function taking the label directly, because most
   * of these are passed straight to `onClick` and to child components that
   * call `onOpenBooking()` with no arguments — a plain `openBooking(from)`
   * would be handed a `MouseEvent` as its label at half the call sites.
   *
   * The label is the only way to tell afterwards which of the page's nine
   * "Book a pickup" buttons people actually press, which is the difference
   * between moving a button and moving a whole section.
   */
  const bookFrom = useCallback(
    (from: string) => () => {
      setIsBookingOpen(true);
      track('booking_opened', { from });
    },
    []
  );

  const openPortal = useCallback((bookingId?: string) => {
    navigate('portal', { bookingId });
    track('portal_opened', { withOrder: Boolean(bookingId) });
  }, []);

  /** Back to the marketing page, from an overlay that owns the window. */
  const closeOverlay = useCallback(() => navigate('home'), []);

  /**
   * The order as it stands, for the sticky bar.
   *
   * Priced through `priceBreakdown` rather than summed here, for the same
   * reason the estimator does: how an order is priced is core's business, and
   * a second copy of that arithmetic on the marketing page is a second number
   * to disagree with the checkout.
   */
  const orderLines = intent.items;
  const orderTotal =
    orderLines.length > 0
      ? priceBreakdown({ serviceType: orderLines[0].serviceType, items: orderLines }).gross
      : 0;

  const handleBookingCreated = (newBooking: Booking) => {
    setActiveBookings((prev) => [newBooking, ...prev]);
  };

  // Before anything else, and instead of everything else. The header, the
  // marketing sections and the chat bubble are all wrong in a checkout popup.
  if (isPaystackReturn) {
    return (
      <Deferred context="paystack-return" label="Confirming your payment">
        <PaystackReturn />
      </Deferred>
    );
  }

  return (
    /* `ff` scopes the marketing page's focus ring and its reduced-motion
       escape hatch — see index.css. The portal, the booking modal and the
       supervisor desk render outside it and keep their own. */
    <div className="ff min-h-screen bg-brand-charcoal pb-[4.75rem] font-ui text-white antialiased selection:bg-brand-gold selection:text-brand-charcoal lg:pb-0">
      {/*
        The first thing a keyboard reaches, and the only thing it reaches that
        is invisible until it does.

        This page opens with a fixed header carrying seven section links and
        two buttons. Without this, every visit on a keyboard or a screen reader
        starts by tabbing through all nine of them to get to the hero — on
        every route change, and again after every dialog that returns focus to
        the top.
      */}
      <a
        href="#main"
        className="sr-only rounded-md bg-brand-gold px-5 py-3 text-[15px] font-semibold text-brand-charcoal focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[var(--z-toast)]"
      >
        Skip to the page
      </a>

      {/* Says out loud what the store has always quietly done about a dropped
          connection. See the component. */}
      <ConnectionBanner />

      {/*
        The site header — down while the portal is up.

        The portal used to be a sheet laid over this page with `pt-[72px]`
        reserved so the header showed above it, which put "Book a pickup" and
        the section nav over a customer reading their own delivery window. It
        is its own screen now and paints over this one, but painting over a
        header is not the same as it not being there: it was still in the tab
        order and still on the accessibility tree, so a keyboard or a screen
        reader landed in the marketing nav before reaching the account.

        Same reasoning for the floating controls and the chat bubble below.
      */}
      {!isPortalOpen && (
        <Header
          onOpenBooking={bookFrom('header')}
          onOpenPortal={() => openPortal()}
          onScrollToSection={scrollToSection}
          activeSection={activeSection}
        />
      )}

      <main id="main">
        {/* Homepage Hero */}
        <Hero
          onOpenBooking={bookFrom('hero')}
          onExplorePlans={() => scrollToSection('subscriptions')}
        />

        {/* "When would I get it back?", answered off the live dispatch board
            rather than in prose. Directly under the hero because it is the
            second of the three questions the page exists to answer, and the
            hero has just answered the first. */}
        <NextCollection />

        {/* Services Section with custom category targets */}
        <Services onOpenBooking={bookFrom('services')} />

        {/* Subscription pricing structures */}
        <Pricing onOpenBooking={bookFrom('pricing')} />

        {/* Loyalty tiers, earned rather than sold */}
        <Membership onOpenBooking={bookFrom('membership')} />

        {/* Philosophy Core guidelines */}
        <WhyChooseUs />

        {/* Progressive Timeline sequence */}
        <HowItWorks />

        {/* Segment customized panels (Students, Execs, Spas) */}
        <TargetCustomers onOpenBooking={bookFrom('target-customers')} />

        {/* Communications, Map and Hours portal */}
        <Contact onOpenBooking={bookFrom('contact')} />
      </main>

      {/* Footer copyright */}
      <Footer />

      {/* Digital Scheduling Modal form container */}
      {/* Mounted only once opened: `lazy` fetches on first render, and this
          modal renders nothing until `isOpen`, so gating here is what keeps its
          chunk off the marketing page. */}
      {isBookingOpen && (
        <Deferred
          context="booking-modal"
          label="Opening the booking form"
          onDismiss={() => setIsBookingOpen(false)}
        >
          <BookingModal
            isOpen={isBookingOpen}
            onClose={() => setIsBookingOpen(false)}
            onBookingCreated={handleBookingCreated}
          />
        </Deferred>
      )}

      {/* Immersive password-setup & progress-tracking Client Portal */}
      {isPortalOpen && (
        <Deferred context="client-portal" label="Opening your account" onDismiss={closeOverlay}>
          <ClientPortal
            isOpen={isPortalOpen}
            onClose={closeOverlay}
            bookingIdParam={route.bookingId}
            setupTokenParam={route.setupToken}
            activeBookings={activeBookings}
            onUpdateBookings={(updated) => {
              setActiveBookings(updated);
              store.writeBookings(updated);
            }}
            onOpenBooking={bookFrom('portal')}
          />
        </Deferred>
      )}

      {/* Supervisor desk — behind a real login, not a URL fragment. */}
      {isAdminOpen && isSupervisor === false && (
        <Deferred context="admin-login" label="Opening the desk" onDismiss={closeOverlay}>
          <AdminLogin
            onAuthenticated={() => setIsSupervisor(true)}
            onClose={closeOverlay}
            notice={
              store.isAdminSessionExpired()
                ? 'Your desk session ended, so the board stopped updating. Sign in to pick it back up.'
                : undefined
            }
          />
        </Deferred>
      )}

      {isAdminOpen && isSupervisor === true && (
        <Deferred context="admin-dashboard" label="Loading the board" onDismiss={closeOverlay}>
          <AdminDashboard
            onClose={closeOverlay}
            onSignOut={() => {
              void store.adminLogout();
              setIsSupervisor(false);
            }}
            activeBookings={activeBookings}
            onUpdateBookings={(updated) => {
              setActiveBookings(updated);
              store.writeBookings(updated);
            }}
          />
        </Deferred>
      )}

      {/*
        Floating notifier for an order *this* visitor has on the go.

        Read from `readOwnBookings()`, not from the ledger. It used to show
        `activeBookings[0].id`, and `activeBookings` is every booking on the
        board — so anybody who opened the marketing site was shown the order
        number of the last person to book, whoever they were. Delivered and
        cancelled orders are left out too: there is nothing left to track, and
        a pulsing button that never goes away is not a notification.
      */}
      {trackableBooking && !isPortalOpen && (
        <button
          onClick={() => {
            openPortal(trackableBooking.id);
            track('order_tracked', { from: 'floating-notifier' });
          }}
          className="fixed bottom-5 left-5 z-[var(--z-floating)] hidden items-center gap-2.5 rounded-md border border-white/15 bg-brand-card/95 px-4 py-3 text-[14px] font-medium text-white shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-sm transition-colors duration-200 hover:border-brand-gold/60 lg:flex"
          id="active-order-floating-notifier"
        >
          {/* The pulse is on the dot, not on the button. A whole control
              breathing in the corner of the page is an alarm, and this is a
              standing offer to look at an order that is going fine. */}
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-sage-light opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-sage-light" />
          </span>
          <span>
            Track order <span className="tnum text-brand-gold">{trackableBooking.id}</span>
          </span>
        </button>
      )}

      {/* Back to Top floating arrow. Desktop only: on a phone the bottom edge
          belongs to the booking bar below, and a second floating control
          fighting it for the same corner is clutter. */}
      {showScrollTop && !isPortalOpen && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-5 right-5 z-[var(--z-floating)] hidden h-11 w-11 place-items-center rounded-md border border-white/15 bg-brand-card/95 text-white shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-sm transition-colors duration-200 hover:border-brand-gold/60 hover:text-brand-gold lg:grid"
          aria-label="Back to top"
          id="scroll-to-top-button"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}

      {/*
        The phone's standing offer.

        A marketing page on a phone is a long scroll with the one action that
        matters sitting at the very top, out of sight from the second screenful
        onwards. This puts it back within thumb reach without stealing the
        header, and it carries the price so the button is never a cold ask.

        It doubles as the tracker when this visitor has an order on the go:
        that is the reason a returning customer is on this page, and it
        outranks booking another one.
      */}
      {showScrollTop && !isPortalOpen && (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-floating)] border-t border-white/10 bg-brand-charcoal/95 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {trackableBooking ? (
              <button
                onClick={() => {
                  openPortal(trackableBooking.id);
                  track('order_tracked', { from: 'sticky-bar' });
                }}
                className="flex min-w-0 flex-1 flex-col text-left"
              >
                <span className="flex items-center gap-1.5 text-[13px] text-brand-text-muted">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-sage-light" />
                  Order in progress
                </span>
                <span className="truncate text-[15px] font-medium text-white">
                  Track <span className="tnum text-brand-gold">{trackableBooking.id}</span>
                </span>
              </button>
            ) : orderLines.length > 0 ? (
              /*
                An order in progress upstairs, carried down the page.

                On a phone the estimator is a screenful somewhere in the middle
                of a long scroll, and the total someone just built stops
                existing the moment they scroll past it. This keeps it under
                their thumb — which is also what makes building one worth the
                trouble on the device most of these visitors are on.
              */
              <button
                onClick={bookFrom('sticky-bar-order')}
                className="flex min-w-0 flex-1 flex-col text-left"
              >
                <span className="block truncate text-[13px] text-brand-text-muted">
                  {orderLines.length === 1
                    ? orderLines[0].serviceType
                    : `${orderLines.length} services`}
                </span>
                <span className="block text-[15px] font-medium text-white">
                  Your order &middot;{' '}
                  <span className="tnum text-brand-gold">₵{orderTotal}</span>
                </span>
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] text-brand-text-muted">
                  Pickup &amp; delivery free
                </span>
                <span className="block text-[15px] font-medium text-white">
                  A wash from <span className="tnum text-brand-gold">₵30</span>
                </span>
              </div>
            )}
            <button
              onClick={bookFrom('sticky-bar')}
              className="shrink-0 rounded-md bg-brand-gold px-5 py-3 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
            >
              {orderLines.length > 0 && !trackableBooking ? 'Book it' : 'Book a pickup'}
            </button>
          </div>
        </div>
      )}

      {/* The question box. Told where the reader is, so its openers can be
          about what is on screen rather than the same five every time. It is a
          pre-sales opener; a signed-in customer with a live order has the
          message thread on the order itself. */}
      {!isPortalOpen && (
        <Deferred context="chatbot-widget">
          <ChatbotWidget activeSection={activeSection} onOpenBooking={bookFrom('chatbot')} />
        </Deferred>
      )}

    </div>
  );
}

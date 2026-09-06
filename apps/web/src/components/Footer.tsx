import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { SHOP } from '../shop';

const SITEMAP = [
  { href: '#services', label: 'Prices' },
  { href: '#subscriptions', label: 'Monthly plans' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#membership', label: 'Rewards' },
  { href: '#target-customers', label: 'Who we serve' },
  { href: '#contact', label: 'Contact' },
];

/** Booking ids are six digits. See the portal, which is what this opens. */
const ORDER_ID = /^\d{6}$/;

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState('');

  const track = (event: React.FormEvent) => {
    event.preventDefault();
    const id = orderId.trim();
    if (!ORDER_ID.test(id)) {
      setError('An order number is six digits.');
      return;
    }
    setError('');
    // The same route the emailed link uses; `App` reads the id off the hash and
    // hands it to the portal.
    window.location.hash = `#portal?bookingId=${id}`;
  };

  return (
    /*
      The footer's job, and what it stopped doing.

      It used to print the address, the phone number and the email a second
      time, a few hundred pixels below the contact section that had just
      printed all three. Repeating a block does not make it easier to find; it
      makes the page look padded and gives the details two places to go out of
      date. Reaching the shop belongs to Contact.

      What is left is what a footer is for: where else to go on the page, one
      last thing to *do* — pick up an order already in flight, which is the most
      common reason a returning customer is here at all — and the single line of
      identification a local business closes with. All of it reads `SHOP`, so
      there is one address on this site rather than two.
    */
    <footer className="bg-brand-charcoal py-16 font-ui sm:py-20">
      <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
        <div className="grid gap-12 border-b border-white/10 pb-12 lg:grid-cols-12 lg:gap-14">
          {/* Brand */}
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-sage text-[15px] font-bold text-white fs-expanded">
                FF
              </span>
              <span className="text-[17px] font-semibold tracking-[-0.02em] text-white fs-semi">
                FreshFold Laundry Co.
              </span>
            </div>
            <p className="mt-6 max-w-[40ch] text-body text-brand-text-muted">
              We collect laundry across Kumasi, wash and press it at the shop in Ayeduase-Kotei, and
              bring it back the next day. Pickup and delivery are free on every order.
            </p>
          </div>

          {/* Sitemap */}
          <nav className="lg:col-span-3" aria-label="Footer">
            <h2 className="text-[13px] font-medium text-brand-text-muted">On this page</h2>
            <ul className="mt-4 space-y-2.5">
              {SITEMAP.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="text-[15px] text-brand-text-light transition-colors duration-200 hover:text-brand-gold"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              {/*
                No supervisor-desk link here on purpose. The desk is staff-only
                and has no business advertising itself in a customer's footer;
                `#admin` still opens it for anyone who types it. That is not a
                security measure — the password is — it just keeps an internal
                tool out of the shopfront.
              */}
            </ul>
          </nav>

          {/* The one action a returning customer wants. */}
          <div className="lg:col-span-4 lg:col-start-9">
            <h2 className="font-display text-[25px] font-medium text-white">
              Already sent us a bag?
            </h2>
            <p className="mt-2 max-w-[38ch] text-body text-brand-text-muted">
              Put in the six-digit order number from your confirmation and we will open its
              tracking page.
            </p>
            <form onSubmit={track} noValidate className="mt-4 flex gap-2">
              <label htmlFor="footer-order" className="sr-only">
                Order number
              </label>
              <input
                id="footer-order"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={orderId}
                onChange={(event) => {
                  setOrderId(event.target.value.replace(/\D/g, ''));
                  if (error) setError('');
                }}
                placeholder="123456"
                className="w-full rounded-md border border-white/15 bg-brand-card px-4 py-3 text-[15px] text-white placeholder:text-brand-text-muted transition-colors duration-200 focus:border-brand-gold focus:outline-none tnum"
              />
              <button
                type="submit"
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-white/20 px-5 py-3 text-[15px] font-medium text-white transition-colors duration-200 hover:border-white/40 hover:bg-white/5"
              >
                Track
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </form>
            <p aria-live="polite" className="mt-2 min-h-[1.25rem] text-body text-brand-gold">
              {error}
            </p>
          </div>
        </div>

        {/* One line of identification, not a second contact card. */}
        <div className="flex flex-col gap-3 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body text-brand-text-muted">
            &copy; {currentYear} FreshFold Laundry Co., Kumasi.
          </p>
          <p className="text-body text-brand-text-muted">
            {SHOP.addressShort} ·{' '}
            <a
              href={`tel:${SHOP.phone}`}
              className="text-brand-gold underline decoration-brand-gold/40 underline-offset-4 hover:decoration-brand-gold tnum"
            >
              {SHOP.phoneLabel}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

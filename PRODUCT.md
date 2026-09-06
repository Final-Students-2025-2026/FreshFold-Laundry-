# Product

## Register

brand

The surface that matters here is `apps/web`'s marketing landing — the page a
stranger meets before they trust FreshFold with their clothes. The client portal
and the supervisor desk in the same app are **product** surfaces and are governed
by different rules; this file's register applies to the landing.

## Users

Three groups, all in Kumasi, all within delivery range of the Ayeduase-Kotei shop:

- **KNUST students.** Price-first. No machine, no time, sharing a hall bathroom.
  They want to know what a load costs and whether it comes back before class.
- **Working professionals.** Time-first. Shirts and suits that must be ready for
  Monday. They will pay a subscription to stop thinking about it.
- **Households and small businesses** — families, salons, guest houses, clinics.
  Volume-first. They need predictable turnaround and a real invoice.

They arrive on a phone, on Ghanaian mobile data, usually because someone told
them about it. The job to be done is small and concrete: *find out what it costs,
find out when I get it back, book it.* Every visit that ends without one of those
three answers is a failed visit.

## Product Purpose

FreshFold picks laundry up, cleans it, and brings it back the next day. The
landing page exists to make that trade legible in under thirty seconds and to
hand the visitor into the booking flow. It is not a brochure for a brand; it is
the front counter of a working shop.

Success is a booking. The secondary success is a returning customer finding the
client portal without asking.

## Brand Personality

**Exact. Local. Unhurried.**

The voice of a good shopkeeper who knows their trade: says the price, says the
day, doesn't oversell. Confidence comes from specificity — "₵30 a load, back
tomorrow, pickup is free" — not from adjectives. Warm but never chatty; precise
but never clinical.

The page should feel *pressed*: clean edges, aligned numbers, nothing loose.

## Anti-references

- **Mayfair-concierge pastiche.** The previous copy ran on "bespoke fabric
  hospitality", "master artisans", "white-glove textile hospitality", "Our
  Physical Sanctuary". It is a Kumasi laundry charging ₵30 a load; borrowed
  luxury vocabulary reads as insecurity, not prestige.
- **Fabricated credentials.** "Certified Luxury Garment Care Society #1902",
  "Over 12,000 pristine deliveries", "Julian V. Rossi" on the loyalty card, and
  the invented testimonial roster were all inventions. Nothing on this page may
  claim something the business cannot substantiate.
- **Section-template landing pages.** Tracked-uppercase eyebrow → serif headline
  with an italic second half → muted paragraph → grid of identical cards,
  repeated eight times. That was the previous page and it is the shape of every
  AI-generated landing page in existence.
- **Editorial-magazine costume.** Display-serif italic, drop caps, rule-separated
  broadsheet columns. A laundry is not a magazine.
- **Decorative glow.** A blurred colour blob behind every section is not art
  direction.

## Design Principles

1. **A number beats an adjective.** Every claim on the page resolves to a price,
   a duration, an address, or a count. If it can't, it comes off the page.
2. **Say it the way you'd say it at the counter.** Plain sentences a student
   would actually use. No word on the page that a customer wouldn't say back.
3. **One shape per section.** No section repeats the layout of the one above it.
   Rhythm is the structure; the visitor should feel the page move.
4. **The palette does the work.** Charcoal, olive, brass — used as surfaces and
   meaning (olive = FreshFold's own, brass = money), never as decoration.
5. **Nothing claimed that isn't true.** Copy is bounded by what
   `packages/core` can actually price and what the shop can actually deliver.

## Accessibility & Inclusion

- **WCAG 2.2 AA.** Body text ≥ 4.5:1, large text ≥ 3:1, against its real
  background. Note: `--color-brand-sage` (#5A5A40) is **2.4:1 on charcoal** and
  must never be used as text colour on the page ground — use
  `--color-brand-sage-light` (#8C8C6A, 5.2:1) or `--color-brand-gold` (#C5A880,
  8.5:1). Sage is a *fill* that carries white text (7.7:1), not an ink.
- No text below 12px, and no opacity modifiers on text — a muted colour is a
  colour, chosen and checked, not `/50` on something else.
- Every reveal animation has a `prefers-reduced-motion` path, and no content is
  gated behind an animation that might not fire.
- Real focus-visible rings on every interactive element; the page is fully
  keyboard-operable including the filter, tab and stepper controls.
- Built for a mid-range Android on Ghanaian mobile data: imagery is the only
  heavy asset and it is lazy below the fold.

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * English, and the source of truth for what a key is.
 *
 * Every other dictionary is a `Partial` of this one, so this file decides which
 * keys exist and `TranslationKey` makes a typo in a `t()` call a build error
 * rather than a blank label on a screen.
 *
 * Conventions worth keeping to as this grows:
 *
 * - Keys are `screen.thing`, flat and dotted. A nested tree reads more neatly in
 *   the file and much worse at the call site, where what you want is to see the
 *   whole key at a glance.
 * - Placeholders are `{name}`, filled by the second argument to `t()`.
 * - Counted phrases get two keys and the call site picks — `orders.one` against
 *   `orders.many`. No plural machinery: English, Spanish and French all split at
 *   exactly one, so `count === 1` at the call site is the entire rule, and a
 *   plural engine would be three hundred lines deciding that.
 * - The wording here is the wording that was already on the screen. This layer
 *   moves strings; it does not rewrite them.
 */

export const en = {
  // -------------------------------------------------------------- shared
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.keep': 'Keep',
  'common.remove': 'Remove',
  'common.add': 'Add',
  /** Dismisses a sheet. The sheets' own scrim and back gesture say nothing. */
  'common.close': 'Close',
  'common.saving': 'Saving…',
  'common.sending': 'Sending…',
  'common.default': 'Default',
  'common.signInCta': 'Sign in or create an account',
  /**
   * The primary call to action, said in two places — the home hero and the empty
   * orders list on the account tab. One key because it is one button going to
   * one place, and two copies of a button label is how they end up worded
   * differently in Spanish.
   */
  'common.schedulePickup': 'Schedule a pickup',
  /** Said on both the account tab and the settings header. */
  'common.guest': 'Browsing as a guest',
  /** The one sentence for "the request never left the phone". */
  'common.unreachable': 'Could not reach FreshFold. Check your connection and try again.',
  /**
   * The badge that says this phone cannot see the server, worn on the wallet
   * header and in the connection pill in `ui.tsx`. One word, one meaning, one
   * key — the pill's other two states live beside it.
   */
  'common.offline': 'Offline',
  /** Stands in for a date or a figure the app does not have. */
  'common.blank': '—',

  // ----------------------------------------------------------------- time
  //
  // Read by `relativeTime` in `theme.ts`, which is why they are keys rather
  // than literals in that file. Deliberately coarse — the exact second a
  // courier's telemetry landed is not information anybody acts on.
  'time.justNow': 'just now',
  'time.minutes': '{count}m ago',
  'time.hours': '{count}h ago',
  'time.days': '{count}d ago',

  // -------------------------------------------------------------- courier
  //
  // Placeholders rather than labels. `RiderState` starts with blank identity
  // fields and fills them from the telemetry the rider app pushes on a timer, so
  // a job can legitimately have a courier assigned before their name lands.
  'courier.unnamed': 'Your courier',
  'courier.vehiclePending': 'Vehicle details pending',

  // ---------------------------------------------------------------- status
  //
  // The dispatch vocabulary: the fifteen `JobStatus` values a courier moves
  // through, the eight `BookingStatus` stages the customer is shown, and the four
  // `PaymentStatus` values.
  //
  // These are safe to translate where the sentences the server composes are not,
  // and the difference is that these are closed sets. There are exactly fifteen,
  // eight and four of them, they are declared in `packages/core/src/types.ts`, and
  // the helpers in `./status.ts` build these key names out of the union types
  // themselves — so adding a stage in core fails this app's build until the stage
  // has a word here. A sentence the server writes has no such floor under it.
  //
  // The key names are the wire values verbatim, spaces and ampersand included.
  // `status.stage.Ironing & Folding` is ugly and unmistakable, and deriving the
  // key from the value is exactly what buys the exhaustiveness check. None of this
  // changes what travels on the wire: core's `humanizeStatus` is untouched, so the
  // desk console, the rider app and the database keep the one English vocabulary
  // they share.
  'status.job.unassigned': 'Unassigned',
  'status.job.assigned': 'Assigned',
  'status.job.navigating_to_pickup': 'Navigating to pickup',
  'status.job.arrived_at_pickup': 'Arrived at pickup',
  'status.job.pickup_scanned': 'Pickup scanned',
  'status.job.picked_up': 'Picked up',
  'status.job.navigating_to_laundry': 'Navigating to laundry',
  'status.job.arrived_at_laundry': 'Arrived at laundry',
  'status.job.dropped_off': 'Dropped off',
  'status.job.processing': 'Processing',
  'status.job.ready_for_delivery': 'Ready for delivery',
  'status.job.navigating_to_delivery': 'Navigating to delivery',
  'status.job.arrived_at_delivery': 'Arrived at delivery',
  'status.job.delivered': 'Delivered',
  'status.job.cancelled': 'Cancelled',

  // The seven stages of the progress bar, plus cancelled. Deliberately separate
  // keys from the job statuses that share an English word: `Delivered` the stage
  // and `delivered` the dispatch state are one event told at two grains, and a
  // language that wants to distinguish them should be free to.
  'status.stage.Scheduled': 'Scheduled',
  'status.stage.Collecting': 'Collecting',
  'status.stage.In Care': 'In Care',
  'status.stage.Ironing & Folding': 'Ironing & Folding',
  'status.stage.Quality Check': 'Quality Check',
  'status.stage.Delivering': 'Delivering',
  'status.stage.Delivered': 'Delivered',
  'status.stage.Cancelled': 'Cancelled',

  // What each stage means, in the voice the client portal already used. Moved here
  // out of `StageTimeline`, which held them in a `Record<BookingStatus, string>` —
  // the record is now the key name, and the set is still checked whole.
  'status.copy.Scheduled': 'Your appointment is registered. A courier will be assigned shortly.',
  'status.copy.Collecting': 'Your courier is collecting the bags and heading for the hub.',
  'status.copy.In Care':
    'Checked in at the hub. Sorting and botanical stain treatment under way.',
  'status.copy.Ironing & Folding': 'Hand-pressing and boutique folding in progress.',
  'status.copy.Quality Check': 'Thread and finish inspected and packed, waiting for a courier.',
  'status.copy.Delivering':
    'Your courier is on the way back to your door with the finished order.',
  'status.copy.Delivered': 'Delivered and signed for. Thank you for choosing FreshFold.',
  'status.copy.Cancelled': 'This order was cancelled. Nothing further will be collected.',

  // `Pay on Pickup` is the arrangement, not an instruction — it is what a receipt
  // row says about an order that will be settled at the door.
  'status.payment.Pending': 'Pending',
  'status.payment.Paid': 'Paid',
  'status.payment.Pay on Pickup': 'Pay on Pickup',
  'status.payment.Refunded': 'Refunded',

  // ------------------------------------------------------------------ home
  //
  // The chrome of the home screen only.
  //
  // What the tab shows out of `src/data/catalogue.ts` — the eleven services, the
  // four steps, the reasons, the segments, the testimonials — is **not** here and
  // is **not** translated anywhere. This comment used to say it was "translated
  // there by id", which was never true: that file holds plain English literals
  // and imports nothing from this layer. So a customer reading in Spanish gets a
  // Spanish app with English service names on it.
  //
  // 74 display strings across `catalogue.ts` and `packages/core/src/services.ts`
  // — service short names and descriptions, category labels, plan taglines and
  // benefits, testimonials. Translating them means routing each render site
  // through `t()` and adding the keys here, which is a piece of work in its own
  // right rather than something to fold into an unrelated change. The service
  // *names* stay English regardless: they are the wire value a booking stores in
  // `serviceType`, so only their display can move.
  'home.greeting.morning': 'Good morning',
  'home.greeting.afternoon': 'Good afternoon',
  'home.greeting.evening': 'Good evening',
  /**
   * The greeting with a name on the end.
   *
   * A separate key rather than string concatenation, because the comma is not
   * where every language puts it and some would rather lead with the name.
   */
  'home.greetingNamed': '{greeting}, {name}',

  'home.live.label': 'In progress',
  'home.live.courier': '{name} · {vehicle}',
  'home.live.assigning': 'Assigning a courier',
  'home.live.track': 'Track live',
  /** Two keys and the call site picks, per the note at the top of this file. */
  'home.live.moreOne': '+1 more order running',
  'home.live.moreMany': '+{count} more orders running',

  /** The company name, and so the same in every language. */
  'home.hero.eyebrow': 'FreshFold Laundry Co.',
  // The break is deliberate — the line lands on "collected from your door" — and
  // a translation should put it wherever its own sentence divides.
  'home.hero.title': 'Boutique fabric care,\ncollected from your door.',
  'home.hero.body':
    'Hand-finished washing, pressing and specialist treatment across Kumasi — booked in a minute, tracked to the doorstep.',
  'home.hero.plans': 'Plans',

  'home.quick.book': 'Book',
  'home.quick.track': 'Track',
  'home.quick.wallet': 'Wallet',
  /** The concierge assistant's name, and so untranslated. */
  'home.quick.foldie': 'Foldie',

  'home.services.title': 'Our services',
  'home.services.caption': 'Priced up front. No surprises at the door.',

  'home.steps.title': 'How it works',
  'home.steps.caption': 'Four steps, start to closet.',

  'home.why.title': 'Why FreshFold',
  'home.why.caption': 'What you get that a laundrette doesn’t.',

  'home.segments.title': 'Built for',
  'home.segments.caption': 'Tap one to start a booking shaped around it.',


  'home.contact.title': 'Talk to us',
  'home.contact.caption': 'A person, not a form.',
  'home.contact.phoneCaption': 'Call the concierge desk',
  'home.contact.foldie': 'Ask Foldie',
  'home.contact.foldieCaption': 'Our concierge assistant, in-app',
  'home.contact.emailCaption': 'For contracts and invoicing',
  'home.contact.addressCaption': 'Where your garments are cared for',
  'home.contact.hoursCaption': 'Collection windows run to close',

  'home.footer': 'FreshFold Laundry Co. · Ayeduase-Kotei, Kumasi\nEvery order priced before you confirm.',

  // ------------------------------------------------------------------ book
  //
  // The five-step booking flow. The service names, the time slots, the scents,
  // the starch levels, the add-ons and the payment methods are catalogue and core
  // records rather than loose strings, and none of them is translated — they read
  // in English in every language. What is here is the form around them.
  //
  // Three of this screen's labels are borrowed rather than duplicated: the
  // address and city fields reuse `address.*` because they are the same two
  // fields the address sheet shows, and the phone field reuses
  // `settings.details.phone*` for the same reason. The phone-length complaint is
  // `settings.details.phoneLength`, which is where the logic in
  // `packages/core/src/phone.ts` gets its wording.
  /**
   * The screen's own title, not the button that opens it.
   *
   * `common.schedulePickup` says the same words in English, and they are still
   * two keys: one is an instruction to the customer and one is the name of a
   * screen, and plenty of languages phrase those differently even when English
   * does not.
   */
  'book.title': 'Schedule a pickup',
  'book.stepOf': 'Step {current} of {total} · {name}',
  'book.step.service': 'Service',
  'book.step.schedule': 'Schedule',
  'book.step.address': 'Address',
  'book.step.finishing': 'Finishing',
  'book.step.payment': 'Payment',

  'book.service.prompt': 'What needs care?',
  'book.service.helper':
    'Tap to change. Every service is quoted before you confirm, and the courier is complimentary on all of them.',
  'book.picker.service': 'Choose a service',
  /**
   * The price advert on a service card: `From ₵30 / load`.
   *
   * Built here rather than by core's `priceLabel`, which is shared with the
   * English-only desk console and rider app. `{unit}` arrives already translated
   * from the `unit.*` block, so a Spanish card reads `Desde ₵30 / carga`.
   */
  'service.priceFrom': 'From {amount} / {unit}',
  'book.extra.add': '+ Add another service',
  'book.extra.change': 'Change service',
  'book.extra.remove': 'Remove this service',

  /**
   * How many of the service's unit.
   *
   * `{unit}` is a translated word from the `unit.*` block below, not the raw
   * English from `ServiceDefinition` — a Spanish reader asked "How many loads?"
   * with `loads` left in English is being asked half a question.
   *
   * Phrased so the unit can be any gender. English can say "How many X?" freely;
   * Spanish and French cannot agree `Cuántas`/`Combien` with a word they are
   * handed at runtime, so both use a `de`-construction instead. That is why this
   * is a whole sentence per language rather than a shared frame.
   */
  'book.quantity.title': 'How many {unit}?',
  'book.quantity.each': '{amount} per {unit}',
  /**
   * Screen-reader labels for the two stepper buttons.
   *
   * Deliberately without the unit in them. Both other languages would need to
   * agree an article with it — `una carga`, `un juego` — and a label that reads
   * "Increase quantity" is no worse to hear than one that names the unit.
   */
  'book.quantity.fewer': 'Decrease quantity',
  'book.quantity.more': 'Increase quantity',

  // ------------------------------------------------------------------ units
  //
  // What one of a service buys, as a word the customer reads. The ids are the
  // `unit` field on `ServiceDefinition` in `@freshfold/core`, which is dispatch
  // data and stays English; these are its translations.
  //
  // Two keys each rather than a plural rule, like every other counted phrase
  // here — see the note at the top of the file.
  'unit.load.one': 'load',
  'unit.load.many': 'loads',
  'unit.set.one': 'set',
  'unit.set.many': 'sets',
  'unit.ride.one': 'ride',
  'unit.ride.many': 'rides',
  'unit.space.one': 'space',
  'unit.space.many': 'spaces',
  'unit.unit.one': 'unit',
  'unit.unit.many': 'units',
  'unit.order.one': 'order',
  'unit.order.many': 'orders',

  'book.plan.coveredTitle': 'This pickup is included in your membership',
  'book.plan.title': 'Booked under your membership',
  'book.plan.coveredBody':
    'The laundry is already paid for — {left} of {total} pickups left this month. Add-ons are charged at your member rate, and the order is prioritised in dispatch.',
  'book.plan.rateBody':
    'Your included pickups are spent for this month, so this one is at your member rate. It is still prioritised in dispatch, and your allowance resets on {date}.',
  'book.plan.priorityBody': 'This order is prioritised in dispatch.',

  'book.date.title': 'Pickup date',
  'book.date.today': 'Today',
  /** Abbreviated to fit a 5-across row of date cells — so should a translation be. */
  'book.date.tomorrow': 'Tmrw',
  'book.date.field': 'Or type a date',
  /**
   * The shape of the date, not a date.
   *
   * The field is parsed as ISO whatever this says, so a translation renames the
   * letters — `AAAA-MM-JJ` in French — without reordering them.
   */
  'book.date.placeholder': 'YYYY-MM-DD',
  'book.date.hint': 'Delivery is scheduled for the following day.',
  // The return leg. Before this the customer chose the hour their clothes left
  // and had no say at all in the hour they came back — the return was the day
  // after, with no time on it.
  'book.return.title': 'Return window',
  'book.return.day': 'Back to you on {date}',
  'book.return.tooEarly': 'Too early — your laundry would not be back yet',

  // Promo codes. The first thing in the product aimed at somebody who is not a
  // customer yet — loyalty and membership both reward people already here.
  // Standing orders and referrals. The plans screen has always sold "weekly
  // pickups" and nothing ever scheduled one; `includedPickups` was subtracted in
  // a dozen places and never added to a calendar.
  'standing.title': 'Standing orders',
  'standing.subtitle': 'The weekly pickups your plan already pays for.',
  'standing.yours': 'Your standing orders',
  'standing.none': 'None yet. Set one up below and we will book it every week for you.',
  'standing.add': 'Add a weekly pickup',
  'standing.create': 'Create standing order',
  'standing.collectFrom': 'Collected from {address}.',
  'standing.needAddress': 'Save an address first — a standing order needs somewhere to collect from.',
  'standing.failed': 'That could not be saved. Try again.',
  'standing.paused': 'Paused',
  'standing.lastBooked': 'last booked for {date}',
  'standing.notYetBooked': 'not booked yet',
  'standing.remove.title': 'Stop this standing order?',
  'standing.remove.body': 'Bookings it has already made are unaffected. Nothing further will be booked.',
  'standing.signedOut.title': 'Sign in for standing orders',
  'standing.signedOut.body': 'Weekly pickups are tied to your account, so we know where to come and what to bring back.',
  'standing.referral.title': 'Invite a friend',
  'standing.referral.blurb': 'They get {welcome} off their first order. You get {reward} when it is delivered.',
  'standing.referral.count': '{invited} invited · {rewarded} rewarded',
  'standing.referral.pending': 'Your code will appear here in a moment.',
  'standing.referral.claimLabel': 'Got a code from a friend?',
  'standing.referral.claim': 'Use this code',
  'standing.referral.failed': 'That code could not be used.',

  'book.promo.title': 'Promo or referral code',
  'book.promo.placeholder': 'FRESHERS24',
  'book.promo.apply': 'Apply',
  'book.promo.checking': 'Checking…',
  'book.promo.applied': '{code} applied — {amount} off this order.',
  'book.promo.unreachable': 'Could not check that code. You can still book without it.',
  'book.summary.promo': 'Code {code}',
  'book.summary.taxIncluded': 'Includes tax',

  'book.window.title': 'Collection window',
  'book.window.full': 'Full — choose another window',
  'book.window.remaining': 'Only {count} left in this window',

  'book.address.saved': 'Use a saved address',
  'book.picker.addresses': 'Saved addresses',
  'book.address.hint':
    'Include the block and room — this is what the courier reads at the door.',
  'book.address.save': 'Save this address for next time',

  'book.pin.title': 'Where should the courier knock?',
  'book.pin.intro':
    'An address is a sentence; a courier needs a point. Drop the pin on your gate or hostel entrance — it is what their navigation follows and what confirms their arrival.',

  'book.contact.title': 'Who should the courier ask for?',
  'book.contact.name': 'Full name',
  'book.contact.namePlaceholder': 'Ama Mensah',
  'book.contact.emailPlaceholder': 'you@example.com',
  'book.contact.emailHint':
    'Optional — but it is how we link this order to an account later.',

  'book.scent.title': 'Scent',
  'book.scent.noSurcharge': 'No surcharge',
  'book.starch.title': 'Starch on ironed items',
  'book.finish.noneTitle': 'No finishing options here',
  'book.finish.noneBody':
    'Scent and starch apply to garments. {service} is quoted on the work itself — add a note below if there is anything specific.',
  'book.addons.title': 'Specialist add-ons',
  'book.instructions.label': 'Care instructions',
  'book.instructions.placeholder': 'The navy blazer has a coffee stain on the left cuff.',
  'book.riderNote.label': 'Note for the courier',
  'book.riderNote.placeholder': 'Call when you reach the gate — the buzzer is broken.',
  'book.riderNote.hint': 'Shown on the courier’s job card, not to the laundry team.',

  'book.summary.title': 'Summary',
  'book.summary.service': 'Service',
  'book.summary.pickup': 'Pickup',
  'book.summary.address': 'Address',
  'book.summary.pin': 'Pickup pin',
  'book.summary.pinUnset': 'Not set',
  'book.summary.finish': 'Finish',
  'book.summary.finishValue': '{scent}, {starch} starch',
  'book.summary.addons': 'Add-ons',
  'book.summary.subtotal': 'Subtotal',
  /** Named when the plan is known, generic when the id no longer matches one. */
  'book.summary.planIncluded': '{plan} — pickup included',
  'book.summary.planFallback': 'Membership',
  'book.summary.memberRate': 'Member rate',
  'book.summary.tierDiscount': '{tier} discount',
  'book.summary.total': 'Total',
  /** A figure being taken off rather than added on. The dash is a minus sign, U+2212. */
  'book.summary.less': '− {amount}',

  'book.pay.title': 'How would you like to pay?',
  'book.pay.walletBalance': 'Balance {amount}',
  'book.pay.walletShort': 'Balance {amount} — not enough',
  'book.pay.paystackTitle': 'Paystack secure checkout',
  'book.pay.paystackBody':
    'Opens Paystack in a browser. Nothing about your card is entered in this app or stored by FreshFold.',
  'book.pay.open': 'Open checkout',
  'book.pay.reopen': 'Reopen checkout',
  'book.pay.verify': 'I have paid — verify',
  'book.pay.doorTitle': 'Settle at the door',
  'book.pay.doorBody':
    'The courier carries a card reader and accepts mobile money. Your order is confirmed either way.',
  /**
   * The gateway's own words, passed through.
   *
   * Paystack and the server answer in English and this app does not translate
   * their sentences — but the frame around them is ours, so a customer reading
   * in French is at least told what the English is about.
   */
  'book.pay.gateway': 'Payment gateway: {message}',
  'book.pay.gatewayUnreachable':
    'Could not reach the payment gateway. Check your connection, or choose Pay on Pickup.',
  'book.pay.finishOnPage': 'Finish on the Paystack page, then tap “I have paid” to verify.',
  'book.pay.browserFailed':
    'Could not open the checkout page here. Reference {reference} is live — open Paystack, pay, then tap “I have paid”.',
  'book.pay.confirmed': 'Payment confirmed.',
  'book.pay.pending': 'Paystack says: {status}. Complete the checkout and retry.',
  /** Stands in when the gateway answers without naming a state. */
  'book.pay.pendingStatus': 'pending',
  'book.pay.verifyUnreachable':
    'Could not reach FreshFold to confirm the payment. If you were charged, your funds are safe — tap “I have paid” again in a moment.',
  'book.pay.bookedThen': 'Pickup booked. {message}',
  'book.pay.bookedUnsettled':
    'Pickup booked, but we could not take the payment. Settle it from your wallet.',

  'book.error.date': 'Choose a pickup date.',
  'book.error.address': 'We need an address to collect from.',
  'book.error.pin': 'Set the pickup pin so the courier knows where to knock.',
  'book.error.name': 'Tell us who to ask for at the door.',
  'book.error.phone': 'A phone number lets the courier reach you.',
  'book.error.paystackEmail':
    'Add your email address to pay online — Paystack sends the receipt there.',
  'book.error.walletSignIn': 'Sign in to pay from your FreshFold wallet.',
  'book.error.walletShort': 'Your wallet holds {amount}. Choose another method or top up.',
  'book.error.save': 'Could not save that booking. It is queued and will send when you reconnect.',

  'book.quote.due': 'Total due',
  'book.quote.running': 'Running quote',
  'book.quote.before': '{amount} before your {reason}',
  'book.quote.reasonIncluded': 'included pickup',
  'book.quote.reasonBoth': 'member and tier rates',
  'book.quote.reasonMember': 'member rate',
  'book.quote.reasonTier': 'tier discount',
  'book.continue': 'Continue',
  'book.confirm': 'Confirm booking',

  'book.done.title': 'Booked',
  /**
   * One sentence in two keys, because the reference between them is bold.
   *
   * The split assumes the reference comes after the word for "reference", which
   * holds for all three languages here. A language that puts it elsewhere needs a
   * third arrangement, not a translation of these two.
   */
  'book.done.bodyBefore': 'Reference',
  'book.done.bodyAfter':
    'is on the dispatch board. A courier will accept it shortly and you can follow them from the Track tab.',
  'book.done.collection': 'Collection',
  'book.done.return': 'Return',
  'book.done.paid': 'Paid',
  'book.done.another': 'Book another',
  'book.done.track': 'Track it',

  // ----------------------------------------------------------------- track
  //
  // The tracking tab. What it says about *where the order is* is not here — that
  // vocabulary is the `status.*` block above, shared with every other screen that
  // shows a stage. This is the chrome around it.
  //
  // Six of the summary rows borrow their labels from the booking flow rather than
  // saying the same word twice: `book.summary.service`, `book.summary.address`,
  // `book.summary.total`, `book.done.collection` and `book.done.return` label the
  // same fields there that they label here. Only `track.row.payment` is new,
  // because the booking flow never puts a "Payment" label on a row.
  'track.title': 'Track',

  'track.empty.title': 'Nothing in flight',
  'track.empty.body':
    'Once you book a pickup, the courier’s progress shows up here in real time.',

  // Deliberately not shared with `home.live.assigning`, which says the same three
  // words. There it is a caption inside a compact pill; here it is the headline of
  // a card with a paragraph under it. A language that wants a short form for one
  // and a full phrase for the other should not have to pick.
  'track.pending.title': 'Assigning a courier',
  'track.pending.body':
    'Your booking is on the dispatch board. As soon as a courier accepts it, their position and contact appear here.',

  'track.section.door': 'At the door',
  'track.section.order': 'This order',

  'track.action.scan': 'Verify bags',
  'track.action.scanCaption': 'Scan the manifest yourself',
  'track.action.issue': 'Report an issue',
  'track.action.issueCaption': 'Photograph a garment',
  'track.action.chat': 'Conversation',
  'track.action.chatCaption': 'Message dispatch',
  // Two keys and the call site picks, which is how counted phrases are done
  // throughout this dictionary. See the note at the top of the file.
  'track.action.chatOne': '1 message',
  'track.action.chatMany': '{count} messages',
  'track.action.full': 'Full order',
  'track.action.fullCaption': 'Manifest, proof, receipt',

  'track.row.payment': 'Payment',
  /** The status and the method, which is the server's own word for it. */
  'track.row.paymentValue': '{status} · {method}',
  'track.row.collectionValue': '{date} · {time}',
  'track.open': 'Open full order',

  /** Screen-reader labels for the two round buttons on the courier card. */
  'track.call': 'Call the courier',
  'track.message': 'Message the courier',

  /**
   * The live sub-line under the progress bar. The status is interpolated rather
   * than lower-cased into the sentence — the English original called
   * `.toLowerCase()` on it, which is fine for English and wrong for any language
   * whose casing carries meaning.
   */
  'track.dispatch': 'Dispatch: {status}',

  // --------------------------------------------------------------- handoff
  //
  // The collection code, shown on this tab and on the order screen. The four
  // digits and the QR payload are not strings in any language.
  'handoff.label': 'Collection code',
  'handoff.atDoor': 'Your courier is at the door',
  'handoff.waiting': 'Show this when the courier arrives',
  'handoff.body':
    'Your courier will scan the code or ask for the four digits. Don’t hand over the bags to anyone who cannot check it.',
  'handoff.hide': 'Hide',
  'handoff.hideLabel': 'Hide the collection code',
  'handoff.show': 'Show the QR and code again',
  'handoff.showLabel': 'Show the collection code',
  'handoff.tied': 'The code is tied to order {id} and works only for this collection.',

  // ------------------------------------------------------------------- map
  //
  // The live map and the readout that stands in for it — on web, where
  // `react-native-maps` has no implementation, and on a device where the native
  // view fails to mount. The hub's name is core data and stays as it is.
  //
  // The courier line borrows `home.live.courier`: it is the same name-and-vehicle
  // pair, formatted the same way, in both places.
  'map.home': 'Your address',
  'map.recenter': 'Recenter the map on your courier',
  /** The routing engine's estimate. Absent for the straight-line fallback. */
  'map.eta': '{minutes} min away',
  'map.noPin': 'This booking has no pickup pin yet.',
  /** {message} is the native view's own error, which arrives in English. */
  'map.failed':
    'The map could not be loaded on this device ({message}). Positions are still live below.',
  'map.readout': 'Position readout',
  'map.webNotice': 'Live tiles render on iOS and Android. Open the app on a phone for the map.',
  'map.expoNotice':
    'Live tiles render on iOS and Android. Open the app in Expo Go to see the map.',
  'map.hubDetail': 'Where your garments are cared for',
  'map.noPinYet': 'No pin yet',

  // ----------------------------------------------------------------- order
  //
  // One order, in full — the screen behind every "open the order" tap.
  //
  // Less of it is here than the screen's length suggests, because it renders
  // `StageTimeline`, `TrackingMap` and `HandoffCard`: the stage words, the map
  // readout and the collection code are already keyed above. What is left is this
  // screen's own copy.
  //
  // Nine of its rows and three of its action labels borrow keys the booking flow
  // and the track tab already have. They are the same field and the same control
  // said in two places, which is the test — `Service` labels the service on both
  // screens, and the control that opens the issue reporter is one control.
  //
  // What is deliberately *not* borrowed: `order.receipt.collected` says the same
  // word as `order.proof.pickupPhoto`. One is a row label in a receipt, the other
  // a caption under a photograph, and a language that wants a noun for one and a
  // participle for the other should not have to choose.
  //
  // Bag types, QR codes, the plan id and the add-on names are dispatch and
  // catalogue data. They are not copy and are rendered as they arrive.
  'order.title': 'Order',
  'order.missing.title': 'Order not found',
  'order.missing.body':
    'This reference is not in your history. If you booked it on the website, sign in with the same email to see it here.',

  // The cancel confirmation. An OS alert rather than one of the app's sheets, so
  // the two button labels are its own and not the kit's.
  // Moving a booking rather than losing it. Cancel-and-rebook was the only way
  // before, and it cost the customer their reference, their hand-off codes and
  // a trip through the refund flow for anything already paid.
  // What became of a problem they reported. Before claims existed the report
  // went into the courier thread and stopped, so a customer who photographed a
  // ruined shirt had no way of knowing whether anybody had looked at it.
  'order.claims.title': 'Problems you reported',
  'order.claims.status.open': 'Reported',
  'order.claims.status.investigating': 'Being looked into',
  'order.claims.status.upheld': 'Upheld — we owe you',
  'order.claims.status.rejected': 'Not upheld',
  'order.claims.status.resolved': 'Settled',
  'order.claims.credited': '{amount} credited to your wallet.',
  'order.claims.retreatment': 'We will re-treat this at our cost.',

  'order.reschedule.action': 'Move this pickup',
  'order.reschedule.title': 'Move this pickup',
  'order.reschedule.date': 'New collection date',
  'order.reschedule.confirm': 'Move pickup',
  'order.reschedule.movesLeft': 'You can move this booking {count} more times.',
  'order.reschedule.lastMove':
    'This is the last time this booking can be moved. After that, cancel and rebook.',
  'order.reschedule.failed': 'That could not be moved just now. Try again.',

  'order.cancel.action': 'Cancel this order',
  'order.cancel.title': 'Cancel this order?',
  'order.cancel.body':
    'The courier will be stood down. Anything already paid is refunded to your wallet by the concierge desk.',
  'order.cancel.keep': 'Keep it',
  'order.cancel.confirm': 'Cancel order',
  // Only reached when the server refuses without a sentence of its own —
  // normally it sends one, and it knows more than this does.
  'order.cancel.failed': 'That could not be cancelled just now. Try again.',

  'order.section.actions': 'Things you can do',
  'order.section.manifest': 'Bag manifest',
  'order.section.details': 'Details',
  'order.section.proof': 'Proof of service',

  'order.sign.title': 'Sign for delivery',
  /**
   * The code is readable on purpose. It was masked to `••••` at first, which left
   * the one person who is supposed to hold it unable to see it.
   */
  'order.sign.captionCode': 'Your courier is at the door. Read them code {code}.',
  'order.sign.caption': 'Your courier is at the door.',

  'order.scan.title': 'Verify the bag manifest',
  'order.scan.checked': '{count} of {total} checked by you',
  'order.scan.bagsOne': '1 bag on this order',
  'order.scan.bagsMany': '{count} bags on this order',

  'order.issue.caption': 'Photograph a garment and tell us what happened',
  'order.chat.caption': 'Message the courier or dispatch',

  'order.call.title': 'Call the concierge desk',
  /**
   * The desk, not the courier: couriers ride on their own handsets and their
   * numbers are not the customer's to have. The caption names the courier so it is
   * clear which job the call is about — and it is a different sentence from
   * `home.live.courier`, which is the pair on its own.
   */
  'order.call.caption': 'About {name} · {vehicle}',

  'order.manifest.verified': '{count}/{total} verified by you',
  'order.bag.meta': '{code} · {items} items · {weight}',
  'order.bag.metaNoWeight': '{code} · {items} items',
  // Before the hub has counted it. Says what is true rather than printing a
  // number derived from the booking reference, which is what used to be here.
  'order.bag.uncounted': '{code} · counted when it reaches the hub',

  'order.row.booked': 'Booked',
  'order.row.plan': 'Plan',
  'order.row.quantity': 'Quantity',
  'order.row.care': 'Care notes',
  'order.row.courierNote': 'Courier note',
  'order.row.courier': 'Courier',
  /** Name and dispatch state. Not `home.live.courier`, which pairs name with vehicle. */
  'order.row.courierValue': '{name} · {status}',

  'order.proof.pickupPhoto': 'Collected',
  'order.proof.pickupSignature': 'Signed at pickup',
  'order.proof.deliveryPhoto': 'Delivered',
  'order.proof.deliverySignature': 'Signed on delivery',
  /** Stands in when the pad could not rasterise and the raw path was saved. */
  'order.proof.vector': 'Signature on file',

  'order.receipt.open': 'View receipt',
  'order.receipt.collected': 'Collected',
  'order.receipt.returned': 'Returned',
  'order.receipt.method': 'Method',
  'order.receipt.status': 'Status',
  'order.receipt.reference': 'Reference',

  'order.again': 'Book this again',
  'order.rate.title': 'How did it go?',
  'order.rate.prompt': 'Rate {name} — it only takes a tap, and the desk reads every one.',
  'order.rate.thanks': 'Thank you. Your rating is with the desk.',
  /** Screen-reader label on each star. */
  'order.rate.star': '{count} out of 5',

  // --------------------------------------------------------------- scanner
  //
  // The customer's own pass over their bag manifest. The bag types, codes and
  // weights are printed on the bags and arrive as dispatch data; the frame around
  // them is here.
  //
  // The status line under the viewfinder is seven sentences rather than one with a
  // slot, because they say different things — a code checked off, a code that
  // belongs to somebody else's order, a camera that was refused. Each is its own
  // key so each can be its own sentence.
  'scanner.title': 'Check your bags',
  'scanner.mode.checklist': 'Checklist',
  'scanner.mode.camera': 'Scan with camera',

  'scanner.hint.initial': 'Hold a bag label inside the frame, or tick them off by hand.',
  'scanner.hint.checked': 'Checked {code}.',
  'scanner.hint.all': 'All bags accounted for.',
  'scanner.hint.verified': 'Verified {code} — {type}.',
  /** A code that scanned cleanly but belongs to a different order. */
  'scanner.hint.foreign': '“{code}” is not part of {reference}.',
  'scanner.hint.declined': 'Camera access declined — tick the bags off by hand instead.',
  'scanner.hint.live': 'Camera live. Align a FreshFold bag label within the frame.',

  'scanner.empty.title': 'Every bag carries a printed code',
  'scanner.empty.body':
    'Scan them as they leave, or as they come back, and keep your own count.',

  'scanner.manifest': 'Manifest ({count}/{total})',
  'scanner.tickAll': 'Tick all',
  /** No weight in this one — the weight has its own badge on the row. */
  'scanner.bag.meta': '{code} · {items} items',
  /** The badge on a row already done. `scanner.hint.checked` is the sentence. */
  'scanner.checked': 'Checked',
  'scanner.tick': 'Tick',
  'scanner.confirmNone': 'Check a bag first',
  'scanner.confirmOne': 'Confirm 1 bag',
  'scanner.confirmMany': 'Confirm {count} bags',

  // ----------------------------------------------------------------- issue
  //
  // Reporting a problem with a garment.
  //
  // The five reasons are copy *and* payload: tapping one writes it into the note
  // that goes onto the job record and into the courier's thread. Translating them
  // means the desk can be handed a report in Spanish — which is already true of the
  // field below them, where a customer types in whatever language they think in,
  // and the desk is in Accra. A canned reason that stayed English would be the odd
  // one out.
  'issue.title': 'Report an issue',
  'issue.subtitle': 'Anything not right gets re-treated at our cost — tell us what happened.',

  'issue.reason.stain': 'A garment came back with a stain still on it',
  'issue.reason.missing': 'Something is missing from the bag',
  'issue.reason.damaged': 'A garment was damaged',
  'issue.reason.finish': 'The finish is not what I asked for',
  'issue.reason.late': 'The order arrived late',

  'issue.field': 'What happened?',
  'issue.placeholder':
    'The navy blazer has a mark on the left cuff that was there when it came back.',

  'issue.camera.take': 'Take photo',
  'issue.camera.title': 'Add a photo',
  'issue.camera.body': 'A picture settles most of these in one message — optional, but it helps.',
  'issue.camera.enable': 'Enable camera',
  'issue.camera.empty': 'The camera returned nothing. Try again.',
  'issue.camera.unavailable':
    'The camera is unavailable. You can still send the report without a photo.',

  'issue.retake': 'Retake',
  'issue.send': 'Send report',
  'issue.assurance':
    'Your report goes to the concierge desk and the courier on this job, in the same thread.',

  // ------------------------------------------------------------------ sign
  //
  // Signing for a delivery. The code is shown rather than asked for: it belongs to
  // the customer, and typing it back to themselves would prove nothing.
  'sign.title': 'Sign for your delivery',
  'sign.subtitle': 'Check everything is present, then sign below.',
  'sign.subtitleOne': 'Check the bag is present, then sign below.',
  'sign.subtitleMany': 'Check all {count} bags are present, then sign below.',
  /**
   * Stands in for the customer's name under the signature line, and reads as part
   * of the sentence there rather than as a label — lower case on purpose.
   */
  'sign.you': 'you',

  'sign.code.label': 'Read this to your courier',
  'sign.code.hint':
    'Only give it once your laundry is actually in your hands. Signing below sends it for you.',
  'sign.noCode':
    'This order has no delivery code on it, so it cannot be signed for here. The concierge desk can complete it.',
  'sign.refused': 'Dispatch would not accept that. Ask the courier to try from their console.',

  /** The `X` is where the mark goes and stays put in every language. */
  'sign.here': 'X SIGN HERE',
  'sign.notice':
    'Signing confirms the garment count matches and closes the order. Anything wrong after this can still be reported from the order screen.',
  'sign.clear': 'Clear',
  'sign.confirm': 'Confirm delivery',
  'sign.later': 'Not yet',

  // ---------------------------------------------------------------- wallet
  //
  // The wallet tab: the balance, the loyalty tier, the subscription and the
  // statement. The tier names and their benefits, the rewards and the plans are
  // catalogue and core records rather than loose strings, and are not translated
  // — as are the words the server writes into a transaction's description, method
  // and status, which arrive on the wire in English.
  //
  // Two of this screen's strings are borrowed from the booking flow rather than
  // written again: `book.pay.gateway` frames a message Paystack wrote, and
  // `book.pay.reopen` labels the button that reopens a checkout. Both are the
  // same element doing the same job in both places.
  'wallet.title': 'Wallet',
  'wallet.locked.title': 'Sign in to use your wallet',
  'wallet.locked.body':
    'Your balance, loyalty points and membership are tied to your account, so they follow you to any device you sign in from.',

  'wallet.balance.label': 'Available balance',
  'wallet.balance.hint': 'Settles a booking instantly and earns a loyalty point per cedi.',
  'wallet.balance.topUp': 'Top up',
  'wallet.balance.book': 'Book with it',

  'wallet.tier.title': 'Membership',
  'wallet.tier.caption': 'Earned on everything you spend.',
  'wallet.tier.lifetime': 'lifetime points',
  'wallet.tier.toNext': '{points} points to {tier}',
  'wallet.tier.top': 'Top tier — every benefit unlocked.',
  'wallet.tier.benefits': 'Your benefits',
  'wallet.tier.discount':
    '{percent}% is taken off every quote before you confirm it — you never have to claim it.',

  'wallet.rewards.title': 'Spend your points',
  /** Read aloud by a screen reader; the visible label is the cost alone. */
  'wallet.rewards.redeem': 'Redeem {name} for {cost} care points',
  'wallet.rewards.cost': '{points} pts',
  'wallet.rewards.doneTitle': 'Redeemed',
  'wallet.rewards.doneBody': 'Your reward is on your account.',
  'wallet.rewards.failed': 'Could not redeem',

  'wallet.plan.title': 'Subscription',
  'wallet.plan.activeCaption': 'Active plan',
  'wallet.plan.caption': 'Regular laundry, one monthly price.',
  'wallet.plan.compare': 'Compare plans',
  /** `{when}` is one of the two keys below. */
  'wallet.plan.meta': '{left} of {total} pickups left · {when}',
  'wallet.plan.ends': 'ends {date}',
  'wallet.plan.renews': 'renews {date}',
  'wallet.plan.cancelled':
    'Cancelled. Your pickups and elite priority run until {date} — nothing more will be taken.',
  'wallet.plan.change': 'Change plan',
  /** The card's button and the confirmation dialog's safe answer, one key. */
  'wallet.plan.keep': 'Keep plan',
  /**
   * Short for cancelling the membership, on a button beside "Change plan" —
   * deliberately not `common.cancel`, which dismisses a sheet. A language that
   * cannot say both with one word should keep these two apart.
   */
  'wallet.plan.cancel': 'Cancel',
  'wallet.plan.cancelTitle': 'Cancel membership?',
  'wallet.plan.cancelBody':
    'Your plan stays active until {date} — included pickups and elite priority included — and nothing is taken after that. You can restart it any time.',
  'wallet.plan.cancelConfirm': 'Cancel membership',
  'wallet.plan.cancelFailedTitle': 'Could not cancel',
  'wallet.plan.cancelFailedBody':
    'FreshFold could not be reached. Your plan is unchanged — try again in a moment.',
  'wallet.plan.resumeFailedTitle': 'Could not restore',
  'wallet.plan.resumeFailedBody':
    'FreshFold could not be reached. Your plan still ends as scheduled — try again in a moment.',
  'wallet.plan.none': 'No active plan',
  'wallet.plan.from': 'From {price} a month, pickups included.',
  'wallet.plan.explore': 'Explore plans',

  'wallet.statement.title': 'Statement',
  'wallet.statement.caption': 'Every movement on this account.',
  'wallet.statement.emptyTitle': 'Nothing yet',
  'wallet.statement.emptyBody':
    'Top-ups, bookings and refunds all show up here with their reference.',

  'wallet.topUp.title': 'Top up your wallet',
  'wallet.topUp.body':
    'Paid through Paystack — MTN MoMo, Telecel Cash, AT Money, Visa or Mastercard. Funds land the moment the payment settles.',
  'wallet.topUp.after': 'Balance after payment',
  'wallet.topUp.pay': 'Pay {amount} with Paystack',
  'wallet.topUp.collect': 'I have paid — collect funds',
  'wallet.topUp.finishOnPage':
    'Finish on the Paystack page, then tap “I have paid” to collect the funds.',
  'wallet.topUp.browserFailed':
    'Could not open the checkout page here. Reference {reference} is live — pay on Paystack, then tap “I have paid”.',
  'wallet.topUp.confirmFailed':
    'Could not confirm the payment with FreshFold at {url}. If you were charged, your funds are safe — tap “I have paid” again once the server is reachable.',
  /**
   * The three ways a top-up can fail before Paystack has the payment, told
   * apart. `{url}` is the dispatch server's address — on a phone that is a LAN
   * address, and being wrong about it is the usual cause, so it is named rather
   * than described.
   */
  'wallet.gateway.unreachable':
    'Paystack was not contacted — the app cannot reach FreshFold at {url}. Check that the dispatch server is running and that this device is on the same network as it.',
  'wallet.gateway.timeout': 'FreshFold did not answer in time. Nothing was charged — try again.',
  'wallet.gateway.offline':
    'Could not reach FreshFold at {url}. Check that the dispatch server is running and that this device can see it.',

  // ------------------------------------------------------------- settings
  'settings.title': 'Settings',

  'settings.details.title': 'Your details',
  'settings.details.caption': 'What the courier and the desk see.',
  'settings.details.name': 'Name',
  'settings.details.namePlaceholder': 'Your name',
  'settings.details.phone': 'Phone',
  'settings.details.phonePlaceholder': '{digits} digits — e.g. 0550001234',
  'settings.details.phoneLength': 'A phone number is {digits} digits, e.g. 0244000000.',
  'settings.details.email': 'Email',
  'settings.details.emailHint': 'Your email is your account. The desk can move it — the app cannot.',
  'settings.details.nameBlank': 'Your name cannot be blank — the courier asks for it at the door.',
  'settings.details.save': 'Save changes',
  'settings.details.saved': 'Saved.',
  'settings.details.savedNewPhone':
    'Saved. Couriers will call the new number — and any pickup you booked as a guest on the old one will stop showing in your history.',
  'settings.details.failed':
    'Could not reach FreshFold, so nothing was changed. Check your connection and try again.',

  'settings.guestCard.title': 'Sign in to change your details',
  'settings.guestCard.body':
    'Your name, number and password live on the account, and so do your saved addresses — sign in and the ones below move with you, to the website and to any phone you use. The alert settings belong to this phone.',

  'settings.security.title': 'Security',
  'settings.security.biometric': 'Lock the app',
  'settings.security.biometricOn':
    'Ask for Face ID or your fingerprint when FreshFold opens, and again after it has been in the background a minute.',
  'settings.security.biometricOff': 'No biometric enrolled on this device.',
  'settings.security.reset': 'Email me a password reset link',
  'settings.security.resetCaption': 'The link sets a new password. It is good for one hour.',
  'settings.security.resetSent': 'A reset link is on its way to {email}. It is good for one hour.',
  'settings.security.assurance':
    'Your password is compared on our servers and never stored on this device — only a session token is, and signing out revokes it.',

  'settings.addresses.title': 'Pickup addresses',
  'settings.addresses.caption': 'Tap one to make it the default the booking form fills in.',

  'settings.alerts.title': 'Alerts',
  'settings.alerts.caption': 'In-app only — FreshFold does not send push notifications.',
  'settings.alerts.order': 'Order updates',
  'settings.alerts.orderCaption': 'Collected, in the wash, on the way back.',
  'settings.alerts.message': 'Messages',
  'settings.alerts.messageCaption': 'Replies from your courier and from the desk.',
  'settings.alerts.alert': 'Service alerts',
  'settings.alerts.alertCaption': 'Delays, weather, anything that moves a pickup.',
  'settings.alerts.assurance':
    'Switching one off hides it from the bell and stops it counting — it does not delete anything, and turning it back on brings the history with it. Notices from the desk about the service itself always come through.',

  'settings.language.title': 'Language',
  'settings.language.caption': 'The app reads in this language. Your orders are unaffected.',
  'settings.language.system': 'Follow this phone',
  'settings.language.systemCaption': 'Currently {language}.',
  /** Sits on any language the dictionary does not yet fully cover. */
  'settings.language.partial': 'Draft',
  /**
   * Said on the screen, not only in a commit message. Both translations are
   * complete but neither has been read by a native speaker, and a customer who
   * finds an awkward sentence should know that before they report the app as
   * broken rather than as rough.
   *
   * Worded with `{language}` rather than naming them, so it stays true as
   * dictionaries are reviewed and needs no edit when one of them is signed off.
   *
   * Only shown when `coverage()` is under 1, so a finished-and-reviewed language
   * simply stops showing it once its keys are all present.
   */
  'settings.language.draft':
    '{language} is still being worked on: parts of the app still read in English, and the rest is a first draft a native speaker has yet to go over. Tell us what reads wrong and we will fix it.',

  'settings.about.title': 'About',
  'settings.about.caption': 'A person answers the phone.',
  'settings.about.version': 'App version',
  'settings.about.server': 'Dispatch server',
  'settings.about.hours': 'Opening hours',
  'settings.about.call': 'Call the desk',
  'settings.about.email': 'Contracts and invoicing',

  'settings.danger.title': 'Danger zone',
  'settings.danger.body':
    'Closing your account signs you out everywhere and cannot be undone. Your orders stop being readable here, and a new account on the same email starts empty.',
  'settings.danger.action': 'Delete my account',
  'settings.danger.confirmTitle': 'Delete your account?',
  'settings.danger.confirmBody':
    'This closes {email} for good. Your order history, saved addresses and messages come off this phone, and signing up again on the same email will not bring them back. The desk keeps its own record of work already done, so ask us if you need a receipt for a past pickup.',
  'settings.danger.yourAccount': 'your account',
  'settings.danger.wallet':
    'Your wallet still holds {amount}. It is not refunded — closing the account forfeits it. Spend it on a pickup first if you would rather not.',
  'settings.danger.planNamed':
    'Your membership ({plan}) ends immediately, and the rest of the period you have paid for goes with it.',
  'settings.danger.plan':
    'Your membership ends immediately, and the rest of the period you have paid for goes with it.',
  'settings.danger.typeToConfirm': 'Type {word} to confirm',
  /**
   * The word the customer types, and the word the code compares against. One
   * key, so a translated prompt cannot ask for a word the check will refuse —
   * and left as `DELETE` in every language for the same reason a keyboard
   * shortcut is not translated.
   */
  'settings.danger.confirmWord': 'DELETE',
  'settings.danger.keep': 'Keep my account',
  'settings.danger.deleting': 'Deleting…',
  'settings.danger.delete': 'Delete for good',
  'settings.danger.failed':
    'Could not reach FreshFold, so nothing was deleted. Check your connection and try again.',

  // --------------------------------------------------------------- account
  //
  // The account tab. A dashboard, so most of this is labels; the things that
  // change an account are on the settings screen above.
  'account.title': 'Account',
  'account.notifications': 'Notifications',
  'account.settingsCaption': 'Your details, security, addresses, alerts',

  'account.verify.title': 'Confirm your email',
  'account.verify.body': 'We sent a link to {email}. Confirm it to start booking pickups.',
  'account.verify.resend': 'Resend link',
  'account.verify.sent': 'Sent. Check your inbox — and your spam folder.',
  'account.verify.failed': 'Could not send the link. Try again shortly.',

  /** The name the initials avatar is built from when nobody is signed in. */
  'account.guestName': 'Guest',
  'account.guestBody':
    'Bookings work without an account — an account is what keeps them, along with your wallet and loyalty tier.',

  'account.stats.orders': 'Orders',
  'account.stats.points': 'Points',
  'account.stats.wallet': 'Wallet',
  'account.stats.spent': 'Spent',

  'account.orders.title': 'Recent orders',
  /**
   * Two counts in one line. Both numbers are always present, so this stays a
   * single key rather than splitting on whether either is zero.
   */
  'account.orders.caption': '{active} active · {past} completed',
  'account.orders.seeAll': 'See all',
  'account.orders.emptyTitle': 'No orders yet',
  'account.orders.emptyBody': 'Your first pickup is a minute away.',

  'account.addresses.title': 'Saved addresses',
  'account.addresses.caption': 'Pre-fills the booking form. Pick which one in Settings.',

  'account.help.title': 'Help',
  'account.help.caption': 'A person, not a form.',
  'account.help.foldie': 'Ask Foldie',
  'account.help.foldieCaption': 'Concierge assistant, in-app',
  'account.help.rate': 'Rate FreshFold',
  'account.help.rateCaption': 'Tell us how we are doing',
  /** Subject line of the feedback mail, so it arrives readable at the desk. */
  'account.help.feedbackSubject': 'Feedback on FreshFold',

  'account.signOut': 'Sign out',
  'account.signOutTitle': 'Sign out?',
  'account.signOutBody': 'Your orders stay on the account and come back when you sign in.',
  'account.stay': 'Stay signed in',
  'account.build': 'FreshFold client {version} · dispatch at {server}',

  // ------------------------------------------------------- address lists
  //
  // Shared by the two screens that list saved addresses — the account tab and
  // the settings screen. Only their section headings differ, and those live in
  // each screen's own block; the row itself reads the same in both places and
  // should not be written twice.
  'addresses.empty': 'Add your first address',
  'addresses.edit': 'Edit {label}',
  'addresses.remove': 'Remove {label}',
  'addresses.confirmRemove': 'Remove this address?',
  // The ceiling is `MAX_SAVED_ADDRESSES` in @freshfold/core, passed in as
  // `{max}` rather than written out here: the server refuses a book longer than
  // that, and a number typed into three dictionaries is a number that will
  // disagree with it one day.
  'addresses.full': 'Saved addresses are limited to {max}. Remove one to add another.',

  // -------------------------------------------------------- address sheet
  'address.add': 'Add an address',
  'address.edit': 'Edit address',
  'address.label': 'Label',
  'address.labelPlaceholder': 'Home, hostel, office…',
  'address.address': 'Address',
  'address.addressPlaceholder': 'Evandy Hostel, Block B, Room 304',
  'address.city': 'City',
  'address.cityPlaceholder': 'Kumasi',
  'address.pinKept':
    'The pin you placed for this address is kept. Editing the text does not move it.',
  'address.pinPlaced':
    'Picked from the list, so this address carries that place’s pin — type the block and room after it.',
  'address.pinDerived':
    'The courier navigates to a pin derived from this text — the more specific, the closer they land.',
  // Only asked when there is no pin and the text matches no landmark we know.
  // Something has to name the zone: the shared address rules drop an entry
  // without one, so the alternative is a form that closes on a saved address
  // that was never saved.
  'address.zone': 'Collection zone',
  'address.zoneHint':
    'We cannot tell where this is from the text alone. Pick the zone we should collect from, or choose the place from the list above.',
  'address.error.address': 'Type the address the courier should knock at.',
  'address.error.zone': 'Pick a collection zone so we know where to send the courier.',
  'address.save': 'Save address',
  'address.saveChanges': 'Save changes',
  /** Used when the customer saved an address without naming it. */
  'address.fallbackLabel': 'Pickup address',

  // ------------------------------------------------------------- app lock
  'lock.title': 'FreshFold is locked',
  'lock.body':
    'Your orders, wallet and saved addresses are behind the biometric lock you turned on in settings.',
  'lock.unlock': 'Unlock',
  'lock.retry': 'Try again',
  // The two strings inside the system sheet. iOS shows the fallback as a button
  // that asks for the phone's own passcode, which is the device's passcode and
  // not the FreshFold password — the wording has to say which.
  'lock.prompt': 'Unlock FreshFold',
  'lock.fallback': 'Use device passcode',
  'lock.failed': 'That did not match.',
  // Said only once the sensor has actually answered — see `biometricChecked`.
  // Signing out is the only honest way past a lock whose key has gone missing:
  // nothing on the device can prove who is holding it any more.
  'lock.unavailable':
    'This phone has no biometric enrolled any more, so the lock cannot be opened here. Signing out keeps FreshFold usable, and your orders stay on your account.',
  'lock.signOut': 'Sign out instead',
} as const;

/**
 * Every key the app may ask for.
 *
 * Derived from the English dictionary rather than written out, so adding a
 * string is one edit and using one that does not exist does not compile.
 */
export type TranslationKey = keyof typeof en;

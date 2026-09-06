/**
 * The shop's own details, written down once.
 *
 * They used to be typed out in full in both `Contact.tsx` and `Footer.tsx` —
 * two copies of an address, a phone number and an email, about six hundred
 * pixels apart on the same page. That is a duplication of *content*, which
 * reads as padding, and a duplication of *fact*, which is how a page ends up
 * advertising a disconnected number in one place and the live one in another.
 *
 * The two surfaces now have different jobs. Contact is where you reach the
 * shop and carries all of it; the footer closes the page and carries a single
 * line of it.
 *
 * **This file is also read at build time**, by the `siteMetadata` plugin in
 * vite.config.ts, which turns it into the `LocalBusiness` structured data in
 * the document head. That is why it imports nothing: the config bundles it
 * outside React, so a React import here would break the build. Keep it plain
 * data.
 */
export const SHOP = {
  name: 'FreshFold Laundry Co.',
  addressLine1: 'Wagyingo Opal, Ayeduase-Kotei',
  addressLine2: 'Beside the Benab filling station, Kumasi',
  /** The two lines as one, for a single-line context. */
  addressShort: 'Ayeduase-Kotei, Kumasi',
  locality: 'Kumasi',
  region: 'Ashanti',
  country: 'GH',
  phone: '+233200957165',
  phoneLabel: '+233 20 095 7165',
  email: 'laundry.freshfold1@gmail.com',
} as const;

/**
 * When the desk is open, as one table.
 *
 * The badge in `Contact.tsx`, the printed schedule beside it and the
 * `openingHoursSpecification` in the page's structured data all read these
 * rows. They used to be three separate statements of the same fact: the rows
 * said 07:00—20:30 on a weekday while the badge ran a flat `hours >= 7 &&
 * hours < 21` over all seven days, so it read "Open now" for the last half
 * hour of every weekday evening, for three hours after closing on a Saturday
 * and for five on a Sunday — telling somebody the desk would answer when it
 * would not.
 *
 * Minutes from midnight rather than whole hours, because 20:30 is not an hour.
 *
 * Read in **GMT**, which is not the timezone bug it resembles: Ghana is GMT+0
 * and does not observe daylight saving, so UTC is the local wall clock all
 * year. Reading the visitor's own clock instead would tell somebody in London
 * that a Kumasi desk closes at 21:30 in summer.
 */
export interface OpeningWindow {
  /** As printed in the schedule. */
  label: string;
  /** Minutes from midnight. */
  opens: number;
  closes: number;
  /** Schema.org day names, for the structured data. */
  days: readonly string[];
}

const WEEKDAY_HOURS: OpeningWindow = {
  label: '07:00 — 20:30',
  opens: 7 * 60,
  closes: 20 * 60 + 30,
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
};
const SATURDAY_HOURS: OpeningWindow = {
  label: '08:00 — 18:00',
  opens: 8 * 60,
  closes: 18 * 60,
  days: ['Saturday'],
};
const SUNDAY_HOURS: OpeningWindow = {
  label: '09:00 — 16:00',
  opens: 9 * 60,
  closes: 16 * 60,
  days: ['Sunday'],
};

/** Indexed by `Date.getUTCDay()`, so Sunday is 0. */
export const WEEK: readonly OpeningWindow[] = [
  SUNDAY_HOURS,
  WEEKDAY_HOURS,
  WEEKDAY_HOURS,
  WEEKDAY_HOURS,
  WEEKDAY_HOURS,
  WEEKDAY_HOURS,
  SATURDAY_HOURS,
];

/** The same three rows, as the contact section prints them. */
export const SCHEDULE = [
  { days: 'Monday to Friday', hours: WEEKDAY_HOURS },
  { days: 'Saturday', hours: SATURDAY_HOURS },
  { days: 'Sunday and bank holidays', hours: SUNDAY_HOURS },
] as const;

/** `07:00`, from minutes past midnight. */
export function clockTime(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Whether the desk is open at this instant.
 *
 * Bank holidays are not in here and cannot be: the schedule lists them beside
 * Sunday because that is the shift they are worked, but which days they fall
 * on is a calendar this module has no access to. The badge is therefore
 * optimistic on a handful of days a year, which is the same thing the printed
 * schedule is.
 */
export function openAt(now: Date): boolean {
  const today = WEEK[now.getUTCDay()];
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= today.opens && minutes < today.closes;
}

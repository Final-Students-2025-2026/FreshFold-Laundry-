/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LAUNDRY_HUB } from '@freshfold/core';
import { hashPassword } from './passwords';
import { store, type StoredAccount, type StoredRider, type StoredSupervisor } from './store';

/**
 * What a fresh database contains.
 *
 * Deliberately almost nothing. There are no demo jobs: every order in the
 * system is one somebody actually booked, on the website or in the customer
 * app, so the rider's board and the supervisor's ledger only ever show real
 * work. A fresh install opens on empty states, which is correct — there is no
 * work yet.
 *
 * What does exist is identity, because nobody can sign in to a system with no
 * accounts in it, and none of these three can be self-registered:
 *
 *  - **A supervisor.** The bootstrap desk account, and the only thing seeded in
 *    production. Somebody has to be able to sign in and put the first courier on
 *    the roster. Its password comes from `SEED_SUPERVISOR_PASSWORD`.
 *
 *  - **The courier roster** — development only. Employment records: an id, an
 *    employee number, a contact number and a hashed PIN. Name, vehicle and plate
 *    are blank until the courier enters them, and every performance figure starts
 *    at zero rather than inventing a flattering one.
 *
 *  - **Sign-in accounts** — development only. Without these there is no way into
 *    the customer app except registering a new account first. They carry an
 *    identity and a password and nothing else: no points, no wallet balance, no
 *    history.
 *
 * The last two are a convenience for whoever is running this locally, and they do
 * not exist in production. Both used to: a live deployment against a fresh
 * database got three couriers whose PINs are printed in the README and three
 * invented customers, `emailVerified`, whose password is the word `password`. A
 * fabricated person in the customer directory is a fake with a sign-in page
 * attached, so in production the roster and the directory start empty and fill up
 * with real people — couriers through `POST /api/riders`, customers by
 * registering.
 *
 * Seeding is per-table and only fires on an empty one, so restarting the server
 * against a database that already has a roster does nothing at all. It is not
 * an "insert if absent" over each record: a supervisor who deactivated a
 * courier does not want them back on the next deploy.
 */

/**
 * Production seeds the desk account and nothing else.
 *
 * Read once, at module load, because it decides which records exist rather than
 * how one behaves — a value that changed under a running process would mean two
 * instances of the same deployment disagreeing about what a fresh database holds.
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * The courier roster. Development only.
 *
 * Riders are provisioned by the company, never self-registered, so these are
 * employment records rather than sample data: an id, an employee number, a
 * contact number, a PIN, and the company vehicle they have been given. The one
 * thing a courier enters themselves is their own name, and dispatch will not
 * let them accept work until they have.
 *
 * Every performance figure starts at zero. Nobody has driven anywhere yet.
 *
 * The PINs below are fixed, and printed in `README.md` and `apps/mobile/README.md`
 * so the rider app can be signed into without a database client — which is
 * precisely why this cannot run in production. A real courier is hired through
 * `POST /api/riders`, which generates a random PIN, hashes it immediately, forces
 * a replacement on first sign-in and expires it in 48 hours if it goes unused.
 */
const ROSTER = [
  {
    id: 'FF-R-204',
    employeeId: 'RIDER-204',
    phone: '0244567801',
    pin: '7801',
    vehicle: 'Electric delivery scooter',
    vehiclePlate: 'AS-3012-26',
  },
  {
    id: 'FF-R-118',
    employeeId: 'RIDER-118',
    phone: '0209114402',
    pin: '4019',
    vehicle: 'Electric delivery scooter',
    vehiclePlate: 'AS-2884-25',
  },
  {
    id: 'FF-R-337',
    employeeId: 'RIDER-337',
    phone: '0553370915',
    pin: '1234',
    vehicle: 'Cargo tricycle',
    vehiclePlate: 'AS-4471-24',
  },
];

/**
 * Sign-in accounts. Development only, all with the password `password` — hashed
 * on the way in, like any other account. There is no plaintext credential in the
 * database.
 *
 * These exist so there is a door into the customer app on a fresh install.
 * They start with no points, no wallet and no orders; everything a real
 * account accumulates, it accumulates by being used.
 *
 * They are also people who do not exist, so they stop at the edge of production.
 * A customer directory that ships with three invented patrons in it — verified,
 * and openable by anyone who has read this file — is a fake, and a supervisor
 * looking at the list cannot tell them apart from three real ones.
 */
const SIGN_IN_ACCOUNTS = [
  { name: 'Ama Serwaah', email: 'ama.serwaah@st.knust.edu.gh', phone: '0550192831' },
  { name: 'Kofi Mensah', email: 'kofi.mensah@gmail.com', phone: '0240419844' },
  { name: 'Adwoa Osei', email: 'adwoa.osei@outlook.com', phone: '0500887261' },
];

/**
 * What the seeded development credentials use. Never reachable in production:
 * `supervisorPassword()` refuses rather than falling back to it, and the sign-in
 * accounts it also covers are not seeded there at all.
 */
const DEV_PASSWORD = 'password';

/** A seed that cannot be performed safely. Fatal at boot — see `start()`. */
export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

/**
 * The password the bootstrap desk account is created with.
 *
 * In production it must be supplied, and there is no default. The account this
 * creates can read every customer's address and phone number, settle any bill and
 * delete the ledger — and it used to be created with the word `password` on any
 * deployment that started against an empty database.
 *
 * Called from inside the emptiness check rather than at module load, which is what
 * makes this safe to roll out: a database that already has a supervisor never
 * reaches here, so an existing deployment redeploys without new configuration.
 */
function supervisorPassword(): string {
  const supplied = process.env.SEED_SUPERVISOR_PASSWORD?.trim();
  if (supplied) return supplied;

  if (IS_PRODUCTION) {
    throw new SeedError(
      'this database has no supervisor, and SEED_SUPERVISOR_PASSWORD is not set. ' +
        'Set it to the password the first desk account should be created with, then ' +
        'start again. Refusing to create a supervisor with a default password: it can ' +
        'read every customer record and settle every bill.'
    );
  }

  return DEV_PASSWORD;
}

/**
 * The supervisor desk.
 *
 * One account to start, because somebody has to be able to sign in and put the
 * first courier on the roster. Supervisors are not self-registered either —
 * this is the bootstrap identity, and further ones would be created by an
 * existing supervisor.
 */
const SUPERVISORS = [
  { id: 'FF-S-001', name: 'Concierge Desk Supervisor', email: 'supervisor@freshfold.com' },
];

export async function seedRiders(): Promise<StoredRider[]> {
  return Promise.all(
    ROSTER.map(async ({ id, employeeId, phone, pin, vehicle, vehiclePlate }) => {
    const { salt, hash } = await hashPassword(pin);
    return {
      id,
      employeeId,
      phone,
      // The courier's own, entered on first sign-in. Dispatch refuses to let
      // them accept work until it has a value.
      name: '',
      avatar: '',
      // The company's, assigned with the employment record.
      vehicle,
      vehiclePlate,
      // Nothing has been rated, driven or delivered yet. Zero says that;
      // a 5.0 rating and a 96.5% acceptance rate would be a claim.
      rating: 0,
      isOnline: false,
      gpsAccuracy: 0,
      speed: 0,
      heading: 0,
      // Parked at the hub until the device reports a real fix. Read from the
      // shared hub rather than copied, so a relocation moves this too.
      coords: { lat: LAUNDRY_HUB.lat, lng: LAUNDRY_HUB.lng },
      todayDistance: 0,
      distanceDate: '',
      todayEarnings: 0,
      completedCount: 0,
      onTimeRate: 0,
      acceptanceRate: 0,
      completionRate: 0,
      active: true,
      pinSalt: salt,
      pinHash: hash,
    };
    })
  );
}

export async function seedSupervisors(): Promise<StoredSupervisor[]> {
  const password = supervisorPassword();
  return Promise.all(
    SUPERVISORS.map(async (supervisor) => {
    const { salt, hash } = await hashPassword(password);
    return {
      ...supervisor,
      createdAt: new Date().toISOString(),
      active: true,
      passwordSalt: salt,
      passwordHash: hash,
    };
    })
  );
}

export async function seedAccounts(): Promise<StoredAccount[]> {
  return Promise.all(
    SIGN_IN_ACCOUNTS.map(async (account) => {
    const { salt, hash } = await hashPassword(DEV_PASSWORD);
    return {
      ...account,
      points: 0,
      walletBalance: 0,
      createdAt: new Date().toISOString(),
      passwordSalt: salt,
      passwordHash: hash,
      // Confirmed on the way in. These exist so a fresh install has a door into
      // the customer app; one that cannot book until somebody reads a mailbox
      // nobody owns is not a door.
      emailVerified: true,
    };
    })
  );
}

/**
 * Puts the bootstrap identities in place if they are not there already.
 *
 * The desk account in every environment; the development roster and sign-in
 * accounts outside production only.
 *
 * Runs on every boot and on `POST /api/reset`. All three checks share one
 * transaction so two instances starting together cannot both find an empty
 * roster and both fill it — the second waits, sees three couriers, and does
 * nothing.
 *
 * Throws `SeedError` when a supervisor is needed and production has not been told
 * what password to give it. That is fatal at boot rather than survivable: the
 * alternative is a live desk account with a password from a public repository.
 */
export async function ensureSeeded(): Promise<{
  riders: number;
  supervisors: number;
  accounts: number;
}> {
  return store.tx(async (t) => {
    const inserted = { riders: 0, supervisors: 0, accounts: 0 };

    if ((await t.supervisors.list()).length === 0) {
      for (const supervisor of await seedSupervisors()) await t.supervisors.insert(supervisor);
      inserted.supervisors = SUPERVISORS.length;
    }

    // Everything below this line is a development convenience. In production the
    // roster and the customer directory start empty and fill with real people.
    if (IS_PRODUCTION) return inserted;

    if ((await t.riders.count()) === 0) {
      for (const rider of await seedRiders()) await t.riders.insert(rider);
      inserted.riders = ROSTER.length;
    }

    if ((await t.accounts.list()).length === 0) {
      for (const account of await seedAccounts()) await t.accounts.insert(account);
      inserted.accounts = SIGN_IN_ACCOUNTS.length;
    }

    return inserted;
  });
}

/**
 * The credentials a development boot just created, for the startup banner.
 *
 * Null in production, where the desk password came from the environment and the
 * operator already knows it. Printing it there would put it in a log aggregator.
 */
export function developmentCredentials(): { email: string; password: string } | null {
  if (IS_PRODUCTION) return null;
  return { email: SUPERVISORS[0].email, password: DEV_PASSWORD };
}

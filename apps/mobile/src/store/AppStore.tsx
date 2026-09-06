/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ApiError,
  LAUNDRY_HUB,
  MIN_HEADING_SPEED_KMH,
  hasArrivedAt,
  isActionableFix,
  isOutsideServiceArea,
  isTerminal,
  metresBetween,
  orderWithKnownProof,
  type Coords,
  type Message,
  type Notification,
  type Order,
  type OrderStatus,
  type RiderState,
} from '@freshfold/core';
import {
  INITIAL_MESSAGES,
  INITIAL_NOTIFICATIONS,
  INITIAL_ORDERS,
  INITIAL_RIDER,
  LAUNDRY_HUB_COORDS,
} from '../data/initialState';
import { api, patientApi } from '../services/api';
import { canAcceptMore, goingSpare, heldBy, ridingLeg } from './workload';
import { useSession } from './SessionStore';
import { nowLabel } from '../theme';

/**
 * Rider-side domain state.
 *
 * The dispatch server owns the job board; this provider is the phone's view of
 * it. Reads come from a poll, writes go out immediately and are applied
 * locally first so the UI never waits on the network — a rider halfway up a
 * stairwell should still be able to mark a pickup complete.
 *
 * When the server is unreachable everything keeps working against local state
 * and AsyncStorage, exactly as it did before there was a server. `connected`
 * says which mode we are in so the UI can be honest about it.
 */

const KEYS = {
  rider: 'freshfold_rider',
  orders: 'freshfold_orders',
  messages: 'freshfold_messages',
  notifications: 'freshfold_notifications',
} as const;

/**
 * A position the device actually reported, kept apart from the rider record.
 *
 * `rider.coords` is what the map draws, and it is allowed to fall back to the
 * hub when a fix is unusable. That fallback must never confirm an arrival, so
 * anything that changes an order's status reads this instead — a fix, its
 * uncertainty, and when it arrived.
 */
interface Fix {
  coords: Coords;
  /** Reported radius of uncertainty in metres; null when the device won't say. */
  accuracyM: number | null;
  at: number;
}

/** Where the rider is currently headed, if anywhere. */
export interface NavigationTarget {
  /**
   * The job being ridden for. Carried explicitly because the courier may be
   * *looking at* a different one — arrival has to land on the job whose road
   * this is, not on whichever card is open.
   */
  orderId: string;
  coords: Coords;
  label: string;
  /** Status the order moves to once the rider reaches this point. */
  arrivalStatus: OrderStatus;
}

interface AppState {
  hydrated: boolean;
  /** True while the dispatch server is answering. */
  connected: boolean;
  rider: RiderState;
  orders: Order[];
  messages: Message[];
  notifications: Notification[];
  /** Every job this courier holds, soonest-needed first. */
  myOrders: Order[];
  /** The one the workflow sheet is driving — the courier's pick, or `myOrders[0]`. */
  activeOrder?: Order;
  /** The job being ridden for, which may not be the one on screen. */
  navigatingOrder?: Order;
  /** Which job the courier chose, or null while following the automatic pick. */
  focusedOrderId: string | null;
  /** Put a job in front of the courier. `null` returns to the automatic pick. */
  focusOrder: (orderId: string | null) => void;
  /** False while the courier is mid-leg, so offers stop rather than pile up. */
  canTakeMore: boolean;
  backlogOrders: Order[];
  unreadCount: number;
  /** False until the rider has filled every field dispatch requires. */
  profileComplete: boolean;
  /** Human labels for what is still missing, e.g. `['vehicle plate']`. */
  missingProfileFields: string[];
  /** True while an order is in one of the `navigating_*` states. */
  isNavigating: boolean;
  navigationTarget: NavigationTarget | null;

  /** True when the device has refused location, so the map can say why. */
  locationDenied: boolean;
  /**
   * Whether the current fix is precise enough for arrival to confirm itself.
   * False under a canopy or indoors, where the courier taps the button.
   */
  arrivalAutoConfirms: boolean;

  /**
   * Pulls the board and the courier's own record from the server now, rather
   * than waiting for the next tick. Wired to pull-to-refresh.
   */
  refresh: () => Promise<void>;
  /** Marks arrival at the current navigation target. */
  arriveAtDestination: () => void;
  /**
   * Completes a delivery against the customer's code, or against a recorded
   * reason for not having one. Resolves with the server's refusal rather than
   * throwing, so the door step can show it.
   */
  completeDelivery: (
    orderId: string,
    handover: { code?: string; overrideReason?: string; photo?: string; signature?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Checks the bags in at the hub against the desk's code, or against a
   * recorded reason for not having one. Resolves with the server's refusal
   * rather than throwing, so the sheet at the counter can show it.
   */
  completeDropoff: (
    orderId: string,
    handover: { code?: string; overrideReason?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  updateRider: (updates: Partial<RiderState>) => void;
  acceptOrder: (orderId: string) => void;
  declineOrder: (orderId: string) => void;
  updateOrderStatus: (
    orderId: string,
    status: OrderStatus,
    photo?: string,
    signature?: string
  ) => void;
  /**
   * Posts a message from the courier into the active job's thread. The customer,
   * the desk and the hub all read that one thread, so there is nobody to address
   * it to.
   */
  sendRiderMessage: (text: string) => void;
  markNotificationRead: (notifId: string) => void;
  /**
   * Fetches one job's proof-of-service photographs into the board.
   *
   * The polled list leaves them out — that poll runs every four seconds on a
   * courier's mobile data, and the photographs are the largest thing on a job
   * by an order of magnitude. Screens that draw them ask for them. Calling this
   * repeatedly for the same job is free: it is attempted once per app run.
   */
  loadOrderProof: (orderId: string) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

/**
 * What dispatch requires on a rider's record before it will let them take a
 * job. The customer is shown all three at the door, so a job accepted without
 * them is a courier the customer cannot identify.
 *
 * Not all three are the courier's to enter: the vehicle and its plate are
 * assigned from the roster console, and only the name comes from the profile
 * form. The employee ID is absent because it is assigned at hiring and cannot
 * be missing.
 */
export const REQUIRED_PROFILE_FIELDS = [
  'name',
  'vehicle',
  'vehiclePlate',
] as const satisfies readonly (keyof RiderState)[];

export const PROFILE_FIELD_LABELS: Record<(typeof REQUIRED_PROFILE_FIELDS)[number], string> = {
  name: 'full name',
  vehicle: 'vehicle type',
  vehiclePlate: 'vehicle plate',
};

/**
 * How many consecutive in-range fixes confirm an arrival.
 *
 * One is a GPS jump. Two in a row, seconds apart while navigating, is a
 * courier who is actually there — and the manual button is still the answer
 * for a phone whose fix never settles.
 */
const ARRIVAL_CONFIRMATIONS = 2;

/**
 * The device's own calendar date, `YYYY-MM-DD`.
 *
 * Local rather than UTC on purpose: a courier's day ends at midnight where they
 * are standing, and at 00:30 in Kumasi a UTC stamp still says yesterday.
 */
function todayStamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * A stamped distance figure, read as today's.
 *
 * Nothing ever reset `todayDistance`, so it was a lifetime total under a label
 * that said "today". A figure carrying any other date belongs to that day, and
 * today starts again at zero.
 */
function distanceToday(figure: Pick<RiderState, 'todayDistance' | 'distanceDate'>): number {
  return figure.distanceDate === todayStamp() ? figure.todayDistance : 0;
}
const POLL_INTERVAL_MS = 4000;


/** Where a courier is placed when the device's fix is unusable. */
const HUB_COORDS: Coords = { lat: LAUNDRY_HUB.lat, lng: LAUNDRY_HUB.lng };
/** Position is published on its own slower tick than the device reports it. */
const TELEMETRY_INTERVAL_MS = 3000;

async function loadPersisted<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { rider: signedInRider, token, isAuthenticated, applyRider } = useSession();

  /**
   * Who this console is, and what proves it.
   *
   * Read through refs by the poll and the telemetry tick so neither has to take
   * the session as a dependency — both drive intervals, and rebuilding them on
   * every render would restart the timers.
   */
  const riderIdRef = useRef('');
  const tokenRef = useRef<string | null>(null);
  riderIdRef.current = signedInRider?.id ?? '';
  tokenRef.current = token;

  /** The session's cached record, and the way to update it, for the poll. */
  const signedInRiderRef = useRef(signedInRider);
  const applyRiderRef = useRef(applyRider);
  signedInRiderRef.current = signedInRider;
  applyRiderRef.current = applyRider;

  const [hydrated, setHydrated] = useState(false);
  const [connected, setConnected] = useState(false);
  /**
   * The job the courier has chosen to look at, or null to follow the automatic
   * pick. Session state rather than persisted: which job is in front of you is
   * a question about right now, and it is answered again on the next launch.
   */
  const [focusedOrderId, setFocusedOrderId] = useState<string | null>(null);
  /** True once the device has refused location, so the UI can say why. */
  const [locationDenied, setLocationDenied] = useState(false);
  /** The last position the device reported that was worth keeping. */
  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const [rider, setRider] = useState<RiderState>({ ...INITIAL_RIDER });
  const [orders, setOrders] = useState<Order[]>([...INITIAL_ORDERS]);
  const [messages, setMessages] = useState<Message[]>([...INITIAL_MESSAGES]);
  const [notifications, setNotifications] = useState<Notification[]>([
    ...INITIAL_NOTIFICATIONS,
  ]);

  /**
   * Non-zero while a write is on the wire. A poll that lands mid-write carries
   * a snapshot from before the change, and applying it would visibly rewind
   * the workflow the rider just advanced.
   */
  const inFlight = useRef(0);

  /**
   * How many writes to the *board* have landed, ever.
   *
   * `inFlight` only holds off a poll that starts mid-write. It cannot help the
   * other order: a poll issued a moment *before* the write can come back a
   * moment after it, carrying the board as it was, and applying that snapshot
   * rewinds the leg the courier just finished — the delivery they completed
   * reappears at the door, code and photo and all, and the workflow starts
   * again. So a poll notes this counter when it goes out and drops what it
   * fetched if anything changed the board in the meantime.
   *
   * Position updates deliberately do not count. They go out every three
   * seconds and would discard nearly every poll.
   */
  const boardWrites = useRef(0);

  /**
   * Held in refs so `pull` can read them without taking them as dependencies —
   * `pull` drives the poll interval, and rebuilding it on every render would
   * restart the timer four times a second.
   */
  const myOrdersRef = useRef<Order[]>([]);
  const pushNotificationRef = useRef<(notif: Omit<Notification, 'timestamp'>) => void>(
    () => {}
  );

  /**
   * Runs a write against the server, holding the poll off while it is in
   * flight. Rethrows — callers that need to tell a rejection apart from a
   * dropped connection use this directly.
   */
  const track = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    inFlight.current += 1;
    try {
      const result = await operation();
      setConnected(true);
      return result;
    } finally {
      inFlight.current -= 1;
    }
  }, []);

  /**
   * Fire-and-forget write. Any failure just means the app is offline for now;
   * the local state stands and the next poll reconciles.
   */
  const push = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | null> => {
      try {
        return await track(operation);
      } catch {
        setConnected(false);
        return null;
      }
    },
    [track]
  );

  /**
   * `track`, for a write that moves a job rather than reporting where the
   * courier is. Marks the board as changed as the write lands — see
   * {@link boardWrites} — so a poll already on the wire cannot undo it.
   */
  const trackBoard = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> =>
      track(async () => {
        try {
          return await operation();
        } finally {
          boardWrites.current += 1;
        }
      }),
    [track]
  );

  /** `trackBoard` for the board writes nobody is waiting on an answer to. */
  const pushBoard = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | null> => {
      try {
        return await trackBoard(operation);
      } catch {
        setConnected(false);
        return null;
      }
    },
    [trackBoard]
  );

  // Hydrate from device storage once on launch, so the first frame has data
  // even before the server answers.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [savedRider, savedOrders, savedMessages, savedNotifs] = await Promise.all([
        loadPersisted<RiderState>(KEYS.rider, { ...INITIAL_RIDER }),
        loadPersisted<Order[]>(KEYS.orders, [...INITIAL_ORDERS]),
        loadPersisted<Message[]>(KEYS.messages, [...INITIAL_MESSAGES]),
        loadPersisted<Notification[]>(KEYS.notifications, [...INITIAL_NOTIFICATIONS]),
      ]);

      if (cancelled) return;

      // Guard against coordinates persisted by an older build of the app.
      const stale =
        isOutsideServiceArea(savedRider?.coords) ||
        (savedOrders ?? []).some((o) => isOutsideServiceArea(o?.pickupCoords));

      if (stale) {
        await AsyncStorage.multiRemove(Object.values(KEYS));
        setRider({ ...INITIAL_RIDER });
        setOrders([...INITIAL_ORDERS]);
        setMessages([...INITIAL_MESSAGES]);
        setNotifications([...INITIAL_NOTIFICATIONS]);
      } else {
        setRider(savedRider);
        setOrders(savedOrders);
        setMessages(savedMessages);
        setNotifications(savedNotifs);
      }

      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist each slice as it changes (never before hydration, or we'd clobber it).
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(KEYS.rider, JSON.stringify(rider));
  }, [rider, hydrated]);

  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(KEYS.orders, JSON.stringify(orders));
  }, [orders, hydrated]);

  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(KEYS.messages, JSON.stringify(messages));
  }, [messages, hydrated]);

  useEffect(() => {
    if (hydrated) {
      AsyncStorage.setItem(KEYS.notifications, JSON.stringify(notifications));
    }
  }, [notifications, hydrated]);

  /**
   * Pull the board from the server.
   *
   * The rider's own telemetry (position, speed, heading) is deliberately *not*
   * overwritten: this device is the authority on where it is, and the server's
   * copy is always a few seconds behind what we just sent it.
   */
  const pull = useCallback(async () => {
    if (inFlight.current > 0) return;

    // What the board had been written to when this snapshot was asked for.
    const writesAtStart = boardWrites.current;

    try {
      /**
       * The board, the conversations on it, the feed and this courier's own record.
       *
       * `listOrders` no longer names a courier: the server reads it off the token,
       * so a device cannot ask for somebody else's assignments. The notification
       * feed is scoped the same way — this courier's board plus the desk-wide
       * alerts, rather than every notification in the system.
       *
       * Messages are fetched per order rather than in one unscoped call. That call
       * used to return every conversation FreshFold has, including customers
       * talking to other couriers, on a four-second timer.
       */
      const token = tokenRef.current!;

      const [serverOrders, serverNotifications, serverRider] = await Promise.all([
        api.listOrders(token),
        api.listNotifications(token),
        api.riderMe(token),
      ]);

      const serverMessages = (
        await Promise.all(
          serverOrders.map((order) =>
            api.listMessages(order.id, { token }).catch(() => [] as Message[])
          )
        )
      ).flat();

      // Anything that moved a job while these requests were out makes them
      // stale, whether it is still on the wire or has already landed. Applying
      // them anyway is what put a finished delivery back on the courier's board.
      if (inFlight.current > 0 || boardWrites.current !== writesAtStart) return;

      // A job the rider is part-way through can vanish from under them — a
      // supervisor deleting it from the master ledger is the usual reason. It
      // would simply drop off the strip, leaving a courier holding someone's
      // laundry with nothing on screen to explain it. Say so before the board
      // is replaced, for every job they hold rather than only the one on
      // screen: the courier is carrying the bags for all of them.
      for (const held of myOrdersRef.current) {
        if (serverOrders.some((o) => o.id === held.id)) continue;

        pushNotificationRef.current({
          id: `notif-withdrawn-${held.id}-${Date.now()}`,
          title: 'Job withdrawn by dispatch',
          body: `${held.orderNumber} for ${held.customerName} was removed from the ledger. Stop work on it and call the concierge desk if you already have the bags.`,
          type: 'alert',
          orderId: held.id,
          read: false,
        });
      }

      // Board from the server, proof photographs from whatever we already hold:
      // the list leaves the blobs behind so this poll stays small, and a
      // straight replace would take the courier's own just-captured photo off
      // the workflow sheet four seconds after they submitted it.
      setOrders((prev) => {
        const known = new Map(prev.map((order) => [order.id, order]));
        return serverOrders.map((order) => orderWithKnownProof(order, known.get(order.id)));
      });
      setMessages(serverMessages);
      setNotifications(serverNotifications);
      const stamp = todayStamp();
      setRider((prev) => ({
        ...prev,
        // Company records. The roster desk owns these — a supervisor assigning
        // a vehicle mid-shift has to reach the courier holding it, and until
        // this was here the only way to see the change was to sign out and
        // back in.
        employeeId: serverRider.employeeId,
        phone: serverRider.phone,
        vehicle: serverRider.vehicle,
        vehiclePlate: serverRider.vehiclePlate,
        rating: serverRider.rating,
        // Distance is the one total this device measures rather than reads: it
        // adds up the gaps between its own GPS fixes as the courier rides.
        // Taking the server's copy on every poll would rub out whatever has
        // been ridden since the last telemetry tick, so the server's figure is
        // adopted only when this device has measured nothing today — a cold
        // start, or the first fix of a new day.
        todayDistance:
          prev.distanceDate === stamp ? prev.todayDistance : distanceToday(serverRider),
        distanceDate: stamp,
        todayEarnings: serverRider.todayEarnings,
        completedCount: serverRider.completedCount,
        onTimeRate: serverRider.onTimeRate,
        acceptanceRate: serverRider.acceptanceRate,
        completionRate: serverRider.completionRate,
      }));

      // The session's cached copy is what paints the console on the next cold
      // start, so a reassigned vehicle has to reach it too — otherwise the app
      // would boot showing the scooter the courier handed back this morning.
      // Only on an actual change: this runs every four seconds, and the cache
      // is a disk write.
      const cached = signedInRiderRef.current;
      if (
        cached &&
        (cached.vehicle !== serverRider.vehicle ||
          cached.vehiclePlate !== serverRider.vehiclePlate ||
          cached.employeeId !== serverRider.employeeId ||
          cached.phone !== serverRider.phone)
      ) {
        applyRiderRef.current({
          ...cached,
          employeeId: serverRider.employeeId,
          phone: serverRider.phone,
          vehicle: serverRider.vehicle,
          vehiclePlate: serverRider.vehiclePlate,
        });
      }

      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  /**
   * Refreshes the board on demand — what pull-to-refresh on the Tasks and
   * Profile screens is wired to. Resolves when the round trip is done so the
   * spinner lasts exactly as long as the work does.
   */
  const refresh = useCallback(async () => {
    await pull();
  }, [pull]);

  // Poll for anything the customer, the admin dashboard or the hub changed.
  // Only once a courier is signed in: every request the poll makes now needs a
  // token and a rider id, and firing it on the login screen would just produce
  // a run of 401s.
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;

    void pull();
    const timer = setInterval(() => void pull(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hydrated, isAuthenticated, pull]);

  /**
   * Signing out has to clear the board, not just the token. What is on screen
   * is one courier's work; leaving it for whoever signs in next would show them
   * jobs that are not theirs.
   */
  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      setOrders([]);
      setMessages([]);
      setNotifications([]);
      setRider({ ...INITIAL_RIDER });
    }
  }, [hydrated, isAuthenticated]);

  // The signed-in record is the authority on identity; the store's copy carries
  // the live telemetry on top of it.
  useEffect(() => {
    if (signedInRider) setRider((prev) => ({ ...prev, ...signedInRider }));
  }, [signedInRider]);

  /** This courier's id, as the board's own records name it. */
  const myRiderId = signedInRider?.id ?? '';

  /** Every job this courier is holding, soonest-needed first. */
  const myOrders = useMemo(() => heldBy(orders, myRiderId), [orders, myRiderId]);

  /** The leg the courier is physically committed to — not what is on screen. */
  const navigatingOrder = useMemo(() => ridingLeg(myOrders), [myOrders]);

  /**
   * The job the workflow sheet is driving.
   *
   * The courier's own pick while it lasts, otherwise whatever needs them
   * soonest. `focusedOrderId` is cleared when that job leaves the board, so a
   * completed delivery hands the sheet to the next job rather than emptying it.
   */
  const activeOrder = useMemo(
    () => myOrders.find((o) => o.id === focusedOrderId) ?? myOrders[0],
    [myOrders, focusedOrderId]
  );

  /** False while mid-leg, so offers stop rather than pile up on a busy courier. */
  const canTakeMore = useMemo(() => canAcceptMore(myOrders), [myOrders]);

  // A focus that has outlived its job — delivered, cancelled, or withdrawn by
  // the desk — is dropped so `activeOrder` falls back to the automatic pick.
  useEffect(() => {
    if (focusedOrderId && !myOrders.some((o) => o.id === focusedOrderId)) {
      setFocusedOrderId(null);
    }
  }, [focusedOrderId, myOrders]);

  const focusOrder = useCallback((orderId: string | null) => {
    setFocusedOrderId(orderId);
  }, []);

  /** Anything still running that no courier holds. */
  const backlogOrders = useMemo(() => goingSpare(orders), [orders]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  // Keep the refs `pull` reads in step with the values it needs.
  myOrdersRef.current = myOrders;

  /**
   * Whether this rider may take work.
   *
   * The vehicle and plate are in here alongside the identity fields because
   * the customer's app shows them at the door — they are how someone decides
   * whether the person on their step is the courier they were expecting. A job
   * accepted without them leaves the customer reading "Vehicle details
   * pending" and no way to check.
   *
   * The avatar is deliberately not required; it is labelled optional on the
   * form and has a fallback portrait.
   */
  const profileComplete = useMemo(
    () =>
      REQUIRED_PROFILE_FIELDS.every((field) => rider[field].trim().length > 0),
    [rider]
  );

  /** What is still missing, so a prompt can name it rather than nag vaguely. */
  const missingProfileFields = useMemo(
    () =>
      REQUIRED_PROFILE_FIELDS.filter((field) => !rider[field].trim()).map(
        (field) => PROFILE_FIELD_LABELS[field]
      ),
    [rider]
  );

  // Off the job being ridden, not the one on screen — see `navigatingOrder`.
  const navigationTarget = useMemo<NavigationTarget | null>(() => {
    if (!navigatingOrder) return null;

    switch (navigatingOrder.status) {
      case 'navigating_to_pickup':
        return {
          orderId: navigatingOrder.id,
          coords: navigatingOrder.pickupCoords,
          label: navigatingOrder.pickupAddress,
          arrivalStatus: 'arrived_at_pickup',
        };
      case 'navigating_to_laundry':
        return {
          orderId: navigatingOrder.id,
          coords: LAUNDRY_HUB_COORDS,
          label: LAUNDRY_HUB.name,
          arrivalStatus: 'arrived_at_laundry',
        };
      case 'navigating_to_delivery':
        return {
          orderId: navigatingOrder.id,
          coords: navigatingOrder.deliveryCoords,
          label: navigatingOrder.deliveryAddress,
          arrivalStatus: 'arrived_at_delivery',
        };
      default:
        return null;
    }
  }, [navigatingOrder]);

  const isNavigating = navigationTarget !== null;

  const pushNotification = useCallback(
    (notif: Omit<Notification, 'timestamp'>) => {
      setNotifications((prev) => [{ ...notif, timestamp: nowLabel() }, ...prev]);
      void push(() =>
        api.postNotification({ ...notif, timestamp: nowLabel() }, tokenRef.current!)
      );
    },
    [push]
  );

  pushNotificationRef.current = pushNotification;

  const updateRider = useCallback(
    (updates: Partial<RiderState>) => {
      setRider((prev) => ({ ...prev, ...updates }));

      // The session caches the courier's record for the next cold start, so a
      // profile saved here has to reach it — otherwise the app would boot
      // showing the identity they had before they filled the form in.
      //
      // Outside the updater above, and through the refs the poll uses. React
      // runs an updater during the *render* that consumes it and may run it
      // more than once, so writing to another provider from in there set state
      // on `SessionProvider` mid-render — which is the warning LogBox raised —
      // and put a stray AsyncStorage write on every replay.
      const cached = signedInRiderRef.current;
      if (cached) applyRiderRef.current({ ...cached, ...updates });

      // Profile and presence changes matter to the customer's live map, so
      // they go up straight away rather than waiting for the telemetry tick.
      // Only what this device is allowed to say about itself. The vehicle and
      // plate belong to the roster desk, and the server rejects them here.
      const { name, isOnline } = updates;
      if (name !== undefined || isOnline !== undefined) {
        void push(() =>
          api.updateRider(
            riderIdRef.current,
            { name, isOnline },
            tokenRef.current!
          )
        );
      }
    },
    [push]
  );

  /** Optimistic local patch for one order. */
  const patchOrder = useCallback((orderId: string, updates: Partial<Order>) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...updates } : o)));
  }, []);

  const acceptOrder = useCallback(
    (orderId: string) => {
      // Gated here rather than only on the buttons, because four screens can
      // start an accept — the offer card, the assignments list, the map
      // callout and the map fallback — and a rule enforced in four places is
      // a rule that will eventually be enforced in three.
      if (!profileComplete) {
        pushNotification({
          id: `notif-profile-${Date.now()}`,
          title: 'Finish your driver profile',
          body: 'Add your name, employee ID, vehicle and plate before accepting jobs. Customers are shown these at the door.',
          type: 'alert',
          orderId,
          read: false,
        });
        return;
      }

      // Claimed locally at whatever status it already carries, which is what
      // the server does with it too: a job a supervisor had already moved down
      // the board must not flicker back to `assigned` for the four seconds
      // until the next poll corrects it.
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                riderId: riderIdRef.current,
                status: o.status === 'unassigned' ? 'assigned' : o.status,
              }
            : o
        )
      );

      // Put it in front of them. Accepting a job while another is parked at the
      // hub would otherwise leave the sheet on the parked one, since that is
      // the older job and the strip is ordered by what needs doing.
      setFocusedOrderId(orderId);

      void (async () => {
        try {
          // The token, not the rider id — the server reads who is accepting off
          // the session now, and both happen to be strings, so nothing but this
          // comment stands between the two.
          await trackBoard(() => patientApi.acceptOrder(orderId, tokenRef.current!));
        } catch (error) {
          // Two very different failures land here and they need opposite
          // handling: a 409 means another rider has the job and this phone must
          // let go of it, while a transport failure means we're offline and the
          // optimistic accept should stand until the rider reconnects.
          if (error instanceof ApiError) {
            setConnected(true);
            patchOrder(orderId, { status: 'unassigned', riderId: undefined });

            /**
             * Three refusals reach here now, and calling them all "no longer
             * available" would be wrong about two of them.
             *
             * A job can be taken by somebody else, which is what that title has
             * always meant. It can also be refused because this courier is
             * already carrying the maximum — there was no cap at all before, so
             * one courier tapping down the board took the board — or because
             * they are not on shift. Those two are about the courier rather than
             * about the job, and a title saying the job has gone sends them
             * looking for a different card when the answer is to finish one or
             * check the rota.
             */
            const reason =
              error.body && typeof error.body === 'object' && 'reason' in error.body
                ? String((error.body as { reason?: unknown }).reason)
                : '';

            pushNotification({
              id: `notif-conflict-${Date.now()}`,
              title:
                reason === 'at-capacity'
                  ? 'Your board is full'
                  : reason === 'off-shift'
                    ? 'You are not on shift'
                    : 'Job No Longer Available',
              body: error.message,
              type: 'alert',
              orderId,
              read: false,
            });
          } else {
            setConnected(false);
          }
        }
      })();
    },
    [profileComplete, patchOrder, pushNotification, trackBoard]
  );

  const declineOrder = useCallback(
    (orderId: string) => {
      patchOrder(orderId, { status: 'unassigned', riderId: undefined });
      // The token, not the rider id — see `acceptOrder`.
      void pushBoard(() => patientApi.declineOrder(orderId, tokenRef.current!));

      pushNotification({
        id: `notif-${Date.now()}`,
        title: 'Order Returned to Backlog',
        body: `${rider.name || 'The rider'} declined order ${orderId}. Re-dispatch initiated.`,
        type: 'alert',
        read: false,
      });
    },
    [patchOrder, pushBoard, pushNotification, rider.name]
  );

  const updateOrderStatus = useCallback(
    (orderId: string, status: OrderStatus, photo?: string, signature?: string) => {
      const isPickupLeg =
        status === 'navigating_to_pickup' ||
        status === 'arrived_at_pickup' ||
        status === 'pickup_scanned' ||
        status === 'picked_up';

      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o;

          const updated: Order = { ...o, status };
          if (photo) {
            if (isPickupLeg) updated.pickupPhoto = photo;
            else updated.deliveryPhoto = photo;
          }
          if (signature) {
            if (isPickupLeg) updated.pickupSignature = signature;
            else updated.deliverySignature = signature;
          }
          if (status === 'picked_up') updated.pickedUpAt = new Date().toISOString();
          if (status === 'delivered') updated.deliveredAt = new Date().toISOString();
          return updated;
        })
      );

      // Offline, nothing else is going to credit the completion, so do it here.
      // Online the server owns these totals and the next poll brings them back.
      //
      // `todayDistance` is not among them. It used to add the job's booked
      // distance — the straight line measured at booking — on top of whatever
      // the phone had already measured for the same ride. The watch runs offline
      // too, so the kilometres are already counted by the time this fires.
      if (status === 'delivered' && !connected) {
        const completed = orders.find((o) => o.id === orderId);
        setRider((prev) => ({
          ...prev,
          completedCount: prev.completedCount + 1,
          todayEarnings: Number((prev.todayEarnings + (completed?.price ?? 0)).toFixed(2)),
        }));
      }

      // The customer-facing narration for each step is written by the server,
      // so both the rider's chat and the client portal show the same thread.
      //
      // On the patient connection: this may be the only copy of a photograph
      // that will ever leave the phone, and even a bare status write against a
      // job that already holds one can outrun the poll's six seconds. A write
      // cut off there leaves the console a step ahead of the board, and the
      // next poll rewinds the leg the courier just finished.
      // `riderId` is gone from the patch: the server takes it off the token now,
      // so the courier a transition is stamped for is the one who sent it.
      void pushBoard(() =>
        patientApi.updateOrderStatus(
          orderId,
          { status, photo, signature },
          { token: tokenRef.current }
        )
      );
    },
    [connected, orders, pushBoard]
  );

  /**
   * One job's photographs, fetched on demand.
   *
   * The attempted set is a ref rather than state: it must not re-render the
   * board, and a job whose fetch found nothing must not be asked for again on
   * every four-second tick — a delivery completed without a photo would
   * otherwise generate a request a second, forever, from the history screen.
   */
  const proofRequested = useRef<Set<string>>(new Set());

  const loadOrderProof = useCallback(async (orderId: string) => {
    if (proofRequested.current.has(orderId)) return;
    proofRequested.current.add(orderId);

    try {
      const full = await patientApi.getOrder(orderId, tokenRef.current!);
      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? orderWithKnownProof(order, full) : order))
      );
    } catch {
      // Offline. Allow a later attempt — this is the one case where asking
      // again is right, because nothing was learned.
      proofRequested.current.delete(orderId);
    }
  }, []);

  const arriveAtDestination = useCallback(() => {
    if (!navigationTarget) return;
    updateOrderStatus(navigationTarget.orderId, navigationTarget.arrivalStatus);
  }, [navigationTarget, updateOrderStatus]);

  /**
   * Sends one of the two adjudicated hand-offs and insists on an answer.
   *
   * A *refusal* is dispatch saying no, and is passed back word for word. A
   * *lost answer* is a different thing entirely and must not be reported as
   * one: a counter's wifi drops the reply far more often than it drops the
   * request, so the write has very likely landed. Saying "could not reach
   * dispatch" there sends a courier to re-scan a load the hub already has, or
   * — at a door — to redo a delivery the customer has been told is complete.
   *
   * So a lost answer is asked again rather than reported. Repeating a hand-off
   * is safe by construction: the server narrates to the customer and credits
   * the courier only when the status actually moves, so a second copy of one
   * that already landed writes nothing and answers 200. If the retry is lost
   * too, the courier is genuinely offline and is told so.
   */
  const sendHandoff = useCallback(
    async (
      send: () => Promise<unknown>,
      lostAnswer: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await trackBoard(send);
          return { ok: true };
        } catch (error) {
          if (error instanceof ApiError) {
            // Dispatch answered; it said no. The connection is fine.
            setConnected(true);
            return { ok: false, error: error.message };
          }
          if (attempt > 0) {
            setConnected(false);
            return { ok: false, error: lostAnswer };
          }
        }
      }
    },
    [trackBoard]
  );

  /**
   * Completing a delivery, which is the one transition this app cannot make on
   * its own say-so.
   *
   * The customer reads out four digits; the server checks them, because this
   * device is never told what they are. Unlike every other status change it
   * therefore *waits* for the answer, and reports a refusal rather than
   * showing a completed job that the server does not agree happened.
   *
   * The override is the real-world escape hatch: nobody in, a neighbour took
   * it, the porter signed. It always succeeds — a courier standing at a locked
   * gate cannot be left holding somebody's laundry — and it is recorded on the
   * job, sent to the desk as an alert and narrated to the customer.
   */
  const completeDelivery = useCallback(
    async (
      orderId: string,
      handover: { code?: string; overrideReason?: string; photo?: string; signature?: string }
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      // Waits on the answer and reports a refusal rather than swallowing it —
      // a handover shown as complete that dispatch rejected is a job the next
      // poll puts back at the door with the workflow started over, which from
      // the doorstep looks like the app losing the delivery.
      const sent = await sendHandoff(
        () =>
          patientApi.updateOrderStatus(
            orderId,
            {
              status: 'delivered',
              photo: handover.photo,
              signature: handover.signature,
              deliveryCode: handover.code,
              overrideReason: handover.overrideReason,
            },
            { token: tokenRef.current }
          ),
        'Could not reach dispatch to confirm the handover. Check your signal.'
      );

      if (!sent.ok) return sent;

      // The server accepted it, so the console may now agree.
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status: 'delivered',
                deliveredAt: new Date().toISOString(),
                deliveryPhoto: handover.photo ?? o.deliveryPhoto,
                deliverySignature: handover.signature ?? o.deliverySignature,
              }
            : o
        )
      );

      return { ok: true };
    },
    [sendHandoff]
  );

  /**
   * Checking the load in at the hub — the other transition this app cannot make
   * on its own say-so.
   *
   * The middle leg used to move on nothing but a bag manifest this device had
   * generated itself. The hub desk shows four digits now and the server checks
   * them, so this waits on the answer for the same reason `completeDelivery`
   * does: a load shown as checked in that the hub does not agree arrived is
   * worse than a spinner.
   *
   * Same escape hatch, same cost: a desk nobody is behind is written down and
   * goes to dispatch as an alert rather than quietly passing.
   */
  const completeDropoff = useCallback(
    async (
      orderId: string,
      handover: { code?: string; overrideReason?: string }
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      // Waits on the answer and reports the refusal, exactly as the delivery
      // does above and for the same reason.
      const sent = await sendHandoff(
        () =>
          patientApi.updateOrderStatus(
            orderId,
            {
              status: 'dropped_off',
              dropoffCode: handover.code,
              overrideReason: handover.overrideReason,
            },
            { token: tokenRef.current }
          ),
        'Could not reach dispatch to check the bags in. Check your signal.'
      );

      if (!sent.ok) return sent;

      // The server accepted it, so the console may now agree.
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'dropped_off' } : o))
      );

      return { ok: true };
    },
    [sendHandoff]
  );

  /**
   * The courier's real position.
   *
   * Lives here rather than in the map component so the device is watched
   * exactly once no matter how many screens are showing a map.
   *
   * While navigating the watch is tightened: arrival is decided within 35 m,
   * and a fix every 15 m is too coarse to decide that with — the courier can
   * cross the whole radius between two samples. Off a leg it loosens again,
   * because a scooter on the customer's map does not need centimetres and the
   * phone has to last the shift.
   *
   * A fix outside the Kumasi service area is ignored in favour of the hub.
   * Every distance and ETA in the system is computed against Kumasi addresses,
   * so a phone sitting in another city would otherwise report a courier 200 km
   * from a pickup and an ETA in the hundreds of minutes — technically honest
   * and completely useless. `isOutsideServiceArea` is the same guard the store
   * already used to reject coordinates persisted by an older build.
   */

  /**
   * The last fix today's ridden distance was measured from.
   *
   * Cleared whenever the watch stops, so a courier who goes offline at the hub,
   * rides home and comes back online in the morning does not have the ride home
   * counted as one enormous step. The cost is one dropped segment each time the
   * watch restarts, which undercounts by metres — the right direction to be
   * wrong in.
   */
  const distanceAnchor = useRef<{ coords: Coords; accuracyM: number } | null>(null);

  useEffect(() => {
    if (!hydrated || !rider.isOnline) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;

      if (!granted) {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);

      subscription = await Location.watchPositionAsync(
        {
          accuracy: isNavigating
            ? Location.Accuracy.BestForNavigation
            : Location.Accuracy.High,
          // A courier on a scooter, not a runner: often enough to keep the
          // customer's map honest without draining the battery.
          timeInterval: isNavigating ? 2000 : 4000,
          distanceInterval: isNavigating ? 5 : 15,
        },
        ({ coords, timestamp }) => {
          const fix: Coords = { lat: coords.latitude, lng: coords.longitude };
          const usable = !isOutsideServiceArea(fix);

          // Android reports `-1` for a figure it does not have, and iOS reports
          // `null`. Either way it is an absence, not a reading, and must not be
          // arithmetic'd into a speed of `-3.6 km/h` or a heading of `-1°`.
          const accuracyM =
            typeof coords.accuracy === 'number' && coords.accuracy > 0
              ? coords.accuracy
              : null;
          const speedKmh =
            typeof coords.speed === 'number' && coords.speed > 0
              ? Math.round(coords.speed * 3.6)
              : 0;
          const reportedHeading =
            typeof coords.heading === 'number' &&
            coords.heading >= 0 &&
            coords.heading <= 360
              ? coords.heading
              : null;

          // Only a genuine in-area fix is allowed to decide anything. The hub
          // fallback below would otherwise stand a courier in another city
          // exactly on top of the laundry hub and confirm their arrival at it.
          setLastFix(usable ? { coords: fix, accuracyM, at: timestamp || Date.now() } : null);

          // How far the scooter has actually gone.
          //
          // Two fixes describe a movement only if the gap between them is
          // larger than the uncertainty behind them: 8 m apart, each accurate
          // to ±30 m, is a phone that may not have moved at all, and a scooter
          // parked at a hostel gate for twenty minutes would otherwise ride
          // several kilometres on jitter alone. The anchor holds its ground
          // until the phone has demonstrably left it, so a slow creep is not
          // discarded — it just has to add up before it counts.
          //
          // This runs whether or not there is a connection: the watch is the
          // device's own, and the telemetry tick publishes the total when the
          // network comes back.
          let riddenKm = 0;
          if (usable && accuracyM !== null && isActionableFix(accuracyM)) {
            const anchor = distanceAnchor.current;
            if (!anchor) {
              distanceAnchor.current = { coords: fix, accuracyM };
            } else {
              const stepM = metresBetween(anchor.coords, fix);
              if (stepM > Math.max(anchor.accuracyM, accuracyM)) {
                riddenKm = stepM / 1000;
                distanceAnchor.current = { coords: fix, accuracyM };
              }
            }
          }

          setRider((prev) => {
            const stamp = todayStamp();
            return {
              ...prev,
              coords: usable ? fix : HUB_COORDS,
              // Below walking pace a heading derived from consecutive fixes is
              // noise. Holding the last real one keeps the arrow pointing the
              // way the courier was going rather than spinning at a junction.
              heading:
                reportedHeading !== null && speedKmh >= MIN_HEADING_SPEED_KMH
                  ? reportedHeading
                  : prev.heading,
              speed: speedKmh,
              gpsAccuracy: accuracyM ?? prev.gpsAccuracy,
              todayDistance: Number((distanceToday(prev) + riddenKm).toFixed(2)),
              distanceDate: stamp,
            };
          });
        }
      );
    })().catch(() => {
      // No location services on this device, or the watch failed to start.
      // The rider stays wherever they were; nothing else depends on this.
      if (!cancelled) setLocationDenied(true);
    });

    return () => {
      cancelled = true;
      // Nothing to measure the next fix against — see `distanceAnchor`.
      distanceAnchor.current = null;
      // expo-location's own teardown throws on this SDK: removing the last
      // watcher calls `LocationEventEmitter.removeSubscription`, which
      // expo-modules-core no longer has. By the time it throws the callback is
      // already unregistered and the platform watch already cleared — the only
      // casualty is an idle emitter listener, which the next watch reuses.
      // Letting it escape takes the whole app down with it, which is what
      // happened the first time a courier started a leg.
      try {
        subscription?.remove();
      } catch {
        /* see above */
      }
    };
  }, [hydrated, rider.isOnline, isNavigating]);

  /**
   * Arrival.
   *
   * Confirming it moves the order on and tells the customer their courier is
   * at the door, so it takes more than one reading: the fix has to be precise
   * enough to act on, inside the arrival radius, and it has to say so twice
   * running. A single GPS jump down the street used to be enough, which meant
   * an order could reach `arrived_at_pickup` while the courier was still two
   * streets away and the customer was told to come down.
   */
  const arrivalStreak = useRef(0);
  const countedFixAt = useRef(0);
  const streakTarget = useRef<string | null>(null);

  useEffect(() => {
    if (!navigationTarget) {
      arrivalStreak.current = 0;
      streakTarget.current = null;
      return;
    }

    // A new leg starts its own count; progress towards the pickup says nothing
    // about being at the hub.
    const targetKey = `${navigationTarget.arrivalStatus}@${navigationTarget.coords.lat},${navigationTarget.coords.lng}`;
    if (streakTarget.current !== targetKey) {
      streakTarget.current = targetKey;
      arrivalStreak.current = 0;
    }

    // This effect also re-runs when `arriveAtDestination` is rebuilt, which is
    // not a new reading — only a fix that has not been counted may count.
    if (!lastFix || lastFix.at === countedFixAt.current) return;
    countedFixAt.current = lastFix.at;

    if (!hasArrivedAt(lastFix.coords, navigationTarget.coords, lastFix.accuracyM)) {
      arrivalStreak.current = 0;
      return;
    }

    arrivalStreak.current += 1;
    if (arrivalStreak.current >= ARRIVAL_CONFIRMATIONS) {
      arrivalStreak.current = 0;
      arriveAtDestination();
    }
  }, [navigationTarget, lastFix, arriveAtDestination]);

  /**
   * Publish position to the server on a slow tick. This is what puts a moving
   * courier on the customer's dispatch map, so it runs whenever the rider is
   * online — not only while navigating.
   */
  const telemetryRef = useRef(rider);
  telemetryRef.current = rider;

  useEffect(() => {
    if (!hydrated || !rider.isOnline) return;

    const timer = setInterval(() => {
      const current = telemetryRef.current;
      void push(() =>
        api.updateRider(
          riderIdRef.current,
          {
            coords: current.coords,
            speed: current.speed,
            heading: current.heading,
            // The one running total this phone is the author of, rather than a
            // reader of. See `distanceAnchor` above and `RiderTelemetry`.
            todayDistance: current.todayDistance,
            distanceDate: current.distanceDate,
            gpsAccuracy: current.gpsAccuracy,
            isOnline: current.isOnline,
          },
          tokenRef.current!
        )
      );
    }, TELEMETRY_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [hydrated, rider.isOnline, push]);

  /**
   * The hub's two stages — In Care and Ironing & Folding — used to ripen on a
   * timer right here, and now run on the server. See `apps/server/src/hub.ts`.
   *
   * A phone is the wrong thing to hold that clock. It only ran while this app
   * was open on this device, so a courier who dropped bags off and closed the
   * app, lost signal or ended their shift left the job at In Care with no way
   * out of it but a supervisor noticing; and whichever phone got there first
   * stamped its own courier onto stages it did not work. The server sweeps for
   * jobs that have sat long enough and moves them through the same transition
   * a courier's tap would, so the board this app polls is already correct.
   */

  // Park the speedometer whenever the scooter is not in transit.
  useEffect(() => {
    if (!navigationTarget) {
      setRider((prev) => (prev.speed === 0 ? prev : { ...prev, speed: 0 }));
    }
  }, [navigationTarget]);

  const postMessage = useCallback(
    (message: Message) => {
      setMessages((prev) => [...prev, message]);
      void push(() =>
        api.postMessage(
          { text: message.text, orderId: message.orderId!, id: message.id },
          { token: tokenRef.current }
        )
      );
    },
    [push]
  );

  /**
   * Sends a message into the active job's thread.
   *
   * There used to be a second half to this. Three seconds after the courier
   * wrote to `dispatcher`, a `setTimeout` picked one of four canned sentences —
   * "Copy that. Operational details synchronized with the Admin Dashboard." —
   * and posted it, so the console would feel staffed. Two things made that worse
   * than a placeholder. `api.postMessage` sends no `sender`; the server derives
   * it from the token, so the reply was filed as the *courier's* own words, and
   * the next poll replaced the local `dispatcher` bubble with a `rider` one that
   * the customer could read in their portal. And one of the four sentences —
   * "ETA updated in customer client portal" — described work no desk had done.
   *
   * The desk now has an inbox (`MessagesPanel` on the supervisor dashboard), so
   * a message sent here waits for a person, and the thread is empty until one
   * answers. The `to` argument is gone with the canned reply: the server routes
   * by job, and every party to a job reads the same thread.
   */
  const sendRiderMessage = useCallback(
    (text: string) => {
      postMessage({
        id: `msg-rider-${Date.now()}`,
        sender: 'rider',
        text,
        timestamp: nowLabel(),
        orderId: activeOrder?.id,
      });
    },
    [activeOrder?.id, postMessage]
  );

  /**
   * Whether the phone currently knows where it is well enough for arrival to
   * confirm itself. Drives the wording on the transit card, so a courier under
   * a hostel canopy is told to use the button rather than left waiting for
   * something that is not going to happen.
   */
  const arrivalAutoConfirms = Boolean(lastFix && isActionableFix(lastFix.accuracyM));

  const markNotificationRead = useCallback(
    (notifId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, read: true } : n))
      );
      void push(() => api.markNotificationRead(notifId, tokenRef.current!));
    },
    [push]
  );

  const value = useMemo<AppState>(
    () => ({
      hydrated,
      connected,
      rider,
      orders,
      messages,
      notifications,
      myOrders,
      activeOrder,
      navigatingOrder,
      focusedOrderId,
      focusOrder,
      canTakeMore,
      backlogOrders,
      unreadCount,
      profileComplete,
      missingProfileFields,
      isNavigating,
      navigationTarget,
      refresh,
      arriveAtDestination,
      completeDelivery,
      completeDropoff,
      updateRider,
      acceptOrder,
      declineOrder,
      updateOrderStatus,
      sendRiderMessage,
      markNotificationRead,
      loadOrderProof,
      locationDenied,
      arrivalAutoConfirms,
    }),
    [
      arrivalAutoConfirms,
      hydrated,
      connected,
      rider,
      orders,
      messages,
      notifications,
      myOrders,
      activeOrder,
      navigatingOrder,
      focusedOrderId,
      focusOrder,
      canTakeMore,
      backlogOrders,
      unreadCount,
      profileComplete,
      missingProfileFields,
      isNavigating,
      navigationTarget,
      refresh,
      arriveAtDestination,
      completeDelivery,
      completeDropoff,
      updateRider,
      acceptOrder,
      declineOrder,
      updateOrderStatus,
      sendRiderMessage,
      markNotificationRead,
      loadOrderProof,
      locationDenied,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

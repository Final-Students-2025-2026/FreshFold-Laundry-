import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MAX_ITEMS, clampQuantity, type BookingItem } from '@freshfold/core';
import { BOOKABLE_SERVICE_ITEMS } from './data';

/**
 * What the visitor has told the page about themselves, kept in one place.
 *
 * Every interactive control on the landing page used to answer its own question
 * and then throw the answer away. Someone would price three loads in the
 * estimator, confirm we collect from Bomso, tab to "Students" and flip the
 * plans to yearly — four deliberate statements of intent — and the booking form
 * would open knowing none of it. The only thing that survived was the
 * estimator's service and count, threaded through `App` as two props.
 *
 * That is what made the page feel like a set of toys rather than a counter: a
 * control that forgets is a control there is no reason to touch twice. So the
 * answers accumulate here instead, and the booking form opens holding all of
 * them.
 *
 * Deliberately **session** storage, not local. This is what someone wants on
 * this visit; a basket priced a fortnight ago is a stale surprise, not a
 * convenience, and the returning-customer case is already served properly by
 * the account prefill in `BookingModal`.
 */
export type BillingCycle = 'monthly' | 'annual';

export interface Intent {
  /** The basket, built in the estimator or by pressing Book on a price row. */
  items: BookingItem[];
  /** The collection zone `AreaCheck` matched, when it matched one. */
  suburb: string;
  /** Which of the three sectors they said they were, from the tabs. */
  sector: string;
  /** The last plan they looked at. Not a service — see `note` below. */
  plan: string;
  billingCycle: BillingCycle;
}

const EMPTY: Intent = { items: [], suburb: '', sector: '', plan: '', billingCycle: 'monthly' };

const KEY = 'freshfold:intent';

/** Only what the catalogue can actually price may enter the basket. */
function bookable(name: string): boolean {
  return BOOKABLE_SERVICE_ITEMS.some((service) => service.name === name);
}

/**
 * Stored intent, checked against the live catalogue on the way out.
 *
 * The tab that wrote this may have been open across a deploy that renamed or
 * withdrew a service, so a stored line is a claim about the catalogue rather
 * than a fact about it. Anything the catalogue no longer recognises is dropped
 * here rather than carried into a quote — the alternative is a basket that
 * prices at zero because `serviceBasePrice` has never heard of it.
 */
function read(): Intent {
  if (typeof window === 'undefined') return EMPTY;

  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;

    const parsed = JSON.parse(raw) as Partial<Intent>;
    const seen = new Set<string>();
    const items: BookingItem[] = [];

    for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
      const serviceType = typeof item?.serviceType === 'string' ? item.serviceType : '';
      if (!bookable(serviceType) || seen.has(serviceType)) continue;
      seen.add(serviceType);
      items.push({ serviceType, quantity: clampQuantity(item?.quantity, serviceType) });
      if (items.length >= MAX_ITEMS) break;
    }

    return {
      items,
      suburb: typeof parsed.suburb === 'string' ? parsed.suburb : '',
      sector: typeof parsed.sector === 'string' ? parsed.sector : '',
      plan: typeof parsed.plan === 'string' ? parsed.plan : '',
      billingCycle: parsed.billingCycle === 'annual' ? 'annual' : 'monthly',
    };
  } catch {
    // Private-mode Safari throws on `sessionStorage` rather than returning
    // null, and a page that cannot remember an estimate still has to render.
    return EMPTY;
  }
}

function write(intent: Intent): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    /* Not being able to remember is not an error worth showing anyone. */
  }
}

interface IntentStore {
  intent: Intent;
  /** Adds a line, or raises the count on one already there. */
  addItem: (serviceName: string, quantity?: number) => void;
  setQuantity: (serviceName: string, quantity: number) => void;
  removeItem: (serviceName: string) => void;
  clearItems: () => void;
  /** Everything that is not the basket. */
  note: (patch: Partial<Omit<Intent, 'items'>>) => void;
}

const IntentContext = createContext<IntentStore | null>(null);

export function IntentProvider({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState<Intent>(read);

  useEffect(() => {
    write(intent);
  }, [intent]);

  /**
   * A basket keyed by service rather than by position.
   *
   * `BookingModal` already refuses to open a second line on a service it
   * already has, so two lines of the same wash is not a shape the order format
   * supports. Pressing "Book this" on washing twice therefore means two loads,
   * not two lines — which is also what a person means by it.
   */
  const addItem = useCallback((serviceName: string, quantity = 1) => {
    if (!bookable(serviceName)) return;

    setIntent((current) => {
      const existing = current.items.find((item) => item.serviceType === serviceName);

      if (existing) {
        return {
          ...current,
          items: current.items.map((item) =>
            item.serviceType === serviceName
              ? {
                  ...item,
                  quantity: clampQuantity(item.quantity + quantity, serviceName),
                }
              : item
          ),
        };
      }

      if (current.items.length >= MAX_ITEMS) return current;

      return {
        ...current,
        items: [
          ...current.items,
          { serviceType: serviceName, quantity: clampQuantity(quantity, serviceName) },
        ],
      };
    });
  }, []);

  const setQuantity = useCallback((serviceName: string, quantity: number) => {
    setIntent((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.serviceType === serviceName
          ? { ...item, quantity: clampQuantity(quantity, serviceName) }
          : item
      ),
    }));
  }, []);

  const removeItem = useCallback((serviceName: string) => {
    setIntent((current) => ({
      ...current,
      items: current.items.filter((item) => item.serviceType !== serviceName),
    }));
  }, []);

  const clearItems = useCallback(() => {
    setIntent((current) => ({ ...current, items: [] }));
  }, []);

  const note = useCallback((patch: Partial<Omit<Intent, 'items'>>) => {
    setIntent((current) => ({ ...current, ...patch }));
  }, []);

  const store = useMemo(
    () => ({ intent, addItem, setQuantity, removeItem, clearItems, note }),
    [intent, addItem, setQuantity, removeItem, clearItems, note]
  );

  return <IntentContext.Provider value={store}>{children}</IntentContext.Provider>;
}

export function useIntent(): IntentStore {
  const store = useContext(IntentContext);
  if (!store) throw new Error('useIntent must be used inside an IntentProvider');
  return store;
}

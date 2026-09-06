/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One freshness model for the whole desk.
 *
 * There used to be six. Bookings came from the shell's mirror and were never
 * pulled; accounts were re-read from `localStorage` on every booking change;
 * messages were fetched on each dashboard open; the audit trail only while the
 * Settings tab was mounted; rider phones exactly once; and every self-loading
 * pane rolled its own `loading` / `error` / `useCallback(load)` triplet with a
 * Refresh button wired to it. Nothing polled, nothing said when it had last
 * looked, and the one control that claimed to reload the ledger read the local
 * patron mirror instead.
 *
 * So the rules are here rather than in ten copies:
 *
 * - **A failure is held, never swallowed.** An empty list and a list that could
 *   not be read are different answers, and the panes say which one they have.
 *   This is the one thing every previous copy got right and it is preserved.
 * - **Every read is stamped.** `fetchedAt` is when the data on screen actually
 *   came back, which is the fact a supervisor needs before acting on a board
 *   that might be twenty minutes old.
 * - **Refresh means refresh.** One code path, so a button labelled with a
 *   timestamp cannot be wired to something that does not update it.
 * - **Polling is opt-in and stops when nobody is looking.** A hidden tab does
 *   not poll: the desk is left open all shift on a machine that also does other
 *   things, and a board nobody is watching is not worth a request a minute.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as store from '../../services/store';

export interface DeskResource<T> {
  data: T;
  /** Held, not swallowed. Null when the last read succeeded. */
  error: string | null;
  /** True until the first read settles, either way. */
  loading: boolean;
  /** True while a re-read is in flight over data already on screen. */
  refreshing: boolean;
  /** When the data on screen came back from the server. */
  fetchedAt: Date | null;
  refresh: () => void;
}

export interface DeskResourceOptions {
  /** Seconds between automatic re-reads. Omit for on-demand only. */
  pollSeconds?: number;
  /** False parks the resource — no read, no poll. */
  enabled?: boolean;
  /** Sentence to show when this desk has no token. */
  signedOutMessage?: string;
}

/**
 * Reads one collection with the desk's token.
 *
 * `read` must be stable — wrap it in `useCallback` with the things it closes
 * over. A reader that changes identity every render would re-fetch every
 * render, which is the failure mode this hook exists to make impossible to
 * write by accident.
 */
export function useDeskResource<T>(
  read: (token: string, signal: AbortSignal) => Promise<T>,
  fallback: T,
  {
    pollSeconds,
    enabled = true,
    signedOutMessage = 'This desk is not signed in, so this could not be read.',
  }: DeskResourceOptions = {},
): DeskResource<T> {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  /**
   * Whether anything has landed yet.
   *
   * A ref rather than derived from `fetchedAt`, because it decides which of
   * `loading` and `refreshing` a read sets, and reading that off state would
   * make the effect depend on a value the effect itself writes.
   */
  const settled = useRef(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;

    const token = store.readAdminToken();
    if (!token) {
      setError(signedOutMessage);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    if (settled.current) setRefreshing(true);
    else setLoading(true);

    read(token, controller.signal)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
        setFetchedAt(new Date());
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // The previous answer stays on screen underneath the error. A board
        // that blanked itself because one poll missed would be worse than a
        // board that says it is stale.
        setError(e instanceof Error ? e.message : 'This could not be read from the server.');
      })
      .finally(() => {
        if (cancelled) return;
        settled.current = true;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [read, enabled, nonce, signedOutMessage]);

  /**
   * The poll.
   *
   * Separate from the read effect so that changing `read` — which re-fetches —
   * does not also restart the clock, and so a tab going to the background stops
   * the timer rather than queueing a burst of catch-up requests for the moment
   * it comes back. Coming back visible re-reads once, immediately, which is
   * what somebody returning to the desk actually wants.
   */
  useEffect(() => {
    if (!enabled || !pollSeconds) return;

    let timer: number | undefined;

    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(refresh, pollSeconds * 1000);
    };

    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(timer);
        timer = undefined;
      } else {
        refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, pollSeconds, refresh]);

  /**
   * Memoised, so the object itself is stable between renders.
   *
   * A fresh literal every render would be a new prop for every pane holding one,
   * and `PaneHeader` takes the whole resource — so the toolbar, the timestamp
   * and the palette's memoised result list would all recompute on every keystroke
   * anywhere on the desk.
   */
  return useMemo(
    () => ({ data, error, loading, refreshing, fetchedAt, refresh }),
    [data, error, loading, refreshing, fetchedAt, refresh],
  );
}

/**
 * The shell's shared collections — bookings, patrons and threads — as a
 * resource with the same shape.
 *
 * These three have no reader of their own. They live in the offline mirror,
 * four panes read them, and `store.startSync()` — mounted by `App` for the
 * whole site — already pulls all three together every five seconds, pausing
 * while the tab is hidden. So this reports that sync rather than running one of
 * its own: a second timer over the same three endpoints would double the
 * desk's traffic to say nothing new.
 *
 * What it adds is the two things the desk needs and the store kept to itself:
 * *when* the board on screen came back, and a way to ask for it now rather than
 * within five seconds — which is what every handler does after a write, and
 * what the Refresh beside the timestamp does.
 *
 * `pull` resolves whether or not it reached the server: it is also the offline
 * queue's drain path and must not reject into it. So the failure is read off
 * `isOnline()`, and the timestamp deliberately keeps its old value through one
 * — the data on screen genuinely did arrive then, and all that has changed is
 * that it is now known to be stale.
 */
export function useDeskMirror(): Omit<DeskResource<void>, 'data'> {
  const [, tick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Every pull notifies, in both outcomes, so this re-reads the stamp and the
  // reachability without a clock of its own.
  useEffect(() => store.subscribe(() => tick((n) => n + 1)), []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void store.pull().finally(() => setRefreshing(false));
  }, []);

  const fetchedAt = store.lastSyncedAt();
  const online = store.isOnline();

  // Keyed on the instant rather than the `Date`, which is a new object on every
  // read and would defeat the memo it is sitting in.
  const at = fetchedAt?.getTime() ?? null;

  return useMemo(
    () => ({
      error: online
        ? null
        : 'The server could not be reached. This is the last board that came back.',
      loading: at === null,
      refreshing,
      fetchedAt: at === null ? null : new Date(at),
      refresh,
    }),
    [online, at, refreshing, refresh],
  );
}

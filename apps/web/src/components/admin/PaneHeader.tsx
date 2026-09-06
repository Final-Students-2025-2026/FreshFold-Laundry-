/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The top of every pane: what this list adds up to, how to narrow it, and how
 * old it is.
 *
 * ## What this replaces
 *
 * The shell rendered four metric cards — active orders, in transit, collected,
 * outstanding — unconditionally above whichever pane was open. On Settings,
 * Offers, Couriers and Inbox they described nothing on screen. On Claims,
 * Billing and Settlement, each of which rendered its *own* summary row, the
 * supervisor got seven numbers in two rows of boxes, four of them about a
 * different subject, before the first row of data.
 *
 * Search had three homes: the shell's top bar above `md`, a second copy of the
 * same input inside the Pipeline panel below `md`, and a third inside Patrons.
 * Five panes had none at all, and five of the ten are lookup surfaces.
 *
 * And nothing said when it had last been read. The one control that claimed to
 * — "Sync", titled *Reload the ledger from the server* — called a function that
 * re-read the patron directory out of `localStorage`.
 *
 * ## The rule
 *
 * A pane's summary describes the rows underneath it, and its Refresh re-reads
 * exactly what it is stamped with. That is enforced by shape rather than by
 * convention: `freshness` takes a `DeskResource`, so the timestamp and the
 * button come from the same object and cannot be wired to different things.
 */

import React, { useEffect, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import type { DeskResource } from './useDeskResource';
import { Banner, Button, Input, Select, Stat, type Tone } from './ui';

export interface StatSpec {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  hint?: string;
}

export interface FilterSpec {
  /** Screen-reader label. There is no room for a visible one in a toolbar. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

export interface PaneHeaderProps {
  /** Numbers describing the rows below. Omit rather than inventing one. */
  stats?: StatSpec[];
  /** The resource this pane is showing, for the stamp and the Refresh. */
  freshness?: Pick<DeskResource<unknown>, 'error' | 'refreshing' | 'fetchedAt' | 'refresh'>;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  };
  filters?: FilterSpec[];
  /** True when any filter or the search is narrowing the list. */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  /** Pane-specific controls — "New code", "Add a courier". */
  actions?: React.ReactNode;
  /** Rendered under the toolbar, above the pane. Usually a read failure. */
  banner?: React.ReactNode;
}

export default function PaneHeader({
  stats,
  freshness,
  search,
  filters,
  filtersActive,
  onClearFilters,
  actions,
  banner,
}: PaneHeaderProps) {
  const hasToolbar = Boolean(search || filters?.length || actions || freshness);
  if (!stats?.length && !hasToolbar && !banner) return null;

  return (
    <div className="space-y-3">
      {!!stats?.length && (
        <div className="admin-card flex flex-wrap items-center gap-x-8 gap-y-4 rounded-2xl border border-admin-line bg-admin-panel px-5 py-3.5">
          {stats.map((stat) => (
            <Stat key={stat.label} {...stat} />
          ))}
        </div>
      )}

      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {search && (
            <Input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              icon={Search}
              className="min-w-0 flex-1 basis-64 md:max-w-sm"
            />
          )}

          {filters?.map((filter) => (
            <Select
              key={filter.label}
              aria-label={filter.label}
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ))}

          {filtersActive && onClearFilters && (
            <Button size="sm" variant="ghost" icon={X} onClick={onClearFilters}>
              Clear
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {actions}
            {freshness && <Refresh {...freshness} />}
          </div>
        </div>
      )}

      {banner}
    </div>
  );
}

/**
 * The stamp and the button, as one control.
 *
 * They are one control because separating them is how the desk ended up with a
 * Sync button that synced nothing: a label and an action that are not obliged
 * to refer to the same thing eventually stop doing so.
 */
function Refresh({
  error,
  refreshing,
  fetchedAt,
  refresh,
}: Pick<DeskResource<unknown>, 'error' | 'refreshing' | 'fetchedAt' | 'refresh'>) {
  const age = useAge(fetchedAt);

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={refresh}
      disabled={refreshing}
      title={
        fetchedAt
          ? `Last read at ${fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : 'Read this from the server'
      }
      className="gap-2"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
      <span className="font-mono text-[11px] tabular-nums">
        {refreshing ? 'Reading…' : error ? 'Stale' : age}
      </span>
    </Button>
  );
}

/**
 * How old the data on screen is, in words, re-rendered on its own clock.
 *
 * Ticks every fifteen seconds rather than every second: the number is read at a
 * glance to answer "can I trust this", and a board where something changes
 * every second trains the eye to ignore that corner of the screen.
 */
function useAge(fetchedAt: Date | null): string {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!fetchedAt) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [fetchedAt]);

  if (!fetchedAt) return 'Refresh';

  const seconds = Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 1000));
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : fetchedAt.toLocaleDateString();
}

/**
 * The read failure a pane shows above its list.
 *
 * A helper rather than a rule in prose, because the distinction it encodes is
 * the one every pane on this desk is built on: the list underneath stays
 * rendered, holding the last answer that arrived, and the banner says that what
 * is on screen may no longer be true. A pane that blanked itself because one
 * read missed would be throwing away the only board the supervisor has.
 */
export function ResourceBanner({
  error,
  refresh,
}: Pick<DeskResource<unknown>, 'error' | 'refresh'>) {
  if (!error) return null;
  return <Banner onRetry={refresh}>{error}</Banner>;
}

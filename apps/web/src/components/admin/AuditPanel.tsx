/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Everything anyone did to the ledger, and who did it.
 *
 * ## Why it is a pane
 *
 * It used to be the right-hand two thirds of Settings — the desk's most
 * cross-cutting object, filed behind the tab nobody opens, next to a card
 * explaining that no credential can be changed from this screen. It is the
 * answer to every "who moved this order", "was that refund recorded" and "when
 * did that account get blocked", which are questions asked from the Pipeline,
 * from Settlement and from a phone call, not from Settings.
 *
 * ## Why it has filters
 *
 * Because it is a few hundred rows of one shape. The colour-coding by kind was
 * doing the whole job of finding a payment reversal in a wall of grey, and
 * colour only narrows what is already on screen. An order id, an actor, or a
 * kind narrows what is on screen at all — and `AuditEvent` has carried `type`,
 * `actor` and `orderId` from the start with nothing reading them.
 *
 * ## What has not changed
 *
 * The three states. An empty trail and an unreadable one look identical if you
 * only check `length`, and this pane's entire claim is that it shows what
 * happened — so it must be able to say when it does not know. That distinction
 * is now the resource's, and it is the reason every pane holds its error rather
 * than rendering an empty list.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, FileText, ScrollText } from 'lucide-react';
import type { AuditEvent } from '@freshfold/core';
import PaneHeader from './PaneHeader';
import OrderRef from './OrderRef';
import type { DeskResource } from './useDeskResource';
import { Badge, EmptyState, Panel, type Tone } from './ui';

const LOG_TONE: Record<AuditEvent['type'], Tone> = {
  payment: 'ok',
  points: 'accent',
  stage: 'info',
  order: 'danger',
  account: 'warn',
  roster: 'info',
  /**
   * Nobody did it, and that is the point of the colour.
   *
   * A `system` entry is the hub's timer advancing a stage on elapsed time —
   * telling a customer their laundry was washed on no evidence at all. Left
   * neutral so it reads as what it is: the absence of somebody's confirmation,
   * not an action with a name behind it.
   */
  system: 'neutral',
};

/** In the desk's words rather than the schema's. */
const KIND_LABELS: Record<AuditEvent['type'], string> = {
  stage: 'Stage changes',
  order: 'Orders',
  payment: 'Payments',
  points: 'Care points',
  account: 'Accounts',
  roster: 'Roster',
  system: 'Unattributed',
};

/** The database's instant, as a date and a time. */
function when(at: string): string {
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime())
    ? at
    : parsed.toLocaleString([], {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export default function AuditPanel({ trail }: { trail: DeskResource<AuditEvent[]> }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [actor, setActor] = useState('all');

  const events = trail.data;

  /**
   * Who appears in the trail, for the filter.
   *
   * Derived from the entries rather than from the supervisor list, so it names
   * exactly the people who have actually done something — including `system`,
   * which is not a supervisor and is the one you most often want to isolate.
   */
  const actors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const event of events) {
      if (!seen.has(event.actor)) seen.set(event.actor, event.actorName || event.actor);
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((event) => {
      const matchesQuery =
        !q ||
        event.details.toLowerCase().includes(q) ||
        event.action.toLowerCase().includes(q) ||
        event.actorName.toLowerCase().includes(q) ||
        (event.orderId?.toLowerCase().includes(q) ?? false) ||
        (event.subject?.toLowerCase().includes(q) ?? false);

      return (
        matchesQuery &&
        (kind === 'all' || event.type === kind) &&
        (actor === 'all' || event.actor === actor)
      );
    });
  }, [events, query, kind, actor]);

  const filtersActive = query.trim() !== '' || kind !== 'all' || actor !== 'all';

  const unattributed = events.filter((event) => event.type === 'system').length;

  return (
    <div className="space-y-4">
      <PaneHeader
        stats={[
          { label: 'Entries read', value: events.length },
          { label: 'Showing', value: shown.length, tone: filtersActive ? 'accent' : 'neutral' },
          {
            label: 'Unattributed',
            value: unattributed,
            tone: unattributed > 0 ? 'warn' : 'neutral',
            hint: 'no name behind it',
          },
        ]}
        freshness={trail}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search the trail — order, patron, amount…',
        }}
        filters={[
          {
            label: 'Filter by kind',
            value: kind,
            onChange: setKind,
            options: [
              { value: 'all', label: 'All kinds' },
              ...(Object.keys(KIND_LABELS) as AuditEvent['type'][]).map((type) => ({
                value: type,
                label: KIND_LABELS[type],
              })),
            ],
          },
          {
            label: 'Filter by who',
            value: actor,
            onChange: setActor,
            options: [
              { value: 'all', label: 'Anyone' },
              ...actors.map(([id, name]) => ({ value: id, label: name })),
            ],
          },
        ]}
        filtersActive={filtersActive}
        onClearFilters={() => {
          setQuery('');
          setKind('all');
          setActor('all');
        }}
      />

      <Panel
        title="Audit trail"
        description="The server's record, newest first. Written by the route that performed the action, and shared by every desk."
      >
        {trail.error && events.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="The trail could not be read"
            detail={`${trail.error} Nothing has been lost — the record is on the server, and this pane will show it again once the server answers.`}
          />
        ) : events.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={trail.loading ? 'Reading the trail…' : 'No events recorded yet'}
            detail="Stage confirmations, payment settlements, points adjustments and roster changes are recorded here as they are made."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="Nothing in the trail matches"
            detail="Widen the filters, or clear them to see the whole record."
          />
        ) : (
          <div className="divide-y divide-admin-line border-t border-admin-line">
            {shown.map((event) => (
              <div key={event.id} className="flex gap-3 px-5 py-2.5">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-admin-fg-3" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={LOG_TONE[event.type]}>{event.action}</Badge>
                    <span className="font-mono text-[11px] tabular-nums text-admin-fg-3">
                      {when(event.at)}
                    </span>
                    {event.orderId && (
                      <OrderRef id={event.orderId} className="text-[11px]" />
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-admin-fg-2">
                    {event.details}
                  </p>
                  <span className="mt-0.5 block text-[11px] text-admin-fg-3">
                    {event.actorName}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * The last few things done to one order, for the Pipeline expansion.
 *
 * The trail's most common question is asked with an order already on screen —
 * "who moved this, and when" — and answering it by changing pane and filtering
 * is three steps too many. Filtered from the trail the desk already holds, so
 * this costs nothing and is exactly as fresh as the Audit pane is.
 */
export function OrderTrail({ events, orderId }: { events: AuditEvent[]; orderId: string }) {
  const mine = events.filter((event) => event.orderId === orderId).slice(0, 5);
  if (mine.length === 0) return null;

  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-medium text-admin-fg-3">
        Recent activity on this order
      </span>
      <div className="space-y-1">
        {mine.map((event) => (
          <div key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
            <span className="font-mono text-[11px] tabular-nums text-admin-fg-3">
              {when(event.at)}
            </span>
            <span className="text-admin-fg-2">{event.details}</span>
            <span className="text-admin-fg-3">— {event.actorName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

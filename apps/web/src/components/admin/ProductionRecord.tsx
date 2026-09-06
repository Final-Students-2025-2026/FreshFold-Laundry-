/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What actually happened to a load at the hub, read back.
 *
 * The desk has been writing this down for a while and had nowhere to read it.
 * `POST /orders/:id/intake` files a count per bag, the garments somebody
 * bothered to name, the machine, the batch and a note; every stage a supervisor
 * confirms files another `hub_events` row beside it. All of it went into the
 * database and none of it came back out — `GET /orders/:id/production` existed,
 * with nothing on the dashboard calling it.
 *
 * Which made the recording an act of faith. The argument for typing "Washer 3"
 * into the check-in drawer is that when three customers report the same
 * discolouration you can find what they have in common; that argument only
 * holds if somebody can look. This is the looking.
 *
 * Fetched per order, when a row is opened, for the reason {@link ProofOfService}
 * fetches its photographs there: the board polls every few seconds and a
 * production history for thirty orders is thirty histories nobody asked for.
 */

import { useEffect, useState } from 'react';
import {
  CircleCheck,
  ClipboardList,
  Factory,
  Flag,
  Shirt,
  Sparkles,
  WashingMachine,
} from 'lucide-react';
import type { Garment, HubEvent } from '@freshfold/core';
import { api, readAdminToken } from '../../services/store';

/**
 * What each recorded stage is called, and what marks it.
 *
 * `HubEvent.stage` is a bare string on the wire, so an unrecognised one is
 * shown as it was stored rather than dropped — a row that exists and cannot be
 * named is still evidence, and hiding it would be the same mistake this whole
 * component is fixing.
 */
const STAGES: Record<string, { label: string; icon: typeof WashingMachine }> = {
  intake: { label: 'Checked in', icon: ClipboardList },
  wash: { label: 'Washed', icon: WashingMachine },
  finish: { label: 'Pressed & folded', icon: Shirt },
  quality_check: { label: 'Quality check', icon: Sparkles },
};

/** Local, human-readable, and forgiving of a timestamp that is not one. */
function stamp(iso?: string): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? undefined
    : at.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export default function ProductionRecord({ orderId }: { orderId: string }) {
  const [record, setRecord] = useState<{ events: HubEvent[]; garments: Garment[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailed(false);

    const token = readAdminToken();
    if (!token) {
      setLoading(false);
      setFailed(true);
      return;
    }

    api
      .orderProduction(orderId, token)
      .then((result) => {
        if (live) setRecord(result);
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [orderId]);

  const events = record?.events ?? [];
  const garments = record?.garments ?? [];

  return (
    <div className="space-y-3 border-t border-admin-line pt-3">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-admin-fg-3">
        <Factory className="h-3 w-3" />
        Production record
      </span>

      {loading ? (
        <p className="text-[12px] text-admin-fg-3">Reading what the hub recorded…</p>
      ) : failed ? (
        <p className="text-[12px] text-admin-fg-3">
          Could not read this order’s production record from the dispatch server.
        </p>
      ) : events.length === 0 && garments.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-admin-fg-3">
          Nothing recorded at the hub yet. Entries appear here as the desk checks the load in and
          confirms each stage.
        </p>
      ) : (
        <>
          {events.length > 0 && (
            <ol className="space-y-1.5">
              {events.map((event) => {
                const stage = STAGES[event.stage];
                const Icon = stage?.icon ?? CircleCheck;
                const at = stamp(event.createdAt);

                /*
                  Machine and batch are optional and frequently both empty — a
                  stage confirmed by somebody who did not say what ran it is
                  still a stage somebody confirmed, and the row says so rather
                  than showing two blanks.
                */
                const where = [event.machine?.trim(), event.batch?.trim()]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <li
                    key={event.id}
                    className="flex gap-2.5 rounded-xl border border-admin-line bg-admin-raised px-3 py-2"
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-admin-fg-3" />
                    <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-admin-fg">
                          {stage?.label ?? event.stage}
                        </span>
                        {!!where && (
                          <span className="font-mono text-[11px] text-admin-accent">{where}</span>
                        )}
                        {!!at && (
                          <span className="font-mono text-[11px] text-admin-fg-3">{at}</span>
                        )}
                      </span>
                      <span className="block text-admin-fg-2">
                        {event.operatorName?.trim() || event.operator || 'Operator not recorded'}
                      </span>
                      {!!event.notes?.trim() && (
                        <span className="block text-admin-fg-3">“{event.notes.trim()}”</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {garments.length > 0 && (
            <div className="space-y-1.5">
              <span className="block text-[11px] text-admin-fg-3">
                {garments.length} garment{garments.length === 1 ? '' : 's'} named at check-in
              </span>
              {garments.map((garment) => (
                <div
                  key={garment.id}
                  className={`rounded-xl border px-3 py-2 text-[12px] leading-relaxed ${
                    // A flagged garment is one a claim already names. It reads
                    // first because it is the reason this pane gets opened.
                    garment.flagged
                      ? 'border-admin-warn/25 bg-admin-warn/[0.08]'
                      : 'border-admin-line bg-admin-raised'
                  }`}
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {garment.flagged && (
                      <Flag className="h-3 w-3 shrink-0 self-center text-admin-warn" />
                    )}
                    <span className="font-medium text-admin-fg">{garment.description}</span>
                    {!!garment.bagId && (
                      <span className="font-mono text-[11px] text-admin-fg-3">{garment.bagId}</span>
                    )}
                  </span>
                  {/*
                    The condition on arrival is the half that protects the
                    laundry: a stain recorded at intake is a stain that was
                    already there. Said plainly when nobody recorded one, so an
                    empty field is not read as "it arrived clean".
                  */}
                  <span className="block text-admin-fg-2">
                    {garment.condition?.trim()
                      ? `On arrival: ${garment.condition.trim()}`
                      : 'No condition was recorded on arrival.'}
                  </span>
                  <span className="block text-[11px] text-admin-fg-3">
                    Recorded by {garment.recordedBy || 'somebody at the desk'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

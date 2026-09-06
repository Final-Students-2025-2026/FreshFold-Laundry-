/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The claims desk.
 *
 * `IssueReporter` in the customer app has always taken a reason, a note and a
 * photograph, and then filed the lot into the courier's message thread, where it
 * stopped. There was no record that an issue existed, no state it could be in,
 * nobody it belonged to, no authorisation to re-treat anything, no compensation
 * and no way to close it — a supervisor scrolling a chat log was the entire
 * claims process. Meanwhile the care copy promises a garment will be "re-treated
 * at our cost", which is a commitment nothing could record, let alone honour.
 *
 * This pane is the other half. The message thread stays where it is: somebody
 * with a ruined shirt wants to talk to a person, and that conversation belongs
 * in the inbox. What is here is the part a conversation cannot do — where a
 * complaint has got to, whose it is, and how it ended.
 *
 * The two states worth understanding are `upheld` and `resolved`. Agreeing a
 * shirt was ruined and actually making the customer whole are separate events
 * that can be days apart, and the pane counts the gap between them at the top:
 * "owed" is the number of people the laundry has promised something and not yet
 * given it.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ShieldQuestion, Wallet } from 'lucide-react';
import {
  CLAIM_STATUS_LABELS,
  claimNextStates,
  isRemedyOwed,
  type Claim,
  type ClaimStatus,
} from '@freshfold/core';
import * as store from '../../services/store';
import OrderRef from './OrderRef';
import PaneHeader, { ResourceBanner } from './PaneHeader';
import type { DeskResource } from './useDeskResource';
import { Badge, Button, EmptyState, Field, Input, Panel, type Tone } from './ui';

/** How each state reads as a chip. */
const TONES: Record<ClaimStatus, Tone> = {
  open: 'warn',
  investigating: 'info',
  upheld: 'danger',
  rejected: 'neutral',
  resolved: 'ok',
};

/** The button that moves a claim into each state, in the desk's own words. */
const ACTIONS: Record<ClaimStatus, string> = {
  open: 'Reopen',
  investigating: 'Look into it',
  upheld: 'Uphold',
  rejected: 'Not upheld',
  resolved: 'Settle',
};

function when(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

export default function ClaimsPanel({
  claims: resource,
  onHandled,
  onFailed,
}: {
  /**
   * The whole queue, held by the shell.
   *
   * `all: true`, always — the shell needs every claim to count the ones still
   * owed for the rail, and filtering to the unsettled ones is a decision about
   * what to *show*, which belongs here rather than in a second request. It used
   * to be a server round-trip: flipping "Show all" re-fetched.
   */
  claims: DeskResource<Claim[]>;
  /** A sentence for the toast. */
  onHandled: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const all = resource.data;
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');

  /** The claim whose form is open, and what has been typed into it. */
  const [editing, setEditing] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [compensation, setCompensation] = useState('');
  const [retreatment, setRetreatment] = useState(false);
  const [busy, setBusy] = useState(false);

  const owed = useMemo(() => all.filter(isRemedyOwed).length, [all]);
  const open = useMemo(() => all.filter((claim) => claim.status === 'open').length, [all]);

  /**
   * What a supervisor is still on the hook for.
   *
   * `resolved` and `rejected` are the two endings, so anything else is a claim
   * somebody is still waiting on. Filtered here rather than asked for, so
   * flipping the toggle is instant and the counts above never disagree with the
   * list below them.
   */
  const claims = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((claim) => {
      const unfinished = claim.status !== 'resolved' && claim.status !== 'rejected';
      const matchesQuery =
        !q ||
        claim.jobId.toLowerCase().includes(q) ||
        claim.customerEmail.toLowerCase().includes(q) ||
        claim.kind.toLowerCase().includes(q) ||
        claim.description.toLowerCase().includes(q);

      return matchesQuery && (showAll || unfinished);
    });
  }, [all, showAll, query]);

  const loading = resource.loading;

  const openForm = (claim: Claim) => {
    setEditing(claim.id);
    setResolution(claim.resolution);
    setCompensation(claim.compensation > 0 ? claim.compensation.toFixed(2) : '');
    setRetreatment(claim.retreatment);
  };

  const move = async (claim: Claim, status: ClaimStatus): Promise<void> => {
    const token = store.readAdminToken();
    if (!token) {
      onFailed('This desk is not signed in, so nothing was recorded.');
      return;
    }

    setBusy(true);
    try {
      await store.api.updateClaim(
        claim.id,
        {
          status,
          resolution: resolution.trim(),
          // Only sent on the move that actually pays. The server credits the
          // wallet before it writes the row, keyed on the claim id, so clicking
          // twice pays once.
          compensation: status === 'resolved' ? Number(compensation) || 0 : undefined,
          retreatment,
        },
        token,
      );

      setEditing(null);
      // The shell re-reads the queue and the trail; this pane holds neither.
      onHandled(`${claim.id} — ${CLAIM_STATUS_LABELS[status].toLowerCase()}`);
    } catch (e) {
      onFailed(e instanceof Error ? e.message : 'That could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PaneHeader
        stats={[
          { label: 'Open', value: open, tone: open > 0 ? 'warn' : 'neutral' },
          /*
            The number this whole pane exists for: people the laundry has agreed
            owe something and has not yet given it. A single "closed" state would
            have made this uncountable.
          */
          { label: 'Remedy owed', value: owed, tone: owed > 0 ? 'danger' : 'ok', hint: 'promised, not given' },
          { label: 'Showing', value: claims.length, tone: 'neutral', hint: `of ${all.length}` },
        ]}
        freshness={resource}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Order, customer, or what went wrong…',
        }}
        actions={
          <Button size="sm" onClick={() => setShowAll((current) => !current)}>
            {showAll ? 'Only unsettled' : 'Show settled too'}
          </Button>
        }
        filtersActive={query.trim() !== '' || showAll}
        onClearFilters={() => {
          setQuery('');
          setShowAll(false);
        }}
        banner={<ResourceBanner error={resource.error} refresh={resource.refresh} />}
      />

      <Panel
        title={
          <span className="flex items-center gap-2">
            <ShieldQuestion className="h-4 w-4 text-admin-fg-3" />
            {showAll ? 'Every claim' : 'Claims to settle'}
          </span>
        }
        description={
          showAll
            ? 'Everything raised, settled and unsettled.'
            : 'Raised and not yet finished with. A claim leaves this list when it is settled or not upheld.'
        }
      >
        {claims.length === 0 ? (
          <EmptyState
            icon={Check}
            title={loading ? 'Reading the queue…' : showAll ? 'No claims yet' : 'Nothing outstanding'}
            detail={
              loading
                ? undefined
                : showAll
                  ? 'Problems customers report from the app appear here.'
                  : 'Every claim raised has been settled or answered.'
            }
          />
        ) : (
          <div className="space-y-2">
            {claims.map((claim) => {
              const next = claimNextStates(claim.status);
              const isEditing = editing === claim.id;

              return (
                <div
                  key={claim.id}
                  className="space-y-3 rounded-xl border border-admin-line bg-admin-raised px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={TONES[claim.status]}>
                          {CLAIM_STATUS_LABELS[claim.status]}
                        </Badge>
                        <Badge mono>{claim.kind}</Badge>
                        <OrderRef id={claim.jobId} className="text-[11px]" />
                        <span className="text-[11px] text-admin-fg-3">
                          {claim.customerEmail} · {when(claim.createdAt)}
                        </span>
                      </div>
                      <p className="text-[12px] leading-relaxed text-admin-fg-2">
                        {claim.description}
                      </p>
                      {!!claim.resolution && (
                        <p className="text-[11px] leading-relaxed text-admin-fg-3">
                          Answer given: {claim.resolution}
                        </p>
                      )}
                      {(claim.compensation > 0 || claim.retreatment) && (
                        <p className="flex flex-wrap items-center gap-2 text-[11px] text-admin-fg-3">
                          {claim.compensation > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Wallet className="h-3 w-3" />
                              GHS {claim.compensation.toFixed(2)}
                              {claim.transactionRef ? ' credited' : ' agreed'}
                            </span>
                          )}
                          {claim.retreatment && <span>re-treatment authorised</span>}
                        </p>
                      )}
                    </div>

                    {claim.photo && (
                      <img
                        src={claim.photo}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-lg border border-admin-line object-cover"
                      />
                    )}
                  </div>

                  {next.length > 0 &&
                    (isEditing ? (
                      <div className="space-y-3 rounded-lg border border-admin-line bg-admin-panel p-3">
                        <Field
                          label="What the customer is told"
                          hint="Shown to them as it is written. A rejection has to say why."
                        >
                          <Input
                            value={resolution}
                            onChange={(e) => setResolution(e.target.value)}
                            placeholder="Re-washed and returned; the mark did not come out of the collar."
                          />
                        </Field>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field
                            label="Compensation (GHS)"
                            hint="Credited to their wallet when you settle. Leave blank for none."
                          >
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={compensation}
                              onChange={(e) => setCompensation(e.target.value)}
                              placeholder="0.00"
                            />
                          </Field>

                          <label className="flex cursor-pointer items-center gap-2 self-end pb-2">
                            <input
                              type="checkbox"
                              checked={retreatment}
                              onChange={(e) => setRetreatment(e.target.checked)}
                              className="h-3.5 w-3.5 accent-admin-accent"
                            />
                            <span className="text-[12px] text-admin-fg-2">
                              Re-treat at our cost
                            </span>
                          </label>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {next.map((status) => (
                            <Button
                              key={status}
                              size="sm"
                              variant={status === 'resolved' ? 'primary' : 'secondary'}
                              disabled={busy}
                              onClick={() => void move(claim, status)}
                            >
                              {ACTIONS[status]}
                            </Button>
                          ))}
                          <Button size="sm" disabled={busy} onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        icon={claim.status === 'upheld' ? AlertTriangle : undefined}
                        variant={claim.status === 'upheld' ? 'primary' : 'secondary'}
                        onClick={() => openForm(claim)}
                      >
                        {claim.status === 'upheld' ? 'Settle this' : 'Handle'}
                      </Button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

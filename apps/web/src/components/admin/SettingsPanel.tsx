/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The session, and what cannot be changed from here.
 *
 * The audit trail used to take two thirds of this pane. It has its own tab now:
 * it is the desk's most cross-cutting record, and burying it behind the least
 * visited tab meant the answer to "who moved this order" lived one pane away
 * from every screen that asks. See `AuditPanel`.
 *
 * What is left is genuinely settings-shaped — who this desk is signed in as, and
 * the fact that no credential on the dispatch server can be altered from a
 * browser. That second card is not filler: a "master desk PIN" form used to live
 * here that stored `1212` in component state, guarded nothing, and changing it
 * changed nothing. Saying plainly that the control does not exist is worth more
 * than a control that pretends to.
 */

import { LogOut, ShieldCheck } from 'lucide-react';
import { Button, Panel } from './ui';

export default function SettingsPanel({
  supervisor,
  onSignOut,
}: {
  supervisor: string;
  /** Revokes the desk token. Mirrors the rail's own control. */
  onSignOut: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-start">
      <Panel title="Session" bodyClassName="divide-y divide-admin-line">
        <Row label="Signed in as" value={supervisor} />
        <Row label="Region" value="Kumasi operations" />
        <Row label="Authentication" value="Server-verified desk token" />
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <p className="text-[12px] leading-relaxed text-admin-fg-3">
            Signing out revokes this token. Anyone using this machine will need the desk
            password again.
          </p>
          <Button variant="danger" icon={LogOut} onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </Panel>

      <Panel title="Credentials" bodyClassName="p-4">
        <div className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-admin-fg-3" />
          <p className="text-[12px] leading-relaxed text-admin-fg-2">
            Passwords are set per supervisor and verified on the server. To change yours, or
            to add another supervisor, speak to whoever administers the dispatch server —
            nothing on this screen can alter a credential.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-[12px]">
      <span className="shrink-0 text-admin-fg-3">{label}</span>
      <span className="min-w-0 truncate text-right text-admin-fg">{value}</span>
    </div>
  );
}

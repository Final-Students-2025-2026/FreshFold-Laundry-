/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AlertCircle, Lock, ShieldCheck } from 'lucide-react';
import { ApiError } from '@freshfold/core';
import * as store from '../services/store';

/**
 * The door to the supervisor desk.
 *
 * The dashboard behind this can edit and delete the entire ledger. Until this
 * existed it was reachable by anyone who knew to type `#admin`, which is not a
 * credential — it is a URL.
 *
 * The password goes to `/api/admin/login` and comes back as a bearer token.
 * Nothing but that token and the supervisor's name is kept in the browser.
 */
export default function AdminLogin({
  onAuthenticated,
  onClose,
  notice,
}: {
  onAuthenticated: () => void;
  onClose: () => void;
  /**
   * Why the desk is looking at this form when it did not ask to be.
   *
   * Distinct from `error`, which is about the attempt just made: this is about
   * the session that ended before the form opened, and a supervisor who is
   * bounced here mid-shift is owed the reason.
   */
  notice?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your desk email and password.');
      return;
    }

    setError('');
    setBusy(true);

    try {
      await store.adminLogin(email.trim(), password);
      setPassword('');
      onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? 'Those credentials do not match.'
            : err.status === 403
              ? 'This supervisor account has been closed.'
              : err.message
        );
      } else {
        setError('Could not reach the dispatch server. Check your connection.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111] p-8 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-sage/15 text-brand-sage">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-stone-500">
              Restricted
            </p>
            <h2 className="font-serif text-xl text-white">Supervisor desk</h2>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-stone-400">
          This console edits the live order ledger. Sign in with the desk account issued to you.
        </p>

        {/* Suppressed once they have tried and been told something newer. */}
        {!!notice && !error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-brand-gold/30 bg-brand-gold/10 p-3">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold" />
            <p className="text-xs text-brand-gold-light">{notice}</p>
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="admin-email"
              className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.15em] text-stone-500"
            >
              Desk email
            </label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
              placeholder="supervisor@freshfold.com"
              autoComplete="username"
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-stone-600 focus:border-brand-sage focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.15em] text-stone-500"
            >
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError('');
              }}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-stone-600 focus:border-brand-sage focus:outline-none"
            />
          </div>

          {!!error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand-sage py-3.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-brand-sage/85 disabled:opacity-40"
          >
            {busy ? 'Verifying…' : 'Sign in to the desk'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-1 text-[11px] font-bold text-stone-500 transition hover:text-white"
          >
            Back to the website
          </button>
        </form>

        <div className="mt-6 flex items-start gap-2 border-t border-white/10 pt-4">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-sage" />
          <p className="text-[10px] leading-relaxed text-stone-500">
            Your password is compared on the dispatch server and never stored in this browser —
            only a session token is, and it expires in a week.
          </p>
        </div>
      </div>
    </div>
  );
}

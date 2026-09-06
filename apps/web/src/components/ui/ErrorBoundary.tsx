import React from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { reportError, track } from '../../services/analytics';

/**
 * What the page does when something throws.
 *
 * There was no boundary anywhere on this site, which gave every render error
 * the same outcome: React unmounts the whole tree and the customer is left
 * looking at `#0D0D0D`. No message, no way back, nothing in any log. On the
 * portal that means somebody checking whether their laundry is coming gets a
 * black screen; on the desk it means a supervisor loses the board mid-shift.
 *
 * ## The chunk case, which is the common one
 *
 * The four heavy screens are `lazy()` imports, and their `Suspense` fallback
 * was `null`. A failed chunk fetch — a dropped connection, a tunnel, a deploy
 * that rotated the hashed filenames under a tab that was left open — throws,
 * and with no boundary the throw took the page down. Before that, the `null`
 * fallback meant pressing "Book a pickup" on a slow connection did nothing
 * visible for several seconds, which reads as a broken button and gets pressed
 * again.
 *
 * Both are worth naming separately, because the fix a customer needs is
 * different: a render bug wants a retry, a chunk that never arrived wants a
 * reload, and a stale deploy wants a reload specifically.
 */
interface Props {
  children: React.ReactNode;
  /** Named in the error report, so a log line says which surface fell over. */
  context: string;
  /** What to show instead. Given `retry` so a custom shell can offer it. */
  fallback?: (state: { error: Error; retry: () => void }) => React.ReactNode;
  /** Called on the way back, e.g. to close the overlay this was wrapping. */
  onDismiss?: () => void;
}

interface State {
  error: Error | null;
  /** Bumped on retry, to force a fresh subtree rather than a re-render of the broken one. */
  attempt: number;
}

/**
 * Whether this is a chunk that did not arrive rather than code that threw.
 *
 * Every browser words it differently and none of them use an error type, so
 * this is a string match by necessity. Being wrong is cheap in both
 * directions: the two messages differ only in which recovery they lead with.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return (
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
      message
    )
  );
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (isChunkLoadError(error)) {
      track('chunk_load_failed', { context: this.props.context });
    } else {
      reportError(error, this.props.context);
    }
    if (import.meta.env.DEV) console.error(info.componentStack);
  }

  retry = (): void => {
    this.setState((previous) => ({ error: null, attempt: previous.attempt + 1 }));
  };

  reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
      // Keyed on the attempt so a retry rebuilds the subtree from scratch. Without
      // this, a component that threw out of its own state is handed that same
      // state back and throws again immediately.
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }

    if (this.props.fallback) {
      return this.props.fallback({ error, retry: this.retry });
    }

    const offline = isChunkLoadError(error);

    return (
      <div
        role="alert"
        className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-brand-charcoal/95 p-5 font-ui backdrop-blur-sm"
      >
        <div className="w-full max-w-md rounded-md border border-white/10 bg-brand-card p-6 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-md border border-brand-gold/30 bg-brand-gold/10 text-brand-gold">
            {offline ? (
              <WifiOff aria-hidden="true" className="h-5 w-5" />
            ) : (
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
            )}
          </span>

          <h2 className="mt-4 font-display text-[26px] font-medium leading-tight text-white">
            {offline ? 'That did not finish loading' : 'Something went wrong'}
          </h2>

          <p className="mx-auto mt-3 max-w-[38ch] text-body text-brand-text-muted">
            {offline
              ? 'Part of the page never arrived — usually a connection that dropped mid-download, sometimes a version of the site that has since been replaced. Nothing you were doing has been lost.'
              : 'This part of the page stopped working. Your order and your account are unaffected — the fault is on this screen, not in what you sent us.'}
          </p>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={offline ? this.reload : this.retry}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-gold px-5 py-3 text-[15px] font-semibold text-brand-charcoal transition-colors duration-200 hover:bg-brand-gold-light"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {offline ? 'Reload the page' : 'Try again'}
            </button>

            {this.props.onDismiss && (
              <button
                type="button"
                onClick={this.props.onDismiss}
                className="rounded-md border border-white/20 px-5 py-3 text-[15px] font-medium text-white transition-colors duration-200 hover:border-white/40 hover:bg-white/5"
              >
                Go back
              </button>
            )}
          </div>

          {/* The one thing that always works, on a page whose job is to get
              laundry collected. A customer who cannot use the site can still
              book by phone, and that is a better outcome than a retry loop. */}
          <p className="mt-6 border-t border-white/10 pt-5 text-body text-brand-text-muted">
            Still stuck? Call the shop on{' '}
            <a
              href="tel:+233200957165"
              className="text-brand-gold underline decoration-brand-gold/40 underline-offset-4 hover:decoration-brand-gold tnum"
            >
              +233 20 095 7165
            </a>
            .
          </p>
        </div>
      </div>
    );
  }
}

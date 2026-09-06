/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the courier captured at the two handovers, on the supervisor's desk.
 *
 * The photos and signatures have always been on the job — the rider app writes
 * them, the customer's order screen displays them — but the desk had no way to
 * look at any of it. That is backwards: the customer who says the bags never
 * arrived phones the desk, not their own app, and the desk was the one party
 * to the dispute arguing without the evidence.
 *
 * The override notes matter more than the pictures. When a courier completes a
 * handover without the other party's code, the reason they typed goes out as a
 * notification that scrolls away within the hour; from then on it lives only on
 * the job record. Here it stays attached to the order for as long as the order
 * exists, which is the point of writing it down.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ImageOff, PenLine, ShieldCheck, X } from 'lucide-react';
import { api, readAdminToken } from '../../services/store';
import type { JobProof } from '../../types';

interface Shot {
  label: string;
  uri: string;
}

/**
 * A signature the pad could not rasterise is saved as its raw stroke path with
 * this prefix. It is a string, not an image source — rendering it as one gives
 * a broken thumbnail, so it gets a placard instead.
 */
const VECTOR_SIGNATURE = 'freshfold-signature:';

/**
 * Whether this browser can actually display what the job is holding.
 *
 * Older records carry a `file:///var/mobile/...` path — the rider app used to
 * submit the camera's on-device file rather than its contents, so the job says
 * a photograph exists and points at a sandbox no other machine can read. Those
 * are stated plainly rather than rendered as a broken thumbnail, because a
 * supervisor needs to know the difference between "no photo was taken" and
 * "the photo never left the phone".
 */
function isViewable(uri: string): boolean {
  return uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://');
}

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

export default function ProofOfService({
  bookingId,
  proof,
}: {
  bookingId: string;
  proof?: JobProof;
}) {
  const [lightbox, setLightbox] = useState<Shot | null>(null);

  /**
   * The photographs, fetched for this order alone.
   *
   * `proof` off the polled list carries the override reasons but not the
   * blobs — the desk refreshes every five seconds and a board of thirty orders
   * has no business dragging thirty photographs along with it. Expanding a row
   * is the moment somebody wants to look, so that is the moment they are
   * fetched.
   */
  const [detail, setDetail] = useState<JobProof | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);

    // The desk's own token. Reading one order in full is a supervisor action —
    // this is the evidence behind a dispute, and it is not a public record.
    api
      .getBooking(bookingId, { token: readAdminToken() })
      .then((booking) => {
        if (live) setDetail(booking.proof ?? {});
      })
      .catch(() => {
        // The row still shows the override reasons from the list. A desk that
        // cannot reach the server has louder problems than a missing thumbnail.
        if (live) setDetail(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [bookingId]);

  // The overlay is dismissible with the keyboard, like every other transient
  // layer on the desk. Bound while it is open rather than for the life of the
  // row — thirty collapsed orders should not be thirty key listeners.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // Blobs from the single-order fetch; reasons from the row we already have,
  // so an exception is on screen the instant the row opens.
  const shots: Shot[] = (
    [
      { label: 'Collected', uri: detail?.pickupPhoto },
      { label: 'Signed at pickup', uri: detail?.pickupSignature },
      { label: 'Delivered', uri: detail?.deliveryPhoto },
      { label: 'Signed on delivery', uri: detail?.deliverySignature },
    ] as { label: string; uri?: string }[]
  ).filter((s): s is Shot => !!s.uri);

  const exceptions = [
    {
      key: 'dropoff',
      title: 'Checked in at the hub without the desk code',
      reason: proof?.dropoffOverrideReason,
      at: stamp(proof?.dropoffOverrideAt),
    },
    {
      key: 'delivery',
      title: 'Delivered without the customer’s code',
      reason: proof?.deliveryOverrideReason,
      at: stamp(proof?.deliveryOverrideAt),
    },
  ].filter((e) => !!e.reason);

  return (
    <div className="space-y-3 border-t border-admin-line pt-3">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-admin-fg-3">
        <ShieldCheck className="h-3 w-3" />
        Proof of service
      </span>

      {/* The exceptions read first: they are the reason anyone opens this. */}
      {exceptions.map((e) => (
        <div
          key={e.key}
          className="flex gap-2 rounded-xl border border-admin-warn/25 bg-admin-warn/[0.08] px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-admin-warn" />
          <div className="min-w-0 text-[12px] leading-relaxed">
            <span className="block font-medium text-admin-warn">
              {e.title}
              {e.at && <span className="ml-1.5 font-mono font-normal opacity-70">{e.at}</span>}
            </span>
            <span className="block text-admin-fg-2">
              Courier recorded: “{e.reason}”
            </span>
          </div>
        </div>
      ))}

      {shots.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {shots.map((shot) => {
            const isVector = shot.uri.startsWith(VECTOR_SIGNATURE);
            return (
              <div key={shot.label} className="w-[104px] space-y-1">
                {isVector ? (
                  <div className="flex h-[104px] w-[104px] flex-col items-center justify-center gap-1 rounded-xl border border-admin-line bg-admin-raised text-center">
                    <PenLine className="h-4 w-4 text-admin-fg-3" />
                    <span className="px-2 text-[10px] leading-tight text-admin-fg-3">
                      Signature on file
                    </span>
                  </div>
                ) : !isViewable(shot.uri) ? (
                  <div className="flex h-[104px] w-[104px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-admin-line-strong bg-admin-raised text-center">
                    <ImageOff className="h-4 w-4 text-admin-fg-3" />
                    <span className="px-2 text-[10px] leading-tight text-admin-fg-3">
                      Stayed on the courier’s phone
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLightbox(shot)}
                    className="block h-[104px] w-[104px] cursor-pointer overflow-hidden rounded-xl border border-admin-line bg-admin-raised transition-colors hover:border-admin-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/60"
                  >
                    <img
                      src={shot.uri}
                      alt={shot.label}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                )}
                <span className="block truncate text-[11px] text-admin-fg-3">{shot.label}</span>
              </div>
            );
          })}
        </div>
      ) : loading ? (
        <p className="text-[12px] text-admin-fg-3">Fetching what was captured…</p>
      ) : detail === null ? (
        <p className="text-[12px] text-admin-fg-3">
          Could not reach the dispatch server for this order’s proof.
        </p>
      ) : (
        <p className="text-[12px] text-admin-fg-3">
          No photo or signature was captured on this order.
        </p>
      )}

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="admin-card max-h-full w-full max-w-lg overflow-hidden rounded-2xl border border-admin-line bg-admin-panel"
            >
              <header className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13px] font-semibold text-admin-fg">{lightbox.label}</span>
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  aria-label="Close"
                  className="cursor-pointer rounded-full p-1 text-admin-fg-3 transition-colors hover:bg-white/[0.06] hover:text-admin-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <img
                src={lightbox.uri}
                alt={lightbox.label}
                className="max-h-[70vh] w-full bg-black object-contain"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

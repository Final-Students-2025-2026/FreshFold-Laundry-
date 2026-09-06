/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import QR from 'qrcode';
import { Eye, EyeOff, ScanLine, ShieldCheck } from 'lucide-react';
import { buildHandoffPayload, type Booking, type HandoffLeg, type JobStatus } from '@freshfold/core';

/**
 * The hand-off codes, on the website.
 *
 * Same codes and same QR payload as the customer app renders — see
 * `buildHandoffPayload` — so a customer can leave the booking open on a laptop
 * and still be collected from, and delivered to, correctly.
 *
 * All three legs are shown by the same component because they are the same
 * idea three times: a code held by whoever is *receiving* the bags, which the
 * rider has to be given. The delivery one is what stops somebody in a
 * FreshFold shirt walking off with a stranger's clean laundry; the drop-off
 * one is what stops a rider marking a load in at a hub they never reached.
 *
 * Two legs are customer-facing and one is not, so the surface is a prop. The
 * drop-off code belongs to the hub desk and is only ever rendered inside the
 * admin dashboard — see `PipelinePanel`.
 *
 * `qrcode` is used purely as an encoder here. Its DOM renderer wants a canvas
 * and a ref; walking the module bitmap into SVG paths keeps the mark crisp at
 * any size and inherits the page's colours.
 */

/** Which status means "the other party is standing right there". */
const ARRIVAL_STATUS: Record<HandoffLeg, JobStatus> = {
  pickup: 'arrived_at_pickup',
  dropoff: 'arrived_at_laundry',
  delivery: 'arrived_at_delivery',
};

const COPY: Record<
  HandoffLeg,
  { eyebrow: string; noun: string; idle: string; arrived: string; body: string }
> = {
  pickup: {
    eyebrow: 'Collection code',
    noun: 'collection',
    idle: 'Show this when the rider arrives',
    arrived: 'Your rider is at the door',
    body: 'Your rider scans the code, or asks for the four digits. Don’t hand over the bags to anyone who cannot check it.',
  },
  dropoff: {
    eyebrow: 'Hub drop-off code',
    noun: 'drop-off',
    idle: 'Show this when the rider reaches the hub',
    arrived: 'The rider is at the hub',
    body: 'The rider scans this, or types the four digits, to check the load in. Don’t show it until the bags are on the counter — this is the hub saying it received them.',
  },
  delivery: {
    eyebrow: 'Delivery code',
    noun: 'delivery',
    idle: 'Read this out when your order comes back',
    arrived: 'Your rider is at the door',
    body: 'Your rider types these four digits to close the job. Don’t read them out until your laundry is actually in your hands.',
  },
};

/**
 * The two places this renders. The client portal is the marketing site's dark
 * brand palette; the dashboard has its own, and a card carrying `brand-sage`
 * into a pipeline row reads as something pasted in from another product.
 *
 * Sage-light, not sage, on everything the client surface writes *in*:
 * `--color-brand-sage` measures 2.4:1 on this ground and is a fill that
 * carries white text, never an ink. It was the ink on the eyebrow and on the
 * whole reveal button here, which is the one control the card exists for.
 */
const SURFACES = {
  client: {
    wrap: '',
    idle: 'border-white/10 bg-black/30',
    arrived: 'border-brand-gold/50 bg-brand-gold/5',
    iconIdle: 'bg-white/5 text-brand-sage-light',
    iconArrived: 'bg-brand-gold/15 text-brand-gold',
    eyebrow: 'text-brand-text-muted',
    title: 'text-white',
    body: 'text-brand-text-muted',
    reveal: 'border-white/15 bg-black/40 text-white hover:border-brand-gold/60 hover:text-brand-gold',
    hide: 'text-brand-text-muted hover:text-white',
    footIcon: 'text-brand-sage-light',
    foot: 'text-brand-text-muted',
  },
  admin: {
    wrap: '',
    idle: 'border-admin-line bg-admin-raised',
    arrived: 'border-admin-accent/50 bg-admin-accent-soft',
    iconIdle: 'bg-admin-accent-soft text-admin-accent',
    iconArrived: 'bg-admin-accent/20 text-admin-accent',
    eyebrow: 'text-admin-fg-3',
    title: 'text-admin-fg',
    body: 'text-admin-fg-2',
    reveal: 'border-admin-line-strong bg-admin-bg text-admin-accent hover:border-admin-accent/50',
    hide: 'text-admin-fg-3 hover:text-admin-fg',
    footIcon: 'text-admin-accent',
    foot: 'text-admin-fg-3',
  },
} as const;

export default function HandoffCode({
  booking,
  leg = 'pickup',
  surface = 'client',
}: {
  booking: Booking;
  leg?: HandoffLeg;
  surface?: keyof typeof SURFACES;
}) {
  const [revealed, setRevealed] = useState(false);
  const code =
    leg === 'pickup'
      ? booking.pickupOtp
      : leg === 'dropoff'
        ? booking.dropoffOtp
        : booking.deliveryOtp;

  const path = useMemo(() => {
    if (!code) return null;

    try {
      const payload = buildHandoffPayload(booking.id, leg, code);
      const { modules } = QR.create(payload, { errorCorrectionLevel: 'M' });
      const count = modules.size;
      const data = modules.data;
      const quiet = 2;

      // One path for the whole code: far fewer nodes than a rect per module,
      // and it scales without seams between neighbours.
      let d = '';
      for (let y = 0; y < count; y++) {
        for (let x = 0; x < count; x++) {
          if (data[y * count + x] === 1) {
            d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
          }
        }
      }

      return { d, total: count + quiet * 2 };
    } catch {
      return null;
    }
  }, [booking.id, code, leg]);

  if (!code) return null;

  const s = SURFACES[surface];
  const copy = COPY[leg];
  const arrived = booking.rider?.jobStatus === ARRIVAL_STATUS[leg];

  return (
    <div className={`${s.wrap} rounded-md border p-5 ${arrived ? s.arrived : s.idle}`}>
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            arrived ? s.iconArrived : s.iconIdle
          }`}
        >
          <ScanLine aria-hidden="true" className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[13px] ${s.eyebrow}`}>{copy.eyebrow}</p>
          <h5 className={`text-[17px] font-medium ${s.title}`}>
            {arrived ? copy.arrived : copy.idle}
          </h5>
        </div>
      </div>

      <p className={`mt-3 text-[14px] leading-relaxed ${s.body}`}>{copy.body}</p>

      {revealed ? (
        <div className="mt-4 flex flex-col items-center gap-4">
          {path && (
            <div className="rounded-md bg-white p-3">
              <svg
                width={168}
                height={168}
                viewBox={`0 0 ${path.total} ${path.total}`}
                shapeRendering="crispEdges"
                role="img"
                aria-label={`QR code for ${copy.noun} of order ${booking.id}`}
              >
                <rect width={path.total} height={path.total} fill="#FFFFFF" />
                <path d={path.d} fill="#0B0B0B" />
              </svg>
            </div>
          )}

          <div className="flex gap-2">
            {code.split('').map((digit, index) => (
              <span
                key={index}
                className="tnum flex h-14 w-11 items-center justify-center rounded-md bg-white text-[28px] font-semibold text-black"
              >
                {digit}
              </span>
            ))}
          </div>

          <button
            onClick={() => setRevealed(false)}
            className={`flex items-center gap-1.5 text-[13px] font-medium ${s.hide}`}
          >
            <EyeOff aria-hidden="true" className="h-4 w-4" />
            Hide
          </button>
        </div>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-md border py-4 text-[14px] font-semibold transition-colors duration-200 ${s.reveal}`}
        >
          <Eye aria-hidden="true" className="h-4 w-4" />
          Show the code
        </button>
      )}

      <div className="mt-4 flex items-start gap-2">
        <ShieldCheck aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${s.footIcon}`} />
        <p className={`text-[13px] leading-relaxed ${s.foot}`}>
          The code is tied to order {booking.id} and works only for this {copy.noun}.
        </p>
      </div>
    </div>
  );
}

/**
 * The six stage illustrations for "How it works".
 *
 * Inline SVG rather than image assets: they are two colours and a handful of
 * strokes, they have to sit on an olive band *and* a charcoal panel, and they
 * animate. A PNG would be a second request, a second file at 2x, and a fixed
 * set of colours baked in at export time.
 *
 * All of it is decoration — `aria-hidden`, no text, nothing a reader would
 * miss. The stage is described in full by the prose beside it, which is also
 * why nothing here is load-bearing if the animations never run: every scene is
 * drawn in its finished position and the motion plays on top.
 */

const SAGE = 'var(--color-brand-sage-light)';
const GOLD = 'var(--color-brand-gold)';
const LINE = 'rgba(245, 245, 244, 0.55)';

interface Props {
  /** 0-indexed stage. */
  stage: number;
  className?: string;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 160"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
    >
      {children}
    </svg>
  );
}

/** 01 — A calendar with the chosen day marked. */
const BookArt = () => (
  <Frame>
    <rect x="26" y="38" width="108" height="94" rx="10" stroke={LINE} strokeWidth="3" />
    <path d="M26 62h108" stroke={LINE} strokeWidth="3" />
    <path d="M54 28v20M106 28v20" stroke={SAGE} strokeWidth="4" />
    {[0, 1, 2, 3].map((col) =>
      [0, 1].map((row) => (
        <circle
          key={`${col}-${row}`}
          cx={46 + col * 23}
          cy={82 + row * 24}
          r="4"
          fill={LINE}
          opacity="0.5"
        />
      ))
    )}
    <circle className="sa-pulse" cx="92" cy="106" r="11" fill={GOLD} />
  </Frame>
);

/** 02 — The rider, on the way. */
const CollectArt = () => (
  <Frame>
    <g>
      <path
        d="M22 96V60a6 6 0 0 1 6-6h50a6 6 0 0 1 6 6v36"
        stroke={LINE}
        strokeWidth="3"
      />
      <path d="M84 68h20l16 18v10H84z" stroke={SAGE} strokeWidth="3" />
      <path d="M22 96h98" stroke={LINE} strokeWidth="3" />
      <circle className="sa-roll" cx="48" cy="106" r="11" stroke={GOLD} strokeWidth="3" />
      <path className="sa-roll" d="M48 97v18M39 106h18" stroke={GOLD} strokeWidth="2" />
      <circle className="sa-roll" cx="104" cy="106" r="11" stroke={GOLD} strokeWidth="3" />
      <path className="sa-roll" d="M104 97v18M95 106h18" stroke={GOLD} strokeWidth="2" />
    </g>
    <path
      className="sa-dash"
      d="M8 124h144"
      stroke={SAGE}
      strokeWidth="3"
      strokeDasharray="10 14"
    />
  </Frame>
);

/** 03 — The drum, turning, with your load on its own inside. */
const WashArt = () => (
  <Frame>
    <rect x="24" y="24" width="112" height="112" rx="14" stroke={LINE} strokeWidth="3" />
    <path d="M24 50h112" stroke={LINE} strokeWidth="3" />
    <circle cx="44" cy="37" r="4" fill={LINE} opacity="0.6" />
    <circle cx="60" cy="37" r="4" fill={LINE} opacity="0.6" />
    <circle className="sa-pulse" cx="116" cy="37" r="5" fill={GOLD} />
    <circle cx="80" cy="94" r="34" stroke={LINE} strokeWidth="3" />
    <g className="sa-spin">
      <circle cx="80" cy="94" r="24" stroke={SAGE} strokeWidth="3" />
      <path d="M80 70v10M80 108v10M56 94h10M94 94h10" stroke={SAGE} strokeWidth="3" />
    </g>
    <circle className="sa-bubble" cx="68" cy="100" r="4" fill={GOLD} opacity="0" />
    <circle className="sa-bubble" cx="86" cy="104" r="3" fill={GOLD} opacity="0" />
    <circle className="sa-bubble" cx="78" cy="98" r="2.5" fill={GOLD} opacity="0" />
    <circle className="sa-bubble" cx="92" cy="96" r="3.5" fill={GOLD} opacity="0" />
  </Frame>
);

/** 04 — The press, and the steam off it. */
const PressArt = () => (
  <Frame>
    <path
      d="M42 118h76a4 4 0 0 0 4-4V96a26 26 0 0 0-26-26H64a26 26 0 0 0-26 26v18a4 4 0 0 0 4 4Z"
      stroke={LINE}
      strokeWidth="3"
    />
    <path d="M56 70V58a8 8 0 0 1 8-8h32a8 8 0 0 1 8 8v12" stroke={SAGE} strokeWidth="3" />
    <path d="M34 128h92" stroke={LINE} strokeWidth="3" />
    <path d="M58 100h44" stroke={GOLD} strokeWidth="3" />
    <path className="sa-steam" d="M62 42c6-5 0-11 6-16" stroke={SAGE} strokeWidth="3" opacity="0" />
    <path className="sa-steam" d="M80 38c6-5 0-11 6-16" stroke={SAGE} strokeWidth="3" opacity="0" />
    <path className="sa-steam" d="M98 42c6-5 0-11 6-16" stroke={SAGE} strokeWidth="3" opacity="0" />
  </Frame>
);

/** 05 — Looked over once more, and ticked off. */
const CheckArt = () => (
  <Frame>
    <rect x="26" y="46" width="76" height="18" rx="6" stroke={LINE} strokeWidth="3" />
    <rect x="26" y="72" width="76" height="18" rx="6" stroke={LINE} strokeWidth="3" />
    <rect x="26" y="98" width="76" height="18" rx="6" stroke={LINE} strokeWidth="3" />
    <path d="M40 55h12M40 81h12M40 107h12" stroke={SAGE} strokeWidth="3" />
    <circle cx="112" cy="92" r="26" stroke={LINE} strokeWidth="3" />
    <path
      className="sa-draw"
      d="M100 92l9 9 17-19"
      stroke={GOLD}
      strokeWidth="4"
    />
  </Frame>
);

/** 06 — Back at the door, folded. */
const DeliverArt = () => (
  <Frame>
    <path d="M40 132V40a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v92" stroke={LINE} strokeWidth="3" />
    <circle cx="92" cy="88" r="4" fill={SAGE} />
    <path d="M20 132h120" stroke={LINE} strokeWidth="3" />
    <rect className="sa-drop" x="56" y="112" width="52" height="16" rx="5" stroke={GOLD} strokeWidth="3" />
    <rect className="sa-drop" x="60" y="96" width="44" height="14" rx="5" stroke={SAGE} strokeWidth="3" />
    <rect className="sa-drop" x="64" y="82" width="36" height="12" rx="4" stroke={SAGE} strokeWidth="3" />
  </Frame>
);

const SCENES = [BookArt, CollectArt, WashArt, PressArt, CheckArt, DeliverArt];

export default function StageArt({ stage, className }: Props) {
  const Scene = SCENES[stage] ?? SCENES[0];
  return (
    <div className={className}>
      <Scene />
    </div>
  );
}

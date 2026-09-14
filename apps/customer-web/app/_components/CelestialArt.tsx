/**
 * Celestial artefacts for the hero, as inline SVG.
 *
 * Why SVG rather than image files: each object has to animate on its own
 * layer, and these do not exist as artwork. They are drawn from the brand
 * palette so a palette change carries through — a flattened PNG would not.
 * The one piece of real artwork is the zodiac wheel (images/logo/stella.png),
 * which is used as-is.
 *
 * REPLACEABLE: Saturn, the moon, the two planets, the crescent and the
 * armillary sphere are refined CSS/SVG stand-ins. If detailed gold artwork is
 * commissioned later, swap each <svg> for an <img> inside the same wrapper —
 * the animation layers do not change.
 *
 * Every piece here is decorative. The caller marks the whole stage
 * aria-hidden, so none of this is announced.
 */

/* `| undefined` is explicit because the project runs with
   exactOptionalPropertyTypes. CSS-module lookups are typed `string |
   undefined`, so an optional-but-not-undefined prop would reject every
   `className={s.thing}` at the call site. */
type P = { className?: string | undefined };

/* Shared metallic ramps. IDs are prefixed to avoid colliding with any other
   inline SVG on the page. */
export function CelestialDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <radialGradient id="st-gold" cx="32%" cy="28%" r="78%">
          <stop offset="0%" stopColor="var(--cream)" />
          <stop offset="52%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--ink)" />
        </radialGradient>
        <radialGradient id="st-terra" cx="30%" cy="26%" r="80%">
          <stop offset="0%" stopColor="var(--cream)" />
          <stop offset="46%" stopColor="var(--cta)" />
          <stop offset="100%" stopColor="var(--ink)" />
        </radialGradient>
        <radialGradient id="st-jade" cx="30%" cy="26%" r="80%">
          <stop offset="0%" stopColor="var(--cream)" />
          <stop offset="48%" stopColor="var(--leaf)" />
          <stop offset="100%" stopColor="var(--ink)" />
        </radialGradient>
        <radialGradient id="st-moon" cx="34%" cy="30%" r="76%">
          <stop offset="0%" stopColor="var(--surface-2)" />
          <stop offset="60%" stopColor="var(--cream)" />
          <stop offset="100%" stopColor="var(--ink-soft)" />
        </radialGradient>
        <linearGradient id="st-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cream)" />
          <stop offset="50%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--ink-soft)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Ringed Saturn. The ring is part of the same SVG, so it floats attached. */
export function Saturn({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <g transform="rotate(-22 100 100)">
        <ellipse cx="100" cy="100" rx="94" ry="26" fill="none"
                 stroke="url(#st-ring)" strokeWidth="9" opacity=".55" />
        <circle cx="100" cy="100" r="52" fill="url(#st-gold)" />
        {/* banding */}
        <path d="M52 88h96M50 100h100M54 113h92" stroke="var(--ink)"
              strokeWidth="2" opacity=".14" strokeLinecap="round" />
        {/* front half of the ring, drawn over the body */}
        <path d="M6 100a94 26 0 0 0 188 0" fill="none"
              stroke="url(#st-ring)" strokeWidth="9" opacity=".95" />
      </g>
    </svg>
  );
}

/** Softly textured moon. */
export function Moon({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="56" fill="url(#st-moon)" />
      <g fill="var(--ink-soft)" opacity=".2">
        <circle cx="44" cy="42" r="11" />
        <circle cx="76" cy="66" r="8" />
        <circle cx="52" cy="82" r="6" />
        <circle cx="86" cy="38" r="4.5" />
        <circle cx="34" cy="68" r="4" />
      </g>
    </svg>
  );
}

export function TerracottaPlanet({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="56" fill="url(#st-terra)" />
      <g fill="var(--ink)" opacity=".16">
        <ellipse cx="46" cy="48" rx="16" ry="10" />
        <ellipse cx="78" cy="76" rx="12" ry="7" />
      </g>
    </svg>
  );
}

export function JadePlanet({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="56" fill="url(#st-jade)" />
      <ellipse cx="52" cy="54" rx="18" ry="9" fill="var(--surface)" opacity=".16" />
    </svg>
  );
}

/** Golden crescent — a circle with a circle subtracted, so the edge stays true. */
export function Crescent({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <mask id="st-crescent-mask">
        <rect width="120" height="120" fill="black" />
        <circle cx="60" cy="60" r="52" fill="white" />
        <circle cx="86" cy="50" r="46" fill="black" />
      </mask>
      <g transform="rotate(18 60 60)">
        <circle cx="60" cy="60" r="52" fill="url(#st-gold)" mask="url(#st-crescent-mask)" />
      </g>
    </svg>
  );
}

/** Armillary sphere: meridian rings on a turned stand. */
export function Armillary({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 200 220" aria-hidden="true" focusable="false">
      <g fill="none" stroke="url(#st-ring)" strokeWidth="3.4">
        <circle cx="100" cy="92" r="70" />
        <ellipse cx="100" cy="92" rx="70" ry="24" />
        <ellipse cx="100" cy="92" rx="26" ry="70" />
        <ellipse cx="100" cy="92" rx="70" ry="48" transform="rotate(-24 100 92)" />
      </g>
      <circle cx="100" cy="92" r="7" fill="url(#st-gold)" />
      {/* stand */}
      <g stroke="url(#st-ring)" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M100 162v34" />
        <path d="M74 200h52" />
        <path d="M84 196c8-6 24-6 32 0" />
      </g>
    </svg>
  );
}

/** Four-point star used for the eyebrow lozenge and the scattered stars. */
export function Spark({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 0c1.1 6.4 5.5 10.8 12 12-6.5 1.2-10.9 5.6-12 12-1.1-6.4-5.5-10.8-12-12C6.5 10.8 10.9 6.4 12 0Z"
            fill="var(--accent)" />
    </svg>
  );
}

/** Sparse constellation: joined points, drawn once behind the artefacts. */
export function Constellation({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 400 400" aria-hidden="true" focusable="false"
         preserveAspectRatio="none">
      <g stroke="var(--accent)" strokeWidth="1" opacity=".38" fill="none">
        <path d="M34 62 L92 96 L138 58 L196 84" />
        <path d="M268 306 L318 268 L366 292" />
      </g>
      <g fill="var(--accent)" opacity=".55">
        {[[34, 62], [92, 96], [138, 58], [196, 84], [268, 306], [318, 268], [366, 292]].map(
          ([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.4" />,
        )}
      </g>
    </svg>
  );
}

/** Inline arrow for the primary action. Not an emoji, and not a text glyph. */
export function ArrowUpRight({ className }: P) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16"
         aria-hidden="true" focusable="false">
      <path d="M4 12L12 4M12 4H5.5M12 4v6.5" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

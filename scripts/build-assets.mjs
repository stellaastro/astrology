#!/usr/bin/env node
/**
 * Derive web-ready assets from the brand originals.
 *
 * Two problems this solves, both of which would otherwise ship:
 *
 *   1. WEIGHT. The brand originals are multi-megabyte PNGs. Serving one to
 *      every visitor on Indian mobile 4G is several seconds of blank page, on a
 *      site whose entire audience arrives from three directors' phones. WebP at
 *      the sizes actually displayed is roughly a tenth of it.
 *
 *   2. DUPLICATION. Copying originals into public/ means git stores both, and
 *      every re-export doubles again — permanently, because git keeps binary
 *      history forever. Generated output is gitignored and rebuilt instead.
 *
 * Originals stay untracked in images/ (see .gitignore and REPOSITORY_AUDIT.md).
 * Run via `npm run build:assets`; the web build depends on it.
 */

import sharp from 'sharp';
import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'apps/customer-web/public');
const WHEEL_SRC = join(ROOT, 'images/logo/stella.png');
mkdirSync(OUT, { recursive: true });

const kb = (p) => (statSync(p).size / 1024).toFixed(0);

/* SKY_TOP must equal --surface. The hero's painted sky sits directly against
   the page ground, so a mismatch shows as a seam along the fold.
   contrast-lint.mjs reads this file and fails if the two diverge. */
const HERO_GROUND = '#FFF8E8';   // --surface
const SKY_HORIZON = '#F4E1BA';   // --cream

if (!existsSync(WHEEL_SRC)) {
  console.error(`build-assets: missing original ${WHEEL_SRC}`);
  process.exit(1);
}

let before = statSync(WHEEL_SRC).size;
let after = 0;

const emit = (file, width, bytes) => {
  after += bytes;
  console.log(`  ${file.padEnd(18)} ${String(width).padStart(5)}px  ${(bytes / 1024).toFixed(0).padStart(5)} KB`);
};

/* ── Brand mark ──────────────────────────────────────────────────
   Renders at 44px in the header. The original is 1254px square. */
{
  const dest = join(OUT, 'mark.webp');
  await sharp(WHEEL_SRC).resize({ width: 128 }).webp({ quality: 90, effort: 6 }).toFile(dest);
  emit('mark.webp', 128, statSync(dest).size);
}

/* ── Hero zodiac wheel ───────────────────────────────────────────
 * The central object of the hero's celestial stage, and the one piece of that
 * scene that is real artwork rather than an SVG stand-in. It renders up to
 * ~620px and rotates continuously, so it needs genuine resolution — the 128px
 * mark would visibly break up.
 *
 * Reusing images/logo/stella.png means the hero wheel and the brand mark are
 * the same drawing and cannot drift apart. It is also why the scene labels
 * signs in Devanagari (ADR-035) rather than Western glyphs.
 */
{
  const dest = join(OUT, 'wheel.webp');
  await sharp(WHEEL_SRC)
    .resize({ width: 700, withoutEnlargement: true })
    .webp({ quality: 86, effort: 6 })
    .toFile(dest);
  emit('wheel.webp', 700, statSync(dest).size);
}

/* ── Hero sky and landscape ──────────────────────────────────────
 * Supplied artwork. Drop any image into images/herosection/ and it is picked
 * up automatically on the next build — no code change, no path to edit.
 *
 * When none is present we still WRITE the file, as a palette-matched gradient.
 * Referencing a missing background would 404 on every page load and leave the
 * hero visibly unfinished; a stand-in degrades quietly and is replaced the
 * moment real artwork arrives.
 */
{
  const dir = join(ROOT, 'images/herosection');
  const dest = join(OUT, 'hero-sky.webp');
  const source = existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|avif)$/i.test(f)).sort()[0]
    : undefined;

  if (source) {
    const src = join(dir, source);
    before += statSync(src).size;
    await sharp(src)
      .resize({ width: 2000, withoutEnlargement: true })
      .webp({ quality: 80, effort: 6 })
      .toFile(dest);
    after += statSync(dest).size;
    console.log(
      `  ${'hero-sky.webp'.padEnd(18)} ${'2000'.padStart(5)}px  ${kb(dest).padStart(5)} KB  (from ${source})`,
    );
  } else {
    const w = 1600;
    const h = 900;
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
         <defs>
           <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="${HERO_GROUND}"/>
             <stop offset="58%" stop-color="#FFFDF8"/>
             <stop offset="100%" stop-color="${SKY_HORIZON}"/>
           </linearGradient>
         </defs>
         <rect width="${w}" height="${h}" fill="url(#sky)"/>
       </svg>`,
    );
    await sharp(svg).webp({ quality: 82, effort: 6 }).toFile(dest);
    after += statSync(dest).size;
    console.log(
      `  ${'hero-sky.webp'.padEnd(18)} ${String(w).padStart(5)}px  ${kb(dest).padStart(5)} KB  ` +
      `(PLACEHOLDER — drop artwork into images/herosection/ to replace)`,
    );
  }
}

/* A PNG favicon for browsers that will not take WebP for an icon. */
{
  const dest = join(OUT, 'favicon.png');
  await sharp(WHEEL_SRC).resize({ width: 64 }).png({ compressionLevel: 9 }).toFile(dest);
  emit('favicon.png', 64, statSync(dest).size);
}

const pct = (100 - (after / before) * 100).toFixed(1);
console.log(
  `\n✓ assets built — ${(before / 1024 / 1024).toFixed(2)} MB of originals ` +
  `-> ${(after / 1024).toFixed(0)} KB served (${pct}% smaller)`,
);

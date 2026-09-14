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
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'apps/customer-web/public');
mkdirSync(OUT, { recursive: true });

const kb = (p) => (statSync(p).size / 1024).toFixed(0);

/* ── The hero is COMPOSED, not resized ───────────────────────────
 *
 * It used to be a resize of stella_hero_bg1.png, which has a zodiac wheel with
 * WESTERN glyphs (♈♉♊) baked into it. The brand wheel labels every sign in
 * Devanagari (मेष · वृषभ · मिथुन), and ADR-035 makes Devanagari canonical — so
 * the old hero contradicted the brand on the same page that showed the logo.
 *
 * Composing from images/logo/stella.png instead means the hero can never drift
 * from the brand mark again: there is one wheel, and both come from it.
 *
 * Layout follows DESIGN.md §5: the wheel is the single visual anchor, held to
 * the right so the left ~45% stays a clean text zone. HERO_GROUND must equal
 * --surface or the hero shows a seam against the page; contrast-lint.mjs reads
 * this file directly and fails if they diverge.
 */
/* Geometry is chosen so the wheel SURVIVES the crop, which is the whole
 * difficulty here. The hero is a `cover` background: at a 1440x666 desktop
 * viewport the 1536-wide canvas scales to ~843px tall and ~88px is cut from the
 * top and bottom. A circular sacred diagram cropped through its crown ornament
 * looks like a mistake, so the wheel's vertical margin must exceed that cut.
 *
 *   margin = (HERO_H - WHEEL) / 2 = 120px  ->  112px after scaling
 *   worst-case cut at 1440x666            ->   88px
 *
 * ~24px of headroom. Widen HERO_H or shrink WHEEL if the hero's min-height
 * changes; do not just make the wheel bigger because it looks good at one size.
 */
const HERO_W = 1536;
const HERO_H = 900;
const HERO_GROUND = '#FFF8E8';   // must equal --surface
const WHEEL = 660;               // anchor size; centre lands ~69% across

/* Mobile gets its OWN composition, not a crop of the desktop one.
 *
 * Below 860px the layout changes shape entirely (DESIGN.md §5): the hero
 * becomes a ~30vh top band with the text below it. Reusing the desktop image
 * there put the wheel hard against the right edge with a slab of empty ivory
 * beside it, because the wheel occupies only the right 43% of a 1536-wide
 * canvas and `object-position` cannot claw back more than the overflow.
 *
 * 780x506 matches a 390x253 band (30vh of an 844px viewport), so `cover`
 * crops almost nothing and the wheel sits centred.
 */
const MOB_W = 780;
const MOB_H = 506;
const MOB_WHEEL = 420;

async function compose({ w, h, size, left }) {
  const wheel = await sharp(join(ROOT, 'images/logo/stella.png'))
    .resize({ width: size })
    .toBuffer();

  return sharp({
    create: { width: w, height: h, channels: 4, background: HERO_GROUND },
  })
    .composite([{
      input: wheel,
      left: left ?? Math.round((w - size) / 2),
      top: Math.round((h - size) / 2),
    }])
    .png()
    .toBuffer();
}

const composeHero = () =>
  compose({ w: HERO_W, h: HERO_H, size: WHEEL, left: HERO_W - WHEEL - 110 });

const composeHeroMobile = () =>
  compose({ w: MOB_W, h: MOB_H, size: MOB_WHEEL });   // centred

const JOBS = [
  {
    src: join(ROOT, 'images/logo/stella.png'),
    // The mark renders at 44px. It was 1254px square — 28x larger than needed.
    // Retina wants 2x, so 128 is generous and still tiny.
    out: [{ file: 'mark.webp', width: 128, quality: 90 }],
  },
];

let before = 0;
let after = 0;

for (const job of JOBS) {
  if (!existsSync(job.src)) {
    console.error(`build-assets: missing original ${job.src}`);
    process.exit(1);
  }
  before += statSync(job.src).size;

  for (const { file, width, quality } of job.out) {
    const dest = join(OUT, file);
    await sharp(job.src)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toFile(dest);
    after += statSync(dest).size;
    console.log(`  ${file.padEnd(18)} ${String(width).padStart(5)}px  ${kb(dest).padStart(5)} KB`);
  }
}

/* Two heroes, two shapes — see composeHeroMobile. No point shipping 1536px to
   a 390px screen, and no point shipping the desktop crop either. */
before += statSync(join(ROOT, 'images/logo/stella.png')).size;

for (const { file, width, quality, src } of [
  { file: 'hero.webp', width: 1536, quality: 78, src: await composeHero() },
  { file: 'hero-mobile.webp', width: 780, quality: 76, src: await composeHeroMobile() },
]) {
  const dest = join(OUT, file);
  await sharp(src)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 6 })
    .toFile(dest);
  after += statSync(dest).size;
  console.log(`  ${file.padEnd(18)} ${String(width).padStart(5)}px  ${kb(dest).padStart(5)} KB`);
}

// A PNG favicon for browsers that will not take WebP for an icon.
await sharp(join(ROOT, 'images/logo/stella.png'))
  .resize({ width: 64 })
  .png({ compressionLevel: 9 })
  .toFile(join(OUT, 'favicon.png'));
after += statSync(join(OUT, 'favicon.png')).size;
console.log(`  ${'favicon.png'.padEnd(18)} ${'64'.padStart(5)}px  ${kb(join(OUT, 'favicon.png')).padStart(5)} KB`);

const pct = (100 - (after / before) * 100).toFixed(1);
console.log(
  `\n✓ assets built — ${(before / 1024 / 1024).toFixed(2)} MB of originals ` +
  `-> ${(after / 1024).toFixed(0)} KB served (${pct}% smaller)`,
);

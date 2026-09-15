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

/* ── Dedicated hero foreground ──────────────────────────────────
 * Independent from the header logo. Preserve alpha so the supplied landscape
 * remains visible around the antique astrolabe and planets.
 */
{
  const src = join(ROOT, 'images/celestial/assembly.png');
  if (!existsSync(src)) throw new Error(`Missing hero artwork: ${src}`);
  before += statSync(src).size;
  for (const [file, width] of [['celestial-assembly.webp', 1200], ['celestial-assembly-mobile.webp', 640]]) {
    const dest = join(OUT, file);
    await sharp(src).resize({ width, withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 100, effort: 6 }).toFile(dest);
    emit(file, width, statSync(dest).size);
  }
}

/* Independently animated objects from the edited sprite sheet. The generator
 * supplied a neutral checkerboard; remove only connected neutral backdrop
 * pixels, preserving the warm artwork and its internal detail. */
{
  const src = join(ROOT, 'images/celestial/separated-sheet.png');
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const seen = new Uint8Array(width * height);
  const queue = [];
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index]) return;
    seen[index] = 1;
    const i = index * 4;
    const spread = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    if (spread > 18 || data[i] < 70) return;
    data[i + 3] = 0;
    queue.push(index);
  };
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  for (let n = 0; n < queue.length; n++) {
    const x = queue[n] % width, y = Math.floor(queue[n] / width);
    visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  const objects = [
    ['main-dial', 0, 60, 560, 605],
    ['moon', 558, 260, 301, 330],
    ['saturn', 857, 260, 397, 330],
    ['mars', 35, 765, 395, 400],
    ['jade', 525, 830, 295, 290],
    ['crescent', 900, 750, 320, 410],
  ];
  for (const [name, left, top, w, h] of objects) {
    const file = `celestial-${name}.webp`;
    await sharp(data, { raw: info }).extract({ left, top, width: w, height: h })
      .webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(join(OUT, file));
    emit(file, w, statSync(join(OUT, file)).size);
  }
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
    ? (existsSync(join(dir, 'hero_bg.png')) ? 'hero_bg.png' : readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|avif)$/i.test(f)).sort()[0])
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

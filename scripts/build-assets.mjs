#!/usr/bin/env node
/**
 * Derive web-ready assets from the brand originals.
 *
 * Two problems this solves, both of which would otherwise ship:
 *
 *   1. WEIGHT. stella_hero_bg1.png is a 3.2 MB PNG at 1536x1024. Serving that
 *      to every visitor on Indian mobile 4G is several seconds of blank page,
 *      on a site whose entire audience arrives from three directors' phones.
 *      WebP at the sizes actually displayed is roughly a tenth of it.
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

const JOBS = [
  {
    src: join(ROOT, 'images/stella_hero_bg1.png'),
    // Two widths: the CSS background at desktop, and the cropped top band
    // used below 860px. No point shipping 1536px to a 375px screen.
    out: [
      { file: 'hero.webp', width: 1536, quality: 78 },
      { file: 'hero-mobile.webp', width: 768, quality: 76 },
    ],
  },
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

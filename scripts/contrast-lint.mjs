#!/usr/bin/env node
/**
 * Contrast lint — enforces ADR-001 and ADR-025.
 *
 * Two jobs:
 *   1. Recompute every token pair's contrast ratio from the actual hex values
 *      in tokens.css and fail if a pair documented as AA/AAA no longer is.
 *      Catches someone "brightening" --ink-soft without rechecking.
 *   2. Fail if --accent (gold, 2.96:1 on ivory) is used as text or a fill.
 *      Gold is ornament only. This is the rule people remove because the
 *      brand's most recognisable colour looks tempting as a heading.
 *
 * Verify this gate works by adding `color: var(--accent)` to body text and
 * confirming the build fails. A gate nobody has seen fail is not a gate.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TOKENS = join(ROOT, 'packages/design-system/tokens.css');

/* ── WCAG 2.1 relative luminance ─────────────────────────────── */
const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ({ r, g, b }) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const hex = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/* ── Read tokens ─────────────────────────────────────────────── */
let css;
try {
  css = readFileSync(TOKENS, 'utf8');
} catch {
  console.error(`contrast-lint: cannot read ${TOKENS}`);
  process.exit(2);
}

const tokens = Object.fromEntries(
  [...css.matchAll(/^\s*(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/gm)]
    .map(([, name, value]) => [name, value]),
);

/* ── 1. Ratios that must hold ────────────────────────────────── */
// [foreground, background, minimum, why]
const PAIRS = [
  ['--ink',      '--surface',     7.0, 'body and heading text, AAA'],
  ['--ink-soft', '--surface',     4.5, 'secondary text, AA'],
  ['--cta',      '--surface',     4.5, 'buttons and links, AA'],
  ['--surface',  '--cta',         4.5, 'ivory text on bronze fill, AA'],
  ['--visited',  '--surface',     4.5, 'visited links, AA'],
  ['--dark-text','--dark-ground', 7.0, 'text on dark surfaces, AAA'],
  ['--dark-soft','--dark-ground', 4.5, 'secondary text on dark, AA'],
];

const failures = [];

for (const [fg, bg, min, why] of PAIRS) {
  const a = hex(tokens[fg] ?? ''), b = hex(tokens[bg] ?? '');
  if (!a || !b) {
    failures.push(`missing or malformed token in pair ${fg} / ${bg}`);
    continue;
  }
  const ratio = contrast(a, b);
  if (ratio < min) {
    failures.push(
      `${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ≥${min}:1 — ${why}`,
    );
  }
}

/* --accent must stay below AA. If it ever passes, someone changed the gold
   and the ornament-only rule may no longer be necessary — that is a design
   decision, not a silent edit, so fail loudly and make them update ADR-001. */
const accent = hex(tokens['--accent'] ?? '');
const surface = hex(tokens['--surface'] ?? '');
if (accent && surface) {
  const ratio = contrast(accent, surface);
  if (ratio >= 4.5) {
    failures.push(
      `--accent is now ${ratio.toFixed(2)}:1 on --surface and would pass AA. ` +
      `The ornament-only rule in ADR-001 assumes it fails. Update the ADR ` +
      `deliberately or revert the colour.`,
    );
  }
}

/* ── 2. --accent must never be text or a fill ────────────────── */
const BANNED = [
  { re: /(^|[^-\w])color\s*:\s*var\(\s*--accent\s*\)/g,             what: 'color: var(--accent)' },
  { re: /background(-color)?\s*:\s*var\(\s*--accent\s*\)/g,          what: 'background: var(--accent)' },
  { re: /-webkit-text-fill-color\s*:\s*var\(\s*--accent\s*\)/g,      what: 'text-fill-color: var(--accent)' },
];

/* Permitted: borders, outlines, rules, shadows, gradients, SVG stroke. */
const SCAN_EXT = new Set(['.css', '.scss', '.tsx', '.jsx', '.ts', '.js', '.html']);
const SKIP_DIR = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'images', '.gstack']);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SCAN_EXT.has(extname(p))) out.push(p);
  }
  return out;
};

for (const file of walk(ROOT)) {
  if (file === TOKENS) continue;             // the definition itself is fine
  const text = readFileSync(file, 'utf8');
  for (const { re, what } of BANNED) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      failures.push(
        `${file.replace(ROOT, '')}:${line} — ${what}. Gold is 2.96:1 on ivory ` +
        `and fails WCAG. Use --cta for fills, --ink for text, --rule for lines.`,
      );
    }
  }
}

/* ── Report ──────────────────────────────────────────────────── */
if (failures.length) {
  console.error('\n✗ contrast lint failed\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nSee DESIGN.md §1 and ADR-001.\n');
  process.exit(1);
}

console.log('✓ contrast lint passed — token ratios hold, no gold used as text or fill');

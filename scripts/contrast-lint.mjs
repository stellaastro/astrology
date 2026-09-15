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
  ['--surface',  '--cta',         4.5, 'ivory text on terracotta fill, AA'],
  ['--visited',  '--surface',     4.5, 'visited links, AA'],
  ['--dark-text','--dark-ground', 7.0, 'text on dark surfaces, AAA'],
  ['--dark-soft','--dark-ground', 4.5, 'secondary text on dark, AA'],

  /* Added with the Edition 2.0 palette (ADR-034). Lotus cream is a real
     content surface, so text on it must be checked like any other ground —
     --cta on --cream is 4.61:1, clearing AA by 0.11. That margin is too thin
     to leave to anyone's judgement, which is the entire reason it is here. */
  ['--cta',       '--cream',      4.5, 'terracotta on lotus cream — 0.11 margin'],
  ['--ink',       '--cream',      7.0, 'body text on lotus cream, AAA'],
  ['--dark-muted','--dark-ground',4.5, 'legal and footnote text on dark, AA'],

  /* Added with the band and masthead work, 2026-09-15. Each of these is a
     pairing the site now actually renders, and none of them was checked
     before — --surface-2 had been a token nothing measured. */
  ['--ink-soft',  '--cream',      4.5, 'secondary text on lotus cream bands'],
  ['--leaf',      '--cream',      4.5, 'masthead eyebrow on cream — 4.89:1, thin'],
  ['--ink',       '--surface-2',  7.0, 'text on panels, AAA'],
  ['--ink-soft',  '--surface-2',  4.5, 'secondary text on panels'],
  ['--cta',       '--surface-2',  4.5, 'the sign-in button, on its panel'],
];

/* A pairing that must NOT be used, recorded because the design doc invites it.
   DESIGN.md §1 says gold "becomes permissible for text and buttons" on dark.
   That is true of --dark-ground (5.51:1) and FALSE one shade along:
   --accent on --dark-panel is 4.43:1 and fails AA. The rule is not "gold is
   fine on dark" — it is "gold is fine on THIS dark". The ban on gold as text
   makes this unreachable today; this check exists so that if anyone ever
   relaxes that ban, the panel case fails loudly rather than shipping. */
const MUST_FAIL_AA = [
  ['--accent', '--dark-panel', 'gold as text on --dark-panel'],
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

/* Assert the recorded traps really are traps. If one starts passing, the
   palette moved and the comment above it is now a lie — which is worse than
   no comment, so fail and make someone update it deliberately. */
for (const [fg, bg, what] of MUST_FAIL_AA) {
  const a = hex(tokens[fg] ?? '');
  const b = hex(tokens[bg] ?? '');
  if (!a || !b) continue;
  const ratio = contrast(a, b);
  if (ratio >= 4.5) {
    failures.push(
      `${what} is now ${ratio.toFixed(2)}:1 and would pass AA. It was 4.43:1 ` +
      `and is documented as unusable. Update DESIGN.md §1 and this list ` +
      `together, rather than letting the note rot.`,
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
      const goldRatio = accent && surface ? contrast(accent, surface).toFixed(2) : '?';
      failures.push(
        `${file.replace(ROOT, '')}:${line} — ${what}. Gold is ${goldRatio}:1 ` +
        `on ivory and fails WCAG at every text size. Use --cta for fills, ` +
        `--ink for text, --rule for lines.`,
      );
    }
  }
}

/* ── 3. There must be exactly ONE tokens.css ─────────────────── */
/* A byte-identical copy lived in apps/customer-web/app/ until 2026-09-14. This
   lint read the package copy; the browser rendered the app copy. A palette
   change applied to one file passed CI and never reached the site. The bug is
   invisible precisely because both files look correct in isolation. */
for (const file of walk(ROOT)) {
  if (file === TOKENS) continue;
  if (!file.endsWith('tokens.css')) continue;
  failures.push(
    `${file.replace(ROOT, '')} — a second tokens.css. There must be exactly ` +
    `one, at packages/design-system/tokens.css, imported as ` +
    `'@stella/design-system/tokens.css'. Two copies mean this lint and the ` +
    `browser read different files.`,
  );
}

/* ── 4. Literal colours must agree with the tokens ───────────── */
/* Next requires a literal for themeColor, so that one duplicate is
   unavoidable — but it can still be checked rather than trusted. */
const surfaceHex = (tokens['--surface'] ?? '').toUpperCase();

/* Each entry: a pattern capturing a hex, and what that literal is for. Both of
   these are places a literal MUST equal --surface and nothing else was
   checking them. build-assets.mjs is not in SCAN_EXT, so it is read directly. */
const MUST_MATCH_SURFACE = [
  { files: () => walk(ROOT), re: /themeColor:\s*'(#[0-9a-fA-F]{6})'/,
    what: 'themeColor — the browser chrome would not match the page' },
  { files: () => [join(ROOT, 'scripts/build-assets.mjs')],
    re: /HERO_GROUND\s*=\s*'(#[0-9a-fA-F]{6})'/,
    what: 'HERO_GROUND — the composed hero would have a visible seam against the page' },
];

for (const { files, re, what } of MUST_MATCH_SURFACE) {
  for (const file of files()) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const m = re.exec(text);
    if (m && m[1].toUpperCase() !== surfaceHex) {
      failures.push(
        `${file.replace(ROOT, '')} — ${m[1]} should be --surface ` +
        `(${surfaceHex}): ${what}.`,
      );
    }
  }
}

/* The watermark's gold is a literal inside an SVG, for the same reason
   themeColor is: the file is an asset, not a stylesheet, so it cannot read a
   custom property. Same treatment as HERO_GROUND — check it rather than trust
   it, or the botanical ground keeps the old gold through the next palette
   change and nobody notices, because 6% of the wrong colour looks fine. */
const accentHex = (tokens['--accent'] ?? '').toUpperCase();
const WATERMARK = join(ROOT, 'apps/customer-web/public/botanical.svg');
try {
  const svg = readFileSync(WATERMARK, 'utf8');
  const m = /stroke="(#[0-9a-fA-F]{6})"/.exec(svg);
  if (!m) {
    failures.push(
      `apps/customer-web/public/botanical.svg — no stroke colour found. The ` +
      `watermark must carry --accent (${accentHex}) as its stroke.`,
    );
  } else if (m[1].toUpperCase() !== accentHex) {
    failures.push(
      `apps/customer-web/public/botanical.svg — stroke ${m[1]} should be ` +
      `--accent (${accentHex}): the watermark would keep the old gold ` +
      `through a palette change.`,
    );
  }
} catch {
  failures.push('apps/customer-web/public/botanical.svg is missing — the page ground would be flat.');
}

/* Hand-inlined rgba() triplets silently held the OLD ivory through a palette
   change once already. Any rgba in app CSS must match a token, or be
   greyscale (shadows and scrims, which are not brand colours). */
const tokenRgb = new Set(
  Object.values(tokens)
    .map((v) => hex(v))
    .filter(Boolean)
    .map(({ r, g, b }) => `${r},${g},${b}`),
);
for (const file of walk(ROOT)) {
  if (file === TOKENS) continue;
  if (!['.css', '.scss'].includes(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  const re = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*[,)]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [r, g, b] = [m[1], m[2], m[3]];
    if (r === g && g === b) continue;               // greyscale: shadow/scrim
    if (tokenRgb.has(`${r},${g},${b}`)) continue;   // matches a token
    const line = text.slice(0, m.index).split('\n').length;
    failures.push(
      `${file.replace(ROOT, '')}:${line} — rgba(${r}, ${g}, ${b}) matches no ` +
      `token. Inlined colours do not follow a palette change. Use ` +
      `color-mix(in srgb, var(--token) N%, transparent), or add a token.`,
    );
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

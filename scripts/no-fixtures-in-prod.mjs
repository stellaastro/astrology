#!/usr/bin/env node
/**
 * Fixture containment — the CI half of ADR-026.
 *
 * IMPORTANT, and this is why the original design was wrong: CI evaluates code,
 * not the row contents of a deployed database. You cannot fail a build over
 * data that exists in an environment. The original ADR-017 control ("CI fails
 * if any is_dev_fixture row exists in staging or production") is not
 * implementable as stated.
 *
 * The control is therefore split:
 *   - CI (this script): no seed module is reachable from a production bundle,
 *     and every seed entrypoint guards on APP_ENV.
 *   - Runtime (services/api boot check, ADR-026): the application refuses to
 *     serve if is_dev_fixture rows are present under a non-development
 *     profile. Accepted tradeoff — downtime over contaminated data, because a
 *     fake astrologer carrying a painted-on five-star badge on a registered
 *     company's site is worse than an outage.
 *
 * This script enforces the CI half only. It does not and cannot replace the
 * boot guard.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SEED_DIR = join(ROOT, 'services/api/prisma/seeds');
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'images', '.gstack']);
const CODE = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx']);

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE.has(extname(p))) out.push(p);
  }
  return out;
};

const failures = [];

/* ── 1. Every seed entrypoint must guard on APP_ENV ──────────── */

/*
 * Strip comments before looking for the guard.
 *
 * Without this the check matches COMMENT TEXT. guard.ts documents the historic
 * mistake it fixed —
 *     //   APP_ENV !== 'development' && NODE_ENV !== 'development'
 * — and that line alone satisfied the regex, so deleting the real `if` left
 * the gate reporting success. Proven by doing exactly that: the check was
 * removed, the seed became unguarded, and the gate stayed green.
 *
 * A lint that a comment can satisfy is a lint that will eventually be
 * satisfied by a comment.
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/*
 * The guard is two things, checked separately: the file must READ the
 * environment, and it must COMPARE something to 'development'.
 *
 * The previous pattern required both in one expression —
 * `APP_ENV !== 'development'` — which the real code has never matched, because
 * it reads the variable first:
 *
 *     const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unset';
 *     if (env !== 'development') { ... }
 *
 * So this check was passing on the EXPLANATORY COMMENT above that code, not on
 * the code. Strip the comments and the gate went red on a correctly guarded
 * file. Two loose halves that both have to hold describe the real shape; one
 * tight pattern described a shape nobody writes.
 */
const hasInlineGuard = (raw) => {
  const text = stripComments(raw);
  return (
    // process.env.X, not a bare mention: the variable name also appears in the
    // error message, so a bare /(APP_ENV|NODE_ENV)/ stayed satisfied after the
    // actual read was deleted. Verified by deleting it.
    /process\.env\.(APP_ENV|NODE_ENV)/.test(text) &&
    /[!=]==?\s*['"]development['"]/.test(text)
  );
};

/*
 * A seed file may DELEGATE to the shared guard instead of inlining the check —
 * but only while that guard actually contains one.
 *
 * Without this, adding a second seed file forced a choice between copying the
 * env check into every file (duplication of the one thing that must not drift)
 * or failing the gate. Delegation is the better shape: astrologers.ts calls
 * assertDevelopment() itself rather than trusting index.ts to have done it,
 * which is stronger than the original, because an exported seed function that
 * relies on its caller is guarded only until someone imports it directly.
 *
 * The delegation is accepted ONLY if guard.ts verifies. If that file ever
 * loses its check, every seed file that delegates to it fails at once — so
 * this makes the gate stricter rather than looser.
 */
const GUARD_FILE = join(SEED_DIR, 'dev/guard.ts');
let sharedGuardOk = false;
try {
  sharedGuardOk = hasInlineGuard(readFileSync(GUARD_FILE, 'utf8'));
} catch {
  sharedGuardOk = false;
}

for (const file of walk(SEED_DIR)) {
  const text = readFileSync(file, 'utf8');
  // Accept either comparison direction. The first version of this check only
  // matched `APP_ENV !== 'development'`, which pushed the seed into writing
  // its guard in a shape that turned out to be WRONG (an && that let either
  // variable authorise the run). A lint that dictates syntax it cannot verify
  // is worse than one that checks for the presence of the guard at all.
  const guards = hasInlineGuard(text) || (sharedGuardOk && /assertDevelopment\s*\(/.test(stripComments(text)));
  if (!guards) {
    failures.push(
      `${relative(ROOT, file)} — seed file has no APP_ENV/NODE_ENV guard, and ` +
      `does not call assertDevelopment() from a verified seeds/dev/guard.ts. ` +
      `A seed that can run anywhere will eventually run somewhere wrong.`,
    );
  }
}

/* ── 2. Nothing outside the seed tree may import from it ─────── */
for (const file of walk(ROOT)) {
  if (file.startsWith(SEED_DIR)) continue;
  if (file.includes('/scripts/')) continue;
  const text = readFileSync(file, 'utf8');
  const re = /(?:import[^;]*from\s*|require\s*\(\s*)['"]([^'"]*prisma\/seeds[^'"]*)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length;
    failures.push(
      `${relative(ROOT, file)}:${line} — imports '${m[1]}'. Seed modules must ` +
      `never be reachable from application code; they are dev-only (ADR-026).`,
    );
  }
}

/* ── 3. is_dev_fixture must exist in the schema if seeds do ──── */
const schema = join(ROOT, 'services/api/prisma/schema.prisma');
if (existsSync(SEED_DIR) && walk(SEED_DIR).length > 0 && existsSync(schema)) {
  if (!/is_dev_fixture|isDevFixture/.test(readFileSync(schema, 'utf8'))) {
    failures.push(
      `schema.prisma has no is_dev_fixture marker, but seed files exist. ` +
      `The boot guard cannot detect fixtures without it (ADR-026).`,
    );
  }
}

if (failures.length) {
  console.error('\n✗ fixture containment failed\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nSee ADR-026. Remember: the boot guard is the other half.\n');
  process.exit(1);
}

console.log('✓ fixture containment passed — seeds are dev-guarded and unreachable from app code');

#!/usr/bin/env node
/**
 * Migration safety gate.
 *
 * WHY THIS IS NOT "prisma migrate down": Prisma Migrate is FORWARD-ONLY. It
 * generates no down migrations, so a CI step claiming to verify "rollback
 * cleanly" is a silent no-op — it passes because nothing ran. The eng review
 * caught exactly that in the plan.
 *
 * Rollback for this project is therefore restore-from-snapshot, not a down
 * migration, and it is rehearsed against the R2 backup (ADR-032) rather than
 * asserted here. What this script CAN check statically is the class of
 * migration that makes a rollback necessary in the first place:
 *
 *   - a destructive statement with no recorded intent
 *   - a NOT NULL column added without a default, which fails on a non-empty
 *     table and is the most common broken deploy in practice
 *
 * A migration may still be destructive on purpose. Say so in a comment and
 * this passes — the goal is a deliberate decision, not a ban.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'services/api/prisma/migrations');

if (!existsSync(DIR)) {
  console.log('✓ migration check skipped — no migrations yet');
  process.exit(0);
}

const DESTRUCTIVE = [
  { re: /\bDROP\s+TABLE\b/i, what: 'DROP TABLE' },
  { re: /\bDROP\s+COLUMN\b/i, what: 'DROP COLUMN' },
  { re: /\bTRUNCATE\b/i, what: 'TRUNCATE' },
  { re: /\bDROP\s+DATABASE\b/i, what: 'DROP DATABASE' },
  { re: /\bDELETE\s+FROM\b/i, what: 'DELETE FROM' },
];

/** An acknowledgement comment anywhere in the file makes intent explicit. */
const ACK = /--\s*(intentional|destructive|reviewed|safe)\b/i;

const failures = [];
const warnings = [];

const dirs = readdirSync(DIR)
  .filter((d) => statSync(join(DIR, d)).isDirectory())
  .sort();

for (const d of dirs) {
  const file = join(DIR, d, 'migration.sql');
  if (!existsSync(file)) continue;
  const sql = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  const acknowledged = ACK.test(sql);

  for (const { re, what } of DESTRUCTIVE) {
    if (re.test(sql) && !acknowledged) {
      failures.push(
        `${rel} — contains ${what} with no acknowledgement. Add a comment ` +
          `like "-- intentional: <why, and what happens to existing rows>". ` +
          `Rollback here is restore-from-snapshot, so the cost of being wrong ` +
          `is every row written since the last backup.`,
      );
    }
  }

  // NOT NULL without a default breaks on any table that already has rows.
  // Match the WHOLE statement up to the semicolon: an earlier version stopped
  // at `NOT NULL` and so never saw the `DEFAULT` that follows it, flagging
  // correct Prisma output as unsafe. A gate that cries wolf gets switched off.
  const addNotNull = /ADD\s+COLUMN\s+`?(\w+)`?[^;]*?;/gi;
  let m;
  while ((m = addNotNull.exec(sql)) !== null) {
    const stmt = m[0];
    if (!/\bNOT\s+NULL\b/i.test(stmt)) continue;
    if (!/\bDEFAULT\b/i.test(stmt) && !acknowledged) {
      warnings.push(
        `${rel} — adds NOT NULL column \`${m[1]}\` with no DEFAULT. This ` +
          `succeeds on an empty table and fails on a populated one, so it ` +
          `passes in CI and breaks in production.`,
      );
    }
  }
}

if (failures.length) {
  console.error('\n✗ migration check failed\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}

if (warnings.length) {
  console.warn('\n⚠ migration warnings\n');
  for (const w of warnings) console.warn(`  ${w}`);
  console.warn('');
}

console.log(
  `✓ migration check passed — ${dirs.length} migration(s), no unacknowledged ` +
    `destructive statements`,
);

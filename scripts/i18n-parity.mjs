#!/usr/bin/env node
/**
 * i18n parity — every key present in one locale must exist in all others.
 *
 * Hindi is the default in India (ADR-012), so a missing `hi` key is not a
 * cosmetic gap: it renders English to a Hindi-default audience.
 *
 * next-intl is the key registry (ADR-025). This gate checks the message files
 * it consumes; it does not reimplement them.
 *
 * NOTE — this gate cannot check translation *quality*, only presence. It is
 * satisfied by machine translation, which is why DESIGN.md §9 requires legal
 * pages to stay English rather than be auto-translated.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'apps/customer-web/messages');
const REQUIRED = ['en', 'hi'];

if (!existsSync(DIR)) {
  console.log('✓ i18n parity skipped — no messages/ directory yet');
  process.exit(0);
}

const flatten = (obj, prefix = '', out = new Set()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
};

const locales = {};
for (const file of readdirSync(DIR)) {
  if (!file.endsWith('.json')) continue;
  const locale = file.replace(/\.json$/, '');
  try {
    locales[locale] = flatten(JSON.parse(readFileSync(join(DIR, file), 'utf8')));
  } catch (err) {
    console.error(`✗ i18n parity failed\n\n  ${file} is not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
}

const failures = [];

for (const locale of REQUIRED) {
  if (!locales[locale]) failures.push(`missing required locale file: ${locale}.json`);
}

const names = Object.keys(locales);
const union = new Set(names.flatMap((n) => [...locales[n]]));

for (const locale of names) {
  const missing = [...union].filter((k) => !locales[locale].has(k)).sort();
  if (missing.length) {
    failures.push(
      `${locale}.json is missing ${missing.length} key(s): ` +
      missing.slice(0, 8).join(', ') + (missing.length > 8 ? ', …' : ''),
    );
  }
}

if (failures.length) {
  console.error('\n✗ i18n parity failed\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}

console.log(
  `✓ i18n parity passed — ${union.size} keys across ${names.length} locale(s): ${names.join(', ')}`,
);

/**
 * The seed guard, in one place.
 *
 * Extracted from index.ts when the astrologer roster was added. The CI gate
 * (scripts/no-fixtures-in-prod.mjs) requires EVERY seed file to carry its own
 * environment check, and it was right to: astrologers.ts relied on index.ts
 * calling the guard first, which holds only until someone imports
 * seedAstrologers directly. A guard that protects the caller rather than the
 * dangerous function protects nothing.
 */
export function assertDevelopment(): void {
  // APP_ENV takes precedence; NODE_ENV is only the fallback when APP_ENV is
  // unset. An earlier version used
  //   APP_ENV !== 'development' && NODE_ENV !== 'development'
  // which let EITHER variable authorise the seed — so APP_ENV=production was
  // silently ignored while NODE_ENV stayed 'development', which is the normal
  // state of any Node process. Caught by actually running it, not by reading.
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unset';
  if (env !== 'development') {
    throw new Error(
      `Refusing to seed: APP_ENV/NODE_ENV is "${env}", not "development". ` +
        `Seeds must never run against staging or production (ADR-026).`,
    );
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!/_dev(\?|$)/.test(url)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL does not point at a *_dev database. ` +
        `Environment separation is the whole control here.`,
    );
  }
}

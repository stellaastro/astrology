import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing for the admin account.
 *
 * scrypt from node:crypto rather than argon2 or bcrypt: it is a real
 * memory-hard KDF, it ships with Node, and it adds no native build to a project
 * that deliberately keeps its dependency list short. bcrypt's 72-byte input
 * truncation is also a footgun this avoids.
 *
 * WHY THE PARAMETERS ARE STORED IN THE HASH. They are encoded in every string,
 * so raising the cost later does not invalidate existing hashes — an old hash
 * still verifies with its own parameters, and `needsRehash` says when to
 * upgrade it on the next successful login. A scheme that hardcodes its cost
 * cannot be strengthened without locking everyone out.
 *
 * ADR-038 makes the admin password the ONLY factor, so this is the entire
 * barrier. It is sized accordingly.
 */

/* ~64 MB, ~100ms on this class of hardware. N must be a power of two. */
const N = 2 ** 16;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
/* Node's default maxmem (32 MB) is below what N=65536 needs, so it must be
   raised explicitly or scrypt throws rather than running slower. */
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  assertUsable(password);
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupted row must
 * fail the login, not crash the endpoint and hand an attacker a 500 that
 * distinguishes one account from another.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A hostile row could otherwise ask for an allocation that stalls the process.
  if (n < 2 ** 12 || n > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, 'base64url');
    expected = Buffer.from(parts[5] as string, 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: n, r, p, maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  // Constant time. A plain === leaks how many leading bytes matched, which is
  // enough to recover a hash byte by byte given enough attempts.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}

/**
 * Minimum requirements.
 *
 * Length only, deliberately. Composition rules ("one capital, one symbol")
 * push people towards Password1! and measurably reduce entropy; length is the
 * property that actually resists a guessing attack. 12 is the floor because
 * this is the single factor protecting refunds and every lead's email address.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function assertUsable(password: string): void {
  if (typeof password !== 'string' || password.normalize('NFKC').length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  // 1024 bytes of scrypt input is a cheap way to burn CPU; cap it.
  if (password.length > 1024) throw new Error('Password is too long.');
}

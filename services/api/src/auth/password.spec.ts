import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash, MIN_PASSWORD_LENGTH } from './password';

const GOOD = 'correct-horse-battery-staple';

describe('password hashing', () => {
  it('verifies a password it hashed', async () => {
    expect(await verifyPassword(GOOD, await hashPassword(GOOD))).toBe(true);
  });

  it('rejects the wrong password', async () => {
    expect(await verifyPassword('not-the-password-at-all', await hashPassword(GOOD))).toBe(false);
  });

  /** Two identical passwords must not produce identical hashes. */
  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword(GOOD);
    const b = await hashPassword(GOOD);
    expect(a).not.toBe(b);
    expect(await verifyPassword(GOOD, a)).toBe(true);
    expect(await verifyPassword(GOOD, b)).toBe(true);
  });

  it('stores its parameters, so the cost can be raised later without lockout', async () => {
    const [scheme, n, r, p] = (await hashPassword(GOOD)).split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 16);
    expect(Number(r)).toBeGreaterThanOrEqual(8);
    expect(Number(p)).toBeGreaterThanOrEqual(1);
  });

  /**
   * A corrupted row must fail the login, not crash the endpoint — a 500 on one
   * account and a 401 on another is itself an oracle.
   */
  describe('malformed stored hashes return false rather than throwing', () => {
    for (const bad of [
      '',
      'not-a-hash',
      'scrypt$65536$8$1$onlyfiveparts',
      'bcrypt$65536$8$1$c2FsdA$a2V5',
      'scrypt$notanumber$8$1$c2FsdA$a2V5',
      'scrypt$65536$8$1$$a2V5',
      'scrypt$65536$8$1$c2FsdA$',
    ]) {
      it(JSON.stringify(bad.slice(0, 32)), async () => {
        await expect(verifyPassword(GOOD, bad)).resolves.toBe(false);
      });
    }
  });

  /** A hostile row could otherwise demand an allocation that stalls the process. */
  it('refuses absurd cost parameters instead of trying to honour them', async () => {
    await expect(verifyPassword(GOOD, 'scrypt$1099511627776$8$1$c2FsdA$a2V5')).resolves.toBe(false);
    await expect(verifyPassword(GOOD, 'scrypt$1024$8$1$c2FsdA$a2V5')).resolves.toBe(false);
  });

  it('flags a weaker hash for rehashing on next login', () => {
    expect(needsRehash('scrypt$16384$8$1$c2FsdA$a2V5')).toBe(true);
    expect(needsRehash('bcrypt$16384$8$1$c2FsdA$a2V5')).toBe(true);
  });

  it('does not flag a current hash', async () => {
    expect(needsRehash(await hashPassword(GOOD))).toBe(false);
  });

  it(`refuses a password under ${MIN_PASSWORD_LENGTH} characters`, async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/);
  });

  it('refuses an absurdly long password rather than burning CPU on it', async () => {
    await expect(hashPassword('a'.repeat(5000))).rejects.toThrow(/too long/);
  });
  /**
   * Unicode normalisation. The same password typed on two keyboards can arrive
   * as different bytes - o-umlaut is one code point or two - and without NFKC
   * the second one simply fails to log in, with nothing in the log to explain
   * why.
   */
  it('normalises, so a composed and decomposed password are the same password', async () => {
    const composed = 'passwörd-långer-1';       // precomposed
    const decomposed = 'passwörd-långer-1';   // o + diaeresis, a + ring
    expect(composed).not.toBe(decomposed);                // genuinely different bytes
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });
});

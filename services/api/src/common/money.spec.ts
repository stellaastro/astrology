import { describe, it, expect } from 'vitest';
import { Money } from './money';

describe('Money', () => {
  describe('construction', () => {
    it('accepts whole paise', () => {
      expect(Money.fromPaise(149990).paise).toBe(149990);
    });

    it('rejects fractional paise rather than rounding silently', () => {
      expect(() => Money.fromPaise(10.5)).toThrow(/whole paise/);
    });

    it('rejects amounts beyond safe integer precision', () => {
      expect(() => Money.fromPaise(Number.MAX_SAFE_INTEGER + 2)).toThrow(
        /MAX_SAFE_INTEGER/,
      );
    });

    it('converts rupees when exactly representable', () => {
      expect(Money.fromRupees(1499.9).paise).toBe(149990);
      expect(Money.fromRupees(0.01).paise).toBe(1);
    });

    it('rejects sub-paise rupee amounts instead of guessing', () => {
      expect(() => Money.fromRupees(10.001)).toThrow(/whole number of paise/);
    });

    it('parses strings with one or two decimals, or none', () => {
      expect(Money.fromString('1499.90').paise).toBe(149990);
      expect(Money.fromString('1499.9').paise).toBe(149990);
      expect(Money.fromString('1499').paise).toBe(149900);
      expect(Money.fromString('-25.50').paise).toBe(-2550);
    });

    it('rejects malformed strings', () => {
      for (const bad of ['1,499.90', '10.999', 'abc', '', '₹10', '1.2.3']) {
        expect(() => Money.fromString(bad), bad).toThrow();
      }
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts exactly', () => {
      const a = Money.fromString('0.10');
      const b = Money.fromString('0.20');
      // The whole reason this class exists: 0.1 + 0.2 !== 0.3 as floats.
      expect(a.add(b).equals(Money.fromString('0.30'))).toBe(true);
      expect(a.add(b).paise).toBe(30);
    });

    it('survives repeated addition without drift', () => {
      let total = Money.zero();
      for (let i = 0; i < 10_000; i++) total = total.add(Money.fromString('0.10'));
      expect(total.paise).toBe(100_000); // exactly ₹1,000.00
    });

    it('multiplies by a whole count', () => {
      expect(Money.fromString('499.50').times(3).paise).toBe(149850);
    });

    it('refuses a fractional multiplier and points at percentage()', () => {
      expect(() => Money.fromString('100').times(0.18)).toThrow(/percentage/);
    });
  });

  describe('percentage — GST is the real use', () => {
    it('applies half-up by default', () => {
      // 18% of 149990 paise = 26998.2 -> 26998
      expect(Money.fromPaise(149990).percentage(18).paise).toBe(26998);
    });

    it('rounds a true half up', () => {
      // 50% of 5 paise = 2.5 -> 3
      expect(Money.fromPaise(5).percentage(50).paise).toBe(3);
    });

    it('supports banker’s rounding when asked', () => {
      expect(Money.fromPaise(5).percentage(50, 'half-even').paise).toBe(2);
      expect(Money.fromPaise(15).percentage(50, 'half-even').paise).toBe(8);
    });

    it('supports floor and ceil', () => {
      expect(Money.fromPaise(5).percentage(50, 'floor').paise).toBe(2);
      expect(Money.fromPaise(5).percentage(50, 'ceil').paise).toBe(3);
    });

    it('rounds negatives away from zero on half-up, not towards +Infinity', () => {
      // Math.round(-0.5) is -0. That would quietly favour one party in a refund.
      expect(Money.fromPaise(-5).percentage(50).paise).toBe(-3);
    });
  });

  describe('allocate — parts must sum to the whole', () => {
    it('distributes an indivisible amount without losing paise', () => {
      const parts = Money.fromString('10.00').allocate(3);
      expect(parts.map((p) => p.paise)).toEqual([334, 333, 333]);
      const sum = parts.reduce((a, b) => a.add(b), Money.zero());
      expect(sum.paise).toBe(1000);
    });

    it('always reconciles, across many shapes', () => {
      for (const paise of [1, 2, 7, 100, 149990, 999999]) {
        for (const n of [1, 2, 3, 7, 11]) {
          const parts = Money.fromPaise(paise).allocate(n);
          const sum = parts.reduce((a, b) => a.add(b), Money.zero());
          expect(sum.paise, `${paise} into ${n}`).toBe(paise);
          expect(parts).toHaveLength(n);
        }
      }
    });

    it('handles negative amounts (a refund split) without losing paise', () => {
      const parts = Money.fromPaise(-1000).allocate(3);
      const sum = parts.reduce((a, b) => a.add(b), Money.zero());
      expect(sum.paise).toBe(-1000);
    });

    it('rejects a non-positive part count', () => {
      expect(() => Money.fromPaise(100).allocate(0)).toThrow();
      expect(() => Money.fromPaise(100).allocate(-1)).toThrow();
      expect(() => Money.fromPaise(100).allocate(1.5)).toThrow();
    });
  });

  describe('formatting', () => {
    it('uses Indian digit grouping', () => {
      expect(Money.fromString('1499.90').format()).toBe('₹1,499.90');
      expect(Money.fromString('100000').format()).toBe('₹1,00,000.00');
      expect(Money.fromString('12345678.05').format()).toBe('₹1,23,45,678.05');
      expect(Money.fromString('999').format()).toBe('₹999.00');
    });

    it('pads paise to two digits', () => {
      expect(Money.fromString('5.05').format()).toBe('₹5.05');
      expect(Money.fromString('5.5').format()).toBe('₹5.50');
    });

    it('formats negatives with the sign outside the symbol', () => {
      expect(Money.fromString('-25.50').format()).toBe('-₹25.50');
    });

    it('serialises to paise so JSON cannot reintroduce a float', () => {
      expect(JSON.parse(JSON.stringify({ fee: Money.fromString('1499.90') })))
        .toEqual({ fee: 149990 });
    });
  });

  describe('comparison', () => {
    it('compares and detects zero and sign', () => {
      const a = Money.fromString('10');
      const b = Money.fromString('20');
      expect(a.compare(b)).toBe(-1);
      expect(b.compare(a)).toBe(1);
      expect(a.compare(Money.fromString('10'))).toBe(0);
      expect(Money.zero().isZero()).toBe(true);
      expect(Money.fromString('-1').isNegative()).toBe(true);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { splitInclusive, taxConfigFromEnv, type TaxConfig } from './tax';

const GST18: TaxConfig = { rateBp: 1800, sacCode: '998399', placeOfSupply: 'UP' };

describe('splitting a tax-inclusive price', () => {
  /*
   * HAND-COMPUTED, not "whatever the code returns today".
   * ₹999.00 = 99900p at 18% inclusive: 99900 × 10000 / 11800 = 84661.0169…
   * → 84661 taxable, and 99900 − 84661 = 15239 tax.
   */
  it('splits ₹999 at 18% to hand-computed paise', () => {
    const t = splitInclusive(99_900, GST18);
    expect(t.taxableValuePaise).toBe(84_661);
    expect(t.taxAmountPaise).toBe(15_239);
  });

  it('splits ₹1500 at 18% to hand-computed paise', () => {
    // 150000 × 10000 / 11800 = 127118.644… → 127119; 150000 − 127119 = 22881
    const t = splitInclusive(150_000, GST18);
    expect(t.taxableValuePaise).toBe(127_119);
    expect(t.taxAmountPaise).toBe(22_881);
  });

  /**
   * THE PROPERTY THAT MATTERS. Computing both halves independently lets them
   * fail to sum to the price — off by a paisa on some prices and not others,
   * which survives every manual check and then fails reconciliation at volume.
   */
  it('ALWAYS sums back to the price, across a sweep', () => {
    for (let p = 0; p <= 500_000; p += 7) {
      const t = splitInclusive(p, GST18);
      expect(t.taxableValuePaise + t.taxAmountPaise).toBe(p);
    }
  });

  it('holds the sum property at other rates too', () => {
    for (const rateBp of [0, 500, 1200, 1800, 2800]) {
      for (let p = 0; p <= 20_000; p += 3) {
        const t = splitInclusive(p, { ...GST18, rateBp });
        expect(t.taxableValuePaise + t.taxAmountPaise).toBe(p);
      }
    }
  });

  it('charges no tax at a zero rate', () => {
    const t = splitInclusive(99_900, { ...GST18, rateBp: 0 });
    expect(t.taxableValuePaise).toBe(99_900);
    expect(t.taxAmountPaise).toBe(0);
  });

  it('returns only whole paise — never a fraction', () => {
    for (let p = 1; p < 2_000; p++) {
      const t = splitInclusive(p, GST18);
      expect(Number.isInteger(t.taxableValuePaise)).toBe(true);
      expect(Number.isInteger(t.taxAmountPaise)).toBe(true);
    }
  });

  it('rejects a fractional price rather than rounding it silently', () => {
    expect(() => splitInclusive(99_900.5, GST18)).toThrow(RangeError);
  });

  it('rejects a negative price', () => {
    expect(() => splitInclusive(-1, GST18)).toThrow(RangeError);
  });

  it('refuses a split with no SAC code — O6 is not a default', () => {
    expect(() => splitInclusive(99_900, { ...GST18, sacCode: '' })).toThrow(RangeError);
  });

  it('carries the rate, SAC and place of supply through to the snapshot', () => {
    const t = splitInclusive(99_900, GST18);
    expect(t).toMatchObject({ taxRateBp: 1800, sacCode: '998399', placeOfSupply: 'UP' });
  });
});

describe('reading the tax configuration', () => {
  const full = { GST_RATE_BP: '1800', GST_SAC_CODE: '998399', GST_PLACE_OF_SUPPLY: 'UP' };

  it('reads a complete configuration', () => {
    const r = taxConfigFromEnv(full as NodeJS.ProcessEnv);
    expect(r).toEqual({ config: { rateBp: 1800, sacCode: '998399', placeOfSupply: 'UP' } });
  });

  /**
   * NAMES WHAT IS MISSING. "Payments are not configured" sends an operator to
   * read the source; a list of variable names sends them to the right line of
   * the env file.
   */
  it('names every missing variable rather than failing at the first', () => {
    const r = taxConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(r).toEqual({
      missing: ['GST_RATE_BP', 'GST_SAC_CODE', 'GST_PLACE_OF_SUPPLY'],
    });
  });

  it('rejects a rate expressed as a percentage instead of basis points', () => {
    // "18" is a plausible typo for 1800 and would undercharge tax by a hundred
    // times without ever failing — so it has to be caught by shape, not value.
    const r = taxConfigFromEnv({ ...full, GST_RATE_BP: '18.5' } as NodeJS.ProcessEnv);
    expect(r).toHaveProperty('missing');
  });

  it('rejects a place of supply that is not a two-character state code', () => {
    const r = taxConfigFromEnv({ ...full, GST_PLACE_OF_SUPPLY: 'Uttar Pradesh' } as NodeJS.ProcessEnv);
    expect(r).toHaveProperty('missing');
  });
});

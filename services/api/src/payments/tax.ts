/**
 * GST on a consultation (task 7.2).
 *
 * Pure arithmetic, no database, no config reading — the same reason
 * `availability/slots.ts` is pure. This is the part that is easy to get subtly
 * wrong and hard to notice: a rounding rule applied in the wrong direction
 * produces an invoice that looks right and reconciles one paisa short, every
 * time, for ever.
 *
 * THREE THINGS HERE ARE OWNER DECISIONS, NOT ENGINEERING ONES (owner action
 * O6, with the CA):
 *
 *   1. the rate,
 *   2. whether Stella is PRINCIPAL or AGENT — principal charges GST on the
 *      whole consultation fee, agent charges it on the commission only, and
 *      they are different numbers on a different taxable value,
 *   3. the SAC code.
 *
 * None of them is guessed here. `TaxConfig` has no defaults and
 * `PaymentsService` refuses to create an order without one, so nothing can
 * charge a card against an invented tax split. A wrong GST figure on a real
 * invoice is a filing problem, not a bug.
 */

/** Everything the CA has to supply before money can move. */
export interface TaxConfig {
  /** Basis points: 1800 = 18%. An integer, because a percentage as a float is the same mistake as rupees as a float. */
  rateBp: number;
  /** Services Accounting Code for the supply. */
  sacCode: string;
  /** Two-character state code for the place of supply. */
  placeOfSupply: string;
}

export interface TaxSplit {
  taxableValuePaise: number;
  taxRateBp: number;
  taxAmountPaise: number;
  sacCode: string;
  placeOfSupply: string;
}

export const BP_PER_UNIT = 10_000;

/**
 * Splits a TAX-INCLUSIVE price into taxable value and tax.
 *
 * INCLUSIVE, because that is what the customer was shown. A price of ₹999 on
 * the profile page has to be ₹999 on the card statement; adding tax on top at
 * checkout would charge a number nobody agreed to, and India's consumer pricing
 * convention is inclusive anyway.
 *
 * THE TAX IS A SUBTRACTION, NOT A SECOND MULTIPLICATION. Computing both halves
 * independently and rounding each lets them fail to sum to the price — off by a
 * paisa, on some prices and not others, which is exactly the kind of drift that
 * survives every manual check and then fails reconciliation at volume. Deriving
 * one from the other makes `taxableValue + tax === price` true by construction
 * rather than by luck, and there is a test that asserts it across a sweep.
 *
 * Rounding is half-up on the taxable value, and the tax absorbs whatever is
 * left. Half-up because it is what an Indian invoice conventionally does, and
 * stated explicitly because "whatever Math.round does" is not a rounding rule.
 */
export function splitInclusive(pricePaise: number, config: TaxConfig): TaxSplit {
  if (!Number.isInteger(pricePaise) || pricePaise < 0) {
    throw new RangeError('A price must be a non-negative whole number of paise.');
  }
  if (!Number.isInteger(config.rateBp) || config.rateBp < 0) {
    throw new RangeError('A tax rate must be a non-negative whole number of basis points.');
  }
  if (!config.sacCode || !config.placeOfSupply) {
    throw new RangeError('A tax split needs a SAC code and a place of supply.');
  }

  const taxableValuePaise = Math.round(
    (pricePaise * BP_PER_UNIT) / (BP_PER_UNIT + config.rateBp),
  );

  return {
    taxableValuePaise,
    taxRateBp: config.rateBp,
    taxAmountPaise: pricePaise - taxableValuePaise,
    sacCode: config.sacCode,
    placeOfSupply: config.placeOfSupply,
  };
}

/**
 * Reads the tax configuration from the environment, or explains what is
 * missing.
 *
 * Returns null rather than throwing, and returns a REASON, because the caller
 * has to decide what to do: a health endpoint wants to report it, an order
 * request wants to refuse. Throwing at import time would take the whole API
 * down over a config value that only the payment path needs.
 */
export function taxConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { config: TaxConfig } | { missing: string[] } {
  const missing: string[] = [];
  const raw = {
    rateBp: env.GST_RATE_BP,
    sacCode: env.GST_SAC_CODE,
    placeOfSupply: env.GST_PLACE_OF_SUPPLY,
  };
  for (const [name, key] of [
    ['GST_RATE_BP', 'rateBp'],
    ['GST_SAC_CODE', 'sacCode'],
    ['GST_PLACE_OF_SUPPLY', 'placeOfSupply'],
  ] as const) {
    if (!raw[key]) missing.push(name);
  }
  if (missing.length > 0) return { missing };

  const rateBp = Number(raw.rateBp);
  if (!Number.isInteger(rateBp) || rateBp < 0) {
    return { missing: ['GST_RATE_BP (must be whole basis points, e.g. 1800 for 18%)'] };
  }
  if (raw.placeOfSupply!.length !== 2) {
    return { missing: ['GST_PLACE_OF_SUPPLY (must be a two-character state code)'] };
  }

  return { config: { rateBp, sacCode: raw.sacCode!, placeOfSupply: raw.placeOfSupply! } };
}

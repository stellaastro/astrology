/**
 * Money — integer paise, always.
 *
 * CLAUDE.md: "Money is integer paise. Never a float." This class exists so that
 * rule is enforced by the type system rather than by everyone remembering it.
 *
 * Why floats are disqualified, concretely: 0.1 + 0.2 !== 0.3 in IEEE-754. A
 * booking of ₹1,499.90 stored as a float and summed a few thousand times drifts
 * by amounts that show up in a GST return. There is no rounding strategy that
 * makes binary floating point exact for decimal currency, so the only correct
 * answer is not to use it.
 *
 * Paise, not rupees, because the smallest unit India actually transacts in is
 * the paisa, and Razorpay's API is denominated in paise too — so the boundary
 * conversion is a no-op rather than a rounding decision.
 */

export class Money {
  /** Paise. Always a safe integer, never negative unless explicitly signed. */
  private readonly p: number;

  private constructor(paise: number) {
    if (!Number.isInteger(paise)) {
      throw new RangeError(
        `Money must be whole paise, received ${paise}. If this came from a ` +
          `division, decide the rounding rule explicitly rather than letting ` +
          `the float decide it.`,
      );
    }
    if (!Number.isSafeInteger(paise)) {
      throw new RangeError(
        `Money ${paise} exceeds MAX_SAFE_INTEGER; arithmetic would silently ` +
          `lose precision.`,
      );
    }
    this.p = paise;
  }

  static fromPaise(paise: number): Money {
    return new Money(paise);
  }

  /**
   * Accepts rupees as a number ONLY when it is exactly representable, and
   * rejects anything with sub-paise precision rather than rounding silently.
   * Prefer `fromString` for anything that came from user input or a document.
   */
  static fromRupees(rupees: number): Money {
    const paise = Math.round(rupees * 100);
    if (Math.abs(rupees * 100 - paise) > 1e-9) {
      throw new RangeError(
        `${rupees} rupees is not a whole number of paise. Round deliberately ` +
          `before constructing Money.`,
      );
    }
    return new Money(paise);
  }

  /** Parses "1499.90", "1499.9", "1499", "-25.50". No thousands separators. */
  static fromString(value: string): Money {
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!m) {
      throw new RangeError(
        `"${value}" is not a valid rupee amount. Expected digits with at most ` +
          `two decimal places and no separators.`,
      );
    }
    const [, sign, whole, frac = '0'] = m;
    const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
    return new Money(sign === '-' ? -paise : paise);
  }

  static zero(): Money {
    return new Money(0);
  }

  get paise(): number {
    return this.p;
  }

  /** For display only. Never feed this back into arithmetic. */
  get rupees(): number {
    return this.p / 100;
  }

  add(other: Money): Money {
    return new Money(this.p + other.p);
  }

  subtract(other: Money): Money {
    return new Money(this.p - other.p);
  }

  /**
   * Multiplication by an integer count (e.g. three sessions at one price).
   * Deliberately does NOT accept a fractional multiplier — for percentages use
   * `percentage`, which forces a rounding decision.
   */
  times(count: number): Money {
    if (!Number.isInteger(count)) {
      throw new RangeError(
        `times() takes a whole count, received ${count}. For a rate or a ` +
          `percentage use percentage(), which makes the rounding explicit.`,
      );
    }
    return new Money(this.p * count);
  }

  /**
   * A percentage, with the rounding rule stated at the call site.
   *
   * This matters for GST: 18% of ₹1,499.90 is 26,998.2 paise. Whether that
   * becomes 26,998 or 26,999 is a policy decision, not an implementation
   * detail, and getting it wrong by one paisa on every invoice is the kind of
   * thing a tax audit finds. Default is half-up, which is the common Indian
   * commercial convention, but the caller can override.
   */
  percentage(
    percent: number,
    rounding: 'half-up' | 'half-even' | 'floor' | 'ceil' = 'half-up',
  ): Money {
    const exact = (this.p * percent) / 100;
    return new Money(round(exact, rounding));
  }

  /**
   * Splits into n parts that sum EXACTLY back to the original.
   *
   * The naive approach — divide and round each part — loses or invents paise.
   * ₹10 split three ways is 333.33 each, which sums to ₹9.99. This distributes
   * the remainder one paisa at a time across the leading parts, so the total is
   * always preserved. Necessary wherever money is decomposed (a commission
   * split, a partial refund) and the parts must reconcile to the whole.
   */
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) {
      throw new RangeError(`allocate() needs a positive integer, got ${parts}`);
    }
    const base = Math.trunc(this.p / parts);
    let remainder = this.p - base * parts;
    const step = remainder >= 0 ? 1 : -1;

    return Array.from({ length: parts }, () => {
      if (remainder !== 0) {
        remainder -= step;
        return new Money(base + step);
      }
      return new Money(base);
    });
  }

  isZero(): boolean {
    return this.p === 0;
  }

  isNegative(): boolean {
    return this.p < 0;
  }

  equals(other: Money): boolean {
    return this.p === other.p;
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.p < other.p ? -1 : this.p > other.p ? 1 : 0;
  }

  /** "₹1,499.90" — Indian digit grouping (lakh/crore), for display. */
  format(): string {
    const neg = this.p < 0;
    const abs = Math.abs(this.p);
    const rupees = Math.trunc(abs / 100);
    const paise = String(abs % 100).padStart(2, '0');
    return `${neg ? '-' : ''}₹${groupIndian(rupees)}.${paise}`;
  }

  /** Serialises as paise so a round trip through JSON cannot introduce a float. */
  toJSON(): number {
    return this.p;
  }

  toString(): string {
    return this.format();
  }
}

function round(value: number, mode: 'half-up' | 'half-even' | 'floor' | 'ceil'): number {
  switch (mode) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'half-even': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
    case 'half-up':
    default:
      // Math.round is half-up for positives but half-*towards-positive* for
      // negatives: Math.round(-0.5) is -0, not -1. Handle the sign explicitly.
      return value < 0 ? -Math.round(-value) : Math.round(value);
  }
}

/** Indian grouping: last three digits, then pairs. 1234567 -> "12,34,567". */
function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

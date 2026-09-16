/**
 * Per-minute chat billing (ADR-052).
 *
 * Pure functions, no database, because this is money arithmetic and ADR-036
 * requires it to be tested against hand-computed results rather than against
 * whatever the code currently returns.
 *
 * WHY THIS FILE EXISTS AT ALL. ADR-024 chose slot billing precisely because
 * per-minute metering leaves four questions open — prorating, start/stop,
 * pause/reconnect, and chat inactivity — and slot billing dissolves all four by
 * construction. Per-minute for chat reopens them, so each one is answered here
 * explicitly, with the reasoning, rather than falling out of whatever the
 * implementation happened to do.
 */

/** Chat is billed in whole minutes. */
export const SECONDS_PER_MINUTE = 60;

/**
 * 1. WHEN THE METER STARTS — on the ASTROLOGER'S FIRST MESSAGE.
 *
 * Not when the customer opens the chat, and not at the appointed time. A
 * customer who is waiting for the astrologer to appear is not receiving a
 * consultation, and charging them for that wait is the single most obvious way
 * to make per-minute billing feel dishonest.
 */
export const METER_STARTS_ON = 'astrologer_first_message' as const;

/**
 * 2. INACTIVITY — the meter pauses after this much silence from BOTH sides.
 *
 * Charging for silence is the most-complained-about behaviour in per-minute
 * chat, and the one H03/H04 never resolved. Two minutes is long enough to think
 * and type a considered reply, short enough that a customer who walks away is
 * not billed for the walk.
 */
export const IDLE_PAUSE_SECONDS = 120;

/**
 * 3. RECONNECTION — a drop shorter than this does not stop the meter.
 *
 * Mobile networks drop constantly. Stopping and restarting the meter on every
 * blip would end a consultation the customer is still in. Longer than this and
 * the session is treated as abandoned.
 */
export const RECONNECT_GRACE_SECONDS = 90;

/**
 * 4. ROUNDING — total billable seconds, rounded UP to the minute, ONCE.
 *
 * Rounding each interval up separately would charge six minutes for six
 * ten-second exchanges. Rounding the total once is the difference between
 * "we round up" and "we round up repeatedly", and only the first is defensible.
 *
 * A minimum of one minute applies: a consultation that produced an answer is
 * chargeable even if the answer was quick.
 */
export const MINIMUM_BILLABLE_MINUTES = 1;

export interface Interval {
  /** Seconds of wall-clock time in this stretch of conversation. */
  seconds: number;
  /** True when neither party sent anything for the whole stretch. */
  idle: boolean;
}

export interface ChatCharge {
  billableSeconds: number;
  billableMinutes: number;
  idleSecondsExcluded: number;
  pricePaise: number;
}

/**
 * What a chat consultation costs.
 *
 * `ratePerMinutePaise` is an integer, like every other money value here. A rate
 * expressed as rupees-with-decimals would reintroduce the float that
 * integer-paise Money exists to keep off this path.
 */
export function chargeForChat(
  intervals: Interval[],
  ratePerMinutePaise: number,
): ChatCharge {
  if (!Number.isInteger(ratePerMinutePaise) || ratePerMinutePaise < 0) {
    throw new RangeError('A per-minute rate must be a whole number of paise, zero or more.');
  }

  let billableSeconds = 0;
  let idleSecondsExcluded = 0;

  for (const i of intervals) {
    if (i.seconds <= 0) continue;
    if (i.idle) {
      /*
       * Idle time is excluded only BEYOND the grace period. The first two
       * minutes of a pause are still the consultation — someone is reading, or
       * typing a long answer — and billing only the overage means a normal
       * pause costs what it should while an abandoned chat does not.
       */
      const charged = Math.min(i.seconds, IDLE_PAUSE_SECONDS);
      billableSeconds += charged;
      idleSecondsExcluded += i.seconds - charged;
    } else {
      billableSeconds += i.seconds;
    }
  }

  if (billableSeconds === 0) {
    // Nothing happened: the astrologer never replied, so the meter never
    // started. No charge, rather than a minimum charge for silence.
    return { billableSeconds: 0, billableMinutes: 0, idleSecondsExcluded, pricePaise: 0 };
  }

  const billableMinutes = Math.max(
    MINIMUM_BILLABLE_MINUTES,
    Math.ceil(billableSeconds / SECONDS_PER_MINUTE),
  );

  return {
    billableSeconds,
    billableMinutes,
    idleSecondsExcluded,
    pricePaise: billableMinutes * ratePerMinutePaise,
  };
}

/**
 * The ceiling authorised at booking, and the reason a cap exists at all.
 *
 * Per-minute billing cannot be collected at booking time, because the amount is
 * unknown until afterwards. Without a wallet (ADR-023 removed it) the only way
 * to charge afterwards is to authorise a maximum up front and capture the
 * actual amount at the end — and an authorisation needs a number.
 *
 * So a chat consultation has a MAXIMUM DURATION. The customer is shown the
 * per-minute rate and the most they can possibly be charged, and is charged
 * only for what the meter recorded.
 */
export function authorisationCeilingPaise(
  maxMinutes: number,
  ratePerMinutePaise: number,
): number {
  if (!Number.isInteger(maxMinutes) || maxMinutes <= 0) {
    throw new RangeError('A chat consultation must have a positive maximum duration.');
  }
  return maxMinutes * ratePerMinutePaise;
}

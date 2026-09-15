/**
 * Slot arithmetic (task 5.1, 5.2).
 *
 * Pure functions, no database, because this is the part that is easy to get
 * subtly wrong and hard to notice: an off-by-one-slot or a half-hour timezone
 * error produces a schedule that looks plausible and books people at the wrong
 * time.
 *
 * IST IS A FIXED +05:30. India has observed no daylight saving since 1945, so
 * the conversion is exact arithmetic rather than a zone lookup, and no date
 * library is needed. **That is an assumption about India, not about time.** An
 * astrologer in a DST-observing country would need a real timezone library and
 * a zone id stored per rule; this file would then be wrong rather than merely
 * incomplete.
 */

/** Minutes east of UTC. Asia/Kolkata, fixed. */
export const IST_OFFSET_MINUTES = 330;

export interface WeeklyRule {
  weekday: number;      // 0 = Sunday … 6 = Saturday
  startMinute: number;  // minutes from midnight IST
  endMinute: number;
}

export interface Block {
  startsAt: Date;       // UTC instant
  endsAt: Date;
}

export interface Slot {
  startsAt: Date;       // UTC instant
  endsAt: Date;
}

/** The IST wall-clock view of a UTC instant. */
export function toIst(utc: Date): {
  year: number; month: number; day: number; weekday: number; minute: number;
} {
  const shifted = new Date(utc.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/**
 * The UTC instant for an IST wall-clock date and minute-of-day.
 *
 * Date.UTC treats its arguments as UTC, so the offset is SUBTRACTED to turn an
 * IST wall-clock reading into the instant it names. Adding it is the classic
 * inversion and lands everything eleven hours out.
 */
export function fromIst(year: number, month: number, day: number, minute: number): Date {
  return new Date(Date.UTC(year, month, day, 0, minute - IST_OFFSET_MINUTES));
}

/** Two half-open intervals overlap iff each starts before the other ends. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Do two weekly windows on the same weekday collide?
 *
 * MySQL has no exclusion constraints, so this is the only thing standing
 * between an astrologer and two overlapping windows that generate duplicate
 * slots for the same minute (ADR-045, same class of gap as ADR-029).
 */
export function rulesCollide(a: WeeklyRule, b: WeeklyRule): boolean {
  if (a.weekday !== b.weekday) return false;
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export interface GenerateOptions {
  rules: WeeklyRule[];
  blocks: Block[];
  sessionMinutes: number;
  /** Free time AFTER each session. Widens the stride, never the session. */
  bufferMinutes: number;
  from: Date;           // UTC, inclusive
  to: Date;             // UTC, exclusive
  /** Slots ending at or before this are dropped. Defaults to `from`. */
  now?: Date;
}

/**
 * Concrete bookable slots in [from, to).
 *
 * The stride is session + buffer, but the FIT TEST is against the session
 * alone: a window ending at 13:00 with 30-minute sessions and a 10-minute
 * buffer yields a slot at 12:30, because the buffer protects the next session
 * and there is no next session. Requiring room for the trailing buffer would
 * silently lose the last slot of every working day.
 */
export function generateSlots(opts: GenerateOptions): Slot[] {
  const { rules, blocks, sessionMinutes, bufferMinutes, from, to } = opts;
  const now = opts.now ?? from;

  if (sessionMinutes <= 0) return [];
  if (from.getTime() >= to.getTime()) return [];

  const stride = sessionMinutes + Math.max(0, bufferMinutes);
  const slots: Slot[] = [];

  // Walk IST calendar days. Start one day early and end one late: a window
  // near midnight IST belongs to a day whose UTC instants fall outside the
  // range's own day boundaries, and clipping happens per slot below anyway.
  const first = toIst(new Date(from.getTime() - 86_400_000));
  const last = toIst(new Date(to.getTime() + 86_400_000));

  for (
    let cursor = Date.UTC(first.year, first.month, first.day);
    cursor <= Date.UTC(last.year, last.month, last.day);
    cursor += 86_400_000
  ) {
    const day = new Date(cursor);
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth();
    const d = day.getUTCDate();
    const weekday = day.getUTCDay();

    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;

      for (
        let minute = rule.startMinute;
        minute + sessionMinutes <= rule.endMinute;
        minute += stride
      ) {
        const startsAt = fromIst(y, m, d, minute);
        const endsAt = new Date(startsAt.getTime() + sessionMinutes * 60_000);

        if (startsAt.getTime() < from.getTime()) continue;
        if (startsAt.getTime() >= to.getTime()) continue;
        // A slot already under way cannot be booked.
        if (endsAt.getTime() <= now.getTime()) continue;

        if (blocks.some((b) => overlaps(startsAt, endsAt, b.startsAt, b.endsAt))) continue;

        slots.push({ startsAt, endsAt });
      }
    }
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return slots;
}

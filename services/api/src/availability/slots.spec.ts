import { describe, it, expect } from 'vitest';
import {
  IST_OFFSET_MINUTES, toIst, fromIst, overlaps, rulesCollide, generateSlots,
} from './slots';

const iso = (d: Date) => d.toISOString();
/** 09:00 IST = 03:30 UTC. Every expectation below is hand-computed. */
const RANGE = { from: new Date('2026-09-14T00:00:00Z'), to: new Date('2026-09-15T00:00:00Z') };

describe('IST conversion', () => {
  it('is a fixed +05:30', () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
  });

  it('turns an IST wall clock into the instant it names', () => {
    // 2026-09-14 09:00 IST is 2026-09-14 03:30 UTC. Adding the offset instead
    // of subtracting is the classic inversion and lands eleven hours out.
    expect(iso(fromIst(2026, 8, 14, 9 * 60))).toBe('2026-09-14T03:30:00.000Z');
  });

  it('round-trips', () => {
    const utc = fromIst(2026, 8, 14, 9 * 60);
    const back = toIst(utc);
    expect([back.year, back.month, back.day, back.minute]).toEqual([2026, 8, 14, 540]);
  });

  it('handles the midnight-IST case, which falls on the PREVIOUS UTC day', () => {
    // 00:30 IST on the 14th is 19:00 UTC on the 13th. A slot near midnight
    // belongs to an IST day whose instants sit outside that day in UTC.
    expect(iso(fromIst(2026, 8, 14, 30))).toBe('2026-09-13T19:00:00.000Z');
  });

  it('reports the IST weekday, not the UTC one', () => {
    // 2026-09-14T19:30Z is 2026-09-15 01:00 IST — a different day AND weekday.
    const t = toIst(new Date('2026-09-14T19:30:00Z'));
    expect([t.day, t.weekday]).toEqual([15, new Date('2026-09-15T00:00:00Z').getUTCDay()]);
  });
});

describe('overlap', () => {
  const d = (s: string) => new Date(s);
  it('is half-open — touching intervals do not overlap', () => {
    // Back-to-back slots must not be treated as colliding, or every schedule
    // collapses to one slot per window.
    expect(overlaps(d('2026-01-01T09:00Z'), d('2026-01-01T09:30Z'),
                    d('2026-01-01T09:30Z'), d('2026-01-01T10:00Z'))).toBe(false);
  });
  it('catches a partial overlap from either side', () => {
    expect(overlaps(d('2026-01-01T09:00Z'), d('2026-01-01T09:30Z'),
                    d('2026-01-01T09:15Z'), d('2026-01-01T10:00Z'))).toBe(true);
    expect(overlaps(d('2026-01-01T09:15Z'), d('2026-01-01T10:00Z'),
                    d('2026-01-01T09:00Z'), d('2026-01-01T09:30Z'))).toBe(true);
  });
});

describe('weekly rule collisions', () => {
  it('ignores different weekdays', () => {
    expect(rulesCollide({ weekday: 1, startMinute: 540, endMinute: 780 },
                        { weekday: 2, startMinute: 540, endMinute: 780 })).toBe(false);
  });
  it('allows windows that merely touch', () => {
    expect(rulesCollide({ weekday: 1, startMinute: 540, endMinute: 720 },
                        { weekday: 1, startMinute: 720, endMinute: 900 })).toBe(false);
  });
  it('catches a real overlap', () => {
    expect(rulesCollide({ weekday: 1, startMinute: 540, endMinute: 780 },
                        { weekday: 1, startMinute: 700, endMinute: 900 })).toBe(true);
  });
});

describe('generateSlots', () => {
  // 2026-09-14 is a Monday. Weekday 1.
  const monday = { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60 };

  it('generates back-to-back slots when there is no buffer', () => {
    const slots = generateSlots({
      rules: [monday], blocks: [], sessionMinutes: 30, bufferMinutes: 0, ...RANGE,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    // 09:00–13:00 is four hours; eight 30-minute slots.
    expect(slots).toHaveLength(8);
    expect(iso(slots[0]!.startsAt)).toBe('2026-09-14T03:30:00.000Z'); // 09:00 IST
    expect(iso(slots[7]!.startsAt)).toBe('2026-09-14T07:00:00.000Z'); // 12:30 IST
  });

  it('widens the STRIDE by the buffer, never the session', () => {
    const slots = generateSlots({
      rules: [monday], blocks: [], sessionMinutes: 30, bufferMinutes: 15, ...RANGE,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    // Stride 45: 09:00, 09:45, 10:30, 11:15, 12:00, 12:45(no — ends 13:15).
    expect(slots).toHaveLength(5);
    const first = slots[0]!;
    // The session is still 30 minutes. A buffer that lengthened the session
    // would quietly overcharge, since billing is per slot (ADR-024).
    expect(first.endsAt.getTime() - first.startsAt.getTime()).toBe(30 * 60_000);
    expect(iso(slots[1]!.startsAt)).toBe('2026-09-14T04:15:00.000Z'); // 09:45 IST
  });

  it('keeps the last slot of the day even with no room for a trailing buffer', () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
      blocks: [], sessionMinutes: 30, bufferMinutes: 10, ...RANGE,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    // 09:00 and 09:40. The 09:40 session ends at 10:10... which exceeds 10:00,
    // so only 09:00 fits. The fit test is against the SESSION.
    expect(slots).toHaveLength(1);
    expect(iso(slots[0]!.startsAt)).toBe('2026-09-14T03:30:00.000Z');
  });

  it('drops slots covered by a block', () => {
    const slots = generateSlots({
      rules: [monday],
      // 10:00–11:00 IST = 04:30–05:30 UTC.
      blocks: [{ startsAt: new Date('2026-09-14T04:30:00Z'), endsAt: new Date('2026-09-14T05:30:00Z') }],
      sessionMinutes: 30, bufferMinutes: 0, ...RANGE,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(slots).toHaveLength(6);
    expect(slots.map((s) => iso(s.startsAt))).not.toContain('2026-09-14T04:30:00.000Z');
  });

  it('drops slots that have already ended', () => {
    const slots = generateSlots({
      rules: [monday], blocks: [], sessionMinutes: 30, bufferMinutes: 0, ...RANGE,
      // 11:00 IST. Slots ending at or before this are gone.
      now: new Date('2026-09-14T05:30:00Z'),
    });
    expect(slots).toHaveLength(4);
    expect(iso(slots[0]!.startsAt)).toBe('2026-09-14T05:30:00.000Z'); // 11:00 IST
  });

  it('applies a rule on the IST weekday, not the UTC one', () => {
    // Sunday 00:30 IST is Saturday 19:00 UTC. A rule for Sunday must fire.
    const slots = generateSlots({
      rules: [{ weekday: 0, startMinute: 0, endMinute: 60 }],
      blocks: [], sessionMinutes: 30, bufferMinutes: 0,
      from: new Date('2026-09-12T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z'),
      now: new Date('2026-09-01T00:00:00Z'),
    });
    // 2026-09-13 is a Sunday IST; its 00:00 and 00:30 are on the 12th in UTC.
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2026-09-12T18:30:00.000Z',
      '2026-09-12T19:00:00.000Z',
    ]);
  });

  it('returns nothing for an inverted or empty range', () => {
    expect(generateSlots({ rules: [monday], blocks: [], sessionMinutes: 30, bufferMinutes: 0,
      from: RANGE.to, to: RANGE.from })).toEqual([]);
  });

  it('returns nothing when the session length is nonsense', () => {
    expect(generateSlots({ rules: [monday], blocks: [], sessionMinutes: 0, bufferMinutes: 0, ...RANGE })).toEqual([]);
  });

  it('is sorted', () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startMinute: 14 * 60, endMinute: 16 * 60 }, monday],
      blocks: [], sessionMinutes: 60, bufferMinutes: 0, ...RANGE,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    const times = slots.map((s) => s.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

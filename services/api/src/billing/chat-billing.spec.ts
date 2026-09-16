import { describe, it, expect } from 'vitest';
import {
  chargeForChat, authorisationCeilingPaise,
  IDLE_PAUSE_SECONDS, MINIMUM_BILLABLE_MINUTES,
} from './chat-billing';

/**
 * Every expectation is hand-computed. ADR-036 requires billing arithmetic to be
 * tested against known results rather than against whatever the code returns —
 * a test that asserts the current output only pins the bug in place.
 *
 * Rate throughout: 1500 paise/minute = ₹15.00.
 */
const RATE = 1500;
const active = (seconds: number) => ({ seconds, idle: false });
const idle = (seconds: number) => ({ seconds, idle: true });

describe('chargeForChat', () => {
  it('charges nothing when the astrologer never replied', () => {
    // The meter starts on the astrologer's first message. No reply, no meter,
    // no minimum charge for silence.
    expect(chargeForChat([], RATE)).toMatchObject({ billableMinutes: 0, pricePaise: 0 });
  });

  it('charges one minute for a 40-second consultation', () => {
    // 40s -> ceil to 1 minute -> ₹15.00.
    expect(chargeForChat([active(40)], RATE)).toMatchObject({
      billableSeconds: 40, billableMinutes: 1, pricePaise: 1500,
    });
  });

  it('charges 10 minutes for exactly 600 seconds', () => {
    expect(chargeForChat([active(600)], RATE)).toMatchObject({
      billableMinutes: 10, pricePaise: 15000,
    });
  });

  it('charges 11 minutes for 601 seconds', () => {
    // Rounds up — but once, at the end.
    expect(chargeForChat([active(601)], RATE)).toMatchObject({
      billableMinutes: 11, pricePaise: 16500,
    });
  });

  it('ROUNDS THE TOTAL ONCE, not each exchange', () => {
    // Six ten-second exchanges = 60s = ONE minute.
    const six = [active(10), active(10), active(10), active(10), active(10), active(10)];
    expect(chargeForChat(six, RATE)).toMatchObject({ billableSeconds: 60, billableMinutes: 1 });
    // Rounding each up separately would have charged six minutes — ₹90 for one
    // minute of conversation. That is the difference between "we round up" and
    // "we round up repeatedly".
    expect(chargeForChat(six, RATE).pricePaise).toBe(1500);
    expect(chargeForChat(six, RATE).pricePaise).not.toBe(9000);
  });

  it('charges a short pause in full — thinking is part of the consultation', () => {
    // 60s talk + 90s pause (within the 120s grace) + 60s talk = 210s -> 4 min.
    const r = chargeForChat([active(60), idle(90), active(60)], RATE);
    expect(r.billableSeconds).toBe(210);
    expect(r.idleSecondsExcluded).toBe(0);
    expect(r.billableMinutes).toBe(4);
  });

  it('charges only the grace period of a long silence', () => {
    // 60s talk + 10 minutes of silence + 60s talk.
    // Billable: 60 + 120 (the grace) + 60 = 240s -> 4 minutes.
    // Excluded: 600 - 120 = 480s.
    const r = chargeForChat([active(60), idle(600), active(60)], RATE);
    expect(r.billableSeconds).toBe(240);
    expect(r.idleSecondsExcluded).toBe(480);
    expect(r.pricePaise).toBe(4 * RATE);
  });

  it('does not bill a customer who walked away for an hour', () => {
    const r = chargeForChat([active(120), idle(3600)], RATE);
    // 120 talk + 120 grace = 240s -> 4 minutes. Not 62 minutes.
    expect(r.billableMinutes).toBe(4);
    expect(r.idleSecondsExcluded).toBe(3600 - IDLE_PAUSE_SECONDS);
  });

  it('applies the one-minute minimum to a real but very short consultation', () => {
    expect(chargeForChat([active(3)], RATE)).toMatchObject({
      billableMinutes: MINIMUM_BILLABLE_MINUTES, pricePaise: RATE,
    });
  });

  it('ignores zero and negative intervals rather than trusting the caller', () => {
    expect(chargeForChat([active(0), active(-30), active(60)], RATE).billableSeconds).toBe(60);
  });

  it('handles a free consultation without dividing by anything', () => {
    expect(chargeForChat([active(300)], 0)).toMatchObject({ billableMinutes: 5, pricePaise: 0 });
  });

  it.each([1500.5, -1, NaN])('refuses a rate of %s', (rate) => {
    // A rate with a fraction of a paisa is the float this whole model exists to
    // keep off the money path.
    expect(() => chargeForChat([active(60)], rate)).toThrow(RangeError);
  });
});

describe('authorisationCeilingPaise', () => {
  it('is the maximum duration times the rate', () => {
    // 30 minutes at ₹15.00 = ₹450.00.
    expect(authorisationCeilingPaise(30, RATE)).toBe(45000);
  });

  it('refuses an unbounded consultation', () => {
    // Per-minute billing cannot be collected at booking, so an authorisation is
    // taken up front — and an authorisation needs a number. No cap, no charge.
    expect(() => authorisationCeilingPaise(0, RATE)).toThrow(RangeError);
    expect(() => authorisationCeilingPaise(-5, RATE)).toThrow(RangeError);
  });

  it('never authorises less than the consultation could cost', () => {
    const cap = authorisationCeilingPaise(20, RATE);
    const worst = chargeForChat([active(20 * 60)], RATE);
    expect(worst.pricePaise).toBeLessThanOrEqual(cap);
  });
});

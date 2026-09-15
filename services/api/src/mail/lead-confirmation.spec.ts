import { describe, it, expect } from 'vitest';
import { leadConfirmation } from './lead-confirmation';

const URL = 'https://www.stellaastro.com/confirm?token=abc123';

describe('leadConfirmation', () => {
  it('writes in Hindi when the lead chose Hindi', () => {
    const { subject, text } = leadConfirmation(URL, 'hi');
    expect(subject).toContain('पुष्टि');
    expect(text).toContain('नमस्ते');
  });

  it('writes in English otherwise', () => {
    const { subject, text } = leadConfirmation(URL, 'en');
    expect(subject).toBe('Confirm your email — Stella Astrology');
    expect(text).toContain('Hello,');
  });

  it('falls back to English for an unknown locale rather than failing', () => {
    expect(leadConfirmation(URL, 'fr').text).toContain('Hello,');
  });

  it('includes the link in BOTH parts — some clients show only text', () => {
    const { text, html } = leadConfirmation(URL, 'en');
    expect(text).toContain(URL);
    expect(html).toContain('abc123');
  });

  /**
   * The token goes into an href. An unescaped quote would close the attribute
   * and let the rest of the value become markup.
   */
  it('escapes the url so a crafted token cannot break out of the href', () => {
    const nasty = 'https://x/confirm?token="><script>alert(1)</script>';
    const { html } = leadConfirmation(nasty, 'en');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  /**
   * §13: no invented claims. The waitlist is a list — it is not a reservation,
   * it has no launch date, and it carries no offer.
   */
  it('promises nothing that does not exist', () => {
    for (const locale of ['en', 'hi']) {
      const { text } = leadConfirmation(URL, locale);
      for (const claim of ['reserved', 'guaranteed', 'discount', 'free session', 'launch date']) {
        expect(text.toLowerCase()).not.toContain(claim);
      }
    }
  });

  it('says how to opt out by ignoring it', () => {
    expect(leadConfirmation(URL, 'en').text.toLowerCase()).toContain('ignore this email');
  });
});

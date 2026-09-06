import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateLeadDto, normaliseIndianMobile } from './create-lead.dto';

const check = (payload: Record<string, unknown>) => {
  const dto = plainToInstance(CreateLeadDto, payload);
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};
const props = (errors: ReturnType<typeof validateSync>) => errors.map((e) => e.property);

describe('normaliseIndianMobile', () => {
  it('collapses every common Indian mobile shape to one E.164 value', () => {
    // Without this the unique index does not do its job and one person
    // becomes four rows.
    for (const input of [
      '+919999900001', '919999900001', '09999900001', '9999900001',
      '00919999900001', '+91 99999 00001', '+91-99999-00001', '(+91) 9999900001',
    ]) {
      expect(normaliseIndianMobile(input), input).toBe('+919999900001');
    }
  });

  it('leaves unrecognised input alone so validation can reject it', () => {
    expect(normaliseIndianMobile('12345')).toBe('12345');
    expect(normaliseIndianMobile('+15551234567')).toBe('+15551234567');
  });

  it('returns undefined for empty or non-string input', () => {
    expect(normaliseIndianMobile('')).toBeUndefined();
    expect(normaliseIndianMobile(undefined)).toBeUndefined();
    expect(normaliseIndianMobile(42)).toBeUndefined();
  });
});

describe('CreateLeadDto', () => {
  it('accepts a minimal valid payload', () => {
    const { errors } = check({ email: 'a@example.invalid', consent: true });
    expect(errors).toHaveLength(0);
  });

  it('lowercases and trims the email so casing does not create duplicates', () => {
    const { dto } = check({ email: '  A@Example.Invalid  ', consent: true });
    expect(dto.email).toBe('a@example.invalid');
  });

  it('rejects a malformed email', () => {
    expect(props(check({ email: 'not-an-email', consent: true }).errors)).toContain('email');
  });

  it('requires consent to be explicitly true, not merely present', () => {
    // @IsBoolean alone would accept false — the shape of a bug that silently
    // stores non-consenting rows.
    expect(props(check({ email: 'a@example.invalid', consent: false }).errors)).toContain('consent');
    expect(props(check({ email: 'a@example.invalid' }).errors)).toContain('consent');
  });

  it('accepts a valid Indian mobile in any shape', () => {
    for (const phone of ['+919999900001', '9999900001', '09999900001']) {
      const { dto, errors } = check({ email: 'a@example.invalid', consent: true, phone });
      expect(props(errors), phone).not.toContain('phone');
      expect(dto.phone).toBe('+919999900001');
    }
  });

  it('rejects a non-Indian or malformed number', () => {
    for (const phone of ['+15551234567', '12345', '5999900001']) {
      expect(props(check({ email: 'a@example.invalid', consent: true, phone }).errors), phone)
        .toContain('phone');
    }
  });

  it('treats phone as optional', () => {
    expect(props(check({ email: 'a@example.invalid', consent: true }).errors)).not.toContain('phone');
  });

  it('rejects unknown properties rather than silently dropping them', () => {
    // A client sending isAdmin:true should hear about it, not be ignored.
    const { errors } = check({ email: 'a@example.invalid', consent: true, isAdmin: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('caps field lengths so a long string cannot bloat a row', () => {
    expect(props(check({
      email: `${'a'.repeat(320)}@example.invalid`, consent: true,
    }).errors)).toContain('email');
    expect(props(check({
      email: 'a@example.invalid', consent: true, referralCode: 'x'.repeat(33),
    }).errors)).toContain('referralCode');
  });
});

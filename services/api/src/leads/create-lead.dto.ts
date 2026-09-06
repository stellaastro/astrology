import {
  IsEmail, IsBoolean, IsOptional, IsString, MaxLength, Matches, Equals,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Waitlist signup payload.
 *
 * The global ValidationPipe runs with forbidNonWhitelisted, so an unexpected
 * property is a 400 rather than being quietly dropped — a client sending
 * `isAdmin: true` should hear about it, not be ignored.
 */
export class CreateLeadDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(320) // RFC 5321: 64 local + @ + 255 domain
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  /**
   * Optional. Normalised to E.164 before it reaches the service, so
   * +919999900001, 09999900001, 919999900001 and 9999900001 all become one
   * value — otherwise the same person creates four rows.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: 'Enter a 10-digit Indian mobile number',
  })
  @Transform(({ value }) => normaliseIndianMobile(value))
  phone?: string;

  /**
   * Consent must be explicitly true. @IsBoolean alone would accept `false`,
   * which is the shape of a bug that silently stores non-consenting rows.
   */
  @IsBoolean()
  @Equals(true, { message: 'Consent is required to join the waitlist' })
  consent!: boolean;

  @IsOptional() @IsString() @MaxLength(32)
  referralCode?: string;

  @IsOptional() @IsString() @MaxLength(10)
  locale?: string;

  @IsOptional() @IsString() @MaxLength(64)
  source?: string;

  @IsOptional() @IsString() @MaxLength(128) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(128) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(128) utmCampaign?: string;

  /** Cloudflare Turnstile token. Absent is tolerated — see TurnstileService. */
  @IsOptional() @IsString() @MaxLength(2048)
  turnstileToken?: string;
}

/**
 * Indian mobile numbers arrive in at least four shapes. Without normalising,
 * the unique index does not do its job and one person becomes four rows.
 */
export function normaliseIndianMobile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/[\s()\-.]/g, '');
  if (digits === '') return undefined;

  const m =
    /^\+91([6-9]\d{9})$/.exec(digits) ??   // +919999900001
    /^0091([6-9]\d{9})$/.exec(digits) ??   // 00919999900001
    /^91([6-9]\d{9})$/.exec(digits) ??     // 919999900001
    /^0([6-9]\d{9})$/.exec(digits) ??      // 09999900001
    /^([6-9]\d{9})$/.exec(digits);         // 9999900001

  return m ? `+91${m[1]}` : digits; // unmatched falls through to fail @Matches
}

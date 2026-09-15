import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, Matches,
  Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Lowercase letters, digits and hyphens. Stable once published. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Creating an astrologer profile.
 *
 * THE RATE ARRIVES AS A STRING, deliberately. "1250.50" through JSON is a
 * float, and a float is exactly what integer-paise Money exists to keep out of
 * the money path — 1250.50 is not representable in binary and rounding it at
 * the edge of the system is how a price drifts by a paisa. The service parses
 * it with Money.fromString, which rejects anything with sub-paise precision
 * rather than rounding it quietly.
 */
export class CreateAstrologerDto {
  @Matches(SLUG, { message: 'Slug must be lowercase letters, digits and hyphens.' })
  @MaxLength(80)
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  nameHi!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  nameEn!: string;

  @IsOptional() @IsString() @MaxLength(160)
  headline?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  bio?: string;

  @IsInt() @Min(0) @Max(80)
  experienceYears!: number;

  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(12) @IsString({ each: true })
  languages!: string[];

  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(12) @IsString({ each: true })
  specialisations!: string[];

  /** Rupees, as a string. See the class note. */
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/, {
    message: 'Rate must be rupees with at most two decimal places, e.g. "1250.50".',
  })
  sessionRate!: string;

  /** A booked slot bills for the slot (ADR-024), so this is the billed unit. */
  @IsInt() @Min(15) @Max(180)
  sessionMinutes!: number;
}

/** Everything is optional; the slug is not here because it does not change. */
export class UpdateAstrologerDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  nameHi?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  nameEn?: string;

  @IsOptional() @IsString() @MaxLength(160)
  headline?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  bio?: string;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  experienceYears?: number;

  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(12) @IsString({ each: true })
  languages?: string[];

  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(12) @IsString({ each: true })
  specialisations?: string[];

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/, {
    message: 'Rate must be rupees with at most two decimal places, e.g. "1250.50".',
  })
  sessionRate?: string;

  @IsOptional() @IsInt() @Min(15) @Max(180)
  sessionMinutes?: number;
}

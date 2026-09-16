import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Opening a DPDP request. The kind is fixed to the two rights we can serve. */
export class OpenPrivacyRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320)
  email!: string;

  @IsIn(['access', 'erasure'], { message: 'Choose either access or erasure.' })
  kind!: 'access' | 'erasure';
}

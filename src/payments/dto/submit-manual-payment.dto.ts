import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const MANUAL_PAYMENT_PROVIDERS = [
  'KBZ_PAY',
  'WAVE_MONEY',
  'BANK_TRANSFER',
] as const;

export class SubmitManualPaymentDto {
  @IsIn(MANUAL_PAYMENT_PROVIDERS)
  @ApiProperty({
    description: 'Supported manual payment provider.',
    enum: MANUAL_PAYMENT_PROVIDERS,
    example: 'KBZ_PAY',
  })
  providerCode: (typeof MANUAL_PAYMENT_PROVIDERS)[number];

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @ApiProperty({
    description: 'Provider-issued transaction reference.',
    type: String,
    example: 'transactionReference-example',
    maxLength: 255,
    minLength: 1,
  })
  transactionReference: string;
}

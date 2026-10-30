import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2048)
  @ApiPropertyOptional({
    description:
      'Optional HTTPS proof URL; hostname must be configured in PAYMENT_PROOF_ALLOWED_HOSTS.',
    example: 'https://payments.example.com/proof/123',
    maxLength: 2048,
    format: 'uri',
  })
  proofUrl?: string;
}

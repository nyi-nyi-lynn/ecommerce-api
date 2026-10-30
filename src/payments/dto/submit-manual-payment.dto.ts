import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const MANUAL_PAYMENT_PROVIDERS = ['KBZ_PAY', 'WAVE_MONEY', 'BANK_TRANSFER'] as const;

export class SubmitManualPaymentDto {
  @IsIn(MANUAL_PAYMENT_PROVIDERS)
  providerCode: (typeof MANUAL_PAYMENT_PROVIDERS)[number];

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  transactionReference: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(2048)
  proofUrl?: string;
}

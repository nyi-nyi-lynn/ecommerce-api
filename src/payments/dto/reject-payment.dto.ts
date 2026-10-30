import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectPaymentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @ApiProperty({
    description: 'Required payment rejection reason.',
    type: String,
    example: 'Reference could not be verified.',
    maxLength: 500,
    minLength: 3,
  })
  reason: string;
}

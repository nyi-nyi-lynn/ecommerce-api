import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaymentStatus } from '../../generated/prisma/client.js';

export class QueryPaymentsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: 'Page number; default 1, maximum 100000.',
    example: 1,
    default: 1,
    minimum: 1,
    maximum: 100_000,
  })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: 'Results per page; default 20, maximum 100.',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  limit = 20;

  @IsOptional()
  @IsEnum(PaymentStatus)
  @ApiPropertyOptional({
    description: 'Optional payment status filter.',
    enum: PaymentStatus,
  })
  status?: PaymentStatus;
}

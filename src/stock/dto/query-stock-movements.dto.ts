import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class QueryStockMovementsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: 'Page number; default 1, maximum 10000.',
    example: 1,
    default: 1,
    minimum: 1,
    maximum: 10_000,
  })
  page = 1;

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
}

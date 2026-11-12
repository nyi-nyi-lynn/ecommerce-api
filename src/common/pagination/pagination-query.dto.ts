import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE = 10_000;
export const MAX_LIMIT = 100;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: 'Page number; default 1, maximum 10000.',
    example: 1,
    default: 1,
    minimum: 1,
    maximum: MAX_PAGE,
  })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: 'Results per page; default 20, maximum 100.',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: MAX_LIMIT,
  })
  limit?: number = 20;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrderStatus } from '../../generated/prisma/client.js';

export const MAX_ORDER_PAGE = 10_000;

export class QueryOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_PAGE)
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: 'Page number; default 1, maximum 10000.',
    example: 1,
    default: 1,
    minimum: 1,
    maximum: MAX_ORDER_PAGE,
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
}

export class QueryAdminOrdersDto extends QueryOrdersDto {
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  @ApiPropertyOptional({
    description: 'Optional order status filter.',
    enum: OrderStatus,
  })
  status?: OrderStatus;
}

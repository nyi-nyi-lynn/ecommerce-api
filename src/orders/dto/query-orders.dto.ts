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
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class QueryAdminOrdersDto extends QueryOrdersDto {
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;
}

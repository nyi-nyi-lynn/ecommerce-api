import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { OrderStatus } from '../../generated/prisma/client.js';
import {
  MAX_PAGE,
  PaginationQueryDto,
} from '../../common/pagination/pagination-query.dto.js';

export const MAX_ORDER_PAGE = MAX_PAGE;

export class QueryOrdersDto extends PaginationQueryDto {}

export class QueryAdminOrdersDto extends QueryOrdersDto {
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  @ApiPropertyOptional({
    description: 'Optional order status filter.',
    enum: OrderStatus,
  })
  status?: OrderStatus;
}

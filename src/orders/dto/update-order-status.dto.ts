import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { OrderStatus } from '../../generated/prisma/client.js';

export const ADMIN_ORDER_STATUS_TARGETS = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
] as const;

export class UpdateOrderStatusDto {
  @IsIn(ADMIN_ORDER_STATUS_TARGETS)
  @ApiProperty({
    description: 'Allowed next status for the order.',
    enum: ADMIN_ORDER_STATUS_TARGETS,
    example: OrderStatus.CONFIRMED,
  })
  status: (typeof ADMIN_ORDER_STATUS_TARGETS)[number];
}

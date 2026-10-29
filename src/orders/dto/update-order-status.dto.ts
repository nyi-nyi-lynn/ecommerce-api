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
  status: (typeof ADMIN_ORDER_STATUS_TARGETS)[number];
}

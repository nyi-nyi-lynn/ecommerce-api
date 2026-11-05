import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CheckoutOrderDto } from './checkout-order.dto.js';

export const MAX_ORDER_ITEMS = 50;
export const MAX_ORDER_QUANTITY = 2_147_483_647;

export class CreateOrderItemDto {
  @IsUUID()
  @ApiProperty({
    description: 'Product UUID for this order line.',
    type: String,
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_QUANTITY)
  @ApiProperty({
    description: 'Positive integer quantity.',
    type: Number,
    example: 2,
    minimum: 1,
    maximum: MAX_ORDER_QUANTITY,
  })
  quantity: number;
}

export class CreateOrderDto extends CheckoutOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  @ArrayUnique((item: CreateOrderItemDto) => item.productId)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @ApiProperty({
    description:
      'One to 50 distinct product lines. Prices and totals are calculated by the server.',
    type: [CreateOrderItemDto],
    minItems: 1,
    maxItems: MAX_ORDER_ITEMS,
    example: [
      { productId: '11111111-1111-4111-8111-111111111111', quantity: 2 },
    ],
  })
  items: CreateOrderItemDto[];
}

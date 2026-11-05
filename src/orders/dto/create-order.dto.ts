import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CheckoutOrderDto } from './checkout-order.dto.js';

export const MAX_ORDER_ITEMS = 50;
export const MAX_ORDER_PRODUCT_ID = 2_147_483_647;
export const MAX_ORDER_QUANTITY = 2_147_483_647;

export class CreateOrderItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_PRODUCT_ID)
  @ApiProperty({
    description: 'Product ID for this order line.',
    type: Number,
    example: 42,
    minimum: 1,
    maximum: MAX_ORDER_PRODUCT_ID,
  })
  productId: number;

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
    example: [{ productId: 42, quantity: 2 }],
  })
  items: CreateOrderItemDto[];
}

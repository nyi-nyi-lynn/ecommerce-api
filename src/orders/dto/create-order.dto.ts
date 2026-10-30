import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../../generated/prisma/client.js';

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

export class CreateOrderDto {
  @IsOptional()
  @IsIn([PaymentMethod.COD, PaymentMethod.MANUAL])
  @ApiPropertyOptional({
    description: 'Payment method; COD is the default.',
    enum: [PaymentMethod.COD, PaymentMethod.MANUAL],
    example: PaymentMethod.COD,
  })
  paymentMethod?: PaymentMethod;

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

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: 'Shipping recipient name.',
    type: String,
    example: 'shippingName-example',
    maxLength: 100,
  })
  shippingName: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @ApiProperty({
    description: 'Shipping contact phone.',
    type: String,
    example: 'shippingPhone-example',
    maxLength: 30,
  })
  shippingPhone: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  @ApiProperty({
    description: 'Shipping address.',
    type: String,
    example: 'shippingAddress-example',
    maxLength: 5000,
  })
  shippingAddress: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({
    description: 'Optional note.',
    type: String,
    example: 'note-example',
    maxLength: 500,
  })
  note?: string;
}

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
  productId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_QUANTITY)
  quantity: number;
}

export class CreateOrderDto {
  @IsOptional()
  @IsIn([PaymentMethod.COD, PaymentMethod.MANUAL])
  paymentMethod?: PaymentMethod;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  @ArrayUnique((item: CreateOrderItemDto) => item.productId)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shippingName: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  shippingPhone: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  shippingAddress: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

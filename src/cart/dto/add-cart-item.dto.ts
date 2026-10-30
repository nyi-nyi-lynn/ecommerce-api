import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_CART_INT = 2_147_483_647;

export class AddCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_INT)
  @ApiProperty({
    description: 'Product ID.',
    type: Number,
    example: 1,
    minimum: 1,
    maximum: MAX_CART_INT,
  })
  productId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_INT)
  @ApiProperty({
    description: 'Positive integer quantity.',
    type: Number,
    example: 1,
    minimum: 1,
    maximum: MAX_CART_INT,
  })
  quantity: number;
}

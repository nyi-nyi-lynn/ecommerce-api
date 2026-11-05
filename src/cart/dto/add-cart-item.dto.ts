import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export const MAX_CART_INT = 2_147_483_647;

export class AddCartItemDto {
  @IsUUID()
  @ApiProperty({
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  productId: string;

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

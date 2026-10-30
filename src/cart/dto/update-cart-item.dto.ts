import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_CART_INT } from './add-cart-item.dto.js';

export class UpdateCartItemDto {
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

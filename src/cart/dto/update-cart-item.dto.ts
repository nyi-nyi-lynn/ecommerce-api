import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_CART_INT } from './add-cart-item.dto.js';

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_INT)
  quantity: number;
}

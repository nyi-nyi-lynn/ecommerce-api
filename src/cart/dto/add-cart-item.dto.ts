import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_CART_INT = 2_147_483_647;

export class AddCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_INT)
  productId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_INT)
  quantity: number;
}

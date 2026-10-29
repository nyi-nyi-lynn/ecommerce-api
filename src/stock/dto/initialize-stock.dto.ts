import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_STOCK_QUANTITY = 2_147_483_647;

export class InitializeStockDto {
  @Transform(({ value }) =>
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN,
  )
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  quantity: number;
}

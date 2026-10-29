import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from 'class-validator';
import { MAX_STOCK_QUANTITY } from './initialize-stock.dto.js';

export const STOCK_ADJUSTMENT_REASONS = [
  'RESTOCK',
  'SALE',
  'RETURN',
  'ADJUSTMENT',
  'CANCELLATION',
] as const;

export type StockAdjustmentReason = (typeof STOCK_ADJUSTMENT_REASONS)[number];

export class AdjustStockDto {
  /** Signed delta: positive adds units; negative removes units. Zero is invalid. */
  @Transform(({ value }) =>
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN,
  )
  @IsInt()
  @Min(-MAX_STOCK_QUANTITY)
  @Max(MAX_STOCK_QUANTITY)
  @NotEquals(0)
  quantityChange: number;

  @IsIn(STOCK_ADJUSTMENT_REASONS)
  reason: StockAdjustmentReason;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;
}

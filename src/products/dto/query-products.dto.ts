import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_PAGE,
  PaginationQueryDto,
} from '../../common/pagination/pagination-query.dto.js';
import { TransformBoolean } from '../../common/transformers/transform-boolean.decorator.js';

const sortableFields = [
  'name',
  'price',
  'originalPrice',
  'createdAt',
  'updatedAt',
] as const;

// Caps the largest supported offset at 999,900 rows when limit is 100.
export const MAX_PRODUCT_PAGE = MAX_PAGE;

export class QueryProductsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Allowlisted sort field.',
    enum: sortableFields,
    example: 'createdAt',
  })
  @IsOptional()
  @IsIn(sortableFields)
  sortBy?: (typeof sortableFields)[number] = 'createdAt';
  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    example: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
  @ApiPropertyOptional({
    description: 'Filter by category UUID.',
    type: String,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({
    description: 'Filter by brand UUID.',
    type: String,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  brandId?: string;
  @ApiPropertyOptional({
    description: 'Filter by brand slug; maximum 160 characters.',
    type: String,
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  brandSlug?: string;
  @ApiPropertyOptional({
    description:
      'Filter products by discount availability (`true` returns only discounted products; `false` returns only non-discounted products).',
    type: Boolean,
  })
  @IsOptional()
  @TransformBoolean()
  @IsBoolean()
  hasDiscount?: boolean;
  @ApiPropertyOptional({
    description: 'Inclusive minimum price.',
    type: Number,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;
  @ApiPropertyOptional({
    description: 'Inclusive maximum price.',
    type: Number,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;
  @ApiPropertyOptional({
    description: 'Search product names; maximum 100 characters.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  // Public listing remains forced to active products; false cannot reveal inactive rows.
  @IsOptional()
  @TransformBoolean()
  @IsBoolean()
  @ApiPropertyOptional({
    description:
      'Accepted for compatibility; public listing always forces active products.',
    type: Boolean,
  })
  isActive?: boolean;
}

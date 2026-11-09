import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { TransformBoolean } from '../../common/transformers/transform-boolean.decorator.js';

const sortableBrandFields = ['name', 'createdAt', 'updatedAt'] as const;

export class QueryBrandsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Allowlisted sort field.',
    enum: sortableBrandFields,
    example: 'createdAt',
  })
  @IsOptional()
  @IsIn(sortableBrandFields)
  sortBy?: (typeof sortableBrandFields)[number] = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    example: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    description: 'Search brand names; maximum 100 characters.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  // Public listing remains forced to active brands; false cannot reveal inactive rows.
  @IsOptional()
  @TransformBoolean()
  @IsBoolean()
  @ApiPropertyOptional({
    description:
      'Accepted for compatibility; public listing always forces active brands.',
    type: Boolean,
  })
  isActive?: boolean;
}

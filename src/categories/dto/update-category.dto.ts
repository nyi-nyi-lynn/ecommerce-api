import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiPropertyOptional({
    description: 'Category display name.',
    example: 'Electronics',
    maxLength: 100,
  })
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @ApiPropertyOptional({
    description: 'Unique category URL slug.',
    example: 'electronics',
    maxLength: 120,
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Optional descriptive text.',
    type: String,
    example: 'description-example',
  })
  description?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Whether the resource is active.',
    type: Boolean,
    example: true,
  })
  isActive?: boolean;
}

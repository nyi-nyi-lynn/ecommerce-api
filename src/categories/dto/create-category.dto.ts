import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: 'Category display name.',
    example: 'Electronics',
    maxLength: 100,
  })
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @ApiProperty({
    description: 'Unique category URL slug.',
    example: 'electronics',
    maxLength: 120,
  })
  slug: string;

  @IsString()
  @IsOptional()
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

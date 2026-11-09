import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TransformBoolean } from '../../common/transformers/transform-boolean.decorator.js';

export class CreateBrandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @ApiProperty({
    description: 'Brand display name.',
    example: 'Samsung',
    maxLength: 150,
  })
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @ApiProperty({
    description: 'Unique brand URL slug.',
    example: 'samsung',
    maxLength: 160,
  })
  slug: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Optional descriptive text.',
    type: String,
    example: 'Global electronics and mobile manufacturer.',
  })
  description?: string;

  @IsOptional()
  @IsBoolean()
  @TransformBoolean()
  @ApiPropertyOptional({
    description: 'Whether the resource is active.',
    type: Boolean,
    example: true,
  })
  isActive?: boolean;
}

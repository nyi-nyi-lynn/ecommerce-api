import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  TransformNullableString,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';
import { TransformBoolean } from '../../common/transformers/transform-boolean.decorator.js';

export class CreateCategoryDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: 'Category display name.',
    example: 'Electronics',
    maxLength: 100,
  })
  name: string;

  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @ApiProperty({
    description: 'Unique category URL slug.',
    example: 'electronics',
    maxLength: 120,
  })
  slug: string;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Optional descriptive text.',
    type: String,
    nullable: true,
    example: 'description-example',
  })
  description?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @TransformBoolean()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Whether the resource is active.',
    type: Boolean,
    example: true,
  })
  isActive?: boolean;
}

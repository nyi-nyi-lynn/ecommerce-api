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

export class CreateBrandDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @ApiProperty({
    description: 'Brand display name.',
    example: 'Samsung',
    maxLength: 150,
  })
  name: string;

  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @ApiProperty({
    description: 'Unique brand URL slug.',
    example: 'samsung',
    maxLength: 160,
  })
  slug: string;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Optional descriptive text.',
    type: String,
    nullable: true,
    example: 'Global electronics and mobile manufacturer.',
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

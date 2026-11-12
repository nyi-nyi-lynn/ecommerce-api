import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  TransformNullableString,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';

export class CreateRoleDto {
  @TransformTrimmedString()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @ApiProperty({
    description: 'Display or recipient name.',
    type: String,
    example: 'name-example',
    maxLength: 100,
    minLength: 2,
  })
  name!: string;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({
    description: 'Optional descriptive text.',
    type: String,
    nullable: true,
    example: 'description-example',
    maxLength: 500,
  })
  description?: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Validate,
  Min,
} from 'class-validator';
import {
  TransformOptionalNumber,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';
import {
  IsCmsJsonObjectConstraint,
  TransformCmsBoolean,
  TransformCmsJsonObject,
} from './cms-content.transforms.js';

export class CreateCmsSectionDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  @ApiProperty({ example: 'hero', maxLength: 100 })
  key!: string;

  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @ApiProperty({
    description: 'Frontend section component type.',
    example: 'hero',
    maxLength: 80,
  })
  type!: string;

  @TransformOptionalNumber()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  @ApiProperty({ minimum: 0, maximum: 2_147_483_647, example: 0 })
  position!: number;

  @IsOptional()
  @TransformCmsBoolean()
  @IsBoolean()
  @ApiPropertyOptional({ type: Boolean, default: true })
  isVisible?: boolean;

  @TransformCmsJsonObject()
  @IsObject()
  @Validate(IsCmsJsonObjectConstraint)
  @ApiProperty({ type: 'object', additionalProperties: true })
  content!: Record<string, unknown>;
}

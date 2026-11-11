import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';
import {
  TransformNullableString,
  TransformOptionalNumber,
} from '../../common/transformers/dto-transforms.util.js';
import { IsCmsUrlConstraint } from './is-cms-url.validator.js';

export class CreateCmsSectionItemDto {
  @TransformOptionalNumber()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  @ApiProperty({ minimum: 0, maximum: 2_147_483_647, example: 0 })
  position!: number;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  title?: string | null;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ nullable: true })
  body?: string | null;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @Validate(IsCmsUrlConstraint)
  @ApiPropertyOptional({ description: 'HTTP(S), mailto, or a root-relative URL.', nullable: true })
  url?: string | null;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  label?: string | null;

  @TransformNullableString()
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  categoryId?: string | null;
}

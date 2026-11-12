import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  TransformNullableString,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';

export class UpdateCmsDocumentDto {
  @TransformTrimmedString()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @ApiPropertyOptional({ maxLength: 150 })
  title?: string;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @MaxLength(70)
  @ApiPropertyOptional({ maxLength: 70, nullable: true })
  seoTitle?: string | null;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @ApiPropertyOptional({ maxLength: 160, nullable: true })
  seoDescription?: string | null;
}

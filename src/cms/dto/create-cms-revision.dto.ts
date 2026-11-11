import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TransformNullableString } from '../../common/transformers/dto-transforms.util.js';

export class CreateCmsRevisionDto {
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

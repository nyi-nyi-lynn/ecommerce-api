import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TransformNullableString, TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

export class CreateCmsDocumentDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  @ApiProperty({
    description: 'Stable lowercase document key; new page keys are supported.',
    example: 'home',
    maxLength: 100,
  })
  key!: string;

  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @ApiProperty({ example: 'Home Page', maxLength: 150 })
  title!: string;

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

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

export class UpdateCmsDocumentDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @ApiPropertyOptional({ maxLength: 150 })
  title?: string;
}

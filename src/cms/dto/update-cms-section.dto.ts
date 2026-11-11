import { PartialType } from '@nestjs/swagger';
import { CreateCmsSectionDto } from './create-cms-section.dto.js';

export class UpdateCmsSectionDto extends PartialType(CreateCmsSectionDto, {
  skipNullProperties: false,
}) {}

import { PartialType } from '@nestjs/swagger';
import { CreateCmsSectionItemDto } from './create-cms-section-item.dto.js';

export class UpdateCmsSectionItemDto extends PartialType(CreateCmsSectionItemDto, {
  skipNullProperties: false,
}) {}

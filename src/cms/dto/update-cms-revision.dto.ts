import { PartialType } from '@nestjs/swagger';
import { CreateCmsRevisionDto } from './create-cms-revision.dto.js';

export class UpdateCmsRevisionDto extends PartialType(CreateCmsRevisionDto, {
  skipNullProperties: false,
}) {}

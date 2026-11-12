import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { TransformCmsBoolean } from './cms-content.transforms.js';

export class SetCmsSectionVisibilityDto {
  @TransformCmsBoolean()
  @IsBoolean()
  @ApiProperty({ type: Boolean })
  isVisible!: boolean;
}

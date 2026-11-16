import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, Max, Min, Validate } from 'class-validator';
import { TransformOptionalNumber } from '../../common/transformers/dto-transforms.util.js';
import {
  IsCmsJsonObjectConstraint,
  TransformCmsJsonObject,
} from './cms-content.transforms.js';

export class CreateCmsSectionItemDto {
  @TransformOptionalNumber()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  @ApiProperty({ minimum: 0, maximum: 2_147_483_647, example: 0 })
  position!: number;

  @TransformCmsJsonObject()
  @IsObject()
  @Validate(IsCmsJsonObjectConstraint)
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      type: 'image',
      imageUrl: 'https://example.com/image.jpg',
      alt: 'Banner image',
      title: 'Summer Sale',
      link: '/sale',
    },
  })
  content!: Record<string, unknown>;
}

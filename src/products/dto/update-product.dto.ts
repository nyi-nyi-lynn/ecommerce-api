import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import {
  transformOptionalNumber,
  transformTrimmedString,
  transformUpdateNullableNumber,
  transformUpdateNullableUuid,
} from '../../common/transformers/dto-transforms.util.js';
import { TransformBoolean } from '../../common/transformers/transform-boolean.decorator.js';
import { CreateProductDto } from './create-product.dto.js';

export {
  transformOptionalNumber,
  transformTrimmedString,
  transformUpdateNullableNumber,
  transformUpdateNullableUuid,
};

export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    description: 'Whether the resource is active.',
    type: Boolean,
  })
  @ValidateIf((_, value) => value !== undefined)
  @TransformBoolean()
  @IsBoolean()
  isActive?: boolean;
}

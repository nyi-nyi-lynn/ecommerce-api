import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { TransformBoolean } from '../../common/transformers/transform-boolean.decorator.js';
import {
  IsGreaterThanPrice,
  transformNullableString,
} from './create-product.dto.js';

export function transformTrimmedString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function transformOptionalNumber(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return Number.NaN;
    }
    return Number(trimmed);
  }
  return value;
}

export function transformUpdateNullableUuid(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === 'null') {
      return null;
    }
    return trimmed;
  }
  return value;
}

export function transformUpdateNullableNumber(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === 'null') {
      return null;
    }
    if (trimmed === '') {
      return Number.NaN;
    }
    return Number(trimmed);
  }
  return value;
}

export class UpdateProductDto {
  @ApiPropertyOptional({
    description: 'Product display name.',
    maxLength: 200,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: 'Unique URL slug.',
    maxLength: 220,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  slug?: string;

  @ApiPropertyOptional({
    description:
      'Optional active brand UUID. Set to null to remove an existing brand association.',
    type: String,
    format: 'uuid',
    nullable: true,
  })
  @Transform(({ value }) => transformUpdateNullableUuid(value))
  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({
    description: 'Unique stock keeping unit.',
    maxLength: 100,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Product description. Set to null to clear an existing description.',
    type: String,
    nullable: true,
  })
  @Transform(({ value }) => transformNullableString(value))
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Product selling price in MMK.',
    type: Number,
    minimum: 0.01,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => transformOptionalNumber(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price?: number;

  @ApiPropertyOptional({
    description:
      'Original price before discount in MMK. Must be strictly greater than price when set; set to null to remove an existing discount.',
    type: Number,
    nullable: true,
    minimum: 0.01,
  })
  @Transform(({ value }) => transformUpdateNullableNumber(value))
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @IsGreaterThanPrice()
  originalPrice?: number | null;

  @ApiPropertyOptional({
    description: 'Existing category UUID.',
    type: String,
    format: 'uuid',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => transformTrimmedString(value))
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Legacy image URL. New clients should upload the image multipart field instead.',
    maxLength: 2048,
    format: 'uri',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => transformTrimmedString(value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether the resource is active.',
    type: Boolean,
  })
  @ValidateIf((_, value) => value !== undefined)
  @TransformBoolean()
  @IsBoolean()
  isActive?: boolean;
}


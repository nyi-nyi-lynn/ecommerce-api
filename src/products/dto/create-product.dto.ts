import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import {
  TransformNullableString,
  TransformOptionalNumber,
  TransformTrimmedString,
  TransformUpdateNullableNumber,
  TransformUpdateNullableUuid,
  transformNullableNumber,
  transformNullableString,
} from '../../common/transformers/dto-transforms.util.js';

export { transformNullableNumber, transformNullableString };

export function IsGreaterThanPrice(): PropertyDecorator {
  return ValidateBy({
    name: 'isGreaterThanPrice',
    validator: {
      validate(value: unknown, args?: ValidationArguments): boolean {
        if (value === undefined || value === null) {
          return true;
        }
        const object = args?.object as { price?: unknown } | undefined;
        if (
          typeof object?.price !== 'number' ||
          !Number.isFinite(object.price) ||
          typeof value !== 'number' ||
          !Number.isFinite(value)
        ) {
          return true;
        }
        return value > object.price;
      },
      defaultMessage(): string {
        return 'originalPrice must be greater than price.';
      },
    },
  });
}

export class CreateProductDto {
  @ApiProperty({
    description: 'Product display name.',
    example: 'Wireless Headphones',
    maxLength: 200,
  })
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    description: 'Unique URL slug.',
    example: 'wireless-headphones',
    maxLength: 220,
  })
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  slug: string;

  @ApiPropertyOptional({
    description: 'Optional active brand UUID.',
    type: String,
    format: 'uuid',
    nullable: true,
    example: '33333333-3333-4333-8333-333333333333',
  })
  @TransformUpdateNullableUuid()
  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @ApiProperty({
    description: 'Unique stock keeping unit.',
    example: 'WH-1000',
    maxLength: 100,
  })
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku: string;

  @ApiPropertyOptional({
    description: 'Optional product description.',
    type: String,
    nullable: true,
    example: 'Over-ear wireless headphones.',
  })
  @TransformNullableString()
  @IsOptional()
  @IsString()
  description?: string | null;

  @TransformOptionalNumber()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @ApiProperty({
    description: 'Product selling price in MMK.',
    type: Number,
    example: 100000,
    minimum: 0.01,
  })
  price: number;

  @TransformUpdateNullableNumber()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @IsGreaterThanPrice()
  @ApiPropertyOptional({
    description:
      'Optional original price before discount in MMK. Must be strictly greater than price when provided.',
    type: Number,
    nullable: true,
    example: 150000,
    minimum: 0.01,
  })
  originalPrice?: number | null;

  @ApiProperty({
    description: 'Existing category UUID.',
    type: String,
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  @TransformTrimmedString()
  @IsUUID()
  categoryId: string;

  @ValidateIf((_, value) => value !== undefined)
  @TransformTrimmedString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  @ApiPropertyOptional({
    description:
      'Legacy image URL. New clients should upload the image multipart field instead.',
    example: 'https://cdn.example.com/product.jpg',
    maxLength: 2048,
    format: 'uri',
  })
  imageUrl?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateProductDto {
  @ApiPropertyOptional({
    description: 'Product display name.',
    example: 'Wireless Headphones',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
  @ApiPropertyOptional({
    description: 'Unique URL slug.',
    example: 'wireless-headphones',
    maxLength: 220,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  slug?: string;
  @ApiPropertyOptional({
    description: 'Unique stock keeping unit.',
    example: 'WH-1000',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku?: string;
  @ApiPropertyOptional({
    description: 'Product description.',
    example: 'Over-ear wireless headphones.',
  })
  @IsOptional()
  @IsString()
  description?: string;
  @ApiPropertyOptional({
    description: 'Product price in MMK.',
    type: Number,
    example: 1,
    minimum: 0.01,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price?: number;
  @ApiPropertyOptional({
    description: 'Existing category numeric ID.',
    type: Number,
    example: 1,
    minimum: 1,
    maximum: 2147483647,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;
  @ApiPropertyOptional({
    description:
      'Legacy image URL. New clients should upload the image multipart field instead.',
    example: 'https://cdn.example.com/product.jpg',
    maxLength: 2048,
    format: 'uri',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string;
  @ApiPropertyOptional({
    description: 'Whether the resource is active.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  isActive?: boolean;
}

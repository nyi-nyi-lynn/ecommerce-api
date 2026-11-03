import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({
    description: 'Product display name.',
    example: 'Wireless Headphones',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
  @ApiProperty({
    description: 'Unique URL slug.',
    example: 'wireless-headphones',
    maxLength: 220,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  slug: string;
  @ApiProperty({
    description: 'Unique stock keeping unit.',
    example: 'WH-1000',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku: string;
  @ApiPropertyOptional({
    description: 'Optional product description.',
    example: 'Over-ear wireless headphones.',
  })
  @IsString()
  @IsOptional()
  description?: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @ApiProperty({
    description: 'Product price in MMK.',
    type: Number,
    example: 1,
    minimum: 0.01,
  })
  price: number;
  @ApiProperty({
    description: 'Existing category numeric ID.',
    type: Number,
    example: 1,
    minimum: 1,
    maximum: 2147483647,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId: number;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  @ApiPropertyOptional({
    description: 'Legacy image URL. New clients should upload the image multipart field instead.',
    example: 'https://cdn.example.com/product.jpg',
    maxLength: 2048,
    format: 'uri',
  })
  imageUrl?: string;
}

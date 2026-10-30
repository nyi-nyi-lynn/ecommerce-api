import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentMethod } from '../../generated/prisma/client.js';

export class CheckoutOrderDto {
  @IsOptional()
  @IsIn([PaymentMethod.COD, PaymentMethod.MANUAL])
  @ApiPropertyOptional({
    description: 'Payment method; COD is the default.',
    enum: [PaymentMethod.COD, PaymentMethod.MANUAL],
    example: PaymentMethod.COD,
  })
  paymentMethod?: PaymentMethod;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: 'Shipping recipient name.',
    type: String,
    example: 'shippingName-example',
    maxLength: 100,
  })
  shippingName: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @ApiProperty({
    description: 'Shipping contact phone.',
    type: String,
    example: 'shippingPhone-example',
    maxLength: 30,
  })
  shippingPhone: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  @ApiProperty({
    description: 'Shipping address.',
    type: String,
    example: 'shippingAddress-example',
    maxLength: 5000,
  })
  shippingAddress: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({
    description: 'Optional note.',
    type: String,
    example: 'note-example',
    maxLength: 500,
  })
  note?: string;
}

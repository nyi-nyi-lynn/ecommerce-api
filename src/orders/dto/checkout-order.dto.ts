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
  paymentMethod?: PaymentMethod;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shippingName: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  shippingPhone: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  shippingAddress: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

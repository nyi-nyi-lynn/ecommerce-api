import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  TransformNullableString,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';

export class RegisterDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: 'Customer display name.',
    example: 'Aye Aye',
    maxLength: 100,
  })
  name: string;

  @IsEmail()
  @MaxLength(255)
  @ApiProperty({
    description: 'Account email address.',
    example: 'customer@example.com',
    format: 'email',
    maxLength: 255,
  })
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @ApiProperty({
    description: 'Account password.',
    example: 'StrongPass123',
    format: 'password',
    maxLength: 72,
    minLength: 8,
  })
  password: string;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @ApiPropertyOptional({
    description: 'Contact phone.',
    type: String,
    nullable: true,
    example: 'phone-example',
    maxLength: 30,
  })
  phone?: string;
}

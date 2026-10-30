import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
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

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @ApiPropertyOptional({
    description: 'Contact phone.',
    type: String,
    example: 'phone-example',
    maxLength: 30,
  })
  phone?: string;
}

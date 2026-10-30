import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
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
}

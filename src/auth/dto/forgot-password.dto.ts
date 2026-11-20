import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

export class ForgotPasswordDto {
  @TransformTrimmedString()
  @IsEmail()
  @MaxLength(255)
  @ApiProperty({
    description: 'Email address associated with the account.',
    example: 'customer@example.com',
    format: 'email',
    maxLength: 255,
  })
  email: string;
}

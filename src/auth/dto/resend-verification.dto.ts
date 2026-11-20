import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

export class ResendVerificationDto {
  @TransformTrimmedString()
  @IsEmail()
  @MaxLength(255)
  @ApiProperty({
    description: 'Email address of the account to send a verification link to.',
    example: 'customer@example.com',
    format: 'email',
    maxLength: 255,
  })
  email: string;
}

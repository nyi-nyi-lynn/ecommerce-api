import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

export class VerifyEmailDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ApiProperty({
    description: 'Email verification token received via email.',
    example: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
    maxLength: 255,
  })
  token: string;
}

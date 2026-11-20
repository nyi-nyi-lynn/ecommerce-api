import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

@ValidatorConstraint({ name: 'PasswordsMatch', async: false })
class PasswordsMatchConstraint implements ValidatorConstraintInterface {
  validate(confirmPassword: unknown, args: ValidationArguments): boolean {
    const dto = args.object as ResetPasswordDto;
    return typeof confirmPassword === 'string' && confirmPassword === dto.newPassword;
  }

  defaultMessage(): string {
    return 'confirmPassword must match newPassword';
  }
}

export class ResetPasswordDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ApiProperty({
    description: 'Password reset token received via email.',
    example: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
    maxLength: 255,
  })
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @ApiProperty({
    description: 'New account password.',
    example: 'NewSecurePassword123',
    format: 'password',
    minLength: 8,
    maxLength: 72,
  })
  newPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Validate(PasswordsMatchConstraint)
  @ApiProperty({
    description: 'Confirmation of the new password (must match newPassword).',
    example: 'NewSecurePassword123',
    format: 'password',
    minLength: 8,
    maxLength: 72,
  })
  confirmPassword: string;
}

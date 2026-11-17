import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserStatus } from '../../generated/prisma/client.js';
import {
  TransformNullableString,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';

export class CreateUserDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description: 'User display name.',
    example: 'Kyaw Kyaw',
    maxLength: 100,
  })
  name!: string;

  @TransformTrimmedString()
  @IsEmail()
  @MaxLength(255)
  @ApiProperty({
    description: 'Unique account email address.',
    example: 'kyawkyaw@example.com',
    format: 'email',
    maxLength: 255,
  })
  email!: string;

  @TransformNullableString()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @ApiPropertyOptional({
    description: 'Optional unique contact phone.',
    type: String,
    nullable: true,
    example: '+959400100099',
    maxLength: 30,
  })
  phone?: string | null;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @ApiProperty({
    description: 'Initial account password (8 to 72 characters).',
    example: 'StrongPass123',
    format: 'password',
    minLength: 8,
    maxLength: 72,
  })
  password!: string;

  @IsUUID()
  @ApiProperty({
    description: 'Assigned role UUID.',
    type: String,
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  roleId!: string;

  @IsOptional()
  @IsEnum(UserStatus)
  @ApiPropertyOptional({
    description: 'Initial account status; defaults to ACTIVE.',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status?: UserStatus;
}

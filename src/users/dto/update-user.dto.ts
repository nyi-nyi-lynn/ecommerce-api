import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  TransformNullableString,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';

export class UpdateUserDto {
  @IsOptional()
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiPropertyOptional({
    description: 'Updated user display name.',
    example: 'Aye Aye Updated',
    maxLength: 100,
  })
  name?: string;

  @IsOptional()
  @TransformTrimmedString()
  @IsEmail()
  @MaxLength(255)
  @ApiPropertyOptional({
    description: 'Updated unique account email address.',
    example: 'ayeaye.updated@example.com',
    format: 'email',
    maxLength: 255,
  })
  email?: string;

  @IsOptional()
  @TransformNullableString()
  @IsString()
  @MaxLength(30)
  @ApiPropertyOptional({
    description: 'Updated contact phone (or null to clear).',
    type: String,
    nullable: true,
    example: '+959400100088',
    maxLength: 30,
  })
  phone?: string | null;
}

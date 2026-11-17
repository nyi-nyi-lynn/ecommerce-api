import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  TransformNullableString,
  TransformTrimmedString,
} from '../../common/transformers/dto-transforms.util.js';

export class UpdateProfileDto {
  @IsOptional()
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiPropertyOptional({
    description: 'Updated display name.',
    example: 'Aye Aye',
    maxLength: 100,
  })
  name?: string;

  @IsOptional()
  @TransformNullableString()
  @IsString()
  @MaxLength(30)
  @ApiPropertyOptional({
    description: 'Updated contact phone (or null to clear).',
    type: String,
    nullable: true,
    example: '+959400100005',
    maxLength: 30,
  })
  phone?: string | null;
}

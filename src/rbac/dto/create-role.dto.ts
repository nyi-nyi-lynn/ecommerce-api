import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @ApiProperty({
    description: 'Display or recipient name.',
    type: String,
    example: 'name-example',
    maxLength: 100,
    minLength: 2,
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({
    description: 'Optional descriptive text.',
    type: String,
    example: 'description-example',
    maxLength: 500,
  })
  description?: string;
}

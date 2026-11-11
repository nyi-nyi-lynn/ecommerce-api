import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderCmsContentDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @ApiProperty({ type: [String], format: 'uuid', example: ['550e8400-e29b-41d4-a716-446655440000'] })
  ids!: string[];
}

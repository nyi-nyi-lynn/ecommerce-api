import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  @ApiProperty({
    description: 'Unique permission UUIDs.',
    type: String,
    format: 'uuid',
    isArray: true,
    example: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ],
  })
  permissionIds!: string[];
}

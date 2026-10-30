import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @ApiProperty({
    description: 'Unique permission IDs.',
    type: Number,
    isArray: true,
    example: [1, 2],
    minimum: 1,
  })
  permissionIds!: number[];
}

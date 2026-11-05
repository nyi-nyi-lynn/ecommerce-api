import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignUserRoleDto {
  @IsUUID()
  @ApiProperty({
    description: 'Role UUID.',
    type: String,
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  roleId!: string;
}

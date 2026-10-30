import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AssignUserRoleDto {
  @IsInt()
  @Min(1)
  @ApiProperty({
    description: 'Role ID.',
    type: Number,
    example: 1,
    minimum: 1,
  })
  roleId!: number;
}

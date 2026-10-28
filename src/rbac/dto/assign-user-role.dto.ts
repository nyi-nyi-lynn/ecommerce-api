import { IsInt, Min } from 'class-validator';

export class AssignUserRoleDto {
  @IsInt()
  @Min(1)
  roleId!: number;
}

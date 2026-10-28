import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  permissionIds!: number[];
}

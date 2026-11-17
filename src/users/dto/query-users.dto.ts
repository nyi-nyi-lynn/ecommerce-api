import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { UserStatus } from '../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';
import { TransformBoolean } from '../../common/transformers/transform-boolean.decorator.js';

export const sortableUserFields = [
  'createdAt',
  'updatedAt',
  'name',
  'email',
] as const;

export class QueryUsersDto extends PaginationQueryDto {
  @IsOptional()
  @TransformTrimmedString()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({
    description:
      'Search users by name, email, or phone (case-insensitive); maximum 100 characters.',
    maxLength: 100,
    example: 'aye',
  })
  search?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    description: 'Filter by role UUID.',
    type: String,
    format: 'uuid',
  })
  roleId?: string;

  @IsOptional()
  @TransformTrimmedString()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({
    description: 'Filter by role name (e.g. ADMIN, STAFF, CUSTOMER).',
    maxLength: 100,
    example: 'CUSTOMER',
  })
  role?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  @ApiPropertyOptional({
    description: 'Filter by account status.',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  status?: UserStatus;

  @IsOptional()
  @TransformBoolean()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Filter by active flag.',
    type: Boolean,
    example: true,
  })
  isActive?: boolean;

  @IsOptional()
  @IsIn(sortableUserFields)
  @ApiPropertyOptional({
    description: 'Allowlisted sort field.',
    enum: sortableUserFields,
    default: 'createdAt',
    example: 'createdAt',
  })
  sortBy?: (typeof sortableUserFields)[number] = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    default: 'desc',
    example: 'desc',
  })
  sortOrder?: 'asc' | 'desc' = 'desc';
}

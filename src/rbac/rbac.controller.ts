import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './permissions.decorator.js';
import { RbacService } from './rbac.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto.js';
import { AssignUserRoleDto } from './dto/assign-user-role.dto.js';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';

const ROLE_ID_EXAMPLE = '11111111-1111-4111-8111-111111111111';
const PERMISSION_ID_EXAMPLE = '22222222-2222-4222-8222-222222222222';
const USER_ID_EXAMPLE = '550e8400-e29b-41d4-a716-446655440000';

const PERMISSION_EXAMPLE = {
  id: PERMISSION_ID_EXAMPLE,
  code: 'role:manage',
  description: 'Manage roles and permissions',
};

const ROLE_EXAMPLE = {
  id: ROLE_ID_EXAMPLE,
  name: 'ADMIN',
  description: 'Administrator role',
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
};

@Controller('rbac')
@Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('role:manage')
@ApiTags('RBAC')
@ApiBearerAuth()
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('permissions')
  @ApiDocumentEndpoint({
    summary: 'List permissions',
    description: `Lists permission codes. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [401, 403, 500],
    successExample: [PERMISSION_EXAMPLE],
  })
  listPermissions() {
    return this.rbacService.listPermissions();
  }
  @Get('roles')
  @ApiDocumentEndpoint({
    summary: 'List roles',
    description: `Lists configured roles. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [401, 403, 500],
    successExample: [
      {
        ...ROLE_EXAMPLE,
        permissions: [
          {
            roleId: ROLE_ID_EXAMPLE,
            permissionId: PERMISSION_ID_EXAMPLE,
            permission: PERMISSION_EXAMPLE,
          },
        ],
        _count: { users: 1 },
      },
    ],
  })
  listRoles() {
    return this.rbacService.listRoles();
  }
  @Post('roles')
  @ApiDocumentEndpoint({
    summary: 'Create role',
    description: `Creates a role. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 409, 500],
    successExample: ROLE_EXAMPLE,
  })
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }
  @Patch('roles/:id')
  @ApiParam({
    name: 'id',
    description: 'Role UUID.',
    type: String,
    format: 'uuid',
    example: ROLE_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Update role',
    description: `Updates role metadata. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: ROLE_EXAMPLE,
  })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rbacService.updateRole(id, dto);
  }
  @Put('roles/:id/permissions')
  @ApiParam({
    name: 'id',
    description: 'Role UUID.',
    type: String,
    format: 'uuid',
    example: ROLE_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Replace role permissions',
    description: `Sets the role's permission assignments. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: {
      ...ROLE_EXAMPLE,
      permissions: [
        {
          roleId: ROLE_ID_EXAMPLE,
          permissionId: PERMISSION_ID_EXAMPLE,
          permission: PERMISSION_EXAMPLE,
        },
      ],
    },
  })
  setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rbacService.setPermissions(id, dto.permissionIds);
  }
  @Patch('users/:id/role')
  @ApiParam({
    name: 'id',
    description: 'User UUID.',
    type: String,
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Assign user role',
    description: `Assigns a role to a user. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: {
      id: USER_ID_EXAMPLE,
      role: ROLE_EXAMPLE,
    },
  })
  assignUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignUserRoleDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.rbacService.assignUserRole(id, dto.roleId, actorId);
  }
}

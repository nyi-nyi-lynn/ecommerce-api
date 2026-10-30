import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './permissions.decorator.js';
import { RbacService } from './rbac.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto.js';
import { AssignUserRoleDto } from './dto/assign-user-role.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';

type AuthenticatedRequest = Request & { user: { sub: number } };

@Controller('rbac')
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
  })
  listPermissions() {
    return this.rbacService.listPermissions();
  }
  @Get('roles')
  @ApiDocumentEndpoint({
    summary: 'List roles',
    description: `Lists configured roles. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [401, 403, 500],
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
  })
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }
  @Patch('roles/:id')
  @ApiDocumentEndpoint({
    summary: 'Update role',
    description: `Updates role metadata. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rbacService.updateRole(id, dto);
  }
  @Put('roles/:id/permissions')
  @ApiDocumentEndpoint({
    summary: 'Replace role permissions',
    description: `Sets the role's permission assignments. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  setPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rbacService.setPermissions(id, dto.permissionIds);
  }
  @Patch('users/:id/role')
  @ApiDocumentEndpoint({
    summary: 'Assign user role',
    description: `Assigns a role to a user. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  assignUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rbacService.assignUserRole(id, dto.roleId, request.user.sub);
  }
}

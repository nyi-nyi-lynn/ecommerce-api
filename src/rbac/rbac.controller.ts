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

type AuthenticatedRequest = Request & { user: { sub: number } };

@Controller('rbac')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('role:manage')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles') listRoles() {
    return this.rbacService.listRoles();
  }
  @Get('permissions') listPermissions() {
    return this.rbacService.listPermissions();
  }
  @Post('roles') createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }
  @Patch('roles/:id') updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rbacService.updateRole(id, dto);
  }
  @Put('roles/:id/permissions') setPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rbacService.setPermissions(id, dto.permissionIds);
  }
  @Patch('users/:id/role') assignUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rbacService.assignUserRole(id, dto.roleId, request.user.sub);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import { UserStatus } from '../generated/prisma/client.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { QueryUsersDto } from './dto/query-users.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateUserRoleDto } from './dto/update-user-role.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';

const USER_ID_EXAMPLE = '550e8400-e29b-41d4-a716-446655440000';
const ROLE_ID_EXAMPLE = '11111111-1111-4111-8111-111111111111';

const USER_EXAMPLE = {
  id: USER_ID_EXAMPLE,
  name: 'Aye Aye',
  email: 'ayeaye@example.com',
  phone: '+959400100005',
  roleId: ROLE_ID_EXAMPLE,
  isActive: true,
  status: UserStatus.ACTIVE,
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
  role: {
    id: ROLE_ID_EXAMPLE,
    name: 'CUSTOMER',
    description: 'Customer role',
  },
};

@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiTags('Users')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiDocumentEndpoint({
    summary: 'Get current user profile',
    description:
      'Returns the safe profile of the authenticated user derived from the verified JWT subject.',
    errors: [401, 500],
    successExample: USER_EXAMPLE,
  })
  getCurrentUser(@CurrentUser('sub') userId: string) {
    return this.usersService.getCurrentUser(userId);
  }

  @Patch('me')
  @ApiDocumentEndpoint({
    summary: 'Update current user profile',
    description:
      'Updates permitted profile fields (name, phone) for the authenticated user. Role and status changes are not permitted.',
    errors: [400, 401, 409, 500],
    successExample: USER_EXAMPLE,
  })
  updateCurrentUser(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateCurrentUser(userId, dto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:read')
  @ApiDocumentEndpoint({
    summary: 'List users',
    description: `Returns a paginated list of users with search, role, status, and sorting filters. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 500],
    successExample: {
      items: [USER_EXAMPLE],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  listUsers(@Query() query: QueryUsersDto) {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:read')
  @ApiParam({
    name: 'id',
    description: 'User UUID.',
    type: String,
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Get user detail',
    description: `Returns safe user details and assigned role permission keys. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: {
      user: {
        id: USER_ID_EXAMPLE,
        name: 'Aye Aye',
        email: 'customer@example.com',
        phone: null,
        role: 'CUSTOMER',
        createdAt: '2026-10-30T08:00:00.000Z',
        roleId: ROLE_ID_EXAMPLE,
        isActive: true,
        status: UserStatus.ACTIVE,
        updatedAt: '2026-10-30T08:00:00.000Z',
      },
      permissions: ['category:read', 'product:read'],
    },
  })
  getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getUserById(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:create')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @ApiDocumentEndpoint({
    summary: 'Create user',
    description: `Creates a user account with a hashed password and assigned role. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 429, 500],
    successExample: USER_EXAMPLE,
  })
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:update')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @ApiParam({
    name: 'id',
    description: 'User UUID.',
    type: String,
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Update user',
    description: `Updates permitted user profile fields (name, email, phone). Role and password changes are rejected. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 429, 500],
    successExample: USER_EXAMPLE,
  })
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(id, dto);
  }

  @Patch(':id/role')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:role:assign')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @ApiParam({
    name: 'id',
    description: 'User UUID.',
    type: String,
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Assign user role',
    description: `Assigns an existing role to a user while enforcing last-administrator and privilege-escalation safeguards. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 429, 500],
    successExample: USER_EXAMPLE,
  })
  assignUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.assignUserRole(id, dto.roleId, actorId);
  }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:status:update')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @ApiParam({
    name: 'id',
    description: 'User UUID.',
    type: String,
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Update user account status',
    description: `Updates account status (ACTIVE, SUSPENDED, DEACTIVATED), revoking refresh-token sessions on disablement and protecting the last administrator. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 429, 500],
    successExample: {
      ...USER_EXAMPLE,
      isActive: false,
      status: UserStatus.SUSPENDED,
    },
  })
  updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.updateUserStatus(id, dto.status, actorId);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user:delete')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @ApiParam({
    name: 'id',
    description: 'User UUID.',
    type: String,
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Deactivate user',
    description: `Soft-deactivates a user account to preserve order, payment, and audit history while revoking refresh-token sessions. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 429, 500],
    successExample: {
      ...USER_EXAMPLE,
      isActive: false,
      status: UserStatus.DEACTIVATED,
    },
  })
  deactivateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.deactivateUser(id, actorId);
  }
}

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildPaginatedResponse,
  resolvePaginationParams,
} from '../common/pagination/pagination.util.js';
import { hasPrismaErrorCode } from '../common/prisma/prisma-error.util.js';
import { hashPassword } from '../common/security/password.util.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { QueryUsersDto } from './dto/query-users.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

export const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  roleId: true,
  isActive: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  role: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
} as const;

const CRITICAL_ADMIN_PERMISSION = 'role:manage';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: QueryUsersDto) {
    const { page, limit, skip } = resolvePaginationParams(query);
    const search = query.search?.trim();
    const roleName = query.role?.trim();

    const where: Prisma.UserWhereInput = {
      ...(query.roleId !== undefined && { roleId: query.roleId }),
      ...(roleName && {
        role: { name: { equals: roleName, mode: 'insensitive' } },
      }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.UserOrderByWithRelationInput[] = [
      { [sortBy]: sortOrder },
      { id: 'asc' },
    ];

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: SAFE_USER_SELECT,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResponse(items, total, page, limit);
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        roleId: true,
        isActive: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        role: {
          select: {
            name: true,
            permissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const { role, ...safeUser } = user;
    return {
      user: {
        ...safeUser,
        role: role?.name ?? null,
      },
      permissions: (role?.permissions ?? [])
        .map(({ permission }) => permission.code)
        .sort((a, b) => a.localeCompare(b)),
    };
  }

  async createUser(dto: CreateUserDto) {
    const [existingEmail, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      }),
      this.prisma.role.findUnique({
        where: { id: dto.roleId },
        select: { id: true },
      }),
    ]);

    if (existingEmail) {
      throw new ConflictException('Email already registered.');
    }
    if (!role) {
      throw new NotFoundException('Role not found.');
    }

    const passwordHash = await hashPassword(dto.password);
    const status = dto.status ?? UserStatus.ACTIVE;

    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone ?? null,
          passwordHash,
          roleId: dto.roleId,
          status,
          isActive: status === UserStatus.ACTIVE,
        },
        select: SAFE_USER_SELECT,
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('Email or phone is already in use.');
      }
      throw error;
    }
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('User not found.');
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
        },
        select: SAFE_USER_SELECT,
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('Email or phone is already in use.');
      }
      if (hasPrismaErrorCode(error, 'P2025')) {
        throw new NotFoundException('User not found.');
      }
      throw error;
    }
  }

  async assignUserRole(userId: string, roleId: string, actorId: string) {
    if (userId === actorId) {
      throw new ForbiddenException('You cannot change your own role.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const targetInitial = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, roleId: true },
        });
        if (!targetInitial) {
          throw new NotFoundException('User not found.');
        }

        await this.lockRolesForManagement(tx, [targetInitial.roleId, roleId]);

        const [target, targetRole, actor] = await Promise.all([
          tx.user.findUnique({
            where: { id: userId },
            include: {
              role: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          }),
          tx.role.findUnique({
            where: { id: roleId },
            include: { permissions: { include: { permission: true } } },
          }),
          tx.user.findUnique({
            where: { id: actorId },
            include: {
              role: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          }),
        ]);

        if (!target) {
          throw new NotFoundException('User not found.');
        }
        if (!targetRole) {
          throw new NotFoundException('Role not found.');
        }
        if (!actor || !this.isAccountActive(actor)) {
          throw new ForbiddenException('The actor has no valid active role.');
        }

        const actorPermissions = new Set(
          actor.role.permissions.map((link) => link.permission.code),
        );
        const actorHasRoleManage = actorPermissions.has(
          CRITICAL_ADMIN_PERMISSION,
        );
        if (!actorHasRoleManage) {
          const escalatesPrivileges = targetRole.permissions.some(
            (link) => !actorPermissions.has(link.permission.code),
          );
          if (escalatesPrivileges) {
            throw new ForbiddenException(
              'Cannot assign a role with permissions you do not hold.',
            );
          }
        }

        const targetHadAdmin =
          this.isAccountActive(target) &&
          target.role.permissions.some(
            (link) => link.permission.code === CRITICAL_ADMIN_PERMISSION,
          );
        const newRoleHasAdmin = targetRole.permissions.some(
          (link) => link.permission.code === CRITICAL_ADMIN_PERMISSION,
        );

        if (targetHadAdmin && target.roleId !== roleId && !newRoleHasAdmin) {
          await this.ensureAnotherActiveAdminExists(tx, target.id);
        }

        return tx.user.update({
          where: { id: userId },
          data: { roleId },
          select: SAFE_USER_SELECT,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async updateUserStatus(userId: string, status: UserStatus, actorId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: userId },
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        });
        if (!target) {
          throw new NotFoundException('User not found.');
        }

        const disabling = status !== UserStatus.ACTIVE;
        if (disabling) {
          if (userId === actorId) {
            throw new ConflictException(
              'You cannot disable your own account.',
            );
          }
          await this.lockRolesForManagement(tx, [target.roleId]);

          const targetIsAdmin =
            this.isAccountActive(target) &&
            target.role.permissions.some(
              (link) => link.permission.code === CRITICAL_ADMIN_PERMISSION,
            );
          if (targetIsAdmin) {
            await this.ensureAnotherActiveAdminExists(tx, target.id);
          }
        }

        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            status,
            isActive: status === UserStatus.ACTIVE,
          },
          select: SAFE_USER_SELECT,
        });

        if (disabling) {
          await tx.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async deactivateUser(userId: string, actorId: string) {
    return this.updateUserStatus(userId, UserStatus.DEACTIVATED, actorId);
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    });
    if (!user || !this.isAccountActive(user)) {
      throw new UnauthorizedException(
        user ? 'Account is Disabled' : 'User not found',
      );
    }
    return user;
  }

  async updateCurrentUser(userId: string, dto: UpdateProfileDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, status: true },
    });
    if (!existing || !this.isAccountActive(existing)) {
      throw new UnauthorizedException(
        existing ? 'Account is Disabled' : 'User not found',
      );
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
        },
        select: SAFE_USER_SELECT,
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('Phone number is already in use.');
      }
      throw error;
    }
  }

  private isAccountActive(user: {
    isActive: boolean;
    status?: UserStatus;
  }): boolean {
    return (
      user.isActive &&
      (user.status === undefined || user.status === UserStatus.ACTIVE)
    );
  }

  private async ensureAnotherActiveAdminExists(
    tx: Prisma.TransactionClient,
    excludedUserId: string,
  ): Promise<void> {
    const otherActiveAdmins = await tx.user.count({
      where: {
        isActive: true,
        status: UserStatus.ACTIVE,
        id: { not: excludedUserId },
        role: {
          permissions: {
            some: { permission: { code: CRITICAL_ADMIN_PERMISSION } },
          },
        },
      },
    });
    if (otherActiveAdmins === 0) {
      throw new ConflictException(
        'Cannot remove or disable the last active administrator.',
      );
    }
  }

  private async lockRolesForManagement(
    tx: Prisma.TransactionClient,
    targetRoleIds: string[],
  ): Promise<void> {
    if (typeof tx.$queryRaw !== 'function') return;
    const sortedIds = [...new Set(targetRoleIds)].sort((a, b) =>
      a.localeCompare(b),
    );
    await tx.$queryRaw`
      SELECT r."id"
      FROM "Role" r
      WHERE r."id" IN (${Prisma.join(sortedIds.map((id) => Prisma.sql`${id}::uuid`))})
         OR EXISTS (
           SELECT 1
           FROM "RolePermission" rp
           JOIN "Permission" p ON p."id" = rp."permissionId"
           WHERE rp."roleId" = r."id" AND p."code" = ${CRITICAL_ADMIN_PERMISSION}
         )
      ORDER BY r."id" ASC
      FOR UPDATE
    `;
  }
}

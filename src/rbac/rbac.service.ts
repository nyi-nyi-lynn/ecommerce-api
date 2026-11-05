import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { hasPrismaErrorCode } from '../common/prisma/prisma-error.util.js';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  }

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  async createRole(dto: CreateRoleDto) {
    try {
      return await this.prisma.role.create({
        data: {
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
        },
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002'))
        throw new ConflictException('Role name already exists.');
      throw error;
    }
  }

  async updateRole(id: number, dto: UpdateRoleDto) {
    try {
      return await this.prisma.role.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && {
            description: dto.description.trim() || null,
          }),
        },
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002'))
        throw new ConflictException('Role name already exists.');
      if (hasPrismaErrorCode(error, 'P2025'))
        throw new NotFoundException('Role not found.');
      throw error;
    }
  }

  async setPermissions(roleId: number, permissionIds: number[]) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockRolesForManagement(tx, [roleId]);

        const role = await tx.role.findUnique({
          where: { id: roleId },
          include: { permissions: { include: { permission: true } } },
        });
        if (!role) throw new NotFoundException('Role not found.');

        const permissions = await tx.permission.findMany({
          where: { id: { in: permissionIds } },
        });
        if (permissions.length !== permissionIds.length) {
          throw new UnprocessableEntityException(
            'One or more permissions do not exist.',
          );
        }

        const removingManage =
          role.permissions.some(
            (link) => link.permission.code === 'role:manage',
          ) &&
          !permissions.some((permission) => permission.code === 'role:manage');
        if (removingManage) {
          const otherActiveManagers = await tx.user.count({
            where: {
              isActive: true,
              roleId: { not: roleId },
              role: {
                permissions: {
                  some: { permission: { code: 'role:manage' } },
                },
              },
            },
          });
          if (otherActiveManagers === 0) {
            throw new ConflictException(
              'Cannot remove the final role management access.',
            );
          }
        }

        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissionIds.length) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              roleId,
              permissionId,
            })),
          });
        }

        return tx.role.findUniqueOrThrow({
          where: { id: roleId },
          include: { permissions: { include: { permission: true } } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async assignUserRole(userId: number, roleId: number, actorId: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const targetInitial = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, roleId: true },
        });
        if (!targetInitial) throw new NotFoundException('User not found.');

        await this.lockRolesForManagement(tx, [targetInitial.roleId, roleId]);

        const [target, role] = await Promise.all([
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
        ]);
        if (!target) throw new NotFoundException('User not found.');
        if (!role) throw new NotFoundException('Role not found.');

        const targetHadManage =
          target.isActive &&
          target.role.permissions.some(
            (link) => link.permission.code === 'role:manage',
          );
        const newRoleHasManage = role.permissions.some(
          (link) => link.permission.code === 'role:manage',
        );

        if (
          (targetHadManage || target.id === actorId) &&
          target.roleId !== roleId &&
          !newRoleHasManage
        ) {
          const otherActiveManagers = await tx.user.count({
            where: {
              isActive: true,
              id: { not: target.id },
              role: {
                permissions: {
                  some: { permission: { code: 'role:manage' } } },
              },
            },
          });
          if (otherActiveManagers === 0) {
            throw new ConflictException(
              'Cannot remove the final role management access.',
            );
          }
        }

        return tx.user.update({
          where: { id: userId },
          data: { roleId },
          select: { id: true, role: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  /**
   * Locks all roles that currently grant `role:manage` plus any target role IDs
   * in deterministic ascending ID order to serialize concurrent manager changes
   * without deadlocks.
   */
  private async lockRolesForManagement(
    tx: Prisma.TransactionClient,
    targetRoleIds: number[],
  ) {
    if (typeof tx.$queryRaw !== 'function') return;
    await tx.$queryRaw`
      SELECT r."id"
      FROM "Role" r
      WHERE r."id" IN (${Prisma.join([...new Set(targetRoleIds)].sort((a, b) => a - b))})
         OR EXISTS (
           SELECT 1
           FROM "RolePermission" rp
           JOIN "Permission" p ON p."id" = rp."permissionId"
           WHERE rp."roleId" = r."id" AND p."code" = 'role:manage'
         )
      ORDER BY r."id" ASC
      FOR UPDATE
    `;
  }
}

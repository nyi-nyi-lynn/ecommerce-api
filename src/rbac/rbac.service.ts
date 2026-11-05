import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

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
      if (this.hasCode(error, 'P2002'))
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
      if (this.hasCode(error, 'P2002'))
        throw new ConflictException('Role name already exists.');
      if (this.hasCode(error, 'P2025'))
        throw new NotFoundException('Role not found.');
      throw error;
    }
  }

  async setPermissions(roleId: number, permissionIds: number[]) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found.');
    const permissions = await this.prisma.permission.findMany({
      where: { id: { in: permissionIds } },
    });
    if (permissions.length !== permissionIds.length) {
      throw new UnprocessableEntityException(
        'One or more permissions do not exist.',
      );
    }

    const removingManage =
      role.permissions.some((link) => link.permission.code === 'role:manage') &&
      !permissions.some((permission) => permission.code === 'role:manage');
    if (removingManage) {
      const otherManagers = await this.prisma.user.count({
        where: {
          roleId: { not: roleId },
          role: {
            permissions: { some: { permission: { code: 'role:manage' } } },
          },
        },
      });
      if (otherManagers === 0) {
        throw new ConflictException(
          'Cannot remove the final role management access.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
      }
    });
    return this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async assignUserRole(userId: number, roleId: number, actorId: number) {
    const [target, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      }),
      this.prisma.role.findUnique({ where: { id: roleId } }),
    ]);
    if (!target) throw new NotFoundException('User not found.');
    if (!role) throw new NotFoundException('Role not found.');

    if (target.id === actorId && target.roleId !== roleId) {
      const keepsManagerAccess = await this.prisma.rolePermission.findFirst({
        where: { roleId, permission: { code: 'role:manage' } },
      });
      const otherManagers = await this.prisma.user.count({
        where: {
          id: { not: actorId },
          role: {
            permissions: { some: { permission: { code: 'role:manage' } } },
          },
        },
      });
      if (!keepsManagerAccess && otherManagers === 0) {
        throw new ConflictException(
          'Cannot remove the final role management access.',
        );
      }
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { roleId },
      select: { id: true, role: true },
    });
  }

  private hasCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
}

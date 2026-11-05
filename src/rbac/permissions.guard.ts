import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface.js';

type RbacRequest = Partial<AuthenticatedRequest> & {
  rbacPermissions?: Set<string>;
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<RbacRequest>();
    const userId = request.user?.sub;
    if (typeof userId !== 'string' || !isUUID(userId)) {
      throw new UnauthorizedException('Authentication is required.');
    }

    if (!request.rbacPermissions) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          isActive: true,
          role: {
            select: {
              permissions: {
                select: { permission: { select: { code: true } } },
              },
            },
          },
        },
      });
      if (!user?.isActive || !user.role) {
        throw new ForbiddenException('The user has no valid active role.');
      }
      request.rbacPermissions = new Set(
        user.role.permissions.map(({ permission }) => permission.code),
      );
    }

    if (
      !required.every((permission) => request.rbacPermissions?.has(permission))
    ) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }
    return true;
  }
}

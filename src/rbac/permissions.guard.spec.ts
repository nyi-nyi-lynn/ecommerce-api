import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './permissions.decorator.js';

class GuardTestController {
  @RequirePermissions('category:create', 'category:update')
  protectedRoute() {}
}

function makeContext(user: { sub?: unknown } | undefined): ExecutionContext {
  const handler = Object.getOwnPropertyDescriptor(
    GuardTestController.prototype,
    'protectedRoute',
  )?.value as () => void;
  return {
    getHandler: () => handler,
    getClass: () => GuardTestController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const prisma = {
    user: { findUnique: vi.fn() },
  };
  let guard: PermissionsGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new PermissionsGuard(new Reflector(), prisma as never);
  });

  it('requires every declared permission and reads current database permissions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      role: { permissions: [
        { permission: { code: 'category:create' } },
        { permission: { code: 'category:update' } },
      ] },
    });
    await expect(guard.canActivate(makeContext({ sub: 10 }))).resolves.toBe(true);
  });

  it('denies when the database role lacks any required permission', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      role: { permissions: [{ permission: { code: 'category:create' } }] },
    });
    await expect(guard.canActivate(makeContext({ sub: 10 }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses fresh database permissions on each request', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ isActive: true, role: { permissions: [] } })
      .mockResolvedValueOnce({ isActive: true, role: { permissions: [
        { permission: { code: 'category:create' } },
        { permission: { code: 'category:update' } },
      ] } });
    await expect(guard.canActivate(makeContext({ sub: 10 }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(makeContext({ sub: 10 }))).resolves.toBe(true);
  });

  it('returns 401 for a missing identity and denies deleted or inactive users', async () => {
    await expect(guard.canActivate(makeContext(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ isActive: false, role: null });
    await expect(guard.canActivate(makeContext({ sub: 10 }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(makeContext({ sub: 10 }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

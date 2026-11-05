import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { RbacService } from './rbac.service.js';

describe('RbacService', () => {
  let service: RbacService;
  let prisma: any;
  let roles: Array<{ id: number; name: string; description: string | null }>;
  let permissions: Array<{ id: number; code: string; description: string | null }>;
  let rolePermissions: Array<{ roleId: number; permissionId: number }>;
  let users: Array<{ id: number; roleId: number; isActive: boolean }>;
  let lockedRoleOrders: number[][];
  let txQueue: Promise<unknown>;

  beforeEach(() => {
    roles = [
      { id: 1, name: 'ADMIN', description: 'Admin role' },
      { id: 2, name: 'CUSTOMER', description: 'Customer role' },
      { id: 3, name: 'CO_ADMIN', description: 'Secondary manager role' },
    ];
    permissions = [
      { id: 10, code: 'role:manage', description: 'Manage roles' },
      { id: 11, code: 'product:read', description: 'Read products' },
    ];
    rolePermissions = [{ roleId: 1, permissionId: 10 }];
    users = [{ id: 100, roleId: 1, isActive: true }];
    lockedRoleOrders = [];
    txQueue = Promise.resolve();

    const buildTx = () => ({
      $queryRaw: vi.fn(
        async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          const lockedIds = values
            .flatMap((v) =>
              Array.isArray(v)
                ? v
                : typeof v === 'object' && v !== null && 'values' in v
                  ? (v as { values: unknown[] }).values
                  : [v],
            )
            .filter((v): v is number => typeof v === 'number');
          lockedRoleOrders.push(lockedIds);
          return lockedIds.map((id) => ({ id }));
        },
      ),
      role: {
        findMany: vi.fn(async ({ where }: any) => {
          if (where?.permissions?.some?.permission?.code === 'role:manage') {
            const managerPermIds = permissions
              .filter((p) => p.code === 'role:manage')
              .map((p) => p.id);
            const managerRoleIds = new Set(
              rolePermissions
                .filter((rp) => managerPermIds.includes(rp.permissionId))
                .map((rp) => rp.roleId),
            );
            return roles
              .filter((r) => managerRoleIds.has(r.id))
              .map((r) => ({ id: r.id }));
          }
          return roles;
        }),
        findUnique: vi.fn(async ({ where, include }: any) => {
          const role = roles.find((r) => r.id === where.id);
          if (!role) return null;
          if (include?.permissions) {
            return {
              ...role,
              permissions: rolePermissions
                .filter((rp) => rp.roleId === role.id)
                .map((rp) => ({
                  roleId: rp.roleId,
                  permissionId: rp.permissionId,
                  permission: permissions.find(
                    (p) => p.id === rp.permissionId,
                  )!,
                })),
            };
          }
          return role;
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: any) => {
          const role = roles.find((r) => r.id === where.id);
          if (!role) throw new Error('Role not found');
          return {
            ...role,
            permissions: rolePermissions
              .filter((rp) => rp.roleId === role.id)
              .map((rp) => ({
                roleId: rp.roleId,
                permissionId: rp.permissionId,
                permission: permissions.find((p) => p.id === rp.permissionId)!,
              })),
          };
        }),
      },
      permission: {
        findMany: vi.fn(async ({ where }: any) => {
          if (where?.id?.in) {
            return permissions.filter((p) => where.id.in.includes(p.id));
          }
          return permissions;
        }),
      },
      rolePermission: {
        findFirst: vi.fn(async ({ where }: any) => {
          const code = where?.permission?.code;
          const permIds = code
            ? permissions.filter((p) => p.code === code).map((p) => p.id)
            : permissions.map((p) => p.id);
          const match = rolePermissions.find(
            (rp) =>
              rp.roleId === where.roleId && permIds.includes(rp.permissionId),
          );
          return match ?? null;
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
          const before = rolePermissions.length;
          rolePermissions = rolePermissions.filter(
            (rp) => rp.roleId !== where.roleId,
          );
          return { count: before - rolePermissions.length };
        }),
        createMany: vi.fn(async ({ data }: any) => {
          rolePermissions.push(...data);
          return { count: data.length };
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) => {
          const user = users.find((u) => u.id === where.id);
          if (!user) return null;
          const role = roles.find((r) => r.id === user.roleId)!;
          return {
            ...user,
            role: {
              ...role,
              permissions: rolePermissions
                .filter((rp) => rp.roleId === role.id)
                .map((rp) => ({
                  roleId: rp.roleId,
                  permissionId: rp.permissionId,
                  permission: permissions.find(
                    (p) => p.id === rp.permissionId,
                  )!,
                })),
            },
          };
        }),
        count: vi.fn(async ({ where }: any) => {
          const managerPermIds = permissions
            .filter((p) => p.code === 'role:manage')
            .map((p) => p.id);
          const managerRoleIds = new Set(
            rolePermissions
              .filter((rp) => managerPermIds.includes(rp.permissionId))
              .map((rp) => rp.roleId),
          );

          return users.filter((u) => {
            if (where?.isActive !== undefined && u.isActive !== where.isActive) {
              return false;
            }
            if (where?.id?.not !== undefined && u.id === where.id.not) {
              return false;
            }
            if (where?.roleId?.not !== undefined && u.roleId === where.roleId.not) {
              return false;
            }
            if (where?.role?.permissions?.some?.permission?.code === 'role:manage') {
              return managerRoleIds.has(u.roleId);
            }
            return true;
          }).length;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const user = users.find((u) => u.id === where.id);
          if (!user) throw new Error('User not found');
          user.roleId = data.roleId;
          return {
            id: user.id,
            role: roles.find((r) => r.id === user.roleId)!,
          };
        }),
      },
    });

    prisma = {
      // Serialize ReadCommitted transactions that lock overlapping manager roles
      $transaction: vi.fn((callback: any, _options?: any) => {
        const next = txQueue.then(() => callback(buildTx()));
        txQueue = next.catch(() => undefined);
        return next;
      }),
      role: {
        findMany: vi.fn(async () => roles),
        create: vi.fn(async ({ data }: any) => {
          if (roles.some((r) => r.name === data.name)) {
            throw { code: 'P2002' };
          }
          const created = { id: roles.length + 1, ...data };
          roles.push(created);
          return created;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const role = roles.find((r) => r.id === where.id);
          if (!role) throw { code: 'P2025' };
          if (
            data.name &&
            roles.some((r) => r.id !== where.id && r.name === data.name)
          ) {
            throw { code: 'P2002' };
          }
          Object.assign(role, data);
          return role;
        }),
      },
      permission: {
        findMany: vi.fn(async () => permissions),
      },
    };

    service = new RbacService(prisma);
  });

  it('1. does not count an inactive admin as another active manager', async () => {
    // Add an inactive user to CO_ADMIN (which also has role:manage)
    rolePermissions.push({ roleId: 3, permissionId: 10 });
    users.push({ id: 101, roleId: 3, isActive: false });

    // Removing role:manage from role 1 (held by active user 100) must fail
    // because user 101 is inactive.
    await expect(service.setPermissions(1, [11])).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );

    // Self-demoting active user 100 from ADMIN (1) to CUSTOMER (2) must also fail
    await expect(service.assignUserRole(100, 2, 100)).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );
  });

  it('2. prevents the last active manager from removing their own management permission', async () => {
    await expect(service.setPermissions(1, [11])).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );
    await expect(service.assignUserRole(100, 2, 100)).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );
  });

  it('3. allows a permitted change when another active manager exists', async () => {
    rolePermissions.push({ roleId: 3, permissionId: 10 });
    users.push({ id: 102, roleId: 3, isActive: true });

    // Role 1 can drop role:manage because active user 102 on Role 3 still has role:manage
    const updatedRole = await service.setPermissions(1, [11]);
    expect(updatedRole.permissions.map((p: any) => p.permission.code)).toEqual([
      'product:read',
    ]);

    // Restore role:manage on Role 1 and test self-role change for user 100
    await service.setPermissions(1, [10, 11]);
    const reassigned = await service.assignUserRole(100, 2, 100);
    expect(reassigned.role.name).toBe('CUSTOMER');
  });

  it('4. prevents two concurrent changes from removing the last active manager and locks roles in ascending ID order', async () => {
    rolePermissions.push({ roleId: 3, permissionId: 10 });
    users.push({ id: 102, roleId: 3, isActive: true });

    // Concurrent attempts to strip role:manage from Role 3 and Role 1 simultaneously
    const results = await Promise.allSettled([
      service.setPermissions(3, [11]),
      service.setPermissions(1, [11]),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );

    // Verify ReadCommitted transaction isolation and deterministic ascending role lock order
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    for (const lockOrder of lockedRoleOrders) {
      expect(lockOrder).toEqual([...lockOrder].sort((a, b) => a - b));
    }
  });

  it('5. preserves existing role and permission management behavior', async () => {
    expect(await service.listRoles()).toHaveLength(3);
    expect(await service.listPermissions()).toHaveLength(2);

    const created = await service.createRole({
      name: '  AUDITOR  ',
      description: '  Read-only auditor  ',
    });
    expect(created).toMatchObject({
      name: 'AUDITOR',
      description: 'Read-only auditor',
    });

    await expect(
      service.createRole({ name: 'AUDITOR' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const updated = await service.updateRole(created.id, {
      name: '  COMPLIANCE  ',
      description: '   ',
    });
    expect(updated).toMatchObject({
      name: 'COMPLIANCE',
      description: null,
    });

    await expect(
      service.updateRole(999, { name: 'MISSING' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(service.setPermissions(999, [10])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.setPermissions(2, [999])).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.assignUserRole(999, 1, 100)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.assignUserRole(100, 999, 100)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});


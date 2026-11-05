import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { RbacService } from './rbac.service.js';

describe('RbacService', () => {
  const ROLE_ADMIN = '00000000-0000-4000-8000-000000000001';
  const ROLE_CUSTOMER = '00000000-0000-4000-8000-000000000002';
  const ROLE_CO_ADMIN = '00000000-0000-4000-8000-000000000003';
  const ROLE_MISSING = '00000000-0000-4000-8000-000000000999';
  const PERM_MANAGE = '00000000-0000-4000-8000-000000000010';
  const PERM_PRODUCT_READ = '00000000-0000-4000-8000-000000000011';
  const PERM_MISSING = '00000000-0000-4000-8000-000000000999';
  const USER_ACTIVE_ADMIN = '00000000-0000-4000-8000-000000000100';
  const USER_INACTIVE_CO_ADMIN = '00000000-0000-4000-8000-000000000101';
  const USER_ACTIVE_CO_ADMIN = '00000000-0000-4000-8000-000000000102';
  const USER_MISSING = '00000000-0000-4000-8000-000000000999';

  let service: RbacService;
  let prisma: any;
  let roles: Array<{ id: string; name: string; description: string | null }>;
  let permissions: Array<{ id: string; code: string; description: string | null }>;
  let rolePermissions: Array<{ roleId: string; permissionId: string }>;
  let users: Array<{ id: string; roleId: string; isActive: boolean }>;
  let lockedRoleOrders: string[][];
  let txQueue: Promise<unknown>;

  beforeEach(() => {
    roles = [
      { id: ROLE_ADMIN, name: 'ADMIN', description: 'Admin role' },
      { id: ROLE_CUSTOMER, name: 'CUSTOMER', description: 'Customer role' },
      { id: ROLE_CO_ADMIN, name: 'CO_ADMIN', description: 'Secondary manager role' },
    ];
    permissions = [
      { id: PERM_MANAGE, code: 'role:manage', description: 'Manage roles' },
      { id: PERM_PRODUCT_READ, code: 'product:read', description: 'Read products' },
    ];
    rolePermissions = [{ roleId: ROLE_ADMIN, permissionId: PERM_MANAGE }];
    users = [{ id: USER_ACTIVE_ADMIN, roleId: ROLE_ADMIN, isActive: true }];
    lockedRoleOrders = [];
    txQueue = Promise.resolve();

    const extractStringIds = (val: unknown): string[] => {
      if (typeof val === 'string') return [val];
      if (Array.isArray(val)) return val.flatMap(extractStringIds);
      if (typeof val === 'object' && val !== null && 'values' in val) {
        return extractStringIds((val as { values: unknown[] }).values);
      }
      return [];
    };

    const buildTx = () => ({
      $queryRaw: vi.fn(
        async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          const lockedIds = extractStringIds(values);
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
          const created = {
            id: `00000000-0000-4000-8000-${String(roles.length + 1).padStart(12, '0')}`,
            ...data,
          };
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
    rolePermissions.push({ roleId: ROLE_CO_ADMIN, permissionId: PERM_MANAGE });
    users.push({ id: USER_INACTIVE_CO_ADMIN, roleId: ROLE_CO_ADMIN, isActive: false });

    // Removing role:manage from role 1 (held by active user 100) must fail
    // because user 101 is inactive.
    await expect(
      service.setPermissions(ROLE_ADMIN, [PERM_PRODUCT_READ]),
    ).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );

    // Self-demoting active user 100 from ADMIN (1) to CUSTOMER (2) must also fail
    await expect(
      service.assignUserRole(USER_ACTIVE_ADMIN, ROLE_CUSTOMER, USER_ACTIVE_ADMIN),
    ).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );
  });

  it('2. prevents the last active manager from removing their own management permission', async () => {
    await expect(
      service.setPermissions(ROLE_ADMIN, [PERM_PRODUCT_READ]),
    ).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );
    await expect(
      service.assignUserRole(USER_ACTIVE_ADMIN, ROLE_CUSTOMER, USER_ACTIVE_ADMIN),
    ).rejects.toThrow(
      new ConflictException('Cannot remove the final role management access.'),
    );
  });

  it('3. allows a permitted change when another active manager exists', async () => {
    rolePermissions.push({ roleId: ROLE_CO_ADMIN, permissionId: PERM_MANAGE });
    users.push({ id: USER_ACTIVE_CO_ADMIN, roleId: ROLE_CO_ADMIN, isActive: true });

    // Role 1 can drop role:manage because active user 102 on Role 3 still has role:manage
    const updatedRole = await service.setPermissions(ROLE_ADMIN, [
      PERM_PRODUCT_READ,
    ]);
    expect(updatedRole.permissions.map((p: any) => p.permission.code)).toEqual([
      'product:read',
    ]);

    // Restore role:manage on Role 1 and test self-role change for user 100
    await service.setPermissions(ROLE_ADMIN, [PERM_MANAGE, PERM_PRODUCT_READ]);
    const reassigned = await service.assignUserRole(
      USER_ACTIVE_ADMIN,
      ROLE_CUSTOMER,
      USER_ACTIVE_ADMIN,
    );
    expect(reassigned.role.name).toBe('CUSTOMER');
  });

  it('4. prevents two concurrent changes from removing the last active manager and locks roles in ascending ID order', async () => {
    rolePermissions.push({ roleId: ROLE_CO_ADMIN, permissionId: PERM_MANAGE });
    users.push({ id: USER_ACTIVE_CO_ADMIN, roleId: ROLE_CO_ADMIN, isActive: true });

    // Concurrent attempts to strip role:manage from Role 3 and Role 1 simultaneously
    const results = await Promise.allSettled([
      service.setPermissions(ROLE_CO_ADMIN, [PERM_PRODUCT_READ]),
      service.setPermissions(ROLE_ADMIN, [PERM_PRODUCT_READ]),
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
      expect(lockOrder).toEqual([...lockOrder].sort((a, b) => a.localeCompare(b)));
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
      service.updateRole(ROLE_MISSING, { name: 'MISSING' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.setPermissions(ROLE_MISSING, [PERM_MANAGE]),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.setPermissions(ROLE_CUSTOMER, [PERM_MISSING]),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.assignUserRole(USER_MISSING, ROLE_ADMIN, USER_ACTIVE_ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.assignUserRole(USER_ACTIVE_ADMIN, ROLE_MISSING, USER_ACTIVE_ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});


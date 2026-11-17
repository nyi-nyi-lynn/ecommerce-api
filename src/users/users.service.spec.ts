import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '../generated/prisma/client.js';
import { UsersService } from './users.service.js';

vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
  compare: vi.fn().mockResolvedValue(true),
}));

describe('UsersService', () => {
  const ROLE_ADMIN = '00000000-0000-4000-8000-000000000001';
  const ROLE_STAFF = '00000000-0000-4000-8000-000000000002';
  const ROLE_CUSTOMER = '00000000-0000-4000-8000-000000000003';
  const ROLE_MISSING = '00000000-0000-4000-8000-000000000999';

  const USER_ADMIN = '00000000-0000-4000-8000-000000000101';
  const USER_STAFF = '00000000-0000-4000-8000-000000000102';
  const USER_CUSTOMER = '00000000-0000-4000-8000-000000000103';
  const USER_MISSING = '00000000-0000-4000-8000-000000000999';

  let service: UsersService;
  let prisma: any;
  let users: any[];
  let roles: any[];
  let refreshTokens: any[];

  const toSafeUser = (u: any, role: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    roleId: u.roleId,
    isActive: u.isActive,
    status: u.status,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    role: {
      id: role.id,
      name: role.name,
      description: role.description,
    },
  });

  beforeEach(() => {
    roles = [
      {
        id: ROLE_ADMIN,
        name: 'ADMIN',
        description: 'Admin role',
        permissions: [
          { permission: { code: 'role:manage' } },
          { permission: { code: 'user:read' } },
          { permission: { code: 'user:create' } },
          { permission: { code: 'user:update' } },
          { permission: { code: 'user:role:assign' } },
          { permission: { code: 'user:status:update' } },
          { permission: { code: 'user:delete' } },
        ],
      },
      {
        id: ROLE_STAFF,
        name: 'STAFF',
        description: 'Staff role',
        permissions: [
          { permission: { code: 'user:role:assign' } },
          { permission: { code: 'product:read' } },
        ],
      },
      {
        id: ROLE_CUSTOMER,
        name: 'CUSTOMER',
        description: 'Customer role',
        permissions: [{ permission: { code: 'product:read' } }],
      },
    ];

    users = [
      {
        id: USER_ADMIN,
        name: 'Admin User',
        email: 'admin@example.com',
        phone: '+959400100001',
        passwordHash: '$2b$12$secretadminhash',
        roleId: ROLE_ADMIN,
        isActive: true,
        status: UserStatus.ACTIVE,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        id: USER_STAFF,
        name: 'Staff One',
        email: 'staff1@example.com',
        phone: '+959400100002',
        passwordHash: '$2b$12$secretstaffhash',
        roleId: ROLE_STAFF,
        isActive: true,
        status: UserStatus.ACTIVE,
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        updatedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
      {
        id: USER_CUSTOMER,
        name: 'Aye Aye',
        email: 'ayeaye@example.com',
        phone: '+959400100005',
        passwordHash: '$2b$12$secretcustomerhash',
        roleId: ROLE_CUSTOMER,
        isActive: true,
        status: UserStatus.ACTIVE,
        createdAt: new Date('2026-10-03T00:00:00.000Z'),
        updatedAt: new Date('2026-10-03T00:00:00.000Z'),
      },
    ];

    refreshTokens = [
      {
        id: 'token-1',
        userId: USER_CUSTOMER,
        revokedAt: null,
      },
      {
        id: 'token-2',
        userId: USER_ADMIN,
        revokedAt: null,
      },
    ];

    const filterUsers = (where: any = {}) =>
      users.filter((u) => {
        if (where.roleId && u.roleId !== where.roleId) return false;
        if (where.status && u.status !== where.status) return false;
        if (where.isActive !== undefined && u.isActive !== where.isActive)
          return false;
        if (where.role?.name?.equals) {
          const r = roles.find((item) => item.id === u.roleId);
          if (
            !r ||
            r.name.toLowerCase() !== where.role.name.equals.toLowerCase()
          ) {
            return false;
          }
        }
        if (where.OR) {
          const q = (
            where.OR[0]?.name?.contains ?? ''
          ).toLowerCase();
          const matches =
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            (u.phone && u.phone.toLowerCase().includes(q));
          if (!matches) return false;
        }
        return true;
      });

    prisma = {
      user: {
        findMany: vi.fn(async ({ where, skip = 0, take = 20 }: any) => {
          return filterUsers(where)
            .slice(skip, skip + take)
            .map((u) => {
              const role = roles.find((r) => r.id === u.roleId)!;
              return toSafeUser(u, role);
            });
        }),
        count: vi.fn(async ({ where }: any) => {
          if (where?.role?.permissions?.some?.permission?.code) {
            const code = where.role.permissions.some.permission.code;
            return users.filter((u) => {
              if (where.isActive !== undefined && u.isActive !== where.isActive)
                return false;
              if (where.status && u.status !== where.status) return false;
              if (where.id?.not && u.id === where.id.not) return false;
              const r = roles.find((item) => item.id === u.roleId);
              return r?.permissions.some((p: any) => p.permission.code === code);
            }).length;
          }
          return filterUsers(where).length;
        }),
        findUnique: vi.fn(async ({ where, select, include }: any) => {
          const u = users.find(
            (item) =>
              (where.id && item.id === where.id) ||
              (where.email && item.email === where.email),
          );
          if (!u) return null;
          const role = roles.find((r) => r.id === u.roleId) ?? null;
          if (select?.role?.select?.permissions) {
            return {
              id: u.id,
              name: u.name,
              email: u.email,
              phone: u.phone,
              roleId: u.roleId,
              isActive: u.isActive,
              status: u.status,
              createdAt: u.createdAt,
              updatedAt: u.updatedAt,
              role: role
                ? {
                    name: role.name,
                    permissions: role.permissions,
                  }
                : null,
            };
          }
          if (select?.role) {
            return toSafeUser(u, role);
          }
          if (include?.role) {
            return { ...u, role };
          }
          return { ...u };
        }),
        create: vi.fn(async ({ data }: any) => {
          if (
            users.some(
              (u) =>
                u.email === data.email ||
                (data.phone && u.phone === data.phone),
            )
          ) {
            throw { code: 'P2002' };
          }
          const created = {
            id: '00000000-0000-4000-8000-000000000199',
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          users.push(created);
          const role = roles.find((r) => r.id === created.roleId)!;
          return toSafeUser(created, role);
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const idx = users.findIndex((u) => u.id === where.id);
          if (idx === -1) throw { code: 'P2025' };
          if (
            users.some(
              (u) =>
                u.id !== where.id &&
                ((data.email && u.email === data.email) ||
                  (data.phone && u.phone === data.phone)),
            )
          ) {
            throw { code: 'P2002' };
          }
          users[idx] = { ...users[idx], ...data, updatedAt: new Date() };
          const role = roles.find((r) => r.id === users[idx].roleId)!;
          return toSafeUser(users[idx], role);
        }),
      },
      role: {
        findUnique: vi.fn(async ({ where, include }: any) => {
          const role = roles.find((r) => r.id === where.id);
          if (!role) return null;
          return include ? role : { id: role.id };
        }),
      },
      refreshToken: {
        updateMany: vi.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const rt of refreshTokens) {
            if (rt.userId === where.userId && rt.revokedAt === null) {
              rt.revokedAt = data.revokedAt;
              count++;
            }
          }
          return { count };
        }),
      },
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };

    service = new UsersService(prisma);
  });

  describe('listUsers', () => {
    it('returns paginated users without sensitive fields', async () => {
      const result = await service.listUsers({ page: 1, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      for (const item of result.items) {
        expect(item).not.toHaveProperty('passwordHash');
        expect(item).toHaveProperty('role.name');
      }
    });

    it('filters by search, role, and status', async () => {
      const bySearch = await service.listUsers({ search: 'aye' });
      expect(bySearch.items).toHaveLength(1);
      expect(bySearch.items[0].email).toBe('ayeaye@example.com');

      const byPhone = await service.listUsers({ search: '100002' });
      expect(byPhone.items).toHaveLength(1);
      expect(byPhone.items[0].email).toBe('staff1@example.com');

      const byRole = await service.listUsers({ role: 'STAFF' });
      expect(byRole.items).toHaveLength(1);
      expect(byRole.items[0].id).toBe(USER_STAFF);

      const byStatus = await service.listUsers({
        status: UserStatus.SUSPENDED,
      });
      expect(byStatus.items).toHaveLength(0);
    });
  });

  describe('getUserById', () => {
    it('returns nested user object and permission string array excluding sensitive fields', async () => {
      const result = await service.getUserById(USER_CUSTOMER);
      expect(result.user.id).toBe(USER_CUSTOMER);
      expect(result.user.role).toBe('CUSTOMER');
      expect(result.user.roleId).toBe(ROLE_CUSTOMER);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('refreshTokens');
      expect(result.permissions).toEqual(['product:read']);
      for (const perm of result.permissions) {
        expect(typeof perm).toBe('string');
      }
    });

    it('returns empty permissions array when role has no permissions or user has no role', async () => {
      roles[2].permissions = [];
      const noPermsResult = await service.getUserById(USER_CUSTOMER);
      expect(noPermsResult.permissions).toEqual([]);

      users[2].roleId = '00000000-0000-4000-8000-000000000888';
      const noRoleResult = await service.getUserById(USER_CUSTOMER);
      expect(noRoleResult.user.role).toBeNull();
      expect(noRoleResult.permissions).toEqual([]);
    });

    it('throws NotFoundException for nonexistent user', async () => {
      await expect(service.getUserById(USER_MISSING)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createUser', () => {
    it('creates user with hashed password and assigned role', async () => {
      const created = await service.createUser({
        name: 'New Staff',
        email: 'newstaff@example.com',
        phone: '+959400100099',
        password: 'Password123!',
        roleId: ROLE_STAFF,
      });
      expect(created.email).toBe('newstaff@example.com');
      expect(created.status).toBe(UserStatus.ACTIVE);
      expect(created.isActive).toBe(true);
      expect(created).not.toHaveProperty('passwordHash');
      const stored = users.find((u) => u.email === 'newstaff@example.com');
      expect(stored.passwordHash).toBe('$2b$12$hashedpassword');
    });

    it('rejects duplicate email with ConflictException', async () => {
      await expect(
        service.createUser({
          name: 'Dup',
          email: 'ayeaye@example.com',
          password: 'Password123!',
          roleId: ROLE_CUSTOMER,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects nonexistent role with NotFoundException', async () => {
      await expect(
        service.createUser({
          name: 'Bad Role',
          email: 'badrole@example.com',
          password: 'Password123!',
          roleId: ROLE_MISSING,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateUser', () => {
    it('updates permitted profile fields', async () => {
      const updated = await service.updateUser(USER_CUSTOMER, {
        name: 'Aye Aye Updated',
      });
      expect(updated.name).toBe('Aye Aye Updated');
    });

    it('rejects duplicate email with ConflictException', async () => {
      await expect(
        service.updateUser(USER_CUSTOMER, { email: 'admin@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('assignUserRole', () => {
    it('assigns a valid role when actor has role:manage', async () => {
      const updated = await service.assignUserRole(
        USER_CUSTOMER,
        ROLE_STAFF,
        USER_ADMIN,
      );
      expect(updated.roleId).toBe(ROLE_STAFF);
    });

    it('rejects self-role change', async () => {
      await expect(
        service.assignUserRole(USER_ADMIN, ROLE_CUSTOMER, USER_ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('prevents privilege escalation when actor lacks target role permissions', async () => {
      await expect(
        service.assignUserRole(USER_CUSTOMER, ROLE_ADMIN, USER_STAFF),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('protects against removing the last administrator', async () => {
      // Promote another user to act as actor so it is not a self-change
      const secondActor = '00000000-0000-4000-8000-000000000104';
      users.push({
        id: secondActor,
        name: 'Staff Manager',
        email: 'manager@example.com',
        phone: null,
        passwordHash: '$2b$12$hash',
        roleId: ROLE_STAFF,
        isActive: true,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(
        service.assignUserRole(USER_ADMIN, ROLE_CUSTOMER, secondActor),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateUserStatus and deactivateUser', () => {
    it('suspends a user, sets isActive=false, and revokes refresh tokens', async () => {
      const updated = await service.updateUserStatus(
        USER_CUSTOMER,
        UserStatus.SUSPENDED,
        USER_ADMIN,
      );
      expect(updated.status).toBe(UserStatus.SUSPENDED);
      expect(updated.isActive).toBe(false);
      expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
    });

    it('deactivates a user via DELETE and revokes refresh tokens', async () => {
      const updated = await service.deactivateUser(USER_CUSTOMER, USER_ADMIN);
      expect(updated.status).toBe(UserStatus.DEACTIVATED);
      expect(updated.isActive).toBe(false);
      expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
    });

    it('prevents disabling the last active administrator', async () => {
      await expect(
        service.updateUserStatus(USER_ADMIN, UserStatus.SUSPENDED, USER_STAFF),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('prevents self-disablement', async () => {
      await expect(
        service.updateUserStatus(USER_ADMIN, UserStatus.SUSPENDED, USER_ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('current user profile', () => {
    it('reads and updates own profile', async () => {
      const me = await service.getCurrentUser(USER_CUSTOMER);
      expect(me.id).toBe(USER_CUSTOMER);
      expect(me).not.toHaveProperty('passwordHash');

      const updated = await service.updateCurrentUser(USER_CUSTOMER, {
        name: 'Aye New',
      });
      expect(updated.name).toBe('Aye New');
    });

    it('rejects disabled user profile access', async () => {
      users[2].status = UserStatus.SUSPENDED;
      users[2].isActive = false;
      await expect(
        service.getCurrentUser(USER_CUSTOMER),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});

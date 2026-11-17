import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('Users HTTP', () => {
  const ROLE_ADMIN = '00000000-0000-4000-8000-000000000001';
  const ROLE_CUSTOMER = '00000000-0000-4000-8000-000000000002';
  const USER_ADMIN = '00000000-0000-4000-8000-000000000101';
  const USER_CUSTOMER = '00000000-0000-4000-8000-000000000102';
  const USER_MISSING = '00000000-0000-4000-8000-000000000999';

  let app: INestApplication;
  let jwt: JwtService;
  let users: any[];
  let roles: any[];
  let refreshTokens: any[];
  let prisma: any;

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
    role: { id: role.id, name: role.name, description: role.description },
  });

  beforeEach(async () => {
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
        id: USER_CUSTOMER,
        name: 'Aye Aye',
        email: 'ayeaye@example.com',
        phone: '+959400100005',
        passwordHash: '$2b$12$secretcustomerhash',
        roleId: ROLE_CUSTOMER,
        isActive: true,
        status: UserStatus.ACTIVE,
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        updatedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
    ];

    refreshTokens = [
      { id: 'rt-1', userId: USER_CUSTOMER, revokedAt: null },
    ];

    prisma = {
      user: {
        findMany: vi.fn(async ({ skip = 0, take = 20 }: any) =>
          users
            .slice(skip, skip + take)
            .map((u) => toSafeUser(u, roles.find((r) => r.id === u.roleId)!)),
        ),
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
          return users.length;
        }),
        findUnique: vi.fn(async ({ where, select }: any) => {
          const u = users.find(
            (item) =>
              (where.id && item.id === where.id) ||
              (where.email && item.email === where.email),
          );
          if (!u) return null;
          const role = roles.find((r) => r.id === u.roleId)!;
          if (select?.role && !select?.role?.select?.permissions) {
            return toSafeUser(u, role);
          }
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
                ? { name: role.name, permissions: role.permissions }
                : null,
            };
          }
          return { ...u, role };
        }),
        create: vi.fn(async ({ data }: any) => {
          const created = {
            id: '00000000-0000-4000-8000-000000000199',
            ...data,
            createdAt: new Date('2026-10-10T00:00:00.000Z'),
            updatedAt: new Date('2026-10-10T00:00:00.000Z'),
          };
          users.push(created);
          return toSafeUser(created, roles.find((r) => r.id === created.roleId)!);
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const idx = users.findIndex((u) => u.id === where.id);
          if (idx === -1) throw { code: 'P2025' };
          users[idx] = { ...users[idx], ...data, updatedAt: new Date() };
          return toSafeUser(
            users[idx],
            roles.find((r) => r.id === users[idx].roleId)!,
          );
        }),
      },
      role: {
        findUnique: vi.fn(async ({ where }: any) =>
          roles.find((r) => r.id === where.id) ?? null,
        ),
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

    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'users-test-secret' })],
      controllers: [UsersController],
      providers: [
        UsersService,
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
      ],
    });
    jwt = app.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  const signToken = (sub: string, role = 'CUSTOMER') =>
    jwt.signAsync({ sub, email: `${sub}@example.com`, role });

  it('rejects unauthenticated requests and enforces RBAC permissions', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);

    const customerToken = await signToken(USER_CUSTOMER, 'ADMIN'); // forged JWT role claim
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('returns paginated users in global success envelope and validates query params', async () => {
    const adminToken = await signToken(USER_ADMIN, 'ADMIN');

    const res = await request(app.getHttpServer())
      .get('/api/users?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.pagination.total).toBe(2);

    await request(app.getHttpServer())
      .get('/api/users?page=0&limit=999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('returns user detail with nested user and permission string array, and 404 for nonexistent user', async () => {
    const adminToken = await signToken(USER_ADMIN, 'ADMIN');

    const res = await request(app.getHttpServer())
      .get(`/api/users/${USER_CUSTOMER}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('ayeaye@example.com');
    expect(res.body.data.user.role).toBe('CUSTOMER');
    expect(res.body.data.user.roleId).toBe(ROLE_CUSTOMER);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.user).not.toHaveProperty('refreshTokens');
    expect(res.body.data.permissions).toEqual(['product:read']);

    await request(app.getHttpServer())
      .get(`/api/users/${USER_MISSING}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('rejects mass assignment on POST /api/users and PATCH /api/users/:id', async () => {
    const adminToken = await signToken(USER_ADMIN, 'ADMIN');

    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test',
        email: 'test@example.com',
        password: 'Password123!',
        roleId: ROLE_CUSTOMER,
        permissions: ['role:manage'],
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/users/${USER_CUSTOMER}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Updated Name',
        roleId: ROLE_ADMIN,
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/users/${USER_CUSTOMER}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        password: 'NewPassword123!',
      })
      .expect(400);
  });

  it('suspends, reactivates, and soft-deactivates a user via HTTP', async () => {
    const adminToken = await signToken(USER_ADMIN, 'ADMIN');

    const suspended = await request(app.getHttpServer())
      .patch(`/api/users/${USER_CUSTOMER}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: UserStatus.SUSPENDED })
      .expect(200);
    expect(suspended.body.data.status).toBe(UserStatus.SUSPENDED);
    expect(suspended.body.data.isActive).toBe(false);
    expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);

    const reactivated = await request(app.getHttpServer())
      .patch(`/api/users/${USER_CUSTOMER}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: UserStatus.ACTIVE })
      .expect(200);
    expect(reactivated.body.data.status).toBe(UserStatus.ACTIVE);
    expect(reactivated.body.data.isActive).toBe(true);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/users/${USER_CUSTOMER}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(deleted.body.data.status).toBe(UserStatus.DEACTIVATED);
    expect(deleted.body.data.isActive).toBe(false);
  });

  it('allows authenticated users to read and update own profile while blocking role/status/id injection', async () => {
    const customerToken = await signToken(USER_CUSTOMER, 'CUSTOMER');

    const me = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(me.body.data.id).toBe(USER_CUSTOMER);

    const updated = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ name: 'Aye Self Updated' })
      .expect(200);
    expect(updated.body.data.name).toBe('Aye Self Updated');

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ roleId: ROLE_ADMIN })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: UserStatus.SUSPENDED })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ id: USER_ADMIN })
      .expect(400);
  });
});

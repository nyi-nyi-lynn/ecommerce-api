import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CategoriesController } from '../categories/categories.controller.js';
import { CategoriesService } from '../categories/categories.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from '../common/http/global-exception.filter.js';
import { ResponseInterceptor } from '../common/http/response.interceptor.js';

vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('hashed-password'),
  compare: vi.fn().mockResolvedValue(true),
}));

describe('Auth and Categories HTTP integration (isolated Prisma)', () => {
  let app: INestApplication;
  let prisma: any;
  let refreshRows: Map<string, any>;
  const customer = {
    id: 20,
    name: 'HTTP Customer',
    email: 'customer@example.test',
    phone: null,
    passwordHash: 'hashed-password',
    roleId: 2,
    role: { name: 'CUSTOMER' },
    isActive: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };
  const admin = {
    ...customer,
    id: 10,
    name: 'HTTP Admin',
    email: 'admin@example.test',
    roleId: 1,
    role: { name: 'ADMIN' },
  };

  beforeEach(async () => {
    refreshRows = new Map();
    const findUser = (where: { id?: number; email?: string }) => {
      if (where.id === admin.id || where.email === admin.email) return admin;
      if (where.id === customer.id || where.email === customer.email) return customer;
      return null;
    };
    const refreshToken = {
      create: vi.fn(async ({ data }) => {
        refreshRows.set(data.id, {
          createdAt: new Date(),
          revokedAt: null,
          replacedByTokenId: null,
          ...data,
        });
        return data;
      }),
      findUnique: vi.fn(async ({ where, include }) => {
        const row = refreshRows.get(where.id);
        if (!row) return null;
        const selectedUser = [admin, customer].find((candidate) => candidate.id === row.userId);
        return include?.user ? { ...row, user: selectedUser } : { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        for (const row of refreshRows.values()) {
          const matches =
            (where.id === undefined || row.id === where.id) &&
            (where.userId === undefined || row.userId === where.userId) &&
            (where.familyId === undefined || row.familyId === where.familyId) &&
            (where.revokedAt === undefined || row.revokedAt === where.revokedAt) &&
            (where.replacedByTokenId === undefined || row.replacedByTokenId === where.replacedByTokenId) &&
            (where.expiresAt?.gt === undefined || row.expiresAt > where.expiresAt.gt);
          if (matches) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      }),
    };
    const category = {
      findMany: vi.fn().mockResolvedValue([{ id: 1, name: 'Public', slug: 'public', isActive: true }]),
      findFirst: vi.fn().mockResolvedValue({ id: 1, name: 'Public', slug: 'public', isActive: true }),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }) => ({ id: 2, ...data })),
      update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      delete: vi.fn(async ({ where }) => ({ id: where.id })),
    };
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where, select }) => {
          const found = findUser(where);
          if (!found) return null;
          if (select?.role?.select?.permissions) {
            return {
              isActive: found.isActive,
              role: {
                permissions: (found.id === admin.id ? ['category:create', 'category:update', 'category:delete'] : [])
                  .map((code) => ({ permission: { code } })),
              },
            };
          }
          return found;
        }),
        create: vi.fn(async ({ data }) => ({
          id: 30,
          name: data.name,
          email: data.email,
          phone: data.phone ?? null,
          role: { name: 'CUSTOMER' },
          createdAt: new Date(),
        })),
      },
      role: { findUnique: vi.fn().mockResolvedValue({ id: 2, name: 'CUSTOMER' }) },
      refreshToken,
      category,
      $transaction: vi.fn(async (callback) => {
        const snapshot = new Map([...refreshRows].map(([key, value]) => [key, { ...value }]));
        try {
          return await callback(prisma);
        } catch (error) {
          refreshRows = snapshot;
          throw error;
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'isolated-test-secret', signOptions: { expiresIn: '15m' } })],
      controllers: [AuthController, CategoriesController],
      providers: [
        AuthService,
        CategoriesService,
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { getOrThrow: (key: string) => key === 'JWT_REFRESH_TOKEN_TTL_SECONDS' ? 604800 : 'isolated-test-secret' } },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => app.close());

  async function login(email = customer.email) {
    return request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'password123' });
  }

  it('keeps registration fields available under the response envelope', async () => {
    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'New Customer', email: 'new-customer@example.test', password: 'password123' })
      .expect(201);
    expect(registration.body.data).toMatchObject({
      user: { name: 'New Customer', role: 'CUSTOMER' },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it('logs in, rotates over HTTP, rejects the old token, and logs out with 204', async () => {
    const loggedIn = await login();
    expect(loggedIn.status).toBe(201);
    expect(loggedIn.body.data).toMatchObject({ user: { email: customer.email }, accessToken: expect.any(String), refreshToken: expect.any(String) });

    const refreshed = await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: loggedIn.body.data.refreshToken });
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(201);
    expect(refreshed.body.data.refreshToken).not.toBe(loggedIn.body.data.refreshToken);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: loggedIn.body.data.refreshToken }).expect(401);
    const logout = await request(app.getHttpServer()).post('/api/auth/logout').send({ refreshToken: refreshed.body.data.refreshToken }).expect(204);
    expect(logout.text).toBe('');
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: refreshed.body.data.refreshToken }).expect(401);
  });

  it('logs out one session family without revoking another device', async () => {
    const first = await login();
    const second = await login();
    await request(app.getHttpServer()).post('/api/auth/logout').send({ refreshToken: first.body.data.refreshToken }).expect(204);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: second.body.data.refreshToken }).expect(201);
  });

  it('rejects malformed refresh tokens and preserves bearer /me authentication', async () => {
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: 'malformed' }).expect(401);
    const loggedIn = await login();
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${loggedIn.body.data.accessToken}`).expect(200).expect(({ body }) => {
      expect(body.data.email).toBe(customer.email);
    });
  });

  it('keeps category reads public and protects writes with database permissions', async () => {
    await request(app.getHttpServer()).get('/api/categories').expect(200);
    await request(app.getHttpServer()).post('/api/categories').send({ name: 'HTTP Category', slug: 'http-category' }).expect(401);

    const customerLogin = await login();
    await request(app.getHttpServer()).post('/api/categories').set('Authorization', `Bearer ${customerLogin.body.data.accessToken}`).send({ name: 'HTTP Category', slug: 'http-category' }).expect(403);

    const adminLogin = await login(admin.email);
    await request(app.getHttpServer()).post('/api/categories').set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`).send({ name: 'HTTP Category', slug: 'http-category' }).expect(201);
    expect(prisma.category.create).toHaveBeenCalledTimes(1);
  });
});

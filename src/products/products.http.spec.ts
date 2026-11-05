import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

describe('Products HTTP', () => {
  let app: INestApplication;
  let prisma: any;
  let jwt: JwtService;
  let rows: any[];
  const product = {
    id: 1,
    categoryId: 1,
    name: 'Tea',
    slug: 'tea',
    sku: 'TEA-1',
    description: null,
    price: '5.25',
    imageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    rows = [product];
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: {
            permissions: (where.id === 2
              ? ['product:create', 'product:update']
              : []
            ).map((code) => ({ permission: { code } })),
          },
        })),
      },
      category: { findUnique: vi.fn().mockResolvedValue({ id: 1 }) },
      product: {
        findFirst: vi.fn(
          async ({ where }) =>
            rows.find(
              (row) =>
                (where.id === undefined ||
                  row.id === where.id ||
                  (where.id.not !== undefined && row.id !== where.id.not)) &&
                (where.OR === undefined ||
                  where.OR.some(
                    (condition: any) =>
                      (condition.sku === undefined ||
                        row.sku === condition.sku) &&
                      (condition.slug === undefined ||
                        row.slug === condition.slug),
                  )) &&
                (where.sku === undefined || row.sku === where.sku) &&
                (where.slug === undefined || row.slug === where.slug) &&
                (where.isActive === undefined ||
                  row.isActive === where.isActive),
            ) ?? null,
        ),
        findUnique: vi.fn(
          async ({ where }) => rows.find((row) => row.id === where.id) ?? null,
        ),
        create: vi.fn(async ({ data }) => {
          const row = {
            id: 2,
            ...data,
            price: String(data.price),
            isActive: true,
          };
          rows.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }) => {
          const row = { ...rows.find((item) => item.id === where.id), ...data };
          rows = rows.map((item) => (item.id === where.id ? row : item));
          return row;
        }),
        findMany: vi.fn(async ({ where, skip, take }) =>
          rows
            .filter(
              (row) =>
                row.isActive &&
                where.id !== -1 &&
                (!where.categoryId || row.categoryId === where.categoryId),
            )
            .slice(skip, skip + take),
        ),
        count: vi.fn(
          async ({ where }) =>
            rows.filter((row) => row.isActive && where.id !== -1).length,
        ),
      },
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'products-test-secret' })],
      controllers: [ProductsController],
      providers: [
        ProductsService,
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
      ],
    });
    jwt = app.get(JwtService);
  });
  afterEach(async () => app.close());

  const token = (id: number) =>
    jwt.sign({ sub: id, role: id === 1 ? 'CUSTOMER' : 'ADMIN' });
  const valid = {
    name: 'Coffee',
    slug: 'coffee',
    sku: 'COF-1',
    price: 4.25,
    categoryId: 1,
  };

  it('validates creation data and returns the standard success envelope', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .send(valid)
      .expect(401);
    const bad = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(2)}`)
      .send({ ...valid, price: 0 })
      .expect(400);
    expect(bad.body.success).toBe(false);
    const created = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(2)}`)
      .send(valid)
      .expect(201);
    expect(created.body).toMatchObject({
      success: true,
      data: { name: 'Coffee', sku: 'COF-1' },
    });
    expect(created.body.data.data).toBeUndefined();
  });

  it('uses database permissions rather than JWT role claims for writes', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(1)}`)
      .send(valid)
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/products/1')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({ name: 'Changed' })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/products/1')
      .set('Authorization', `Bearer ${token(2)}`)
      .send({ name: 'Changed' })
      .expect(200);
  });

  it('keeps inactive products private, even when public query asks for isActive=false', async () => {
    rows = [product, { ...product, id: 9, slug: 'inactive', isActive: false }];
    const list = await request(app.getHttpServer())
      .get('/api/products?isActive=false')
      .expect(200);
    expect(list.body.data.items.map((item: any) => item.id)).toEqual([1]);
    expect(list.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
    });
    await request(app.getHttpServer()).get('/api/products/9').expect(404);
    await request(app.getHttpServer())
      .get('/api/products/slug/inactive')
      .expect(404);
  });

  it('supports product lookup by slug without route collision', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/products/slug/tea')
      .expect(200);
    expect(result.body.data.slug).toBe('tea');
  });

  it('accepts bounded pages and rejects excessive pages before querying Prisma', async () => {
    const findMany = prisma.product.findMany as ReturnType<typeof vi.fn>;
    const count = prisma.product.count as ReturnType<typeof vi.fn>;

    for (const [query, expectedSkip] of [
      ['page=1&limit=100', 0],
      ['page=25&limit=40', 960],
      ['page=10000&limit=100', 999_900],
    ]) {
      findMany.mockClear();
      count.mockClear();
      await request(app.getHttpServer())
        .get(`/api/products?${query}`)
        .expect(200);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: expectedSkip }),
      );
      expect(count).toHaveBeenCalledOnce();
    }

    for (const page of ['10001', '999999999999999999999999999999']) {
      findMany.mockClear();
      count.mockClear();
      const response = await request(app.getHttpServer())
        .get(`/api/products?page=${page}`)
        .expect(400);
      expect(response.body).toMatchObject({ success: false, statusCode: 400 });
      expect(findMany).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
    }
  });
});

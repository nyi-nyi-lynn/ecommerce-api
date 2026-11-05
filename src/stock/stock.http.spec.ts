import { INestApplication, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

describe('Stock HTTP', () => {
  const USER_CUSTOMER = '00000000-0000-4000-8000-000000000001';
  const USER_ADMIN = '00000000-0000-4000-8000-000000000002';
  const PRODUCT_5 = '00000000-0000-4000-8000-000000000005';

  let app: INestApplication;
  let jwt: JwtService;
  let prisma: any;
  let stock: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: {
            permissions: (where.id === USER_ADMIN
              ? ['stock:update', 'stock:read']
              : []
            ).map((code) => ({ permission: { code } })),
          },
        })),
      },
    };
    stock = {
      initialize: vi.fn(async (productId, dto, actorId) => ({
        productId,
        quantity: dto.quantity,
        actorId,
      })),
      adjust: vi.fn(async (productId, dto, actorId) => ({
        productId,
        ...dto,
        actorId,
      })),
      getStock: vi.fn(async (productId) => ({
        productId,
        quantity: 3,
        availableQuantity: 3,
      })),
      getMovements: vi.fn(async (productId, query) => ({
        items: [{ productId }],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: 1,
          totalPages: 1,
        },
      })),
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'isolated-stock-test-secret' })],
      controllers: [StockController],
      providers: [
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: StockService, useValue: stock },
      ],
    });
    jwt = app.get(JwtService);
  });

  afterEach(async () => app.close());

  const token = (id: string) =>
    jwt.sign({ sub: id, role: id === USER_ADMIN ? 'CUSTOMER' : 'ADMIN' });

  it('requires database permissions for initialization and adjustments', async () => {
    await request(app.getHttpServer())
      .post(`/api/stock/products/${PRODUCT_5}/initialize`)
      .send({ quantity: 10 })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/stock/products/${PRODUCT_5}/initialize`)
      .set('Authorization', `Bearer ${token(USER_CUSTOMER)}`)
      .send({ quantity: 10 })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/stock/products/${PRODUCT_5}/adjustments`)
      .set('Authorization', `Bearer ${token(USER_CUSTOMER)}`)
      .send({ quantityChange: 1, reason: 'RESTOCK' })
      .expect(403);

    const initialized = await request(app.getHttpServer())
      .post(`/api/stock/products/${PRODUCT_5}/initialize`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ quantity: 10 })
      .expect(201);
    expect(initialized.body).toMatchObject({
      success: true,
      data: { productId: PRODUCT_5, quantity: 10, actorId: USER_ADMIN },
    });
    expect(initialized.body.data.data).toBeUndefined();
    await request(app.getHttpServer())
      .post(`/api/stock/products/${PRODUCT_5}/adjustments`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ quantityChange: -2, reason: 'SALE' })
      .expect(201);
    expect(stock.adjust).toHaveBeenCalledWith(
      PRODUCT_5,
      { quantityChange: -2, reason: 'SALE' },
      USER_ADMIN,
    );
  });

  it('rejects invalid quantities and movement pagination before service calls', async () => {
    const tokenHeader = { Authorization: `Bearer ${token(USER_ADMIN)}` };
    for (const body of [
      { quantity: -1 },
      { quantity: 1.5 },
      { quantity: null },
      { quantity: '' },
      { quantity: 2_147_483_648 },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/stock/products/${PRODUCT_5}/initialize`)
        .set(tokenHeader)
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post(`/api/stock/products/${PRODUCT_5}/initialize`)
      .set(tokenHeader)
      .send({ quantity: 2_147_483_647 })
      .expect(201);
    stock.initialize.mockClear();
    for (const body of [
      { quantityChange: 0, reason: 'ADJUSTMENT' },
      { quantityChange: -1.5, reason: 'SALE' },
      { quantityChange: -1, reason: 'UNKNOWN' },
      { quantityChange: -3, reason: 'DAMAGE', note: 'Three damaged units' },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/stock/products/${PRODUCT_5}/adjustments`)
        .set(tokenHeader)
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .get(`/api/stock/products/${PRODUCT_5}/movements?page=10001`)
      .set(tokenHeader)
      .expect(400);
    expect(stock.initialize).not.toHaveBeenCalled();
    expect(stock.adjust).not.toHaveBeenCalled();
    expect(stock.getMovements).not.toHaveBeenCalled();
  });

  it('allows stock reads publicly and protects movement history with stock:read', async () => {
    const available = await request(app.getHttpServer())
      .get(`/api/stock/products/${PRODUCT_5}`)
      .expect(200);
    expect(available.body).toMatchObject({
      success: true,
      data: { quantity: 3, availableQuantity: 3 },
    });
    await request(app.getHttpServer())
      .get(`/api/stock/products/${PRODUCT_5}/movements`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/stock/products/${PRODUCT_5}/movements`)
      .set('Authorization', `Bearer ${token(USER_CUSTOMER)}`)
      .expect(403);
    const movements = await request(app.getHttpServer())
      .get(`/api/stock/products/${PRODUCT_5}/movements?page=1&limit=10`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .expect(200);
    expect(movements.body.data.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
    });
  });

  it('returns the standard not-found response when public stock lookup finds no active product', async () => {
    stock.getStock.mockRejectedValueOnce(
      new NotFoundException('Product not found.'),
    );
    const response = await request(app.getHttpServer())
      .get(`/api/stock/products/${PRODUCT_5}`)
      .expect(404);
    expect(response.body).toMatchObject({
      success: false,
      statusCode: 404,
      message: 'Product not found.',
    });
    expect(stock.getStock).toHaveBeenCalledWith(PRODUCT_5);
  });
});

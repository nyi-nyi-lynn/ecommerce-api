import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import {
  AdminOrdersController,
  OrdersController,
} from './orders.controller.js';
import { OrdersService } from './orders.service.js';

describe('Orders HTTP', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let prisma: any;
  let orders: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: {
            permissions: (where.id === 2
              ? ['order:read', 'order:update']
              : []
            ).map((code) => ({ permission: { code } })),
          },
        })),
      },
    };
    orders = {
      create: vi.fn(async (userId, dto) => ({
        id: 1,
        userId,
        items: dto.items,
        totalAmount: '7.50',
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
      })),
      checkout: vi.fn(async (userId, dto) => ({
        id: 2,
        userId,
        items: [{ productId: 5, quantity: 2 }],
        totalAmount: '7.50',
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        shippingName: dto.shippingName,
      })),
      listMine: vi.fn(async (userId, query) => ({
        items: [{ id: 1, userId }],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: 1,
          totalPages: 1,
        },
      })),
      findMine: vi.fn(async (userId, id) => ({ id, userId })),
      cancelMine: vi.fn(async (userId, id) => ({
        id,
        userId,
        status: 'CANCELLED',
      })),
      listAll: vi.fn(async (query) => ({
        items: [],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: 0,
          totalPages: 0,
        },
      })),
      findById: vi.fn(async (id) => ({ id })),
      updateStatus: vi.fn(async (id, dto, actorId) => ({
        id,
        status: dto.status,
        actorId,
      })),
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'isolated-orders-test-secret' })],
      controllers: [OrdersController, AdminOrdersController],
      providers: [
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: orders },
      ],
    });
    jwt = app.get(JwtService);
  });

  afterEach(async () => app.close());
  const token = (id: number, role: string) => jwt.sign({ sub: id, role });
  const as = (id: number, role = 'CUSTOMER') => ({
    Authorization: `Bearer ${token(id, role)}`,
  });
  const body = {
    items: [{ productId: 5, quantity: 2 }],
    shippingName: 'Ada',
    shippingPhone: '555',
    shippingAddress: '1 Main St',
  };
  const checkoutBody = {
    shippingName: 'Ada',
    shippingPhone: '555',
    shippingAddress: '1 Main St',
  };

  it('requires authentication and derives order owner from verified JWT subject', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .send(body)
      .expect(401);
    const response = await request(app.getHttpServer())
      .post('/api/orders')
      .set(as(11))
      .send(body)
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { userId: 11, paymentStatus: 'PENDING' },
    });
    expect(response.body.data.data).toBeUndefined();
    expect(orders.create).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ items: [{ productId: 5, quantity: 2 }] }),
    );
  });

  it('checks out the authenticated owner’s Cart and preserves the success envelope', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .send(checkoutBody)
      .expect(401);
    const response = await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .set(as(11))
      .send(checkoutBody)
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        userId: 11,
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
      },
    });
    expect(response.body.data.data).toBeUndefined();
    expect(orders.checkout).toHaveBeenCalledWith(
      11,
      expect.objectContaining(checkoutBody),
    );
  });

  it('rejects missing shipping fields and client-supplied Cart or order data', async () => {
    for (const invalid of [
      { shippingName: 'Ada', shippingPhone: '555' },
      { ...checkoutBody, userId: 99 },
      { ...checkoutBody, cartId: 7 },
      { ...checkoutBody, items: [{ productId: 5, quantity: 1 }] },
      { ...checkoutBody, totalAmount: 1 },
      { ...checkoutBody, shippingName: ' '.repeat(101) },
      { ...checkoutBody, shippingPhone: 'x'.repeat(31) },
      { ...checkoutBody, shippingAddress: 'x'.repeat(5001) },
      { ...checkoutBody, note: 'x'.repeat(501) },
    ]) {
      await request(app.getHttpServer())
        .post('/api/orders/checkout')
        .set(as(11))
        .send(invalid)
        .expect(400);
    }
    expect(orders.checkout).not.toHaveBeenCalled();
  });

  it('accepts COD and MANUAL, defaults omitted checkout method to COD, and rejects GATEWAY', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set(as(11))
      .send({ ...body, paymentMethod: 'MANUAL' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .set(as(11))
      .send({ ...checkoutBody, paymentMethod: 'COD' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/orders')
      .set(as(11))
      .send({ ...body, paymentMethod: 'GATEWAY' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .set(as(11))
      .send({ ...checkoutBody, paymentMethod: 'GATEWAY' })
      .expect(400);
    expect(orders.create).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ paymentMethod: 'MANUAL' }),
    );
    expect(orders.checkout).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ paymentMethod: 'COD' }),
    );
  });

  it('rejects unknown and client-managed fields plus invalid order lines before service calls', async () => {
    const header = as(11);
    for (const invalid of [
      { ...body, userId: 99 },
      { ...body, totalAmount: 1 },
      { ...body, items: [{ productId: 5, quantity: 1, unitPrice: 0 }] },
      {
        ...body,
        items: [
          { productId: 5, quantity: 1 },
          { productId: 5, quantity: 2 },
        ],
      },
      { ...body, items: [{ productId: 5, quantity: 0 }] },
      { ...body, items: [] },
    ])
      await request(app.getHttpServer())
        .post('/api/orders')
        .set(header)
        .send(invalid)
        .expect(400);
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('rejects product IDs outside PostgreSQL INT bounds and accepts the maximum valid ID', async () => {
    const header = as(11);
    for (const productId of [0, -1, 2_147_483_648, 1.5]) {
      await request(app.getHttpServer())
        .post('/api/orders')
        .set(header)
        .send({ ...body, items: [{ productId, quantity: 1 }] })
        .expect(400);
    }
    expect(orders.create).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/orders')
      .set(header)
      .send({ ...body, items: [{ productId: 2_147_483_647, quantity: 1 }] })
      .expect(201);
    expect(orders.create).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        items: [{ productId: 2_147_483_647, quantity: 1 }],
      }),
    );
  });

  it('uses owner-scoped paginated routes and the standard success envelope', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/orders?page=2&limit=5')
      .set(as(11))
      .expect(200);
    expect(listed.body).toMatchObject({
      success: true,
      data: { pagination: { page: 2, limit: 5 } },
    });
    expect(orders.listMine).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ page: 2, limit: 5 }),
    );
    const detail = await request(app.getHttpServer())
      .get('/api/orders/4')
      .set(as(11))
      .expect(200);
    expect(detail.body.data).toEqual({ id: 4, userId: 11 });
    await request(app.getHttpServer())
      .post('/api/orders/4/cancel')
      .set(as(11))
      .expect(201);
  });

  it('enforces admin order permissions from database rather than JWT role claims', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set(as(1, 'ADMIN'))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set(as(2, 'CUSTOMER'))
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/admin/orders/1/status')
      .set(as(2, 'CUSTOMER'))
      .send({ status: 'CONFIRMED' })
      .expect(200);
    expect(orders.updateStatus).toHaveBeenCalledWith(
      1,
      { status: 'CONFIRMED' },
      2,
    );
    await request(app.getHttpServer())
      .patch('/api/admin/orders/1/status')
      .set(as(2, 'CUSTOMER'))
      .send({ status: 'UNKNOWN' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set(as(2, 'CUSTOMER'))
      .expect(200);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 } }),
    );
  });
});

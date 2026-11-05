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
  const USER_1 = '00000000-0000-4000-8000-000000000001';
  const USER_2 = '00000000-0000-4000-8000-000000000002';
  const USER_11 = '00000000-0000-4000-8000-000000000011';
  const USER_99 = '00000000-0000-4000-8000-000000000099';
  const PRODUCT_5 = '00000000-0000-4000-8000-000000000005';
  const ORDER_1 = '00000000-0000-4000-8000-000000000001';
  const ORDER_2 = '00000000-0000-4000-8000-000000000002';
  const ORDER_4 = '00000000-0000-4000-8000-000000000004';
  const CART_7 = '00000000-0000-4000-8000-000000000007';

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
            permissions: (where.id === USER_2
              ? ['order:read', 'order:update']
              : []
            ).map((code) => ({ permission: { code } })),
          },
        })),
      },
    };
    orders = {
      create: vi.fn(async (userId, dto) => ({
        id: ORDER_1,
        userId,
        items: dto.items,
        totalAmount: '7.50',
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
      })),
      checkout: vi.fn(async (userId, dto) => ({
        id: ORDER_2,
        userId,
        items: [{ productId: PRODUCT_5, quantity: 2 }],
        totalAmount: '7.50',
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        shippingName: dto.shippingName,
      })),
      listMine: vi.fn(async (userId, query) => ({
        items: [{ id: ORDER_1, userId }],
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
  const token = (id: string, role: string) => jwt.sign({ sub: id, role });
  const as = (id: string, role = 'CUSTOMER') => ({
    Authorization: `Bearer ${token(id, role)}`,
  });
  const body = {
    items: [{ productId: PRODUCT_5, quantity: 2 }],
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
      .set(as(USER_11))
      .send(body)
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { userId: USER_11, paymentStatus: 'PENDING' },
    });
    expect(response.body.data.data).toBeUndefined();
    expect(orders.create).toHaveBeenCalledWith(
      USER_11,
      expect.objectContaining({
        items: [{ productId: PRODUCT_5, quantity: 2 }],
      }),
    );
  });

  it('checks out the authenticated owner’s Cart and preserves the success envelope', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .send(checkoutBody)
      .expect(401);
    const response = await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .set(as(USER_11))
      .send(checkoutBody)
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        userId: USER_11,
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
      },
    });
    expect(response.body.data.data).toBeUndefined();
    expect(orders.checkout).toHaveBeenCalledWith(
      USER_11,
      expect.objectContaining(checkoutBody),
    );
  });

  it('rejects missing shipping fields and client-supplied Cart or order data', async () => {
    for (const invalid of [
      { shippingName: 'Ada', shippingPhone: '555' },
      { ...checkoutBody, userId: USER_99 },
      { ...checkoutBody, cartId: CART_7 },
      { ...checkoutBody, items: [{ productId: PRODUCT_5, quantity: 1 }] },
      { ...checkoutBody, totalAmount: 1 },
      { ...checkoutBody, shippingName: ' '.repeat(101) },
      { ...checkoutBody, shippingPhone: 'x'.repeat(31) },
      { ...checkoutBody, shippingAddress: 'x'.repeat(5001) },
      { ...checkoutBody, note: 'x'.repeat(501) },
    ]) {
      await request(app.getHttpServer())
        .post('/api/orders/checkout')
        .set(as(USER_11))
        .send(invalid)
        .expect(400);
    }
    expect(orders.checkout).not.toHaveBeenCalled();
  });

  it('accepts COD and MANUAL, defaults omitted checkout method to COD, and rejects GATEWAY', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set(as(USER_11))
      .send({ ...body, paymentMethod: 'MANUAL' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .set(as(USER_11))
      .send({ ...checkoutBody, paymentMethod: 'COD' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/orders')
      .set(as(USER_11))
      .send({ ...body, paymentMethod: 'GATEWAY' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/orders/checkout')
      .set(as(USER_11))
      .send({ ...checkoutBody, paymentMethod: 'GATEWAY' })
      .expect(400);
    expect(orders.create).toHaveBeenCalledWith(
      USER_11,
      expect.objectContaining({ paymentMethod: 'MANUAL' }),
    );
    expect(orders.checkout).toHaveBeenCalledWith(
      USER_11,
      expect.objectContaining({ paymentMethod: 'COD' }),
    );
  });

  it('rejects unknown and client-managed fields plus invalid order lines before service calls', async () => {
    const header = as(USER_11);
    for (const invalid of [
      { ...body, userId: USER_99 },
      { ...body, totalAmount: 1 },
      { ...body, items: [{ productId: PRODUCT_5, quantity: 1, unitPrice: 0 }] },
      {
        ...body,
        items: [
          { productId: PRODUCT_5, quantity: 1 },
          { productId: PRODUCT_5, quantity: 2 },
        ],
      },
      { ...body, items: [{ productId: PRODUCT_5, quantity: 0 }] },
      { ...body, items: [] },
    ])
      await request(app.getHttpServer())
        .post('/api/orders')
        .set(header)
        .send(invalid)
        .expect(400);
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('rejects invalid product UUIDs and accepts valid product UUIDs', async () => {
    const header = as(USER_11);
    for (const productId of [0, -1, 2_147_483_648, 1.5, 'not-a-uuid', '']) {
      await request(app.getHttpServer())
        .post('/api/orders')
        .set(header)
        .send({ ...body, items: [{ productId, quantity: 1 }] })
        .expect(400);
    }
    expect(orders.create).not.toHaveBeenCalled();

    const maxUuid = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    await request(app.getHttpServer())
      .post('/api/orders')
      .set(header)
      .send({ ...body, items: [{ productId: maxUuid, quantity: 1 }] })
      .expect(201);
    expect(orders.create).toHaveBeenCalledWith(
      USER_11,
      expect.objectContaining({
        items: [{ productId: maxUuid, quantity: 1 }],
      }),
    );
  });

  it('uses owner-scoped paginated routes and the standard success envelope', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/orders?page=2&limit=5')
      .set(as(USER_11))
      .expect(200);
    expect(listed.body).toMatchObject({
      success: true,
      data: { pagination: { page: 2, limit: 5 } },
    });
    expect(orders.listMine).toHaveBeenCalledWith(
      USER_11,
      expect.objectContaining({ page: 2, limit: 5 }),
    );
    const detail = await request(app.getHttpServer())
      .get(`/api/orders/${ORDER_4}`)
      .set(as(USER_11))
      .expect(200);
    expect(detail.body.data).toEqual({ id: ORDER_4, userId: USER_11 });
    await request(app.getHttpServer())
      .post(`/api/orders/${ORDER_4}/cancel`)
      .set(as(USER_11))
      .expect(201);
  });

  it('enforces admin order permissions from database rather than JWT role claims', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set(as(USER_1, 'ADMIN'))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set(as(USER_2, 'CUSTOMER'))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/orders/${ORDER_1}/status`)
      .set(as(USER_2, 'CUSTOMER'))
      .send({ status: 'CONFIRMED' })
      .expect(200);
    expect(orders.updateStatus).toHaveBeenCalledWith(
      ORDER_1,
      { status: 'CONFIRMED' },
      USER_2,
    );
    await request(app.getHttpServer())
      .patch(`/api/admin/orders/${ORDER_1}/status`)
      .set(as(USER_2, 'CUSTOMER'))
      .send({ status: 'UNKNOWN' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set(as(USER_2, 'CUSTOMER'))
      .expect(200);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_2 } }),
    );
  });
});

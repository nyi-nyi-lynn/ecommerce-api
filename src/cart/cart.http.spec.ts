import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

describe('Cart HTTP', () => {
  const USER_11 = '00000000-0000-4000-8000-000000000011';
  const USER_12 = '00000000-0000-4000-8000-000000000012';
  const PRODUCT_7 = '00000000-0000-4000-8000-000000000007';
  const ITEM_1 = '00000000-0000-4000-8000-000000000001';

  let app: INestApplication;
  let jwt: JwtService;
  let prisma: any;

  beforeEach(async () => {
    const itemRows: any[] = [];
    const tx = {
      product: {
        findUnique: vi.fn(async ({ where }) =>
          where.id === PRODUCT_7 ? { id: PRODUCT_7, isActive: true } : null,
        ),
      },
      cart: { upsert: vi.fn(async ({ where }) => ({ id: where.userId })) },
      $queryRaw: vi.fn(async () => [{ id: ITEM_1 }]),
    };
    prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      cart: {
        findUnique: vi.fn(async ({ where }) =>
          where.userId === USER_11
            ? {
                items: itemRows.map((row) => ({
                  ...row,
                  product: {
                    id: PRODUCT_7,
                    name: 'Tea',
                    slug: 'tea',
                    imageUrl: null,
                    isActive: true,
                    price: '1.25',
                  },
                })),
              }
            : null,
        ),
      },
      cartItem: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'isolated-cart-test-secret' })],
      controllers: [CartController],
      providers: [
        JwtAuthGuard,
        CartService,
        { provide: PrismaService, useValue: prisma },
      ],
    });
    jwt = app.get(JwtService);
  });
  afterEach(async () => app.close());
  const auth = (id = USER_11) => ({
    Authorization: `Bearer ${jwt.sign({ sub: id })}`,
  });

  it('requires authentication and wraps the empty-cart response once', async () => {
    await request(app.getHttpServer()).get('/api/cart').expect(401);
    const response = await request(app.getHttpServer())
      .get('/api/cart')
      .set(auth())
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { items: [], subtotal: '0' },
    });
    expect(response.body.data.data).toBeUndefined();
    expect(prisma.cart.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_11 } }),
    );
  });

  it('rejects unknown fields, invalid inputs, and integer overflow before DB work', async () => {
    for (const body of [
      { productId: PRODUCT_7, quantity: 1, userId: USER_12 },
      { productId: 0, quantity: 1 },
      { productId: -1, quantity: 1 },
      { productId: 'not-a-uuid', quantity: 1 },
      { productId: 1.5, quantity: 1 },
      { productId: PRODUCT_7, quantity: 0 },
      { productId: PRODUCT_7, quantity: 2_147_483_648 },
    ]) {
      const response = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set(auth())
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({ success: false, statusCode: 400 });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses JWT subject for cart creation and rejects invalid path IDs', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/cart/items')
      .set(auth(USER_11))
      .send({ productId: PRODUCT_7, quantity: 2 })
      .expect(201);
    expect(response.body.success).toBe(true);
    expect(prisma.cart.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_11 } }),
    );
    await request(app.getHttpServer())
      .patch('/api/cart/items/2147483648')
      .set(auth())
      .send({ quantity: 1 })
      .expect(400);
    await request(app.getHttpServer())
      .delete('/api/cart/items/nope')
      .set(auth())
      .expect(400);
  });
});

import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import {
  AdminPaymentsController,
  PaymentsController,
} from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

describe('Payments HTTP', () => {
  const USER_1 = '00000000-0000-4000-8000-000000000001';
  const USER_2 = '00000000-0000-4000-8000-000000000002';
  const USER_11 = '00000000-0000-4000-8000-000000000011';
  const ORDER_10 = '00000000-0000-4000-8000-000000000010';
  const ATTEMPT_4 = '00000000-0000-4000-8000-000000000004';
  const ATTEMPT_7 = '00000000-0000-4000-8000-000000000007';

  const validPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XWJ2AAAAAElFTkSuQmCC',
    'base64',
  );

  let app: INestApplication;
  let jwt: JwtService;
  let prisma: any;
  let payments: any;
  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: {
            permissions: (where.id === USER_2
              ? ['payment:read', 'payment:update', 'payment:collect']
              : []
            ).map((code) => ({ permission: { code } })),
          },
        })),
      },
    };
    payments = {
      getCustomerOrderPayments: vi.fn(async (userId, orderId) => ({
        id: orderId,
        userId,
        paymentStatus: 'PENDING',
        paymentAttempts: [],
      })),
      submitManualPayment: vi.fn(async (userId, orderId, dto, image) => ({
        id: ATTEMPT_4,
        orderId,
        userId,
        providerCode: dto.providerCode,
        transactionReference: dto.transactionReference,
        proofUrl: `https://res.cloudinary.com/demo/image/upload/ecommerce/payments/users/${userId}/proof.png`,
        imagePublicId: `ecommerce/payments/users/${userId}/proof`,
        uploadedOriginalName: image?.originalname,
        status: 'UNDER_REVIEW',
      })),
      listAttempts: vi.fn(async (query) => ({
        items: [],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: 0,
          totalPages: 0,
        },
      })),
      getAttempt: vi.fn(async (id) => ({ id, status: 'UNDER_REVIEW' })),
      approveManualPayment: vi.fn(async (id, actorId) => ({
        id,
        actorId,
        status: 'PAID',
      })),
      rejectManualPayment: vi.fn(async (id, actorId, dto) => ({
        id,
        actorId,
        status: 'REJECTED',
        reason: dto.reason,
      })),
      collectCod: vi.fn(async (id, actorId) => ({
        id,
        actorId,
        status: 'PAID',
      })),
    };
    app = await createTestHttpApp({
      imports: [
        JwtModule.register({ secret: 'isolated-payments-test-secret' }),
      ],
      controllers: [PaymentsController, AdminPaymentsController],
      providers: [
        JwtAuthGuard,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentsService, useValue: payments },
      ],
    });
    jwt = app.get(JwtService);
  });
  afterEach(async () => app.close());
  const as = (id: string, role = 'CUSTOMER') => ({
    Authorization: `Bearer ${jwt.sign({ sub: id, role })}`,
  });

  it('requires JWT and derives customer ownership only from the JWT subject', async () => {
    await request(app.getHttpServer())
      .get(`/api/payments/orders/${ORDER_10}`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/payments/orders/${ORDER_10}/manual`)
      .field('providerCode', 'KBZ_PAY')
      .field('transactionReference', 'TX-1')
      .attach('image', validPngBuffer, 'proof.png')
      .expect(401);

    const response = await request(app.getHttpServer())
      .get(`/api/payments/orders/${ORDER_10}`)
      .set(as(USER_11))
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: ORDER_10, userId: USER_11 },
    });
    expect(payments.getCustomerOrderPayments).toHaveBeenCalledWith(
      USER_11,
      ORDER_10,
    );
    await request(app.getHttpServer())
      .post(`/api/payments/orders/${ORDER_10}/manual`)
      .set(as(USER_11))
      .field('providerCode', 'KBZ_PAY')
      .field('transactionReference', 'TX-1')
      .field('userId', USER_1)
      .field('amount', '1')
      .attach('image', validPngBuffer, 'proof.png')
      .expect(400);
  });

  it('validates multipart manual payment fields, image upload constraints, and returns the shared success envelope', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/payments/orders/${ORDER_10}/manual`)
      .set(as(USER_11))
      .field('providerCode', 'KBZ_PAY')
      .field('transactionReference', '  TX-1  ')
      .attach('image', validPngBuffer, {
        filename: 'proof.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: 'UNDER_REVIEW',
        providerCode: 'KBZ_PAY',
        transactionReference: 'TX-1',
        proofUrl: `https://res.cloudinary.com/demo/image/upload/ecommerce/payments/users/${USER_11}/proof.png`,
        imagePublicId: `ecommerce/payments/users/${USER_11}/proof`,
      },
    });
    expect(payments.submitManualPayment).toHaveBeenCalledWith(
      USER_11,
      ORDER_10,
      { providerCode: 'KBZ_PAY', transactionReference: 'TX-1' },
      expect.objectContaining({
        fieldname: 'image',
        originalname: 'proof.png',
      }),
    );

    // Missing image
    await request(app.getHttpServer())
      .post(`/api/payments/orders/${ORDER_10}/manual`)
      .set(as(USER_11))
      .field('providerCode', 'KBZ_PAY')
      .field('transactionReference', 'TX-1')
      .expect(400);

    // Unexpected file field name
    const wrongField = await request(app.getHttpServer())
      .post(`/api/payments/orders/${ORDER_10}/manual`)
      .set(as(USER_11))
      .field('providerCode', 'KBZ_PAY')
      .field('transactionReference', 'TX-1')
      .attach('proof', validPngBuffer, 'proof.png')
      .expect(400);
    expect(wrongField.body).toMatchObject({
      success: false,
      statusCode: 400,
    });

    // Oversized file (> 5 MB)
    const oversized = await request(app.getHttpServer())
      .post(`/api/payments/orders/${ORDER_10}/manual`)
      .set(as(USER_11))
      .field('providerCode', 'KBZ_PAY')
      .field('transactionReference', 'TX-1')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'oversized.png')
      .expect(413);
    expect(oversized.body).toMatchObject({
      success: false,
      statusCode: 413,
    });

    // Rejects invalid DTO fields or external proofUrl
    for (const fields of [
      { providerCode: 'UNKNOWN', transactionReference: 'X' },
      { providerCode: 'KBZ_PAY', transactionReference: '' },
      { providerCode: 'KBZ_PAY', transactionReference: 'X', amount: '1' },
      {
        providerCode: 'KBZ_PAY',
        transactionReference: 'X',
        proofUrl: 'https://evil.example.com/proof.png',
      },
    ]) {
      let req = request(app.getHttpServer())
        .post(`/api/payments/orders/${ORDER_10}/manual`)
        .set(as(USER_11));
      for (const [k, v] of Object.entries(fields)) {
        req = req.field(k, String(v));
      }
      await req.attach('image', validPngBuffer, 'proof.png').expect(400);
    }

    expect(payments.submitManualPayment).toHaveBeenCalledTimes(1);
  });

  it('enforces the database-backed payment permissions rather than JWT role claims', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/payments')
      .set(as(USER_1, 'ADMIN'))
      .expect(403);
    const list = await request(app.getHttpServer())
      .get('/api/admin/payments?page=2&limit=5&status=UNDER_REVIEW')
      .set(as(USER_2))
      .expect(200);
    expect(list.body).toMatchObject({
      success: true,
      data: { pagination: { page: 2, limit: 5 } },
    });
    expect(payments.listAttempts).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 5, status: 'UNDER_REVIEW' }),
    );
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${ATTEMPT_7}/approve`)
      .set(as(USER_2))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${ATTEMPT_7}/reject`)
      .set(as(USER_2))
      .send({ reason: 'Invalid reference' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payments/orders/${ORDER_10}/collect-cod`)
      .set(as(USER_2))
      .expect(201);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_2 } }),
    );
  });
});

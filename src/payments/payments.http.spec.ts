import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { GlobalExceptionFilter } from '../common/http/global-exception.filter.js';
import { ResponseInterceptor } from '../common/http/response.interceptor.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { AdminPaymentsController, PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

describe('Payments HTTP', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let prisma: any;
  let payments: any;
  beforeEach(async () => {
    prisma = { user: { findUnique: vi.fn(async ({ where }) => ({
      isActive: true,
      role: { permissions: (where.id === 2 ? ['payment:read', 'payment:update', 'payment:collect'] : []).map((code) => ({ permission: { code } })) },
    })) } };
    payments = {
      getCustomerOrderPayments: vi.fn(async (userId, orderId) => ({ id: orderId, userId, paymentStatus: 'PENDING', paymentAttempts: [] })),
      submitManualPayment: vi.fn(async (userId, orderId) => ({ id: 4, orderId, userId, status: 'UNDER_REVIEW' })),
      listAttempts: vi.fn(async (query) => ({ items: [], pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 } })),
      getAttempt: vi.fn(async (id) => ({ id, status: 'UNDER_REVIEW' })),
      approveManualPayment: vi.fn(async (id, actorId) => ({ id, actorId, status: 'PAID' })),
      rejectManualPayment: vi.fn(async (id, actorId, dto) => ({ id, actorId, status: 'REJECTED', reason: dto.reason })),
      collectCod: vi.fn(async (id, actorId) => ({ id, actorId, status: 'PAID' })),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'isolated-payments-test-secret' })],
      controllers: [PaymentsController, AdminPaymentsController],
      providers: [JwtAuthGuard, PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentsService, useValue: payments },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    jwt = app.get(JwtService);
  });
  afterEach(async () => app.close());
  const as = (id: number, role = 'CUSTOMER') => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role })}` });

  it('requires JWT and derives customer ownership only from the JWT subject', async () => {
    await request(app.getHttpServer()).get('/api/payments/orders/10').expect(401);
    const response = await request(app.getHttpServer()).get('/api/payments/orders/10').set(as(11)).expect(200);
    expect(response.body).toMatchObject({ success: true, data: { id: 10, userId: 11 } });
    expect(payments.getCustomerOrderPayments).toHaveBeenCalledWith(11, 10);
    await request(app.getHttpServer()).post('/api/payments/orders/10/manual').set(as(11))
      .send({ providerCode: 'KBZ_PAY', transactionReference: 'TX-1', userId: 1, amount: 1 }).expect(400);
  });

  it('validates manual payment fields and returns the shared success envelope', async () => {
    const response = await request(app.getHttpServer()).post('/api/payments/orders/10/manual').set(as(11))
      .send({ providerCode: 'KBZ_PAY', transactionReference: 'TX-1' }).expect(201);
    expect(response.body).toMatchObject({ success: true, data: { status: 'UNDER_REVIEW' } });
    for (const body of [
      { providerCode: 'UNKNOWN', transactionReference: 'X' },
      { providerCode: 'KBZ_PAY', transactionReference: '' },
      { providerCode: 'KBZ_PAY', transactionReference: 'X', amount: 1 },
    ]) await request(app.getHttpServer()).post('/api/payments/orders/10/manual').set(as(11)).send(body).expect(400);
    expect(payments.submitManualPayment).toHaveBeenCalledTimes(1);
  });

  it('enforces the database-backed payment permissions rather than JWT role claims', async () => {
    await request(app.getHttpServer()).get('/api/admin/payments').set(as(1, 'ADMIN')).expect(403);
    const list = await request(app.getHttpServer()).get('/api/admin/payments?page=2&limit=5&status=UNDER_REVIEW').set(as(2)).expect(200);
    expect(list.body).toMatchObject({ success: true, data: { pagination: { page: 2, limit: 5 } } });
    expect(payments.listAttempts).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 5, status: 'UNDER_REVIEW' }));
    await request(app.getHttpServer()).post('/api/admin/payments/7/approve').set(as(2)).expect(201);
    await request(app.getHttpServer()).post('/api/admin/payments/7/reject').set(as(2)).send({ reason: 'Invalid reference' }).expect(201);
    await request(app.getHttpServer()).post('/api/admin/payments/orders/10/collect-cod').set(as(2)).expect(201);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 } }));
  });
});

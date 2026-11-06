import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  OrderPaymentStatus,
} from '../generated/prisma/client.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import {
  AdminOrdersController,
  OrdersController,
} from '../orders/orders.controller.js';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { StockService } from '../stock/stock.service.js';
import {
  AdminPaymentsController,
  PaymentsController,
} from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Drives the real PaymentsService and OrdersService over an in-memory store
 * through the HTTP layer, so every assertion checks both the API response and
 * the persisted Order / PaymentAttempt / PaymentEvent state. Transactions are
 * serialised the way `SELECT ... FOR UPDATE` on the Order row serialises them.
 */
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (expected && typeof expected === 'object') {
      if ('in' in expected) return expected.in.includes(row[key]);
      if ('not' in expected) return row[key] !== expected.not;
    }
    return row[key] === expected;
  });
}

describe('Order / PaymentAttempt status consistency (HTTP)', () => {
  const CUSTOMER = uuid(7);
  const OTHER_CUSTOMER = uuid(8);
  const ADMIN = uuid(2);
  const ORDER = uuid(100);
  const PRODUCT = uuid(200);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XWJ2AAAAAElFTkSuQmCC',
    'base64',
  );

  let app: INestApplication;
  let jwt: JwtService;
  let orders: Row[];
  let attempts: Row[];
  let events: Row[];
  let restored: Array<{ productId: string; quantity: number; orderId: string }>;
  let uploadCount: number;
  let uploads: { uploadPaymentProofImage: any; deletePaymentProofImage: any };
  let nextAttempt: number;

  const proofIdOf = (attemptId: string) =>
    attempts.find((a) => a.id === attemptId)?.imagePublicId;

  function buildPrisma() {
    let chain: Promise<unknown> = Promise.resolve();
    const withOrder = (attempt: Row) => ({
      ...attempt,
      order: {
        ...orders.find((o) => o.id === attempt.orderId),
        user: { id: CUSTOMER, name: 'Ada' },
      },
    });
    const orderView = (order: Row | undefined) =>
      order && {
        ...order,
        paymentAttempts: attempts
          .filter((a) => a.orderId === order.id)
          .reverse()
          .map((a) => ({ ...a })),
      };
    const client: Row = {
      $queryRaw: async (_strings: TemplateStringsArray, ...values: any[]) => {
        const [orderId, userId] = values;
        const order = orders.find(
          (o) =>
            o.id === orderId && (userId === undefined || o.userId === userId),
        );
        return order ? [{ id: order.id }] : [];
      },
      order: {
        findFirst: async ({ where }: Row) =>
          orderView(orders.find((o) => matches(o, where))) ?? null,
        findUnique: async ({ where }: Row) =>
          orderView(orders.find((o) => matches(o, where))) ?? null,
        findUniqueOrThrow: async ({ where }: Row) =>
          orderView(orders.find((o) => matches(o, where))),
        updateMany: async ({ where, data }: Row) => {
          const row = orders.find((o) => matches(o, where));
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      paymentAttempt: {
        findFirst: async ({ where }: Row) =>
          attempts.find((a) => matches(a, where)) ?? null,
        findMany: async ({ where }: Row) =>
          attempts.filter((a) => matches(a, where)).map((a) => ({ ...a })),
        findUnique: async ({ where }: Row) =>
          attempts.find((a) => a.id === where.id) ?? null,
        findUniqueOrThrow: async ({ where }: Row) =>
          withOrder(attempts.find((a) => a.id === where.id)!),
        create: async ({ data }: Row) => {
          const row = {
            id: uuid(1000 + nextAttempt++),
            rejectionReason: null,
            reviewedAt: null,
            paidAt: null,
            reviewedById: null,
            createdAt: new Date(),
            ...data,
          };
          attempts.push(row);
          return { ...row };
        },
        updateMany: async ({ where, data }: Row) => {
          const row = attempts.find((a) => matches(a, where));
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      paymentEvent: {
        create: async ({ data }: Row) => {
          events.push({ id: uuid(5000 + events.length), ...data });
          return data;
        },
      },
    };
    return {
      ...client,
      user: {
        findUnique: async ({ where }: Row) => ({
          isActive: true,
          role: {
            permissions: (where.id === ADMIN
              ? [
                  'payment:read',
                  'payment:update',
                  'payment:collect',
                  'order:read',
                  'order:update',
                ]
              : []
            ).map((code) => ({ permission: { code } })),
          },
        }),
      },
      $transaction: (callback: (tx: Row) => Promise<unknown>) => {
        const run = chain.then(async () => {
          const before = {
            orders: orders.map((o) => ({ ...o })),
            attempts: attempts.map((a) => ({ ...a })),
            events: events.map((e) => ({ ...e })),
            restored: [...restored],
          };
          try {
            return await callback(client);
          } catch (error) {
            ({ orders, attempts, events, restored } = before);
            throw error;
          }
        });
        chain = run.catch(() => undefined);
        return run;
      },
    };
  }

  beforeEach(async () => {
    orders = [
      {
        id: ORDER,
        orderNumber: 'ORD-1',
        userId: CUSTOMER,
        totalAmount: '1250.50',
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.MANUAL,
        paymentStatus: OrderPaymentStatus.PENDING,
        items: [{ productId: PRODUCT, quantity: 2 }],
      },
    ];
    attempts = [];
    events = [];
    restored = [];
    uploadCount = 0;
    nextAttempt = 1;
    uploads = {
      uploadPaymentProofImage: vi.fn(async (_file: unknown, userId: string) => {
        uploadCount += 1;
        return {
          secure_url: `https://res.cloudinary.com/demo/proof-${uploadCount}.png`,
          public_id: `ecommerce/payments/users/${userId}/proof-${uploadCount}`,
        };
      }),
      deletePaymentProofImage: vi.fn(async () => true),
    };
    const stock = {
      restoreForOrder: vi.fn(
        async (
          _tx: unknown,
          productId: string,
          quantity: number,
          _a: string,
          orderId: string,
        ) => {
          restored.push({ productId, quantity, orderId });
        },
      ),
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'status-consistency-secret' })],
      controllers: [
        PaymentsController,
        AdminPaymentsController,
        OrdersController,
        AdminOrdersController,
      ],
      providers: [
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        PaymentsService,
        OrdersService,
        { provide: PrismaService, useValue: buildPrisma() },
        { provide: UploadsService, useValue: uploads },
        { provide: StockService, useValue: stock },
      ],
    });
    jwt = app.get(JwtService);
  });
  afterEach(async () => app.close());

  const as = (id: string) => ({
    Authorization: `Bearer ${jwt.sign({ sub: id, role: 'X' })}`,
  });
  const submit = (user = CUSTOMER, reference = 'TX-1') =>
    request(app.getHttpServer())
      .post(`/api/payments/orders/${ORDER}/manual`)
      .set(as(user))
      .field('providerCode', 'KBZ_PAY')
      .field('transactionReference', reference)
      .attach('image', png, 'proof.png');
  const approve = (id: string) =>
    request(app.getHttpServer())
      .post(`/api/admin/payments/${id}/approve`)
      .set(as(ADMIN));
  const reject = (id: string) =>
    request(app.getHttpServer())
      .post(`/api/admin/payments/${id}/reject`)
      .set(as(ADMIN))
      .send({ reason: 'Reference mismatch' });
  const cancel = () =>
    request(app.getHttpServer())
      .post(`/api/orders/${ORDER}/cancel`)
      .set(as(CUSTOMER));
  const collectCod = () =>
    request(app.getHttpServer())
      .post(`/api/admin/payments/orders/${ORDER}/collect-cod`)
      .set(as(ADMIN));
  const order = () => orders.find((o) => o.id === ORDER)!;

  /** Cross-model invariants that must hold after every operation. */
  function expectConsistent() {
    const o = order();
    const mine = attempts.filter((a) => a.orderId === o.id);
    const paid = mine.filter((a) => a.status === PaymentStatus.PAID);
    const open = mine.filter((a) =>
      [PaymentStatus.PENDING, PaymentStatus.UNDER_REVIEW].includes(a.status),
    );
    expect(paid.length).toBeLessThanOrEqual(1);
    expect(open.length).toBeLessThanOrEqual(1);
    expect([
      PaymentStatus.PENDING,
      PaymentStatus.PAID,
      PaymentStatus.CANCELLED,
    ]).toContain(o.paymentStatus);
    expect(o.paymentStatus === OrderPaymentStatus.PAID).toBe(paid.length === 1);
    if (o.paymentStatus === OrderPaymentStatus.CANCELLED) {
      expect(o.status).toBe(OrderStatus.CANCELLED);
    }
    if (o.status === OrderStatus.CANCELLED) {
      expect(open).toHaveLength(0);
      expect(paid).toHaveLength(0);
    }
    if (open.length || paid.length) {
      expect(o.status).not.toBe(OrderStatus.CANCELLED);
    }
    // PaymentEvent history: a gapless chain ending at the attempt's status.
    for (const attempt of mine) {
      const chain = events.filter((e) => e.paymentAttemptId === attempt.id);
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[0].previousStatus).toBeNull();
      chain.slice(1).forEach((event, i) => {
        expect(event.previousStatus).toBe(chain[i].newStatus);
      });
      expect(chain.at(-1)!.newStatus).toBe(attempt.status);
    }
  }

  it('manual submission creates an UNDER_REVIEW attempt, keeps the Order PENDING and records one event', async () => {
    const res = await submit().expect(201);
    expect(res.body.data).toMatchObject({
      orderId: ORDER,
      status: PaymentStatus.UNDER_REVIEW,
      proofUrl: 'https://res.cloudinary.com/demo/proof-1.png',
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: PaymentStatus.UNDER_REVIEW,
      imagePublicId: `ecommerce/payments/users/${CUSTOMER}/proof-1`,
    });
    expect(order()).toMatchObject({
      status: OrderStatus.PENDING,
      paymentStatus: OrderPaymentStatus.PENDING,
    });
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'MANUAL_SUBMITTED',
        previousStatus: null,
        newStatus: PaymentStatus.UNDER_REVIEW,
        actorId: CUSTOMER,
      }),
    ]);
    expectConsistent();

    await submit(OTHER_CUSTOMER).expect(404);
    expect(attempts).toHaveLength(1);
    expect(uploads.deletePaymentProofImage).toHaveBeenCalledTimes(0);
  });

  it('approval settles the attempt and the Order together, never changes the lifecycle status, and is idempotent-safe', async () => {
    const attemptId = (await submit().expect(201)).body.data.id;
    const res = await approve(attemptId).expect(201);
    expect(res.body.data).toMatchObject({ id: attemptId, status: 'PAID' });
    expect(attempts[0]).toMatchObject({
      status: PaymentStatus.PAID,
      reviewedById: ADMIN,
    });
    expect(order()).toMatchObject({
      status: OrderStatus.PENDING,
      paymentStatus: OrderPaymentStatus.PAID,
    });
    expectConsistent();

    const eventCount = events.length;
    await approve(attemptId).expect(409);
    await reject(attemptId).expect(409);
    expect(events).toHaveLength(eventCount);
    expect(attempts[0].status).toBe(PaymentStatus.PAID);
    expectConsistent();

    await submit(CUSTOMER, 'TX-2').expect(409);
    expect(attempts).toHaveLength(1);
  });

  it('rejection keeps the attempt as history, leaves the Order PENDING and allows exactly one new attempt', async () => {
    const first = (await submit().expect(201)).body.data.id;
    const res = await reject(first).expect(201);
    expect(res.body.data).toMatchObject({ id: first, status: 'REJECTED' });
    expect(attempts[0]).toMatchObject({
      status: PaymentStatus.REJECTED,
      rejectionReason: 'Reference mismatch',
    });
    expect(order().paymentStatus).toBe(OrderPaymentStatus.PENDING);
    expectConsistent();

    const eventCount = events.length;
    await reject(first).expect(409);
    await approve(first).expect(409);
    expect(events).toHaveLength(eventCount);
    expect(order().paymentStatus).toBe(OrderPaymentStatus.PENDING);

    const second = (await submit(CUSTOMER, 'TX-2').expect(201)).body.data.id;
    await submit(CUSTOMER, 'TX-3').expect(409);
    expect(attempts.map((a) => a.status)).toEqual([
      PaymentStatus.REJECTED,
      PaymentStatus.UNDER_REVIEW,
    ]);
    expect(order().paymentStatus).toBe(OrderPaymentStatus.PENDING);
    expectConsistent();

    await approve(second).expect(201);
    // The earlier rejected attempt is untouched by the later approval.
    expect(attempts.map((a) => a.status)).toEqual([
      PaymentStatus.REJECTED,
      PaymentStatus.PAID,
    ]);
    expect(order().paymentStatus).toBe(OrderPaymentStatus.PAID);
    expectConsistent();

    const history = await request(app.getHttpServer())
      .get(`/api/payments/orders/${ORDER}`)
      .set(as(CUSTOMER))
      .expect(200);
    expect(history.body.data.paymentStatus).toBe('PAID');
    expect(history.body.data.paymentAttempts.map((a: Row) => a.status)).toEqual(
      ['PAID', 'REJECTED'],
    );
  });

  it('COD stays PENDING with no attempt until delivery, then settles once', async () => {
    orders[0].paymentMethod = PaymentMethod.COD;
    await collectCod().expect(409); // not delivered yet
    expect(attempts).toHaveLength(0);
    expect(order().paymentStatus).toBe(OrderPaymentStatus.PENDING);

    orders[0].status = OrderStatus.DELIVERED;
    const res = await collectCod().expect(201);
    expect(res.body.data).toMatchObject({ method: 'COD', status: 'PAID' });
    expect(order()).toMatchObject({
      status: OrderStatus.DELIVERED,
      paymentStatus: OrderPaymentStatus.PAID,
    });
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'COD_COLLECTED',
        previousStatus: null,
        newStatus: PaymentStatus.PAID,
      }),
    ]);
    expectConsistent();

    await collectCod().expect(409);
    expect(attempts).toHaveLength(1);
    expect(events).toHaveLength(1);
    await submit().expect(409); // COD orders never accept manual proof
    expectConsistent();
  });

  it('cancelling with an open attempt cancels Order and attempt together, restores stock once, and keeps history', async () => {
    const rejected = (await submit().expect(201)).body.data.id;
    await reject(rejected).expect(201);
    const open = (await submit(CUSTOMER, 'TX-2').expect(201)).body.data.id;

    const res = await cancel().expect(201);
    expect(res.body.data).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'CANCELLED',
    });
    expect(attempts.find((a) => a.id === rejected)!.status).toBe(
      PaymentStatus.REJECTED,
    );
    expect(attempts.find((a) => a.id === open)!.status).toBe(
      PaymentStatus.CANCELLED,
    );
    expect(events.at(-1)).toMatchObject({
      paymentAttemptId: open,
      eventType: 'ORDER_CANCELLED',
      previousStatus: PaymentStatus.UNDER_REVIEW,
      newStatus: PaymentStatus.CANCELLED,
      actorId: CUSTOMER,
    });
    expect(restored).toEqual([
      { productId: PRODUCT, quantity: 2, orderId: ORDER },
    ]);
    expectConsistent();

    const eventCount = events.length;
    await cancel().expect(409);
    await approve(open).expect(409);
    await reject(open).expect(409);
    await submit(CUSTOMER, 'TX-3').expect(409);
    expect(events).toHaveLength(eventCount);
    expect(restored).toHaveLength(1);
    expectConsistent();
  });

  it('cancelling a COD order with no attempts cancels the Order payment state and restores stock', async () => {
    orders[0].paymentMethod = PaymentMethod.COD;
    await cancel().expect(201);
    expect(order()).toMatchObject({
      status: OrderStatus.CANCELLED,
      paymentStatus: OrderPaymentStatus.CANCELLED,
    });
    expect(attempts).toHaveLength(0);
    expect(restored).toHaveLength(1);
    expectConsistent();
  });

  it('a paid order cannot be cancelled by the customer or an admin and nothing changes', async () => {
    const id = (await submit().expect(201)).body.data.id;
    await approve(id).expect(201);
    const snapshot = JSON.stringify({ orders, attempts, events });

    await cancel().expect(409);
    await request(app.getHttpServer())
      .patch(`/api/admin/orders/${ORDER}/status`)
      .set(as(ADMIN))
      .send({ status: 'CANCELLED' })
      .expect(409);

    expect(JSON.stringify({ orders, attempts, events })).toBe(snapshot);
    expect(restored).toHaveLength(0);
    expectConsistent();
  });

  it('admin cancellation also cancels open attempts consistently', async () => {
    await submit().expect(201);
    await request(app.getHttpServer())
      .patch(`/api/admin/orders/${ORDER}/status`)
      .set(as(ADMIN))
      .send({ status: 'CANCELLED' })
      .expect(200);
    expect(order()).toMatchObject({
      status: OrderStatus.CANCELLED,
      paymentStatus: OrderPaymentStatus.CANCELLED,
    });
    expect(attempts[0].status).toBe(PaymentStatus.CANCELLED);
    expect(events.at(-1)).toMatchObject({ actorId: ADMIN });
    expectConsistent();
  });

  it('concurrent approve and reject of one attempt settle exactly once', async () => {
    const id = (await submit().expect(201)).body.data.id;
    const results = await Promise.all([approve(id), reject(id)]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(
      events.filter((e) => e.previousStatus === 'UNDER_REVIEW'),
    ).toHaveLength(1);
    expectConsistent();
  });

  it('concurrent approve and cancel never produce a paid cancelled order', async () => {
    const id = (await submit().expect(201)).body.data.id;
    const results = await Promise.all([approve(id), cancel()]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(
      order().status === OrderStatus.CANCELLED &&
        order().paymentStatus === PaymentStatus.PAID,
    ).toBe(false);
    expect(restored.length).toBe(
      order().status === OrderStatus.CANCELLED ? 1 : 0,
    );
    expectConsistent();
  });

  it('concurrent submissions create one attempt and clean up the losing upload', async () => {
    // Hold both uploads until both requests passed the pre-upload eligibility
    // check, so the race is decided inside the locked transaction.
    let release!: () => void;
    const bothUploading = new Promise<void>((resolve) => (release = resolve));
    const original = uploads.uploadPaymentProofImage.getMockImplementation()!;
    uploads.uploadPaymentProofImage.mockImplementation(
      async (file: unknown, userId: string) => {
        const result = await original(file, userId);
        if (uploadCount === 2) release();
        await bothUploading;
        return result;
      },
    );
    const results = await Promise.all([
      submit(CUSTOMER, 'TX-A'),
      submit(CUSTOMER, 'TX-B'),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(attempts).toHaveLength(1);
    expect(uploads.deletePaymentProofImage).toHaveBeenCalledTimes(1);
    const deleted = uploads.deletePaymentProofImage.mock.calls[0][0];
    expect(deleted).not.toBe(proofIdOf(attempts[0].id));
    expectConsistent();
  });

  it('concurrent COD collections settle once', async () => {
    orders[0].paymentMethod = PaymentMethod.COD;
    orders[0].status = OrderStatus.DELIVERED;
    const results = await Promise.all([collectCod(), collectCod()]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(attempts).toHaveLength(1);
    expect(events).toHaveLength(1);
    expectConsistent();
  });
});

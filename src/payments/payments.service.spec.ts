import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PaymentsService } from './payments.service.js';

describe('PaymentsService', () => {
  const ORDER_ID = '00000000-0000-4000-8000-000000000004';
  const CUSTOMER_ID = '00000000-0000-4000-8000-000000000007';
  const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-000000000008';
  const ADMIN_ID = '00000000-0000-4000-8000-000000000002';
  const ATTEMPT_ID = '00000000-0000-4000-8000-000000000009';
  const EXISTING_ATTEMPT_ID = '00000000-0000-4000-8000-000000000002';

  let service: PaymentsService;
  let prisma: any;
  let tx: any;
  let order: any;
  let attempt: any;
  let events: any[];
  let config: any;

  beforeEach(() => {
    order = {
      id: ORDER_ID,
      userId: CUSTOMER_ID,
      totalAmount: new Prisma.Decimal('1250.50'),
      status: OrderStatus.DELIVERED,
      paymentMethod: PaymentMethod.MANUAL,
      paymentStatus: PaymentStatus.PENDING,
    };
    attempt = null;
    events = [];
    config = { get: vi.fn(() => 'proof.example.com') };
    tx = {
      $queryRaw: vi.fn(async () => [{ id: order.id }]),
      order: {
        findFirst: vi.fn(async ({ where }) =>
          where.id === order.id && where.userId === order.userId
            ? { ...order }
            : null,
        ),
        findUnique: vi.fn(async () => ({ ...order })),
        updateMany: vi.fn(async ({ where, data }) => {
          if (
            where.paymentStatus?.not === PaymentStatus.PAID &&
            order.paymentStatus === PaymentStatus.PAID
          )
            return { count: 0 };
          if (
            where.status === OrderStatus.DELIVERED &&
            order.status !== OrderStatus.DELIVERED
          )
            return { count: 0 };
          Object.assign(order, data);
          return { count: 1 };
        }),
      },
      paymentAttempt: {
        findFirst: vi.fn(async () =>
          attempt &&
          [
            PaymentStatus.PENDING,
            PaymentStatus.UNDER_REVIEW,
            PaymentStatus.PAID,
          ].includes(attempt.status)
            ? attempt
            : null,
        ),
        findUnique: vi.fn(async () => attempt),
        create: vi.fn(async ({ data }) => {
          attempt = { id: ATTEMPT_ID, ...data, createdAt: new Date() };
          return attempt;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          if (
            !attempt ||
            attempt.id !== where.id ||
            attempt.status !== where.status
          )
            return { count: 0 };
          Object.assign(attempt, data);
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => attempt),
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
      paymentEvent: {
        create: vi.fn(async ({ data }) => {
          events.push(data);
          return data;
        }),
      },
    };
    prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      order: { findFirst: tx.order.findFirst },
      paymentAttempt: {
        findMany: tx.paymentAttempt.findMany,
        count: tx.paymentAttempt.count,
        findUnique: vi.fn(async () => null),
      },
    };
    service = new PaymentsService(prisma, config as ConfigService);
  });

  it('submits a server-priced manual attempt and appends an audit event', async () => {
    const result = await service.submitManualPayment(CUSTOMER_ID, ORDER_ID, {
      providerCode: 'KBZ_PAY',
      transactionReference: ' TX-1 ',
      proofUrl: 'https://proof.example.com/receipt/1',
    });
    expect(result).toMatchObject({
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      status: PaymentStatus.UNDER_REVIEW,
      amount: new Prisma.Decimal('1250.50'),
      currency: 'MMK',
      transactionReference: 'TX-1',
    });
    expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
    expect(tx.paymentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'MANUAL_SUBMITTED',
        previousStatus: null,
        newStatus: PaymentStatus.UNDER_REVIEW,
        actorId: CUSTOMER_ID,
      }),
    });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
  });

  it('hides another customer order and rejects wrong method, cancelled and duplicate attempts', async () => {
    await expect(
      service.getCustomerOrderPayments(OTHER_CUSTOMER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    order.paymentMethod = PaymentMethod.COD;
    await expect(
      service.submitManualPayment(CUSTOMER_ID, ORDER_ID, {
        providerCode: 'KBZ_PAY',
        transactionReference: 'X',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    order.paymentMethod = PaymentMethod.MANUAL;
    order.status = OrderStatus.CANCELLED;
    await expect(
      service.submitManualPayment(CUSTOMER_ID, ORDER_ID, {
        providerCode: 'KBZ_PAY',
        transactionReference: 'X',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    order.status = OrderStatus.DELIVERED;
    attempt = { id: EXISTING_ATTEMPT_ID, status: PaymentStatus.UNDER_REVIEW };
    await expect(
      service.submitManualPayment(CUSTOMER_ID, ORDER_ID, {
        providerCode: 'KBZ_PAY',
        transactionReference: 'X',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires an exact HTTPS allowlisted host for proof URLs', async () => {
    await expect(
      service.submitManualPayment(CUSTOMER_ID, ORDER_ID, {
        providerCode: 'KBZ_PAY',
        transactionReference: 'X',
        proofUrl: 'http://proof.example.com/a',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    config.get.mockReturnValue(undefined);
    await expect(
      service.submitManualPayment(CUSTOMER_ID, ORDER_ID, {
        providerCode: 'KBZ_PAY',
        transactionReference: 'Y',
        proofUrl: 'https://proof.example.com/a',
      } as any),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('approves a pending review atomically and records a transition event', async () => {
    attempt = {
      id: ATTEMPT_ID,
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      status: PaymentStatus.UNDER_REVIEW,
    };
    const result = await service.approveManualPayment(ATTEMPT_ID, ADMIN_ID);
    expect(result.status).toBe(PaymentStatus.PAID);
    expect(attempt.reviewedById).toBe(ADMIN_ID);
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
    expect(events).toContainEqual(
      expect.objectContaining({
        eventType: 'MANUAL_APPROVED',
        previousStatus: PaymentStatus.UNDER_REVIEW,
        newStatus: PaymentStatus.PAID,
        actorId: ADMIN_ID,
      }),
    );
  });

  it('rejects a manual attempt when its parent Order uses COD without writing payment state or an event', async () => {
    attempt = {
      id: ATTEMPT_ID,
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      status: PaymentStatus.UNDER_REVIEW,
    };
    order.paymentMethod = PaymentMethod.COD;

    await expect(
      service.approveManualPayment(ATTEMPT_ID, ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.paymentAttempt.updateMany).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.paymentEvent.create).not.toHaveBeenCalled();
    expect(attempt.status).toBe(PaymentStatus.UNDER_REVIEW);
    expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
  });

  it('rejects pending review with the reason, permits a retry, and records audit history', async () => {
    attempt = {
      id: ATTEMPT_ID,
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      status: PaymentStatus.UNDER_REVIEW,
    };
    const rejected = await service.rejectManualPayment(ATTEMPT_ID, ADMIN_ID, {
      reason: 'Invalid transfer reference',
    });
    expect(rejected.status).toBe(PaymentStatus.REJECTED);
    expect(attempt.rejectionReason).toBe('Invalid transfer reference');
    expect(events[0]).toMatchObject({
      eventType: 'MANUAL_REJECTED',
      previousStatus: PaymentStatus.UNDER_REVIEW,
      newStatus: PaymentStatus.REJECTED,
      reason: 'Invalid transfer reference',
    });
    attempt = null;
    const retried = await service.submitManualPayment(CUSTOMER_ID, ORDER_ID, {
      providerCode: 'WAVE_MONEY',
      transactionReference: 'TX-2',
    } as any);
    expect(retried.status).toBe(PaymentStatus.UNDER_REVIEW);
  });

  it('rejects duplicate approval and collects COD once only after delivery', async () => {
    attempt = {
      id: ATTEMPT_ID,
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      status: PaymentStatus.PAID,
    };
    await expect(
      service.approveManualPayment(ATTEMPT_ID, ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    order.paymentMethod = PaymentMethod.COD;
    order.status = OrderStatus.PROCESSING;
    await expect(service.collectCod(ORDER_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    order.status = OrderStatus.DELIVERED;
    const collected = await service.collectCod(ORDER_ID, ADMIN_ID);
    expect(collected).toMatchObject({
      method: PaymentMethod.COD,
      providerCode: null,
      status: PaymentStatus.PAID,
      amount: new Prisma.Decimal('1250.50'),
    });
    await expect(service.collectCod(ORDER_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(events.at(-1)).toMatchObject({
      eventType: 'COD_COLLECTED',
      newStatus: PaymentStatus.PAID,
      actorId: ADMIN_ID,
    });
  });

  it('propagates audit insertion failures from the shared transaction', async () => {
    attempt = {
      id: ATTEMPT_ID,
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      status: PaymentStatus.UNDER_REVIEW,
    };
    tx.paymentEvent.create.mockRejectedValueOnce(
      new Error('event insert failed'),
    );
    await expect(
      service.approveManualPayment(ATTEMPT_ID, ADMIN_ID),
    ).rejects.toThrow('event insert failed');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});

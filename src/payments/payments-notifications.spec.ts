import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  OrderPaymentStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PaymentsService } from './payments.service.js';
import { MailingService } from '../modules/mailing/mailing.service.js';

describe('PaymentsService email notifications', () => {
  const ORDER_ID = '00000000-0000-4000-8000-000000000004';
  const CUSTOMER_ID = '00000000-0000-4000-8000-000000000007';
  const ADMIN_ID = '00000000-0000-4000-8000-000000000002';
  const ATTEMPT_ID = '00000000-0000-4000-8000-000000000009';

  let service: PaymentsService;
  let prisma: any;
  let mailing: any;
  let attempt: any;
  let order: any;

  beforeEach(() => {
    order = {
      id: ORDER_ID,
      orderNumber: 'ORD-PAY-001',
      userId: CUSTOMER_ID,
      totalAmount: new Prisma.Decimal('25000.00'),
      status: OrderStatus.CONFIRMED,
      paymentMethod: PaymentMethod.MANUAL,
      paymentStatus: OrderPaymentStatus.PENDING,
    };

    attempt = {
      id: ATTEMPT_ID,
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      providerCode: 'KPAY',
      status: PaymentStatus.UNDER_REVIEW,
      amount: order.totalAmount,
      currency: 'MMK',
      transactionReference: 'TX-12345',
      rejectionReason: null,
      order: {
        orderNumber: order.orderNumber,
        userId: CUSTOMER_ID,
      },
    };

    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: ORDER_ID }]),
      order: {
        findUnique: vi.fn(async () => ({ ...order })),
        updateMany: vi.fn(async ({ data }) => {
          Object.assign(order, data);
          return { count: 1 };
        }),
      },
      paymentAttempt: {
        findUnique: vi.fn(async () => ({ ...attempt })),
        updateMany: vi.fn(async ({ data }) => {
          Object.assign(attempt, data);
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => ({ ...attempt })),
      },
      paymentEvent: {
        create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      },
    };

    prisma = {
      order: { findUnique: vi.fn(async () => ({ ...order })) },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          email: 'customer@example.test',
          name: 'Aye Aye',
        }),
      },
      $transaction: vi.fn(async (cb) => cb(tx)),
    };

    mailing = {
      buildFrontendUrl: vi.fn((path: string) => `https://shop.example.test${path}`),
      sendPaymentNotification: vi.fn().mockResolvedValue({ sent: true, provider: 'mock' }),
    };

    service = new PaymentsService(prisma, undefined, mailing as MailingService);
  });

  it('sends MANUAL_APPROVED notification after approval', async () => {
    const res = await service.approveManualPayment(ATTEMPT_ID, ADMIN_ID);
    expect(res.status).toBe(PaymentStatus.PAID);
    expect(mailing.sendPaymentNotification).toHaveBeenCalledWith(
      'customer@example.test',
      expect.objectContaining({
        kind: 'MANUAL_APPROVED',
        orderNumber: 'ORD-PAY-001',
        paymentStatus: PaymentStatus.PAID,
      }),
      `payment:manual-approved:${ATTEMPT_ID}`,
    );
  });

  it('sends MANUAL_REJECTED notification with reason and succeeds even if mailing throws', async () => {
    mailing.sendPaymentNotification.mockRejectedValueOnce(new Error('Brevo 503'));

    const res = await service.rejectManualPayment(ATTEMPT_ID, ADMIN_ID, {
      reason: 'Amount mismatch',
    });

    expect(res.status).toBe(PaymentStatus.REJECTED);
    expect(mailing.sendPaymentNotification).toHaveBeenCalledWith(
      'customer@example.test',
      expect.objectContaining({
        kind: 'MANUAL_REJECTED',
        rejectionReason: 'Amount mismatch',
      }),
      `payment:manual-rejected:${ATTEMPT_ID}`,
    );
  });
});

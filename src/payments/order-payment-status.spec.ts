import {
  OrderPaymentStatus,
  PaymentStatus,
  Prisma,
} from '../generated/prisma/client.js';

describe('OrderPaymentStatus and PaymentStatus type separation', () => {
  it('enforces that Order accepts only PENDING, PAID, and CANCELLED', () => {
    // Valid values for OrderPaymentStatus
    const pendingStatus: OrderPaymentStatus = OrderPaymentStatus.PENDING;
    const paidStatus: OrderPaymentStatus = OrderPaymentStatus.PAID;
    const cancelledStatus: OrderPaymentStatus = OrderPaymentStatus.CANCELLED;

    expect(pendingStatus).toBe('PENDING');
    expect(paidStatus).toBe('PAID');
    expect(cancelledStatus).toBe('CANCELLED');

    // Verify Prisma input object typing for Order
    const validOrderInput: Prisma.OrderCreateInput = {
      orderNumber: 'ORD-TEST-1',
      totalAmount: new Prisma.Decimal('100.00'),
      shippingName: 'John Doe',
      shippingPhone: '1234567890',
      shippingAddress: '123 Street',
      user: { connect: { id: '00000000-0000-4000-8000-000000000001' } },
      paymentStatus: OrderPaymentStatus.PENDING,
    };
    expect(validOrderInput.paymentStatus).toBe(OrderPaymentStatus.PENDING);

    // TypeScript compile-time type verification:
    // The following invalid assignments must be rejected by TypeScript:
    // @ts-expect-error Order cannot use REJECTED
    const _invalidRejected: OrderPaymentStatus = PaymentStatus.REJECTED;
    // @ts-expect-error Order cannot use UNDER_REVIEW
    const _invalidReview: OrderPaymentStatus = PaymentStatus.UNDER_REVIEW;
    // @ts-expect-error Order cannot use FAILED
    const _invalidFailed: OrderPaymentStatus = PaymentStatus.FAILED;

    // Suppress unused variable warnings
    expect([_invalidRejected, _invalidReview, _invalidFailed]).toBeDefined();
  });

  it('PaymentAttempt still supports every valid PaymentStatus value', () => {
    const statuses: PaymentStatus[] = [
      PaymentStatus.PENDING,
      PaymentStatus.UNDER_REVIEW,
      PaymentStatus.PAID,
      PaymentStatus.REJECTED,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
    ];

    expect(statuses).toEqual([
      'PENDING',
      'UNDER_REVIEW',
      'PAID',
      'REJECTED',
      'FAILED',
      'CANCELLED',
    ]);

    // Verify Prisma input object typing for PaymentAttempt
    const attemptCreate: Prisma.PaymentAttemptUncheckedCreateInput = {
      orderId: '00000000-0000-4000-8000-000000000001',
      method: 'MANUAL',
      amount: new Prisma.Decimal('50.00'),
      status: PaymentStatus.UNDER_REVIEW,
    };
    expect(attemptCreate.status).toBe(PaymentStatus.UNDER_REVIEW);
  });
});

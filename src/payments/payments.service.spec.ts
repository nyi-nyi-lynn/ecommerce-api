import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  const UPLOADED_PROOF_URL =
    'https://res.cloudinary.com/demo/image/upload/ecommerce/payments/users/00000000-0000-4000-8000-000000000007/proof.png';
  const UPLOADED_PUBLIC_ID = `ecommerce/payments/users/${CUSTOMER_ID}/proof`;

  const mockFile = {
    fieldname: 'image',
    originalname: 'proof.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('proof-image'),
  } as Express.Multer.File;

  let service: PaymentsService;
  let prisma: any;
  let tx: any;
  let order: any;
  let attempt: any;
  let events: any[];
  let uploads: {
    uploadPaymentProofImage: ReturnType<typeof vi.fn>;
    deletePaymentProofImage: ReturnType<typeof vi.fn>;
  };

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
    uploads = {
      uploadPaymentProofImage: vi.fn().mockResolvedValue({
        secure_url: UPLOADED_PROOF_URL,
        public_id: UPLOADED_PUBLIC_ID,
      }),
      deletePaymentProofImage: vi.fn().mockResolvedValue(true),
    };
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
        findFirst: tx.paymentAttempt.findFirst,
        findMany: tx.paymentAttempt.findMany,
        count: tx.paymentAttempt.count,
        findUnique: vi.fn(async () => null),
      },
    };
    service = new PaymentsService(prisma, uploads as any);
  });

  it('uploads payment proof via shared UploadsService and persists proofUrl and imagePublicId', async () => {
    const result = await service.submitManualPayment(
      CUSTOMER_ID,
      ORDER_ID,
      {
        providerCode: 'KBZ_PAY',
        transactionReference: ' TX-1 ',
      },
      mockFile,
    );
    expect(uploads.uploadPaymentProofImage).toHaveBeenCalledWith(
      mockFile,
      CUSTOMER_ID,
    );
    expect(result).toMatchObject({
      orderId: ORDER_ID,
      method: PaymentMethod.MANUAL,
      status: PaymentStatus.UNDER_REVIEW,
      amount: new Prisma.Decimal('1250.50'),
      currency: 'MMK',
      transactionReference: 'TX-1',
      proofUrl: UPLOADED_PROOF_URL,
      imagePublicId: UPLOADED_PUBLIC_ID,
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

  it('hides another customer order and rejects wrong method, cancelled, paid, and duplicate attempts without uploading', async () => {
    await expect(
      service.getCustomerOrderPayments(OTHER_CUSTOMER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.submitManualPayment(
        OTHER_CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    order.paymentMethod = PaymentMethod.COD;
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    order.paymentMethod = PaymentMethod.MANUAL;
    order.status = OrderStatus.CANCELLED;
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    order.status = OrderStatus.DELIVERED;
    order.paymentStatus = PaymentStatus.PAID;
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    order.paymentStatus = PaymentStatus.PENDING;
    attempt = { id: EXISTING_ATTEMPT_ID, status: PaymentStatus.UNDER_REVIEW };
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(uploads.uploadPaymentProofImage).not.toHaveBeenCalled();
  });

  it('validates missing image, invalid file type, oversized file, and missing UploadsService', async () => {
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.uploadPaymentProofImage).not.toHaveBeenCalled();

    uploads.uploadPaymentProofImage.mockRejectedValueOnce(
      new BadRequestException(
        'Only JPEG, PNG, WebP, and AVIF payment proof images are allowed.',
      ),
    );
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    uploads.uploadPaymentProofImage.mockRejectedValueOnce(
      new PayloadTooLargeException(
        'The payment proof image must be 5 MB or smaller.',
      ),
    );
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    const serviceWithoutUploads = new PaymentsService(prisma, undefined);
    await expect(
      serviceWithoutUploads.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('handles Cloudinary upload failure and cleans up uploaded proof image when database persistence fails', async () => {
    uploads.uploadPaymentProofImage.mockRejectedValueOnce(
      new ServiceUnavailableException(
        'Payment proof image upload could not be completed.',
      ),
    );
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    tx.paymentAttempt.create.mockRejectedValueOnce(
      new Error('database write failed'),
    );
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'X',
        },
        mockFile,
      ),
    ).rejects.toThrow('database write failed');
    expect(uploads.deletePaymentProofImage).toHaveBeenCalledWith(
      UPLOADED_PUBLIC_ID,
    );

    uploads.deletePaymentProofImage.mockResolvedValueOnce(false);
    const logSpy = vi
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    tx.paymentEvent.create.mockRejectedValueOnce(
      new Error('event insert failed'),
    );
    await expect(
      service.submitManualPayment(
        CUSTOMER_ID,
        ORDER_ID,
        {
          providerCode: 'KBZ_PAY',
          transactionReference: 'Y',
        },
        mockFile,
      ),
    ).rejects.toThrow('event insert failed');
    expect(logSpy).toHaveBeenCalledWith(
      `Cloudinary payment proof image cleanup failed for order ${ORDER_ID} and public ID ${UPLOADED_PUBLIC_ID}.`,
    );
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
    expect(uploads.deletePaymentProofImage).not.toHaveBeenCalled();
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
    expect(uploads.deletePaymentProofImage).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({
      eventType: 'MANUAL_REJECTED',
      previousStatus: PaymentStatus.UNDER_REVIEW,
      newStatus: PaymentStatus.REJECTED,
      reason: 'Invalid transfer reference',
    });
    attempt = null;
    const retried = await service.submitManualPayment(
      CUSTOMER_ID,
      ORDER_ID,
      {
        providerCode: 'WAVE_MONEY',
        transactionReference: 'TX-2',
      },
      mockFile,
    );
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

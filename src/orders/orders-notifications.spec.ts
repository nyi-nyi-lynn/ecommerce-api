import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderStatus,
  PaymentMethod,
  OrderPaymentStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { OrdersService } from './orders.service.js';
import { MailingService } from '../modules/mailing/mailing.service.js';

describe('OrdersService email notifications', () => {
  const USER_ID = '00000000-0000-4000-8000-000000000007';
  const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
  const ORDER_ID = '00000000-0000-4000-8000-000000000050';

  let service: OrdersService;
  let prisma: any;
  let stock: any;
  let mailing: any;
  let orderRecord: any;

  beforeEach(() => {
    orderRecord = {
      id: ORDER_ID,
      orderNumber: 'ORD-TEST-001',
      userId: USER_ID,
      totalAmount: new Prisma.Decimal('100.00'),
      status: OrderStatus.PENDING,
      paymentMethod: PaymentMethod.COD,
      paymentStatus: OrderPaymentStatus.PENDING,
      shippingName: 'Aye Aye',
      shippingPhone: '091234567',
      shippingAddress: 'Yangon',
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 'item-1',
          productId: PRODUCT_ID,
          productName: 'Green Tea',
          unitPrice: new Prisma.Decimal('50.00'),
          quantity: 2,
          subtotal: new Prisma.Decimal('100.00'),
        },
      ],
    };

    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: ORDER_ID }]),
      product: {
        findMany: vi.fn().mockResolvedValue([
          { id: PRODUCT_ID, name: 'Green Tea', price: new Prisma.Decimal('50.00') },
        ]),
      },
      order: {
        create: vi.fn().mockResolvedValue({ id: ORDER_ID }),
        findUnique: vi.fn().mockResolvedValue(orderRecord),
        findUniqueOrThrow: vi.fn(async () => ({ ...orderRecord })),
        updateMany: vi.fn(async ({ data }) => {
          Object.assign(orderRecord, data);
          return { count: 1 };
        }),
      },
    };

    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          email: 'customer@example.test',
          name: 'Aye Aye',
        }),
      },
      $transaction: vi.fn(async (cb) => cb(tx)),
    };

    stock = {
      consumeForOrder: vi.fn().mockResolvedValue(undefined),
      restoreForOrder: vi.fn().mockResolvedValue(undefined),
    };

    mailing = {
      buildFrontendUrl: vi.fn((path: string) => `https://shop.example.test${path}`),
      sendOrderConfirmation: vi.fn().mockResolvedValue({ sent: true, provider: 'mock' }),
      sendOrderStatusUpdate: vi.fn().mockResolvedValue({ sent: true, provider: 'mock' }),
    };

    service = new OrdersService(prisma, stock, mailing as MailingService);
  });

  it('sends order confirmation after successful order creation', async () => {
    const result = await service.create(USER_ID, {
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      shippingName: 'Aye Aye',
      shippingPhone: '091234567',
      shippingAddress: 'Yangon',
    });

    expect(result.id).toBe(ORDER_ID);
    expect(mailing.sendOrderConfirmation).toHaveBeenCalledWith(
      'customer@example.test',
      expect.objectContaining({
        orderNumber: 'ORD-TEST-001',
        totalAmount: '100',
      }),
      `order:confirmed:${ORDER_ID}`,
    );
  });

  it('does not fail order creation when mailing throws', async () => {
    mailing.sendOrderConfirmation.mockRejectedValueOnce(new Error('SMTP timeout'));

    const result = await service.create(USER_ID, {
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      shippingName: 'Aye Aye',
      shippingPhone: '091234567',
      shippingAddress: 'Yangon',
    });

    expect(result.id).toBe(ORDER_ID);
  });

  it('sends order status update notification with transition dedup key', async () => {
    const updated = await service.updateStatus(
      ORDER_ID,
      { status: OrderStatus.CONFIRMED },
      'admin-id',
    );

    expect(updated.status).toBe(OrderStatus.CONFIRMED);
    expect(mailing.sendOrderStatusUpdate).toHaveBeenCalledWith(
      'customer@example.test',
      expect.objectContaining({
        orderNumber: 'ORD-TEST-001',
        previousStatus: OrderStatus.PENDING,
        newStatus: OrderStatus.CONFIRMED,
      }),
      `order:status:${ORDER_ID}:PENDING:CONFIRMED`,
    );
  });
});

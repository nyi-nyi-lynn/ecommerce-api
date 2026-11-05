import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../generated/prisma/client.js';
import {
  ORDER_CANCELLED_PAYMENT_EVENT,
  OrdersService,
} from './orders.service.js';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;
  let tx: any;
  let stock: any;
  let products: any[];
  let orders: any[];
  let movements: any[];
  let paymentAttempts: Array<{
    id: number;
    orderId: number;
    status: PaymentStatus;
    createdAt: Date;
  }>;
  let paymentEvents: Array<{
    id: number;
    paymentAttemptId: number;
    eventType: string;
    previousStatus: PaymentStatus | null;
    newStatus: PaymentStatus;
    actorId: number | null;
    reason: string | null;
  }>;
  let cartItems: Array<{ productId: number; quantity: number }>;
  let nextId: number;
  let failItemCreate: boolean;
  let hasCart: boolean;

  beforeEach(() => {
    products = [
      { id: 1, name: 'Tea', price: new Prisma.Decimal('2.50'), isActive: true },
      {
        id: 2,
        name: 'Coffee',
        price: new Prisma.Decimal('4.25'),
        isActive: true,
      },
    ];
    orders = [];
    movements = [];
    paymentAttempts = [];
    paymentEvents = [];
    cartItems = [];
    hasCart = true;
    nextId = 1;
    failItemCreate = false;
    tx = {
      $queryRaw: vi.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('?');
          if (sql.includes('"Order"')) {
            const orderId = values[0] as number;
            const userId = values[1] as number | undefined;
            const matched = orders.find(
              (o) =>
                o.id === orderId &&
                (userId === undefined || o.userId === userId),
            );
            return matched ? [{ id: matched.id }] : [];
          }
          return hasCart ? [{ id: 90 }] : [];
        },
      ),
      cartItem: {
        findMany: vi.fn(async ({ where }) =>
          cartItems
            .filter(() => where.cartId === 90)
            .map((item) => ({ ...item })),
        ),
        deleteMany: vi.fn(async ({ where }) => {
          const before = cartItems.length;
          cartItems = where.cartId === 90 ? [] : cartItems;
          return { count: before - cartItems.length };
        }),
      },
      product: {
        findMany: vi.fn(async ({ where }) =>
          products.filter((p) => where.id.in.includes(p.id) && p.isActive),
        ),
      },
      order: {
        create: vi.fn(async ({ data }) => {
          if (failItemCreate) throw new Error('item insert failed');
          const order = {
            ...data,
            id: nextId++,
            items: data.items.create.map((i: any, index: number) => ({
              ...i,
              id: index + 1,
            })),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          orders.push(order);
          return { id: order.id };
        }),
        findUniqueOrThrow: vi.fn(async ({ where }) =>
          orders.find((o) => o.id === where.id),
        ),
        findUnique: vi.fn(
          async ({ where }) => orders.find((o) => o.id === where.id) ?? null,
        ),
        findFirst: vi.fn(
          async ({ where }) =>
            orders.find(
              (o) =>
                o.id === where.id &&
                (where.userId === undefined || o.userId === where.userId),
            ) ?? null,
        ),
        updateMany: vi.fn(async ({ where, data }) => {
          const order = orders.find(
            (o) =>
              o.id === where.id &&
              (where.userId === undefined || o.userId === where.userId) &&
              o.status === where.status &&
              (where.paymentStatus?.not === undefined ||
                o.paymentStatus !== where.paymentStatus.not),
          );
          if (!order) return { count: 0 };
          Object.assign(order, data);
          return { count: 1 };
        }),
        findMany: vi.fn(async ({ where }) =>
          orders.filter((o) => o.userId === where.userId),
        ),
        count: vi.fn(
          async ({ where }) =>
            orders.filter((o) => o.userId === where.userId).length,
        ),
      },
      paymentAttempt: {
        findMany: vi.fn(async ({ where }) =>
          paymentAttempts
            .filter((attempt) => attempt.orderId === where.orderId)
            .map((attempt) => ({ ...attempt })),
        ),
        updateMany: vi.fn(async ({ where, data }) => {
          const attempt = paymentAttempts.find(
            (a) =>
              a.id === where.id &&
              (where.orderId === undefined || a.orderId === where.orderId) &&
              (where.status === undefined || a.status === where.status),
          );
          if (!attempt) return { count: 0 };
          Object.assign(attempt, data);
          return { count: 1 };
        }),
      },
      paymentEvent: {
        create: vi.fn(async ({ data }) => {
          const event = {
            id: paymentEvents.length + 1,
            ...data,
          };
          paymentEvents.push(event);
          return event;
        }),
      },
    };
    prisma = {
      $transaction: vi.fn(async (callback) => {
        const ordersBefore = orders.map((order) => ({
          ...order,
          items: [...order.items],
        }));
        const movementsBefore = [...movements];
        const attemptsBefore = paymentAttempts.map((a) => ({ ...a }));
        const eventsBefore = paymentEvents.map((e) => ({ ...e }));
        const cartItemsBefore = cartItems.map((item) => ({ ...item }));
        try {
          return await callback(tx);
        } catch (error) {
          orders = ordersBefore;
          movements = movementsBefore;
          paymentAttempts = attemptsBefore;
          paymentEvents = eventsBefore;
          cartItems = cartItemsBefore;
          throw error;
        }
      }),
      order: {
        findMany: vi.fn(async ({ where }) =>
          orders.filter(
            (o) => where.userId === undefined || o.userId === where.userId,
          ),
        ),
        count: vi.fn(
          async ({ where }) =>
            orders.filter(
              (o) => where.userId === undefined || o.userId === where.userId,
            ).length,
        ),
        findFirst: vi.fn(
          async ({ where }) =>
            orders.find(
              (o) => o.id === where.id && o.userId === where.userId,
            ) ?? null,
        ),
        findUnique: vi.fn(
          async ({ where }) => orders.find((o) => o.id === where.id) ?? null,
        ),
      },
    };
    stock = {
      consumeForOrder: vi.fn(
        async (_tx, productId, quantity, actorId, orderId) => {
          const movement = {
            productId,
            quantity: -quantity,
            quantityBefore: 20,
            quantityAfter: 20 - quantity,
            type: 'SALE',
            userId: actorId,
            orderId,
          };
          movements.push(movement);
          return movement;
        },
      ),
      restoreForOrder: vi.fn(
        async (_tx, productId, quantity, actorId, orderId) => {
          const movement = {
            productId,
            quantity,
            quantityBefore: 17,
            quantityAfter: 17 + quantity,
            type: 'CANCELLATION',
            userId: actorId,
            orderId,
          };
          movements.push(movement);
          return movement;
        },
      ),
    };
    service = new OrdersService(prisma, stock);
  });

  const dto = (items: Array<{ productId: number; quantity: number }>) => ({
    items,
    shippingName: 'Ada',
    shippingPhone: '555',
    shippingAddress: '1 Main St',
  });
  const shipping = {
    shippingName: 'Ada',
    shippingPhone: '555',
    shippingAddress: '1 Main St',
  };

  it('creates single and multi-item COD orders from database prices and product-name snapshots', async () => {
    const one = await service.create(
      7,
      dto([{ productId: 1, quantity: 2 }]) as any,
    );
    expect(one).toMatchObject({
      userId: 7,
      totalAmount: new Prisma.Decimal('5.00'),
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
    });
    expect(one.items[0]).toMatchObject({
      productName: 'Tea',
      unitPrice: new Prisma.Decimal('2.50'),
      quantity: 2,
      subtotal: new Prisma.Decimal('5.00'),
    });
    const multi = await service.create(
      7,
      dto([
        { productId: 2, quantity: 2 },
        { productId: 1, quantity: 1 },
      ]) as any,
    );
    expect(multi.totalAmount).toEqual(new Prisma.Decimal('11.00'));
    expect(multi.items.map((item: any) => item.productName)).toEqual([
      'Coffee',
      'Tea',
    ]);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, 1, 1, 7, multi.id);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, 2, 2, 7, multi.id);
  });

  it('supports manual payment selection and defaults omitted methods to COD', async () => {
    const manual = await service.create(7, {
      ...dto([{ productId: 1, quantity: 1 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    expect(manual.paymentMethod).toBe(PaymentMethod.MANUAL);
    const defaulted = await service.create(
      7,
      dto([{ productId: 1, quantity: 1 }]) as any,
    );
    expect(defaulted.paymentMethod).toBe(PaymentMethod.COD);
    await expect(
      service.create(7, {
        ...dto([{ productId: 1, quantity: 1 }]),
        paymentMethod: PaymentMethod.GATEWAY,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate, missing, inactive, empty, and invalid quantity items before writes', async () => {
    await expect(service.create(1, dto([]) as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create(
        1,
        dto([
          { productId: 1, quantity: 1 },
          { productId: 1, quantity: 2 },
        ]) as any,
      ),
    ).rejects.toThrow('duplicate');
    await expect(
      service.create(1, dto([{ productId: 99, quantity: 1 }]) as any),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    products[0].isActive = false;
    await expect(
      service.create(1, dto([{ productId: 1, quantity: 1 }]) as any),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create(1, dto([{ productId: 1, quantity: 0 }]) as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('bounds product IDs in direct service calls while allowing the PostgreSQL INT maximum', async () => {
    for (const productId of [0, -1, 2_147_483_648, 1.5]) {
      await expect(
        service.create(1, dto([{ productId, quantity: 1 }]) as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(tx.product.findMany).not.toHaveBeenCalled();

    products.push({
      id: 2_147_483_647,
      name: 'Boundary',
      price: new Prisma.Decimal('1.00'),
      isActive: true,
    });
    const order = await service.create(
      1,
      dto([{ productId: 2_147_483_647, quantity: 1 }]) as any,
    );
    expect(order.items[0].productId).toBe(2_147_483_647);
  });

  it('rolls back order and movement state when a later inventory or item write fails', async () => {
    stock.consumeForOrder.mockImplementationOnce(
      async (
        _tx: unknown,
        productId: number,
        quantity: number,
        actorId: number,
        orderId: number,
      ) => {
        movements.push({
          productId,
          quantity: -quantity,
          userId: actorId,
          orderId,
          type: 'SALE',
        });
        throw new ConflictException('insufficient stock');
      },
    );
    await expect(
      service.create(7, dto([{ productId: 1, quantity: 4 }]) as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orders).toHaveLength(0);
    expect(movements).toHaveLength(0);
    failItemCreate = true;
    await expect(
      service.create(7, dto([{ productId: 1, quantity: 1 }]) as any),
    ).rejects.toThrow('item insert failed');
    expect(orders).toHaveLength(0);
  });

  it('checks out one and multiple cart lines using one transaction client and clears after stock succeeds', async () => {
    cartItems = [{ productId: 1, quantity: 2 }];
    const single = await service.checkout(7, shipping);
    expect(single).toMatchObject({
      userId: 7,
      totalAmount: new Prisma.Decimal('5.00'),
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
    });
    expect(single.items[0]).toMatchObject({
      productName: 'Tea',
      unitPrice: new Prisma.Decimal('2.50'),
      quantity: 2,
      subtotal: new Prisma.Decimal('5.00'),
    });
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, 1, 2, 7, single.id);
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: 90 },
    });
    expect(cartItems).toHaveLength(0);

    cartItems = [
      { productId: 2, quantity: 2 },
      { productId: 1, quantity: 1 },
    ];
    const multi = await service.checkout(7, shipping);
    expect(multi.totalAmount).toEqual(new Prisma.Decimal('11.00'));
    expect(multi.items.map((item: any) => item.productName)).toEqual([
      'Coffee',
      'Tea',
    ]);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, 1, 1, 7, multi.id);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, 2, 2, 7, multi.id);
    expect(tx.cartItem.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing or empty Cart and does not create another order on a repeated checkout', async () => {
    await expect(service.checkout(7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();

    cartItems = [{ productId: 1, quantity: 1 }];
    const created = await service.checkout(7, shipping);
    expect(created.id).toBe(1);
    await expect(service.checkout(7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.order.create).toHaveBeenCalledTimes(1);

    cartItems = [];
    hasCart = false;
    await expect(service.checkout(7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unavailable Cart products and more than 50 Cart lines before order writes', async () => {
    cartItems = [{ productId: 99, quantity: 1 }];
    await expect(service.checkout(7, shipping)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();

    cartItems = [{ productId: 1, quantity: 1 }];
    products[0].isActive = false;
    await expect(service.checkout(7, shipping)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
    products[0].isActive = true;

    tx.product.findMany.mockClear();
    tx.cartItem.deleteMany.mockClear();
    cartItems = Array.from({ length: 51 }, (_, index) => ({
      productId: index + 1,
      quantity: 1,
    }));
    await expect(service.checkout(7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();

    products = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      name: `Product ${index + 1}`,
      price: new Prisma.Decimal('1.00'),
      isActive: true,
    }));
    tx.product.findMany.mockClear();
    tx.order.create.mockClear();
    tx.cartItem.deleteMany.mockClear();
    cartItems = Array.from({ length: 50 }, (_, index) => ({
      productId: index + 1,
      quantity: 1,
    }));
    const maximum = await service.checkout(7, shipping);
    expect(maximum.items).toHaveLength(50);
    expect(tx.product.findMany).toHaveBeenCalledOnce();
    expect(tx.cartItem.deleteMany).toHaveBeenCalledOnce();
  });

  it('keeps CartItems when stock consumption fails', async () => {
    cartItems = [{ productId: 1, quantity: 4 }];
    stock.consumeForOrder.mockRejectedValueOnce(
      new ConflictException('insufficient stock'),
    );
    await expect(service.checkout(7, shipping)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(cartItems).toEqual([{ productId: 1, quantity: 4 }]);
    expect(orders).toHaveLength(0);
  });

  it('does not clear CartItems when Order creation fails', async () => {
    cartItems = [{ productId: 1, quantity: 1 }];
    failItemCreate = true;
    await expect(service.checkout(7, shipping)).rejects.toThrow(
      'item insert failed',
    );
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(cartItems).toEqual([{ productId: 1, quantity: 1 }]);
    expect(stock.consumeForOrder).not.toHaveBeenCalled();
  });

  it('scopes customer order reads and counts to the authenticated owner', async () => {
    await service.create(7, dto([{ productId: 1, quantity: 1 }]) as any);
    expect(await service.listMine(8, { page: 1, limit: 20 })).toMatchObject({
      items: [],
      pagination: { total: 0 },
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 8 },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    await expect(service.findMine(8, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.findMine(7, 1)).toMatchObject({ userId: 7 });
  });

  it('1 & 7. cancels an order with no payment attempt, locks the Order row, and restores stock once', async () => {
    await service.create(7, dto([{ productId: 1, quantity: 3 }]) as any);
    const cancelled = await service.cancelMine(7, 1);
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(stock.restoreForOrder).toHaveBeenCalledOnce();
    expect(tx.paymentEvent.create).not.toHaveBeenCalled();

    await expect(service.cancelMine(7, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.updateStatus(1, { status: OrderStatus.DELIVERED } as any, 2),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stock.restoreForOrder).toHaveBeenCalledOnce();
  });

  it('2 & 5. cancels an order with a PENDING payment attempt, transitions it to CANCELLED, and creates an immutable PaymentEvent', async () => {
    await service.create(7, {
      ...dto([{ productId: 1, quantity: 2 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    paymentAttempts.push({
      id: 50,
      orderId: 1,
      status: PaymentStatus.PENDING,
      createdAt: new Date(),
    });

    const cancelled = await service.cancelMine(7, 1);
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(paymentAttempts[0]?.status).toBe(PaymentStatus.CANCELLED);
    expect(paymentEvents).toEqual([
      expect.objectContaining({
        paymentAttemptId: 50,
        eventType: ORDER_CANCELLED_PAYMENT_EVENT,
        previousStatus: PaymentStatus.PENDING,
        newStatus: PaymentStatus.CANCELLED,
        actorId: 7,
        reason: 'Order cancelled',
      }),
    ]);
    expect(stock.restoreForOrder).toHaveBeenCalledWith(tx, 1, 2, 7, 1);
  });

  it('3 & 5. cancels an order with an UNDER_REVIEW payment attempt, transitions it to CANCELLED, and records the actor in PaymentEvent', async () => {
    await service.create(7, {
      ...dto([{ productId: 2, quantity: 1 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    paymentAttempts.push({
      id: 51,
      orderId: 1,
      status: PaymentStatus.UNDER_REVIEW,
      createdAt: new Date(),
    });

    const cancelled = await service.updateStatus(
      1,
      { status: OrderStatus.CANCELLED } as any,
      99,
    );
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(paymentAttempts[0]?.status).toBe(PaymentStatus.CANCELLED);
    expect(paymentEvents).toEqual([
      expect.objectContaining({
        paymentAttemptId: 51,
        eventType: ORDER_CANCELLED_PAYMENT_EVENT,
        previousStatus: PaymentStatus.UNDER_REVIEW,
        newStatus: PaymentStatus.CANCELLED,
        actorId: 99,
        reason: 'Order cancelled',
      }),
    ]);
    expect(stock.restoreForOrder).toHaveBeenCalledWith(tx, 2, 1, 99, 1);
  });

  it('4. preserves terminal payment states (REJECTED, CANCELLED, PAID) without mutating history', async () => {
    await service.create(7, {
      ...dto([{ productId: 1, quantity: 1 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    paymentAttempts.push(
      {
        id: 60,
        orderId: 1,
        status: PaymentStatus.REJECTED,
        createdAt: new Date(),
      },
      {
        id: 61,
        orderId: 1,
        status: PaymentStatus.CANCELLED,
        createdAt: new Date(),
      },
      {
        id: 62,
        orderId: 1,
        status: PaymentStatus.UNDER_REVIEW,
        createdAt: new Date(),
      },
    );

    await service.cancelMine(7, 1);

    expect(paymentAttempts.find((a) => a.id === 60)?.status).toBe(
      PaymentStatus.REJECTED,
    );
    expect(paymentAttempts.find((a) => a.id === 61)?.status).toBe(
      PaymentStatus.CANCELLED,
    );
    expect(paymentAttempts.find((a) => a.id === 62)?.status).toBe(
      PaymentStatus.CANCELLED,
    );
    // Only the active UNDER_REVIEW attempt (62) receives a transition event
    expect(paymentEvents).toHaveLength(1);
    expect(paymentEvents[0]?.paymentAttemptId).toBe(62);
  });

  it('restores for admin cancellation through processing and rejects cancellation after shipment', async () => {
    await service.create(7, dto([{ productId: 2, quantity: 2 }]) as any);
    await service.updateStatus(1, { status: OrderStatus.CONFIRMED } as any, 2);
    await service.updateStatus(1, { status: OrderStatus.PROCESSING } as any, 2);
    const cancelled = await service.updateStatus(
      1,
      { status: OrderStatus.CANCELLED } as any,
      2,
    );
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(stock.restoreForOrder).toHaveBeenCalledWith(tx, 2, 2, 2, 1);
    await service.create(7, dto([{ productId: 1, quantity: 1 }]) as any);
    await service.updateStatus(2, { status: OrderStatus.CONFIRMED } as any, 2);
    await service.updateStatus(2, { status: OrderStatus.PROCESSING } as any, 2);
    await service.updateStatus(2, { status: OrderStatus.SHIPPED } as any, 2);
    await expect(
      service.updateStatus(2, { status: OrderStatus.CANCELLED } as any, 2),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents customer and admin cancellation of paid orders before refund support exists', async () => {
    await service.create(7, dto([{ productId: 1, quantity: 1 }]) as any);
    orders[0].paymentStatus = 'PAID';
    await expect(service.cancelMine(7, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.updateStatus(1, { status: OrderStatus.CANCELLED } as any, 2),
    ).rejects.toBeInstanceOf(ConflictException);

    // Also blocks cancellation if a PaymentAttempt has status PAID
    orders[0].paymentStatus = PaymentStatus.PENDING;
    paymentAttempts.push({
      id: 70,
      orderId: 1,
      status: PaymentStatus.PAID,
      createdAt: new Date(),
    });
    await expect(service.cancelMine(7, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(stock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('6. ensures concurrent cancellation safety via ReadCommitted locking and conditional updates', async () => {
    await service.create(7, dto([{ productId: 1, quantity: 1 }]) as any);
    paymentAttempts.push({
      id: 80,
      orderId: 1,
      status: PaymentStatus.UNDER_REVIEW,
      createdAt: new Date(),
    });

    tx.order.updateMany.mockImplementationOnce(
      async ({ where }: { where: Record<string, any> }) => {
        expect(where).toMatchObject({ paymentStatus: { not: 'PAID' } });
        return { count: 0 };
      },
    );
    await expect(
      service.updateStatus(1, { status: OrderStatus.CANCELLED } as any, 2),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stock.restoreForOrder).not.toHaveBeenCalled();
    expect(paymentEvents).toHaveLength(0);

    // If the payment attempt status changes concurrently during cancellation, abort and roll back
    tx.paymentAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.cancelMine(7, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(orders[0]?.status).toBe(OrderStatus.PENDING);
    expect(stock.restoreForOrder).not.toHaveBeenCalled();
    expect(paymentEvents).toHaveLength(0);
  });
});

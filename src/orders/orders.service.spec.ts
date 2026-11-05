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

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('OrdersService', () => {
  const P1 = uuid(1);
  const P2 = uuid(2);
  const P_MISSING = uuid(99);
  const U1 = uuid(1);
  const U2 = uuid(2);
  const U7 = uuid(7);
  const U8 = uuid(8);
  const U99 = uuid(99);
  const CART_ID = uuid(90);
  const ORDER_1 = uuid(1);
  const ORDER_2 = uuid(2);
  const ATTEMPT_50 = uuid(50);
  const ATTEMPT_51 = uuid(51);
  const ATTEMPT_60 = uuid(60);
  const ATTEMPT_61 = uuid(61);
  const ATTEMPT_62 = uuid(62);
  const ATTEMPT_70 = uuid(70);
  const ATTEMPT_80 = uuid(80);

  let service: OrdersService;
  let prisma: any;
  let tx: any;
  let stock: any;
  let products: any[];
  let orders: any[];
  let movements: any[];
  let paymentAttempts: Array<{
    id: string;
    orderId: string;
    status: PaymentStatus;
    createdAt: Date;
  }>;
  let paymentEvents: Array<{
    id: string;
    paymentAttemptId: string;
    eventType: string;
    previousStatus: PaymentStatus | null;
    newStatus: PaymentStatus;
    actorId: string | null;
    reason: string | null;
  }>;
  let cartItems: Array<{ productId: string; quantity: number }>;
  let nextId: number;
  let failItemCreate: boolean;
  let hasCart: boolean;

  beforeEach(() => {
    products = [
      {
        id: P1,
        name: 'Tea',
        price: new Prisma.Decimal('2.50'),
        isActive: true,
      },
      {
        id: P2,
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
            const orderId = values[0] as string;
            const userId = values[1] as string | undefined;
            const matched = orders.find(
              (o) =>
                o.id === orderId &&
                (userId === undefined || o.userId === userId),
            );
            return matched ? [{ id: matched.id }] : [];
          }
          return hasCart ? [{ id: CART_ID }] : [];
        },
      ),
      cartItem: {
        findMany: vi.fn(async ({ where }) =>
          cartItems
            .filter(() => where.cartId === CART_ID)
            .map((item) => ({ ...item })),
        ),
        deleteMany: vi.fn(async ({ where }) => {
          const before = cartItems.length;
          cartItems = where.cartId === CART_ID ? [] : cartItems;
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
            id: uuid(nextId++),
            items: data.items.create.map((i: any, index: number) => ({
              ...i,
              id: uuid(index + 1),
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
            id: uuid(paymentEvents.length + 1),
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

  const dto = (items: Array<{ productId: string; quantity: number }>) => ({
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
      U7,
      dto([{ productId: P1, quantity: 2 }]) as any,
    );
    expect(one).toMatchObject({
      userId: U7,
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
      U7,
      dto([
        { productId: P2, quantity: 2 },
        { productId: P1, quantity: 1 },
      ]) as any,
    );
    expect(multi.totalAmount).toEqual(new Prisma.Decimal('11.00'));
    expect(multi.items.map((item: any) => item.productName)).toEqual([
      'Coffee',
      'Tea',
    ]);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, P1, 1, U7, multi.id);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, P2, 2, U7, multi.id);
  });

  it('supports manual payment selection and defaults omitted methods to COD', async () => {
    const manual = await service.create(U7, {
      ...dto([{ productId: P1, quantity: 1 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    expect(manual.paymentMethod).toBe(PaymentMethod.MANUAL);
    const defaulted = await service.create(
      U7,
      dto([{ productId: P1, quantity: 1 }]) as any,
    );
    expect(defaulted.paymentMethod).toBe(PaymentMethod.COD);
    await expect(
      service.create(U7, {
        ...dto([{ productId: P1, quantity: 1 }]),
        paymentMethod: PaymentMethod.GATEWAY,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate, missing, inactive, empty, and invalid quantity items before writes', async () => {
    await expect(service.create(U1, dto([]) as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create(
        U1,
        dto([
          { productId: P1, quantity: 1 },
          { productId: P1, quantity: 2 },
        ]) as any,
      ),
    ).rejects.toThrow('duplicate');
    await expect(
      service.create(U1, dto([{ productId: P_MISSING, quantity: 1 }]) as any),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    products[0].isActive = false;
    await expect(
      service.create(U1, dto([{ productId: P1, quantity: 1 }]) as any),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create(U1, dto([{ productId: P1, quantity: 0 }]) as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('validates product UUIDs in direct service calls and allows valid UUID v4 strings', async () => {
    for (const productId of [
      '',
      'not-a-uuid',
      '0',
      0 as unknown as string,
      -1 as unknown as string,
      1.5 as unknown as string,
    ]) {
      await expect(
        service.create(U1, dto([{ productId, quantity: 1 }]) as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(tx.product.findMany).not.toHaveBeenCalled();

    const boundaryProductId = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    products.push({
      id: boundaryProductId,
      name: 'Boundary',
      price: new Prisma.Decimal('1.00'),
      isActive: true,
    });
    const order = await service.create(
      U1,
      dto([{ productId: boundaryProductId, quantity: 1 }]) as any,
    );
    expect(order.items[0].productId).toBe(boundaryProductId);
  });

  it('rolls back order and movement state when a later inventory or item write fails', async () => {
    stock.consumeForOrder.mockImplementationOnce(
      async (
        _tx: unknown,
        productId: string,
        quantity: number,
        actorId: string,
        orderId: string,
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
      service.create(U7, dto([{ productId: P1, quantity: 4 }]) as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orders).toHaveLength(0);
    expect(movements).toHaveLength(0);
    failItemCreate = true;
    await expect(
      service.create(U7, dto([{ productId: P1, quantity: 1 }]) as any),
    ).rejects.toThrow('item insert failed');
    expect(orders).toHaveLength(0);
  });

  it('checks out one and multiple cart lines using one transaction client and clears after stock succeeds', async () => {
    cartItems = [{ productId: P1, quantity: 2 }];
    const single = await service.checkout(U7, shipping);
    expect(single).toMatchObject({
      userId: U7,
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
    expect(stock.consumeForOrder).toHaveBeenCalledWith(
      tx,
      P1,
      2,
      U7,
      single.id,
    );
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: CART_ID },
    });
    expect(cartItems).toHaveLength(0);

    cartItems = [
      { productId: P2, quantity: 2 },
      { productId: P1, quantity: 1 },
    ];
    const multi = await service.checkout(U7, shipping);
    expect(multi.totalAmount).toEqual(new Prisma.Decimal('11.00'));
    expect(multi.items.map((item: any) => item.productName)).toEqual([
      'Coffee',
      'Tea',
    ]);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, P1, 1, U7, multi.id);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, P2, 2, U7, multi.id);
    expect(tx.cartItem.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing or empty Cart and does not create another order on a repeated checkout', async () => {
    await expect(service.checkout(U7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();

    cartItems = [{ productId: P1, quantity: 1 }];
    const created = await service.checkout(U7, shipping);
    expect(created.id).toBe(ORDER_1);
    await expect(service.checkout(U7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.order.create).toHaveBeenCalledTimes(1);

    cartItems = [];
    hasCart = false;
    await expect(service.checkout(U7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unavailable Cart products and more than 50 Cart lines before order writes', async () => {
    cartItems = [{ productId: P_MISSING, quantity: 1 }];
    await expect(service.checkout(U7, shipping)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();

    cartItems = [{ productId: P1, quantity: 1 }];
    products[0].isActive = false;
    await expect(service.checkout(U7, shipping)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
    products[0].isActive = true;

    tx.product.findMany.mockClear();
    tx.cartItem.deleteMany.mockClear();
    cartItems = Array.from({ length: 51 }, (_, index) => ({
      productId: uuid(index + 1),
      quantity: 1,
    }));
    await expect(service.checkout(U7, shipping)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();

    products = Array.from({ length: 50 }, (_, index) => ({
      id: uuid(index + 1),
      name: `Product ${index + 1}`,
      price: new Prisma.Decimal('1.00'),
      isActive: true,
    }));
    tx.product.findMany.mockClear();
    tx.order.create.mockClear();
    tx.cartItem.deleteMany.mockClear();
    cartItems = Array.from({ length: 50 }, (_, index) => ({
      productId: uuid(index + 1),
      quantity: 1,
    }));
    const maximum = await service.checkout(U7, shipping);
    expect(maximum.items).toHaveLength(50);
    expect(tx.product.findMany).toHaveBeenCalledOnce();
    expect(tx.cartItem.deleteMany).toHaveBeenCalledOnce();
  });

  it('keeps CartItems when stock consumption fails', async () => {
    cartItems = [{ productId: P1, quantity: 4 }];
    stock.consumeForOrder.mockRejectedValueOnce(
      new ConflictException('insufficient stock'),
    );
    await expect(service.checkout(U7, shipping)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(cartItems).toEqual([{ productId: P1, quantity: 4 }]);
    expect(orders).toHaveLength(0);
  });

  it('does not clear CartItems when Order creation fails', async () => {
    cartItems = [{ productId: P1, quantity: 1 }];
    failItemCreate = true;
    await expect(service.checkout(U7, shipping)).rejects.toThrow(
      'item insert failed',
    );
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(cartItems).toEqual([{ productId: P1, quantity: 1 }]);
    expect(stock.consumeForOrder).not.toHaveBeenCalled();
  });

  it('scopes customer order reads and counts to the authenticated owner', async () => {
    await service.create(U7, dto([{ productId: P1, quantity: 1 }]) as any);
    expect(await service.listMine(U8, { page: 1, limit: 20 })).toMatchObject({
      items: [],
      pagination: { total: 0 },
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: U8 },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    await expect(service.findMine(U8, ORDER_1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.findMine(U7, ORDER_1)).toMatchObject({ userId: U7 });
  });

  it('1 & 7. cancels an order with no payment attempt, locks the Order row, and restores stock once', async () => {
    await service.create(U7, dto([{ productId: P1, quantity: 3 }]) as any);
    const cancelled = await service.cancelMine(U7, ORDER_1);
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(stock.restoreForOrder).toHaveBeenCalledOnce();
    expect(tx.paymentEvent.create).not.toHaveBeenCalled();

    await expect(service.cancelMine(U7, ORDER_1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.updateStatus(ORDER_1, { status: OrderStatus.DELIVERED } as any, U2),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stock.restoreForOrder).toHaveBeenCalledOnce();
  });

  it('2 & 5. cancels an order with a PENDING payment attempt, transitions it to CANCELLED, and creates an immutable PaymentEvent', async () => {
    await service.create(U7, {
      ...dto([{ productId: P1, quantity: 2 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    paymentAttempts.push({
      id: ATTEMPT_50,
      orderId: ORDER_1,
      status: PaymentStatus.PENDING,
      createdAt: new Date(),
    });

    const cancelled = await service.cancelMine(U7, ORDER_1);
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(paymentAttempts[0]?.status).toBe(PaymentStatus.CANCELLED);
    expect(paymentEvents).toEqual([
      expect.objectContaining({
        paymentAttemptId: ATTEMPT_50,
        eventType: ORDER_CANCELLED_PAYMENT_EVENT,
        previousStatus: PaymentStatus.PENDING,
        newStatus: PaymentStatus.CANCELLED,
        actorId: U7,
        reason: 'Order cancelled',
      }),
    ]);
    expect(stock.restoreForOrder).toHaveBeenCalledWith(tx, P1, 2, U7, ORDER_1);
  });

  it('3 & 5. cancels an order with an UNDER_REVIEW payment attempt, transitions it to CANCELLED, and records the actor in PaymentEvent', async () => {
    await service.create(U7, {
      ...dto([{ productId: P2, quantity: 1 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    paymentAttempts.push({
      id: ATTEMPT_51,
      orderId: ORDER_1,
      status: PaymentStatus.UNDER_REVIEW,
      createdAt: new Date(),
    });

    const cancelled = await service.updateStatus(
      ORDER_1,
      { status: OrderStatus.CANCELLED } as any,
      U99,
    );
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(paymentAttempts[0]?.status).toBe(PaymentStatus.CANCELLED);
    expect(paymentEvents).toEqual([
      expect.objectContaining({
        paymentAttemptId: ATTEMPT_51,
        eventType: ORDER_CANCELLED_PAYMENT_EVENT,
        previousStatus: PaymentStatus.UNDER_REVIEW,
        newStatus: PaymentStatus.CANCELLED,
        actorId: U99,
        reason: 'Order cancelled',
      }),
    ]);
    expect(stock.restoreForOrder).toHaveBeenCalledWith(tx, P2, 1, U99, ORDER_1);
  });

  it('4. preserves terminal payment states (REJECTED, CANCELLED, PAID) without mutating history', async () => {
    await service.create(U7, {
      ...dto([{ productId: P1, quantity: 1 }]),
      paymentMethod: PaymentMethod.MANUAL,
    } as any);
    paymentAttempts.push(
      {
        id: ATTEMPT_60,
        orderId: ORDER_1,
        status: PaymentStatus.REJECTED,
        createdAt: new Date(),
      },
      {
        id: ATTEMPT_61,
        orderId: ORDER_1,
        status: PaymentStatus.CANCELLED,
        createdAt: new Date(),
      },
      {
        id: ATTEMPT_62,
        orderId: ORDER_1,
        status: PaymentStatus.UNDER_REVIEW,
        createdAt: new Date(),
      },
    );

    await service.cancelMine(U7, ORDER_1);

    expect(paymentAttempts.find((a) => a.id === ATTEMPT_60)?.status).toBe(
      PaymentStatus.REJECTED,
    );
    expect(paymentAttempts.find((a) => a.id === ATTEMPT_61)?.status).toBe(
      PaymentStatus.CANCELLED,
    );
    expect(paymentAttempts.find((a) => a.id === ATTEMPT_62)?.status).toBe(
      PaymentStatus.CANCELLED,
    );
    // Only the active UNDER_REVIEW attempt (62) receives a transition event
    expect(paymentEvents).toHaveLength(1);
    expect(paymentEvents[0]?.paymentAttemptId).toBe(ATTEMPT_62);
  });

  it('restores for admin cancellation through processing and rejects cancellation after shipment', async () => {
    await service.create(U7, dto([{ productId: P2, quantity: 2 }]) as any);
    await service.updateStatus(
      ORDER_1,
      { status: OrderStatus.CONFIRMED } as any,
      U2,
    );
    await service.updateStatus(
      ORDER_1,
      { status: OrderStatus.PROCESSING } as any,
      U2,
    );
    const cancelled = await service.updateStatus(
      ORDER_1,
      { status: OrderStatus.CANCELLED } as any,
      U2,
    );
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(stock.restoreForOrder).toHaveBeenCalledWith(tx, P2, 2, U2, ORDER_1);
    await service.create(U7, dto([{ productId: P1, quantity: 1 }]) as any);
    await service.updateStatus(
      ORDER_2,
      { status: OrderStatus.CONFIRMED } as any,
      U2,
    );
    await service.updateStatus(
      ORDER_2,
      { status: OrderStatus.PROCESSING } as any,
      U2,
    );
    await service.updateStatus(
      ORDER_2,
      { status: OrderStatus.SHIPPED } as any,
      U2,
    );
    await expect(
      service.updateStatus(
        ORDER_2,
        { status: OrderStatus.CANCELLED } as any,
        U2,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents customer and admin cancellation of paid orders before refund support exists', async () => {
    await service.create(U7, dto([{ productId: P1, quantity: 1 }]) as any);
    orders[0].paymentStatus = 'PAID';
    await expect(service.cancelMine(U7, ORDER_1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.updateStatus(
        ORDER_1,
        { status: OrderStatus.CANCELLED } as any,
        U2,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // Also blocks cancellation if a PaymentAttempt has status PAID
    orders[0].paymentStatus = PaymentStatus.PENDING;
    paymentAttempts.push({
      id: ATTEMPT_70,
      orderId: ORDER_1,
      status: PaymentStatus.PAID,
      createdAt: new Date(),
    });
    await expect(service.cancelMine(U7, ORDER_1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(stock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('6. ensures concurrent cancellation safety via ReadCommitted locking and conditional updates', async () => {
    await service.create(U7, dto([{ productId: P1, quantity: 1 }]) as any);
    paymentAttempts.push({
      id: ATTEMPT_80,
      orderId: ORDER_1,
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
      service.updateStatus(
        ORDER_1,
        { status: OrderStatus.CANCELLED } as any,
        U2,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stock.restoreForOrder).not.toHaveBeenCalled();
    expect(paymentEvents).toHaveLength(0);

    // If the payment attempt status changes concurrently during cancellation, abort and roll back
    tx.paymentAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.cancelMine(U7, ORDER_1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(orders[0]?.status).toBe(OrderStatus.PENDING);
    expect(stock.restoreForOrder).not.toHaveBeenCalled();
    expect(paymentEvents).toHaveLength(0);
  });
});

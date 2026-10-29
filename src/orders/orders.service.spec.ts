import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OrderStatus, Prisma } from '../generated/prisma/client.js';
import { OrdersService } from './orders.service.js';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;
  let tx: any;
  let stock: any;
  let products: any[];
  let orders: any[];
  let movements: any[];
  let nextId: number;
  let failItemCreate: boolean;

  beforeEach(() => {
    products = [
      { id: 1, name: 'Tea', price: new Prisma.Decimal('2.50'), isActive: true },
      { id: 2, name: 'Coffee', price: new Prisma.Decimal('4.25'), isActive: true },
    ];
    orders = [];
    movements = [];
    nextId = 1;
    failItemCreate = false;
    tx = {
      product: { findMany: vi.fn(async ({ where }) => products.filter((p) => where.id.in.includes(p.id) && p.isActive)) },
      order: {
        create: vi.fn(async ({ data }) => {
          if (failItemCreate) throw new Error('item insert failed');
          const order = { ...data, id: nextId++, items: data.items.create.map((i: any, index: number) => ({ ...i, id: index + 1 })), createdAt: new Date(), updatedAt: new Date() };
          orders.push(order);
          return { id: order.id };
        }),
        findUniqueOrThrow: vi.fn(async ({ where }) => orders.find((o) => o.id === where.id)),
        findUnique: vi.fn(async ({ where }) => orders.find((o) => o.id === where.id) ?? null),
        findFirst: vi.fn(async ({ where }) => orders.find((o) => o.id === where.id && (where.userId === undefined || o.userId === where.userId)) ?? null),
        updateMany: vi.fn(async ({ where, data }) => {
          const order = orders.find((o) => o.id === where.id && (where.userId === undefined || o.userId === where.userId) && o.status === where.status);
          if (!order) return { count: 0 };
          order.status = data.status;
          return { count: 1 };
        }),
        findMany: vi.fn(async ({ where }) => orders.filter((o) => o.userId === where.userId)),
        count: vi.fn(async ({ where }) => orders.filter((o) => o.userId === where.userId).length),
      },
    };
    prisma = {
      $transaction: vi.fn(async (callback) => {
        const ordersBefore = orders.map((order) => ({ ...order, items: [...order.items] }));
        const movementsBefore = [...movements];
        try { return await callback(tx); }
        catch (error) { orders = ordersBefore; movements = movementsBefore; throw error; }
      }),
      order: {
        findMany: vi.fn(async ({ where }) => orders.filter((o) => where.userId === undefined || o.userId === where.userId)),
        count: vi.fn(async ({ where }) => orders.filter((o) => where.userId === undefined || o.userId === where.userId).length),
        findFirst: vi.fn(async ({ where }) => orders.find((o) => o.id === where.id && o.userId === where.userId) ?? null),
        findUnique: vi.fn(async ({ where }) => orders.find((o) => o.id === where.id) ?? null),
      },
    };
    stock = {
      consumeForOrder: vi.fn(async (_tx, productId, quantity, actorId, orderId) => {
        const movement = { productId, quantity: -quantity, quantityBefore: 20, quantityAfter: 20 - quantity, type: 'SALE', userId: actorId, orderId };
        movements.push(movement);
        return movement;
      }),
      restoreForOrder: vi.fn(async (_tx, productId, quantity, actorId, orderId) => {
        const movement = { productId, quantity, quantityBefore: 17, quantityAfter: 17 + quantity, type: 'CANCELLATION', userId: actorId, orderId };
        movements.push(movement);
        return movement;
      }),
    };
    service = new OrdersService(prisma, stock);
  });

  const dto = (items: Array<{ productId: number; quantity: number }>) => ({
    items, shippingName: 'Ada', shippingPhone: '555', shippingAddress: '1 Main St',
  });

  it('creates single and multi-item COD orders from database prices and product-name snapshots', async () => {
    const one = await service.create(7, dto([{ productId: 1, quantity: 2 }]) as any);
    expect(one).toMatchObject({ userId: 7, totalAmount: new Prisma.Decimal('5.00'), status: 'PENDING', paymentMethod: 'COD', paymentStatus: 'PENDING' });
    expect(one.items[0]).toMatchObject({ productName: 'Tea', unitPrice: new Prisma.Decimal('2.50'), quantity: 2, subtotal: new Prisma.Decimal('5.00') });
    const multi = await service.create(7, dto([{ productId: 2, quantity: 2 }, { productId: 1, quantity: 1 }]) as any);
    expect(multi.totalAmount).toEqual(new Prisma.Decimal('11.00'));
    expect(multi.items.map((item: any) => item.productName)).toEqual(['Coffee', 'Tea']);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, 1, 1, 7, multi.id);
    expect(stock.consumeForOrder).toHaveBeenCalledWith(tx, 2, 2, 7, multi.id);
  });

  it('rejects duplicate, missing, inactive, empty, and invalid quantity items before writes', async () => {
    await expect(service.create(1, dto([]) as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(1, dto([{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }]) as any)).rejects.toThrow('duplicate');
    await expect(service.create(1, dto([{ productId: 99, quantity: 1 }]) as any)).rejects.toBeInstanceOf(UnprocessableEntityException);
    products[0].isActive = false;
    await expect(service.create(1, dto([{ productId: 1, quantity: 1 }]) as any)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.create(1, dto([{ productId: 1, quantity: 0 }]) as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('bounds product IDs in direct service calls while allowing the PostgreSQL INT maximum', async () => {
    for (const productId of [0, -1, 2_147_483_648, 1.5]) {
      await expect(service.create(1, dto([{ productId, quantity: 1 }]) as any))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    expect(tx.product.findMany).not.toHaveBeenCalled();

    products.push({ id: 2_147_483_647, name: 'Boundary', price: new Prisma.Decimal('1.00'), isActive: true });
    const order = await service.create(1, dto([{ productId: 2_147_483_647, quantity: 1 }]) as any);
    expect(order.items[0].productId).toBe(2_147_483_647);
  });

  it('rolls back order and movement state when a later inventory or item write fails', async () => {
    stock.consumeForOrder.mockImplementationOnce(async (_tx: unknown, productId: number, quantity: number, actorId: number, orderId: number) => {
      movements.push({ productId, quantity: -quantity, userId: actorId, orderId, type: 'SALE' });
      throw new ConflictException('insufficient stock');
    });
    await expect(service.create(7, dto([{ productId: 1, quantity: 4 }]) as any)).rejects.toBeInstanceOf(ConflictException);
    expect(orders).toHaveLength(0);
    expect(movements).toHaveLength(0);
    failItemCreate = true;
    await expect(service.create(7, dto([{ productId: 1, quantity: 1 }]) as any)).rejects.toThrow('item insert failed');
    expect(orders).toHaveLength(0);
  });

  it('scopes customer order reads and counts to the authenticated owner', async () => {
    await service.create(7, dto([{ productId: 1, quantity: 1 }]) as any);
    expect(await service.listMine(8, { page: 1, limit: 20 })).toMatchObject({ items: [], pagination: { total: 0 } });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 8 }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
    await expect(service.findMine(8, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.findMine(7, 1)).toMatchObject({ userId: 7 });
  });

  it('allows only lifecycle transitions and restores stock once on owner cancellation', async () => {
    await service.create(7, dto([{ productId: 1, quantity: 3 }]) as any);
    const cancelled = await service.cancelMine(7, 1);
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(stock.restoreForOrder).toHaveBeenCalledOnce();
    await expect(service.cancelMine(7, 1)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateStatus(1, { status: OrderStatus.DELIVERED } as any, 2)).rejects.toBeInstanceOf(ConflictException);
    expect(stock.restoreForOrder).toHaveBeenCalledOnce();
  });

  it('restores for admin cancellation through processing and rejects cancellation after shipment', async () => {
    await service.create(7, dto([{ productId: 2, quantity: 2 }]) as any);
    await service.updateStatus(1, { status: OrderStatus.CONFIRMED } as any, 2);
    await service.updateStatus(1, { status: OrderStatus.PROCESSING } as any, 2);
    const cancelled = await service.updateStatus(1, { status: OrderStatus.CANCELLED } as any, 2);
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(stock.restoreForOrder).toHaveBeenCalledWith(tx, 2, 2, 2, 1);
    await service.create(7, dto([{ productId: 1, quantity: 1 }]) as any);
    await service.updateStatus(2, { status: OrderStatus.CONFIRMED } as any, 2);
    await service.updateStatus(2, { status: OrderStatus.PROCESSING } as any, 2);
    await service.updateStatus(2, { status: OrderStatus.SHIPPED } as any, 2);
    await expect(service.updateStatus(2, { status: OrderStatus.CANCELLED } as any, 2)).rejects.toBeInstanceOf(ConflictException);
  });
});

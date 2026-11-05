import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdjustStockDto } from './dto/adjust-stock.dto.js';
import { StockService } from './stock.service.js';

describe('StockService', () => {
  const PRODUCT_ID = '00000000-0000-4000-8000-000000000005';
  const MISSING_PRODUCT_ID = '00000000-0000-4000-8000-000000000999';
  const ACTOR_ID = '00000000-0000-4000-8000-000000000008';

  let service: StockService;
  let prisma: any;
  let tx: any;
  let quantity: number | null;
  let movements: any[];
  let productExists: boolean;
  let productActive: boolean;
  let failMovement: boolean;

  beforeEach(() => {
    quantity = null;
    movements = [];
    productExists = true;
    productActive = true;
    failMovement = false;
    tx = {
      product: {
        findUnique: vi.fn(async () =>
          productExists
            ? {
                id: PRODUCT_ID,
                stock: quantity === null ? null : { productId: PRODUCT_ID },
              }
            : null,
        ),
      },
      stock: {
        create: vi.fn(async ({ data }) => {
          if (quantity !== null) throw { code: 'P2002' };
          quantity = data.quantity;
          return { ...data, createdAt: new Date(), updatedAt: new Date() };
        }),
      },
      stockMovement: {
        create: vi.fn(async ({ data }) => {
          if (failMovement) throw new Error('movement insert failed');
          const movement = {
            id: `00000000-0000-4000-8000-${String(movements.length + 1).padStart(12, '0')}`,
            ...data,
            createdAt: new Date(),
          };
          movements.push(movement);
          return movement;
        }),
      },
      $queryRaw: vi.fn(
        async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          const change = values[0] as number;
          if (
            quantity === null ||
            quantity + change < 0 ||
            quantity + change > 2_147_483_647
          )
            return [];
          const quantityBefore = quantity;
          quantity += change;
          return [{ quantity, quantityBefore }];
        },
      ),
    };
    prisma = {
      $transaction: vi.fn(async (callback) => {
        const oldQuantity = quantity;
        const oldMovements = [...movements];
        try {
          return await callback(tx);
        } catch (error) {
          quantity = oldQuantity;
          movements = oldMovements;
          throw error;
        }
      }),
      product: {
        findFirst: vi.fn(async () =>
          productExists && productActive
            ? {
                stock:
                  quantity === null
                    ? null
                    : {
                        productId: PRODUCT_ID,
                        quantity,
                        reservedQuantity: 0,
                        updatedAt: new Date(),
                      },
              }
            : null,
        ),
        findUnique: vi.fn(async () =>
          productExists ? { id: PRODUCT_ID } : null,
        ),
      },
      stock: { findUnique: vi.fn() },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000001',
            quantity: 12,
            quantityBefore: 0,
            quantityAfter: 12,
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    };
    service = new StockService(prisma as PrismaService);
  });

  it('initializes an existing product and records its initial movement atomically', async () => {
    const stock = await service.initialize(
      PRODUCT_ID,
      { quantity: 12 },
      ACTOR_ID,
    );
    expect(stock).toMatchObject({ productId: PRODUCT_ID, quantity: 12 });
    expect(movements[0]).toMatchObject({
      type: 'INITIALIZATION',
      quantity: 12,
      quantityBefore: 0,
      quantityAfter: 12,
      userId: ACTOR_ID,
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('permits zero initial quantity and rejects duplicate initialization', async () => {
    await service.initialize(PRODUCT_ID, { quantity: 0 }, ACTOR_ID);
    expect(movements[0]).toMatchObject({
      quantity: 0,
      quantityBefore: 0,
      quantityAfter: 0,
    });
    await expect(
      service.initialize(PRODUCT_ID, { quantity: 2 }, ACTOR_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(movements).toHaveLength(1);
  });

  it('returns not found when initializing stock for an unknown product', async () => {
    productExists = false;
    await expect(
      service.initialize(MISSING_PRODUCT_ID, { quantity: 2 }, ACTOR_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.stock.create).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('applies signed increases and decreases with before/change/after audit values', async () => {
    quantity = 10;
    const increase: AdjustStockDto = { quantityChange: 5, reason: 'RESTOCK' };
    const increased = await service.adjust(PRODUCT_ID, increase, ACTOR_ID);
    expect(increased.stock.quantity).toBe(15);
    expect(movements[0]).toMatchObject({
      quantity: 5,
      quantityBefore: 10,
      quantityAfter: 15,
      type: 'RESTOCK',
      userId: ACTOR_ID,
    });

    const decrease: AdjustStockDto = { quantityChange: -4, reason: 'SALE' };
    const decreased = await service.adjust(PRODUCT_ID, decrease, ACTOR_ID);
    expect(decreased.stock.quantity).toBe(11);
    expect(movements[1]).toMatchObject({
      quantity: -4,
      quantityBefore: 15,
      quantityAfter: 11,
      type: 'SALE',
    });
    const decreaseQuery = tx.$queryRaw.mock.calls[1];
    expect(decreaseQuery[1]).toBe(-4);
    expect(decreaseQuery[4]).toBe(2_147_483_647);
    expect(decreaseQuery[4]).toBeLessThanOrEqual(2_147_483_647);
  });

  it('rejects insufficient stock and rolls back quantity if movement insertion fails', async () => {
    quantity = 3;
    await expect(
      service.adjust(PRODUCT_ID, { quantityChange: -4, reason: 'SALE' }, ACTOR_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(quantity).toBe(3);
    expect(movements).toHaveLength(0);

    failMovement = true;
    await expect(
      service.adjust(
        PRODUCT_ID,
        { quantityChange: 2, reason: 'RESTOCK' },
        ACTOR_ID,
      ),
    ).rejects.toThrow('movement insert failed');
    expect(quantity).toBe(3);
    expect(movements).toHaveLength(0);
  });

  it('rolls back initialization if its initial movement cannot be recorded', async () => {
    failMovement = true;
    await expect(
      service.initialize(PRODUCT_ID, { quantity: 12 }, ACTOR_ID),
    ).rejects.toThrow('movement insert failed');
    expect(quantity).toBeNull();
    expect(movements).toHaveLength(0);
  });

  it('returns stock and stable, paginated movement history without full user records', async () => {
    quantity = 9;
    expect(await service.getStock(PRODUCT_ID)).toMatchObject({
      productId: PRODUCT_ID,
      quantity: 9,
      availableQuantity: 9,
    });
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, isActive: true },
      select: {
        stock: {
          select: {
            productId: true,
            quantity: true,
            reservedQuantity: true,
            updatedAt: true,
          },
        },
      },
    });
    expect(prisma.stock.findUnique).not.toHaveBeenCalled();
    const history = await service.getMovements(PRODUCT_ID, {
      page: 2,
      limit: 10,
    });
    expect(history.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: PRODUCT_ID },
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: expect.objectContaining({
          user: { select: { id: true, name: true } },
        }),
      }),
    );
    expect(await service.getStock(PRODUCT_ID)).not.toHaveProperty(
      'reservedQuantity',
    );
  });

  it('does not return stock for inactive or missing products and preserves the not-found distinction', async () => {
    quantity = 9;
    productActive = false;
    await expect(service.getStock(PRODUCT_ID)).rejects.toThrow(
      'Product not found.',
    );
    expect(prisma.stock.findUnique).not.toHaveBeenCalled();

    productActive = true;
    quantity = null;
    await expect(service.getStock(PRODUCT_ID)).rejects.toThrow(
      'Stock has not been initialized for this product.',
    );
    productExists = false;
    await expect(service.getStock(PRODUCT_ID)).rejects.toThrow(
      'Product not found.',
    );
  });
});

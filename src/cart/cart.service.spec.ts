import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { CartService } from './cart.service.js';

describe('CartService', () => {
  const USER_ID = '00000000-0000-4000-8000-000000000002';
  const CART_ID = '00000000-0000-4000-8000-000000000003';
  const PRODUCT_ID = '00000000-0000-4000-8000-000000000007';
  const OTHER_PRODUCT_ID = '00000000-0000-4000-8000-000000000001';

  let service: CartService;
  let prisma: any;
  let tx: any;
  let cartItems: Array<{ productId: string; quantity: number }>;
  const product = {
    id: PRODUCT_ID,
    isActive: true,
    name: 'Tea',
    slug: 'tea',
    imageUrl: null,
    price: new Prisma.Decimal('0.10'),
  };

  beforeEach(() => {
    cartItems = [];
    tx = {
      product: { findUnique: vi.fn(async () => product) },
      $queryRaw: vi.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings[0].includes('SELECT "id" FROM "Cart"'))
            return [{ id: CART_ID }];
          if (strings[0].includes('INSERT INTO "Cart"'))
            return [{ id: CART_ID }];
          const [, productId, quantity] = values as [string, string, number];
          const row = cartItems.find((item) => item.productId === productId);
          if (row) {
            if (row.quantity > 2_147_483_647 - quantity) return [];
            row.quantity += quantity;
          } else cartItems.push({ productId, quantity });
          return [{ id: '00000000-0000-4000-8000-000000000001' }];
        },
      ),
      cartItem: {
        updateMany: vi.fn(async ({ where, data }) => {
          const item = cartItems.find(
            (entry) => entry.productId === where.productId,
          );
          if (!item) return { count: 0 };
          item.quantity = data.quantity;
          return { count: 1 };
        }),
        deleteMany: vi.fn(async ({ where }) => {
          const before = cartItems.length;
          cartItems =
            where.productId === undefined
              ? []
              : cartItems.filter((item) => item.productId !== where.productId);
          return { count: before - cartItems.length };
        }),
      },
    };
    prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      cart: {
        findUnique: vi.fn(async ({ select }) => {
          if (select?.id) return { id: CART_ID };
          return cartItems.length
            ? { items: cartItems.map((item) => ({ ...item, product })) }
            : null;
        }),
      },
    };
    service = new CartService(prisma);
  });

  it('returns an empty cart without creating one', async () => {
    expect(await service.getCart(USER_ID)).toEqual({
      items: [],
      subtotal: new Prisma.Decimal(0),
    });
    expect(prisma.cart.findUnique).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates a cart on first add and atomically increments a repeated product', async () => {
    const first = await service.addItem(USER_ID, {
      productId: PRODUCT_ID,
      quantity: 2,
    });
    const second = await service.addItem(USER_ID, {
      productId: PRODUCT_ID,
      quantity: 3,
    });
    expect(first.items[0].quantity).toBe(2);
    expect(second.items[0].quantity).toBe(5);
    expect(second.items[0].lineSubtotal.toString()).toBe('0.5');
    expect(second.subtotal.toString()).toBe('0.5');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(
      tx.$queryRaw.mock.calls.filter(([strings]: [TemplateStringsArray]) =>
        strings[0].includes('INSERT INTO "Cart"'),
      ),
    ).toHaveLength(2);
    expect(prisma.stock).toBeUndefined();
  });

  it('sets exact quantity, removes an owned item, and clears while retaining Cart', async () => {
    await service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 2 });
    expect(
      (await service.updateItem(USER_ID, PRODUCT_ID, { quantity: 9 })).items[0]
        .quantity,
    ).toBe(9);
    expect((await service.removeItem(USER_ID, PRODUCT_ID)).items).toEqual([]);
    await service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 1 });
    expect(await service.clearCart(USER_ID)).toEqual({
      items: [],
      subtotal: new Prisma.Decimal(0),
    });
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: CART_ID },
    });
    expect(tx.cartItem.updateMany).toHaveBeenCalledWith({
      where: { cartId: CART_ID, productId: PRODUCT_ID },
      data: { quantity: 9 },
    });
    expect(
      tx.$queryRaw.mock.calls.filter(([strings]: [TemplateStringsArray]) =>
        strings.join('?').includes('FOR UPDATE'),
      ),
    ).toHaveLength(3);
  });

  it('retains inactive existing lines but rejects adding unavailable products', async () => {
    await service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 1 });
    prisma.cart.findUnique.mockImplementationOnce(async () => ({
      items: [{ ...cartItems[0], product: { ...product, isActive: false } }],
    }));
    expect((await service.getCart(USER_ID)).items[0].isActive).toBe(false);
    tx.product.findUnique.mockResolvedValueOnce({
      id: PRODUCT_ID,
      isActive: false,
    });
    await expect(
      service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 1 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects missing owned items and quantity overflow', async () => {
    await expect(
      service.updateItem(USER_ID, PRODUCT_ID, { quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    cartItems.push({ productId: PRODUCT_ID, quantity: 2_147_483_647 });
    await expect(
      service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates service inputs before database access', async () => {
    for (const productId of [
      '',
      'not-a-uuid',
      '0',
      0 as unknown as string,
      -1 as unknown as string,
      1.5 as unknown as string,
    ]) {
      await expect(
        service.addItem(USER_ID, { productId, quantity: 1 }),
      ).rejects.toThrow();
    }
    await expect(
      service.addItem(USER_ID, { productId: OTHER_PRODUCT_ID, quantity: 0 }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { CartService } from './cart.service.js';

describe('CartService', () => {
  let service: CartService;
  let prisma: any;
  let tx: any;
  let cartItems: Array<{ productId: number; quantity: number }>;
  const product = { id: 7, isActive: true, name: 'Tea', slug: 'tea', imageUrl: null, price: new Prisma.Decimal('0.10') };

  beforeEach(() => {
    cartItems = [];
    tx = {
      product: { findUnique: vi.fn(async () => product) },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings[0].includes('SELECT "id" FROM "Cart"')) return [{ id: 3 }];
        if (strings[0].includes('INSERT INTO "Cart"')) return [{ id: 3 }];
        const [, productId, quantity] = values as number[];
        const row = cartItems.find((item) => item.productId === productId);
        if (row) {
          if (row.quantity > 2_147_483_647 - quantity) return [];
          row.quantity += quantity;
        } else cartItems.push({ productId, quantity });
        return [{ id: 1 }];
      }),
      cartItem: {
        updateMany: vi.fn(async ({ where, data }) => {
          const item = cartItems.find((entry) => entry.productId === where.productId);
          if (!item) return { count: 0 };
          item.quantity = data.quantity;
          return { count: 1 };
        }),
        deleteMany: vi.fn(async ({ where }) => {
          const before = cartItems.length;
          cartItems = where.productId === undefined ? [] : cartItems.filter((item) => item.productId !== where.productId);
          return { count: before - cartItems.length };
        }),
      },
    };
    prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      cart: {
        findUnique: vi.fn(async ({ select }) => {
          if (select?.id) return { id: 3 };
          return cartItems.length ? { items: cartItems.map((item) => ({ ...item, product })) } : null;
        }),
      },
    };
    service = new CartService(prisma);
  });

  it('returns an empty cart without creating one', async () => {
    expect(await service.getCart(2)).toEqual({ items: [], subtotal: new Prisma.Decimal(0) });
    expect(prisma.cart.findUnique).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates a cart on first add and atomically increments a repeated product', async () => {
    const first = await service.addItem(2, { productId: 7, quantity: 2 });
    const second = await service.addItem(2, { productId: 7, quantity: 3 });
    expect(first.items[0].quantity).toBe(2);
    expect(second.items[0].quantity).toBe(5);
    expect(second.items[0].lineSubtotal.toString()).toBe('0.5');
    expect(second.subtotal.toString()).toBe('0.5');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.$queryRaw.mock.calls.filter(([strings]: [TemplateStringsArray]) => strings[0].includes('INSERT INTO "Cart"'))).toHaveLength(2);
    expect(prisma.stock).toBeUndefined();
  });

  it('sets exact quantity, removes an owned item, and clears while retaining Cart', async () => {
    await service.addItem(2, { productId: 7, quantity: 2 });
    expect((await service.updateItem(2, 7, { quantity: 9 })).items[0].quantity).toBe(9);
    expect((await service.removeItem(2, 7)).items).toEqual([]);
    await service.addItem(2, { productId: 7, quantity: 1 });
    expect(await service.clearCart(2)).toEqual({ items: [], subtotal: new Prisma.Decimal(0) });
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 3 } });
    expect(tx.cartItem.updateMany).toHaveBeenCalledWith({ where: { cartId: 3, productId: 7 }, data: { quantity: 9 } });
    expect(tx.$queryRaw.mock.calls.filter(([strings]: [TemplateStringsArray]) => strings.join('?').includes('FOR UPDATE'))).toHaveLength(3);
  });

  it('retains inactive existing lines but rejects adding unavailable products', async () => {
    await service.addItem(2, { productId: 7, quantity: 1 });
    prisma.cart.findUnique.mockImplementationOnce(async () => ({ items: [{ ...cartItems[0], product: { ...product, isActive: false } }] }));
    expect((await service.getCart(2)).items[0].isActive).toBe(false);
    tx.product.findUnique.mockResolvedValueOnce({ id: 7, isActive: false });
    await expect(service.addItem(2, { productId: 7, quantity: 1 })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects missing owned items and quantity overflow', async () => {
    await expect(service.updateItem(2, 7, { quantity: 1 })).rejects.toBeInstanceOf(NotFoundException);
    cartItems.push({ productId: 7, quantity: 2_147_483_647 });
    await expect(service.addItem(2, { productId: 7, quantity: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates service inputs before database access', async () => {
    for (const productId of [0, -1, 2_147_483_648, 1.5]) {
      await expect(service.addItem(2, { productId, quantity: 1 })).rejects.toThrow();
    }
    await expect(service.addItem(2, { productId: 1, quantity: 0 })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

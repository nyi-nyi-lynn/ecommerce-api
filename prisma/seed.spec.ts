import {
  PrismaClient,
  StockMovementType,
} from '../src/generated/prisma/client.js';
import { seedData } from './seed.js';

type MemoryState = {
  roles: Map<string, { id: number; name: string }>;
  permissions: Map<string, { id: number; code: string }>;
  rolePermissionLinks: Set<string>;
  users: Map<
    string,
    { id: number; email: string; roleName: string; passwordHash: string }
  >;
  categories: Map<
    string,
    {
      id: number;
      name: string;
      slug: string;
      description: string | null;
      imageUrl: null;
      imagePublicId: null;
      isActive: boolean;
    }
  >;
  products: Map<
    string,
    {
      id: number;
      name: string;
      slug: string;
      sku: string;
      categoryId: number;
      isActive: boolean;
      imageUrl: null;
      imagePublicId: null;
      price: unknown;
    }
  >;
  stocks: Map<number, { productId: number; quantity: number }>;
  movements: Array<{
    id: number;
    productId: number;
    userId: number;
    type: StockMovementType;
    quantity: number;
    quantityBefore: number;
    quantityAfter: number;
    note: string | null;
  }>;
  carts: Map<number, { id: number; userId: number }>;
  cartItems: Map<
    string,
    { cartId: number; productId: number; quantity: number }
  >;
  nextId: number;
};

function createMemoryPrisma() {
  const state: MemoryState = {
    roles: new Map(),
    permissions: new Map(),
    rolePermissionLinks: new Set(),
    users: new Map(),
    categories: new Map(),
    products: new Map(),
    stocks: new Map(),
    movements: [],
    carts: new Map(),
    cartItems: new Map(),
    nextId: 1,
  };
  const nextId = () => state.nextId++;
  const tx = {
    role: {
      upsert: async ({
        where,
        create,
      }: {
        where: { name: string };
        create: { name: string };
      }) => {
        let row = state.roles.get(where.name);
        if (!row) {
          row = { id: nextId(), name: create.name };
          state.roles.set(row.name, row);
        }
        return { id: row.id };
      },
    },
    permission: {
      upsert: async ({
        where,
        create,
      }: {
        where: { code: string };
        create: { code: string };
      }) => {
        let row = state.permissions.get(where.code);
        if (!row) {
          row = { id: nextId(), code: create.code };
          state.permissions.set(row.code, row);
        }
        return { id: row.id };
      },
    },
    rolePermission: {
      upsert: async ({
        where,
      }: {
        where: {
          roleId_permissionId: { roleId: number; permissionId: number };
        };
      }) => {
        const { roleId, permissionId } = where.roleId_permissionId;
        state.rolePermissionLinks.add(`${roleId}:${permissionId}`);
        return { roleId, permissionId };
      },
      findMany: async ({ where }: { where: { roleId: number } }) => {
        return [...state.rolePermissionLinks]
          .filter((key) => Number(key.split(':')[0]) === where.roleId)
          .map((key) => {
            const permissionId = Number(key.split(':')[1]);
            const permission = [...state.permissions.values()].find(
              (row) => row.id === permissionId,
            );
            return { permission: { code: permission?.code ?? '' } };
          });
      },
    },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        const row = state.users.get(where.email);
        return row ? { id: row.id, role: { name: row.roleName } } : null;
      },
      create: async ({
        data,
      }: {
        data: {
          name: string;
          email: string;
          passwordHash: string;
          roleId: number;
        };
      }) => {
        const roleName = [...state.roles.values()].find(
          (role) => role.id === data.roleId,
        )?.name;
        if (!roleName) throw new Error('Missing role');
        const row = {
          id: nextId(),
          email: data.email,
          roleName,
          passwordHash: data.passwordHash,
        };
        state.users.set(data.email, row);
        return { id: row.id, role: { name: roleName } };
      },
    },
    category: {
      upsert: async ({
        where,
        create,
      }: {
        where: { slug: string };
        create: Omit<
          MemoryState['categories'] extends Map<string, infer T> ? T : never,
          'id'
        >;
      }) => {
        let row = state.categories.get(where.slug);
        if (!row) {
          row = { id: nextId(), ...create };
          state.categories.set(row.slug, row);
        }
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          isActive: row.isActive,
        };
      },
    },
    product: {
      upsert: async ({
        where,
        create,
      }: {
        where: { slug: string };
        create: Omit<
          MemoryState['products'] extends Map<string, infer T> ? T : never,
          'id'
        >;
      }) => {
        let row = state.products.get(where.slug);
        if (!row) {
          row = { id: nextId(), ...create };
          state.products.set(row.slug, row);
        }
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          sku: row.sku,
          categoryId: row.categoryId,
          isActive: row.isActive,
        };
      },
    },
    stock: {
      findUnique: async ({ where }: { where: { productId: number } }) =>
        state.stocks.get(where.productId) ?? null,
      create: async ({
        data,
      }: {
        data: { productId: number; quantity: number };
      }) => {
        if (state.stocks.has(data.productId)) throw { code: 'P2002' };
        const row = { ...data };
        state.stocks.set(row.productId, row);
        return row;
      },
    },
    stockMovement: {
      findFirst: async ({
        where,
      }: {
        where: { productId: number; type: StockMovementType };
      }) => {
        const row = state.movements.find(
          (movement) =>
            movement.productId === where.productId &&
            movement.type === where.type,
        );
        return row
          ? {
              id: row.id,
              quantity: row.quantity,
              quantityBefore: row.quantityBefore,
              quantityAfter: row.quantityAfter,
            }
          : null;
      },
      create: async ({
        data,
      }: {
        data: Omit<MemoryState['movements'][number], 'id'>;
      }) => {
        const row = { id: nextId(), ...data };
        state.movements.push(row);
        return row;
      },
    },
    cart: {
      upsert: async ({
        where,
        create,
      }: {
        where: { userId: number };
        create: { userId: number };
      }) => {
        let row = state.carts.get(where.userId);
        if (!row) {
          row = { id: nextId(), ...create };
          state.carts.set(row.userId, row);
        }
        return { id: row.id };
      },
    },
    cartItem: {
      upsert: async ({
        where,
        create,
      }: {
        where: { cartId_productId: { cartId: number; productId: number } };
        create: { cartId: number; productId: number; quantity: number };
      }) => {
        const { cartId, productId } = where.cartId_productId;
        const key = `${cartId}:${productId}`;
        let row = state.cartItems.get(key);
        if (!row) {
          row = { ...create };
          state.cartItems.set(key, row);
        }
        return row;
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) =>
      callback(tx),
  } as unknown as PrismaClient;
  return { prisma, state };
}

describe('development seed', () => {
  it('creates the designated relational fixtures once and preserves existing stock and cart values on rerun', async () => {
    const { prisma, state } = createMemoryPrisma();
    const testInput = 'x'.repeat(16);

    await seedData(prisma, testInput);
    const preservedStock = [...state.stocks.values()][0];
    const preservedCartItem = [...state.cartItems.values()][0];
    if (!preservedStock || !preservedCartItem)
      throw new Error('Seed fixtures were not created.');
    preservedStock.quantity += 5;
    preservedCartItem.quantity = 4;

    await seedData(prisma, testInput);

    expect(state.users.size).toBe(6);
    expect(
      [...state.users.values()].filter((user) => user.roleName === 'ADMIN'),
    ).toHaveLength(1);
    expect(
      [...state.users.values()].filter((user) => user.roleName === 'CUSTOMER'),
    ).toHaveLength(5);
    const adminRoleId = state.roles.get('ADMIN')?.id;
    expect(adminRoleId).toBeDefined();
    expect(
      [...state.rolePermissionLinks].every(
        (link) => Number(link.split(':')[0]) === adminRoleId,
      ),
    ).toBe(true);
    expect(state.categories.size).toBe(10);
    expect(state.products.size).toBe(20);
    const productsPerCategory = new Map<number, number>();
    for (const product of state.products.values()) {
      productsPerCategory.set(
        product.categoryId,
        (productsPerCategory.get(product.categoryId) ?? 0) + 1,
      );
    }
    expect([...productsPerCategory.values()]).toEqual(Array(10).fill(2));
    expect(state.stocks.size).toBe(20);
    expect(state.movements).toHaveLength(20);
    expect(state.carts.size).toBe(5);
    expect(state.cartItems.size).toBe(10);
    expect(
      [...state.users.values()].every(
        (user) => user.passwordHash !== testInput,
      ),
    ).toBe(true);
    expect(
      [...state.products.values()].every(
        (product) =>
          product.imageUrl === null && product.imagePublicId === null,
      ),
    ).toBe(true);
    expect(
      [...state.stocks.values()].every((stock) => stock.quantity >= 0),
    ).toBe(true);
    expect(
      state.movements.every(
        (movement) =>
          movement.type === StockMovementType.INITIALIZATION &&
          movement.quantityBefore === 0 &&
          movement.quantityAfter === movement.quantity &&
          movement.userId ===
            [...state.users.values()].find((user) => user.roleName === 'ADMIN')
              ?.id,
      ),
    ).toBe(true);
    expect(
      state.movements
        .map((movement) => movement.productId)
        .sort((left, right) => left - right),
    ).toEqual([...state.stocks.keys()].sort((left, right) => left - right));
    expect(
      [...state.cartItems.values()].every(
        (item) =>
          item.quantity > 0 &&
          [...state.carts.values()].some((cart) => cart.id === item.cartId) &&
          [...state.products.values()].some(
            (product) => product.id === item.productId,
          ),
      ),
    ).toBe(true);
    expect([...state.stocks.values()][0]?.quantity).toBe(
      preservedStock.quantity,
    );
    expect([...state.cartItems.values()][0]?.quantity).toBe(4);
  });

  it('rejects a password outside the authentication password length range', async () => {
    const { prisma } = createMemoryPrisma();
    await expect(seedData(prisma, 'short')).rejects.toThrow(
      'SEED_DEFAULT_PASSWORD',
    );
  });

  it('aborts rather than changing a designated account with an unexpected role', async () => {
    const { prisma, state } = createMemoryPrisma();
    const testInput = 'x'.repeat(16);
    await seedData(prisma, testInput);
    const admin = state.users.get('dev.admin@example.test');
    if (!admin) throw new Error('Admin fixture was not created.');
    const existingHash = admin.passwordHash;
    admin.roleName = 'CUSTOMER';

    await expect(seedData(prisma, testInput)).rejects.toThrow('expected ADMIN');
    expect(admin.passwordHash).toBe(existingHash);
    expect(admin.roleName).toBe('CUSTOMER');
  });
});

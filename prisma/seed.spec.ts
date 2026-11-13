import {
  Prisma,
  PrismaClient,
  StockMovementType,
} from '../src/generated/prisma/client.js';
import {
  brandDefinitions,
  categoryDefinitions,
  customerPermissionCodes,
  permissionDefinitions,
  productDefinitions,
  seedData,
  staffPermissionCodes,
  userDefinitions,
} from './seed.js';

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  imagePublicId: string | null;
  isActive: boolean;
};

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  imagePublicId: string | null;
  isActive: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string | null;
  categoryId: string;
  brandId: string | null;
  isActive: boolean;
  imageUrl: string | null;
  imagePublicId: string | null;
  price: Prisma.Decimal;
  originalPrice: Prisma.Decimal | null;
};

type MemoryState = {
  roles: Map<string, { id: string; name: string }>;
  permissions: Map<string, { id: string; code: string }>;
  rolePermissionLinks: Set<string>;
  users: Map<
    string,
    {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      roleName: string;
      passwordHash: string;
      isActive: boolean;
    }
  >;
  categories: Map<string, CategoryRow>;
  brands: Map<string, BrandRow>;
  products: Map<string, ProductRow>;
  stocks: Map<string, { productId: string; quantity: number }>;
  movements: Array<{
    id: string;
    productId: string;
    userId: string;
    type: StockMovementType;
    quantity: number;
    quantityBefore: number;
    quantityAfter: number;
    note: string | null;
  }>;
  carts: Map<string, { id: string; userId: string }>;
  cartItems: Map<
    string,
    { cartId: string; productId: string; quantity: number }
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
    brands: new Map(),
    products: new Map(),
    stocks: new Map(),
    movements: [],
    carts: new Map(),
    cartItems: new Map(),
    nextId: 1,
  };
  const nextId = () =>
    `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`;
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
          roleId_permissionId: { roleId: string; permissionId: string };
        };
      }) => {
        const { roleId, permissionId } = where.roleId_permissionId;
        state.rolePermissionLinks.add(`${roleId}|${permissionId}`);
        return { roleId, permissionId };
      },
      findMany: async ({ where }: { where: { roleId: string } }) => {
        return [...state.rolePermissionLinks]
          .filter((key) => key.split('|')[0] === where.roleId)
          .map((key) => {
            const permissionId = key.split('|')[1];
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
          phone?: string | null;
          passwordHash: string;
          roleId: string;
          isActive?: boolean;
        };
      }) => {
        const roleName = [...state.roles.values()].find(
          (role) => role.id === data.roleId,
        )?.name;
        if (!roleName) throw new Error('Missing role');
        if (
          data.phone &&
          [...state.users.values()].some((user) => user.phone === data.phone)
        ) {
          throw { code: 'P2002' };
        }
        const row = {
          id: nextId(),
          name: data.name,
          email: data.email,
          phone: data.phone ?? null,
          roleName,
          passwordHash: data.passwordHash,
          isActive: data.isActive ?? true,
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
        create: Omit<CategoryRow, 'id'>;
      }) => {
        let row = state.categories.get(where.slug);
        if (!row) {
          row = { id: nextId(), ...create };
          state.categories.set(row.slug, row);
        }
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<CategoryRow>;
      }) => {
        const row = [...state.categories.values()].find(
          (item) => item.id === where.id,
        );
        if (!row) throw new Error('Category not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    brand: {
      upsert: async ({
        where,
        create,
      }: {
        where: { slug: string };
        create: Omit<BrandRow, 'id'>;
      }) => {
        let row = state.brands.get(where.slug);
        if (!row) {
          row = { id: nextId(), ...create };
          state.brands.set(row.slug, row);
        }
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<BrandRow>;
      }) => {
        const row = [...state.brands.values()].find(
          (item) => item.id === where.id,
        );
        if (!row) throw new Error('Brand not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    product: {
      upsert: async ({
        where,
        create,
      }: {
        where: { slug: string };
        create: Omit<ProductRow, 'id'>;
      }) => {
        let row = state.products.get(where.slug);
        if (!row) {
          row = { id: nextId(), ...create };
          state.products.set(row.slug, row);
        }
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<ProductRow>;
      }) => {
        const row = [...state.products.values()].find(
          (item) => item.id === where.id,
        );
        if (!row) throw new Error('Product not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    stock: {
      findUnique: async ({ where }: { where: { productId: string } }) =>
        state.stocks.get(where.productId) ?? null,
      create: async ({
        data,
      }: {
        data: { productId: string; quantity: number };
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
        where: { productId: string; type: StockMovementType };
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
        where: { userId: string };
        create: { userId: string };
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
        where: { cartId_productId: { cartId: string; productId: string } };
        create: { cartId: string; productId: string; quantity: number };
      }) => {
        const { cartId, productId } = where.cartId_productId;
        const key = `${cartId}|${productId}`;
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
  it('creates comprehensive RBAC, user, category, brand, product, stock, and cart fixtures and preserves existing stock/cart values on rerun', async () => {
    const { prisma, state } = createMemoryPrisma();
    const testInput = 'x'.repeat(16);

    const firstRun = await seedData(prisma, testInput);
    expect(firstRun).toEqual({
      roles: 3,
      permissions: permissionDefinitions.length,
      users: userDefinitions.length,
      categories: categoryDefinitions.length,
      brands: brandDefinitions.length,
      products: productDefinitions.length,
      stocks: productDefinitions.length,
      carts: 5,
    });

    const preservedStock = [...state.stocks.values()][0];
    const preservedCartItem = [...state.cartItems.values()][0];
    if (!preservedStock || !preservedCartItem) {
      throw new Error('Seed fixtures were not created.');
    }
    preservedStock.quantity += 5;
    preservedCartItem.quantity = 4;

    await seedData(prisma, testInput);

    // Roles & Permissions
    expect(state.roles.size).toBe(3);
    const adminRoleId = state.roles.get('ADMIN')?.id;
    const staffRoleId = state.roles.get('STAFF')?.id;
    const customerRoleId = state.roles.get('CUSTOMER')?.id;
    expect(adminRoleId).toBeDefined();
    expect(staffRoleId).toBeDefined();
    expect(customerRoleId).toBeDefined();

    for (const [code] of permissionDefinitions) {
      const permission = state.permissions.get(code);
      expect(permission).toBeDefined();
      expect(
        state.rolePermissionLinks.has(`${adminRoleId}|${permission?.id}`),
      ).toBe(true);
      expect(
        state.rolePermissionLinks.has(`${staffRoleId}|${permission?.id}`),
      ).toBe(staffPermissionCodes.has(code));
      expect(
        state.rolePermissionLinks.has(`${customerRoleId}|${permission?.id}`),
      ).toBe(customerPermissionCodes.has(code));
    }
    const roleManagePerm = state.permissions.get('role:manage');
    expect(
      state.rolePermissionLinks.has(`${staffRoleId}|${roleManagePerm?.id}`),
    ).toBe(false);

    // Users
    expect(state.users.size).toBe(12);
    expect(
      [...state.users.values()].filter((user) => user.roleName === 'ADMIN'),
    ).toHaveLength(1);
    expect(
      [...state.users.values()].filter((user) => user.roleName === 'STAFF'),
    ).toHaveLength(3);
    expect(
      [...state.users.values()].filter((user) => user.roleName === 'CUSTOMER'),
    ).toHaveLength(8);
    expect(
      [...state.users.values()].every(
        (user) =>
          user.passwordHash !== testInput &&
          user.isActive &&
          typeof user.phone === 'string' &&
          user.phone.length > 0,
      ),
    ).toBe(true);

    // Categories & Brands
    expect(state.categories.size).toBe(15);
    expect(state.brands.size).toBe(16);
    expect(
      [...state.categories.values()].every(
        (category) =>
          typeof category.imageUrl === 'string' &&
          category.imageUrl.startsWith('https://images.unsplash.com/') &&
          category.imagePublicId === null,
      ),
    ).toBe(true);
    expect(
      [...state.brands.values()].every(
        (brand) =>
          typeof brand.imageUrl === 'string' &&
          brand.imageUrl.startsWith('https://images.unsplash.com/') &&
          brand.imagePublicId === null,
      ),
    ).toBe(true);

    // Products (active/inactive, discounted/non-discounted, branded/nullable brand, unique images)
    expect(state.products.size).toBe(44);
    const activeProducts = [...state.products.values()].filter(
      (product) => product.isActive,
    );
    const inactiveProducts = [...state.products.values()].filter(
      (product) => !product.isActive,
    );
    expect(activeProducts.length).toBeGreaterThanOrEqual(40);
    expect(inactiveProducts).toHaveLength(3);

    const discountedProducts = [...state.products.values()].filter(
      (product) => product.originalPrice !== null,
    );
    const regularPriceProducts = [...state.products.values()].filter(
      (product) => product.originalPrice === null,
    );
    expect(discountedProducts.length).toBeGreaterThan(10);
    expect(regularPriceProducts.length).toBeGreaterThan(10);
    expect(
      discountedProducts.every((product) =>
        product.originalPrice!.gt(product.price),
      ),
    ).toBe(true);

    const brandedProducts = [...state.products.values()].filter(
      (product) => product.brandId !== null,
    );
    const unbrandedProducts = [...state.products.values()].filter(
      (product) => product.brandId === null,
    );
    expect(brandedProducts.length).toBeGreaterThan(30);
    expect(unbrandedProducts.length).toBeGreaterThan(0);

    const productImageUrls = new Set(
      [...state.products.values()].map((product) => product.imageUrl),
    );
    expect(productImageUrls.size).toBe(state.products.size);
    expect(
      [...state.products.values()].every(
        (product) =>
          typeof product.imageUrl === 'string' &&
          product.imageUrl.startsWith('https://images.unsplash.com/') &&
          product.imagePublicId === null,
      ),
    ).toBe(true);

    // Stock & INITIALIZATION movements (normal, low-stock, out-of-stock)
    expect(state.stocks.size).toBe(44);
    expect(state.movements).toHaveLength(44);
    const stockQuantities = [...state.stocks.values()].map((s) => s.quantity);
    expect(stockQuantities.some((q) => q === 0)).toBe(true);
    expect(stockQuantities.some((q) => q > 0 && q <= 3)).toBe(true);
    expect(stockQuantities.some((q) => q >= 20)).toBe(true);
    expect(stockQuantities.every((q) => q >= 0)).toBe(true);

    const adminUserId = state.users.get('admin@example.com')?.id;
    expect(
      state.movements.every(
        (movement) =>
          movement.type === StockMovementType.INITIALIZATION &&
          movement.quantityBefore === 0 &&
          movement.quantityAfter === movement.quantity &&
          movement.userId === adminUserId,
      ),
    ).toBe(true);

    // Carts
    expect(state.carts.size).toBe(5);
    expect(state.cartItems.size).toBe(10);
    expect([...state.stocks.values()][0]?.quantity).toBe(
      preservedStock.quantity,
    );
    expect([...state.cartItems.values()][0]?.quantity).toBe(4);
  });

  it('backfills missing imageUrl, brandId, and originalPrice on legacy seed rows while preserving existing Cloudinary imagePublicId records', async () => {
    const { prisma, state } = createMemoryPrisma();
    const testInput = 'x'.repeat(16);
    await seedData(prisma, testInput);

    const samsungBrand = state.brands.get('samsung');
    const s25Product = state.products.get('samsung-galaxy-s25');
    if (!samsungBrand || !s25Product) {
      throw new Error('Expected fixtures missing.');
    }

    // Simulate a user-uploaded Cloudinary brand image and a legacy product row with null fields
    samsungBrand.imageUrl =
      'https://res.cloudinary.com/demo/image/upload/v1/brands/samsung.jpg';
    samsungBrand.imagePublicId = 'ecommerce/brands/samsung';
    s25Product.brandId = null;
    s25Product.imageUrl = null;
    s25Product.originalPrice = null;

    await seedData(prisma, testInput);

    // Cloudinary brand image was preserved
    expect(samsungBrand.imagePublicId).toBe('ecommerce/brands/samsung');
    expect(samsungBrand.imageUrl).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1/brands/samsung.jpg',
    );

    // Legacy product fields were backfilled
    const updatedS25 = state.products.get('samsung-galaxy-s25');
    expect(updatedS25?.brandId).toBe(samsungBrand.id);
    expect(updatedS25?.imageUrl).toContain('https://images.unsplash.com/');
    expect(updatedS25?.originalPrice?.toString()).toBe('3100000');
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
    const admin = state.users.get('admin@example.com');
    if (!admin) throw new Error('Admin fixture was not created.');
    const existingHash = admin.passwordHash;
    admin.roleName = 'CUSTOMER';

    await expect(seedData(prisma, testInput)).rejects.toThrow('expected ADMIN');
    expect(admin.passwordHash).toBe(existingHash);
    expect(admin.roleName).toBe('CUSTOMER');
  });

  it('aborts if STAFF role has been granted role:manage', async () => {
    const { prisma, state } = createMemoryPrisma();
    const testInput = 'x'.repeat(16);
    await seedData(prisma, testInput);
    const staffRole = state.roles.get('STAFF');
    const roleManage = state.permissions.get('role:manage');
    if (!staffRole || !roleManage) throw new Error('Missing RBAC fixtures.');
    state.rolePermissionLinks.add(`${staffRole.id}|${roleManage.id}`);

    await expect(seedData(prisma, testInput)).rejects.toThrow(
      'STAFF role already has restricted management permissions',
    );
  });
});

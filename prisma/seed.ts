import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Prisma,
  PrismaClient,
  StockMovementType,
} from '../src/generated/prisma/client.js';
import { hasPrismaErrorCode } from '../src/common/prisma/prisma-error.util.js';

const BCRYPT_COST = 12;
const DEVELOPMENT_PASSWORD_MIN_LENGTH = 8;
const DEVELOPMENT_PASSWORD_MAX_LENGTH = 72;
const INITIAL_STOCK_NOTE = 'Development seed initial stock';

const permissionDefinitions = [
  ['category:read', 'Read categories'],
  ['category:create', 'Create categories'],
  ['category:update', 'Update categories'],
  ['category:delete', 'Delete categories'],
  ['brand:read', 'Read brands'],
  ['brand:create', 'Create brands'],
  ['brand:update', 'Update brands'],
  ['brand:delete', 'Delete brands'],
  ['product:read', 'Read products'],
  ['product:create', 'Create products'],
  ['product:update', 'Update products'],
  ['product:delete', 'Delete products'],
  ['stock:read', 'Read stock'],
  ['stock:update', 'Update stock'],
  ['order:read', 'Read orders'],
  ['order:update', 'Update orders'],
  ['payment:read', 'Read payments and payment history'],
  ['payment:update', 'Review manual payment attempts'],
  ['payment:collect', 'Confirm cash on delivery collection'],
  ['user:manage', 'Manage users'],
  ['role:manage', 'Manage roles and permissions'],
  ['media:upload', 'Upload product media'],
] as const;

const administrativePermissionCodes = new Set([
  'category:create',
  'category:update',
  'category:delete',
  'brand:create',
  'brand:update',
  'brand:delete',
  'product:create',
  'product:update',
  'product:delete',
  'stock:update',
  'order:read',
  'order:update',
  'payment:read',
  'payment:update',
  'payment:collect',
  'user:manage',
  'role:manage',
  'media:upload',
]);

const userDefinitions = [
  {
    name: 'Development Administrator',
    email: 'dev.admin@example.test',
    role: 'ADMIN',
  },
  { name: 'Aung Htet', email: 'aung.htet@example.test', role: 'CUSTOMER' },
  { name: 'May Thiri', email: 'may.thiri@example.test', role: 'CUSTOMER' },
  { name: 'Ko Min', email: 'ko.min@example.test', role: 'CUSTOMER' },
  { name: 'Su Su', email: 'su.su@example.test', role: 'CUSTOMER' },
  { name: 'Thant Zin', email: 'thant.zin@example.test', role: 'CUSTOMER' },
] as const;

const categoryDefinitions = [
  {
    name: 'Smartphones',
    slug: 'smartphones',
    description: 'Modern smartphones and mobile devices.',
  },
  {
    name: 'Laptops',
    slug: 'laptops',
    description: 'Portable computers for work, study, and play.',
  },
  {
    name: 'Tablets',
    slug: 'tablets',
    description: 'Touchscreen tablets and accessories.',
  },
  {
    name: 'Headphones & Earbuds',
    slug: 'headphones-earbuds',
    description: 'Wireless earbuds and over-ear headphones.',
  },
  {
    name: 'Smartwatches',
    slug: 'smartwatches',
    description: 'Connected watches and wearable devices.',
  },
  {
    name: 'Computer Accessories',
    slug: 'computer-accessories',
    description: 'Keyboards, mice, and essential computer peripherals.',
  },
  {
    name: 'Gaming Devices',
    slug: 'gaming-devices',
    description: 'Consoles and equipment for gaming.',
  },
  {
    name: 'Cameras',
    slug: 'cameras',
    description: 'Digital cameras and photography equipment.',
  },
  {
    name: 'Monitors',
    slug: 'monitors',
    description: 'Displays for home, office, and gaming.',
  },
  {
    name: 'Networking Devices',
    slug: 'networking-devices',
    description: 'Routers and devices for home and office networks.',
  },
] as const;

const productDefinitions = [
  {
    name: 'Samsung Galaxy S25',
    slug: 'samsung-galaxy-s25',
    sku: 'PH-SAM-S25',
    category: 'smartphones',
    description:
      'Samsung flagship smartphone with a vibrant display and advanced camera system.',
    price: '2850000.00',
    stock: 24,
  },
  {
    name: 'Apple iPhone 16',
    slug: 'apple-iphone-16',
    sku: 'PH-APL-I16',
    category: 'smartphones',
    description:
      'Apple smartphone with an advanced camera, fast performance, and all-day battery life.',
    price: '3650000.00',
    stock: 18,
  },
  {
    name: 'ASUS Vivobook 15',
    slug: 'asus-vivobook-15',
    sku: 'LT-ASU-VB15',
    category: 'laptops',
    description:
      'Everyday 15-inch laptop for productivity, study, and entertainment.',
    price: '2190000.00',
    stock: 12,
  },
  {
    name: 'Lenovo IdeaPad Slim 5',
    slug: 'lenovo-ideapad-slim-5',
    sku: 'LT-LEN-IPS5',
    category: 'laptops',
    description:
      'Slim performance laptop with a comfortable keyboard and crisp display.',
    price: '2790000.00',
    stock: 10,
  },
  {
    name: 'Apple iPad 11th Gen',
    slug: 'apple-ipad-11th-gen',
    sku: 'TB-APL-IP11',
    category: 'tablets',
    description:
      'Versatile Apple tablet for reading, creative work, and everyday apps.',
    price: '1590000.00',
    stock: 16,
  },
  {
    name: 'Samsung Galaxy Tab S10',
    slug: 'samsung-galaxy-tab-s10',
    sku: 'TB-SAM-TS10',
    category: 'tablets',
    description:
      'Premium Android tablet with a large display for work and entertainment.',
    price: '2480000.00',
    stock: 11,
  },
  {
    name: 'Sony WH-1000XM5',
    slug: 'sony-wh-1000xm5',
    sku: 'HP-SON-WHXM5',
    category: 'headphones-earbuds',
    description: 'Wireless over-ear headphones with adaptive noise cancelling.',
    price: '1180000.00',
    stock: 20,
  },
  {
    name: 'Samsung Galaxy Buds3 Pro',
    slug: 'samsung-galaxy-buds3-pro',
    sku: 'HP-SAM-BUD3P',
    category: 'headphones-earbuds',
    description:
      'Compact wireless earbuds with active noise cancelling and a charging case.',
    price: '690000.00',
    stock: 28,
  },
  {
    name: 'Apple Watch Series 10',
    slug: 'apple-watch-series-10',
    sku: 'SW-APL-AWS10',
    category: 'smartwatches',
    description:
      'Apple smartwatch with fitness, health, and notification features.',
    price: '1750000.00',
    stock: 14,
  },
  {
    name: 'Samsung Galaxy Watch7',
    slug: 'samsung-galaxy-watch7',
    sku: 'SW-SAM-GW7',
    category: 'smartwatches',
    description:
      'Connected Samsung watch with activity tracking and everyday smart features.',
    price: '1120000.00',
    stock: 17,
  },
  {
    name: 'Logitech MX Master 3S',
    slug: 'logitech-mx-master-3s',
    sku: 'CA-LOG-MXM3S',
    category: 'computer-accessories',
    description:
      'Ergonomic wireless mouse with precise tracking and customizable controls.',
    price: '420000.00',
    stock: 30,
  },
  {
    name: 'Keychron K8 Pro',
    slug: 'keychron-k8-pro',
    sku: 'CA-KEY-K8P',
    category: 'computer-accessories',
    description:
      'Wireless mechanical keyboard with hot-swappable switches and programmable keys.',
    price: '590000.00',
    stock: 19,
  },
  {
    name: 'Sony PlayStation 5 Slim',
    slug: 'sony-playstation-5-slim',
    sku: 'GM-SON-PS5S',
    category: 'gaming-devices',
    description:
      'Compact PlayStation console for current-generation games and media.',
    price: '2480000.00',
    stock: 8,
  },
  {
    name: 'Nintendo Switch OLED',
    slug: 'nintendo-switch-oled',
    sku: 'GM-NIN-SWOLED',
    category: 'gaming-devices',
    description:
      'Portable and dockable gaming console with a vivid OLED screen.',
    price: '1390000.00',
    stock: 13,
  },
  {
    name: 'Canon EOS R50',
    slug: 'canon-eos-r50',
    sku: 'CM-CAN-EOSR50',
    category: 'cameras',
    description:
      'Compact mirrorless camera for photography, video, and content creation.',
    price: '2250000.00',
    stock: 7,
  },
  {
    name: 'Sony Alpha A6400',
    slug: 'sony-alpha-a6400',
    sku: 'CM-SON-A6400',
    category: 'cameras',
    description: 'Mirrorless camera with fast autofocus for stills and video.',
    price: '1890000.00',
    stock: 6,
  },
  {
    name: 'LG UltraGear 27GP850',
    slug: 'lg-ultragear-27gp850',
    sku: 'MN-LG-27GP850',
    category: 'monitors',
    description: '27-inch QHD gaming monitor with a high refresh rate.',
    price: '1370000.00',
    stock: 9,
  },
  {
    name: 'Dell UltraSharp U2723QE',
    slug: 'dell-ultrasharp-u2723qe',
    sku: 'MN-DEL-U2723QE',
    category: 'monitors',
    description:
      '27-inch 4K productivity display with accurate color and USB-C connectivity.',
    price: '1950000.00',
    stock: 8,
  },
  {
    name: 'TP-Link Archer AX55',
    slug: 'tp-link-archer-ax55',
    sku: 'NW-TPL-AX55',
    category: 'networking-devices',
    description: 'Dual-band Wi-Fi 6 router for reliable home connectivity.',
    price: '310000.00',
    stock: 22,
  },
  {
    name: 'ASUS RT-AX86U',
    slug: 'asus-rt-ax86u',
    sku: 'NW-ASU-AX86U',
    category: 'networking-devices',
    description:
      'Wi-Fi 6 router designed for demanding home networks and gaming.',
    price: '790000.00',
    stock: 10,
  },
] as const;

const cartDefinitions = [
  {
    email: 'aung.htet@example.test',
    items: [
      ['samsung-galaxy-s25', 1],
      ['sony-wh-1000xm5', 1],
    ],
  },
  {
    email: 'may.thiri@example.test',
    items: [
      ['apple-ipad-11th-gen', 1],
      ['logitech-mx-master-3s', 1],
    ],
  },
  {
    email: 'ko.min@example.test',
    items: [
      ['sony-playstation-5-slim', 1],
      ['nintendo-switch-oled', 1],
    ],
  },
  {
    email: 'su.su@example.test',
    items: [
      ['apple-watch-series-10', 1],
      ['samsung-galaxy-buds3-pro', 2],
    ],
  },
  {
    email: 'thant.zin@example.test',
    items: [
      ['asus-vivobook-15', 1],
      ['tp-link-archer-ax55', 1],
    ],
  },
] as const;

function isUniqueConstraintError(error: unknown): boolean {
  return hasPrismaErrorCode(error, 'P2002');
}

function validatePassword(password: string): void {
  if (
    password.length < DEVELOPMENT_PASSWORD_MIN_LENGTH ||
    Buffer.byteLength(password, 'utf8') > DEVELOPMENT_PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      'SEED_DEFAULT_PASSWORD must be between 8 and 72 characters.',
    );
  }
}

/**
 * Seed the designated development fixtures without replacing existing user,
 * stock, or cart values. This function is injectable for database-free tests.
 */
export async function seedData(
  prisma: PrismaClient,
  defaultPassword: string,
): Promise<{
  users: number;
  categories: number;
  products: number;
  carts: number;
}> {
  validatePassword(defaultPassword);
  const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_COST);

  return prisma.$transaction(
    async (tx) => {
      const roles = new Map<string, { id: string }>();
      for (const [name, description] of [
        ['ADMIN', 'Administrator role'],
        ['CUSTOMER', 'Customer role'],
      ] as const) {
        const role = await tx.role.upsert({
          where: { name },
          update: {},
          create: { name, description },
          select: { id: true },
        });
        roles.set(name, role);
      }
      const adminRole = roles.get('ADMIN');
      const customerRole = roles.get('CUSTOMER');
      if (!adminRole || !customerRole)
        throw new Error('Required roles are unavailable.');

      for (const [code, description] of permissionDefinitions) {
        const permission = await tx.permission.upsert({
          where: { code },
          update: {},
          create: { code, description },
          select: { id: true },
        });
        await tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: adminRole.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: { roleId: adminRole.id, permissionId: permission.id },
        });
      }

      const customerPermissions = await tx.rolePermission.findMany({
        where: { roleId: customerRole.id },
        select: { permission: { select: { code: true } } },
      });
      const customerAdminPermissions = customerPermissions
        .map(({ permission }) => permission.code)
        .filter((code) => administrativePermissionCodes.has(code));
      if (customerAdminPermissions.length > 0) {
        throw new Error(
          `Seed conflict: CUSTOMER role already has administrative permissions (${customerAdminPermissions.join(', ')}). Existing RBAC assignments were not changed.`,
        );
      }

      const userIds = new Map<string, string>();
      for (const definition of userDefinitions) {
        const expectedRole = roles.get(definition.role);
        if (!expectedRole)
          throw new Error(`Required role ${definition.role} is unavailable.`);
        let user = await tx.user.findUnique({
          where: { email: definition.email },
          select: { id: true, role: { select: { name: true } } },
        });
        if (user) {
          if (user.role.name !== definition.role) {
            throw new Error(
              `Seed conflict: ${definition.email} has role ${user.role.name}; expected ${definition.role}. No user fields were changed.`,
            );
          }
        } else {
          try {
            user = await tx.user.create({
              data: {
                name: definition.name,
                email: definition.email,
                passwordHash,
                roleId: expectedRole.id,
              },
              select: { id: true, role: { select: { name: true } } },
            });
          } catch (error: unknown) {
            if (isUniqueConstraintError(error)) {
              throw new Error(
                `Seed conflict creating ${definition.email}: a unique user field is already used. Existing user data was not changed.`,
              );
            }
            throw error;
          }
        }
        userIds.set(definition.email, user.id);
      }

      const categoryIds = new Map<string, string>();
      for (const definition of categoryDefinitions) {
        let category;
        try {
          category = await tx.category.upsert({
            where: { slug: definition.slug },
            update: {},
            create: {
              name: definition.name,
              slug: definition.slug,
              description: definition.description,
              imageUrl: null,
              imagePublicId: null,
              isActive: true,
            },
            select: { id: true, name: true, slug: true, isActive: true },
          });
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) {
            throw new Error(
              `Seed conflict for category ${definition.slug}: its name or slug is already used by another record.`,
            );
          }
          throw error;
        }
        if (
          category.name !== definition.name ||
          category.slug !== definition.slug ||
          !category.isActive
        ) {
          throw new Error(
            `Seed conflict: category slug ${definition.slug} belongs to a different category.`,
          );
        }
        categoryIds.set(definition.slug, category.id);
      }

      const productIds = new Map<string, string>();
      for (const definition of productDefinitions) {
        const categoryId = categoryIds.get(definition.category);
        if (!categoryId)
          throw new Error(
            `Seed category ${definition.category} is unavailable.`,
          );
        let product;
        try {
          product = await tx.product.upsert({
            where: { slug: definition.slug },
            update: {},
            create: {
              name: definition.name,
              slug: definition.slug,
              sku: definition.sku,
              description: definition.description,
              price: new Prisma.Decimal(definition.price),
              categoryId,
              imageUrl: null,
              imagePublicId: null,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              sku: true,
              categoryId: true,
              isActive: true,
            },
          });
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) {
            throw new Error(
              `Seed conflict for product ${definition.slug}: its SKU or slug is already used by another record.`,
            );
          }
          throw error;
        }
        if (
          product.name !== definition.name ||
          product.slug !== definition.slug ||
          product.sku !== definition.sku ||
          product.categoryId !== categoryId ||
          !product.isActive
        ) {
          throw new Error(
            `Seed conflict: product ${definition.slug} differs from its designated fixture. Existing product data was not changed.`,
          );
        }
        productIds.set(definition.slug, product.id);
      }

      for (const definition of productDefinitions) {
        const productId = productIds.get(definition.slug);
        if (!productId)
          throw new Error(`Seed product ${definition.slug} is unavailable.`);
        const stock = await tx.stock.findUnique({
          where: { productId },
          select: { productId: true },
        });
        if (stock) {
          const movement = await tx.stockMovement.findFirst({
            where: { productId, type: StockMovementType.INITIALIZATION },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              quantity: true,
              quantityBefore: true,
              quantityAfter: true,
            },
          });
          if (!movement) {
            throw new Error(
              `Seed conflict: product ${definition.slug} already has stock but no initialization movement. Stock history was not fabricated or changed.`,
            );
          }
          if (
            movement.quantityBefore !== null &&
            movement.quantityAfter !== null &&
            movement.quantityAfter - movement.quantityBefore !==
              movement.quantity
          ) {
            throw new Error(
              `Seed conflict: product ${definition.slug} has an inconsistent initialization movement.`,
            );
          }
          continue;
        }

        await tx.stock.create({
          data: { productId, quantity: definition.stock },
        });
        await tx.stockMovement.create({
          data: {
            productId,
            userId: userIds.get('dev.admin@example.test')!,
            type: StockMovementType.INITIALIZATION,
            quantity: definition.stock,
            quantityBefore: 0,
            quantityAfter: definition.stock,
            note: INITIAL_STOCK_NOTE,
          },
        });
      }

      for (const definition of cartDefinitions) {
        const userId = userIds.get(definition.email);
        if (!userId)
          throw new Error(`Seed customer ${definition.email} is unavailable.`);
        const cart = await tx.cart.upsert({
          where: { userId },
          update: {},
          create: { userId },
          select: { id: true },
        });
        for (const [slug, quantity] of definition.items) {
          const productId = productIds.get(slug);
          if (!productId || !Number.isInteger(quantity) || quantity < 1) {
            throw new Error(
              `Seed cart fixture for ${definition.email} is invalid.`,
            );
          }
          await tx.cartItem.upsert({
            where: { cartId_productId: { cartId: cart.id, productId } },
            update: {},
            create: { cartId: cart.id, productId, quantity },
          });
        }
      }

      return {
        users: userDefinitions.length,
        categories: categoryDefinitions.length,
        products: productDefinitions.length,
        carts: cartDefinitions.length,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development seed is disabled when NODE_ENV=production.');
  }
  if (process.env.SEED_ENV !== 'development') {
    throw new Error(
      'Set SEED_ENV=development to enable development seed data.',
    );
  }
  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD;
  if (!defaultPassword) {
    throw new Error('SEED_DEFAULT_PASSWORD is required.');
  }
  validatePassword(defaultPassword);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('Database connection is not configured.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const result = await seedData(prisma, defaultPassword);
    console.log(
      `Development seed completed: ${result.users} designated users, ${result.categories} categories, ${result.products} products, and ${result.carts} carts are present. No credentials were logged.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await seed();
}

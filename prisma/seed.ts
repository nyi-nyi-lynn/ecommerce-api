/**
 * Development & Sample Data Seed (Prisma 7)
 * ============================================================================
 * Populates idempotent, non-destructive sample data for frontend development,
 * UI testing, and API verification across all core catalog, inventory, cart,
 * user, and dynamic RBAC modules.
 *
 * Execution:
 *   1. Configure environment variables in `.env`:
 *        NODE_ENV=development
 *        SEED_ENV=development
 *        SEED_DEFAULT_PASSWORD=<your-dev-password-between-8-and-72-chars>
 *   2. Run via Prisma CLI or the seed runner:
 *        node prisma/run-seed.mjs
 *        # or
 *        npx prisma db seed --config prisma7.config.ts
 *
 * Seeded Accounts (all use SEED_DEFAULT_PASSWORD, hashed with bcrypt cost 12):
 *   - ADMIN (1):
 *       admin@example.com       (Admin User, +959400100001)
 *   - STAFF (3):
 *       staff1@example.com      (Staff One, +959400100002)
 *       staff2@example.com      (Staff Two, +959400100003)
 *       staff3@example.com      (Staff Three, +959400100004)
 *   - CUSTOMER (8):
 *       ayeaye@example.com      (Aye Aye, +959400100005)
 *       mgmg@example.com        (Mg Mg, +959400100006)
 *       susu@example.com        (Su Su, +959400100007)
 *       aunghtet@example.com    (Aung Htet, +959400100008)
 *       maythiri@example.com    (May Thiri, +959400100009)
 *       komin@example.com       (Ko Min, +959400100010)
 *       thantzin@example.com    (Thant Zin, +959400100011)
 *       hninwai@example.com     (Hnin Wai, +959400100012)
 *
 * Seeded Records Summary:
 *   - 3 Roles (ADMIN, STAFF, CUSTOMER)
 *   - 26 Permissions (assigned deterministically by role)
 *   - 12 Users (1 ADMIN, 3 STAFF, 8 CUSTOMER)
 *   - 15 Categories (with Unsplash image URLs, imagePublicId = null)
 *   - 16 Brands (with Unsplash image URLs, imagePublicId = null)
 *   - 44 Products (41 active, 3 inactive; 21 discounted with originalPrice > price,
 *     23 non-discounted; 36 branded, 8 with brandId = null)
 *   - 44 Stock records + 44 INITIALIZATION StockMovements (including normal stock,
 *     5 low-stock products, and 3 out-of-stock products with quantity = 0)
 *   - 5 Customer Carts (10 CartItems)
 *   - 0 Orders, OrderItems, PaymentAttempts, or PaymentEvents
 *
 * Image Handling & External URL Note:
 *   External seed images use verified direct Unsplash CDN URLs (`images.unsplash.com`)
 *   with `imagePublicId: null` so the API never treats them as Cloudinary assets or
 *   attempts Cloudinary deletion on update/remove. If developing offline or behind
 *   a restricted firewall where `images.unsplash.com` is blocked, host static images
 *   in a local public/seed-assets directory and point `imageUrl` to your local base URL.
 */

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

export const roleDefinitions = [
  [
    'ADMIN',
    'Administrator role with full platform, catalog, inventory, order, payment, CMS, user, and RBAC management access',
  ],
  [
    'STAFF',
    'Operational staff role for catalog management, stock operations, order fulfillment, manual payment review, and CMS updates',
  ],
  [
    'CUSTOMER',
    'Customer role with storefront browsing and authenticated customer shopping access',
  ],
] as const;

export const permissionDefinitions = [
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
  ['cms:read', 'Read CMS content'],
  ['cms:create', 'Create CMS content'],
  ['cms:update', 'Update CMS content'],
  ['cms:delete', 'Delete CMS content'],
  ['user:manage', 'Manage users'],
  ['role:manage', 'Manage roles and permissions'],
  ['media:upload', 'Upload product media'],
] as const;

export const staffPermissionCodes = new Set<string>([
  'category:read',
  'category:create',
  'category:update',
  'brand:read',
  'brand:create',
  'brand:update',
  'product:read',
  'product:create',
  'product:update',
  'stock:read',
  'stock:update',
  'order:read',
  'order:update',
  'payment:read',
  'payment:update',
  'payment:collect',
  'cms:read',
  'cms:create',
  'cms:update',
  'media:upload',
]);

export const customerPermissionCodes = new Set<string>([
  'category:read',
  'brand:read',
  'product:read',
]);

const administrativePermissionCodes = new Set<string>([
  'category:create',
  'category:update',
  'category:delete',
  'brand:create',
  'brand:update',
  'brand:delete',
  'product:create',
  'product:update',
  'product:delete',
  'stock:read',
  'stock:update',
  'order:read',
  'order:update',
  'payment:read',
  'payment:update',
  'payment:collect',
  'cms:read',
  'cms:create',
  'cms:update',
  'cms:delete',
  'user:manage',
  'role:manage',
  'media:upload',
]);

const staffForbiddenPermissionCodes = new Set<string>([
  'role:manage',
  'user:manage',
]);

export const userDefinitions = [
  {
    name: 'Admin User',
    email: 'admin@example.com',
    phone: '+959400100001',
    role: 'ADMIN',
    isActive: true,
  },
  {
    name: 'Staff One',
    email: 'staff1@example.com',
    phone: '+959400100002',
    role: 'STAFF',
    isActive: true,
  },
  {
    name: 'Staff Two',
    email: 'staff2@example.com',
    phone: '+959400100003',
    role: 'STAFF',
    isActive: true,
  },
  {
    name: 'Staff Three',
    email: 'staff3@example.com',
    phone: '+959400100004',
    role: 'STAFF',
    isActive: true,
  },
  {
    name: 'Aye Aye',
    email: 'ayeaye@example.com',
    phone: '+959400100005',
    role: 'CUSTOMER',
    isActive: true,
  },
  {
    name: 'Mg Mg',
    email: 'mgmg@example.com',
    phone: '+959400100006',
    role: 'CUSTOMER',
    isActive: true,
  },
  {
    name: 'Su Su',
    email: 'susu@example.com',
    phone: '+959400100007',
    role: 'CUSTOMER',
    isActive: true,
  },
  {
    name: 'Aung Htet',
    email: 'aunghtet@example.com',
    phone: '+959400100008',
    role: 'CUSTOMER',
    isActive: true,
  },
  {
    name: 'May Thiri',
    email: 'maythiri@example.com',
    phone: '+959400100009',
    role: 'CUSTOMER',
    isActive: true,
  },
  {
    name: 'Ko Min',
    email: 'komin@example.com',
    phone: '+959400100010',
    role: 'CUSTOMER',
    isActive: true,
  },
  {
    name: 'Thant Zin',
    email: 'thantzin@example.com',
    phone: '+959400100011',
    role: 'CUSTOMER',
    isActive: true,
  },
  {
    name: 'Hnin Wai',
    email: 'hninwai@example.com',
    phone: '+959400100012',
    role: 'CUSTOMER',
    isActive: true,
  },
] as const;

export const categoryDefinitions = [
  {
    name: 'Smartphones',
    slug: 'smartphones',
    description: 'Modern 5G smartphones, foldables, and mobile devices.',
    imageUrl:
      'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Laptops',
    slug: 'laptops',
    description:
      'Ultrabooks, creator laptops, and portable computers for work, study, and play.',
    imageUrl:
      'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Tablets',
    slug: 'tablets',
    description:
      'Touchscreen tablets for digital illustration, reading, and mobile productivity.',
    imageUrl:
      'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Headphones & Earbuds',
    slug: 'headphones-earbuds',
    description:
      'True wireless earbuds and studio-grade noise-cancelling over-ear headphones.',
    imageUrl:
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Smartwatches',
    slug: 'smartwatches',
    description:
      'Connected fitness watches, health trackers, and everyday wearable devices.',
    imageUrl:
      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Computer Accessories',
    slug: 'computer-accessories',
    description:
      'Mechanical keyboards, precision mice, GaN chargers, and essential peripherals.',
    imageUrl:
      'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Gaming Devices',
    slug: 'gaming-devices',
    description: 'Home and handheld gaming consoles, controllers, and gear.',
    imageUrl:
      'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Cameras',
    slug: 'cameras',
    description:
      'Mirrorless digital cameras, vlogging kits, and photography equipment.',
    imageUrl:
      'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Monitors',
    slug: 'monitors',
    description:
      'High-refresh QHD gaming displays and color-calibrated 4K office monitors.',
    imageUrl:
      'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Networking Devices',
    slug: 'networking-devices',
    description:
      'Wi-Fi 6 routers and high-speed networking hardware for home and office.',
    imageUrl:
      'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: "Men's Fashion",
    slug: 'mens-fashion',
    description:
      'Everyday menswear, athletic apparel, casual shirts, and sneakers.',
    imageUrl:
      'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: "Women's Fashion",
    slug: 'womens-fashion',
    description:
      'Contemporary womenswear, dresses, tailored outerwear, footwear, and bags.',
    imageUrl:
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Home & Living',
    slug: 'home-living',
    description:
      'Modern lighting, desk organization, drinkware, and smart home essentials.',
    imageUrl:
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Beauty & Personal Care',
    slug: 'beauty-personal-care',
    description:
      'Daily skincare cleansers, broad-spectrum sunscreens, and barrier moisturizers.',
    imageUrl:
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Sports & Outdoors',
    slug: 'sports-outdoors',
    description:
      'Performance running shoes, travel backpacks, and fitness training gear.',
    imageUrl:
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=800&q=80',
  },
] as const;

export const brandDefinitions = [
  {
    name: 'Apple',
    slug: 'apple',
    description:
      'Consumer electronics pioneer crafting iPhone, iPad, Mac, and Apple Watch ecosystems.',
    imageUrl:
      'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Samsung',
    slug: 'samsung',
    description:
      'Global leader in Galaxy smartphones, tablets, wearables, and display technology.',
    imageUrl:
      'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Xiaomi',
    slug: 'xiaomi',
    description:
      'Innovative smartphones, tablets, and connected smart home appliances.',
    imageUrl:
      'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Sony',
    slug: 'sony',
    description:
      'Premier creator of Alpha mirrorless cameras, PlayStation consoles, and 1000X audio.',
    imageUrl:
      'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'ASUS',
    slug: 'asus',
    description:
      'High-performance Vivobook laptops, gaming hardware, and high-speed Wi-Fi routers.',
    imageUrl:
      'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Lenovo',
    slug: 'lenovo',
    description:
      'Reliable IdeaPad and ThinkPad portable computing solutions for work and study.',
    imageUrl:
      'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Nike',
    slug: 'nike',
    description:
      'Athletic footwear, Dri-FIT performance apparel, and everyday sport accessories.',
    imageUrl:
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Adidas',
    slug: 'adidas',
    description:
      'Sportswear, Ultraboost running footwear, and active lifestyle gear.',
    imageUrl:
      'https://images.unsplash.com/photo-1518002171953-a080ee817e1f?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Logitech',
    slug: 'logitech',
    description:
      'Precision wireless mice, ergonomic keyboards, and desktop productivity accessories.',
    imageUrl:
      'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Anker',
    slug: 'anker',
    description:
      'Fast GaN wall chargers, high-capacity power banks, and mobile charging gear.',
    imageUrl:
      'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Dell',
    slug: 'dell',
    description:
      'Professional UltraSharp monitors and enterprise-grade computing hardware.',
    imageUrl:
      'https://images.unsplash.com/photo-1547082299-de196ea013d6?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'LG',
    slug: 'lg',
    description:
      'UltraGear gaming monitors and advanced IPS display technologies.',
    imageUrl:
      'https://images.unsplash.com/photo-1585792180666-f7347c490ee2?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Canon',
    slug: 'canon',
    description:
      'EOS mirrorless cameras, optical lenses, and digital imaging solutions.',
    imageUrl:
      'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Nintendo',
    slug: 'nintendo',
    description:
      'Interactive family gaming consoles and portable entertainment systems.',
    imageUrl:
      'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'Keychron',
    slug: 'keychron',
    description:
      'Custom wireless mechanical keyboards for Mac, Windows, and Linux setups.',
    imageUrl:
      'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80',
  },
  {
    name: 'TP-Link',
    slug: 'tp-link',
    description:
      'Archer Wi-Fi routers, mesh systems, and reliable home networking equipment.',
    imageUrl:
      'https://images.unsplash.com/photo-1606904825846-647eb07f5be2?auto=format&fit=crop&w=800&q=80',
  },
] as const;

export type ProductSeedDefinition = {
  readonly name: string;
  readonly slug: string;
  readonly sku: string;
  readonly category: (typeof categoryDefinitions)[number]['slug'];
  readonly brand: (typeof brandDefinitions)[number]['slug'] | null;
  readonly description: string;
  readonly price: string;
  readonly originalPrice: string | null;
  readonly imageUrl: string;
  readonly isActive: boolean;
  readonly stock: number;
};

export const productDefinitions: readonly ProductSeedDefinition[] = [
  // Smartphones (3)
  {
    name: 'Samsung Galaxy S25',
    slug: 'samsung-galaxy-s25',
    sku: 'PH-SAM-S25',
    category: 'smartphones',
    brand: 'samsung',
    description:
      'Samsung flagship smartphone with a vibrant Dynamic AMOLED 2X display and pro-grade triple camera system.',
    price: '2850000.00',
    originalPrice: '3100000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 24,
  },
  {
    name: 'Apple iPhone 16',
    slug: 'apple-iphone-16',
    sku: 'PH-APL-I16',
    category: 'smartphones',
    brand: 'apple',
    description:
      'Apple smartphone with A18 chip, 48MP Fusion camera, Action button, and all-day battery life.',
    price: '3650000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 18,
  },
  {
    name: 'Xiaomi 14T Pro',
    slug: 'xiaomi-14t-pro',
    sku: 'PH-XIA-14TP',
    category: 'smartphones',
    brand: 'xiaomi',
    description:
      'Co-engineered Leica triple camera smartphone with 144Hz AMOLED display and 120W HyperCharge.',
    price: '1890000.00',
    originalPrice: '2050000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 15,
  },

  // Laptops (3)
  {
    name: 'ASUS Vivobook 15',
    slug: 'asus-vivobook-15',
    sku: 'LT-ASU-VB15',
    category: 'laptops',
    brand: 'asus',
    description:
      'Everyday 15.6-inch Full HD laptop with 180-degree lay-flat hinge for productivity, study, and entertainment.',
    price: '2190000.00',
    originalPrice: '2390000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 12,
  },
  {
    name: 'Lenovo IdeaPad Slim 5',
    slug: 'lenovo-ideapad-slim-5',
    sku: 'LT-LEN-IPS5',
    category: 'laptops',
    brand: 'lenovo',
    description:
      'Slim aluminum-chassis performance laptop with a tactile backlit keyboard and crisp WUXGA display.',
    price: '2790000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 10,
  },
  {
    name: 'Apple MacBook Air 13 M3',
    slug: 'apple-macbook-air-13-m3',
    sku: 'LT-APL-MBA13M3',
    category: 'laptops',
    brand: 'apple',
    description:
      'Supercharged by the M3 chip with a 13.6-inch Liquid Retina display, MagSafe charging, and up to 18 hours of battery life.',
    price: '3890000.00',
    originalPrice: '4150000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 9,
  },

  // Tablets (3)
  {
    name: 'Apple iPad 11th Gen',
    slug: 'apple-ipad-11th-gen',
    sku: 'TB-APL-IP11',
    category: 'tablets',
    brand: 'apple',
    description:
      'Versatile all-screen Apple tablet for reading, note-taking, creative work, and everyday apps.',
    price: '1590000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1585790050230-5dd28404ccb9?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 16,
  },
  {
    name: 'Samsung Galaxy Tab S10',
    slug: 'samsung-galaxy-tab-s10',
    sku: 'TB-SAM-TS10',
    category: 'tablets',
    brand: 'samsung',
    description:
      'Premium Android tablet with S Pen included and an anti-reflection AMOLED display for work and entertainment.',
    price: '2480000.00',
    originalPrice: '2690000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1561154464-82e9adf32764?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 11,
  },
  {
    name: 'Xiaomi Pad 6',
    slug: 'xiaomi-pad-6',
    sku: 'TB-XIA-PAD6',
    category: 'tablets',
    brand: 'xiaomi',
    description:
      '11-inch WQHD+ 144Hz display tablet with quad stereo speakers and metal unibody design.',
    price: '1150000.00',
    originalPrice: '1290000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1542751110-97427bbecf20?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 0,
  },

  // Headphones & Earbuds (3 - includes 1 inactive product)
  {
    name: 'Sony WH-1000XM5',
    slug: 'sony-wh-1000xm5',
    sku: 'HP-SON-WHXM5',
    category: 'headphones-earbuds',
    brand: 'sony',
    description:
      'Industry-leading wireless over-ear headphones with 8-microphone adaptive noise cancelling and 30-hour battery.',
    price: '1180000.00',
    originalPrice: '1320000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 20,
  },
  {
    name: 'Samsung Galaxy Buds3 Pro',
    slug: 'samsung-galaxy-buds3-pro',
    sku: 'HP-SAM-BUD3P',
    category: 'headphones-earbuds',
    brand: 'samsung',
    description:
      'Compact wireless earbuds with dual-driver Hi-Fi sound, adaptive ANC, and a translucent charging case.',
    price: '690000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 28,
  },
  {
    name: 'Sony WF-1000XM5 Earbuds',
    slug: 'sony-wf-1000xm5-earbuds',
    sku: 'HP-SON-WFXM5',
    category: 'headphones-earbuds',
    brand: 'sony',
    description:
      'Compact flagship true wireless noise-cancelling earbuds with LDAC high-resolution audio support.',
    price: '890000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?auto=format&fit=crop&w=800&q=80',
    isActive: false,
    stock: 5,
  },

  // Smartwatches (2)
  {
    name: 'Apple Watch Series 10',
    slug: 'apple-watch-series-10',
    sku: 'SW-APL-AWS10',
    category: 'smartwatches',
    brand: 'apple',
    description:
      'Thinnest Apple smartwatch featuring a wide-angle OLED display, sleep apnea notifications, and fast charging.',
    price: '1750000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 14,
  },
  {
    name: 'Samsung Galaxy Watch7',
    slug: 'samsung-galaxy-watch7',
    sku: 'SW-SAM-GW7',
    category: 'smartwatches',
    brand: 'samsung',
    description:
      'Connected Samsung watch with BioActive health sensor, dual-frequency GPS, and sapphire crystal glass.',
    price: '1120000.00',
    originalPrice: '1250000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 17,
  },

  // Computer Accessories (4)
  {
    name: 'Logitech MX Master 3S',
    slug: 'logitech-mx-master-3s',
    sku: 'CA-LOG-MXM3S',
    category: 'computer-accessories',
    brand: 'logitech',
    description:
      'Ergonomic wireless mouse with 8K DPI track-on-glass sensor, quiet clicks, and MagSpeed electromagnetic scrolling.',
    price: '420000.00',
    originalPrice: '465000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 30,
  },
  {
    name: 'Keychron K8 Pro',
    slug: 'keychron-k8-pro',
    sku: 'CA-KEY-K8P',
    category: 'computer-accessories',
    brand: 'keychron',
    description:
      'QMK/VIA wireless tenkeyless mechanical keyboard with hot-swappable switches and PBT keycaps.',
    price: '590000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 19,
  },
  {
    name: 'Anker Prime 67W GaN Wall Charger',
    slug: 'anker-prime-67w-gan-charger',
    sku: 'CA-ANK-67WGAN',
    category: 'computer-accessories',
    brand: 'anker',
    description:
      'Compact 3-port fast GaN wall charger with dual USB-C and USB-A ports for laptops, tablets, and phones.',
    price: '145000.00',
    originalPrice: '169000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1585338107529-13afc5f02586?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 35,
  },
  {
    name: 'Anker 20000mAh Fast Power Bank',
    slug: 'anker-powerbank-20000mah',
    sku: 'CA-ANK-PB20K',
    category: 'computer-accessories',
    brand: 'anker',
    description:
      'High-capacity 20,000mAh portable charger with built-in USB-C cable and 30W two-way fast charging.',
    price: '165000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 3,
  },

  // Gaming Devices (2)
  {
    name: 'Sony PlayStation 5 Slim',
    slug: 'sony-playstation-5-slim',
    sku: 'GM-SON-PS5S',
    category: 'gaming-devices',
    brand: 'sony',
    description:
      'Compact PlayStation 5 console with 1TB ultra-high-speed SSD and DualSense haptic wireless controller.',
    price: '2480000.00',
    originalPrice: '2650000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1607853202273-797f1c22a38e?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 8,
  },
  {
    name: 'Nintendo Switch OLED',
    slug: 'nintendo-switch-oled',
    sku: 'GM-NIN-SWOLED',
    category: 'gaming-devices',
    brand: 'nintendo',
    description:
      'Hybrid portable and TV gaming console featuring a vivid 7-inch OLED screen and wide adjustable stand.',
    price: '1390000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 13,
  },

  // Cameras (2)
  {
    name: 'Canon EOS R50',
    slug: 'canon-eos-r50',
    sku: 'CM-CAN-EOSR50',
    category: 'cameras',
    brand: 'canon',
    description:
      'Compact APS-C mirrorless camera with 24.2MP sensor and Dual Pixel CMOS AF II for photo and 4K video creators.',
    price: '2250000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1519183071298-a2962feb14f4?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 7,
  },
  {
    name: 'Sony Alpha A6400',
    slug: 'sony-alpha-a6400',
    sku: 'CM-SON-A6400',
    category: 'cameras',
    brand: 'sony',
    description:
      'APS-C mirrorless camera with real-time eye autofocus and 180-degree tiltable LCD touchscreen.',
    price: '1890000.00',
    originalPrice: '2090000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1516724562728-afc824a36e84?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 6,
  },

  // Monitors (2)
  {
    name: 'LG UltraGear 27GP850',
    slug: 'lg-ultragear-27gp850',
    sku: 'MN-LG-27GP850',
    category: 'monitors',
    brand: 'lg',
    description:
      '27-inch QHD Nano IPS gaming monitor with 180Hz overclocked refresh rate and 1ms GtG response time.',
    price: '1370000.00',
    originalPrice: '1520000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1551645120-d70bfe84c826?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 9,
  },
  {
    name: 'Dell UltraSharp U2723QE',
    slug: 'dell-ultrasharp-u2723qe',
    sku: 'MN-DEL-U2723QE',
    category: 'monitors',
    brand: 'dell',
    description:
      '27-inch 4K UHD IPS Black productivity monitor with 90W USB-C hub and factory-calibrated color accuracy.',
    price: '1950000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1547119957-637f8679db1e?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 8,
  },

  // Networking Devices (2)
  {
    name: 'TP-Link Archer AX55',
    slug: 'tp-link-archer-ax55',
    sku: 'NW-TPL-AX55',
    category: 'networking-devices',
    brand: 'tp-link',
    description:
      'AX3000 dual-band Gigabit Wi-Fi 6 router with four high-gain antennas and TP-Link OneMesh support.',
    price: '310000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 22,
  },
  {
    name: 'ASUS RT-AX86U',
    slug: 'asus-rt-ax86u',
    sku: 'NW-ASU-AX86U',
    category: 'networking-devices',
    brand: 'asus',
    description:
      'AX5700 dual-band Wi-Fi 6 gaming router with 2.5G port, mobile game mode, and AiProtection Pro security.',
    price: '790000.00',
    originalPrice: '880000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1563770660941-20978e870e26?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 10,
  },

  // Men's Fashion (4)
  {
    name: "Nike Dri-FIT Men's Training T-Shirt",
    slug: 'nike-dri-fit-mens-training-tshirt',
    sku: 'MF-NIK-DFTEE',
    category: 'mens-fashion',
    brand: 'nike',
    description:
      'Breathable moisture-wicking crew-neck athletic T-shirt designed for gym sessions and everyday comfort.',
    price: '95000.00',
    originalPrice: '115000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 40,
  },
  {
    name: 'Adidas Essentials Fleece Hoodie',
    slug: 'adidas-essentials-fleece-hoodie',
    sku: 'MF-ADI-FLCHD',
    category: 'mens-fashion',
    brand: 'adidas',
    description:
      'Soft cotton-blend pullover hoodie with kangaroo pocket and embroidered athletic logo.',
    price: '185000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 25,
  },
  {
    name: "Classic Oxford Cotton Men's Shirt",
    slug: 'classic-oxford-cotton-mens-shirt',
    sku: 'MF-GEN-OXSHIRT',
    category: 'mens-fashion',
    brand: null,
    description:
      'Tailored button-down long-sleeve shirt woven from breathable 100% combed Oxford cotton.',
    price: '78000.00',
    originalPrice: '92000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 32,
  },
  {
    name: 'Nike Air Max 90 Sneakers',
    slug: 'nike-air-max-90-sneakers',
    sku: 'MF-NIK-AM90',
    category: 'mens-fashion',
    brand: 'nike',
    description:
      'Iconic lifestyle sneakers featuring visible Max Air heel cushioning, stitched overlays, and waffle outsole.',
    price: '340000.00',
    originalPrice: '385000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 14,
  },

  // Women's Fashion (4 - includes 1 inactive product & 1 out-of-stock product)
  {
    name: 'Floral Midi Summer Dress',
    slug: 'floral-midi-summer-dress',
    sku: 'WF-GEN-FLDRESS',
    category: 'womens-fashion',
    brand: null,
    description:
      'Lightweight A-line midi dress with botanical print, adjustable waist tie, and breathable viscose fabric.',
    price: '125000.00',
    originalPrice: '149000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 22,
  },
  {
    name: "Adidas Ultraboost Light Women's Shoes",
    slug: 'adidas-ultraboost-light-womens-shoes',
    sku: 'WF-ADI-UBLW',
    category: 'womens-fashion',
    brand: 'adidas',
    description:
      'Responsive everyday running and lifestyle sneakers with PRIMEKNIT+ upper and Continental rubber outsole.',
    price: '420000.00',
    originalPrice: '465000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 2,
  },
  {
    name: 'Nike Sportswear Everyday Tote Bag',
    slug: 'nike-sportswear-everyday-tote-bag',
    sku: 'WF-NIK-TOTEBG',
    category: 'womens-fashion',
    brand: 'nike',
    description:
      'Spacious woven carryall tote with padded laptop sleeve, internal organizer pockets, and dual shoulder straps.',
    price: '110000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 0,
  },
  {
    name: "Linen Blend Tailored Women's Blazer",
    slug: 'linen-blend-tailored-womens-blazer',
    sku: 'WF-GEN-LNBLZR',
    category: 'womens-fashion',
    brand: null,
    description:
      'Single-breasted relaxed-fit blazer crafted from a breathable linen-cotton blend for office and smart-casual wear.',
    price: '195000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80',
    isActive: false,
    stock: 8,
  },

  // Home & Living (4)
  {
    name: 'Minimalist Architect LED Desk Lamp',
    slug: 'minimalist-led-desk-lamp',
    sku: 'HL-GEN-LEDLAMP',
    category: 'home-living',
    brand: null,
    description:
      'Adjustable aluminum desk lamp with 5 color temperatures, stepless touch dimming, and eye-care diffuser.',
    price: '68000.00',
    originalPrice: '85000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 26,
  },
  {
    name: 'Insulated Stainless Steel Water Bottle 750ml',
    slug: 'insulated-stainless-steel-water-bottle',
    sku: 'HL-GEN-SSBOTTLE',
    category: 'home-living',
    brand: null,
    description:
      'Double-wall vacuum-insulated 18/8 stainless steel flask that keeps drinks cold for 24 hours or hot for 12 hours.',
    price: '45000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 45,
  },
  {
    name: 'Modular Bamboo Desktop Storage Organizer',
    slug: 'modular-bamboo-storage-organizer',
    sku: 'HL-GEN-BMORG',
    category: 'home-living',
    brand: null,
    description:
      'Eco-friendly natural bamboo organizer tray with compartments for stationery, notebooks, and desk accessories.',
    price: '54000.00',
    originalPrice: '65000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1595428774223-ef52624120d2?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 18,
  },
  {
    name: 'Xiaomi Smart Air Purifier 4 Compact',
    slug: 'xiaomi-smart-air-purifier-4-compact',
    sku: 'HL-XIA-AP4C',
    category: 'home-living',
    brand: 'xiaomi',
    description:
      'Tabletop and floor HEPA air purifier with real-time air quality indicator and ultra-quiet 20dB sleep mode.',
    price: '320000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1585771724684-38269d6639fd?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 3,
  },

  // Beauty & Personal Care (3 - includes 1 low-stock & 1 out-of-stock product)
  {
    name: 'Gentle Hydrating Facial Cleanser 250ml',
    slug: 'gentle-hydrating-facial-cleanser',
    sku: 'BP-GEN-CLNSR',
    category: 'beauty-personal-care',
    brand: null,
    description:
      'pH-balanced non-stripping amino acid gel cleanser formulated with hyaluronic acid and panthenol for all skin types.',
    price: '38000.00',
    originalPrice: '45000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 34,
  },
  {
    name: 'Daily UV Defense Broad-Spectrum Sunscreen SPF50+',
    slug: 'daily-uv-defense-sunscreen-spf50',
    sku: 'BP-GEN-SUN50',
    category: 'beauty-personal-care',
    brand: null,
    description:
      'Weightless invisible-finish PA++++ daily facial sunscreen with niacinamide and centella asiatica extract.',
    price: '42000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1526947425960-945c6e72858f?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 2,
  },
  {
    name: 'Ceramide Barrier Repair Daily Moisturizer',
    slug: 'ceramide-barrier-repair-moisturizer',
    sku: 'BP-GEN-MOIST',
    category: 'beauty-personal-care',
    brand: null,
    description:
      'Fragrance-free soothing cream enriched with 5 essential ceramides and squalane for lasting 24-hour hydration.',
    price: '52000.00',
    originalPrice: '62000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 0,
  },

  // Sports & Outdoors (3 - includes 1 low-stock & 1 inactive product)
  {
    name: 'Adidas 4ATHLTS Camper Backpack',
    slug: 'adidas-4athlts-camper-backpack',
    sku: 'SO-ADI-4ABPK',
    category: 'sports-outdoors',
    brand: 'adidas',
    description:
      'Durable 27.5L training and travel backpack with top buckle closure, ventilated mesh back panel, and laptop compartment.',
    price: '135000.00',
    originalPrice: '155000.00',
    imageUrl:
      'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 21,
  },
  {
    name: 'Nike Pegasus 41 Road Running Shoes',
    slug: 'nike-pegasus-41-road-running-shoes',
    sku: 'SO-NIK-PEG41',
    category: 'sports-outdoors',
    brand: 'nike',
    description:
      'Everyday road running shoes with ReactX foam midsole and dual Air Zoom units for energized cushioning.',
    price: '365000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=800&q=80',
    isActive: true,
    stock: 1,
  },
  {
    name: 'Non-Slip TPE Fitness Yoga Mat 6mm',
    slug: 'non-slip-tpe-fitness-yoga-mat',
    sku: 'SO-GEN-YGMAT',
    category: 'sports-outdoors',
    brand: null,
    description:
      'High-density dual-layer textured fitness and yoga mat with alignment lines and carry strap.',
    price: '58000.00',
    originalPrice: null,
    imageUrl:
      'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?auto=format&fit=crop&w=800&q=80',
    isActive: false,
    stock: 12,
  },
] as const;

export const cartDefinitions = [
  {
    email: 'ayeaye@example.com',
    items: [
      ['samsung-galaxy-s25', 1],
      ['sony-wh-1000xm5', 1],
    ],
  },
  {
    email: 'mgmg@example.com',
    items: [
      ['apple-ipad-11th-gen', 1],
      ['logitech-mx-master-3s', 1],
    ],
  },
  {
    email: 'susu@example.com',
    items: [
      ['apple-watch-series-10', 1],
      ['samsung-galaxy-buds3-pro', 2],
    ],
  },
  {
    email: 'aunghtet@example.com',
    items: [
      ['nike-dri-fit-mens-training-tshirt', 2],
      ['adidas-4athlts-camper-backpack', 1],
    ],
  },
  {
    email: 'maythiri@example.com',
    items: [
      ['floral-midi-summer-dress', 1],
      ['gentle-hydrating-facial-cleanser', 2],
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

function validateSeedProductPricing(definition: ProductSeedDefinition): {
  price: Prisma.Decimal;
  originalPrice: Prisma.Decimal | null;
} {
  const price = new Prisma.Decimal(definition.price);
  if (price.lte(0)) {
    throw new Error(
      `Seed product ${definition.slug} has an invalid non-positive price.`,
    );
  }
  if (definition.originalPrice === null) {
    return { price, originalPrice: null };
  }
  const originalPrice = new Prisma.Decimal(definition.originalPrice);
  if (originalPrice.lte(price)) {
    throw new Error(
      `Seed product ${definition.slug} has originalPrice (${definition.originalPrice}) <= price (${definition.price}).`,
    );
  }
  return { price, originalPrice };
}

/**
 * Seed the designated development fixtures without replacing existing user,
 * stock, or cart values. Safe to run repeatedly on both empty and already-seeded
 * development databases; backfills missing optional seed metadata (such as
 * brandId, external imageUrl when imagePublicId is null, or originalPrice on
 * earlier seed fixtures) while never overwriting user-uploaded Cloudinary
 * assets or custom user modifications.
 */
export async function seedData(
  prisma: PrismaClient,
  defaultPassword: string,
): Promise<{
  roles: number;
  permissions: number;
  users: number;
  categories: number;
  brands: number;
  products: number;
  stocks: number;
  carts: number;
}> {
  validatePassword(defaultPassword);
  const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_COST);

  return prisma.$transaction(
    async (tx) => {
      // 1. Seed Roles
      const roles = new Map<string, { id: string }>();
      for (const [name, description] of roleDefinitions) {
        const role = await tx.role.upsert({
          where: { name },
          update: {},
          create: { name, description },
          select: { id: true },
        });
        roles.set(name, role);
      }
      const adminRole = roles.get('ADMIN');
      const staffRole = roles.get('STAFF');
      const customerRole = roles.get('CUSTOMER');
      if (!adminRole || !staffRole || !customerRole) {
        throw new Error('Required roles are unavailable.');
      }

      // 2. Seed Permissions and deterministic RolePermission links
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

        if (staffPermissionCodes.has(code)) {
          await tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: staffRole.id,
                permissionId: permission.id,
              },
            },
            update: {},
            create: { roleId: staffRole.id, permissionId: permission.id },
          });
        }

        if (customerPermissionCodes.has(code)) {
          await tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: customerRole.id,
                permissionId: permission.id,
              },
            },
            update: {},
            create: { roleId: customerRole.id, permissionId: permission.id },
          });
        }
      }

      const staffPermissions = await tx.rolePermission.findMany({
        where: { roleId: staffRole.id },
        select: { permission: { select: { code: true } } },
      });
      const staffElevatedPermissions = staffPermissions
        .map(({ permission }) => permission.code)
        .filter((code) => staffForbiddenPermissionCodes.has(code));
      if (staffElevatedPermissions.length > 0) {
        throw new Error(
          `Seed conflict: STAFF role already has restricted management permissions (${staffElevatedPermissions.join(', ')}). Existing RBAC assignments were not changed.`,
        );
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

      // 3. Seed Users
      const userIds = new Map<string, string>();
      for (const definition of userDefinitions) {
        const expectedRole = roles.get(definition.role);
        if (!expectedRole) {
          throw new Error(`Required role ${definition.role} is unavailable.`);
        }
        let user = await tx.user.findUnique({
          where: { email: definition.email },
          select: {
            id: true,
            role: { select: { name: true } },
          },
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
                phone: definition.phone,
                passwordHash,
                roleId: expectedRole.id,
                isActive: definition.isActive,
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

      const adminUserId = userIds.get('admin@example.com');
      if (!adminUserId) {
        throw new Error('Seed administrator account is unavailable.');
      }

      // 4. Seed Categories (backfills missing imageUrl/description when imagePublicId is null)
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
              imageUrl: definition.imageUrl,
              imagePublicId: null,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              imageUrl: true,
              imagePublicId: true,
              isActive: true,
            },
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
        const needsCategoryBackfill =
          (category.imageUrl === null && category.imagePublicId === null) ||
          category.description === null;
        if (needsCategoryBackfill && typeof tx.category.update === 'function') {
          await tx.category.update({
            where: { id: category.id },
            data: {
              ...(category.description === null && {
                description: definition.description,
              }),
              ...(category.imageUrl === null &&
                category.imagePublicId === null && {
                  imageUrl: definition.imageUrl,
                  imagePublicId: null,
                }),
            },
          });
        }
        categoryIds.set(definition.slug, category.id);
      }

      // 5. Seed Brands (preserves existing Cloudinary uploads while backfilling missing fields)
      const brandIds = new Map<string, string>();
      for (const definition of brandDefinitions) {
        let brand;
        try {
          brand = await tx.brand.upsert({
            where: { slug: definition.slug },
            update: {},
            create: {
              name: definition.name,
              slug: definition.slug,
              description: definition.description,
              imageUrl: definition.imageUrl,
              imagePublicId: null,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              imageUrl: true,
              imagePublicId: true,
              isActive: true,
            },
          });
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) {
            throw new Error(
              `Seed conflict for brand ${definition.slug}: its name or slug is already used by another record.`,
            );
          }
          throw error;
        }
        if (
          brand.name !== definition.name ||
          brand.slug !== definition.slug ||
          !brand.isActive
        ) {
          throw new Error(
            `Seed conflict: brand slug ${definition.slug} belongs to a different brand.`,
          );
        }
        const needsBrandBackfill =
          (brand.imageUrl === null && brand.imagePublicId === null) ||
          brand.description === null;
        if (needsBrandBackfill && typeof tx.brand.update === 'function') {
          await tx.brand.update({
            where: { id: brand.id },
            data: {
              ...(brand.description === null && {
                description: definition.description,
              }),
              ...(brand.imageUrl === null &&
                brand.imagePublicId === null && {
                  imageUrl: definition.imageUrl,
                  imagePublicId: null,
                }),
            },
          });
        }
        brandIds.set(definition.slug, brand.id);
      }

      // 6. Seed Products
      const productIds = new Map<string, string>();
      for (const definition of productDefinitions) {
        const categoryId = categoryIds.get(definition.category);
        if (!categoryId) {
          throw new Error(
            `Seed category ${definition.category} is unavailable.`,
          );
        }
        const expectedBrandId = definition.brand
          ? (brandIds.get(definition.brand) ?? null)
          : null;
        if (definition.brand && !expectedBrandId) {
          throw new Error(`Seed brand ${definition.brand} is unavailable.`);
        }
        const { price, originalPrice } = validateSeedProductPricing(definition);

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
              price,
              originalPrice,
              categoryId,
              brandId: expectedBrandId,
              imageUrl: definition.imageUrl,
              imagePublicId: null,
              isActive: definition.isActive,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              sku: true,
              categoryId: true,
              brandId: true,
              originalPrice: true,
              imageUrl: true,
              imagePublicId: true,
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
          product.isActive !== definition.isActive ||
          (product.brandId !== null &&
            product.brandId !== undefined &&
            product.brandId !== expectedBrandId)
        ) {
          throw new Error(
            `Seed conflict: product ${definition.slug} differs from its designated fixture. Existing product data was not changed.`,
          );
        }

        const shouldBackfillBrand =
          product.brandId === null && expectedBrandId !== null;
        const shouldBackfillImage =
          product.imageUrl === null &&
          (product.imagePublicId === null ||
            product.imagePublicId === undefined);
        const shouldBackfillOriginalPrice =
          product.originalPrice === null && originalPrice !== null;

        if (
          (shouldBackfillBrand ||
            shouldBackfillImage ||
            shouldBackfillOriginalPrice) &&
          typeof tx.product.update === 'function'
        ) {
          await tx.product.update({
            where: { id: product.id },
            data: {
              ...(shouldBackfillBrand && { brandId: expectedBrandId }),
              ...(shouldBackfillImage && {
                imageUrl: definition.imageUrl,
                imagePublicId: null,
              }),
              ...(shouldBackfillOriginalPrice && { originalPrice }),
            },
          });
        }

        productIds.set(definition.slug, product.id);
      }

      // 7. Seed Stock & INITIALIZATION StockMovements
      for (const definition of productDefinitions) {
        const productId = productIds.get(definition.slug);
        if (!productId) {
          throw new Error(`Seed product ${definition.slug} is unavailable.`);
        }
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
            userId: adminUserId,
            type: StockMovementType.INITIALIZATION,
            quantity: definition.stock,
            quantityBefore: 0,
            quantityAfter: definition.stock,
            note: INITIAL_STOCK_NOTE,
          },
        });
      }

      // 8. Seed Customer Carts
      for (const definition of cartDefinitions) {
        const userId = userIds.get(definition.email);
        if (!userId) {
          throw new Error(`Seed customer ${definition.email} is unavailable.`);
        }
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
        roles: roleDefinitions.length,
        permissions: permissionDefinitions.length,
        users: userDefinitions.length,
        categories: categoryDefinitions.length,
        brands: brandDefinitions.length,
        products: productDefinitions.length,
        stocks: productDefinitions.length,
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
  if (!connectionString) {
    throw new Error('Database connection is not configured.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const result = await seedData(prisma, defaultPassword);
    console.log(
      `Development seed completed: ${result.roles} roles, ${result.permissions} permissions, ${result.users} designated users, ${result.categories} categories, ${result.brands} brands, ${result.products} products (${result.stocks} stock records), and ${result.carts} carts are present. No credentials were logged.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await seed();
}

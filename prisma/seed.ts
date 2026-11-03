import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Database connection is not configured');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const permissions = [
  ['category:read', 'Read categories'],
  ['category:create', 'Create categories'],
  ['category:update', 'Update categories'],
  ['category:delete', 'Delete categories'],
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

export async function seed() {
 try {
  const admin = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Administrator role' },
  });
  await prisma.role.upsert({
    where: { name: 'CUSTOMER' },
    update: {},
    create: { name: 'CUSTOMER', description: 'Customer role' },
  });

  for (const [code, description] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description },
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: admin.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: admin.id, permissionId: permission.id },
    });
  }
 } finally {
  await prisma.$disconnect();
 }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await seed();
}

export async function disconnectSeedClient() {
  await prisma.$disconnect();
}

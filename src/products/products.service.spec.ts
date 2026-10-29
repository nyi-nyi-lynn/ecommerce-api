import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      category: { findUnique: vi.fn().mockResolvedValue({ id: 1 }) },
      product: {
        findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue({ id: 3 }),
        create: vi.fn(async ({ data }) => ({ id: 3, ...data })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        findMany: vi.fn().mockResolvedValue([{ id: 3, name: 'Tea' }]), count: vi.fn().mockResolvedValue(1),
      },
    };
    service = new ProductsService(prisma as PrismaService);
  });

  const valid = { name: 'Tea', slug: 'tea', sku: 'TEA-1', price: 5.25, categoryId: 1 };
  it('creates valid products with normalized optional data', async () => {
    const product = await service.create(valid);
    expect(product).toMatchObject({ name: 'Tea', slug: 'tea', sku: 'TEA-1', category: { connect: { id: 1 } } });
    expect(prisma.product.create).toHaveBeenCalledOnce();
  });
  it('checks category existence and product uniqueness', async () => {
    prisma.category.findUnique.mockResolvedValue(null);
    await expect(service.create(valid)).rejects.toBeInstanceOf(UnprocessableEntityException);
    prisma.category.findUnique.mockResolvedValue({ id: 1 });
    prisma.product.findFirst.mockResolvedValue({ id: 9 });
    await expect(service.create(valid)).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows retaining own identifiers and rejects identifiers owned by another product', async () => {
    await service.update(3, { sku: valid.sku, slug: valid.slug });
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: 3 } }) }));
    prisma.product.findFirst.mockResolvedValue({ id: 4 });
    await expect(service.update(3, { sku: 'OTHER' })).rejects.toBeInstanceOf(ConflictException);
  });
  it('filters public results to active products and returns matching pagination metadata', async () => {
    const result = await service.findAll({ page: 2, limit: 5, sortBy: 'price', sortOrder: 'asc', isActive: false });
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5, where: { isActive: true } }));
    expect(result.pagination).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
  });
  it('rejects inconsistent price ranges and hides inactive products', async () => {
    await expect(service.findAll({ minPrice: 9, maxPrice: 2 })).rejects.toBeInstanceOf(UnprocessableEntityException);
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.findOne(9)).rejects.toBeInstanceOf(NotFoundException);
  });
});

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
  it('persists image URL and Cloudinary public ID metadata', async () => {
    await service.create({ ...valid, imageUrl: 'https://example.com/tea.jpg' }, undefined, 7);
    await service.update(3, { imageUrl: 'https://example.com/tea-new.jpg' }, undefined, 7);
    expect(prisma.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: 'https://example.com/tea.jpg', imagePublicId: null }),
    }));
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: 'https://example.com/tea-new.jpg', imagePublicId: null }),
    }));
  });
  it('preserves imageUrl-only products when public ID is absent', async () => {
    await expect(service.create({ ...valid, imageUrl: 'https://example.com/external.jpg' }, undefined, 7)).resolves.toBeDefined();
  });
  it('deletes a previous Cloudinary asset only after the replacement is saved', async () => {
    const deleteImage = vi.fn().mockResolvedValue(true);
    const uploadImage = vi.fn().mockResolvedValue({
      secure_url: 'https://example.com/new.jpg',
      public_id: 'ecommerce/products/users/7/new',
    });
    service = new ProductsService(prisma as PrismaService, {
      uploadProductImage: uploadImage,
      deleteProductImage: deleteImage,
    } as any);
    prisma.product.findUnique.mockResolvedValue({
      id: 3,
      imageUrl: 'https://example.com/old.jpg',
      imagePublicId: 'ecommerce/products/users/7/old',
    });
    await service.update(3, {
      imageUrl: 'https://example.com/new.jpg',
    }, { buffer: Buffer.from([1]) } as Express.Multer.File, 7);
    expect(prisma.product.update.mock.invocationCallOrder[0]).toBeLessThan(deleteImage.mock.invocationCallOrder[0]);
    expect(deleteImage).toHaveBeenCalledWith('ecommerce/products/users/7/old');
  });
  it('cleans up a newly uploaded image when the product database update fails', async () => {
    const deleteImage = vi.fn().mockResolvedValue(true);
    const uploadImage = vi.fn().mockResolvedValue({
      secure_url: 'https://example.com/new.jpg',
      public_id: 'ecommerce/products/users/7/new',
    });
    service = new ProductsService(prisma as PrismaService, {
      uploadProductImage: uploadImage,
      deleteProductImage: deleteImage,
    } as any);
    prisma.product.findUnique.mockResolvedValue({ id: 3, imageUrl: null, imagePublicId: null });
    prisma.product.update.mockRejectedValueOnce(new Error('database failure'));
    await expect(service.update(3, {
      imageUrl: 'https://example.com/new.jpg',
    }, { buffer: Buffer.from([1]) } as Express.Multer.File, 7)).rejects.toThrow('database failure');
    expect(deleteImage).toHaveBeenCalledWith('ecommerce/products/users/7/new');
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
  it('keeps pagination offsets within the supported range at minimum, ordinary, and maximum pages', async () => {
    for (const [page, limit, expectedSkip] of [[1, 100, 0], [25, 40, 960], [10_000, 100, 999_900]]) {
      await service.findAll({ page, limit });
      expect(prisma.product.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
        skip: expectedSkip,
        take: limit,
      }));
    }
  });
  it('rejects inconsistent price ranges and hides inactive products', async () => {
    await expect(service.findAll({ minPrice: 9, maxPrice: 2 })).rejects.toBeInstanceOf(UnprocessableEntityException);
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.findOne(9)).rejects.toBeInstanceOf(NotFoundException);
  });
});

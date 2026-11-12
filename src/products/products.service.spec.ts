import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ProductsService } from './products.service.js';

describe('ProductsService', () => {
  const CATEGORY_ID = '00000000-0000-4000-8000-000000000001';
  const BRAND_ID = '00000000-0000-4000-8000-000000000003';
  const INACTIVE_BRAND_ID = '00000000-0000-4000-8000-000000000004';
  const MISSING_BRAND_ID = '00000000-0000-4000-8000-000000000005';
  const PRODUCT_ID = '00000000-0000-4000-8000-000000000010';
  const MISSING_PRODUCT_ID = '00000000-0000-4000-8000-000000000999';
  const USER_ID = '00000000-0000-4000-8000-000000000002';

  let service: ProductsService;
  let prisma: any;
  let uploads: any;

  const mockFile = {
    fieldname: 'image',
    originalname: 'product.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('test'),
  } as Express.Multer.File;

  beforeEach(() => {
    prisma = {
      category: {
        findUnique: vi.fn().mockResolvedValue({ id: CATEGORY_ID }),
      },
      brand: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.id === BRAND_ID) {
            return { id: BRAND_ID, isActive: true };
          }
          if (where.id === INACTIVE_BRAND_ID) {
            return { id: INACTIVE_BRAND_ID, isActive: false };
          }
          return null;
        }),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => ({
          id: PRODUCT_ID,
          ...data,
          categoryId: data.category?.connect?.id ?? CATEGORY_ID,
          category: {
            id: data.category?.connect?.id ?? CATEGORY_ID,
            name: 'Electronics',
            slug: 'electronics',
            imageUrl: null,
          },
          brandId: data.brand?.connect?.id ?? null,
          brand: data.brand?.connect?.id
            ? {
                id: data.brand.connect.id,
                name: 'Samsung',
                slug: 'samsung',
                imageUrl: null,
              }
            : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn(async ({ where, data }: any) => ({
          id: where.id,
          categoryId: data.category?.connect?.id ?? CATEGORY_ID,
          category: {
            id: data.category?.connect?.id ?? CATEGORY_ID,
            name: 'Electronics',
            slug: 'electronics',
            imageUrl: null,
          },
          name: 'Product',
          slug: 'product',
          sku: 'SKU-1',
          description: null,
          price: new Prisma.Decimal('10.00'),
          imageUrl: null,
          isActive: true,
          ...data,
          brandId: data.brand?.disconnect
            ? null
            : (data.brand?.connect?.id ?? null),
          brand: data.brand?.disconnect
            ? null
            : data.brand?.connect?.id
              ? {
                  id: data.brand.connect.id,
                  name: 'Samsung',
                  slug: 'samsung',
                  imageUrl: null,
                }
              : null,
        })),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    uploads = {
      uploadProductImage: vi.fn().mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/demo/image/upload/new.jpg',
        public_id: `ecommerce/products/users/${USER_ID}/new`,
      }),
      deleteProductImage: vi.fn().mockResolvedValue(true),
    };

    service = new ProductsService(prisma, uploads);
  });

  it('uploads a product image on create and persists imageUrl and imagePublicId', async () => {
    const created = await service.create(
      {
        name: '  Wireless Mouse  ',
        slug: '  wireless-mouse  ',
        sku: '  WM-01  ',
        price: 25.5,
        categoryId: CATEGORY_ID,
      },
      mockFile,
      USER_ID,
    );

    expect(uploads.uploadProductImage).toHaveBeenCalledWith(mockFile, USER_ID);
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Wireless Mouse',
          slug: 'wireless-mouse',
          sku: 'WM-01',
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/new.jpg',
          imagePublicId: `ecommerce/products/users/${USER_ID}/new`,
        }),
      }),
    );
    expect(created).toBeDefined();
  });

  it('cleans up the newly uploaded Cloudinary image when product creation fails in Prisma', async () => {
    prisma.product.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      service.create(
        {
          name: 'Wireless Mouse',
          slug: 'wireless-mouse',
          sku: 'WM-01',
          price: 25.5,
          categoryId: CATEGORY_ID,
        },
        mockFile,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(uploads.deleteProductImage).toHaveBeenCalledWith(
      `ecommerce/products/users/${USER_ID}/new`,
    );
  });

  it('supports imageUrl fallback when no file is uploaded and deletes previous Cloudinary asset on update', async () => {
    prisma.product.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === PRODUCT_ID) {
        return {
          id: PRODUCT_ID,
          imagePublicId: `ecommerce/products/users/${USER_ID}/old`,
        };
      }
      return null;
    });

    await service.update(
      PRODUCT_ID,
      { name: 'Updated Mouse' },
      mockFile,
      USER_ID,
    );

    expect(uploads.uploadProductImage).toHaveBeenCalledWith(mockFile, USER_ID);
    expect(uploads.deleteProductImage).toHaveBeenCalledWith(
      `ecommerce/products/users/${USER_ID}/old`,
    );
  });

  it('throws ServiceUnavailableException when an image file is provided but UploadsService is absent', async () => {
    const serviceWithoutUploads = new ProductsService(prisma, undefined);
    await expect(
      serviceWithoutUploads.create(
        {
          name: 'Mouse',
          slug: 'mouse',
          sku: 'M-1',
          price: 10,
          categoryId: CATEGORY_ID,
        },
        mockFile,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('paginates active products and rejects minPrice greater than maxPrice', async () => {
    await expect(
      service.findAll({ minPrice: 100, maxPrice: 50 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    prisma.product.findMany.mockResolvedValueOnce([
      { id: PRODUCT_ID, name: 'Mouse' },
    ]);
    prisma.product.count.mockResolvedValueOnce(1);

    const result = await service.findAll({ page: 2, limit: 5 });
    expect(result).toEqual({
      items: [
        {
          id: PRODUCT_ID,
          name: 'Mouse',
          category: null,
          brand: null,
          originalPrice: null,
          discountPercentage: null,
          stock: { availableQuantity: 0, inStock: false },
        },
      ],
      pagination: {
        page: 2,
        limit: 5,
        total: 1,
        totalPages: 1,
      },
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        include: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              imageUrl: true,
            },
          },
          brand: {
            select: {
              id: true,
              name: true,
              slug: true,
              imageUrl: true,
            },
          },
          stock: {
            select: {
              quantity: true,
              reservedQuantity: true,
              updatedAt: true,
            },
          },
        },
      }),
    );
  });

  it('maps initialized stock, zero available stock, reserved stock, and uninitialized stock across findAll, findOne, and findBySlug without exposing reservedQuantity', async () => {
    const stockUpdatedAt = new Date('2026-10-30T08:00:00.000Z');
    const productInStock = {
      id: PRODUCT_ID,
      name: 'In Stock Mouse',
      slug: 'in-stock-mouse',
      stock: {
        quantity: 25,
        reservedQuantity: 5,
        updatedAt: stockUpdatedAt,
      },
    };
    const productOutOfStock = {
      id: '00000000-0000-4000-8000-000000000011',
      name: 'Zero Stock Mouse',
      slug: 'zero-stock-mouse',
      stock: {
        quantity: 4,
        reservedQuantity: 4,
        updatedAt: stockUpdatedAt,
      },
    };
    const productUninitializedStock = {
      id: '00000000-0000-4000-8000-000000000012',
      name: 'No Stock Record Mouse',
      slug: 'no-stock-record-mouse',
      stock: null,
    };

    prisma.product.findMany.mockResolvedValueOnce([
      productInStock,
      productOutOfStock,
      productUninitializedStock,
    ]);
    prisma.product.count.mockResolvedValueOnce(3);

    const listResult = await service.findAll({
      categoryId: CATEGORY_ID,
      minPrice: 10,
      maxPrice: 200,
      search: 'Mouse',
      sortBy: 'price',
      sortOrder: 'asc',
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        categoryId: CATEGORY_ID,
        price: {
          gte: new Prisma.Decimal(10),
          lte: new Prisma.Decimal(200),
        },
        name: { contains: 'Mouse', mode: 'insensitive' },
      },
      skip: 0,
      take: 20,
      orderBy: [{ price: 'asc' }, { id: 'asc' }],
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            imageUrl: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
            imageUrl: true,
          },
        },
        stock: {
          select: {
            quantity: true,
            reservedQuantity: true,
            updatedAt: true,
          },
        },
      },
    });
    expect(listResult.items).toEqual([
      {
        id: PRODUCT_ID,
        name: 'In Stock Mouse',
        slug: 'in-stock-mouse',
        category: null,
        brand: null,
        originalPrice: null,
        discountPercentage: null,
        stock: {
          availableQuantity: 20,
          inStock: true,
          updatedAt: stockUpdatedAt,
        },
      },
      {
        id: '00000000-0000-4000-8000-000000000011',
        name: 'Zero Stock Mouse',
        slug: 'zero-stock-mouse',
        category: null,
        brand: null,
        originalPrice: null,
        discountPercentage: null,
        stock: {
          availableQuantity: 0,
          inStock: false,
          updatedAt: stockUpdatedAt,
        },
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        name: 'No Stock Record Mouse',
        slug: 'no-stock-record-mouse',
        category: null,
        brand: null,
        originalPrice: null,
        discountPercentage: null,
        stock: {
          availableQuantity: 0,
          inStock: false,
        },
      },
    ]);
    expect(listResult.items[0]?.stock).not.toHaveProperty('reservedQuantity');
    expect(listResult.items[0]?.stock).not.toHaveProperty('quantity');

    prisma.product.findFirst.mockResolvedValueOnce(productInStock);
    const byId = await service.findOne(PRODUCT_ID);
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, isActive: true },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            imageUrl: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
            imageUrl: true,
          },
        },
        stock: {
          select: {
            quantity: true,
            reservedQuantity: true,
            updatedAt: true,
          },
        },
      },
    });
    expect(byId.stock).toEqual({
      availableQuantity: 20,
      inStock: true,
      updatedAt: stockUpdatedAt,
    });
    expect(byId.stock).not.toHaveProperty('reservedQuantity');

    prisma.product.findFirst.mockResolvedValueOnce(productUninitializedStock);
    const bySlug = await service.findBySlug('no-stock-record-mouse');
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { slug: 'no-stock-record-mouse', isActive: true },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            imageUrl: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
            imageUrl: true,
          },
        },
        stock: {
          select: {
            quantity: true,
            reservedQuantity: true,
            updatedAt: true,
          },
        },
      },
    });
    expect(bySlug.stock).toEqual({
      availableQuantity: 0,
      inStock: false,
    });
  });

  it('creates products with and without brandId and discount, and rejects invalid/nonexistent/inactive brands', async () => {
    const discounted = await service.create({
      name: 'Galaxy S24',
      slug: 'galaxy-s24',
      brandId: BRAND_ID,
      sku: 'SAM-S24',
      price: 100000,
      originalPrice: 150000,
      categoryId: CATEGORY_ID,
    });

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brand: { connect: { id: BRAND_ID } },
          price: new Prisma.Decimal(100000),
          originalPrice: new Prisma.Decimal(150000),
        }),
      }),
    );
    expect(discounted).toMatchObject({
      category: {
        id: CATEGORY_ID,
        name: 'Electronics',
        slug: 'electronics',
        imageUrl: null,
      },
      brand: {
        id: BRAND_ID,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
      price: new Prisma.Decimal(100000),
      originalPrice: new Prisma.Decimal(150000),
      discountPercentage: 33.33,
    });
    expect(discounted).not.toHaveProperty('categoryId');
    expect(discounted).not.toHaveProperty('brandId');

    const regular = await service.create({
      name: 'Standard Cable',
      slug: 'standard-cable',
      sku: 'CAB-1',
      price: 15000,
      categoryId: CATEGORY_ID,
    });

    expect(regular).toMatchObject({
      category: {
        id: CATEGORY_ID,
        name: 'Electronics',
        slug: 'electronics',
        imageUrl: null,
      },
      brand: null,
      price: new Prisma.Decimal(15000),
      originalPrice: null,
      discountPercentage: null,
    });
    expect(regular).not.toHaveProperty('categoryId');
    expect(regular).not.toHaveProperty('brandId');

    // Reject invalid brand UUID, nonexistent brand, and inactive brand
    await expect(
      service.create({
        name: 'Bad Brand UUID',
        slug: 'bad-brand-uuid',
        brandId: 'not-a-uuid',
        sku: 'BAD-1',
        price: 10000,
        categoryId: CATEGORY_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create({
        name: 'Missing Brand',
        slug: 'missing-brand',
        brandId: MISSING_BRAND_ID,
        sku: 'MIS-1',
        price: 10000,
        categoryId: CATEGORY_ID,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await expect(
      service.create({
        name: 'Inactive Brand',
        slug: 'inactive-brand',
        brandId: INACTIVE_BRAND_ID,
        sku: 'INA-1',
        price: 10000,
        categoryId: CATEGORY_ID,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects originalPrice equal to or lower than price on create without uploading an image', async () => {
    await expect(
      service.create(
        {
          name: 'Equal Price Product',
          slug: 'equal-price',
          sku: 'EQ-1',
          price: 100000,
          originalPrice: 100000,
          categoryId: CATEGORY_ID,
        },
        mockFile,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(
        {
          name: 'Lower Original Price Product',
          slug: 'lower-orig',
          sku: 'LO-1',
          price: 100000,
          originalPrice: 80000,
          categoryId: CATEGORY_ID,
        },
        mockFile,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(uploads.uploadProductImage).not.toHaveBeenCalled();
  });

  it('updates brandId and originalPrice, supports removing brandId and originalPrice with null, and validates against existing database price/originalPrice', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: PRODUCT_ID,
      price: new Prisma.Decimal('100000.00'),
      originalPrice: new Prisma.Decimal('150000.00'),
      imageUrl: null,
      imagePublicId: null,
    });
    prisma.product.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      categoryId: CATEGORY_ID,
      category: {
        id: CATEGORY_ID,
        name: 'Electronics',
        slug: 'electronics',
        imageUrl: null,
      },
      name: 'Product',
      slug: 'product',
      sku: 'SKU-1',
      description: null,
      price: new Prisma.Decimal('100000.00'),
      originalPrice: new Prisma.Decimal('150000.00'),
      imageUrl: null,
      isActive: true,
      ...data,
      brandId: data.brand?.disconnect
        ? null
        : (data.brand?.connect?.id ?? BRAND_ID),
      brand: data.brand?.disconnect
        ? null
        : {
            id: data.brand?.connect?.id ?? BRAND_ID,
            name: 'Samsung',
            slug: 'samsung',
            imageUrl: null,
          },
    }));

    // Update brandId and originalPrice
    const updatedBrandAndDiscount = await service.update(PRODUCT_ID, {
      brandId: BRAND_ID,
      originalPrice: 200000,
    });
    expect(updatedBrandAndDiscount).toMatchObject({
      category: {
        id: CATEGORY_ID,
        name: 'Electronics',
        slug: 'electronics',
        imageUrl: null,
      },
      brand: {
        id: BRAND_ID,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
      originalPrice: new Prisma.Decimal(200000),
      discountPercentage: 50,
    });
    expect(updatedBrandAndDiscount).not.toHaveProperty('categoryId');
    expect(updatedBrandAndDiscount).not.toHaveProperty('brandId');

    // Remove brand with brandId: null without touching other fields
    const removedBrand = await service.update(PRODUCT_ID, { brandId: null });
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_ID },
        data: { brand: { disconnect: true } },
      }),
    );
    expect(removedBrand).toMatchObject({
      brand: null,
    });
    expect(removedBrand).not.toHaveProperty('brandId');

    // Updating price while preserving existing originalPrice (150000) when valid
    const updatedPrice = await service.update(PRODUCT_ID, { price: 120000 });
    expect(updatedPrice).toMatchObject({
      price: new Prisma.Decimal(120000),
      originalPrice: new Prisma.Decimal('150000.00'),
      discountPercentage: 20,
    });

    // Reject updating price to equal or exceed existing originalPrice (150000)
    await expect(
      service.update(PRODUCT_ID, { price: 150000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(PRODUCT_ID, { price: 160000 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Reject updating originalPrice to equal or fall below existing price (100000)
    await expect(
      service.update(PRODUCT_ID, { originalPrice: 100000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(PRODUCT_ID, { originalPrice: 90000 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Remove discount by setting originalPrice to null
    const removedDiscount = await service.update(PRODUCT_ID, {
      originalPrice: null,
    });
    expect(removedDiscount).toMatchObject({
      price: new Prisma.Decimal('100000.00'),
      originalPrice: null,
      discountPercentage: null,
    });

    // Clear description by setting description to null without touching omitted fields
    const clearedDescription = await service.update(PRODUCT_ID, {
      description: null,
    });
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_ID },
        data: { description: null },
      }),
    );
    expect(clearedDescription.description).toBeNull();

    // Update description with a new value
    const updatedDescription = await service.update(PRODUCT_ID, {
      description: '  Updated product description  ',
    });
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_ID },
        data: { description: 'Updated product description' },
      }),
    );
    expect(updatedDescription.description).toBe('Updated product description');

    // Update only name and verify Prisma data contains only name
    await service.update(PRODUCT_ID, { name: '  Only Name Updated  ' });
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_ID },
        data: { name: 'Only Name Updated' },
      }),
    );

    // Update only price and verify Prisma data contains only price
    await service.update(PRODUCT_ID, { price: 85000 });
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_ID },
        data: { price: new Prisma.Decimal(85000) },
      }),
    );
  });

  it('filters by brandId, brandSlug, and hasDiscount and supports sorting by originalPrice', async () => {
    prisma.product.findMany.mockResolvedValueOnce([]);
    prisma.product.count.mockResolvedValueOnce(0);

    await service.findAll({
      brandId: BRAND_ID,
      brandSlug: '  samsung  ',
      hasDiscount: true,
      sortBy: 'originalPrice',
      sortOrder: 'desc',
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          brandId: BRAND_ID,
          brand: { slug: 'samsung', isActive: true },
          originalPrice: { not: null },
        },
        orderBy: [{ originalPrice: 'desc' }, { id: 'asc' }],
      }),
    );

    prisma.product.findMany.mockResolvedValueOnce([]);
    prisma.product.count.mockResolvedValueOnce(0);

    await service.findAll({ hasDiscount: false });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          originalPrice: null,
        },
      }),
    );
  });

  it('throws NotFoundException when product or category does not exist', async () => {
    await expect(service.findOne(MISSING_PRODUCT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.findBySlug('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

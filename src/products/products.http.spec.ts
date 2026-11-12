import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

describe('Products HTTP', () => {
  const USER_CUSTOMER = '00000000-0000-4000-8000-000000000001';
  const USER_ADMIN = '00000000-0000-4000-8000-000000000002';
  const CATEGORY_1 = '00000000-0000-4000-8000-000000000001';
  const BRAND_1 = '00000000-0000-4000-8000-000000000011';
  const BRAND_INACTIVE = '00000000-0000-4000-8000-000000000012';
  const BRAND_MISSING = '00000000-0000-4000-8000-000000000099';
  const PRODUCT_1 = '00000000-0000-4000-8000-000000000001';
  const PRODUCT_2 = '00000000-0000-4000-8000-000000000002';
  const PRODUCT_3 = '00000000-0000-4000-8000-000000000003';
  const PRODUCT_9 = '00000000-0000-4000-8000-000000000009';
  const STOCK_UPDATED_AT = new Date('2026-10-30T08:00:00.000Z');

  let app: INestApplication;
  let prisma: any;
  let jwt: JwtService;
  let rows: any[];
  const product = {
    id: PRODUCT_1,
    categoryId: CATEGORY_1,
    category: {
      id: CATEGORY_1,
      name: 'Beverages',
      slug: 'beverages',
      imageUrl: null,
    },
    brandId: null,
    brand: null,
    name: 'Tea',
    slug: 'tea',
    sku: 'TEA-1',
    description: null,
    price: '5.25',
    originalPrice: null,
    imageUrl: null,
    isActive: true,
    createdAt: new Date('2026-10-30T07:00:00.000Z'),
    updatedAt: new Date('2026-10-30T07:00:00.000Z'),
    stock: {
      quantity: 15,
      reservedQuantity: 3,
      updatedAt: STOCK_UPDATED_AT,
    },
  };

  beforeEach(async () => {
    rows = [product];
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: {
            permissions: (where.id === USER_ADMIN
              ? ['product:create', 'product:update']
              : []
            ).map((code) => ({ permission: { code } })),
          },
        })),
      },
      category: { findUnique: vi.fn().mockResolvedValue({ id: CATEGORY_1 }) },
      brand: {
        findUnique: vi.fn(async ({ where }) => {
          if (where.id === BRAND_1) {
            return {
              id: BRAND_1,
              name: 'Samsung',
              slug: 'samsung',
              imageUrl: null,
              isActive: true,
            };
          }
          if (where.id === BRAND_INACTIVE) {
            return {
              id: BRAND_INACTIVE,
              name: 'OldBrand',
              slug: 'old-brand',
              imageUrl: null,
              isActive: false,
            };
          }
          return null;
        }),
      },
      product: {
        findFirst: vi.fn(
          async ({ where }) =>
            rows.find(
              (row) =>
                (where.id === undefined ||
                  row.id === where.id ||
                  (where.id.not !== undefined && row.id !== where.id.not)) &&
                (where.OR === undefined ||
                  where.OR.some(
                    (condition: any) =>
                      (condition.sku === undefined ||
                        row.sku === condition.sku) &&
                      (condition.slug === undefined ||
                        row.slug === condition.slug),
                  )) &&
                (where.sku === undefined || row.sku === where.sku) &&
                (where.slug === undefined || row.slug === where.slug) &&
                (where.isActive === undefined ||
                  row.isActive === where.isActive),
            ) ?? null,
        ),
        findUnique: vi.fn(
          async ({ where }) => rows.find((row) => row.id === where.id) ?? null,
        ),
        create: vi.fn(async ({ data }) => {
          const categoryId = data.category?.connect?.id ?? CATEGORY_1;
          const categoryObj = {
            id: categoryId,
            name: 'Beverages',
            slug: 'beverages',
            imageUrl: null,
          };
          const brandId = data.brand?.connect?.id ?? null;
          const brandObj = brandId
            ? {
                id: brandId,
                name: 'Samsung',
                slug: 'samsung',
                imageUrl: null,
              }
            : null;
          const row = {
            id: PRODUCT_2,
            ...data,
            categoryId,
            category: categoryObj,
            brandId,
            brand: brandObj,
            price: String(data.price),
            originalPrice:
              data.originalPrice != null ? String(data.originalPrice) : null,
            isActive: true,
          };
          rows.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }) => {
          const existing = rows.find((item) => item.id === where.id);
          const brandId = data.brand?.disconnect
            ? null
            : data.brand?.connect?.id !== undefined
              ? data.brand.connect.id
              : existing.brandId;
          const brandObj = brandId
            ? {
                id: brandId,
                name: 'Samsung',
                slug: 'samsung',
                imageUrl: null,
              }
            : null;
          const categoryId =
            data.category?.connect?.id !== undefined
              ? data.category.connect.id
              : existing.categoryId;
          const categoryObj = {
            id: categoryId,
            name: categoryId === CATEGORY_1 ? 'Beverages' : 'Updated Category',
            slug: categoryId === CATEGORY_1 ? 'beverages' : 'updated-category',
            imageUrl: null,
          };
          const row = {
            ...existing,
            ...data,
            categoryId,
            category: categoryObj,
            brandId,
            brand: brandObj,
            ...(data.price !== undefined && { price: String(data.price) }),
            ...(data.originalPrice !== undefined && {
              originalPrice:
                data.originalPrice !== null ? String(data.originalPrice) : null,
            }),
          };
          rows = rows.map((item) => (item.id === where.id ? row : item));
          return row;
        }),
        findMany: vi.fn(async ({ where, skip, take }) =>
          rows
            .filter(
              (row) =>
                row.isActive &&
                (!where.categoryId || row.categoryId === where.categoryId) &&
                (!where.brandId || row.brandId === where.brandId) &&
                (!where.brand?.slug || row.brand?.slug === where.brand.slug) &&
                (where.originalPrice === undefined ||
                  (where.originalPrice === null
                    ? row.originalPrice === null
                    : row.originalPrice !== null)),
            )
            .slice(skip, skip + take),
        ),
        count: vi.fn(
          async ({ where }) =>
            rows.filter(
              (row) =>
                row.isActive &&
                (!where.categoryId || row.categoryId === where.categoryId) &&
                (!where.brandId || row.brandId === where.brandId) &&
                (!where.brand?.slug || row.brand?.slug === where.brand.slug) &&
                (where.originalPrice === undefined ||
                  (where.originalPrice === null
                    ? row.originalPrice === null
                    : row.originalPrice !== null)),
            ).length,
        ),
      },
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'products-test-secret' })],
      controllers: [ProductsController],
      providers: [
        ProductsService,
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
      ],
    });
    jwt = app.get(JwtService);
  });
  afterEach(async () => app.close());

  const token = (id: string) =>
    jwt.sign({ sub: id, role: id === USER_CUSTOMER ? 'CUSTOMER' : 'ADMIN' });
  const valid = {
    name: 'Coffee',
    slug: 'coffee',
    sku: 'COF-1',
    price: 4.25,
    categoryId: CATEGORY_1,
  };

  it('validates creation data and returns the standard success envelope', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .send(valid)
      .expect(401);
    const bad = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ ...valid, price: 0 })
      .expect(400);
    expect(bad.body.success).toBe(false);
    const created = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send(valid)
      .expect(201);
    expect(created.body).toMatchObject({
      success: true,
      data: { name: 'Coffee', sku: 'COF-1' },
    });
    expect(created.body.data.data).toBeUndefined();
  });

  it('uses database permissions rather than JWT role claims for writes', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_CUSTOMER)}`)
      .send(valid)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_1}`)
      .set('Authorization', `Bearer ${token(USER_CUSTOMER)}`)
      .send({ name: 'Changed' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ name: 'Changed' })
      .expect(200);
  });

  it('keeps inactive products private, even when public query asks for isActive=false', async () => {
    rows = [
      product,
      { ...product, id: PRODUCT_9, slug: 'inactive', isActive: false },
    ];
    const list = await request(app.getHttpServer())
      .get('/api/products?isActive=false')
      .expect(200);
    expect(list.body.data.items.map((item: any) => item.id)).toEqual([
      PRODUCT_1,
    ]);
    expect(list.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
    });
    await request(app.getHttpServer())
      .get(`/api/products/${PRODUCT_9}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/products/slug/inactive')
      .expect(404);
  });

  it('supports product lookup by slug without route collision', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/products/slug/tea')
      .expect(200);
    expect(result.body.data.slug).toBe('tea');
    expect(result.body.data.stock).toEqual({
      availableQuantity: 12,
      inStock: true,
      updatedAt: STOCK_UPDATED_AT.toISOString(),
    });
    expect(result.body.data.stock).not.toHaveProperty('reservedQuantity');
  });

  it('returns public stock information on list, detail by ID, and detail by slug for in-stock, zero-stock, reserved, and uninitialized stock', async () => {
    const outOfStockProduct = {
      ...product,
      id: PRODUCT_2,
      name: 'Matcha',
      slug: 'matcha',
      sku: 'MAT-1',
      stock: {
        quantity: 5,
        reservedQuantity: 5,
        updatedAt: STOCK_UPDATED_AT,
      },
    };
    const uninitializedProduct = {
      ...product,
      id: PRODUCT_3,
      name: 'Oolong',
      slug: 'oolong',
      sku: 'OOL-1',
      stock: null,
    };
    rows = [product, outOfStockProduct, uninitializedProduct];

    const listResponse = await request(app.getHttpServer())
      .get('/api/products')
      .expect(200);

    expect(listResponse.body.data.items).toHaveLength(3);
    expect(listResponse.body.data.items[0].stock).toEqual({
      availableQuantity: 12,
      inStock: true,
      updatedAt: STOCK_UPDATED_AT.toISOString(),
    });
    expect(listResponse.body.data.items[0].stock).not.toHaveProperty(
      'reservedQuantity',
    );
    expect(listResponse.body.data.items[1].stock).toEqual({
      availableQuantity: 0,
      inStock: false,
      updatedAt: STOCK_UPDATED_AT.toISOString(),
    });
    expect(listResponse.body.data.items[2].stock).toEqual({
      availableQuantity: 0,
      inStock: false,
    });

    const byIdInStock = await request(app.getHttpServer())
      .get(`/api/products/${PRODUCT_1}`)
      .expect(200);
    expect(byIdInStock.body.data.stock).toEqual({
      availableQuantity: 12,
      inStock: true,
      updatedAt: STOCK_UPDATED_AT.toISOString(),
    });
    expect(byIdInStock.body.data.stock).not.toHaveProperty('reservedQuantity');

    const byIdOutOfStock = await request(app.getHttpServer())
      .get(`/api/products/${PRODUCT_2}`)
      .expect(200);
    expect(byIdOutOfStock.body.data.stock).toEqual({
      availableQuantity: 0,
      inStock: false,
      updatedAt: STOCK_UPDATED_AT.toISOString(),
    });

    const bySlugUninitialized = await request(app.getHttpServer())
      .get('/api/products/slug/oolong')
      .expect(200);
    expect(bySlugUninitialized.body.data.stock).toEqual({
      availableQuantity: 0,
      inStock: false,
    });
  });

  it('supports brandId and discount pricing across create, update, list, detail, slug, and filters', async () => {
    // Reject invalid brandId UUID, nonexistent brandId, and inactive brandId
    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        ...valid,
        brandId: 'not-a-uuid',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        ...valid,
        brandId: BRAND_MISSING,
      })
      .expect(422);

    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        ...valid,
        brandId: BRAND_INACTIVE,
      })
      .expect(422);

    // Reject originalPrice <= price on create
    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        ...valid,
        brandId: BRAND_1,
        price: 100000,
        originalPrice: 100000,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        ...valid,
        brandId: BRAND_1,
        price: 100000,
        originalPrice: 80000,
      })
      .expect(400);

    // Create product with brandId and discount
    const created = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        name: 'Galaxy Headphones',
        slug: 'galaxy-headphones',
        brandId: BRAND_1,
        sku: 'SAM-GH-1',
        price: 100000,
        originalPrice: 150000,
        categoryId: CATEGORY_1,
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      id: PRODUCT_2,
      category: {
        id: CATEGORY_1,
        name: 'Beverages',
        slug: 'beverages',
        imageUrl: null,
      },
      brand: {
        id: BRAND_1,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
      price: '100000',
      originalPrice: '150000',
      discountPercentage: 33.33,
    });
    expect(created.body.data).not.toHaveProperty('categoryId');
    expect(created.body.data).not.toHaveProperty('brandId');

    // Public detail by ID and slug include category, brand, price, originalPrice, discountPercentage without categoryId/brandId
    const detailById = await request(app.getHttpServer())
      .get(`/api/products/${PRODUCT_2}`)
      .expect(200);
    expect(detailById.body.data).toMatchObject({
      id: PRODUCT_2,
      category: {
        id: CATEGORY_1,
        name: 'Beverages',
        slug: 'beverages',
        imageUrl: null,
      },
      brand: {
        id: BRAND_1,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
      price: '100000',
      originalPrice: '150000',
      discountPercentage: 33.33,
    });
    expect(detailById.body.data).not.toHaveProperty('categoryId');
    expect(detailById.body.data).not.toHaveProperty('brandId');

    const detailBySlug = await request(app.getHttpServer())
      .get('/api/products/slug/galaxy-headphones')
      .expect(200);
    expect(detailBySlug.body.data).toMatchObject({
      id: PRODUCT_2,
      category: {
        id: CATEGORY_1,
        name: 'Beverages',
        slug: 'beverages',
        imageUrl: null,
      },
      brand: {
        id: BRAND_1,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
      price: '100000',
      originalPrice: '150000',
      discountPercentage: 33.33,
    });
    expect(detailBySlug.body.data).not.toHaveProperty('categoryId');
    expect(detailBySlug.body.data).not.toHaveProperty('brandId');

    // Filter by brandId, brandSlug, and hasDiscount
    const filteredByBrandId = await request(app.getHttpServer())
      .get(`/api/products?brandId=${BRAND_1}&hasDiscount=true`)
      .expect(200);
    expect(filteredByBrandId.body.data.items).toHaveLength(1);
    expect(filteredByBrandId.body.data.items[0].id).toBe(PRODUCT_2);

    const filteredByBrandSlug = await request(app.getHttpServer())
      .get('/api/products?brandSlug=samsung')
      .expect(200);
    expect(filteredByBrandSlug.body.data.items).toHaveLength(1);
    expect(filteredByBrandSlug.body.data.items[0].id).toBe(PRODUCT_2);

    const filteredNonDiscounted = await request(app.getHttpServer())
      .get('/api/products?hasDiscount=false')
      .expect(200);
    expect(filteredNonDiscounted.body.data.items).toHaveLength(1);
    expect(filteredNonDiscounted.body.data.items[0].id).toBe(PRODUCT_1);
    expect(filteredNonDiscounted.body.data.items[0]).not.toHaveProperty(
      'categoryId',
    );
    expect(filteredNonDiscounted.body.data.items[0]).not.toHaveProperty(
      'brandId',
    );
    expect(filteredNonDiscounted.body.data.items[0].category).toEqual({
      id: CATEGORY_1,
      name: 'Beverages',
      slug: 'beverages',
      imageUrl: null,
    });
    expect(filteredNonDiscounted.body.data.items[0].brand).toBeNull();
    expect(
      filteredNonDiscounted.body.data.items[0].discountPercentage,
    ).toBeNull();

    // Reject update when new price >= existing originalPrice (150000)
    await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_2}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ price: 150000 })
      .expect(400);

    // Update price while keeping valid existing originalPrice (150000)
    const updatedPrice = await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_2}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ price: 75000 })
      .expect(200);
    expect(updatedPrice.body.data).toMatchObject({
      price: '75000',
      originalPrice: '150000',
      discountPercentage: 50,
    });

    // Remove brand with brandId: null and remove discount with originalPrice: null
    const removedBrandAndDiscount = await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_2}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ brandId: null, originalPrice: null })
      .expect(200);
    expect(removedBrandAndDiscount.body.data).toMatchObject({
      brand: null,
      price: '75000',
      originalPrice: null,
      discountPercentage: null,
    });
    expect(removedBrandAndDiscount.body.data).not.toHaveProperty('brandId');
    expect(removedBrandAndDiscount.body.data).not.toHaveProperty('categoryId');
  });

  it('supports partial updates on PATCH /api/products/:id while preserving omitted fields, handling nullable fields, and rejecting invalid values', async () => {
    const CATEGORY_2 = '00000000-0000-4000-8000-000000000022';
    prisma.category.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === CATEGORY_1 || where.id === CATEGORY_2
        ? { id: where.id }
        : null,
    );

    // Seed a product with all fields populated
    rows = [
      {
        id: PRODUCT_1,
        categoryId: CATEGORY_1,
        category: {
          id: CATEGORY_1,
          name: 'Beverages',
          slug: 'beverages',
          imageUrl: null,
        },
        brandId: BRAND_1,
        brand: {
          id: BRAND_1,
          name: 'Samsung',
          slug: 'samsung',
          imageUrl: null,
        },
        name: 'Original Name',
        slug: 'original-slug',
        sku: 'ORIG-SKU-1',
        description: 'Original description.',
        price: '100000.00',
        originalPrice: '150000.00',
        imageUrl: 'https://cdn.example.com/original.jpg',
        imagePublicId: null,
        isActive: true,
        createdAt: new Date('2026-10-30T07:00:00.000Z'),
        updatedAt: new Date('2026-10-30T07:00:00.000Z'),
        stock: {
          quantity: 15,
          reservedQuantity: 3,
          updatedAt: STOCK_UPDATED_AT,
        },
      },
    ];

    // 1. Update only name (preserving slug, sku, price, originalPrice, brand, category, description)
    const nameOnly = await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ name: 'Updated Name Only' })
      .expect(200);
    expect(nameOnly.body.data).toMatchObject({
      id: PRODUCT_1,
      name: 'Updated Name Only',
      slug: 'original-slug',
      sku: 'ORIG-SKU-1',
      description: 'Original description.',
      price: '100000.00',
      originalPrice: '150000.00',
      discountPercentage: 33.33,
      category: {
        id: CATEGORY_1,
        name: 'Beverages',
        slug: 'beverages',
        imageUrl: null,
      },
      brand: {
        id: BRAND_1,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
      isActive: true,
    });
    expect(nameOnly.body.data).not.toHaveProperty('categoryId');
    expect(nameOnly.body.data).not.toHaveProperty('brandId');
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_1 },
        data: { name: 'Updated Name Only' },
      }),
    );

    // 2. Update only price (preserving name, slug, sku, originalPrice, brand, category, description)
    const priceOnly = await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ price: 120000 })
      .expect(200);
    expect(priceOnly.body.data).toMatchObject({
      id: PRODUCT_1,
      name: 'Updated Name Only',
      slug: 'original-slug',
      sku: 'ORIG-SKU-1',
      price: '120000',
      originalPrice: '150000.00',
      discountPercentage: 20,
      category: {
        id: CATEGORY_1,
        name: 'Beverages',
        slug: 'beverages',
        imageUrl: null,
      },
      brand: {
        id: BRAND_1,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
    });
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_1 },
        data: { price: expect.anything() },
      }),
    );
    expect(
      Object.keys(
        (prisma.product.update as ReturnType<typeof vi.fn>).mock.lastCall?.[0]
          ?.data ?? {},
      ),
    ).toEqual(['price']);

    // 3. Update multiple fields at once
    const multiUpdate = await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        name: 'Multi Updated Name',
        price: 90000,
        originalPrice: 180000,
        description: 'Updated description text.',
        categoryId: CATEGORY_2,
        isActive: false,
      })
      .expect(200);
    expect(multiUpdate.body.data).toMatchObject({
      id: PRODUCT_1,
      name: 'Multi Updated Name',
      slug: 'original-slug',
      sku: 'ORIG-SKU-1',
      description: 'Updated description text.',
      price: '90000',
      originalPrice: '180000',
      discountPercentage: 50,
      category: {
        id: CATEGORY_2,
        name: 'Updated Category',
        slug: 'updated-category',
        imageUrl: null,
      },
      brand: {
        id: BRAND_1,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
      isActive: false,
    });

    // 4. Multipart form-data partial update with empty string fields (as sent by Swagger UI / HTML forms)
    const multipartPartial = await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .field('name', 'Multipart Name Only')
      .field('slug', '')
      .field('sku', '')
      .field('price', '')
      .field('originalPrice', '')
      .field('brandId', '')
      .field('categoryId', '')
      .field('description', '')
      .expect(200);
    expect(multipartPartial.body.data).toMatchObject({
      id: PRODUCT_1,
      name: 'Multipart Name Only',
      slug: 'original-slug',
      sku: 'ORIG-SKU-1',
      description: 'Updated description text.',
      price: '90000',
      originalPrice: '180000',
      brand: {
        id: BRAND_1,
        name: 'Samsung',
        slug: 'samsung',
        imageUrl: null,
      },
    });
    expect(prisma.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_1 },
        data: { name: 'Multipart Name Only' },
      }),
    );

    // 5. Handle nullable fields: brandId: null, originalPrice: null, description: null
    const clearedNullable = await request(app.getHttpServer())
      .patch(`/api/products/${PRODUCT_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        brandId: null,
        originalPrice: null,
        description: null,
      })
      .expect(200);
    expect(clearedNullable.body.data).toMatchObject({
      id: PRODUCT_1,
      name: 'Multipart Name Only',
      brand: null,
      originalPrice: null,
      discountPercentage: null,
      description: null,
    });
    expect(clearedNullable.body.data).not.toHaveProperty('brandId');
    expect(clearedNullable.body.data).not.toHaveProperty('categoryId');

    // 6. Reject invalid provided values & invalid UUIDs & explicit null on non-nullable fields
    prisma.product.update.mockClear();

    for (const invalidPayload of [
      { name: '' },
      { name: '   ' },
      { name: null },
      { slug: '' },
      { slug: null },
      { sku: '' },
      { sku: null },
      { price: 0 },
      { price: -10 },
      { price: 'not-a-number' },
      { price: null },
      { originalPrice: 0 },
      { originalPrice: -5 },
      { price: 100000, originalPrice: 100000 },
      { price: 100000, originalPrice: 80000 },
      { categoryId: 'not-a-uuid' },
      { categoryId: '' },
      { categoryId: null },
      { brandId: 'not-a-uuid' },
      { brandId: '' },
      { isActive: 'not-a-boolean' },
      { isActive: null },
      { imageUrl: 'not-a-url' },
      { imageUrl: null },
    ]) {
      const response = await request(app.getHttpServer())
        .patch(`/api/products/${PRODUCT_1}`)
        .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
        .send(invalidPayload)
        .expect(400);
      expect(response.body.success).toBe(false);
    }

    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('accepts bounded pages and rejects excessive pages before querying Prisma', async () => {
    const findMany = prisma.product.findMany as ReturnType<typeof vi.fn>;
    const count = prisma.product.count as ReturnType<typeof vi.fn>;

    for (const [query, expectedSkip] of [
      ['page=1&limit=100', 0],
      ['page=25&limit=40', 960],
      ['page=10000&limit=100', 999_900],
    ]) {
      findMany.mockClear();
      count.mockClear();
      await request(app.getHttpServer())
        .get(`/api/products?${query}`)
        .expect(200);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: expectedSkip }),
      );
      expect(count).toHaveBeenCalledOnce();
    }

    for (const page of ['10001', '999999999999999999999999999999']) {
      findMany.mockClear();
      count.mockClear();
      const response = await request(app.getHttpServer())
        .get(`/api/products?page=${page}`)
        .expect(400);
      expect(response.body).toMatchObject({ success: false, statusCode: 400 });
      expect(findMany).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
    }
  });
});

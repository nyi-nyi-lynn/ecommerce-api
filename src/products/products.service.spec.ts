import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ProductsService } from './products.service.js';

describe('ProductsService', () => {
  const CATEGORY_ID = '00000000-0000-4000-8000-000000000001';
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
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => ({
          id: PRODUCT_ID,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn(async ({ where, data }: any) => ({
          id: where.id,
          categoryId: CATEGORY_ID,
          name: 'Product',
          slug: 'product',
          sku: 'SKU-1',
          description: null,
          price: new Prisma.Decimal('10.00'),
          imageUrl: null,
          isActive: true,
          ...data,
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

    await service.update(PRODUCT_ID, { name: 'Updated Mouse' }, mockFile, USER_ID);

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

    prisma.product.findMany.mockResolvedValueOnce([{ id: PRODUCT_ID, name: 'Mouse' }]);
    prisma.product.count.mockResolvedValueOnce(1);

    const result = await service.findAll({ page: 2, limit: 5 });
    expect(result).toEqual({
      items: [{ id: PRODUCT_ID, name: 'Mouse' }],
      pagination: {
        page: 2,
        limit: 5,
        total: 1,
        totalPages: 1,
      },
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
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


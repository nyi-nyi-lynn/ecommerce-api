import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ProductsService } from './products.service.js';

describe('ProductsService', () => {
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
        findUnique: vi.fn().mockResolvedValue({ id: 1 }),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => ({
          id: 10,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn(async ({ where, data }: any) => ({
          id: where.id,
          categoryId: 1,
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
        public_id: 'ecommerce/products/users/2/new',
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
        categoryId: 1,
      },
      mockFile,
      2,
    );

    expect(uploads.uploadProductImage).toHaveBeenCalledWith(mockFile, 2);
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Wireless Mouse',
          slug: 'wireless-mouse',
          sku: 'WM-01',
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/new.jpg',
          imagePublicId: 'ecommerce/products/users/2/new',
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
          categoryId: 1,
        },
        mockFile,
        2,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(uploads.deleteProductImage).toHaveBeenCalledWith(
      'ecommerce/products/users/2/new',
    );
  });

  it('supports imageUrl fallback when no file is uploaded and deletes previous Cloudinary asset on update', async () => {
    prisma.product.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 10) {
        return {
          id: 10,
          imagePublicId: 'ecommerce/products/users/2/old',
        };
      }
      return null;
    });

    await service.update(10, { name: 'Updated Mouse' }, mockFile, 2);

    expect(uploads.uploadProductImage).toHaveBeenCalledWith(mockFile, 2);
    expect(uploads.deleteProductImage).toHaveBeenCalledWith(
      'ecommerce/products/users/2/old',
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
          categoryId: 1,
        },
        mockFile,
        2,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('paginates active products and rejects minPrice greater than maxPrice', async () => {
    await expect(
      service.findAll({ minPrice: 100, maxPrice: 50 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    prisma.product.findMany.mockResolvedValueOnce([{ id: 10, name: 'Mouse' }]);
    prisma.product.count.mockResolvedValueOnce(1);

    const result = await service.findAll({ page: 2, limit: 5 });
    expect(result).toEqual({
      items: [{ id: 10, name: 'Mouse' }],
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
    await expect(service.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findBySlug('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});


import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BrandsService } from './brands.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';

describe('BrandsService', () => {
  const BRAND_ID = '00000000-0000-4000-8000-000000000001';
  const MISSING_BRAND_ID = '00000000-0000-4000-8000-000000000099';
  const USER_ID = '00000000-0000-4000-8000-000000000007';

  let service: BrandsService;
  let prisma: any;
  let uploads: {
    uploadBrandImage: ReturnType<typeof vi.fn>;
    deleteBrandImage: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      brand: {
        create: vi.fn(async ({ data }) => ({ id: BRAND_ID, ...data })),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({
          id: BRAND_ID,
          imageUrl: null,
          imagePublicId: null,
        }),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi.fn(async ({ where }) => ({ id: where.id })),
      },
    };
    uploads = {
      uploadBrandImage: vi.fn(),
      deleteBrandImage: vi.fn().mockResolvedValue(true),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: uploads },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a brand without an image', async () => {
    await service.create({ name: '  Samsung  ', slug: '  samsung  ' });
    expect(uploads.uploadBrandImage).not.toHaveBeenCalled();
    expect(prisma.brand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Samsung',
          slug: 'samsung',
          imageUrl: null,
          imagePublicId: null,
          isActive: true,
        }),
      }),
    );
  });

  it('uploads and persists brand image metadata', async () => {
    uploads.uploadBrandImage.mockResolvedValue({
      secure_url: 'https://example.com/brand.jpg',
      public_id: `ecommerce/brands/users/${USER_ID}/brand`,
    });
    const image = { buffer: Buffer.from('image') } as Express.Multer.File;

    await service.create(
      { name: 'Samsung', slug: 'samsung' },
      image,
      USER_ID,
    );

    expect(uploads.uploadBrandImage).toHaveBeenCalledWith(image, USER_ID);
    expect(prisma.brand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageUrl: 'https://example.com/brand.jpg',
          imagePublicId: `ecommerce/brands/users/${USER_ID}/brand`,
        }),
      }),
    );
  });

  it('rejects duplicate name or slug on create and cleans up uploaded image', async () => {
    uploads.uploadBrandImage.mockResolvedValue({
      secure_url: 'https://example.com/brand.jpg',
      public_id: `ecommerce/brands/users/${USER_ID}/brand`,
    });
    prisma.brand.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      service.create(
        { name: 'Samsung', slug: 'samsung' },
        {} as Express.Multer.File,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(uploads.deleteBrandImage).toHaveBeenCalledWith(
      `ecommerce/brands/users/${USER_ID}/brand`,
    );
  });

  it('throws ServiceUnavailableException when image is provided without UploadsService', async () => {
    const serviceWithoutUploads = new BrandsService(prisma, undefined);
    await expect(
      serviceWithoutUploads.create(
        { name: 'Samsung', slug: 'samsung' },
        {} as Express.Multer.File,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lists active brands with pagination, sorting, and search', async () => {
    prisma.brand.findMany.mockResolvedValueOnce([
      { id: BRAND_ID, name: 'Samsung', slug: 'samsung', isActive: true },
    ]);
    prisma.brand.count.mockResolvedValueOnce(1);

    const result = await service.findAll({
      page: 2,
      limit: 10,
      search: 'Sam',
      sortBy: 'name',
      sortOrder: 'asc',
    });

    expect(prisma.brand.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        name: { contains: 'Sam', mode: 'insensitive' },
      },
      skip: 10,
      take: 10,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    expect(result).toEqual({
      items: [{ id: BRAND_ID, name: 'Samsung', slug: 'samsung', isActive: true }],
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it('returns an active brand by ID and throws NotFoundException when missing', async () => {
    prisma.brand.findFirst.mockResolvedValueOnce({
      id: BRAND_ID,
      name: 'Samsung',
      slug: 'samsung',
      isActive: true,
    });
    await expect(service.findOne(BRAND_ID)).resolves.toMatchObject({
      id: BRAND_ID,
      name: 'Samsung',
    });

    prisma.brand.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne(MISSING_BRAND_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('replaces a brand image only after persistence and deletes the old image afterward', async () => {
    prisma.brand.findUnique.mockResolvedValue({
      id: BRAND_ID,
      imageUrl: 'https://example.com/old.jpg',
      imagePublicId: `ecommerce/brands/users/${USER_ID}/old`,
    });
    uploads.uploadBrandImage.mockResolvedValue({
      secure_url: 'https://example.com/new.jpg',
      public_id: `ecommerce/brands/users/${USER_ID}/new`,
    });

    await service.update(
      BRAND_ID,
      { name: 'Samsung Electronics' },
      {} as Express.Multer.File,
      USER_ID,
    );

    expect(prisma.brand.update.mock.invocationCallOrder[0]).toBeLessThan(
      uploads.deleteBrandImage.mock.invocationCallOrder[0],
    );
    expect(uploads.deleteBrandImage).toHaveBeenCalledWith(
      `ecommerce/brands/users/${USER_ID}/old`,
    );
  });

  it('deletes an unused brand and cleans up its Cloudinary image', async () => {
    prisma.brand.findUnique.mockResolvedValue({
      id: BRAND_ID,
      imagePublicId: `ecommerce/brands/users/${USER_ID}/brand`,
    });

    await expect(service.remove(BRAND_ID)).resolves.toEqual({
      id: BRAND_ID,
    });
    expect(prisma.brand.delete.mock.invocationCallOrder[0]).toBeLessThan(
      uploads.deleteBrandImage.mock.invocationCallOrder[0],
    );
    expect(uploads.deleteBrandImage).toHaveBeenCalledWith(
      `ecommerce/brands/users/${USER_ID}/brand`,
    );
  });

  it('rejects deleting a brand referenced by products without deleting its Cloudinary image', async () => {
    prisma.brand.findUnique.mockResolvedValue({
      id: BRAND_ID,
      imagePublicId: `ecommerce/brands/users/${USER_ID}/brand`,
    });
    prisma.brand.delete.mockRejectedValueOnce({ code: 'P2003' });

    await expect(service.remove(BRAND_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(uploads.deleteBrandImage).not.toHaveBeenCalled();
  });

  it('preserves existing description when omitted on update, clears it when null, and updates it when a new description is provided', async () => {
    let stored: any = null;
    prisma.brand.create.mockImplementationOnce(async ({ data }: any) => {
      stored = { id: BRAND_ID, ...data };
      return stored;
    });
    prisma.brand.findUnique.mockImplementation(async ({ where }: any) =>
      stored && where.id === stored.id ? stored : null,
    );
    prisma.brand.update.mockImplementation(async ({ data }: any) => {
      stored = { ...stored, ...data };
      return stored;
    });

    // 1. Create a brand with a non-null description
    const created = await service.create({
      name: 'Samsung',
      slug: 'samsung',
      description: 'Initial brand description',
    });
    expect(created.description).toBe('Initial brand description');

    // 2 & 3. PATCH only its name -> existing description remains unchanged
    const afterNamePatch = await service.update(BRAND_ID, {
      name: '  Samsung Electronics  ',
    });
    expect(afterNamePatch.name).toBe('Samsung Electronics');
    expect(afterNamePatch.description).toBe('Initial brand description');
    expect(prisma.brand.update).toHaveBeenLastCalledWith({
      where: { id: BRAND_ID },
      data: { name: 'Samsung Electronics' },
    });

    // 4 & 5. PATCH with description: null -> description is cleared
    const afterClearPatch = await service.update(BRAND_ID, {
      description: null,
    });
    expect(afterClearPatch.description).toBeNull();
    expect(prisma.brand.update).toHaveBeenLastCalledWith({
      where: { id: BRAND_ID },
      data: { description: null },
    });

    // 6 & 7. PATCH with a new description -> description is updated
    const afterNewDescPatch = await service.update(BRAND_ID, {
      description: '  New brand description  ',
    });
    expect(afterNewDescPatch.description).toBe('New brand description');
    expect(prisma.brand.update).toHaveBeenLastCalledWith({
      where: { id: BRAND_ID },
      data: { description: 'New brand description' },
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { NotFoundException } from '@nestjs/common';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: any;
  let uploads: {
    uploadCategoryImage: ReturnType<typeof vi.fn>;
    deleteCategoryImage: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      category: {
        create: vi.fn(async ({ data }) => ({ id: 1, ...data })),
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 1, imageUrl: null, imagePublicId: null }),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi.fn(async ({ where }) => ({ id: where.id })),
      },
    };
    uploads = {
      uploadCategoryImage: vi.fn(),
      deleteCategoryImage: vi.fn().mockResolvedValue(true),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: uploads },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a category without an image', async () => {
    await service.create({ name: 'Electronics', slug: 'electronics' });
    expect(uploads.uploadCategoryImage).not.toHaveBeenCalled();
    expect(prisma.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageUrl: null, imagePublicId: null }),
      }),
    );
  });

  it('uploads and persists category image metadata', async () => {
    uploads.uploadCategoryImage.mockResolvedValue({
      secure_url: 'https://example.com/category.jpg',
      public_id: 'ecommerce/categories/users/7/category',
    });
    const image = { buffer: Buffer.from('image') } as Express.Multer.File;

    await service.create(
      { name: 'Electronics', slug: 'electronics' },
      image,
      7,
    );

    expect(uploads.uploadCategoryImage).toHaveBeenCalledWith(image, 7);
    expect(prisma.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageUrl: 'https://example.com/category.jpg',
          imagePublicId: 'ecommerce/categories/users/7/category',
        }),
      }),
    );
  });

  it('cleans up a new image when category creation fails', async () => {
    uploads.uploadCategoryImage.mockResolvedValue({
      secure_url: 'https://example.com/category.jpg',
      public_id: 'ecommerce/categories/users/7/category',
    });
    prisma.category.create.mockRejectedValueOnce(new Error('database failure'));

    await expect(
      service.create(
        { name: 'Electronics', slug: 'electronics' },
        {} as Express.Multer.File,
        7,
      ),
    ).rejects.toThrow('database failure');
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      'ecommerce/categories/users/7/category',
    );
  });

  it('preserves category image metadata when updating without a new image', async () => {
    await service.update(1, { name: 'Electronics' });
    expect(prisma.category.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          imageUrl: expect.anything(),
          imagePublicId: expect.anything(),
        }),
      }),
    );
  });

  it('replaces a category image only after persistence and deletes the old image afterward', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 1,
      imageUrl: 'https://example.com/old.jpg',
      imagePublicId: 'ecommerce/categories/users/7/old',
    });
    uploads.uploadCategoryImage.mockResolvedValue({
      secure_url: 'https://example.com/new.jpg',
      public_id: 'ecommerce/categories/users/7/new',
    });
    const image = {} as Express.Multer.File;

    await service.update(1, {}, image, 7);

    expect(prisma.category.update.mock.invocationCallOrder[0]).toBeLessThan(
      uploads.deleteCategoryImage.mock.invocationCallOrder[0],
    );
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      'ecommerce/categories/users/7/old',
    );
  });

  it('cleans up a new image when category update fails', async () => {
    uploads.uploadCategoryImage.mockResolvedValue({
      secure_url: 'https://example.com/new.jpg',
      public_id: 'ecommerce/categories/users/7/new',
    });
    prisma.category.update.mockRejectedValueOnce(new Error('database failure'));

    await expect(
      service.update(1, {}, {} as Express.Multer.File, 7),
    ).rejects.toThrow('database failure');
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      'ecommerce/categories/users/7/new',
    );
  });

  it('deletes a category without an image without Cloudinary cleanup', async () => {
    await expect(service.remove(1)).resolves.toEqual({ id: 1 });
    expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(uploads.deleteCategoryImage).not.toHaveBeenCalled();
  });

  it('deletes the category image after database deletion', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 1,
      imagePublicId: 'ecommerce/categories/users/7/category',
    });

    await expect(service.remove(1)).resolves.toEqual({ id: 1 });
    expect(prisma.category.delete.mock.invocationCallOrder[0]).toBeLessThan(
      uploads.deleteCategoryImage.mock.invocationCallOrder[0],
    );
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      'ecommerce/categories/users/7/category',
    );
  });

  it('does not trigger Cloudinary deletion for a nonexistent category', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.category.delete).not.toHaveBeenCalled();
    expect(uploads.deleteCategoryImage).not.toHaveBeenCalled();
  });

  it('does not trigger Cloudinary deletion when database deletion fails', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 1,
      imagePublicId: 'ecommerce/categories/users/7/category',
    });
    prisma.category.delete.mockRejectedValueOnce(new Error('database failure'));

    await expect(service.remove(1)).rejects.toThrow('database failure');
    expect(uploads.deleteCategoryImage).not.toHaveBeenCalled();
  });

  it('logs Cloudinary cleanup failure without changing successful database deletion', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 1,
      imagePublicId: 'ecommerce/categories/users/7/category',
    });
    uploads.deleteCategoryImage.mockResolvedValue(false);
    const logSpy = vi
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.remove(1)).resolves.toEqual({ id: 1 });
    expect(logSpy).toHaveBeenCalledWith(
      'Cloudinary category image cleanup failed for category 1 and public ID ecommerce/categories/users/7/category.',
    );
  });
});

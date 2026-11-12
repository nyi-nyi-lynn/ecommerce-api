import { INestApplication, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';

describe('CategoriesService', () => {
  const CATEGORY_ID = '00000000-0000-4000-8000-000000000001';
  const MISSING_CATEGORY_ID = '00000000-0000-4000-8000-000000000099';
  const USER_ID = '00000000-0000-4000-8000-000000000007';

  let service: CategoriesService;
  let prisma: any;
  let uploads: {
    uploadCategoryImage: ReturnType<typeof vi.fn>;
    deleteCategoryImage: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      category: {
        create: vi.fn(async ({ data }) => ({ id: CATEGORY_ID, ...data })),
        findUnique: vi.fn().mockResolvedValue({
          id: CATEGORY_ID,
          imageUrl: null,
          imagePublicId: null,
        }),
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
      public_id: `ecommerce/categories/users/${USER_ID}/category`,
    });
    const image = { buffer: Buffer.from('image') } as Express.Multer.File;

    await service.create(
      { name: 'Electronics', slug: 'electronics' },
      image,
      USER_ID,
    );

    expect(uploads.uploadCategoryImage).toHaveBeenCalledWith(image, USER_ID);
    expect(prisma.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageUrl: 'https://example.com/category.jpg',
          imagePublicId: `ecommerce/categories/users/${USER_ID}/category`,
        }),
      }),
    );
  });

  it('cleans up a new image when category creation fails', async () => {
    uploads.uploadCategoryImage.mockResolvedValue({
      secure_url: 'https://example.com/category.jpg',
      public_id: `ecommerce/categories/users/${USER_ID}/category`,
    });
    prisma.category.create.mockRejectedValueOnce(new Error('database failure'));

    await expect(
      service.create(
        { name: 'Electronics', slug: 'electronics' },
        {} as Express.Multer.File,
        USER_ID,
      ),
    ).rejects.toThrow('database failure');
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      `ecommerce/categories/users/${USER_ID}/category`,
    );
  });

  it('preserves category image metadata when updating without a new image', async () => {
    await service.update(CATEGORY_ID, { name: 'Electronics' });
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
      id: CATEGORY_ID,
      imageUrl: 'https://example.com/old.jpg',
      imagePublicId: `ecommerce/categories/users/${USER_ID}/old`,
    });
    uploads.uploadCategoryImage.mockResolvedValue({
      secure_url: 'https://example.com/new.jpg',
      public_id: `ecommerce/categories/users/${USER_ID}/new`,
    });
    const image = {} as Express.Multer.File;

    await service.update(CATEGORY_ID, {}, image, USER_ID);

    expect(prisma.category.update.mock.invocationCallOrder[0]).toBeLessThan(
      uploads.deleteCategoryImage.mock.invocationCallOrder[0],
    );
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      `ecommerce/categories/users/${USER_ID}/old`,
    );
  });

  it('cleans up a new image when category update fails', async () => {
    uploads.uploadCategoryImage.mockResolvedValue({
      secure_url: 'https://example.com/new.jpg',
      public_id: `ecommerce/categories/users/${USER_ID}/new`,
    });
    prisma.category.update.mockRejectedValueOnce(new Error('database failure'));

    await expect(
      service.update(CATEGORY_ID, {}, {} as Express.Multer.File, USER_ID),
    ).rejects.toThrow('database failure');
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      `ecommerce/categories/users/${USER_ID}/new`,
    );
  });

  it('deletes a category without an image without Cloudinary cleanup', async () => {
    await expect(service.remove(CATEGORY_ID)).resolves.toEqual({
      id: CATEGORY_ID,
    });
    expect(prisma.category.delete).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
    });
    expect(uploads.deleteCategoryImage).not.toHaveBeenCalled();
  });

  it('deletes the category image after database deletion', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: CATEGORY_ID,
      imagePublicId: `ecommerce/categories/users/${USER_ID}/category`,
    });

    await expect(service.remove(CATEGORY_ID)).resolves.toEqual({
      id: CATEGORY_ID,
    });
    expect(prisma.category.delete.mock.invocationCallOrder[0]).toBeLessThan(
      uploads.deleteCategoryImage.mock.invocationCallOrder[0],
    );
    expect(uploads.deleteCategoryImage).toHaveBeenCalledWith(
      `ecommerce/categories/users/${USER_ID}/category`,
    );
  });

  it('does not trigger Cloudinary deletion for a nonexistent category', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(service.remove(MISSING_CATEGORY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.category.delete).not.toHaveBeenCalled();
    expect(uploads.deleteCategoryImage).not.toHaveBeenCalled();
  });

  it('does not trigger Cloudinary deletion when database deletion fails', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: CATEGORY_ID,
      imagePublicId: `ecommerce/categories/users/${USER_ID}/category`,
    });
    prisma.category.delete.mockRejectedValueOnce(new Error('database failure'));

    await expect(service.remove(CATEGORY_ID)).rejects.toThrow(
      'database failure',
    );
    expect(uploads.deleteCategoryImage).not.toHaveBeenCalled();
  });

  it('logs Cloudinary cleanup failure without changing successful database deletion', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: CATEGORY_ID,
      imagePublicId: `ecommerce/categories/users/${USER_ID}/category`,
    });
    uploads.deleteCategoryImage.mockResolvedValue(false);
    const logSpy = vi
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.remove(CATEGORY_ID)).resolves.toEqual({
      id: CATEGORY_ID,
    });
    expect(logSpy).toHaveBeenCalledWith(
      `Cloudinary category image cleanup failed for category ${CATEGORY_ID} and public ID ecommerce/categories/users/${USER_ID}/category.`,
    );
  });

  it('preserves existing description when omitted on update, clears it when null, and updates it when a new description is provided', async () => {
    let stored: any = null;
    prisma.category.create.mockImplementationOnce(async ({ data }: any) => {
      stored = { id: CATEGORY_ID, ...data };
      return stored;
    });
    prisma.category.findUnique.mockImplementation(async ({ where }: any) =>
      stored && where.id === stored.id ? stored : null,
    );
    prisma.category.update.mockImplementation(async ({ data }: any) => {
      stored = { ...stored, ...data };
      return stored;
    });

    // 1. Create a category with a non-null description
    const created = await service.create({
      name: 'Electronics',
      slug: 'electronics',
      description: 'Initial category description',
    });
    expect(created.description).toBe('Initial category description');

    // 2 & 3. Update only its name -> existing description remains unchanged
    const afterNamePatch = await service.update(CATEGORY_ID, {
      name: '  Appliances  ',
    });
    expect(afterNamePatch.name).toBe('Appliances');
    expect(afterNamePatch.description).toBe('Initial category description');
    expect(prisma.category.update).toHaveBeenLastCalledWith({
      where: { id: CATEGORY_ID },
      data: { name: 'Appliances' },
    });

    // 4 & 5. Update with description: null -> description is cleared
    const afterClearPatch = await service.update(CATEGORY_ID, {
      description: null,
    });
    expect(afterClearPatch.description).toBeNull();
    expect(prisma.category.update).toHaveBeenLastCalledWith({
      where: { id: CATEGORY_ID },
      data: { description: null },
    });

    // 6 & 7. Update with a new description -> description is updated
    const afterNewDescPatch = await service.update(CATEGORY_ID, {
      description: '  New category description  ',
    });
    expect(afterNewDescPatch.description).toBe('New category description');
    expect(prisma.category.update).toHaveBeenLastCalledWith({
      where: { id: CATEGORY_ID },
      data: { description: 'New category description' },
    });
  });

  describe('Categories HTTP partial update & validation', () => {
    let app: INestApplication;
    let jwt: JwtService;
    let categoryRow: any;

    beforeEach(async () => {
      categoryRow = {
        id: CATEGORY_ID,
        name: 'Electronics',
        slug: 'electronics',
        description: 'Electronic devices and accessories.',
        imageUrl: null,
        imagePublicId: null,
        isActive: true,
        createdAt: new Date('2026-10-30T08:00:00.000Z'),
        updatedAt: new Date('2026-10-30T08:00:00.000Z'),
      };

      prisma.user = {
        findUnique: vi.fn(async () => ({
          isActive: true,
          role: {
            permissions: [
              'category:create',
              'category:update',
              'category:delete',
            ].map((code) => ({ permission: { code } })),
          },
        })),
      };
      prisma.category.findUnique = vi.fn(async ({ where }: any) =>
        where.id === CATEGORY_ID ? categoryRow : null,
      );
      prisma.category.update = vi.fn(async ({ data }: any) => {
        categoryRow = { ...categoryRow, ...data };
        return categoryRow;
      });

      app = await createTestHttpApp({
        imports: [JwtModule.register({ secret: 'categories-test-secret' })],
        controllers: [CategoriesController],
        providers: [
          CategoriesService,
          JwtAuthGuard,
          PermissionsGuard,
          Reflector,
          { provide: PrismaService, useValue: prisma },
          { provide: UploadsService, useValue: uploads },
        ],
      });
      jwt = app.get(JwtService);
    });

    afterEach(async () => app.close());

    it('supports partial updates (single-field, multi-field, empty body, multipart with empty fields, file-only, and nullable description) and rejects invalid/null non-nullable fields', async () => {
      const adminToken = jwt.sign({ sub: USER_ID, role: 'ADMIN' });

      // 1. Update single field only
      const single = await request(app.getHttpServer())
        .patch(`/api/categories/${CATEGORY_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '  Consumer Electronics  ' })
        .expect(200);
      expect(single.body.data).toMatchObject({
        id: CATEGORY_ID,
        name: 'Consumer Electronics',
        slug: 'electronics',
        description: 'Electronic devices and accessories.',
        isActive: true,
      });
      expect(prisma.category.update).toHaveBeenLastCalledWith({
        where: { id: CATEGORY_ID },
        data: { name: 'Consumer Electronics' },
      });

      // 2. Update multiple fields
      const multi = await request(app.getHttpServer())
        .patch(`/api/categories/${CATEGORY_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: '  consumer-electronics  ',
          description: 'Updated category description.',
          isActive: false,
        })
        .expect(200);
      expect(multi.body.data).toMatchObject({
        name: 'Consumer Electronics',
        slug: 'consumer-electronics',
        description: 'Updated category description.',
        isActive: false,
      });

      // 3. Clear nullable description with explicit null
      const cleared = await request(app.getHttpServer())
        .patch(`/api/categories/${CATEGORY_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: null })
        .expect(200);
      expect(cleared.body.data.description).toBeNull();

      // 3b. Set a new description via PATCH and verify it is updated
      const restoredDesc = await request(app.getHttpServer())
        .patch(`/api/categories/${CATEGORY_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: '  Restored category description.  ' })
        .expect(200);
      expect(restoredDesc.body.data.description).toBe(
        'Restored category description.',
      );

      // 4. Multipart form-data with empty string fields preserves existing values
      const multipartPartial = await request(app.getHttpServer())
        .patch(`/api/categories/${CATEGORY_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Multipart Category')
        .field('slug', '')
        .field('description', '')
        .field('isActive', '')
        .expect(200);
      expect(multipartPartial.body.data).toMatchObject({
        name: 'Multipart Category',
        slug: 'consumer-electronics',
        description: 'Restored category description.',
        isActive: false,
      });
      expect(prisma.category.update).toHaveBeenLastCalledWith({
        where: { id: CATEGORY_ID },
        data: { name: 'Multipart Category' },
      });

      // 5. File-only update via multipart/form-data
      uploads.uploadCategoryImage.mockResolvedValueOnce({
        secure_url: 'https://cdn.example.com/cat-new.jpg',
        public_id: `ecommerce/categories/users/${USER_ID}/cat-new`,
      });
      const fileOnly = await request(app.getHttpServer())
        .patch(`/api/categories/${CATEGORY_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
          filename: 'cat.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);
      expect(fileOnly.body.data).toMatchObject({
        name: 'Multipart Category',
        slug: 'consumer-electronics',
        imageUrl: 'https://cdn.example.com/cat-new.jpg',
      });

      // 6. Reject explicit null on non-nullable fields, whitespace-only strings, and unknown properties
      prisma.category.update.mockClear();
      for (const invalidPayload of [
        { name: null },
        { name: '' },
        { name: '   ' },
        { slug: null },
        { slug: '' },
        { slug: '   ' },
        { isActive: null },
        { isActive: 'not-a-boolean' },
        { unknownProperty: 'rejected' },
      ]) {
        await request(app.getHttpServer())
          .patch(`/api/categories/${CATEGORY_ID}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(invalidPayload)
          .expect(400);
      }
      expect(prisma.category.update).not.toHaveBeenCalled();
    });
  });
});

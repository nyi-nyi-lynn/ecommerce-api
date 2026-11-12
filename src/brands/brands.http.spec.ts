import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BrandsController } from './brands.controller.js';
import { BrandsService } from './brands.service.js';

describe('Brands HTTP', () => {
  const USER_CUSTOMER = '00000000-0000-4000-8000-000000000001';
  const USER_ADMIN = '00000000-0000-4000-8000-000000000002';
  const BRAND_1 = '00000000-0000-4000-8000-000000000011';
  const BRAND_2 = '00000000-0000-4000-8000-000000000012';
  const BRAND_INACTIVE = '00000000-0000-4000-8000-000000000019';

  let app: INestApplication;
  let prisma: any;
  let uploads: {
    uploadBrandImage: ReturnType<typeof vi.fn>;
    deleteBrandImage: ReturnType<typeof vi.fn>;
  };
  let jwt: JwtService;
  let rows: any[];

  const initialBrand = {
    id: BRAND_1,
    name: 'Samsung',
    slug: 'samsung',
    description: 'Global electronics brand.',
    imageUrl: null,
    imagePublicId: null,
    isActive: true,
    createdAt: new Date('2026-10-30T08:00:00.000Z'),
    updatedAt: new Date('2026-10-30T08:00:00.000Z'),
  };

  beforeEach(async () => {
    rows = [initialBrand];
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: {
            permissions: (where.id === USER_ADMIN
              ? ['brand:create', 'brand:update', 'brand:delete']
              : []
            ).map((code) => ({ permission: { code } })),
          },
        })),
      },
      brand: {
        create: vi.fn(async ({ data }) => {
          if (
            rows.some(
              (row) => row.name === data.name || row.slug === data.slug,
            )
          ) {
            throw { code: 'P2002' };
          }
          const created = {
            id: BRAND_2,
            ...data,
            createdAt: new Date('2026-10-30T08:00:00.000Z'),
            updatedAt: new Date('2026-10-30T08:00:00.000Z'),
          };
          rows.push(created);
          return created;
        }),
        findMany: vi.fn(async ({ where, skip, take }) =>
          rows
            .filter(
              (row) =>
                row.isActive === where.isActive &&
                (!where.name?.contains ||
                  row.name
                    .toLowerCase()
                    .includes(where.name.contains.toLowerCase())),
            )
            .slice(skip, skip + take),
        ),
        count: vi.fn(
          async ({ where }) =>
            rows.filter(
              (row) =>
                row.isActive === where.isActive &&
                (!where.name?.contains ||
                  row.name
                    .toLowerCase()
                    .includes(where.name.contains.toLowerCase())),
            ).length,
        ),
        findFirst: vi.fn(
          async ({ where }) =>
            rows.find(
              (row) =>
                row.id === where.id && row.isActive === where.isActive,
            ) ?? null,
        ),
        findUnique: vi.fn(
          async ({ where }) => rows.find((row) => row.id === where.id) ?? null,
        ),
        update: vi.fn(async ({ where, data }) => {
          const existing = rows.find((row) => row.id === where.id);
          if (!existing) throw { code: 'P2025' };
          if (
            rows.some(
              (row) =>
                row.id !== where.id &&
                ((data.name && row.name === data.name) ||
                  (data.slug && row.slug === data.slug)),
            )
          ) {
            throw { code: 'P2002' };
          }
          const updated = { ...existing, ...data };
          rows = rows.map((row) => (row.id === where.id ? updated : row));
          return updated;
        }),
        delete: vi.fn(async ({ where }) => {
          const existing = rows.find((row) => row.id === where.id);
          if (!existing) throw { code: 'P2025' };
          if (existing.hasProducts) {
            throw { code: 'P2003' };
          }
          rows = rows.filter((row) => row.id !== where.id);
          return existing;
        }),
      },
    };

    uploads = {
      uploadBrandImage: vi.fn(),
      deleteBrandImage: vi.fn().mockResolvedValue(true),
    };

    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'brands-test-secret' })],
      controllers: [BrandsController],
      providers: [
        BrandsService,
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

  const token = (id: string) =>
    jwt.sign({ sub: id, role: id === USER_CUSTOMER ? 'CUSTOMER' : 'ADMIN' });

  it('allows public read access for active brands and hides inactive brands', async () => {
    rows = [
      initialBrand,
      {
        ...initialBrand,
        id: BRAND_INACTIVE,
        name: 'Inactive Brand',
        slug: 'inactive-brand',
        isActive: false,
      },
    ];

    const list = await request(app.getHttpServer())
      .get('/api/brands?isActive=false')
      .expect(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].id).toBe(BRAND_1);

    const detail = await request(app.getHttpServer())
      .get(`/api/brands/${BRAND_1}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: BRAND_1,
      name: 'Samsung',
      slug: 'samsung',
    });

    await request(app.getHttpServer())
      .get(`/api/brands/${BRAND_INACTIVE}`)
      .expect(404);
  });

  it('enforces RBAC permissions on create, update, and delete and rejects duplicate name/slug or deleting in-use brands', async () => {
    const payload = {
      name: 'Apple',
      slug: 'apple',
      description: 'Consumer electronics.',
    };

    await request(app.getHttpServer())
      .post('/api/brands')
      .send(payload)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/brands')
      .set('Authorization', `Bearer ${token(USER_CUSTOMER)}`)
      .send(payload)
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/api/brands')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send(payload)
      .expect(201);
    expect(created.body.data).toMatchObject({
      id: BRAND_2,
      name: 'Apple',
      slug: 'apple',
    });

    // Duplicate name or slug rejected with 409 Conflict
    await request(app.getHttpServer())
      .post('/api/brands')
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send(payload)
      .expect(409);

    // Update brand
    const updated = await request(app.getHttpServer())
      .patch(`/api/brands/${BRAND_2}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ name: 'Apple Inc.' })
      .expect(200);
    expect(updated.body.data.name).toBe('Apple Inc.');

    // Reject deleting brand referenced by products
    rows = rows.map((row) =>
      row.id === BRAND_1 ? { ...row, hasProducts: true } : row,
    );
    await request(app.getHttpServer())
      .delete(`/api/brands/${BRAND_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .expect(400);

    // Delete unused brand
    await request(app.getHttpServer())
      .delete(`/api/brands/${BRAND_2}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .expect(200);
  });

  it('supports partial updates (single-field, multi-field, multipart with empty fields, file-only, and nullable description) and rejects invalid or null non-nullable fields', async () => {
    // 1. Update single field only
    const single = await request(app.getHttpServer())
      .patch(`/api/brands/${BRAND_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ name: '  Samsung Electronics  ' })
      .expect(200);
    expect(single.body.data).toMatchObject({
      id: BRAND_1,
      name: 'Samsung Electronics',
      slug: 'samsung',
      description: 'Global electronics brand.',
      isActive: true,
    });
    expect(prisma.brand.update).toHaveBeenLastCalledWith({
      where: { id: BRAND_1 },
      data: { name: 'Samsung Electronics' },
    });

    // 2. Update multiple fields
    const multi = await request(app.getHttpServer())
      .patch(`/api/brands/${BRAND_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({
        slug: '  samsung-electronics  ',
        description: 'Updated brand description.',
        isActive: false,
      })
      .expect(200);
    expect(multi.body.data).toMatchObject({
      id: BRAND_1,
      name: 'Samsung Electronics',
      slug: 'samsung-electronics',
      description: 'Updated brand description.',
      isActive: false,
    });

    // 3. Clear nullable description with explicit null
    const cleared = await request(app.getHttpServer())
      .patch(`/api/brands/${BRAND_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ description: null })
      .expect(200);
    expect(cleared.body.data.description).toBeNull();

    // 3b. Update with a new description and verify it is persisted
    const newDesc = await request(app.getHttpServer())
      .patch(`/api/brands/${BRAND_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .send({ description: '  Restored brand description.  ' })
      .expect(200);
    expect(newDesc.body.data.description).toBe('Restored brand description.');

    // 4. Multipart form-data with empty string fields preserves existing values
    const multipartPartial = await request(app.getHttpServer())
      .patch(`/api/brands/${BRAND_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .field('name', 'Samsung Global')
      .field('slug', '')
      .field('description', '')
      .field('isActive', '')
      .expect(200);
    expect(multipartPartial.body.data).toMatchObject({
      id: BRAND_1,
      name: 'Samsung Global',
      slug: 'samsung-electronics',
      description: 'Restored brand description.',
      isActive: false,
    });
    expect(prisma.brand.update).toHaveBeenLastCalledWith({
      where: { id: BRAND_1 },
      data: { name: 'Samsung Global' },
    });

    // 5. File-only update via multipart/form-data
    uploads.uploadBrandImage.mockResolvedValueOnce({
      secure_url: 'https://cdn.example.com/brand-new.jpg',
      public_id: `ecommerce/brands/users/${USER_ADMIN}/brand-new`,
    });
    const fileOnly = await request(app.getHttpServer())
      .patch(`/api/brands/${BRAND_1}`)
      .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
      .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        filename: 'brand.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200);
    expect(fileOnly.body.data).toMatchObject({
      id: BRAND_1,
      name: 'Samsung Global',
      slug: 'samsung-electronics',
      imageUrl: 'https://cdn.example.com/brand-new.jpg',
    });

    // 6. Reject explicit null on non-nullable fields, whitespace-only strings, and unknown properties
    prisma.brand.update.mockClear();
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
        .patch(`/api/brands/${BRAND_1}`)
        .set('Authorization', `Bearer ${token(USER_ADMIN)}`)
        .send(invalidPayload)
        .expect(400);
    }
    expect(prisma.brand.update).not.toHaveBeenCalled();
  });
});

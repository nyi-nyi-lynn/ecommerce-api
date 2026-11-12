import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { CmsController } from './cms.controller.js';
import { CmsService } from './cms.service.js';
import { CmsPublishingController } from './cms-publishing.controller.js';
import { CmsPublicController } from './cms-public.controller.js';

describe('CMS HTTP', () => {
  const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
  const CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
  const DOCUMENT_ID = '00000000-0000-4000-8000-000000000003';
  let app: INestApplication;
  let jwt: JwtService;
  let permissions: Record<string, string[]>;
  let prisma: any;
  let uploads: any;
  let stored: any;

  beforeEach(async () => {
    stored = {
      id: DOCUMENT_ID,
      key: 'about-us',
      title: 'About',
      status: 'DRAFT',
      publishedAt: null,
      sections: [],
    };
    permissions = {
      [ADMIN_ID]: ['cms:read', 'cms:create', 'cms:update', 'cms:delete'],
      [CUSTOMER_ID]: [],
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: DOCUMENT_ID }]),
      cmsDocument: {
        findUnique: vi.fn(async () => stored),
        update: vi.fn(async ({ data }) => Object.assign(stored, data)),
        delete: vi.fn(async () => stored),
      },
      cmsSection: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ documentId: DOCUMENT_ID, imagePublicId: null }),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(async ({ data }) => ({
          id: '00000000-0000-4000-8000-000000000004',
          ...data,
        })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi
          .fn()
          .mockResolvedValue({ id: '00000000-0000-4000-8000-000000000004' }),
      },
      cmsSectionItem: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ section: { documentId: DOCUMENT_ID } }),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(async ({ data }) => ({
          id: '00000000-0000-4000-8000-000000000005',
          ...data,
        })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi
          .fn()
          .mockResolvedValue({ id: '00000000-0000-4000-8000-000000000005' }),
      },
      category: { findUnique: vi.fn().mockResolvedValue({ id: DOCUMENT_ID }) },
    };
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: {
            permissions: (permissions[where.id] ?? []).map((code) => ({
              permission: { code },
            })),
          },
        })),
      },
      cmsDocument: {
        create: vi.fn(async ({ data }) => ({ id: DOCUMENT_ID, ...data })),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(async () => stored),
        findUniqueOrThrow: vi.fn(async () => stored),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn(async ({ where, data }) => {
          if (stored.status !== where.status) return { count: 0 };
          Object.assign(stored, data);
          return { count: 1 };
        }),
      },
      cmsSection: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi
          .fn()
          .mockResolvedValue({ documentId: DOCUMENT_ID, imagePublicId: null }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      cmsSectionItem: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      category: { findUnique: vi.fn().mockResolvedValue({ id: DOCUMENT_ID }) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    uploads = {
      uploadCmsImage: vi
        .fn()
        .mockResolvedValue({
          secure_url: 'https://cdn.test/cms.png',
          public_id: 'ecommerce/cms/users/admin/cms',
        }),
      deleteCmsImage: vi.fn().mockResolvedValue(true),
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'cms-test-secret' })],
      controllers: [
        CmsController,
        CmsPublishingController,
        CmsPublicController,
      ],
      providers: [
        CmsService,
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
  const token = (sub: string) => jwt.sign({ sub, role: 'ADMIN' });

  it('uses database permissions, rejects guests/customers, and returns the shared envelope', async () => {
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .send({ key: 'home', title: 'Home' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(CUSTOMER_ID)}`)
      .send({ key: 'home', title: 'Home' })
      .expect(403);
    const response = await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({ key: 'home', title: 'Home' })
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { key: 'home', title: 'Home' },
      path: '/api/cms/documents',
    });
  });

  it('rejects unknown DTO properties and observes dynamic permission changes', async () => {
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({ key: 'home', title: 'Home', ownerId: ADMIN_ID })
      .expect(400);
    permissions[ADMIN_ID] = ['cms:read'];
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({ key: 'home', title: 'Home' })
      .expect(403);
  });

  it('requires database-backed media:upload for document images', async () => {
    permissions[ADMIN_ID] = ['cms:create'];
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .field('key', 'home')
      .field('title', 'Home')
      .attach('image', Buffer.from('image'), 'image.png')
      .expect(403);
    expect(uploads.uploadCmsImage).not.toHaveBeenCalled();
  });

  it('serves only published documents publicly without authentication', async () => {
    stored = {
      key: 'about-us',
      title: 'About',
      seoTitle: 'About SEO',
      seoDescription: 'About description',
      ogImageUrl: 'https://cdn.test/og.png',
      status: 'PUBLISHED',
      sections: [
        {
          key: 'hero',
          type: 'hero',
          position: 0,
          content: { headline: 'Hello' },
          imageUrl: null,
          items: [],
        },
      ],
    };
    const response = await request(app.getHttpServer())
      .get('/api/cms/pages/about-us')
      .expect(200);
    expect(response.body.data).toMatchObject({
      key: 'about-us',
      title: 'About',
      seoTitle: 'About SEO',
    });
    expect(response.body.data).not.toHaveProperty('createdById');
    expect(prisma.cmsDocument.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'about-us', status: 'PUBLISHED' },
        select: expect.not.objectContaining({
          createdById: true,
          publishedById: true,
        }),
      }),
    );
    expect(response.body.data.sections[0].content).toEqual({
      headline: 'Hello',
    });
    stored = null;
    await request(app.getHttpServer())
      .get('/api/cms/pages/draft-only')
      .expect(404);
  });

  it('protects publish and current-content preview with database permissions', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/cms/documents/${DOCUMENT_ID}/publish`)
      .set('Authorization', `Bearer ${token(CUSTOMER_ID)}`)
      .expect(403);
    permissions[ADMIN_ID] = ['cms:read'];
    const preview = await request(app.getHttpServer())
      .get(`/api/admin/cms/documents/${DOCUMENT_ID}/preview`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .expect(200);
    expect(preview.body.data).toMatchObject({
      key: 'about-us',
      status: 'DRAFT',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('publishes and unpublishes the direct document status', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/admin/cms/documents/${DOCUMENT_ID}/publish`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .expect(201);
    expect(response.body.data.status).toBe('PUBLISHED');
    const unpublish = await request(app.getHttpServer())
      .post(`/api/admin/cms/documents/${DOCUMENT_ID}/unpublish`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .expect(201);
    expect(unpublish.body.data).toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
    });
  });

  it('creates sections under a document and items under a section', async () => {
    const section = await request(app.getHttpServer())
      .post(`/api/cms/documents/${DOCUMENT_ID}/sections`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({
        key: 'hero',
        type: 'hero',
        position: 0,
        content: { headline: 'Welcome' },
      })
      .expect(201);
    expect(section.body.data.documentId).toBe(DOCUMENT_ID);
    const item = await request(app.getHttpServer())
      .post(`/api/cms/sections/${section.body.data.id}/items`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({ position: 0, title: 'Shop', url: '/products' })
      .expect(201);
    expect(item.body.data.position).toBe(0);
  });
});
